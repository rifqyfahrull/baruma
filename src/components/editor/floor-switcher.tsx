"use client"

import { AlignEndHorizontal, Home, Layers, MoreHorizontal, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { useEditorStore, ROOF_LAYER_ID } from "@/stores/editor-store"
import { isMezzanineFloor, isRegularFloor } from "@/lib/editor/floors"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { FloatingBar, FloatingBarSeparator } from "@/components/chrome/floating-bar"
import { Pill } from "@/components/chrome/pill"
import { ToolButton } from "@/components/chrome/tool-button"
import { SurfaceSwitcher } from "@/components/chrome/surface-switcher"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  const confirm = useConfirm()

  if (floors.length === 0) return null

  // "+ Mezz" hanya utk lantai aktif REGULER yang belum ber-mezzanine
  // (lantai tepat setelahnya di array bukan kind mezzanine).
  const activeIdx = floors.findIndex((f) => f.id === selectedFloorId)
  const activeFloor = activeIdx >= 0 ? floors[activeIdx] : undefined
  const canAddMezzanine =
    !!activeFloor &&
    isRegularFloor(activeFloor) &&
    !(floors[activeIdx + 1] && isMezzanineFloor(floors[activeIdx + 1]))

  // Layer denah ATAP — lembar tersendiri (konvensi roof plan arsitek): zona
  // atap hanya diedit di sini; ruang tampil sebagai ghost. Aksi lantai
  // (samakan/hapus) tidak relevan di layer ini.
  const showFloorLevelActions = floors.length > 1 && selectedFloorId !== ROOF_LAYER_ID
  const showActionsMenu = showFloorLevelActions || canAddMezzanine

  const handleAlign = (target: { id: string; name: string }) => {
    if (!selectedFloorId) return
    const summary = alignFloorToReference(selectedFloorId, target.id)
    if (!summary) {
      toast.info("Tidak ada perubahan (footprint sudah sejajar atau lantai kosong).")
    } else {
      toast.success(
        `Samakan footprint ke ${target.name}: ${summary.grown.length} dilebarkan, ` +
          `${summary.shrunk.length} disusutkan, ${summary.removed.length} dihapus.`,
      )
    }
  }

  const handleRemove = async () => {
    const f = floors.find((x) => x.id === selectedFloorId)
    if (!f) return
    const ok = await confirm({
      title: `Hapus ${f.name}?`,
      description: "Ruang di dalamnya ikut terhapus.",
      confirmLabel: "Hapus",
      destructive: true,
    })
    if (ok) removeFloor(f.id)
  }

  return (
    <FloatingBar orientation="horizontal" data-testid="floor-switcher">
      <SurfaceSwitcher />
      <FloatingBarSeparator />
      <Layers className="ml-1 size-3.5 text-muted-foreground" />
      {floors.map((f) => (
        <Pill
          key={f.id}
          pressed={f.id === selectedFloorId}
          exclusive
          label={f.name}
          onClick={() => setSelectedFloor(f.id)}
        >
          {f.name}
        </Pill>
      ))}
      <Pill
        pressed={selectedFloorId === ROOF_LAYER_ID}
        exclusive
        icon={<Home className="size-3" />}
        label="Atap"
        data-testid="floor-tab-atap"
        onClick={() => setSelectedFloor(ROOF_LAYER_ID)}
      >
        Atap
      </Pill>

      {showActionsMenu && (
        <>
          <FloatingBarSeparator />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ToolButton label="Aksi lantai">
                <MoreHorizontal />
              </ToolButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {showFloorLevelActions && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <AlignEndHorizontal className="mr-2 size-4" />
                    Samakan footprint
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {floors
                      .filter((f) => f.id !== selectedFloorId)
                      .map((f) => (
                        <DropdownMenuItem key={f.id} onClick={() => handleAlign(f)}>
                          Samakan dengan {f.name}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuItem onClick={() => addFloor()}>
                <Plus className="mr-2 size-4" />
                Tambah lantai
              </DropdownMenuItem>
              {canAddMezzanine && (
                <DropdownMenuItem
                  data-testid="add-mezzanine"
                  onClick={() => {
                    if (selectedFloorId) addMezzanine(selectedFloorId)
                  }}
                >
                  <Plus className="mr-2 size-4" />+ Mezz
                </DropdownMenuItem>
              )}
              {showFloorLevelActions && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={handleRemove}>
                    <Trash2 className="mr-2 size-4" />
                    Hapus lantai aktif
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </FloatingBar>
  )
}
