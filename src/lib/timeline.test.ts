import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { formatScaleClock, formatScaleElapsed } from "./format"
import { clockScaleTicks, elapsedScaleTicks } from "./timeline"

function local(year: number, month: number, day: number, hour: number, minute: number, second = 0) {
  return new Date(year, month - 1, day, hour, minute, second).getTime()
}

describe("scale labels", () => {
  it("writes elapsed marks from zero without extra seconds", () => {
    assert.equal(formatScaleElapsed(0), "0:00")
    assert.equal(formatScaleElapsed(90_000), "1:30")
    assert.equal(formatScaleElapsed(3_600_000), "1:00")
    assert.equal(formatScaleElapsed(27_384_000), "7:36:24")
  })

  it("writes the local clock and adds the date after midnight", () => {
    const evening = local(2026, 10, 3, 18, 4, 0)
    const next = local(2026, 10, 4, 1, 40, 0)
    assert.equal(formatScaleClock(evening), "18:04")
    assert.equal(formatScaleClock(next, true), "4.10 01:40")
  })
})

describe("scrubber ticks", () => {
  it("keeps elapsed marks between zero and the final time", () => {
    const span = 27_384_000
    const ticks = elapsedScaleTicks(span, 1080)
    assert.equal(ticks[0], 0)
    assert.equal(ticks[ticks.length - 1], span)
    assert.ok(ticks.length >= 4)
    for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i] > ticks[i - 1])
  })

  it("places clock marks on local hours and keeps the GPS ends", () => {
    const start = local(2026, 10, 3, 18, 4, 18)
    const end = local(2026, 10, 4, 1, 40, 42)
    const ticks = clockScaleTicks(start, end, 1080, 88)
    assert.equal(ticks[0], start)
    assert.equal(ticks[ticks.length - 1], end)
    const first = new Date(ticks[1])
    assert.equal(first.getHours(), 19)
    assert.equal(first.getMinutes(), 0)
    for (const time of ticks.slice(1, -1)) {
      const date = new Date(time)
      assert.equal(date.getMinutes(), 0)
      assert.equal(date.getSeconds(), 0)
    }
  })

  it("thins marks on a narrow scale", () => {
    const span = 27_384_000
    const wide = elapsedScaleTicks(span, 1080)
    const narrow = elapsedScaleTicks(span, 320)
    assert.ok(narrow.length < wide.length)
    assert.ok(narrow.length <= 5)
  })
})
