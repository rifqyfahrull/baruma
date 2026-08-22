"use client"

/**
 * Daftar peringatan denah — Fase 6 (satu model "Cek"). Dulu ini isi popover
 * lonceng (`EditorWarningsPopover`, dihapus): kini dirender LANGSUNG sebagai
 * body tab "Cek" panel kanan (editor/page.tsx), di ATAS `DesignAuditCard`,
 * bukan lagi overlay Popover terpisah. Marker warning di kanvas 2D
 * (`plan-canvas.tsx`) memicu `useEditorPanelUiStore().focusWarning(objectId)`
 * → tab ini switch aktif + baris peringatan terkait di-scroll+highlight (lihat
 * efek `focusNonce` di bawah).
 *
 * Kontrak aksesibilitas dipertahankan dari popover lama (dipin e2e):
 * "Aksi peringatan" (tombol menu per-baris), "Detail Peringatan" (judul
 * dialog), "Simpan catatan", "Catatan peringatan".
 */

import * as React from "react"
import {
  CheckCheck,
  Info,
  MoreHorizontal,
  NotebookPen,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
} from "lucide-react"
import { toast } from "sonner"

import type { DesignLayout, Room, Severity, ValidationIssue } from "@/types"
import { useEditorStore } from "@/stores/editor-store"
import { useEditorPanelUiStore } from "@/stores/editor-panel-ui-store"
import { track } from "@/lib/analytics"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export type WarningPrefs = Record<string, { read?: boolean; note?: string }>

const severityIcon: Record<Severity, typeof Info> = {
  info: Info,
  warning: TriangleAlert,
  danger: ShieldAlert,
}

const severityColor: Record<Severity, string> = {
  info: "text-info",
  warning: "text-warning",
  danger: "text-destructive",
}

const severityLabel: Record<Severity, string> = {
  info: "Info",
  warning: "Perhatian",
  danger: "Kritis",
}

const categoryLabel: Record<ValidationIssue["category"], string> = {
  structural: "Struktur",
  spatial: "Tata ruang",
  cost: "Biaya",
  legal: "Legal",
  general: "Umum",
}

function issueObject(layout: DesignLayout, issue: ValidationIssue): Room | null {
  if (!issue.objectId) return null
  return layout.rooms.find((r) => r.id === issue.objectId) ?? null
}

function issueDetailRows(layout: DesignLayout, issue: ValidationIssue) {
  const room = issueObject(layout, issue)
  const floor = room ? layout.floors.find((f) => f.id === room.floorId) : null
  return [
    ["Tingkat", severityLabel[issue.level]],
    ["Kategori", categoryLabel[issue.category]],
    ["ID peringatan", issue.id],
    ...(room
      ? [
          ["Objek", room.name],
          ["Tipe ruang", room.type],
          ["Lantai", floor?.name ?? room.floorId],
          ["Posisi", `${room.x} m, ${room.y} m`],
          ["Ukuran", `${room.width} x ${room.depth} m (${room.areaM2} m2)`],
        ]
      : [["Objek", "Level project / tidak terikat objek tertentu"]]),
  ]
}

function issueDetailText(issue: ValidationIssue): string {
  if (issue.category === "structural") {
    return "Peringatan struktur berasal dari kalkulasi pendekatan Baruma. Anggap ini sebagai sinyal awal untuk review engineer, bukan persetujuan konstruksi."
  }
  if (issue.category === "spatial") {
    return "Peringatan tata ruang memeriksa geometri denah, batas lahan, overlap ruang, ventilasi, rooftop, dan instalasi sanitasi level lahan."
  }
  if (issue.category === "cost") {
    return "Peringatan biaya menandai asumsi RAB yang berpotensi berubah ketika material, volume, atau harga satuan diperinci."
  }
  if (issue.category === "legal") {
    return "Peringatan legal menandai hal yang biasanya perlu dicocokkan lagi dengan aturan PBG, sempadan, atau ketentuan lokal."
  }
  return "Peringatan ini adalah catatan umum yang perlu dicek sebelum desain dipakai untuk diskusi teknis lanjutan."
}

function assistantContextText(
  layout: DesignLayout,
  issue: ValidationIssue,
  note?: string
): string {
  const room = issueObject(layout, issue)
  const actionLine = issue.message.toLowerCase().includes("sumur resapan")
    ? "Aksi yang saya inginkan: pindahkan sumur resapan ke taman/halaman kosong yang tidak berada di bawah ruang tertutup."
    : "Aksi yang saya inginkan: bantu perbaiki peringatan ini dengan perubahan denah yang aman."
  const objectLine = room
    ? `Objek terkait: ${room.name} (${room.type}) di ${room.width} x ${room.depth} m, posisi ${room.x}, ${room.y}.`
    : "Objek terkait: level project / tidak spesifik ke satu ruang."
  const noteLine = note?.trim() ? `Catatan saya: ${note.trim()}` : ""
  return [
    actionLine,
    `Peringatan: ${issue.message}`,
    `Tingkat: ${severityLabel[issue.level]}. Kategori: ${categoryLabel[issue.category]}.`,
    objectLine,
    noteLine,
  ].filter(Boolean).join("\n")
}

// `useWarningPrefs` kini hidup di src/hooks/use-warning-prefs.ts (bukan di
// sini) — hook itu TIDAK mengimpor apa pun runtime dari file ini (hanya
// `type WarningPrefs`, dihapus saat compile) supaya badge unread-count di
// header panel (perlu tersedia SEBELUM tab "Cek" pernah dibuka) tak menyeret
// chunk berat file ini (DropdownMenu/Dialog/Textarea) ke first-load JS route
// editor. Panggil `useWarningPrefs` langsung dari situ.

