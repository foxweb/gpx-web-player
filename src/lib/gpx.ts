import { haversine, nearestOnSegment } from "@/lib/geo"

const STOP_RADIUS_M = 40
const STOP_MAX_SPEED_KMH = 2.2
const STOP_MIN_MS = 30_000
const MERGE_DISTANCE_M = 70
const MERGE_GAP_MS = 2 * 60 * 1000
/** A recording that keeps sitting after arrival. A finish under half an hour stays. */
const TRAILING_IDLE_MS = 30 * 60 * 1000
const TRAILING_IDLE_RADIUS_M = 80

export class GpxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GpxError"
  }
}

export type TrackPoint = {
  lat: number
  lon: number
  ele: number | null
  time: number
  dist: number
}

export type Stop = {
  id: number
  startTime: number
  endTime: number
  durationMs: number
  lat: number
  lon: number
}

export type Track = {
  points: TrackPoint[]
  stops: Stop[]
  hasElevation: boolean
  eleMin: number | null
  eleMax: number | null
  distanceM: number
  startTime: number
  endTime: number
}

export type Sample = {
  time: number
  lat: number
  lon: number
  ele: number | null
  distM: number
  speedKmh: number
  stopped: boolean
}

/** Rising or falling around the cursor. A flat stretch has no direction. */
export type Trend = "up" | "down"

export type MovementTrend = {
  elevation: Trend | null
  speed: Trend | null
}

export type TrackHit = {
  lat: number
  lon: number
  time: number
  distanceM: number
}

type RawPoint = {
  lat: number
  lon: number
  ele: number | null
  time: number | null
}

/** Distance over the whole recording, including time spent stopped. */
export function routeAverageSpeedKmh(distanceM: number, durationMs: number): number {
  const seconds = durationMs / 1000
  if (!(seconds > 0) || !Number.isFinite(distanceM)) return 0
  return (Math.max(0, distanceM) / seconds) * 3.6
}

export function loadGpx(xml: string): Track {
  return buildTrack(parseGpxPoints(xml))
}

export function buildTrack(raw: RawPoint[]): Track {
  const finite = raw.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lon),
  )
  if (finite.length === 0) {
    throw new GpxError("В файле нет точек трека.")
  }

  const timed = finite.filter(
    (point): point is RawPoint & { time: number } => point.time != null,
  )
  if (timed.length < finite.length && timed.length < 2) {
    throw new GpxError(
      "В точках нет меток времени, поэтому маршрут нельзя воспроизвести.",
    )
  }
  if (timed.length < 2) {
    throw new GpxError("В файле слишком мало точек, чтобы построить маршрут.")
  }

  const sorted = [...timed].sort((a, b) => a.time - b.time)
  const measured: TrackPoint[] = []
  let dist = 0
  for (let i = 0; i < sorted.length; i++) {
    const point = sorted[i]
    if (i > 0) {
      const prev = measured[i - 1]
      dist += haversine(prev.lat, prev.lon, point.lat, point.lon)
    }
    measured.push({
      lat: point.lat,
      lon: point.lon,
      ele: point.ele,
      time: point.time,
      dist,
    })
  }

  const points = trimTrailingIdle(measured)
  dist = points[points.length - 1].dist

  const startTime = points[0].time
  const endTime = points[points.length - 1].time
  if (endTime <= startTime) {
    throw new GpxError("В файле нет интервала времени между точками.")
  }

  const elevations = points
    .map((point) => point.ele)
    .filter((ele): ele is number => ele != null)

  return {
    points,
    stops: detectStops(points),
    hasElevation: elevations.length > 0,
    eleMin: elevations.length ? Math.min(...elevations) : null,
    eleMax: elevations.length ? Math.max(...elevations) : null,
    distanceM: dist,
    startTime,
    endTime,
  }
}

const TREND_HALF_MS = 6_000
const TREND_MIN_SPAN_MS = 3_000
const ELE_TREND_M = 0.3
const SPEED_TREND_KMH = 1.2

function segmentIndex(points: TrackPoint[], time: number): number {
  let index = 0
  let lo = 0
  let hi = points.length - 2
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].time <= time) {
      index = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return index
}

