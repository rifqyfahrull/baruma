"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowRight, Palette } from "lucide-react"

import { useInteriorStore } from "@/stores/interior-store"
import { useInterior, useLayout, useProject } from "@/lib/api/hooks"
import { applySavedInterior, generateInteriorPlan, interiorStyleFromHouseStyle } from "@/lib/interior/plan"
import { formatArea, formatIDRCompact } from "@/lib/format"
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

export default function MaterialsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: layoutDocument, isLoading: layoutLoading } = useLayout(projectId)
  const layout = layoutDocument?.layout ?? null
  const { data: savedInterior, isLoading: savedInteriorLoading } = useInterior(projectId)
  const activeInteriorProjectId = useInteriorStore((s) => s.projectId)
  const activeInteriorLayoutId = useInteriorStore((s) => s.layout?.id)
  const activeInteriorPlan = useInteriorStore((s) => s.plan)

  if (projectLoading || layoutLoading || savedInteriorLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }
  if (!project || !layout) {
    return (
      <div className="p-6">
        <EmptyState title="Material belum tersedia" description="Layout project belum tersedia." />
      </div>
    )
  }

  const plan =
    activeInteriorProjectId === projectId &&
    activeInteriorLayoutId === layout.id &&
    activeInteriorPlan
      ? activeInteriorPlan
      : savedInterior && savedInterior.versionId === layout.versionId
        ? applySavedInterior(layout, savedInterior, { projectId })
      : generateInteriorPlan(layout, {
          projectId,
          versionId: layout.versionId,
          style: interiorStyleFromHouseStyle(project.style),
        })
  const materials = plan.rooms.flatMap((room) =>
    room.materials.map((item) => ({ ...item, roomName: room.roomName }))
  )
  const totalMid = materials.reduce(
    (sum, item) => sum + item.areaM2 * item.priceRange.mid,
    0
  )

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Materials</h2>
          <p className="text-sm text-muted-foreground">
            Jadwal material interior per ruang, permukaan, luas, dan dampak biaya.
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
            <CardDescription>Total ruang</CardDescription>
            <CardTitle>{plan.rooms.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Material assignment</CardDescription>
            <CardTitle>{materials.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Estimasi material mid</CardDescription>
            <CardTitle>{formatIDRCompact(totalMid)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="size-4 text-primary" />
            Material schedule
          </CardTitle>
          <CardDescription>
            Gunakan daftar ini sebagai bahan diskusi dengan vendor interior.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ruang</TableHead>
                  <TableHead>Permukaan</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Luas</TableHead>
                  <TableHead className="text-right">Mid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.roomName}</TableCell>
                    <TableCell>{item.surface}</TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{formatArea(item.areaM2)}</TableCell>
                    <TableCell className="text-right">
                      {formatIDRCompact(item.areaM2 * item.priceRange.mid)}
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
