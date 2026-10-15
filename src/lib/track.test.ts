import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  followCameraStep,
  haversine,
  zoomForSpeed,
  FOLLOW_MIN_ZOOM,
  FOLLOW_PAN_PX_PER_SEC,
  STOP_ZOOM,
  SLOW_ZOOM,
} from "./geo.ts"
import {
  buildTrack,
  loadGpx,
  movementTrend,
  nearestOnTrack,
  routeAverageSpeedKmh,
  sampleAt,
} from "./gpx.ts"

const START = Date.parse("2024-06-01T08:00:00Z")

function at(
  eastM: number,
  northM: number,
  timeMs: number,
  ele: number | null = 100,
) {
  const lat0 = 55
  const lon0 = 37
  const lat = lat0 + northM / 111_320
  const lon = lon0 + eastM / (111_320 * Math.cos((lat0 * Math.PI) / 180))
  return { lat, lon, ele, time: START + timeMs }
}

describe("haversine", () => {
  it("measures about 111.2 km per degree of latitude", () => {
    const meters = haversine(55, 37, 56, 37)
    assert.ok(meters > 110_500 && meters < 111_800)
  })
})

describe("recorded speed", () => {
  it("is haversine distance over the time gap and is zero at the start", () => {
    const track = buildTrack([
      at(0, 0, 0),
      at(1000, 0, 100_000),
    ])
    assert.equal(sampleAt(track, track.startTime).speedKmh, 0)
    const mid = sampleAt(track, track.startTime + 50_000)
    assert.ok(Math.abs(mid.speedKmh - 36) < 0.5)
    assert.ok(Math.abs(mid.distM - track.distanceM / 2) < 1)
    assert.ok(Math.abs(routeAverageSpeedKmh(track.distanceM, 100_000) - 36) < 0.5)
    assert.ok(Math.abs(mid.lat - (track.points[0].lat + track.points[1].lat) / 2) < 1e-6)
  })
})

describe("stops", () => {
  it("marks a stationary stretch of at least 30 seconds", () => {
    const raw = []
    for (let t = 0; t <= 60_000; t += 5_000) raw.push(at(0, 0, t))
    raw.push(at(200, 0, 90_000))
    const track = buildTrack(raw)
    assert.equal(track.stops.length, 1)
    assert.equal(track.stops[0].durationMs, 60_000)
    const during = sampleAt(track, track.startTime + 30_000)
    assert.equal(during.stopped, true)
    assert.equal(during.lat, track.stops[0].lat)
  })

  it("ignores a stop shorter than 30 seconds", () => {
    const raw = [at(0, 0, 0), at(0, 0, 20_000), at(300, 0, 40_000)]
    assert.equal(buildTrack(raw).stops.length, 0)
  })

  it("ignores riding that leaves the 40 m area before 30 seconds", () => {
    const raw = []
    for (let t = 0; t <= 60_000; t += 5_000) {
      raw.push(at((t / 1000) * (5000 / 3600), 0, t))
    }
    assert.equal(buildTrack(raw).stops.length, 0)
  })

  it("accepts a creep at 2.0 km/h that stays inside 40 m", () => {
    const raw = []
    const metersPerMs = 2 / 3.6 / 1000
    for (let t = 0; t <= 70_000; t += 5_000) raw.push(at(t * metersPerMs, 0, t))
    const track = buildTrack(raw)
    assert.equal(track.stops.length, 1)
    assert.ok(track.stops[0].durationMs >= 30_000)
  })

  it("rejects fast jitter that stays inside 40 m", () => {
    const raw = []
    for (let t = 0; t <= 40_000; t += 1_000) {
      raw.push(at(t % 2000 === 0 ? 0 : 20, 0, t))
    }
    assert.equal(buildTrack(raw).stops.length, 0)
  })

  it("merges stops within 70 m and two minutes", () => {
    const raw = []
    for (let t = 0; t <= 45_000; t += 5_000) raw.push(at(0, 0, t))
    raw.push(at(50, 0, 55_000))
    for (let t = 60_000; t <= 105_000; t += 5_000) raw.push(at(50, 0, t))
    const track = buildTrack(raw)
    assert.equal(track.stops.length, 1)
    assert.equal(track.stops[0].durationMs, 105_000)
    const duringGap = sampleAt(track, track.startTime + 55_000)
    assert.equal(duringGap.stopped, true)
  })

  it("keeps stops that are farther than 70 m", () => {
    const raw = []
    for (let t = 0; t <= 45_000; t += 5_000) raw.push(at(0, 0, t))
    raw.push(at(120, 0, 55_000))
    for (let t = 60_000; t <= 105_000; t += 5_000) raw.push(at(120, 0, t))
    assert.equal(buildTrack(raw).stops.length, 2)
  })

  it("cuts a multi-hour standstill at the end and keeps the arrival time", () => {
    const raw = [at(0, 0, 0), at(1000, 0, 100_000)]
    for (let t = 100_000; t <= 100_000 + 3 * 60 * 60 * 1000; t += 5 * 60 * 1000) {
      raw.push(at(1000, 0, t))
    }
    const track = buildTrack(raw)
    assert.equal(track.endTime - track.startTime, 100_000)
    assert.ok(Math.abs(track.distanceM - 1000) < 5)
    assert.equal(track.stops.length, 0)
  })

  it("cuts an hour of standing at the finish", () => {
    const raw = [at(0, 0, 0), at(1000, 0, 100_000)]
    for (let t = 100_000; t <= 100_000 + 60 * 60 * 1000; t += 60_000) {
      raw.push(at(1000, 0, t))
    }
    const track = buildTrack(raw)
    assert.equal(track.endTime - track.startTime, 100_000)
    assert.equal(track.stops.length, 0)
  })

  it("keeps a short stop at the finish", () => {
    const raw = [at(0, 0, 0), at(1000, 0, 100_000)]
    for (let t = 100_000; t <= 100_000 + 20 * 60 * 1000; t += 60_000) {
      raw.push(at(1000, 0, t))
    }
    const track = buildTrack(raw)
    assert.equal(track.endTime - track.startTime, 100_000 + 20 * 60 * 1000)
    assert.equal(track.stops.length, 1)
  })

  it("keeps a multi-hour stop when the ride continues after it", () => {
    const raw = [at(0, 0, 0), at(500, 0, 50_000)]
    for (let t = 50_000; t <= 50_000 + 3 * 60 * 60 * 1000; t += 5 * 60 * 1000) {
      raw.push(at(500, 0, t))
    }
    const departed = 50_000 + 3 * 60 * 60 * 1000
    raw.push(at(2000, 0, departed + 150_000))
    const track = buildTrack(raw)
    assert.equal(track.endTime - track.startTime, departed + 150_000)
    assert.equal(track.stops.length, 1)
    assert.ok(track.stops[0].durationMs > 60 * 60 * 1000)
  })

  it("keeps stops separated by more than two minutes", () => {
    const raw = []
    for (let t = 0; t <= 45_000; t += 5_000) raw.push(at(0, 0, t))
    raw.push(at(40, 0, 200_000))
    for (let t = 200_000; t <= 250_000; t += 5_000) raw.push(at(40, 0, t))
    assert.equal(buildTrack(raw).stops.length, 2)
  })
})

