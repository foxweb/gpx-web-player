"use client"

import dynamic from "next/dynamic"
import { ArrowDown, ArrowUp } from "lucide-react"
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react"
import { ElevationProfile } from "@/components/elevation-profile"
import { ThemeMenu } from "@/components/theme-menu"
import { TrackScrubber } from "@/components/track-scrubber"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "cn"
import {
  DEFAULT_PLAYBACK_RATE,
  PLAYBACK_RATES,
  formatDistance,
  formatElapsed,
  formatElevation,
  formatScaleClock,
  formatSpeed,
  formatStopDuration,
  sameLocalDay,
  type PlaybackRate,
} from "@/lib/format"
import { STOP_ZOOM, zoomForSpeed } from "@/lib/geo"
import {
  GpxError,
  loadGpx,
  routeAverageSpeedKmh,
  movementTrend,
  sampleAt,
  type Stop,
  type Track,
  type Trend,
} from "@/lib/gpx"
import { advancePlayback } from "@/lib/playback"
import { clearLastGpx, readLastGpx, saveLastGpx } from "@/lib/stored-gpx"

/** Track-time step for ArrowLeft / ArrowRight. Shown in the keyboard legend. */
const KEY_STEP_SEC = 15
const KEY_STEP_MS = KEY_STEP_SEC * 1000

const TrackMap = dynamic(() => import("@/components/track-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">
      Загрузка карты…
    </div>
  ),
})