export function EditorWarningsList({
  layout,
  issues,
  prefs,
  updateIssuePrefs,
  onAddToAiContext,
}: {
  layout: DesignLayout | null
  issues: ValidationIssue[]
  prefs: WarningPrefs
  updateIssuePrefs: (issueId: string, patch: WarningPrefs[string]) => void
  onAddToAiContext: (text: string) => void
}) {
  const selectObject = useEditorStore((s) => s.selectObject)
  const floorId = useEditorStore((s) => s.selectedFloorId)
  const setSelectedFloor = useEditorStore((s) => s.setSelectedFloor)

  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [noteDraft, setNoteDraft] = React.useState("")
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const [highlightId, setHighlightId] = React.useState<string | null>(null)
  const rowRefs = React.useRef<Map<string, HTMLLIElement>>(new Map())

  // Marker kanvas diklik (plan-canvas.tsx) → focusNonce naik → scroll+highlight
  // baris peringatan terkait objectId itu. Nonce (bukan objectId) sebagai dep
  // supaya klik marker yang SAMA berturut-turut tetap men-scroll ulang.
  const focusObjectId = useEditorPanelUiStore((s) => s.focusObjectId)
  const focusNonce = useEditorPanelUiStore((s) => s.focusNonce)
  React.useEffect(() => {
    if (!focusObjectId) return
    const match = issues.find((issue) =>
      issue.objectId
        ?.split(",")
        .map((id) => id.trim())
        .includes(focusObjectId)
    )
    if (!match) return
    const el = rowRefs.current.get(match.id)
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center", behavior: "smooth" })
    }
    setHighlightId(match.id)
    const t = window.setTimeout(() => setHighlightId(null), 1800)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nonce-driven, bukan value-driven
  }, [focusNonce])

  const detailIssue = issues.find((issue) => issue.id === detailId) ?? null

  const focusIssue = React.useCallback(
    (issue: ValidationIssue) => {
      if (!layout) return
      track("validation_warning_clicked", { object_id: issue.objectId })
      if (!issue.objectId) return
      const room = layout.rooms.find((r) => r.id === issue.objectId)
      if (room && room.floorId !== floorId) setSelectedFloor(room.floorId)
      selectObject(issue.objectId)
    },
    [floorId, layout, selectObject, setSelectedFloor]
  )

  const startNote = (issue: ValidationIssue) => {
    setEditingId(issue.id)
    setNoteDraft(prefs[issue.id]?.note ?? "")
  }

  const saveNote = (issueId: string) => {
    updateIssuePrefs(issueId, { note: noteDraft.trim() || undefined })
    setEditingId(null)
    setNoteDraft("")
  }

  return (
    <div className="space-y-2 p-3" data-testid="editor-warnings-list">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-sm font-semibold">Peringatan</span>
        <span className="text-xs font-normal text-muted-foreground">{issues.length} total</span>
      </div>

      {issues.length === 0 ? (
        <div className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
          Tidak ada peringatan. Layout terlihat aman.
        </div>
      ) : (
        <ul className="max-h-[22rem] space-y-1.5 overflow-y-auto">
          {issues.map((issue) => {
            const Icon = severityIcon[issue.level]
            const pref = prefs[issue.id]
            const read = !!pref?.read
            const note = pref?.note
            const isEditing = editingId === issue.id

            return (
              <li
                key={issue.id}
                id={`warning-row-${issue.id}`}
                ref={(el) => {
                  if (el) rowRefs.current.set(issue.id, el)
                  else rowRefs.current.delete(issue.id)
                }}
                className={cn(
                  "rounded-lg border bg-card/80 p-2 transition-[opacity,box-shadow]",
                  read && "opacity-60",
                  highlightId === issue.id && "ring-2 ring-primary"
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => focusIssue(issue)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <Icon className={cn("mt-0.5 size-4 shrink-0", severityColor[issue.level])} />
                    <span className="text-sm leading-relaxed">{issue.message}</span>
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Aksi peringatan"
                        className="-mr-1 -mt-1"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem
                        onSelect={() => {
                          if (!layout) return
                          onAddToAiContext(assistantContextText(layout, issue, note))
                          toast.success("Peringatan ditambahkan ke input Asisten Denah.")
                        }}
                      >
                        <Sparkles />
                        Add to AI context
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => updateIssuePrefs(issue.id, { read: !read })}>
                        <CheckCheck />
                        {read ? "Tandai belum dibaca" : "Abaikan / tandai dibaca"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => startNote(issue)}>
                        <NotebookPen />
                        Take note
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setDetailId(issue.id)}>
                        <Info />
                        Show detail
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {note && !isEditing && (
                  <div className="mt-2 rounded-md border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                    {note}
                  </div>
                )}

                {isEditing && (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Catatan untuk peringatan ini"
                      aria-label="Catatan peringatan"
                      className="min-h-20 text-sm"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setEditingId(null)
                          setNoteDraft("")
                        }}
                      >
                        Batal
                      </Button>
                      <Button type="button" size="xs" onClick={() => saveNote(issue.id)}>
                        Simpan catatan
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={!!detailIssue} onOpenChange={(open) => !open && setDetailId(null)}>
        {layout && detailIssue && (
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Detail Peringatan</DialogTitle>
              <DialogDescription>{detailIssue.message}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed">
                {issueDetailText(detailIssue)}
              </div>

              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
                {issueDetailRows(layout, detailIssue).map(([label, value]) => (
                  <React.Fragment key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </React.Fragment>
                ))}
              </dl>

              {prefs[detailIssue.id]?.note && (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                    Catatan
                  </p>
                  <p className="text-sm">{prefs[detailIssue.id]?.note}</p>
                </div>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
