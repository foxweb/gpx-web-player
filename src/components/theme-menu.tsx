"use client"

import { Check, Monitor, Moon, Sun } from "lucide-react"
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { applyTheme, readTheme, type ThemeChoice } from "@/lib/theme"

const OPTIONS: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Светлая", icon: Sun },
  { id: "dark", label: "Тёмная", icon: Moon },
  { id: "system", label: "Как в системе", icon: Monitor },
]

export function ThemeMenu() {
  const [choice, setChoice] = useState<ThemeChoice>("system")
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useLayoutEffect(() => {
    const stored = readTheme()
    setChoice(stored)
    applyTheme(stored)
  }, [])

  useEffect(() => {
    if (choice !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => applyTheme("system")
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [choice])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  function select(next: ThemeChoice) {
    setChoice(next)
    applyTheme(next)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="outline"
        size="lg"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Тема оформления"
        onClick={() => setOpen((value) => !value)}
      >
        Тема
      </Button>
      {open && (
        <ul
          id={menuId}
          role="listbox"
          aria-label="Тема оформления"
          className="absolute right-0 z-30 mt-2 w-48 rounded-xl border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {OPTIONS.map((option) => {
            const Icon = option.icon
            const selected = choice === option.id
            return (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  onClick={() => select(option.id)}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1">{option.label}</span>
                  {selected ? <Check className="size-4 shrink-0" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
