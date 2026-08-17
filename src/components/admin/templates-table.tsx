"use client"

import * as React from "react"
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  useAdminTemplates,
  useDeleteTemplate,
  useUpdateTemplate,
} from "@/lib/api/hooks"
import { HOUSE_STYLES } from "@/lib/constants"
import type { TemplateSummary } from "@/types/templates"
import { LayoutThumbnail } from "@/components/shared/layout-thumbnail"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { TemplateForm } from "./template-form"

export function TemplatesTable() {
  const { data: templates, isLoading } = useAdminTemplates()
  const updateTemplate = useUpdateTemplate()
  const deleteTemplate = useDeleteTemplate()
  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState<TemplateSummary | null>(null)
  const [resyncing, setResyncing] = React.useState<TemplateSummary | null>(null)
  const [deleting, setDeleting] = React.useState<TemplateSummary | null>(null)

  function toggleActive(template: TemplateSummary) {
    updateTemplate.mutate(
      { id: template.id, patch: { active: !template.active } },
      { onError: () => toast.error("Gagal mengubah status template.") }
    )
  }

  function handleResync() {
    if (!resyncing) return
    const target = resyncing
    setResyncing(null)
    updateTemplate.mutate(
      { id: target.id, patch: { resync: true } },
      {
        onSuccess: () =>
          toast.success(`Template "${target.name}" disinkronkan ulang dari proyek sumber.`),
        onError: () => toast.error("Gagal menyinkronkan ulang template."),
      }
    )
  }

  function handleDelete() {
    if (!deleting) return
    const target = deleting
    setDeleting(null)
    deleteTemplate.mutate(target.id, {
      onSuccess: () => toast.success(`Template "${target.name}" telah dihapus.`),
      onError: () => toast.error("Gagal menghapus template."),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Template dibuat dari snapshot sebuah proyek dan tampil di halaman
          publik "Mulai dari Template" bila aktif.
        </p>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Tambah dari Proyek
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Pratinjau</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Style</TableHead>
            <TableHead>Lantai</TableHead>
            <TableHead>Kota</TableHead>
            <TableHead>Urutan</TableHead>
            <TableHead>Aktif</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={8}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            ))
          ) : !templates || templates.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="text-center text-muted-foreground"
              >
                Belum ada template.
              </TableCell>
            </TableRow>
          ) : (
            templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell>
                  <LayoutThumbnail
                    variant={template.thumbnail}
                    label={`Pratinjau ${template.name}`}
                    className="aspect-square w-16"
                  />
                </TableCell>
                <TableCell className="font-medium">
                  <div>{template.name}</div>
                  <div className="text-xs text-muted-foreground">{template.slug}</div>
                </TableCell>
                <TableCell>
                  {template.style ? HOUSE_STYLES[template.style] : "-"}
                </TableCell>
                <TableCell>
                  {template.floors} lantai{template.rooftop ? " + rooftop" : ""}
                </TableCell>
                <TableCell>{template.city ?? "-"}</TableCell>
                <TableCell>{template.sortOrder}</TableCell>
                <TableCell>
                  <Switch
                    checked={template.active}
                    onCheckedChange={() => toggleActive(template)}
                    aria-label={`Aktifkan template ${template.name}`}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Edit template ${template.name}`}
                      onClick={() => setEditing(template)}
                    >
                      <Pencil /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Sinkronkan ulang template ${template.name}`}
                      disabled={!template.sourceProjectId}
                      onClick={() => setResyncing(template)}
                    >
                      <RefreshCw /> Resync
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Hapus template ${template.name}`}
                      onClick={() => setDeleting(template)}
                    >
                      <Trash2 /> Hapus
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <TemplateForm mode="create" open={creating} onOpenChange={setCreating} />
      <TemplateForm
        mode="edit"
        template={editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />

      <AlertDialog open={resyncing !== null} onOpenChange={(open) => !open && setResyncing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sinkronkan ulang template?</AlertDialogTitle>
            <AlertDialogDescription>
              Denah, brief, dan interior template <strong>{resyncing?.name}</strong>{" "}
              akan diganti dengan kondisi terbaru dari proyek sumbernya. Nama,
              slug, dan deskripsi tidak berubah.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleResync} disabled={updateTemplate.isPending}>
              Sinkronkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus template?</AlertDialogTitle>
            <AlertDialogDescription>
              Template <strong>{deleting?.name}</strong> akan dihapus permanen
              dan tidak lagi tampil di halaman publik. Proyek sumbernya tidak
              terpengaruh.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteTemplate.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteTemplate.isPending ? "Menghapus…" : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
