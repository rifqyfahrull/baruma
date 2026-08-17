"use client"

import * as React from "react"
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type FloatingPanelProps = {
  side: "left" | "right"
  title: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  storageKey: string
  widthClass?: string
  testId?: string
  bodyTestId?: string
  bodyClassName?: string
  minimizeLabel?: string
  /**
   * Forces the collapsed pill while true (e.g. clean/presentation mode).
   * Unlike a regular minimize, the user can temporarily re-expand the panel
   * by clicking the pill — the panel shows but forceMinimized stays true
   * (clean mode does not exit). Clicking the minimize button inside the
   * panel collapses it back to the forced pill. When forceMinimized becomes
   * false externally, the panel returns to the user's last minimized state.
   */
  forceMinimized?: boolean
  /**
   * Notifies the page when the panel expands/collapses so it can
   * reserve/reclaim space for content that cannot pan out from under the
   * overlay (e.g. the drawings sheet).
   */
  onMinimizedChange?: (minimized: boolean) => void
}

/**
 * Tab kecil untuk header FloatingPanel (mis. "Properti | Asisten Denah" di 2D,
 * "Kontrol | Asisten Interior" di 3D) — dipakai bersama agar kedua halaman
 * konsisten.
 */
export function PanelTab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // min-w-0 + truncate: the header shares its width with the Simpan control,
        // so tabs must shrink gracefully instead of overflowing onto it.
        "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted"
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0" />}
      <span className="truncate">{children}</span>
    </button>
  )
}

function readMinimized(storageKey: string): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(storageKey) === "1"
  } catch {
    return false
  }
}

function persistMinimized(storageKey: string, minimized: boolean): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(storageKey, minimized ? "1" : "0")
  } catch {
    // Ignore write failures (e.g. private mode / storage disabled).
  }
}

export function FloatingPanel({
  side,
  title,
  actions,
  children,
  storageKey,
  widthClass,
  testId,
  bodyTestId,
  bodyClassName,
  minimizeLabel,
  forceMinimized = false,
  onMinimizedChange,
}: FloatingPanelProps): React.JSX.Element {
  // Seeded lazily on the client; SSR renders expanded (typeof window guard).
  const [minimized, setMinimized] = React.useState<boolean>(() =>
    readMinimized(storageKey)
  )
  // tempOverride lets the user temporarily expand the panel while
  // forceMinimized is still true (e.g. peek at controls in clean mode
  // without exiting it). Clicking the pill sets it; clicking the internal
  // minimize button clears it and persists the minimized state.
  const [tempOverride, setTempOverride] = React.useState(false)

  // When forceMinimized is released externally (clean mode exited), reset
  // the temporary override so the panel smoothly gives control back.
  React.useEffect(() => {
    if (!forceMinimized) setTempOverride(false)
  }, [forceMinimized])

  const effectiveMinimized = forceMinimized ? !tempOverride : minimized

  // Report the initial state (incl. a localStorage-seeded "1") and every
  // toggle to the parent — after render, never during it.
  React.useEffect(() => {
    onMinimizedChange?.(effectiveMinimized)
  }, [effectiveMinimized, onMinimizedChange])

  const setAndPersist = React.useCallback(
    (next: boolean) => {
      setMinimized(next)
      persistMinimized(storageKey, next)
    },
    [storageKey]
  )

  const titleText = typeof title === "string" ? title : undefined
  const ariaLabel = minimizeLabel ?? titleText ?? "Panel"
  const pillText = titleText ?? minimizeLabel ?? "Panel"

  if (effectiveMinimized) {
    const PillIcon = side === "left" ? PanelLeftOpen : PanelRightOpen
    return (
      <button
        type="button"
        aria-label={`Buka ${ariaLabel}`}
        onClick={() => {
          if (forceMinimized) {
            setTempOverride(true)
          } else {
            setAndPersist(false)
          }
        }}
        className={cn(
          "absolute top-4 z-30 hidden items-center gap-2 rounded-full border bg-card/95 px-3 py-2 text-sm shadow-lg backdrop-blur lg:flex",
          side === "left" ? "left-4" : "right-4"
        )}
      >
        <PillIcon className="size-4" />
        <span className="max-w-[10rem] truncate">{pillText}</span>
      </button>
    )
  }

  const MinimizeIcon = side === "left" ? PanelLeftClose : PanelRightClose
  return (
    <aside
      data-testid={testId}
      className={cn(
        // max-h backstops inset-y-4: if an ancestor's height ever resolves taller
        // than the viewport (e.g. a flex parent missing min-h-0), inset-y alone
        // would let the panel grow past the screen. Capping height here keeps
        // the panel on-screen and forces its own body to scroll instead of the
        // page.
        "absolute inset-y-4 z-30 hidden max-h-[calc(100svh-2rem)] flex-col overflow-hidden rounded-lg border bg-card/95 shadow-2xl backdrop-blur lg:flex",
        side === "left" ? "left-4" : "right-4",
        widthClass ?? "w-[24rem]"
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">{title}</div>
        <div className="flex items-center gap-1">
          {actions}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Minimize ${ariaLabel}`}
            onClick={() => {
              if (forceMinimized) {
                // In forced mode, clicking minimize only clears the
                // temporary override — the user's persisted "minimized"
                // preference is not touched by clean-mode interactions.
                setTempOverride(false)
              } else {
                setAndPersist(true)
              }
            }}
          >
            <MinimizeIcon />
          </Button>
        </div>
      </div>
      <div
        data-testid={bodyTestId}
        className={cn("min-h-0 flex-1 overflow-y-auto p-3", bodyClassName)}
      >
        {children}
      </div>
    </aside>
  )
}
