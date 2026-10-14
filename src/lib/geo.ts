const EARTH_RADIUS_M = 6_371_000

/** Great-circle distance in meters. */
export function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

export const STOP_ZOOM = 15
export const SLOW_ZOOM = 17
export const FAST_ZOOM = 13
const FAST_SPEED_KMH = 60

/**
 * Follow-mode zoom. Faster recorded speed zooms out.
 * Playback rate counts: at 120× a modest ride fills the screen like a much
 * faster one. A marked stop stays wider than a creep, so the cursor has
 * room when motion resumes.
 */
export function zoomForSpeed(
  speedKmh: number,
  stopped: boolean,
  playbackRate = 1,
): number {
  if (stopped) return STOP_ZOOM
  const apparent = speedKmh * Math.max(playbackRate, 1)
  const speed = Math.min(Math.max(apparent, 0), FAST_SPEED_KMH)
  return SLOW_ZOOM + (FAST_ZOOM - SLOW_ZOOM) * (speed / FAST_SPEED_KMH)
}

/** How fast the follow camera may pan, so tiles can finish loading. */
export const FOLLOW_PAN_PX_PER_SEC = 150
export const FOLLOW_MIN_ZOOM = 12

export type FollowCameraStep = {
  panX: number
  panY: number
  /** Next zoom, or null when the current zoom should stay. */
  zoom: number | null
}

/**
 * One follow-camera frame. Pans toward the cursor, but never faster than
 * FOLLOW_PAN_PX_PER_SEC. If the cursor is leaving the view, steps the zoom
 * out so the same ground speed takes fewer pixels. Zooms back toward
 * `targetZoom` only once the cursor is near the center.
 */
export function followCameraStep(options: {
  offsetX: number
  offsetY: number
  zoom: number
  targetZoom: number
  dt: number
  minSize: number
  allowZoom: boolean
}): FollowCameraStep {
  const { offsetX, offsetY, zoom, targetZoom, dt, minSize, allowZoom } = options
  const dist = Math.hypot(offsetX, offsetY)
  let panX = 0
  let panY = 0
  if (dist >= 0.75 && dt > 0) {
    const speed = Math.min(FOLLOW_PAN_PX_PER_SEC, dist / 0.35)
    const limit = Math.max(1, minSize * 0.45)
    const step = Math.min(dist, speed * dt, limit)
    panX = (offsetX / dist) * step
    panY = (offsetY / dist) * step
  }

  let nextZoom: number | null = null
  if (allowZoom && minSize > 0) {
    const comfort = minSize * 0.3
    const gap = targetZoom - zoom
    // Speed jumped after a stop. Reach the wider target in one step instead
    // of easing half a level at a time while the cursor leaves the view.
    if (gap <= -1 && zoom > FOLLOW_MIN_ZOOM + 0.01) {
      nextZoom = Math.max(FOLLOW_MIN_ZOOM, targetZoom)
    } else if (dist > comfort && zoom > FOLLOW_MIN_ZOOM + 0.01) {
      nextZoom = Math.max(FOLLOW_MIN_ZOOM, zoom - 0.5)
    } else if (dist < comfort * 0.35 && gap >= 0.5) {
      nextZoom = Math.min(targetZoom, zoom + 0.5)
    } else if (dist < comfort * 0.35 && gap <= -0.5) {
      nextZoom = Math.max(targetZoom, zoom - 0.5)
    } else if (dist < comfort * 0.35 && Math.abs(gap) >= 0.35) {
      nextZoom = targetZoom
    }
    if (nextZoom != null && Math.abs(nextZoom - zoom) < 0.01) nextZoom = null
  }

  return { panX, panY, zoom: nextZoom }
}

export type SegmentHit = {
  lat: number
  lon: number
  /** 0 at the segment start, 1 at the end. */
  t: number
  distanceM: number
}

/** Closest point on the segment AB to P, in local meters. */
export function nearestOnSegment(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
  pLat: number,
  pLon: number,
): SegmentHit {
  const lat0 = (aLat * Math.PI) / 180
  const mPerDegLat = 111_320
  const mPerDegLon = 111_320 * Math.cos(lat0)
  const bx = (bLon - aLon) * mPerDegLon
  const by = (bLat - aLat) * mPerDegLat
  const px = (pLon - aLon) * mPerDegLon
  const py = (pLat - aLat) * mPerDegLat
  const len2 = bx * bx + by * by
  let t = len2 === 0 ? 0 : (px * bx + py * by) / len2
  t = Math.min(1, Math.max(0, t))
  const dx = px - bx * t
  const dy = py - by * t
  return {
    lat: aLat + (bLat - aLat) * t,
    lon: aLon + (bLon - aLon) * t,
    t,
    distanceM: Math.hypot(dx, dy),
  }
}
