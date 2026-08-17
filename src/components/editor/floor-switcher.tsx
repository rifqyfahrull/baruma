"use client"

import { AlignEndHorizontal, Home, Layers, Plus, Trash2 } from "lucide-react"

import { useEditorStore, ROOF_LAYER_ID } from "@/stores/editor-store"
import { isMezzanineFloor, isRegularFloor } from "@/lib/editor/floors"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function FloorSwitcher() {
  const floors = useEditorStore((s) => s.layout?.floors ?? [])
  const selectedFloorId = useEditorStore((s) => s.selectedFloorId)
  const setSelectedFloor = useEditorStore((s) => s.setSelectedFloor)
  const addFloor = useEditorStore((s) => s.addFloor)
  const addMezzanine = useEditorStore((s) => s.addMezzanine)
  const removeFloor = useEditorStore((s) => s.removeFloor)
  const alignFloorToReference = useEditorStore((s) => s.alignFloorToReference)

  if (floors.length === 0) return null

  // "+ Mezz" hanya utk lantai aktif REGULER yang belum ber-mezzanine
  // (lantai tepat setelahnya di array bukan kind mezzanine).
  const activeIdx = floors.findIndex((f) => f.id === selectedFloorId)
  const activeFloor = activeIdx >= 0 ? floors[activeIdx] : undefined
  const canAddMezzanine =
    !!activeFloor &&
    isRegularFloor(activeFloor) &&
    !(floors[activeIdx + 1] && isMezzanineFloor(floors[activeIdx + 1]))

  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card/95 p-1 shadow-sm backdrop-blur">
      <Layers className="ml-1 size-3.5 text-muted-foreground" />
      {floors.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => setSelectedFloor(f.id)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            f.id === selectedFloorId ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          )}
        >
          {f.name}
        </button>
      ))}
      {/* Layer denah ATAP — lembar tersendiri (konvensi roof plan arsitek):
          zona atap hanya diedit di sini; ruang tampil sebagai ghost. */}
      <button
        type="button"
        onClick={() => setSelectedFloor(ROOF_LAYER_ID)}
        data-testid="floor-tab-atap"
        className={cn(
          "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
          selectedFloorId === ROOF_LAYER_ID
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted"
        )}
      >
        <Home className="size-3" />
        Atap
      </button>
      {floors.length > 1 && selectedFloorId !== ROOF_LAYER_ID && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Samakan footprint"
              title="Samakan footprint dengan lantai lain"
              className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted"
            >
              <AlignEndHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {floors
              .filter((f) => f.id !== selectedFloorId)
              .map((f) => (
                <DropdownMenuItem
                  key={f.id}
                  onClick={() => {
                    if (!selectedFloorId) return
                    const summary = alignFloorToReference(selectedFloorId, f.id)
                    if (!summary) {
                      window.alert("Tidak ada perubahan (footprint sudah sejajar atau lantai kosong).")
                    } else {
                      window.alert(
                        `Samakan footprint ke ${f.name}: ${summary.grown.length} dilebarkan, ` +
                          `${summary.shrunk.length} disusutkan, ${summary.removed.length} dihapus.`,
                      )
                    }
                  }}
                >
                  Samakan dengan {f.name}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button
        type="button"
        onClick={() => addFloor()}
        aria-label="Tambah lantai"
        title="Tambah lantai"
        className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted"
      >
        <Plus className="size-4" />
      </button>
      {canAddMezzanine && (
        <button
          type="button"
          onClick={() => {
            if (selectedFloorId) addMezzanine(selectedFloorId)
          }}
          data-testid="add-mezzanine"
          title="Tambah mezzanine di lantai aktif"
          className="rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
        >
          + Mezz
        </button>
      )}
      {floors.length > 1 && selectedFloorId !== ROOF_LAYER_ID && (
        <button
          type="button"
          onClick={() => {
            const f = floors.find((x) => x.id === selectedFloorId)
            if (f && window.confirm(`Hapus ${f.name} beserta ruang di dalamnya?`)) removeFloor(f.id)
          }}
          aria-label="Hapus lantai aktif"
          title="Hapus lantai aktif"
          className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
  )
}
