"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { Armchair, ArrowRight } from "lucide-react"

import { useInteriorStore } from "@/stores/interior-store"
import { useLayout, useProject } from "@/lib/api/hooks"
import { generateInteriorPlan, interiorStyleFromHouseStyle } from "@/lib/interior/plan"
import { formatDimensions, formatIDRCompact } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/shared/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default function FurniturePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: layoutDocument, isLoading: layoutLoading } = useLayout(projectId)
  const layout = layoutDocument?.layout ?? null
  const activeInteriorProjectId = useInteriorStore((s) => s.projectId)
  const activeInteriorLayoutId = useInteriorStore((s) => s.layout?.id)
  const activeInteriorPlan = useInteriorStore((s) => s.plan)

  if (projectLoading || layoutLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }
  if (!project || !layout) {
    return (
      <div className="p-6">
        <EmptyState title="Furniture belum tersedia" description="Layout project belum tersedia." />
      </div>
    )
  }

  const plan =
    activeInteriorProjectId === projectId &&
    activeInteriorLayoutId === layout.id &&
    activeInteriorPlan
      ? activeInteriorPlan
      : generateInteriorPlan(layout, {
          projectId,
          versionId: layout.versionId,
          style: interiorStyleFromHouseStyle(project.style),
        })
  const furniture = plan.rooms.flatMap((room) =>
    room.furniture.map((item) => ({ ...item, roomName: room.roomName }))
  )

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Furniture</h2>
          <p className="text-sm text-muted-foreground">
            Jadwal furniture berbasis dimensi, ruang, dan estimasi biaya.
          </p>
        </div>
        <Button asChild>
          <Link href={`/app/projects/${projectId}/preview-3d`}>
            Buka 3D Preview <ArrowRight />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total item</CardDescription>
            <CardTitle>{furniture.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Estimasi furniture mid</CardDescription>
            <CardTitle>
              {formatIDRCompact(furniture.reduce((sum, item) => sum + item.priceRange.mid, 0))}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Warning interior</CardDescription>
            <CardTitle>{plan.warnings.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Armchair className="size-4 text-primary" />
            Furniture schedule
          </CardTitle>
          <CardDescription>
            Ukuran ini masih estimasi konsep dan perlu pengukuran lapangan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ruang</TableHead>
                  <TableHead>Furniture</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead>Ukuran</TableHead>
                  <TableHead className="text-right">Mid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {furniture.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.roomName}</TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell>{formatDimensions(item.widthM, item.depthM)}</TableCell>
                    <TableCell className="text-right">
                      {formatIDRCompact(item.priceRange.mid)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
