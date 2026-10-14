import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  advancePlayback,
  LONG_STOP_DWELL_MS,
  LONG_STOP_MS,
  type PlaybackStop,
} from "./playback"

const END = 2_000_000

function stop(durationMs: number, startTime = 0): PlaybackStop {
  return { startTime, endTime: startTime + durationMs, durationMs }
}

describe("long-stop playback", () => {
  it("skips a 10 minute stop after the dwell", () => {
    const stops = [stop(10 * 60 * 1000)]
    let time = 1_000
    let dwellMs = 0
    let frames = 0
    while (time < stops[0].endTime && frames < 100) {
      const step = advancePlayback({
        time,
        playing: true,
        stops,
        rate: 120,
        dwellMs,
        dtMs: 100,
        endTime: END,
      })
      time = step.time
      dwellMs = step.dwellMs
      frames += 1
      assert.equal(step.playing, true)
    }
    assert.equal(time, stops[0].endTime)
    assert.equal(dwellMs, 0)
    assert.ok(frames * 100 <= LONG_STOP_DWELL_MS + 100)
    assert.ok(frames * 100 >= LONG_STOP_DWELL_MS)
  })

  it("does not skip a 2 minute stop", () => {
    const stops = [stop(2 * 60 * 1000)]
    let time = 0
    let dwellMs = 0
    for (let i = 0; i < 10; i++) {
      const step = advancePlayback({
        time,
        playing: true,
        stops,
        rate: 1,
        dwellMs,
        dtMs: 1_000,
        endTime: END,
      })
      time = step.time
      dwellMs = step.dwellMs
    }
    assert.equal(time, 10_000)
    assert.equal(dwellMs, 0)
  })

  it("plays a stop of exactly 3 minutes at the normal rate", () => {
    const step = advancePlayback({
      time: 0,
      playing: true,
      stops: [stop(LONG_STOP_MS)],
      rate: 2,
      dwellMs: 0,
      dtMs: 1_000,
      endTime: END,
    })
    assert.equal(step.time, 2_000)
    assert.equal(step.dwellMs, 0)
  })

  it("does not auto-skip a long stop until playback is running", () => {
    const stops = [stop(10 * 60 * 1000)]
    const paused = advancePlayback({
      time: 60_000,
      playing: false,
      stops,
      rate: 120,
      dwellMs: LONG_STOP_DWELL_MS,
      dtMs: 5_000,
      endTime: END,
    })
    assert.equal(paused.time, 60_000)
    assert.equal(paused.playing, false)
    assert.equal(paused.dwellMs, 0)

    const started = advancePlayback({
      time: 60_000,
      playing: true,
      stops,
      rate: 120,
      dwellMs: 0,
      dtMs: 16,
      endTime: END,
    })
    assert.equal(started.time, 60_000)
    assert.equal(started.playing, true)
    assert.ok(started.dwellMs < LONG_STOP_DWELL_MS)
  })

  it("dwells on a long stop instead of jumping over it in one frame", () => {
    const stops = [stop(10 * 60 * 1000, 5_000)]
    const step = advancePlayback({
      time: 0,
      playing: true,
      stops,
      rate: 120,
      dwellMs: 0,
      dtMs: 10_000,
      endTime: END,
    })
    assert.equal(step.time, stops[0].startTime)
    assert.equal(step.dwellMs, 0)
    assert.equal(step.playing, true)
  })

  it("uses real time for the dwell, not the playback rate", () => {
    const stops = [stop(10 * 60 * 1000)]
    const slow = advancePlayback({
      time: 0,
      playing: true,
      stops,
      rate: 1,
      dwellMs: 0,
      dtMs: 500,
      endTime: END,
    })
    const fast = advancePlayback({
      time: 0,
      playing: true,
      stops,
      rate: 120,
      dwellMs: 0,
      dtMs: 500,
      endTime: END,
    })
    assert.equal(slow.time, 0)
    assert.equal(fast.time, 0)
    assert.equal(slow.dwellMs, 500)
    assert.equal(fast.dwellMs, 500)
  })
})