/** Climb or descent, and whether speed is picking up or dropping, over a short window. */
export function movementTrend(track: Track, time: number): MovementTrend {
  const { points } = track
  const start = points[0].time
  const end = points[points.length - 1].time
  const t = Math.min(end, Math.max(start, time))
  let before = t - TREND_HALF_MS
  let after = t + TREND_HALF_MS
  if (before < start) {
    after = Math.min(end, after + (start - before))
    before = start
  }
  if (after > end) {
    before = Math.max(start, before - (after - end))
    after = end
  }
  if (after - before < TREND_MIN_SPAN_MS) {
    return { elevation: null, speed: null }
  }

  const earlier = sampleAt(track, before)
  const later = sampleAt(track, after)
  let elevation: Trend | null = null
  if (earlier.ele != null && later.ele != null) {
    const delta = later.ele - earlier.ele
    if (delta >= ELE_TREND_M) elevation = "up"
    else if (delta <= -ELE_TREND_M) elevation = "down"
  }

  const earlyIndex = segmentIndex(points, before)
  const lateIndex = segmentIndex(points, after)
  const speedEarlier = segmentSpeed(points[earlyIndex], points[earlyIndex + 1])
  const speedLater = segmentSpeed(points[lateIndex], points[lateIndex + 1])
  const speedDelta = speedLater - speedEarlier
  let speed: Trend | null = null
  if (speedDelta >= SPEED_TREND_KMH) speed = "up"
  else if (speedDelta <= -SPEED_TREND_KMH) speed = "down"

  return { elevation, speed }
}

export function sampleAt(track: Track, time: number): Sample {
  const { points } = track
  const start = points[0].time
  const end = points[points.length - 1].time
  const t = Math.min(end, Math.max(start, time))
  const index = segmentIndex(points, t)
  const a = points[index]
  const b = points[index + 1] ?? a
  const span = b.time - a.time
  const fraction = span > 0 ? Math.min(1, Math.max(0, (t - a.time) / span)) : 0
  const lat = a.lat + (b.lat - a.lat) * fraction
  const lon = a.lon + (b.lon - a.lon) * fraction
  const ele =
    a.ele != null && b.ele != null ? a.ele + (b.ele - a.ele) * fraction : null
  const speedKmh = t <= start ? 0 : segmentSpeed(a, b)
  const distM = a.dist + (b.dist - a.dist) * fraction
  const stop =
    track.stops.find((item) => t >= item.startTime && t <= item.endTime) ??
    null

  return {
    time: t,
    lat: stop ? stop.lat : lat,
    lon: stop ? stop.lon : lon,
    ele,
    distM,
    speedKmh,
    stopped: stop != null,
  }
}

/** Nearest location on a segment, not only vertices. Time is interpolated along that segment. */
export function nearestOnTrack(
  points: TrackPoint[],
  lat: number,
  lon: number,
): TrackHit {
  let best: TrackHit = {
    lat: points[0].lat,
    lon: points[0].lon,
    time: points[0].time,
    distanceM: Number.POSITIVE_INFINITY,
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const hit = nearestOnSegment(a.lat, a.lon, b.lat, b.lon, lat, lon)
    if (hit.distanceM < best.distanceM) {
      best = {
        lat: hit.lat,
        lon: hit.lon,
        time: a.time + (b.time - a.time) * hit.t,
        distanceM: hit.distanceM,
      }
    }
  }

  return best
}

/**
 * Drops a long stationary tail. The anchor is the last recorded point, not a
 * saved place: if the file spends at least half an hour inside 80 m of where
 * it finally stopped, the recording ends when it first reached that spot.
 */
function trimTrailingIdle(points: TrackPoint[]): TrackPoint[] {
  if (points.length < 3) return points
  const end = points[points.length - 1]
  let arrival = points.length - 1
  for (let i = points.length - 2; i >= 1; i--) {
    if (
      haversine(points[i].lat, points[i].lon, end.lat, end.lon) > TRAILING_IDLE_RADIUS_M
    ) {
      break
    }
    arrival = i
  }
  if (arrival >= points.length - 1) return points
  if (end.time - points[arrival].time < TRAILING_IDLE_MS) return points
  return points.slice(0, arrival + 1)
}

function segmentSpeed(a: TrackPoint, b: TrackPoint): number {
  const dt = (b.time - a.time) / 1000
  if (dt <= 0) return 0
  return ((b.dist - a.dist) / dt) * 3.6
}

type RawStop = {
  startTime: number
  endTime: number
  lat: number
  lon: number
}

/**
 * A stop is a stretch of at least 30s that stays inside ~40 m of its first
 * point and whose path-average speed is at most 2.2 km/h.
 * Stops within 70 m and two minutes become one marker.
 * Duration is the span from the first start to the last end, and the marker
 * dwells for that whole span.
 */
