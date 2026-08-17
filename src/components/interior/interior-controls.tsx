"use client"

import { toast } from "sonner"

import type {
  InteriorSurface,
  MaterialAssignment,
  MaterialItem,
  Room,
  RoomInteriorPlan,
} from "@/types"
import {
  INTERIOR_STYLES,
  MATERIAL_LIBRARY,
  getMaterial,
} from "@/lib/interior/presets"
import { useInteriorStore } from "@/stores/interior-store"
import { track } from "@/lib/analytics"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Kontrol interior yang dipakai bersama oleh preview-3d (panel kompak) dan
// workspace interior. Sengaja file leaf — JANGAN impor interior-workspace /
// interior-room-scene dari sini, itu menyeret Canvas three ke bundle pemakai.

export function InteriorStyleSelector({
  value,
  onChange,
  compact,
}: {
  value: string
  onChange: (style: typeof INTERIOR_STYLES[number]["id"]) => void
  compact?: boolean
}) {
  const active = INTERIOR_STYLES.find((s) => s.id === value)

  // Compact (panel preview-3d): swatch grid 2 kolom — deskripsi pindah ke
  // tooltip + baris deskripsi style AKTIF saja, bukan kartu besar per style.
  if (compact) {
    return (
      <div className="space-y-1.5" data-testid="preview-style-selector">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">Style interior — semua ruang</p>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {INTERIOR_STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              title={style.description}
              aria-pressed={value === style.id}
              onClick={() => {
                onChange(style.id)
                track("interior_style_selected", { style: style.id })
              }}
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors",
                value === style.id ? "border-primary bg-primary/10" : "bg-background hover:bg-muted"
              )}
            >
              <ColorDots colors={[style.colors.primary, style.colors.secondary, style.colors.accent]} />
              <span className="truncate text-xs font-medium">{style.name}</span>
            </button>
          ))}
        </div>
        {active && (
          <p className="text-[11px] leading-snug text-muted-foreground">{active.description}</p>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Style interior</h3>
          <p className="text-xs leading-snug text-muted-foreground">
            Terapkan style ke semua ruangan dan hitung ulang palette + budget.
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {INTERIOR_STYLES.map((style) => (
          <button
            key={style.id}
            type="button"
            onClick={() => {
              onChange(style.id)
              track("interior_style_selected", { style: style.id })
            }}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors",
              value === style.id
                ? "border-primary bg-primary/10"
                : "bg-background hover:bg-muted"
            )}
          >
            <span className="flex items-center gap-2">
              <ColorDots colors={[style.colors.primary, style.colors.secondary, style.colors.accent]} />
              <span className="text-sm font-medium">{style.name}</span>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {style.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function RoomMaterialEditor({
  room,
  roomPlan,
  compact = false,
}: {
  room: Room
  roomPlan: RoomInteriorPlan
  compact?: boolean
}) {
  const updateMaterial = useInteriorStore((s) => s.updateMaterial)

  return (
    <div className={cn("space-y-2", !compact && "rounded-lg border bg-background p-3")}>
      {roomPlan.materials.map((assignment) => {
        const options = materialOptionsFor(assignment, room.type)
        return (
          <div key={assignment.id} className={cn("space-y-1.5", compact && "rounded-md border p-2")}>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                {surfaceName(assignment.surface)}
              </label>
              <span className="text-[11px] text-muted-foreground">{assignment.areaM2} m2</span>
            </div>
            <Select
              value={assignment.materialId}
              onValueChange={(materialId) => {
                updateMaterial(room.id, assignment.surface, materialId)
                toast.success(`${surfaceName(assignment.surface)} ${room.name} diganti ke ${getMaterial(materialId)?.name ?? materialId}.`)
              }}
            >
              <SelectTrigger
                aria-label={`Material ${surfaceName(assignment.surface)} ${room.name}`}
                className={compact ? "h-8 text-xs" : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((material) => (
                  <SelectItem key={material.id} value={material.id}>
                    {material.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      })}
    </div>
  )
}

export function ColorDots({ colors }: { colors: string[] }) {
  return (
    <span className="flex -space-x-1">
      {colors.map((color) => (
        <span
          key={color}
          className="size-4 rounded-full border border-background"
          style={{ background: color }}
        />
      ))}
    </span>
  )
}

const MATERIAL_CATEGORIES_BY_SURFACE: Record<InteriorSurface, MaterialItem["category"][]> = {
  floor: ["floor", "bathroom_tile", "outdoor_decking"],
  wall: ["wall_paint", "wall_panel", "bathroom_tile", "backsplash"],
  ceiling: ["ceiling"],
  accent: ["wall_panel", "wall_paint", "bathroom_tile", "backsplash"],
}

function materialOptionsFor(
  assignment: MaterialAssignment,
  roomType: Room["type"]
): MaterialItem[] {
  const categories = MATERIAL_CATEGORIES_BY_SURFACE[assignment.surface]
  const matchingRoom = MATERIAL_LIBRARY.filter(
    (item) => categories.includes(item.category) && item.suitableRooms.includes(roomType)
  )
  const matchingSurface = MATERIAL_LIBRARY.filter((item) => categories.includes(item.category))
  const options = matchingRoom.length > 0 ? matchingRoom : matchingSurface
  const current = MATERIAL_LIBRARY.find((item) => item.id === assignment.materialId)

  if (!current || options.some((item) => item.id === current.id)) return options
  return [current, ...options]
}

export function surfaceName(surface: string): string {
  if (surface === "floor") return "Lantai"
  if (surface === "wall") return "Dinding"
  if (surface === "ceiling") return "Plafon"
  return "Aksen"
}
