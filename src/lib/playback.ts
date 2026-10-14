/** Stops longer than this play as a short dwell, then the cursor jumps to the end. */
export const LONG_STOP_MS = 3 * 60 * 1000

/** Real time the marker stays on a long stop, independent of the playback rate. */
export const LONG_STOP_DWELL_MS = 1_800

export type PlaybackStop = {
  startTime: number
  endTime: number
  durationMs: number
}

export type PlaybackStep = {
  time: number
  dwellMs: number
  playing: boolean
}

/**
 * One playback frame. Manual seeks never call this with `playing: true` until
 * the user starts playback, so sitting inside a long stop does not skip it.
 * A stop of LONG_STOP_MS or less advances at `rate`. A longer stop holds the
 * cursor until LONG_STOP_DWELL_MS of real time has elapsed, then jumps to the
 * stop's end so the rest of the track can play.
 */
export function advancePlayback(input: {
  time: number
  playing: boolean
  stops: readonly PlaybackStop[]
  rate: number
  dwellMs: number
  dtMs: number
  endTime: number
}): PlaybackStep {
  const { time, stops, endTime } = input
  if (!input.playing) {
    return { time, dwellMs: 0, playing: false }
  }

  const dtMs = Math.max(0, input.dtMs)
  const active = longStopAt(stops, time)
  if (active) {
    const dwell = input.dwellMs + dtMs
    if (dwell < LONG_STOP_DWELL_MS) {
      return { time, dwellMs: dwell, playing: true }
    }
    const landed = Math.min(endTime, active.endTime)
    return { time: landed, dwellMs: 0, playing: landed < endTime }
  }

  const rate = Math.max(0, input.rate)
  const next = time + dtMs * rate
  if (next >= endTime) {
    return { time: endTime, dwellMs: 0, playing: false }
  }

  const entered = longStopEntered(stops, time, next)
  if (entered) {
    return { time: entered.startTime, dwellMs: 0, playing: true }
  }

  return { time: next, dwellMs: 0, playing: true }
}

function longStopAt(
  stops: readonly PlaybackStop[],
  time: number,
): PlaybackStop | null {
  return (
    stops.find(
      (stop) =>
        stop.durationMs > LONG_STOP_MS &&
        time >= stop.startTime &&
        time < stop.endTime,
    ) ?? null
  )
}

function longStopEntered(
  stops: readonly PlaybackStop[],
  time: number,
  next: number,
): PlaybackStop | null {
  return (
    stops.find(
      (stop) =>
        stop.durationMs > LONG_STOP_MS &&
        time < stop.startTime &&
        next >= stop.startTime,
    ) ?? null
  )
}
