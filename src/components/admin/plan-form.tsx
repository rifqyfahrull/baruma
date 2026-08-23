"use client"

import * as React from "react"
import { toast } from "sonner"

import { useUpdatePlan } from "@/lib/api/hooks"
import type { PlanRow } from "@/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

/** One feature/limit per line — much less code than a dynamic add/remove list UI. */
function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Full plan editor, opened from plans-table.tsx's "Edit" button. Editing
 * only (no create-new-plan flow) — Task 8's scope is CRUD on the existing
 * seeded plans; a new-plan flow would additionally need id/slug uniqueness
 * handling that isn't asked for here.
 */
export function PlanForm({
  plan,
  open,
  onOpenChange,
}: {
  plan: PlanRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const updatePlan = useUpdatePlan()
  const [form, setForm] = React.useState<PlanRow | null>(plan)

  // Re-sync local form state whenever a (possibly different) plan is opened.
  React.useEffect(() => {
    if (!plan) return
    const timer = setTimeout(() => setForm(plan), 0)
    return () => clearTimeout(timer)
  }, [plan])

  if (!form) return null

  function set<K extends keyof PlanRow>(key: K, value: PlanRow[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
  }

  function setEntitlement<K extends keyof PlanRow["entitlements"]>(
    key: K,
    value: PlanRow["entitlements"][K]
  ) {
    setForm((f) =>
      f ? { ...f, entitlements: { ...f.entitlements, [key]: value } } : f
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    try {
      await updatePlan.mutateAsync(form)
      toast.success(`Plan ${form.name} disimpan.`)
      onOpenChange(false)
    } catch {
      toast.error("Gagal menyimpan plan.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit plan {form.name}</DialogTitle>
            <DialogDescription>
              Perubahan berlaku langsung untuk halaman harga dan billing.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="plan-name">Nama plan</Label>
              <Input
                id="plan-name"
                aria-label="Nama plan"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-price">Harga (IDR)</Label>
              <Input
                id="plan-price"
                type="number"
                min={0}
                aria-label="Harga plan dalam rupiah"
                value={form.priceIdr}
                onChange={(e) => set("priceIdr", Number(e.target.value))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-period">Periode</Label>
              <Select
                value={form.period}
                onValueChange={(v) => set("period", v as PlanRow["period"])}
              >
                <SelectTrigger
                  id="plan-period"
                  aria-label="Periode plan"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Bulan</SelectItem>
                  <SelectItem value="year">Tahun</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="plan-tagline">Tagline</Label>
              <Input
                id="plan-tagline"
                aria-label="Tagline plan"
                value={form.tagline ?? ""}
                onChange={(e) => set("tagline", e.target.value || null)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-sort">Urutan tampil</Label>
              <Input
                id="plan-sort"
                type="number"
                aria-label="Urutan tampil plan"
                value={form.sortOrder}
                onChange={(e) => set("sortOrder", Number(e.target.value))}
              />
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <Label htmlFor="plan-featured">Unggulan (badge Populer)</Label>
              <Switch
                id="plan-featured"
                aria-label="Tandai plan sebagai unggulan"
                checked={form.featured}
                onCheckedChange={(v) => set("featured", v)}
              />
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 sm:col-span-2">
              <Label htmlFor="plan-active">Aktif</Label>
              <Switch
                id="plan-active"
                aria-label="Aktifkan plan"
                checked={form.active}
                onCheckedChange={(v) => set("active", v)}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="plan-features">Fitur (satu per baris)</Label>
              <Textarea
                id="plan-features"
                aria-label="Daftar fitur plan, satu per baris"
                rows={4}
                value={form.features.join("\n")}
                onChange={(e) => set("features", linesToList(e.target.value))}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="plan-limits">Batasan (satu per baris)</Label>
              <Textarea
                id="plan-limits"
                aria-label="Daftar batasan plan, satu per baris"
                rows={3}
                value={form.limits.join("\n")}
                onChange={(e) => set("limits", linesToList(e.target.value))}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-credits">Kredit per periode</Label>
              <Input
                id="plan-credits"
                type="number"
                aria-label="Kredit AI per periode"
                value={form.entitlements.creditsPerPeriod}
                onChange={(e) =>
                  setEntitlement("creditsPerPeriod", Number(e.target.value))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-max-projects">Maks. proyek</Label>
              <Input
                id="plan-max-projects"
                type="number"
                min={0}
                placeholder="Tanpa batas"
                aria-label="Maksimal jumlah proyek (kosongkan untuk tanpa batas)"
                value={form.entitlements.maxProjects ?? ""}
                onChange={(e) =>
                  setEntitlement(
                    "maxProjects",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                Kosongkan untuk tanpa batas.
              </p>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <Label htmlFor="plan-export-pdf">Export PDF</Label>
              <Switch
                id="plan-export-pdf"
                aria-label="Izinkan export PDF"
                checked={form.entitlements.exportPdf}
                onCheckedChange={(v) => setEntitlement("exportPdf", v)}
              />
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <Label htmlFor="plan-glb-upload">Upload GLB</Label>
              <Switch
                id="plan-glb-upload"
                aria-label="Izinkan upload model GLB"
                checked={form.entitlements.glbUpload}
                onCheckedChange={(v) => setEntitlement("glbUpload", v)}
              />
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <Label htmlFor="plan-ai-render-hd">Render AI HD (Presisi)</Label>
              <Switch
                id="plan-ai-render-hd"
                aria-label="Izinkan render AI mode Presisi (HD, tanpa watermark)"
                checked={form.entitlements.aiRenderHd}
                onCheckedChange={(v) => setEntitlement("aiRenderHd", v)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={updatePlan.isPending}>
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
