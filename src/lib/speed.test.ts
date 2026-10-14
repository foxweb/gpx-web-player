import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { classifySpeed, segmentSpeedKmh, SPEED_BANDS, trackSpeedRuns } from "./speed"

describe("speed bands", () => {
  it("keeps the thresholds in one list", () => {
    assert.deepEqual(
      SPEED_BANDS.map((band) => band.maxKmh),
      [5, 15, 30, Number.POSITIVE_INFINITY],
    )
  })

  it("classifies standing, slow, medium and fast", () => {
    assert.equal(classifySpeed(0).id, "stand")
    assert.equal(classifySpeed(4.9).id, "stand")
    assert.equal(classifySpeed(5).id, "slow")
    assert.equal(classifySpeed(14.9).id, "slow")
    assert.equal(classifySpeed(15).id, "medium")
    assert.equal(classifySpeed(29.9).id, "medium")
    assert.equal(classifySpeed(30).id, "fast")
    assert.equal(classifySpeed(80).id, "fast")
  })

  it("treats missing speeds as standing", () => {
    assert.equal(classifySpeed(Number.NaN).id, "stand")
    assert.equal(classifySpeed(-4).id, "stand")
  })

  it("reads segment speed from distance and time", () => {
    const kmh = segmentSpeedKmh({ time: 0, dist: 0 }, { time: 100_000, dist: 1000 })
    assert.ok(Math.abs(kmh - 36) < 0.01)
    assert.equal(classifySpeed(kmh).id, "fast")
  })

  it("groups a route into runs of the same band", () => {
    const runs = trackSpeedRuns([
      { lat: 0, lon: 0, time: 0, dist: 0 },
      { lat: 0, lon: 0.001, time: 10_000, dist: 20 },
      { lat: 0, lon: 0.002, time: 20_000, dist: 40 },
      { lat: 0, lon: 0.02, time: 30_000, dist: 1040 },
    ])
    assert.equal(runs.length, 2)
    assert.equal(runs[0].bandId, "slow")
    assert.equal(runs[0].positions.length, 3)
    assert.equal(runs[1].bandId, "fast")
    assert.equal(runs[1].color, classifySpeed(360).color)
  })
})
