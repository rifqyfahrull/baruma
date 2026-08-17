"use client"

/**
 * Dialog "Tambah ruang di sini" — muncul dari klik-kanan / Ctrl+klik area
 * kosong. Menampilkan ukuran CELAH terdeteksi (emptyRectAt) dan membuat ruang
 * PAS mengisinya via addRoomInRect (dimensi di-clamp MIN_ROOM 1,2 m). Default
 * tipe = Koridor karena kasus utamanya: menaruh koridor di celah antar kamar.
 */

import * as React from "react"

import type { RoomType } from "@/types"
import type { Rect } from "@/lib/geometry"
import { ROOM_TYPES } from "@/lib/constants"
import { useEditorStore } from "@/stores/editor-store"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const MIN_ROOM = 1.2

export function AddRoomAtDialog({
  rect,
  onClose,
}: {
  rect: Rect | null
  onClose: () => void
}) {
  const addRoomInRect = useEditorStore((s) => s.addRoomInRect)
  const [type, setType] = React.useState<RoomType>("koridor")

  const open = rect !== null
  const w = rect ? Math.max(MIN_ROOM, rect.width) : 0
  const d = rect ? Math.max(MIN_ROOM, rect.depth) : 0
  const clamped = rect ? rect.width < MIN_ROOM || rect.depth < MIN_ROOM : false

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Tambah ruang di sini</DialogTitle>
          <DialogDescription>
            Ruang baru dipasang mengisi celah yang terdeteksi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Tipe ruang</label>
            <Select value={type} onValueChange={(v) => setType(v as RoomType)}>
              <SelectTrigger className="w-full" aria-label="Tipe ruang">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROOM_TYPES) as RoomType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {ROOM_TYPES[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md bg-muted/50 p-2 text-xs">
            Ukuran: <span className="font-medium">{w.toFixed(2)} × {d.toFixed(2)} m</span>
            {clamped && (
              <p className="mt-1 text-warning">
                Celah lebih kecil dari 1,2 m — digenapkan ke minimum. Kecilkan
                ruang tetangga bila ingin lebih ramping.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button
            onClick={() => {
              if (rect) addRoomInRect(type, rect)
              onClose()
            }}
          >
            Tambah {ROOM_TYPES[type].label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