export function Player() {
  const cursorRef = useRef(0)
  const [track, setTrack] = useState<Track | null>(null)
  const [cursorTime, setCursorTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState<PlaybackRate>(DEFAULT_PLAYBACK_RATE)
  const [follow, setFollow] = useState(true)
  const [reading, setReading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [profileReset, setProfileReset] = useState(0)
  const [recenterToken, setRecenterToken] = useState(0)
  const loadId = useRef(0)
  const dwellRef = useRef(0)
  const keysRef = useRef({
    track: null as Track | null,
    seek: (_time: number, _center?: boolean) => {},
    togglePlay: () => {},
  })

  useEffect(() => {
    if (!playing || !track) return
    let frame = 0
    let last = performance.now()
    const end = track.endTime
    const stops = track.stops
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const step = advancePlayback({
        time: cursorRef.current,
        playing: true,
        stops,
        rate,
        dwellMs: dwellRef.current,
        dtMs: dt,
        endTime: end,
      })
      dwellRef.current = step.dwellMs
      if (step.time !== cursorRef.current) {
        cursorRef.current = step.time
        setCursorTime(step.time)
      }
      if (!step.playing) {
        setPlaying(false)
        return
      }
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [playing, rate, track])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const api = keysRef.current
      if (!api.track) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (isEditableTarget(event.target)) return
      if (event.code === "Space" || event.key === " ") {
        event.preventDefault()
        if (event.repeat) return
        api.togglePlay()
        return
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        api.seek(cursorRef.current - KEY_STEP_MS, true)
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        api.seek(cursorRef.current + KEY_STEP_MS, true)
      } else if (event.key === "Home") {
        event.preventDefault()
        api.seek(api.track.startTime, true)
      } else if (event.key === "End") {
        event.preventDefault()
        api.seek(api.track.endTime, true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    const id = ++loadId.current
    void readLastGpx()
      .then((stored) => {
        if (id !== loadId.current) return
        if (!stored) return
        try {
          applyTrack(loadGpx(stored.text), stored.name)
        } catch (reason) {
          void clearLastGpx()
          setError(readError(reason))
        }
      })
      .catch(() => {
        if (id !== loadId.current) return
      })
      .finally(() => {
        if (id === loadId.current) setReading(false)
      })
  }, [])

  function applyTrack(next: Track, name: string) {
    cursorRef.current = next.startTime
    dwellRef.current = 0
    setCursorTime(next.startTime)
    setTrack(next)
    setFileName(name)
    setFollow(true)
    setProfileReset((value) => value + 1)
  }

  async function loadDemo() {
    const id = ++loadId.current
    setReading(true)
    setError(null)
    setPlaying(false)
    try {
      const response = await fetch("/demo.gpx")
      if (!response.ok) throw new Error("demo")
      const text = await response.text()
      if (id !== loadId.current) return
      const next = loadGpx(text)
      const name = "Ласточка, Пенза.gpx"
      applyTrack(next, name)
      try {
        await saveLastGpx({ name, text })
      } catch {
        if (id === loadId.current) {
          setError("Трек открыт, но не удалось сохранить его для следующей загрузки.")
        }
      }
    } catch (reason) {
      if (id !== loadId.current) return
      setError(reason instanceof GpxError ? reason.message : "Не удалось открыть демо-трек.")
    } finally {
      if (id === loadId.current) setReading(false)
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const id = ++loadId.current
    setReading(true)
    setError(null)
    setPlaying(false)
    try {
      const text = await file.text()
      if (id !== loadId.current) return
      const next = loadGpx(text)
      applyTrack(next, file.name)
      try {
        await saveLastGpx({ name: file.name, text })
      } catch {
        if (id === loadId.current) {
          setError("Трек открыт, но не удалось сохранить его для следующей загрузки.")
        }
      }
    } catch (reason) {
      if (id !== loadId.current) return
      setError(readError(reason))
    } finally {
      if (id === loadId.current) setReading(false)
    }
  }

  function seek(time: number, center = false) {
    if (!track) return
    const next = Math.min(track.endTime, Math.max(track.startTime, time))
    cursorRef.current = next
    dwellRef.current = 0
    setCursorTime(next)
    if (center) setRecenterToken((value) => value + 1)
  }

  function play() {
    if (!track) return
    if (cursorRef.current >= track.endTime - 50) {
      cursorRef.current = track.startTime
      dwellRef.current = 0
      setCursorTime(track.startTime)
    }
    setPlaying(true)
  }

  function togglePlay() {
    if (!track) return
    if (playing) {
      setPlaying(false)
      return
    }
    play()
  }

  function closeTrack() {
    const id = ++loadId.current
    setPlaying(false)
    setTrack(null)
    setFileName(null)
    setError(null)
    setFollow(true)
    setReading(false)
    dwellRef.current = 0
    cursorRef.current = 0
    setCursorTime(0)
    void clearLastGpx().catch(() => {
      if (id === loadId.current) {
        setError("Не удалось удалить сохранённый трек.")
      }
    })
  }

  keysRef.current.track = track
  keysRef.current.seek = seek
  keysRef.current.togglePlay = togglePlay

  function restart() {
    if (!track) return
    cursorRef.current = track.startTime
    dwellRef.current = 0
    setCursorTime(track.startTime)
    setPlaying(false)
  }

  const sample = track ? sampleAt(track, cursorTime) : null
  const trend = track ? movementTrend(track, cursorTime) : null
  const progress = track
    ? ((cursorTime - track.startTime) / (track.endTime - track.startTime)) * 100
    : 0
  const crossesMidnight = track
    ? !sameLocalDay(track.startTime, track.endTime)
    : false
  const clockLabel = track
    ? formatScaleClock(cursorTime, crossesMidnight)
    : ""
  const activeStopId =
    track?.stops.find(
      (stop) => cursorTime >= stop.startTime && cursorTime <= stop.endTime,
    )?.id ?? null

  return (
    <div className="min-h-full bg-[#f3f4f6] text-foreground dark:bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Визуализатор треков
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              GPX на карте, скорость по записи и профиль высоты
            </p>
            {fileName && (
              <p className="mt-1 truncate text-sm text-foreground" title={fileName}>
                {fileName}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeMenu />
            <Button size="lg" variant="outline" onClick={loadDemo} disabled={reading}>
              Демо
            </Button>
            <OpenGpxButton size="lg" onChange={onFile} />
          </div>
        </header>

        {reading && (
          <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
            Читаем трек…
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        {!track && !reading && (
          <section className="rounded-xl border border-dashed bg-card px-6 py-14 text-center shadow-sm">
            <h2 className="text-lg font-semibold">Трек ещё не открыт</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Нажмите «Открыть GPX» и выберите запись маршрута или «Демо»,
              чтобы открыть публичный GPS-след. Свой пример приложение само
              не подставляет.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <OpenGpxButton onChange={onFile} />
              <Button variant="outline" onClick={loadDemo} disabled={reading}>
                Демо
              </Button>
            </div>
          </section>
        )}

        {track && sample && (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Stat
                label="Дистанция"
                value={formatDistance(sample.distM)}
                hint={`всего ${formatDistance(track.distanceM)}`}
              />
              <Stat
                label="Время"
                value={formatElapsed(cursorTime - track.startTime)}
                hint={clockLabel}
              />
              <Stat
                label="Скорость"
                value={formatSpeed(sample.speedKmh)}
                hint={`средняя ${formatSpeed(
                  routeAverageSpeedKmh(track.distanceM, track.endTime - track.startTime),
                )}`}
                trend={trend?.speed ?? "flat"}
              />
              <Stat
                label="Высота"
                value={sample.ele == null ? "—" : formatElevation(sample.ele)}
                hint={
                  track.eleMin != null && track.eleMax != null
                    ? `мин ${formatElevation(track.eleMin)} · макс ${formatElevation(track.eleMax)}`
                    : undefined
                }
                trend={sample.ele == null ? undefined : (trend?.elevation ?? "flat")}
              />
              <Stat label="Остановки" value={String(track.stops.length)} />
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={play} disabled={playing}>
                <TapePlay />
                Старт
              </Button>
              <Button
                variant="outline"
                onClick={() => setPlaying(false)}
                disabled={!playing}
              >
                <TapePause />
                Пауза
              </Button>
              <Button variant="outline" onClick={restart}>
                <TapeRestart />
                Заново
              </Button>
              <Button variant="outline" onClick={closeTrack}>
                <TapeEject />
                Закрыть трек
              </Button>
              <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
              {PLAYBACK_RATES.map((item) => (
                <Button
                  key={item}
                  variant={rate === item ? "default" : "outline"}
                  aria-pressed={rate === item}
                  onClick={() => setRate(item)}
                >
                  {item}×
                </Button>
              ))}
            </div>
            <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs leading-5 text-muted-foreground">
              <span>Пробел — старт/пауза</span>
              <span>← → — шаг {KEY_STEP_SEC} с</span>
              <span>Home — начало</span>
              <span>End — конец</span>
            </p>

            <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="relative h-[340px] sm:h-[520px]">
                <TrackMap
                  points={track.points}
                  stops={track.stops}
                  cursor={{
                    lat: sample.lat,
                    lon: sample.lon,
                    zoom: playing
                      ? zoomForSpeed(sample.speedKmh, sample.stopped, rate)
                      : Math.min(
                          zoomForSpeed(sample.speedKmh, sample.stopped, 1),
                          STOP_ZOOM,
                        ),
                  }}
                  follow={follow}
                  recenterToken={recenterToken}
                  clockLabel={clockLabel}
                  onSeek={seek}
                  onStopSeek={(time) => seek(time, true)}
                  onFollowOff={() => setFollow(false)}
                />
                <Button
                  size="sm"
                  variant={follow ? "default" : "outline"}
                  aria-pressed={follow}
                  className="absolute top-3 right-3 z-[1100] shadow-md"
                  title={
                    follow
                      ? "Карта следует за курсором. Нажмите ещё раз, чтобы отпустить."
                      : "Держать курсор в центре карты"
                  }
                  onClick={() => setFollow((value) => !value)}
                >
                  Следить
                </Button>
              </div>
              <TrackScrubber
                start={track.startTime}
                end={track.endTime}
                value={cursorTime}
                progress={progress}
                onChange={(time) => seek(time, true)}
              />
            </section>

            <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <h2 className="text-sm text-muted-foreground">
                    Высота{" "}
                    <span className="text-lg font-semibold text-foreground tabular-nums">
                      {sample.ele == null ? "—" : formatElevation(sample.ele)}
                    </span>
                  </h2>
                  {track.eleMin != null && track.eleMax != null && (
                    <p className="text-sm text-muted-foreground tabular-nums">
                      мин {formatElevation(track.eleMin)} · макс{" "}
                      {formatElevation(track.eleMax)}
                    </p>
                  )}
                </div>
                {track.hasElevation && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setProfileReset((value) => value + 1)}
                  >
                    Весь профиль
                  </Button>
                )}
              </div>

              {track.hasElevation ? (
                <>
                  <ElevationProfile
                    points={track.points}
                    stops={track.stops}
                    startTime={track.startTime}
                    endTime={track.endTime}
                    cursorTime={cursorTime}
                    cursorEle={sample.ele}
                    onSeek={(time) => seek(time, true)}
                    resetToken={profileReset}
                  />
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Колесо меняет масштаб времени и высоты, Shift+колесо —
                    только высоту. Сдвиг: Shift, средняя или правая кнопка.
                    Щелчок и перетаскивание левой кнопкой ставят курсор.
                  </p>
                </>
              ) : (
                <p className="py-8 text-sm text-muted-foreground">
                  В этом файле нет высоты. Профиль строится только по меткам
                  ele — недостающие значения не достраиваются.
                </p>
              )}
            </section>

            {track.stops.length > 0 && (
              <StopList
                stops={track.stops}
                activeId={activeStopId}
                withDate={crossesMidnight}
                onSeek={(time) => seek(time, true)}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function readError(reason: unknown): string {
  return reason instanceof GpxError
    ? reason.message
    : "Не удалось прочитать файл."
}

function Stat({
  label,
  value,
  hint,
  trend,
}: {
  label: string
  value: string
  hint?: string
  trend?: Trend | "flat"
}) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2 shadow-sm">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 text-lg font-semibold tabular-nums">
        {value}
        {trend ? <TrendArrow direction={trend} /> : null}
      </dd>
      {hint ? (
        <dd className="text-sm font-medium tabular-nums text-muted-foreground">{hint}</dd>
      ) : null}
    </div>
  )
}

function TrendArrow({ direction }: { direction: Trend | "flat" }) {
  if (direction === "flat") {
    return <span className="inline-block size-4 shrink-0" />
  }
  const up = direction === "up"
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span
      role="img"
      aria-label={up ? "растёт" : "снижается"}
      className={cn(
        "inline-flex size-4 shrink-0",
        up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
      )}
    >
      <Icon className="size-4" strokeWidth={2.5} aria-hidden="true" />
    </span>
  )
}

function StopList({
  stops,
  activeId,
  withDate,
  onSeek,
}: {
  stops: Stop[]
  activeId: number | null
  withDate: boolean
  onSeek: (time: number) => void
}) {
  return (
    <section className="rounded-xl border bg-card shadow-sm">
      <h2 className="px-3 pt-3 text-sm text-muted-foreground">Остановки</h2>
      <ul className="max-h-56 overflow-y-auto overscroll-contain px-1 py-1">
        {stops.map((stop, index) => {
          const active = stop.id === activeId
          return (
            <li key={stop.id}>
              <button
                type="button"
                aria-current={active ? "true" : undefined}
                className={`grid w-full grid-cols-[2rem_minmax(3.5rem,auto)_1fr] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm tabular-nums hover:bg-muted ${
                  active ? "bg-muted font-medium text-foreground" : "text-foreground"
                }`}
                onClick={() => onSeek(stop.startTime)}
              >
                <span className="text-muted-foreground">{index + 1}</span>
                <span>{formatScaleClock(stop.startTime, withDate)}</span>
                <span className="text-right text-muted-foreground">
                  {formatStopDuration(stop.durationMs)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const GPX_ACCEPT = ".gpx,application/gpx+xml,application/xml,text/xml"

function isIos() {
  const ua = navigator.userAgent
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
}

function OpenGpxButton({
  onChange,
  size = "default",
  className,
}: {
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  size?: "default" | "lg"
  className?: string
}) {
  const [accept, setAccept] = useState(() => isIos() ? "" : GPX_ACCEPT)
  useEffect(() => {
    // No longer need to setAccept here
  }, [])

  return (
    <label className={cn(buttonVariants({ size }), "relative cursor-pointer", className)}>
      Открыть GPX
      {/* iOS Safari greys out .gpx when accept lists that extension, and it
          ignores a scripted click on a clipped input. The tap must hit the
          control itself. Desktop keeps the GPX filter. */}
      <input
        type="file"
        accept={accept || undefined}
        aria-label="Выбрать файл GPX"
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        onChange={onChange}
      />
    </label>
  )
}

function TapeGlyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-current">
      {children}
    </svg>
  )
}

function TapePlay() {
  return (
    <TapeGlyph>
      <polygon points="3,1.5 14,8 3,14.5" />
    </TapeGlyph>
  )
}

function TapePause() {
  return (
    <TapeGlyph>
      <rect x="2.5" y="1.5" width="3.5" height="13" rx="0.4" />
      <rect x="10" y="1.5" width="3.5" height="13" rx="0.4" />
    </TapeGlyph>
  )
}

function TapeRestart() {
  return (
    <TapeGlyph>
      <rect x="1.5" y="1.5" width="2.5" height="13" rx="0.4" />
      <polygon points="14.5,1.5 6,8 14.5,14.5" />
    </TapeGlyph>
  )
}

function TapeEject() {
  return (
    <TapeGlyph>
      <polygon points="8,1.5 15,9 1,9" />
      <rect x="1.5" y="11.5" width="13" height="2.5" rx="0.4" />
    </TapeGlyph>
  )
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}
