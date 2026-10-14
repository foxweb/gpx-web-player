"use client"

import { useEffect, useRef, useState } from "react"
import { formatScaleClock, formatScaleElapsed, sameLocalDay } from "@/lib/format"
import { clockScaleTicks, elapsedScaleTicks } from "@/lib/timeline"

const THUMB_PX = 14

type Mark = { key: number; ratio: number; label: string }

function thumbLeft(ratio: number): string {
  const clamped = Math.min(1, Math.max(0, ratio))
  return `calc(${clamped} * (100% - ${THUMB_PX}px) + ${THUMB_PX / 2}px)`
}

function ScaleRow({ marks, edge }: { marks: Mark[]; edge: "above" | "below" }) {
  const last = marks.length - 1
  return (
    <div className={`relative h-5 ${edge === "above" ? "mb-1.5" : "mt-1.5"}`} aria-hidden="true">
      {marks.map((mark) => (
        <span
          key={`tick-${mark.key}`}
          className={`absolute w-px -translate-x-1/2 bg-muted-foreground/50 ${
            edge === "above" ? "bottom-0 h-1.5" : "top-0 h-1.5"
          }`}
          style={{ left: thumbLeft(mark.ratio) }}
        />
      ))}
      {marks.map((mark, index) => (
        <span
          key={mark.key}
          className={`absolute whitespace-nowrap text-[10px] leading-none text-muted-foreground tabular-nums ${
            edge === "above" ? "top-0" : "bottom-0"
          }`}
          style={{
            left: index === 0 ? 0 : index === last ? "100%" : thumbLeft(mark.ratio),
            transform: index === 0 ? undefined : index === last ? "translateX(-100%)" : "translateX(-50%)",
          }}
        >
          {mark.label}
        </span>
      ))}
    </div>
  )
}

export function TrackScrubber({
  start,
  end,
  value,
  progress,
  onChange,
}: {
  start: number
  end: number
  value: number
  progress: number
  onChange: (time: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(360)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const span = Math.max(0, end - start)
  const crossesDay = !sameLocalDay(start, end)
  const elapsed = elapsedScaleTicks(span, width).map((offset) => ({
    key: offset,
    ratio: span === 0 ? 0 : offset / span,
    label: formatScaleElapsed(offset),
  }))
  const clock = clockScaleTicks(start, end, width, crossesDay ? 88 : 64).map((time) => ({
    key: time,
    ratio: span === 0 ? 0 : (time - start) / span,
    label: formatScaleClock(time, crossesDay && !sameLocalDay(start, time)),
  }))

  return (
    <div ref={ref} className="border-t px-3 py-2">
      <ScaleRow marks={elapsed} edge="above" />
      <input
        className="scrubber"
        type="range"
        min={start}
        max={end}
        step={100}
        value={value}
        aria-label="Положение на треке"
        style={{ ["--progress" as string]: `${progress}%` }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <ScaleRow marks={clock} edge="below" />
    </div>
  )
}
