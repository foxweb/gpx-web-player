type SpeedPoint = {
  lat: number
  lon: number
  time: number
  dist: number
}

/**
 * GPS speed bands for the route line. Thresholds are exclusive upper bounds
 * in km/h, checked in order: under 5, under 15, under 30, then anything faster.
 */
export const SPEED_BANDS = [
  { id: "stand", maxKmh: 5, label: "до 5", color: "#8b5cf6" },
  { id: "slow", maxKmh: 15, label: "5–15", color: "#0ea5e9" },
  { id: "medium", maxKmh: 30, label: "15–30", color: "#22c55e" },
  { id: "fast", maxKmh: Number.POSITIVE_INFINITY, label: "от 30", color: "#ef4444" },
] as const

export type SpeedBand = (typeof SPEED_BANDS)[number]
export type SpeedBandId = SpeedBand["id"]

export function classifySpeed(kmh: number): SpeedBand {
  const speed = Number.isFinite(kmh) ? Math.max(0, kmh) : 0
  for (const band of SPEED_BANDS) {
    if (speed < band.maxKmh) return band
  }
  return SPEED_BANDS[SPEED_BANDS.length - 1]
}

export function segmentSpeedKmh(
  a: { time: number; dist: number },
  b: { time: number; dist: number },
): number {
  const dt = (b.time - a.time) / 1000
  if (!(dt > 0)) return 0
  return ((b.dist - a.dist) / dt) * 3.6
}

export type SpeedRun = {
  bandId: SpeedBandId
  color: string
  positions: Array<[number, number]>
}

/** Consecutive segments that share a speed band, so the map can paint one polyline per run. */
export function trackSpeedRuns(points: SpeedPoint[]): SpeedRun[] {
  if (points.length < 2) return []
  const runs: SpeedRun[] = []
  let current: SpeedRun | null = null
  for (let i = 0; i < points.length - 1; i++) {
    const band = classifySpeed(segmentSpeedKmh(points[i], points[i + 1]))
    const end: [number, number] = [points[i + 1].lat, points[i + 1].lon]
    if (!current || current.bandId !== band.id) {
      current = {
        bandId: band.id,
        color: band.color,
        positions: [[points[i].lat, points[i].lon], end],
      }
      runs.push(current)
    } else {
      current.positions.push(end)
    }
  }
  return runs
}
