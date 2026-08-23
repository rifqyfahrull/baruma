"use client"

import * as React from "react"
import { toast } from "sonner"

import { useCreateTemplate, useUpdateTemplate } from "@/lib/api/hooks"
import { ApiError } from "@/lib/data/http"
import { createTemplateSchema, updateTemplateSchema } from "@/lib/schemas/templates"
import type { TemplateSummary } from "@/types/templates"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

/** Extract a human toast message from a create/update failure. */
function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.status === 404) return "Proyek tidak ditemukan"
  if (e instanceof Error && e.message) return e.message
  return fallback
}

type CreateFormState = {
  projectId: string
  slug: string
  name: string
  description: string
  sortOrder: string
}

const EMPTY_CREATE_FORM: CreateFormState = {
  projectId: "",
  slug: "",
  name: "",
  description: "",
  sortOrder: "0",
}

type EditFormState = {
  name: string
  slug: string
  description: string
  sortOrder: string
  active: boolean
}

/**
 * Two-mode dialog: "create" snapshots a project into a brand-new template,
 * "edit" edits an existing template's metadata (a resync is a separate
 * confirm flow in templates-table.tsx, not part of this form).
 */
export function TemplateForm(
  props:
    | { mode: "create"; open: boolean; onOpenChange: (open: boolean) => void }
    | {
        mode: "edit"
        template: TemplateSummary | null
        open: boolean
        onOpenChange: (open: boolean) => void
      }
) {
  const { mode, open, onOpenChange } = props
  const template = mode === "edit" ? props.template : null

  const createTemplate = useCreateTemplate()
  const updateTemplate = useUpdateTemplate()

  const [createForm, setCreateForm] = React.useState<CreateFormState>(EMPTY_CREATE_FORM)
  const [editForm, setEditForm] = React.useState<EditFormState | null>(null)

  // Reset the create form whenever the dialog opens.
  React.useEffect(() => {
    // PRA-EXISTING (bukan dari WS-A): setState sinkron dalam effect — lihat TODOS.md P1.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mode === "create" && open) setCreateForm(EMPTY_CREATE_FORM)
  }, [mode, open])

  // Re-sync the edit form whenever a (possibly different) template is opened.
  React.useEffect(() => {
    if (mode !== "edit" || !template) return
    const timer = setTimeout(() => {
      setEditForm({
        name: template.name,
        slug: template.slug,
        description: template.description ?? "",
        sortOrder: String(template.sortOrder),
        active: template.active,
      })
    }, 0)
    return () => clearTimeout(timer)
  }, [mode, template])

  if (mode === "edit" && (!template || !editForm)) return null

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = createTemplateSchema.safeParse({
      projectId: createForm.projectId.trim(),
      slug: createForm.slug.trim(),
      name: createForm.name.trim() || undefined,
      description: createForm.description.trim() || undefined,
      sortOrder: createForm.sortOrder.trim() ? Number(createForm.sortOrder) : undefined,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Input tidak valid.")
      return
    }
    try {
      const created = await createTemplate.mutateAsync(parsed.data)
      toast.success(`Template "${created.name}" dibuat.`)
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err, "Gagal membuat template."))
    }
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!template || !editForm) return
    const parsed = updateTemplateSchema.safeParse({
      name: editForm.name.trim(),
      slug: editForm.slug.trim(),
      description: editForm.description.trim() || null,
      sortOrder: editForm.sortOrder.trim() ? Number(editForm.sortOrder) : undefined,
      active: editForm.active,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Input tidak valid.")
      return
    }
    try {
      await updateTemplate.mutateAsync({ id: template.id, patch: parsed.data })
      toast.success(`Template "${editForm.name}" disimpan.`)
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err, "Gagal menyimpan template."))
    }
  }

  if (mode === "create") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Tambah template dari proyek</DialogTitle>
              <DialogDescription>
                Denah, brief, dan interior proyek akan di-snapshot menjadi
                template baru yang bisa ditampilkan di halaman publik.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tmpl-project-id">Project ID</Label>
                <Input
                  id="tmpl-project-id"
                  aria-label="ID proyek sumber"
                  placeholder="mis. proj-demo-8x8"
                  value={createForm.projectId}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, projectId: e.target.value }))
                  }
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tmpl-slug">Slug</Label>
                <Input
                  id="tmpl-slug"
                  aria-label="Slug template"
                  placeholder="mis. rumah-8x8-modern-tropis"
                  value={createForm.slug}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, slug: e.target.value }))
                  }
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Huruf kecil, angka, dan tanda hubung saja (a-z0-9-).
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tmpl-name">Nama (opsional)</Label>
                <Input
                  id="tmpl-name"
                  aria-label="Nama template"
                  placeholder="Default: nama proyek"
                  value={createForm.name}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tmpl-description">Deskripsi</Label>
                <Textarea
                  id="tmpl-description"
                  aria-label="Deskripsi template"
                  rows={3}
                  value={createForm.description}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tmpl-sort">Urutan tampil</Label>
                <Input
                  id="tmpl-sort"
                  type="number"
                  aria-label="Urutan tampil template"
                  value={createForm.sortOrder}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, sortOrder: e.target.value }))
                  }
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={createTemplate.isPending}>
                {createTemplate.isPending ? "Membuat…" : "Buat template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    )
  }

  // mode === "edit" (template + editForm guaranteed non-null past the guard above)
  const form = editForm!

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit template {form.name}</DialogTitle>
            <DialogDescription>
              Perubahan metadata ini tidak mengubah denah/brief — gunakan
              &quot;Resync&quot; untuk menarik ulang dari proyek sumber.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tmpl-edit-name">Nama</Label>
              <Input
                id="tmpl-edit-name"
                aria-label="Nama template"
                value={form.name}
                onChange={(e) =>
                  setEditForm((f) => (f ? { ...f, name: e.target.value } : f))
                }
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tmpl-edit-slug">Slug</Label>
              <Input
                id="tmpl-edit-slug"
                aria-label="Slug template"
                value={form.slug}
                onChange={(e) =>
                  setEditForm((f) => (f ? { ...f, slug: e.target.value } : f))
                }
                required
              />
              <p className="text-xs text-muted-foreground">
                Huruf kecil, angka, dan tanda hubung saja (a-z0-9-).
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tmpl-edit-description">Deskripsi</Label>
              <Textarea
                id="tmpl-edit-description"
                aria-label="Deskripsi template"
                rows={3}
                value={form.description}
                onChange={(e) =>
                  setEditForm((f) => (f ? { ...f, description: e.target.value } : f))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tmpl-edit-sort">Urutan tampil</Label>
              <Input
                id="tmpl-edit-sort"
                type="number"
                aria-label="Urutan tampil template"
                value={form.sortOrder}
                onChange={(e) =>
                  setEditForm((f) => (f ? { ...f, sortOrder: e.target.value } : f))
                }
              />
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <Label htmlFor="tmpl-edit-active">Aktif</Label>
              <Switch
                id="tmpl-edit-active"
                aria-label="Aktifkan template"
                checked={form.active}
                onCheckedChange={(v) =>
                  setEditForm((f) => (f ? { ...f, active: v } : f))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={updateTemplate.isPending}>
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
