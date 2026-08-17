"use client"

import * as React from "react"
import {
  Bell,
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
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type WarningPrefs = Record<string, { read?: boolean; note?: string }>

type EditorWarningsPopoverProps = {
  projectId: string
  onAddToAiContext: (text: string) => void
}

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

function readPrefs(storageKey: string): WarningPrefs {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as WarningPrefs) : {}
  } catch {
    return {}
  }
}

function writePrefs(storageKey: string, prefs: WarningPrefs): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(prefs))
  } catch {
    // Local warning notes are convenience UI state; ignore storage failures.
  }
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

export function EditorWarningsPopover({
  projectId,
  onAddToAiContext,
}: EditorWarningsPopoverProps) {
  const layout = useEditorStore((s) => s.layout)
  const floorId = useEditorStore((s) => s.selectedFloorId)
  const selectObject = useEditorStore((s) => s.selectObject)
  const setSelectedFloor = useEditorStore((s) => s.setSelectedFloor)
  const storageKey = `editor:warnings:${projectId}`
  const [prefs, setPrefs] = React.useState<WarningPrefs>(() => readPrefs(storageKey))
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [noteDraft, setNoteDraft] = React.useState("")
  const [detailId, setDetailId] = React.useState<string | null>(null)

  const issues = layout?.validation.issues ?? []
  const unread = issues.filter((issue) => !prefs[issue.id]?.read).length
  const detailIssue = issues.find((issue) => issue.id === detailId) ?? null

  const updateIssuePrefs = React.useCallback(
    (issueId: string, patch: WarningPrefs[string]) => {
      setPrefs((current) => {
        const next = { ...current, [issueId]: { ...current[issueId], ...patch } }
        writePrefs(storageKey, next)
        return next
      })
    },
    [storageKey]
  )

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
    <>
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={`Peringatan denah (${unread} belum dibaca dari ${issues.length})`}
                className="relative"
              >
                <Bell />
                {unread > 0 && (
                  <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 text-destructive-foreground">
                    {unread}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Peringatan</TooltipContent>
        </Tooltip>

        <PopoverContent align="end" side="bottom" className="w-80 gap-0 p-0">
          <PopoverHeader className="border-b px-3 py-2.5">
            <PopoverTitle className="flex items-center justify-between gap-2">
              <span>Peringatan</span>
              <span className="text-xs font-normal text-muted-foreground">
                {issues.length} total
              </span>
            </PopoverTitle>
          </PopoverHeader>

          {issues.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">
              Tidak ada peringatan. Layout terlihat aman.
            </div>
          ) : (
            <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto p-2">
              {issues.map((issue) => {
                const Icon = severityIcon[issue.level]
                const pref = prefs[issue.id]
                const read = !!pref?.read
                const note = pref?.note
                const isEditing = editingId === issue.id

                return (
                  <li
                    key={issue.id}
                    className={cn(
                      "rounded-lg border bg-card/80 p-2 transition-opacity",
                      read && "opacity-60"
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
                              onAddToAiContext(
                                assistantContextText(layout, issue, note)
                              )
                              toast.success("Peringatan ditambahkan ke input Asisten Denah.")
                            }}
                          >
                            <Sparkles />
                            Add to AI context
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => updateIssuePrefs(issue.id, { read: !read })}
                          >
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
        </PopoverContent>
      </Popover>

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
    </>
  )
}
