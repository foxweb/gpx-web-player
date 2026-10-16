"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import type { Stop, TrackPoint } from "@/lib/gpx"
import { formatElapsed } from "@/lib/format"

type View = {
  t0: number
  t1: number
  e0: number
  e1: number
}

type ElevationProfileProps = {
  points: TrackPoint[]
  stops: Stop[]
  startTime: number
  endTime: number
  cursorTime: number
  cursorEle: number | null
  onSeek: (time: number) => void
  resetToken: number
}

const PAD = { l: 8, r: 46, t: 10, b: 28 }
const MIN_TIME_SPAN = 5_000
const MIN_ELE_SPAN = 4

export function ElevationProfile({
  points,
  stops,
  startTime,
  endTime,
  cursorTime,
  cursorEle,
  onSeek,
  resetToken,
}: ElevationProfileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View | null>(null)
  const [themeTick, setThemeTick] = useState(0)
  const viewRef = useRef<View | null>(null)
  const dragRef = useRef<{
    mode: "pan" | "seek"
    x: number
    y: number
    view: View
    pointerId: number
  } | null>(null)

  const full = useMemo(
    () => fullView(points, startTime, endTime),
    [points, startTime, endTime],
  )
  const active = view ?? full

  useEffect(() => {
    viewRef.current = active
  }, [active])

  useEffect(() => {
    if (view !== null) {
      setTimeout(() => setView(null), 0)
    }
  }, [points, resetToken, view])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect()
      setSize({ w: rect.width, h: rect.height })
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setThemeTick((value) => value + 1)
    })
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w < 10 || size.h < 10) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawChart(ctx, size.w, size.h, {
      points,
      stops,
      startTime,
      view: active,
      cursorTime,
      cursorEle,
    })
  }, [active, cursorEle, cursorTime, points, size, startTime, stops, themeTick])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const plot = plotRect(rect.width, rect.height)
      if (!inside(x, y, plot)) return
      const current = viewRef.current ?? full
      const anchorT = xToTime(x, plot, current)
      const anchorE = yToEle(y, plot, current)
      const factor = Math.min(1.25, Math.max(0.8, Math.exp(event.deltaY * 0.0015)))
      const fullSpan = full.t1 - full.t0
      let t0 = current.t0
      let t1 = current.t1
      if (!event.shiftKey) {
        ;[t0, t1] = zoomRange(
          current.t0,
          current.t1,
          anchorT,
          factor,
          MIN_TIME_SPAN,
          fullSpan,
          full.t0,
          full.t1,
        )
      }
      const eleSpan = Math.max(full.e1 - full.e0, MIN_ELE_SPAN)
      const [e0, e1] = zoomRange(
        current.e0,
        current.e1,
        anchorE,
        factor,
        MIN_ELE_SPAN,
        eleSpan * 4,
        full.e0 - eleSpan,
        full.e1 + eleSpan,
      )
      setView({ t0, t1, e0, e1 })
    }
    canvas.addEventListener("wheel", onWheel, { passive: false })
    return () => canvas.removeEventListener("wheel", onWheel)
  }, [full])

  function seekFromClientX(clientX: number) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const plot = plotRect(rect.width, rect.height)
    const x = Math.min(plot.r, Math.max(plot.l, clientX - rect.left))
    const current = viewRef.current ?? full
    onSeek(xToTime(x, plot, current))
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return
    const pan = event.shiftKey || event.button === 1 || event.button === 2
    if (event.button === 1 || event.button === 2) event.preventDefault()
    const current = viewRef.current ?? full
    dragRef.current = {
      mode: pan ? "pan" : "seek",
      x: event.clientX,
      y: event.clientY,
      view: current,
      pointerId: event.pointerId,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (!pan) seekFromClientX(event.clientX)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.mode === "seek") {
      seekFromClientX(event.clientX)
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const plot = plotRect(rect.width, rect.height)
    const tSpan = drag.view.t1 - drag.view.t0
    const eSpan = drag.view.e1 - drag.view.e0
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    let t0 = drag.view.t0 - (dx / plot.w) * tSpan
    let t1 = t0 + tSpan
    if (t0 < full.t0) {
      t1 += full.t0 - t0
      t0 = full.t0
    }
    if (t1 > full.t1) {
      t0 -= t1 - full.t1
      t1 = full.t1
    }
    const eleRoom = Math.max(full.e1 - full.e0, MIN_ELE_SPAN)
    let e0 = drag.view.e0 + (dy / plot.h) * eSpan
    let e1 = e0 + eSpan
    const eleLo = full.e0 - eleRoom
    const eleHi = full.e1 + eleRoom
    if (e0 < eleLo) {
      e1 += eleLo - e0
      e0 = eleLo
    }
    if (e1 > eleHi) {
      e0 -= e1 - eleHi
      e1 = eleHi
    }
    setView({ t0, t1, e0, e1 })
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  return (
    <div
      ref={wrapRef}
      className="h-[220px] w-full sm:h-[280px]"
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(event) => event.preventDefault()}
      />
    </div>
  )
}

