"use client"

import * as React from "react"
import { Eye, EyeOff, Maximize, Minimize, UnfoldVertical } from "lucide-react"

import type { Floor } from "@/types"
import { usePreviewStore } from "@/stores/preview-store"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Floating floor-visibility switcher over the 3D canvas — styled like the 2D
 * editor's floor tabs, but each pill TOGGLES that floor's visibility (several
 * can be on at once). Next to it: exploded-view toggle (UnfoldVertical — the
 * old Expand icon read as "maximize") and a REAL fullscreen toggle.
 */
export function FloorToggleBar({ floors }: { floors: Floor[] }) {
  const visibleFloors = usePreviewStore((s) => s.visibleFloors)
  const toggleFloor = usePreviewStore((s) => s.toggleFloor)
  const exploded = usePreviewStore((s) => s.exploded)
  const setExploded = usePreviewStore((s) => s.setExploded)

  // Fullscreen seluruh halaman (documentElement): popover/tooltip Radix
  // portal ke <body> — fullscreen pada sub-elemen akan menyembunyikannya.
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  React.useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.()
  }

  return (
    <div
      data-testid="floor-toggle-bar"
      className="flex items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur"
    >
      {floors.map((floor) => {
        const visible = visibleFloors[floor.id] ?? true
        return (
          <button
            key={floor.id}
            type="button"
            onClick={() => toggleFloor(floor.id)}
            aria-pressed={visible}
            title={visible ? `Sembunyikan ${floor.name}` : `Tampilkan ${floor.name}`}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              visible ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted"
            )}
          >
            {floor.name}
            {visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
        )
      })}

      <div className="mx-0.5 h-5 w-px bg-border" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant={exploded ? "default" : "ghost"}
            className="size-7"
            aria-pressed={exploded}
            aria-label="Exploded view"
            onClick={() => setExploded(!exploded)}
          >
            <UnfoldVertical />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Exploded view — pisahkan antar lantai</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? "Keluar layar penuh" : "Layar penuh"}
            data-testid="fullscreen-toggle"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize /> : <Maximize />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isFullscreen ? "Keluar layar penuh" : "Layar penuh"}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
