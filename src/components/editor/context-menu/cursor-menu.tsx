"use client"

/**
 * Menu klik-kanan terkontrol penuh — dirender di portal pada posisi `fixed`
 * (titik klik). Menggantikan Radix ContextMenu untuk editor karena satu trigger
 * besar (svg/canvas) berisi banyak entity: Radix tak andal me-reposisi menu ke
 * elemen lain saat klik-kanan kedua. Di sini posisi & isi 100% dikendalikan
 * host → klik-kanan B memindah menu + mengganti item secara deterministik.
 *
 * Tutup pada: klik di luar, Esc, scroll, resize, blur window. Klik-kanan kedua
 * (di manapun) memicu onContextMenu host lagi → host mengeset ulang open+posisi.
 */

import * as React from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"
import type { MenuAction } from "./action-registry"

export type CursorMenuState = { open: boolean; x: number; y: number }

export function EditorCursorMenu({
  state,
  items,
  onClose,
}: {
  state: CursorMenuState
  items: MenuAction[]
  onClose: () => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState({ left: state.x, top: state.y })

  // Jepit ke dalam viewport setelah ukuran diketahui.
  React.useLayoutEffect(() => {
    if (!state.open) return
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    const left = Math.max(pad, Math.min(state.x, window.innerWidth - width - pad))
    const top = Math.max(pad, Math.min(state.y, window.innerHeight - height - pad))
    setPos({ left, top })
  }, [state.open, state.x, state.y, items.length])

  React.useEffect(() => {
    if (!state.open) return
    const close = () => onClose()
    const onDown = (e: PointerEvent | MouseEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    // pointerdown menutup pada interaksi berikutnya; klik-kanan berikut memicu
    // onContextMenu host yang membuka ulang di posisi baru.
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey, true)
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close, true)
    window.addEventListener("blur", close)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey, true)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close, true)
      window.removeEventListener("blur", close)
    }
  }, [state.open, onClose])

  if (!state.open || typeof document === "undefined") return null

  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-slot="editor-cursor-menu"
      className="fixed z-50 min-w-44 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.length ? (
        items.map((a, i) => {
          const Icon = a.icon
          return (
            <React.Fragment key={a.id}>
              {a.danger && i > 0 && <div className="-mx-1 my-1 h-px bg-border" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  a.run()
                  onClose()
                }}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground pointer-coarse:py-2.5 [&_svg]:size-4 [&_svg]:shrink-0",
                  a.danger &&
                    "text-destructive hover:bg-destructive/10 hover:text-destructive",
                )}
              >
                {Icon && <Icon />}
                {a.label}
              </button>
            </React.Fragment>
          )
        })
      ) : (
        <div className="px-1.5 py-1.5 text-sm text-muted-foreground">Tak ada aksi</div>
      )}
    </div>,
    document.body,
  )
}
