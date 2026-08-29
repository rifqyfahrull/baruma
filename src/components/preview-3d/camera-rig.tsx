"use client"

import * as React from "react"
import { floorElevations } from "@/lib/geometry/vertical"
import { useThree } from "@react-three/fiber"

import type { DesignLayout } from "@/types"
import { usePreviewStore, type ViewPreset } from "@/stores/preview-store"
import { EXPLODE_GAP, SLAB_T, WALL_H } from "@/lib/three/build-model"

type OrbitLike = {
  target: { set: (x: number, y: number, z: number) => void }
  update: () => void
}

export function CameraRig({
  site,
  height,
  layout,
}: {
  site: { widthM: number; depthM: number }
  height: number
  layout: DesignLayout
}) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null
  // frameloop="demand": gerakan kamera imperatif (di luar interaksi
  // OrbitControls) tidak otomatis memicu render — wajib invalidate() manual.
  const invalidate = useThree((s) => s.invalidate)
  const viewNonce = usePreviewStore((s) => s.viewNonce)
  const viewPreset = usePreviewStore((s) => s.viewPreset)
  const focusNonce = usePreviewStore((s) => s.focusNonce)
  const interiorViewNonce = usePreviewStore((s) => s.interiorViewNonce)

  const dist = Math.max(site.widthM, site.depthM) * 1.5 + height * 0.5 + 4

  React.useEffect(() => {
    if (!controls) return
    apply(viewPreset, camera, controls, dist, height)
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewNonce, controls])

  // Fly-to-room (room-list click): frame the room from a high iso angle so the
  // user looks INTO it — pairs with the caller hiding the floors above.
  React.useEffect(() => {
    if (!controls) return
    const { focusRoomId, exploded } = usePreviewStore.getState()
    const room = focusRoomId ? layout.rooms.find((r) => r.id === focusRoomId) : null
    if (!room) return
    const e = floorElevations(layout.floors).get(room.floorId)
    const baseY = e ? e.baseY + e.index * (exploded ? EXPLODE_GAP : 0) : 0
    const tx = room.x + room.width / 2 - site.widthM / 2
    const tz = room.y + room.depth / 2 - site.depthM / 2
    const ty = baseY + SLAB_T + 0.8
    const r = Math.max(room.width, room.depth) * 1.35 + 2.2
    camera.position.set(tx + r * 0.72, ty + r * 1.05, tz + r * 0.72)
    controls.target.set(tx, ty, tz)
    controls.update()
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, controls])

  // Interior AI-render placement (Fase B): puts the camera INSIDE the room,
  // eye-level, looking at its center — unlike fly-to-room (frames it from a
  // high angle looking IN), this shot is what a person standing inside the
  // room would see.
  React.useEffect(() => {
    if (!controls) return
    const { interiorViewRoomId, exploded } = usePreviewStore.getState()
    const room = interiorViewRoomId ? layout.rooms.find((r) => r.id === interiorViewRoomId) : null
    if (!room) return
    const e = floorElevations(layout.floors).get(room.floorId)
    const baseY = e ? e.baseY + e.index * (exploded ? EXPLODE_GAP : 0) : 0
    const cx = room.x + room.width / 2 - site.widthM / 2
    const cz = room.y + room.depth / 2 - site.depthM / 2
    // Half-diagonal vector of the room's rectangle — camera sits near one
    // corner (35% of the way from center) so it looks across the room
    // instead of straight into a wall.
    const dx = room.width / 2
    const dz = room.depth / 2
    camera.position.set(cx - dx * 0.35, baseY + SLAB_T + 1.5, cz - dz * 0.35)
    controls.target.set(cx, baseY + SLAB_T + 1.3, cz)
    controls.update()
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interiorViewNonce, controls])

  return null
}

function apply(
  preset: ViewPreset,
  camera: { position: { set: (x: number, y: number, z: number) => void } },
  controls: OrbitLike,
  d: number,
  height: number
) {
  let pos: [number, number, number]
  let target: [number, number, number]
  switch (preset) {
    case "front":
      pos = [0, height * 0.5, d * 1.25]
      target = [0, height * 0.4, 0]
      break
    case "top":
      pos = [0.001, d * 1.9, 0.001]
      target = [0, 0, 0]
      break
    case "rooftop":
      pos = [d * 0.45, height * 1.4, d * 0.45]
      target = [0, height * 0.7, 0]
      break
    case "iso":
    default:
      pos = [d * 0.85, d * 0.7, d * 0.85]
      target = [0, height * 0.35, 0]
      break
  }
  camera.position.set(...pos)
  controls.target.set(...target)
  controls.update()
}