describe("nearest point on a segment", () => {
  it("projects onto the middle of a segment", () => {
    const track = buildTrack([
      at(0, 0, 0),
      at(100, 0, 10_000),
    ])
    const hit = nearestOnTrack(track.points, at(50, 25, 0).lat, at(50, 25, 0).lon)
    assert.ok(hit.distanceM > 20 && hit.distanceM < 30)
    assert.ok(Math.abs(hit.time - (track.startTime + 5_000)) < 200)
  })
})

describe("elevation", () => {
  it("uses ele only and does not invent heights", () => {
    const track = buildTrack([
      at(0, 0, 0, null),
      at(10, 0, 10_000, null),
    ])
    assert.equal(track.hasElevation, false)
    assert.equal(track.eleMin, null)
    assert.equal(sampleAt(track, track.startTime + 5_000).ele, null)
  })

  it("interpolates elevation when both ends have it", () => {
    const track = buildTrack([
      at(0, 0, 0, 100),
      at(10, 0, 10_000, 120),
    ])
    const mid = sampleAt(track, track.startTime + 5_000)
    assert.ok(mid.ele != null && Math.abs(mid.ele - 110) < 0.01)
    assert.equal(track.eleMin, 100)
    assert.equal(track.eleMax, 120)
  })
})

describe("movement trend", () => {
  it("points up while climbing and speeding up", () => {
    const track = buildTrack([
      at(0, 0, 0, 100),
      at(20, 0, 10_000, 102),
      at(80, 0, 20_000, 106),
    ])
    const trend = movementTrend(track, track.startTime + 10_000)
    assert.equal(trend.elevation, "up")
    assert.equal(trend.speed, "up")
  })

  it("points down while descending and slowing", () => {
    const track = buildTrack([
      at(0, 0, 0, 120),
      at(60, 0, 10_000, 112),
      at(80, 0, 20_000, 104),
    ])
    const trend = movementTrend(track, track.startTime + 10_000)
    assert.equal(trend.elevation, "down")
    assert.equal(trend.speed, "down")
  })

  it("stays quiet on a steady stretch and without elevation", () => {
    const steady = buildTrack([
      at(0, 0, 0, 100),
      at(30, 0, 10_000, 100),
      at(60, 0, 20_000, 100),
    ])
    const flat = movementTrend(steady, steady.startTime + 10_000)
    assert.equal(flat.elevation, null)
    assert.equal(flat.speed, null)

    const noEle = buildTrack([
      at(0, 0, 0, null),
      at(20, 0, 10_000, null),
      at(80, 0, 20_000, null),
    ])
    assert.equal(movementTrend(noEle, noEle.startTime + 10_000).elevation, null)
  })
})

