"use client"

import * as React from "react"
import { Eye, EyeOff, Maximize, Minimize, UnfoldVertical } from "lucide-react"

import type { Floor } from "@/types"
import { usePreviewStore } from "@/stores/preview-store"
import { FloatingBar, FloatingBarSeparator } from "@/components/chrome/floating-bar"
import { Pill } from "@/components/chrome/pill"
import { ToolButton } from "@/components/chrome/tool-button"
import { SurfaceSwitcher } from "@/components/chrome/surface-switcher"

/**
 * Floating floor-visibility switcher over the 3D canvas — styled like the 2D
 * editor's floor tabs, but each pill TOGGLES that floor's visibility (several
 * can be on at once — soft/multi-select semantics, deliberately different
 * from the 2D `FloorSwitcher`'s exclusive tabs, distinguished by the eye
 * affordance). Next to it: exploded-view toggle (UnfoldVertical — the old
 * Expand icon read as "maximize") and a REAL fullscreen toggle.
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
    <FloatingBar orientation="horizontal" data-testid="floor-toggle-bar">
      <SurfaceSwitcher />
      <FloatingBarSeparator />
      {floors.map((floor) => {
        const visible = visibleFloors[floor.id] ?? true
        return (
          <Pill
            key={floor.id}
            pressed={visible}
            exclusive={false}
            label={visible ? `Sembunyikan ${floor.name}` : `Tampilkan ${floor.name}`}
            trailingIcon={visible ? <Eye /> : <EyeOff />}
            onClick={() => toggleFloor(floor.id)}
          >
            {floor.name}
          </Pill>
        )
      })}

      <FloatingBarSeparator />

      <ToolButton
        label="Exploded view — pisahkan antar lantai"
        pressed={exploded}
        exclusive={false}
        onClick={() => setExploded(!exploded)}
      >
        <UnfoldVertical />
      </ToolButton>

      <ToolButton
        label={isFullscreen ? "Keluar layar penuh" : "Layar penuh"}
        pressed={isFullscreen}
        exclusive={false}
        data-testid="fullscreen-toggle"
        onClick={toggleFullscreen}
      >
        {isFullscreen ? <Minimize /> : <Maximize />}
      </ToolButton>
    </FloatingBar>
  )
}
