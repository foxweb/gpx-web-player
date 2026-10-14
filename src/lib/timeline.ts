const STEPS_MS = [
  60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000,
  10_800_000, 14_400_000, 21_600_000,
]

function chooseStep(span: number, maxTicks: number): number {
  const limit = Math.max(2, maxTicks)
  for (const step of STEPS_MS) {
    if (Math.floor(span / step) + 1 <= limit) return step
  }
  return STEPS_MS[STEPS_MS.length - 1]
}

/** Drops intermediate marks that would sit on top of a neighbour. Ends stay. */
function thinTicks(
  times: number[],
  start: number,
  end: number,
  width: number,
  minGap: number,
): number[] {
  if (times.length <= 2 || end <= start) return times
  const span = end - start
  const x = (time: number) => ((time - start) / span) * width
  const last = times[times.length - 1]
  const kept = [times[0]]
  for (const time of times.slice(1, -1)) {
    if (x(time) - x(kept[kept.length - 1]) >= minGap && x(last) - x(time) >= minGap) {
      kept.push(time)
    }
  }
  kept.push(last)
  return kept
}

/** Elapsed offsets from 0 through the full duration, on a readable step. */
export function elapsedScaleTicks(spanMs: number, widthPx: number): number[] {
  const span = Math.max(0, spanMs)
  if (span === 0) return [0]
  const width = Math.max(widthPx, 160)
  const minGap = 72
  const step = chooseStep(span, Math.floor(width / minGap))
  const ticks = [0]
  for (let time = step; time < span - step * 0.45; time += step) ticks.push(time)
  ticks.push(span)
  return thinTicks(ticks, 0, span, width, minGap)
}

/**
 * GPS instants: the real start and end, plus round local clock marks between them.
 * `offset` is fixed from the start so the marks stay evenly spaced.
 */
export function clockScaleTicks(
  start: number,
  end: number,
  widthPx: number,
  minGap = 64,
): number[] {
  const span = end - start
  if (!(span > 0)) return [start]
  const width = Math.max(widthPx, 160)
  const gap = Math.max(32, minGap)
  const step = chooseStep(span, Math.floor(width / gap))
  const offsetMs = new Date(start).getTimezoneOffset() * 60_000
  const ticks = [start]
  let local = Math.ceil((start - offsetMs) / step) * step
  const endLocal = end - offsetMs
  for (; local < endLocal - step * 0.2; local += step) {
    const utc = local + offsetMs
    if (utc > start && utc < end) ticks.push(utc)
  }
  ticks.push(end)
  return thinTicks(ticks, start, end, width, gap)
}