describe("gpx parser", () => {
  it("reads track points, elevation and timestamps", () => {
    const track = loadGpx(`<?xml version="1.0"?>
      <gpx>
        <trk><trkseg>
          <trkpt lat="55.75" lon="37.61"><ele>150.2</ele><time>2024-06-01T08:00:00Z</time></trkpt>
          <trkpt lat="55.751" lon="37.61"><ele>151</ele><time>2024-06-01T08:01:00Z</time></trkpt>
        </trkseg></trk>
      </gpx>`)
    assert.equal(track.points.length, 2)
    assert.equal(track.points[0].ele, 150.2)
    assert.equal(track.hasElevation, true)
  })

  it("rejects a file without timestamps", () => {
    assert.throws(
      () =>
        loadGpx(`<gpx><trk><trkseg>
          <trkpt lat="55" lon="37"><ele>10</ele></trkpt>
          <trkpt lat="55.01" lon="37"><ele>12</ele></trkpt>
        </trkseg></trk></gpx>`),
      /метки времени/,
    )
  })

  it("rejects a file that is not GPX", () => {
    assert.throws(() => loadGpx("<html><body>нет</body></html>"), /не похож на GPX/)
  })
})

describe("follow zoom", () => {
  it("zooms out as speed rises and keeps a stop wider than a creep", () => {
    const slow = zoomForSpeed(0, false)
    const fast = zoomForSpeed(60, false)
    const stopped = zoomForSpeed(0, true)
    assert.equal(slow, SLOW_ZOOM)
    assert.ok(fast < slow)
    assert.equal(stopped, STOP_ZOOM)
    assert.ok(stopped < slow)
    assert.ok(Math.abs(zoomForSpeed(30, false) - 15) < 0.01)
    assert.equal(zoomForSpeed(30, false, 120), fast)
  })
})

describe("follow camera", () => {
  it("caps a long catch-up so the map does not cross the screen in one frame", () => {
    const step = followCameraStep({
      offsetX: 800,
      offsetY: 0,
      zoom: 16,
      targetZoom: 16,
      dt: 1 / 60,
      minSize: 500,
      allowZoom: false,
    })
    const pan = Math.hypot(step.panX, step.panY)
    assert.ok(pan < 800)
    assert.ok(Math.abs(pan - FOLLOW_PAN_PX_PER_SEC / 60) < 0.05)
    assert.equal(step.zoom, null)
  })

  it("eases a short gap instead of using the full pan cap", () => {
    const step = followCameraStep({
      offsetX: 12,
      offsetY: 0,
      zoom: 16,
      targetZoom: 16,
      dt: 1 / 60,
      minSize: 500,
      allowZoom: false,
    })
    assert.ok(step.panX > 0)
    assert.ok(step.panX < FOLLOW_PAN_PX_PER_SEC / 60)
  })

  it("zooms out while the cursor leaves the view and back in once it is centered", () => {
    const leaving = followCameraStep({
      offsetX: 220,
      offsetY: 0,
      zoom: 16,
      targetZoom: 17,
      dt: 1 / 60,
      minSize: 500,
      allowZoom: true,
    })
    assert.equal(leaving.zoom, 15.5)

    const floor = followCameraStep({
      offsetX: 220,
      offsetY: 0,
      zoom: FOLLOW_MIN_ZOOM,
      targetZoom: 17,
      dt: 1 / 60,
      minSize: 500,
      allowZoom: true,
    })
    assert.equal(floor.zoom, null)

    const settled = followCameraStep({
      offsetX: 4,
      offsetY: 0,
      zoom: 15,
      targetZoom: 17,
      dt: 1 / 60,
      minSize: 500,
      allowZoom: true,
    })
    assert.equal(settled.zoom, 15.5)

    const departed = followCameraStep({
      offsetX: 4,
      offsetY: 0,
      zoom: 16,
      targetZoom: 13,
      dt: 1 / 60,
      minSize: 500,
      allowZoom: true,
    })
    assert.equal(departed.zoom, 13)
  })
})