function fullView(points: TrackPoint[], startTime: number, endTime: number): View {
  const elevations = points
    .map((point) => point.ele)
    .filter((ele): ele is number => ele != null)
  let min = elevations.length ? Math.min(...elevations) : 0
  let max = elevations.length ? Math.max(...elevations) : 10
  if (max - min < 1) {
    min -= 5
    max += 5
  }
  const pad = Math.max(5, (max - min) * 0.08)
  return { t0: startTime, t1: endTime, e0: min - pad, e1: max + pad }
}

type Plot = { l: number; r: number; t: number; b: number; w: number; h: number }

function plotRect(width: number, height: number): Plot {
  return {
    l: PAD.l,
    r: width - PAD.r,
    t: PAD.t,
    b: height - PAD.b,
    w: Math.max(1, width - PAD.l - PAD.r),
    h: Math.max(1, height - PAD.t - PAD.b),
  }
}

function inside(x: number, y: number, plot: Plot): boolean {
  return x >= plot.l && x <= plot.r && y >= plot.t && y <= plot.b
}

function xToTime(x: number, plot: Plot, view: View): number {
  const ratio = (x - plot.l) / plot.w
  return view.t0 + ratio * (view.t1 - view.t0)
}

function yToEle(y: number, plot: Plot, view: View): number {
  const ratio = (y - plot.t) / plot.h
  return view.e1 - ratio * (view.e1 - view.e0)
}

function timeToX(time: number, plot: Plot, view: View): number {
  return plot.l + ((time - view.t0) / (view.t1 - view.t0)) * plot.w
}

function eleToY(ele: number, plot: Plot, view: View): number {
  return plot.t + ((view.e1 - ele) / (view.e1 - view.e0)) * plot.h
}