function detectStops(points: TrackPoint[]): Stop[] {
  const raw: RawStop[] = []
  let i = 0
  while (i < points.length - 1) {
    let path = 0
    let bestJ = -1
    for (let j = i + 1; j < points.length; j++) {
      if (
        haversine(
          points[i].lat,
          points[i].lon,
          points[j].lat,
          points[j].lon,
        ) > STOP_RADIUS_M
      ) {
        break
      }
      path += points[j].dist - points[j - 1].dist
      const dtMs = points[j].time - points[i].time
      if (dtMs < STOP_MIN_MS) continue
      const speed = (path / (dtMs / 1000)) * 3.6
      if (speed <= STOP_MAX_SPEED_KMH) bestJ = j
    }
    if (bestJ > i) {
      raw.push(placeStop(points, i, bestJ))
      i = bestJ + 1
    } else {
      i += 1
    }
  }
  return mergeStops(raw)
}

function placeStop(points: TrackPoint[], i: number, j: number): RawStop {
  let lat = 0
  let lon = 0
  const count = j - i + 1
  for (let k = i; k <= j; k++) {
    lat += points[k].lat
    lon += points[k].lon
  }
  lat /= count
  lon /= count

  let snap = points[i]
  let best = Number.POSITIVE_INFINITY
  for (let k = i; k <= j; k++) {
    const distance = haversine(lat, lon, points[k].lat, points[k].lon)
    if (distance < best) {
      best = distance
      snap = points[k]
    }
  }

  return {
    startTime: points[i].time,
    endTime: points[j].time,
    lat: snap.lat,
    lon: snap.lon,
  }
}

function mergeStops(raw: RawStop[]): Stop[] {
  if (raw.length === 0) return []
  const groups: RawStop[][] = [[raw[0]]]
  for (let index = 1; index < raw.length; index++) {
    const group = groups[groups.length - 1]
    const prev = group[group.length - 1]
    const current = raw[index]
    const gap = current.startTime - prev.endTime
    const distance = haversine(prev.lat, prev.lon, current.lat, current.lon)
    if (gap >= 0 && gap <= MERGE_GAP_MS && distance <= MERGE_DISTANCE_M) {
      group.push(current)
    } else {
      groups.push([current])
    }
  }

  return groups.map((group, id) => {
    const startTime = group[0].startTime
    const endTime = group[group.length - 1].endTime
    let lat = 0
    let lon = 0
    let weight = 0
    for (const stop of group) {
      const w = Math.max(1, stop.endTime - stop.startTime)
      lat += stop.lat * w
      lon += stop.lon * w
      weight += w
    }
    lat /= weight
    lon /= weight

    let snap = group[0]
    let best = Number.POSITIVE_INFINITY
    for (const stop of group) {
      const distance = haversine(lat, lon, stop.lat, stop.lon)
      if (distance < best) {
        best = distance
        snap = stop
      }
    }

    return {
      id,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      lat: snap.lat,
      lon: snap.lon,
    }
  })
}

function parseGpxPoints(xml: string): RawPoint[] {
  const source = xml.replace(/^\uFEFF/, "").replace(/<!--[\s\S]*?-->/g, "")
  if (!/<(?:[A-Za-z0-9_]+:)?(?:gpx|trkpt)\b/i.test(source)) {
    throw new GpxError("Файл не похож на GPX.")
  }

  const pattern =
    /<(?:[A-Za-z0-9_]+:)?trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?trkpt>)/gi
  const points: RawPoint[] = []

  for (const match of source.matchAll(pattern)) {
    const attrs = match[1] ?? ""
    const inner = match[2] ?? ""
    const lat = Number(readAttr(attrs, "lat"))
    const lon = Number(readAttr(attrs, "lon"))
    const eleText = readChild(inner, "ele")
    const timeText = readChild(inner, "time")
    const ele =
      eleText == null || eleText === "" || !Number.isFinite(Number(eleText))
        ? null
        : Number(eleText)
    const time = timeText == null ? null : Date.parse(timeText)
    points.push({
      lat,
      lon,
      ele,
      time: time != null && Number.isFinite(time) ? time : null,
    })
  }

  return points
}

function readAttr(source: string, name: string): string | null {
  const match = source.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  )
  if (!match) return null
  return match[1] ?? match[2] ?? null
}

function readChild(inner: string, tag: string): string | null {
  const match = inner.match(
    new RegExp(
      `<(?:[A-Za-z0-9_]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${tag}>`,
      "i",
    ),
  )
  return match ? match[1].trim() : null
}
