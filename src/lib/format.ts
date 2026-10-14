export const PLAYBACK_RATES = [1, 10, 30, 60, 120] as const
export const DEFAULT_PLAYBACK_RATE = 120

export type PlaybackRate = (typeof PLAYBACK_RATES)[number]

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/** Axis label: hours when needed, seconds only when the mark is not a whole minute. */
export function formatScaleElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mm = String(minutes).padStart(2, "0")
  if (hours > 0) {
    if (seconds === 0) return `${hours}:${mm}`
    return `${hours}:${mm}:${String(seconds).padStart(2, "0")}`
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/** True when both instants fall on the same local calendar day. */
export function sameLocalDay(a: number, b: number): boolean {
  const left = new Date(a)
  const right = new Date(b)
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

/** Local clock. Date is prefixed when the track crosses midnight. */
export function formatScaleClock(ms: number, withDate = false): string {
  const date = new Date(ms)
  const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  if (!withDate) return clock
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${date.getDate()}.${month} ${clock}`
}

export function formatDistance(meters: number): string {
  const safe = Number.isFinite(meters) ? Math.max(0, meters) : 0
  if (safe < 1000) return `${Math.round(safe)} м`
  const km = safe / 1000
  const digits = km >= 100 ? 0 : 1
  return `${km.toFixed(digits)} км`
}

export function formatSpeed(kmh: number): string {
  const safe = Number.isFinite(kmh) ? Math.max(0, kmh) : 0
  return `${safe.toFixed(1)} км/ч`
}

export function formatElevation(meters: number): string {
  return `${Math.round(meters)} м`
}

/** Compact duration for a stop pin: «45 с», «3 мин». */
export function formatStopDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} с`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (rest === 0) return `${hours} ч`
  return `${hours} ч ${rest} мин`
}