function zoomRange(
  a: number,
  b: number,
  anchor: number,
  factor: number,
  minSpan: number,
  maxSpan: number,
  lo: number,
  hi: number,
): [number, number] {
  const span = Math.max(b - a, 0)
  let next = span * factor
  next = Math.min(Math.max(next, minSpan), Math.max(minSpan, maxSpan))
  const rel = span === 0 ? 0.5 : (anchor - a) / span
  let na = anchor - rel * next
  let nb = na + next
  if (na < lo) {
    nb += lo - na
    na = lo
  }
  if (nb > hi) {
    na -= nb - hi
    nb = hi
  }
  if (na < lo) na = lo
  if (nb - na < minSpan && hi - lo >= minSpan) {
    nb = Math.min(hi, na + minSpan)
    na = nb - minSpan
  }
  return [na, nb]
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  data: {
    points: TrackPoint[]
    stops: Stop[]
    startTime: number
    view: View
    cursorTime: number
    cursorEle: number | null
  },
) {
  const { points, stops, startTime, view, cursorTime, cursorEle } = data
  const plot = plotRect(width, height)
  const colors = chartColors()
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = colors.background
  ctx.fillRect(0, 0, width, height)

  const eleTicks = niceTicks(view.e0, view.e1, 4)
  const timeStep = chooseTimeStep(view.t1 - view.t0)
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif"
  ctx.textAlign = "right"
  ctx.textBaseline = "middle"
  ctx.strokeStyle = colors.grid
  ctx.lineWidth = 1
  ctx.fillStyle = colors.label

  for (const tick of eleTicks) {
    const y = eleToY(tick, plot, view)
    if (y < plot.t || y > plot.b) continue
    ctx.beginPath()
    ctx.moveTo(plot.l, y)
    ctx.lineTo(plot.r, y)
    ctx.stroke()
    ctx.fillText(`${Math.round(tick)} м`, width - 4, y)
  }

  ctx.textAlign = "center"
  ctx.textBaseline = "top"
  const first = Math.ceil((view.t0 - startTime) / timeStep) * timeStep + startTime
  for (let time = first; time <= view.t1; time += timeStep) {
    const x = timeToX(time, plot, view)
    ctx.beginPath()
    ctx.moveTo(x, plot.t)
    ctx.lineTo(x, plot.b)
    ctx.stroke()
    ctx.fillText(formatElapsed(time - startTime), x, plot.b + 6)
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(plot.l, plot.t, plot.w, plot.h)
  ctx.clip()

  for (const stop of stops) {
    const x0 = timeToX(Math.max(stop.startTime, view.t0), plot, view)
    const x1 = timeToX(Math.min(stop.endTime, view.t1), plot, view)
    if (x1 <= plot.l || x0 >= plot.r) continue
    ctx.fillStyle = "rgba(249, 115, 22, 0.28)"
    ctx.fillRect(x0, plot.t, Math.max(1, x1 - x0), plot.h)
  }

  let run: TrackPoint[] = []
  const flush = () => {
    if (run.length === 0) return
    ctx.beginPath()
    run.forEach((point, index) => {
      const x = timeToX(point.time, plot, view)
      const y = eleToY(point.ele ?? 0, plot, view)
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    const last = run[run.length - 1]
    const firstPoint = run[0]
    ctx.lineTo(timeToX(last.time, plot, view), plot.b)
    ctx.lineTo(timeToX(firstPoint.time, plot, view), plot.b)
    ctx.closePath()
    ctx.fillStyle = "rgba(251, 146, 60, 0.35)"
    ctx.fill()

    ctx.beginPath()
    run.forEach((point, index) => {
      const x = timeToX(point.time, plot, view)
      const y = eleToY(point.ele ?? 0, plot, view)
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = "#ea580c"
    ctx.lineWidth = 2
    ctx.stroke()
    run = []
  }

  for (const point of points) {
    if (point.ele == null) {
      flush()
      continue
    }
    run.push(point)
  }
  flush()

  if (cursorTime >= view.t0 && cursorTime <= view.t1) {
    const x = timeToX(cursorTime, plot, view)
    ctx.beginPath()
    ctx.moveTo(x, plot.t)
    ctx.lineTo(x, plot.b)
    ctx.strokeStyle = "#2563eb"
    ctx.lineWidth = 1.5
    ctx.stroke()
    if (cursorEle != null) {
      const y = eleToY(cursorEle, plot, view)
      ctx.beginPath()
      ctx.arc(x, y, 4.5, 0, Math.PI * 2)
      ctx.fillStyle = "#2563eb"
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = "#ffffff"
      ctx.stroke()
    }
  }

  ctx.restore()
  ctx.strokeStyle = colors.grid
  ctx.strokeRect(plot.l + 0.5, plot.t + 0.5, plot.w - 1, plot.h - 1)
}

function chartColors() {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback
  return {
    background: token("--card", "#ffffff"),
    grid: token("--border", "#e5e7eb"),
    label: token("--muted-foreground", "#6b7280"),
  }
}

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min
  if (!(span > 0)) return [min]
  const raw = span / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const error = raw / pow
  const factor = error >= 7.5 ? 10 : error >= 3.5 ? 5 : error >= 1.5 ? 2 : 1
  const step = factor * pow
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let value = start; value <= max + step * 0.001; value += step) {
    ticks.push(Number(value.toFixed(6)))
    if (ticks.length > 12) break
  }
  return ticks
}

const TIME_STEPS = [
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000,
  600_000, 900_000, 1_800_000, 3_600_000, 7_200_000,
]

function chooseTimeStep(span: number): number {
  const target = span / 5
  return TIME_STEPS.find((step) => step >= target) ?? TIME_STEPS[TIME_STEPS.length - 1]
}
