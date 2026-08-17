"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Copy, Download, Layers, MapPin, MoreVertical, Pencil, Ruler, Trash2 } from "lucide-react"
import { toast } from "sonner"

import type { Project } from "@/types"
import { useDeleteProject, useDuplicateProject } from "@/lib/api/hooks"
import { RenameProjectDialog } from "@/components/project/rename-project-dialog"
import { formatArea, formatDimensions, formatRelative } from "@/lib/format"
import { ReadinessBadge } from "@/components/shared/readiness-badge"
import { LayoutThumbnail } from "@/components/shared/layout-thumbnail"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function ProjectCard({ project }: { project: Project }) {
  const router = useRouter()
  const href = `/app/projects/${project.id}/brief`
  const [showDelete, setShowDelete] = React.useState(false)
  const [showRename, setShowRename] = React.useState(false)
  const deleteMutation = useDeleteProject()
  const duplicateMutation = useDuplicateProject()

  const handleDuplicate = () => {
    const toastId = toast.loading(`Menduplikasi "${project.name}"…`)
    duplicateMutation.mutate(project.id, {
      onSuccess: (created) => {
        toast.success(`"${created.name}" dibuat.`, { id: toastId })
        router.refresh()
      },
      onError: () => {
        toast.error("Gagal menduplikasi project.", { id: toastId })
      },
    })
  }

  const handleDelete = () => {
    deleteMutation.mutate(project.id, {
      onSuccess: () => {
        toast.success(`"${project.name}" telah dihapus`)
        router.refresh()
      },
      onError: () => {
        toast.error("Gagal menghapus project")
      },
    })
    setShowDelete(false)
  }

  return (
    <>
      <Card className="group gap-0 overflow-hidden pt-0 transition-shadow hover:shadow-md">
        <Link href={href} className="block">
          <LayoutThumbnail
            variant={project.thumbnail}
            label={`Denah ${project.name}`}
            className="aspect-[16/10] border-b"
          />
        </Link>

        <CardContent className="space-y-2.5 py-4">
          <div className="flex items-start justify-between gap-2">
            <Link href={href} className="min-w-0">
              <h3 className="truncate font-semibold leading-snug hover:text-primary">
                {project.name}
              </h3>
            </Link>
            <ReadinessBadge status={project.readiness} size="sm" showDot={false} />
          </div>

          {project.location && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" />
              <span className="truncate">{project.location}</span>
            </p>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Ruler className="size-3.5" />
              {formatDimensions(project.site.widthM, project.site.depthM)} ·{" "}
              {formatArea(project.site.areaM2)}
            </span>
            <span className="flex items-center gap-1.5">
              <Layers className="size-3.5" />
              {project.floors} lantai{project.rooftop ? " + rooftop" : ""}
            </span>
          </div>
        </CardContent>

        <CardFooter className="justify-between border-t py-3">
          <span className="text-xs text-muted-foreground">
            Diperbarui {formatRelative(project.updatedAt)}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Aksi project">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={href}>Buka</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowRename(true)}>
                <Pencil />
                Ganti nama
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={handleDuplicate}
                disabled={duplicateMutation.isPending}
              >
                <Copy />
                Duplikat
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  toast.info("Export tersedia di milestone berikutnya.")
                }
              >
                <Download />
                Export
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setShowDelete(true)}
              >
                <Trash2 />
                Hapus
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardFooter>
      </Card>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus project?</AlertDialogTitle>
            <AlertDialogDescription>
              Project <strong>{project.name}</strong> akan dihapus permanen.
              Semua data termasuk denah, interior, RAB, dan review tidak bisa
              dikembalikan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Menghapus…" : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RenameProjectDialog
        projectId={project.id}
        currentName={project.name}
        open={showRename}
        onOpenChange={setShowRename}
      />
    </>
  )
}

export function ProjectCardSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden pt-0">
      <div className="aspect-[16/10] animate-pulse border-b bg-muted" />
      <CardContent className="space-y-3 py-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  )
}
