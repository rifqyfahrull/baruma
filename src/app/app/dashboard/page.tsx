"use client"

import Link from "next/link"
import { ArrowRight, FolderPlus, LayoutTemplate, Plus, Sparkles } from "lucide-react"

import { useCurrentUser, useProjects, useTemplates } from "@/lib/api/hooks"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import {
  ProjectCard,
  ProjectCardSkeleton,
} from "@/components/project/project-card"
import { LayoutThumbnail } from "@/components/shared/layout-thumbnail"
import { UseTemplateButton } from "@/components/templates/use-template-button"
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist"
import { UsageCard } from "@/components/dashboard/usage-card"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardPage() {
  const { data: user, isLoading: userLoading } = useCurrentUser()
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const { data: templates, isLoading: templatesLoading } = useTemplates()

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

      {/* Checklist onboarding (WS-E §2) — hanya render selagi ada langkah
          yang belum selesai & belum di-dismiss (lihat komponennya). */}
      <OnboardingChecklist />

      {/* Kartu kredit & penggunaan (PRD §10.2) */}
      <UsageCard />

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
            description="Isi ukuran tanah & kebutuhanmu lewat wizard singkat, lalu dapatkan beberapa alternatif denah, preview 3D, dan estimasi RAB dalam hitungan menit."
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild>
                  <Link href="/app/projects/new">
                    <Plus />
                    Buat dari nol
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/templates">
                    <LayoutTemplate />
                    Mulai dari template
                  </Link>
                </Button>
              </div>
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

      {/* Template suggestions — data nyata dari galeri template (WS-D §1),
          bukan lagi 3 kartu palsu yang mengarah ke wizard kosong. */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <h2 className="text-lg font-semibold tracking-tight">
              Template saran
            </h2>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/templates">
              Lihat semua
              <ArrowRight />
            </Link>
          </Button>
        </div>

        {templatesLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : !templates || templates.length === 0 ? null : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.slice(0, 3).map((tpl) => (
              <Card
                key={tpl.id}
                data-testid={`template-card-${tpl.slug}`}
                className="group gap-0 overflow-hidden pt-0 transition-shadow hover:shadow-md"
              >
                <Link href={`/templates/${tpl.slug}`} className="block">
                  <LayoutThumbnail
                    variant={tpl.thumbnail}
                    label={`Denah ${tpl.name}`}
                    className="aspect-[16/10] border-b"
                  />
                  <CardContent className="space-y-1 py-4">
                    <h3 className="font-semibold leading-snug group-hover:text-primary">
                      {tpl.name}
                    </h3>
                    {tpl.description && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {tpl.description}
                      </p>
                    )}
                  </CardContent>
                </Link>
                <CardFooter className="px-4 pb-4">
                  <UseTemplateButton slug={tpl.slug} size="sm" variant="outline" className="w-full" />
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
