"use client"

import { useEffect, useRef } from "react"
import "leaflet/dist/leaflet.css"
import type { Stop, TrackPoint } from "@/lib/gpx"
import { nearestOnTrack } from "@/lib/gpx"
import { formatStopDuration } from "@/lib/format"
import { followCameraStep } from "@/lib/geo"
import { SPEED_BANDS, trackSpeedRuns } from "@/lib/speed"

type Cursor = {
  lat: number
  lon: number
  zoom: number
}

type TrackMapProps = {
  points: TrackPoint[]
  stops: Stop[]
  cursor: Cursor
  follow: boolean
  /** Bumps when the user moves the cursor from the scrubber, elevation chart, or keys. */
  recenterToken: number
  /** Local GPS clock drawn beside the cursor. */
  clockLabel: string
  onSeek: (time: number) => void
  onStopSeek: (time: number) => void
  onFollowOff: () => void
}

const CLICK_THRESHOLD_PX = 22
const STOP_CLICK_PX = 16

export default function TrackMap({
  points,
  stops,
  cursor,
  follow,
  recenterToken,
  clockLabel,
  onSeek,
  onStopSeek,
  onFollowOff,
}: TrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pointsRef = useRef(points)
  const cursorRef = useRef(cursor)
  const onSeekRef = useRef(onSeek)
  const onStopSeekRef = useRef(onStopSeek)
  const onFollowOffRef = useRef(onFollowOff)
  const clockRef = useRef(clockLabel)
  const followRef = useRef(follow)
  const draggingMarkerRef = useRef(false)
  const jumpRef = useRef(true)
  const applyingCameraRef = useRef(false)
  const recenterTokenRef = useRef(recenterToken)
  const pendingRecenterRef = useRef(false)

  pointsRef.current = points
  cursorRef.current = cursor
  onSeekRef.current = onSeek
  onStopSeekRef.current = onStopSeek
  onFollowOffRef.current = onFollowOff
  clockRef.current = clockLabel
  followRef.current = follow

  useEffect(() => {
    jumpRef.current = true
  }, [points])

  useEffect(() => {
    if (follow) jumpRef.current = true
  }, [follow])

  useEffect(() => {
    if (recenterTokenRef.current === recenterToken) return
    recenterTokenRef.current = recenterToken
    pendingRecenterRef.current = true
  }, [recenterToken])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let cleanup = () => {}

    void import("leaflet").then((L) => {
      if (cancelled || !containerRef.current) return

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        zoomSnap: 0,
        zoomDelta: 0.5,
        preferCanvas: true,
        fadeAnimation: false,
      })
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
        // Keep loading while the camera pans. A fade would hide tiles that
        // arrive during motion, and a larger buffer fetches the next screen
        // before the view reaches it.
        updateWhenIdle: false,
        updateWhenZooming: false,
        updateInterval: 100,
        keepBuffer: 3,
      }).addTo(map)

      const applyCamera = (lat: number, lon: number, zoom: number) => {
        applyingCameraRef.current = true
        map.setView([lat, lon], zoom, { animate: false })
        applyingCameraRef.current = false
      }

      const releaseFollow = () => {
        if (!followRef.current) return
        followRef.current = false
        onFollowOffRef.current()
      }

      const first = cursorRef.current
      applyCamera(first.lat, first.lon, first.zoom)

      let trackLayer: import("leaflet").LayerGroup | null = null
      let cursorMarker: import("leaflet").Marker | null = null

      const drawTrack = () => {
        trackLayer?.remove()
        const group = L.layerGroup().addTo(map)
        const points = pointsRef.current
        L.polyline(
          points.map((point) => [point.lat, point.lon]),
          {
            color: "#ffffff",
            weight: 6,
            opacity: 0.9,
            lineCap: "round",
            lineJoin: "round",
            interactive: false,
          },
        ).addTo(group)
        for (const run of trackSpeedRuns(points)) {
          L.polyline(run.positions, {
            color: run.color,
            weight: 4,
            opacity: 0.95,
            lineCap: "round",
            lineJoin: "round",
            interactive: false,
          }).addTo(group)
        }

        for (const stop of stops) {
          const icon = L.divIcon({
            className: "stop-marker",
            html: `<div class="stop-marker-inner"><span class="stop-marker-dot"></span><span class="stop-marker-label">${escapeHtml(formatStopDuration(stop.durationMs))}</span></div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          })
          L.marker([stop.lat, stop.lon], { icon, interactive: false, keyboard: false }).addTo(
            group,
          )
        }
        trackLayer = group
      }

      const ensureCursor = () => {
        if (cursorMarker) return cursorMarker
        const icon = L.divIcon({
          className: "cursor-marker",
          html: `<span class="cursor-marker-dot"></span><span class="cursor-marker-clock">${escapeHtml(clockRef.current)}</span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        })
        const current = cursorRef.current
        cursorMarker = L.marker([current.lat, current.lon], {
          icon,
          draggable: true,
          zIndexOffset: 1000,
          autoPan: false,
        }).addTo(map)

        cursorMarker.on("dragstart", () => {
          draggingMarkerRef.current = true
        })
        cursorMarker.on("drag", () => {
          if (!cursorMarker) return
          const ll = cursorMarker.getLatLng()
          const hit = nearestOnTrack(pointsRef.current, ll.lat, ll.lng)
          cursorMarker.setLatLng([hit.lat, hit.lon])
          onSeekRef.current(hit.time)
        })
        cursorMarker.on("dragend", () => {
          draggingMarkerRef.current = false
          const current = cursorRef.current
          cursorMarker?.setLatLng([current.lat, current.lon])
        })
        return cursorMarker
      }

      drawTrack()
      ensureCursor()

      const onClick = (event: import("leaflet").LeafletMouseEvent) => {
        const clickPoint = map.latLngToContainerPoint(event.latlng)
        let stopHit: (typeof stops)[number] | null = null
        let stopPixels = STOP_CLICK_PX
        for (const stop of stops) {
          const point = map.latLngToContainerPoint([stop.lat, stop.lon])
          const pixels = Math.hypot(point.x - clickPoint.x, point.y - clickPoint.y)
          if (pixels <= stopPixels) {
            stopPixels = pixels
            stopHit = stop
          }
        }
        if (stopHit) {
          onStopSeekRef.current(stopHit.startTime)
          return
        }
        const hit = nearestOnTrack(
          pointsRef.current,
          event.latlng.lat,
          event.latlng.lng,
        )
        const hitPoint = map.latLngToContainerPoint([hit.lat, hit.lon])
        const pixels = Math.hypot(hitPoint.x - clickPoint.x, hitPoint.y - clickPoint.y)
        if (pixels <= CLICK_THRESHOLD_PX) onSeekRef.current(hit.time)
      }

      map.on("click", onClick)
      map.on("dragstart", () => {
        if (draggingMarkerRef.current) return
        releaseFollow()
      })
      let cameraZoom = false
      map.on("zoomstart", () => {
        if (applyingCameraRef.current || cameraZoom) return
        releaseFollow()
      })
      map.on("zoomend", () => {
        cameraZoom = false
      })

      const resize = new ResizeObserver(() => {
        map.invalidateSize()
      })
      resize.observe(container)

      let frame = 0
      let last = performance.now()
      let lastZoomAt = 0
      let prunedAt = 0
      let accX = 0
      let accY = 0
      const step = (now: number) => {
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
        last = now
        const target = cursorRef.current
        if (cursorMarker) {
          if (!draggingMarkerRef.current) {
            const ll = cursorMarker.getLatLng()
            if (ll.lat !== target.lat || ll.lng !== target.lon) {
              cursorMarker.setLatLng([target.lat, target.lon])
            }
          }
          const clock = cursorMarker.getElement()?.querySelector(".cursor-marker-clock")
          if (clock && clock.textContent !== clockRef.current) {
            clock.textContent = clockRef.current
          }
        }
        if (pendingRecenterRef.current && !draggingMarkerRef.current) {
          pendingRecenterRef.current = false
          map.panTo([target.lat, target.lon], { animate: false })
          accX = 0
          accY = 0
        } else if (followRef.current && !draggingMarkerRef.current) {
          if (jumpRef.current) {
            // One hard jump when follow starts. After that, panBy keeps the
            // loaded tiles: setView every frame fires viewprereset and drops them.
            applyCamera(target.lat, target.lon, target.zoom)
            jumpRef.current = false
            accX = 0
            accY = 0
            lastZoomAt = now
          } else if (!cameraZoom) {
            const center = map.getCenter()
            const cursorPoint = map.latLngToContainerPoint([target.lat, target.lon])
            const centerPoint = map.latLngToContainerPoint(center)
            const size = map.getSize()
            const currentZoom = map.getZoom()
            const tooClose = currentZoom - target.zoom >= 1
            const motion = followCameraStep({
              offsetX: cursorPoint.x - centerPoint.x,
              offsetY: cursorPoint.y - centerPoint.y,
              zoom: currentZoom,
              targetZoom: target.zoom,
              dt,
              minSize: Math.min(size.x, size.y),
              // A close view after a stop cannot wait out the usual zoom
              // cooldown: at high playback the cursor leaves the screen first.
              allowZoom: tooClose || now - lastZoomAt >= 700,
            })
            accX += motion.panX
            accY += motion.panY
            const panX = Math.trunc(accX)
            const panY = Math.trunc(accY)
            if (panX !== 0 || panY !== 0) {
              accX -= panX
              accY -= panY
              map.panBy([panX, panY], { animate: false })
            }
            if (motion.zoom != null) {
              cameraZoom = true
              lastZoomAt = now
              map.setZoom(motion.zoom)
            }
            if (now - prunedAt >= 2000) {
              prunedAt = now
              const layer = tiles as { _pruneTiles?: () => void }
              layer._pruneTiles?.()
            }
          }
        }
        frame = window.requestAnimationFrame(step)
      }
      frame = window.requestAnimationFrame(step)

      cleanup = () => {
        window.cancelAnimationFrame(frame)
        resize.disconnect()
        map.remove()
      }
    })

    return () => {
      cancelled = true
      cleanup()
    }
    // Stops and the track geometry are redrawn when the file changes.
    // Cursor motion is applied by the animation loop, not by recreating the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, stops])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="leaflet-map h-full w-full" />
      <div className="pointer-events-none absolute bottom-6 left-2 z-[1100] flex max-w-[calc(100%-4.5rem)] flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-card/95 px-2 py-1 text-[11px] leading-4 text-foreground shadow-sm">
        <span className="text-muted-foreground">Скорость</span>
        {SPEED_BANDS.map((band) => (
          <span key={band.id} className="inline-flex items-center gap-1">
            <span
              className="inline-block size-2.5 rounded-full ring-1 ring-black/15"
              style={{ backgroundColor: band.color }}
            />
            {band.label}
          </span>
        ))}
        <span className="text-muted-foreground">км/ч</span>
      </div>
    </div>
  )
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
