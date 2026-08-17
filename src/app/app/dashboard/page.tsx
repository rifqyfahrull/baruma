"use client"

import Link from "next/link"
import { ArrowRight, FolderPlus, Plus, Sparkles } from "lucide-react"

import { useCurrentUser, useProjects } from "@/lib/api/hooks"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import {
  ProjectCard,
  ProjectCardSkeleton,
} from "@/components/project/project-card"
import { LayoutThumbnail } from "@/components/shared/layout-thumbnail"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { ThumbnailVariant } from "@/types"

const TEMPLATES: {
  title: string
  description: string
  variant: ThumbnailVariant
}[] = [
  {
    title: "Rumah 8x8 Modern Tropis",
    description: "Cocok untuk lahan kecil dengan banyak cahaya alami.",
    variant: "courtyard",
  },
  {
    title: "Rumah Keluarga 2 Lantai",
    description: "Ruang lega untuk keluarga yang terus bertumbuh.",
    variant: "family",
  },
  {
    title: "Hemat Biaya 1 Lantai",
    description: "Pilihan praktis dan ramah anggaran.",
    variant: "vertical",
  },
]

export default function DashboardPage() {
  const { data: user, isLoading: userLoading } = useCurrentUser()
  const { data: projects, isLoading: projectsLoading } = useProjects()

  const list = projects ?? []
  const totalProjects = list.length
  const needReview = list.filter(
    (p) => p.readiness === "engineer_review_required"
  ).length
  const readyToDiscuss = list.filter(
    (p) => p.readiness === "contractor_discussion_ready"
  ).length

  const recent = list.slice(0, 6)

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Dashboard"
        description="Lanjutkan project atau mulai yang baru."
      />

      {/* Welcome card */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card">
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            {userLoading ? (
              <Skeleton className="h-7 w-48" />
            ) : (
              <h2 className="text-xl font-semibold tracking-tight">
                Halo, {user?.name ?? "Sahabat Baruma"}
              </h2>
            )}
            <p className="text-sm text-muted-foreground">
              Mulai dari ukuran tanah dan kebutuhan rumahmu, lalu lihat
              beberapa pilihan denah dalam hitungan menit.
            </p>
          </div>
          <Button asChild size="lg" className="shrink-0">
            <Link href="/app/projects/new">
              <Plus />
              Buat Project Baru
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Stat row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total project</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {projectsLoading ? (
                <Skeleton className="h-9 w-12" />
              ) : (
                totalProjects
              )}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Perlu review</CardDescription>
            <CardTitle className="text-3xl tabular-nums text-warning-foreground">
              {projectsLoading ? <Skeleton className="h-9 w-12" /> : needReview}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Siap diskusi</CardDescription>
            <CardTitle className="text-3xl tabular-nums text-success">
              {projectsLoading ? (
                <Skeleton className="h-9 w-12" />
              ) : (
                readyToDiscuss
              )}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Recent projects */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            Project terbaru
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/app/projects">
              Lihat semua
              <ArrowRight />
            </Link>
          </Button>
        </div>

        {projectsLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={FolderPlus}
            title="Belum ada project"
            description="Mulai dari ukuran tanah dan kebutuhan rumahmu."
            action={
              <Button asChild variant="outline">
                <Link href="/app/projects/new">
                  <Plus />
                  Buat Project Baru
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>

      {/* Template suggestions */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">
            Template saran
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((tpl) => (
            <Link
              key={tpl.title}
              href="/app/projects/new"
              className="group block"
            >
              <Card className="gap-0 overflow-hidden pt-0 transition-shadow hover:shadow-md">
                <LayoutThumbnail
                  variant={tpl.variant}
                  label={`Denah ${tpl.title}`}
                  className="aspect-[16/10] border-b"
                />
                <CardContent className="space-y-1 py-4">
                  <h3 className="font-semibold leading-snug group-hover:text-primary">
                    {tpl.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {tpl.description}
                  </p>
                  <span className="inline-flex items-center gap-1 pt-1 text-sm font-medium text-primary">
                    Mulai dari template
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
