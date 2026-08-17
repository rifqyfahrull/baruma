"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { FolderPlus, Plus, Search } from "lucide-react"

import type { ReadinessStatus } from "@/types"
import { READINESS } from "@/lib/constants"
import { useProjects } from "@/lib/api/hooks"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { ProjectCard, ProjectCardSkeleton } from "@/components/project/project-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const READINESS_OPTIONS = Object.entries(READINESS) as [
  ReadinessStatus,
  (typeof READINESS)[ReadinessStatus],
][]

export default function ProjectsPage() {
  const { data: projects, isLoading } = useProjects()
  const [search, setSearch] = useState("")
  const [readiness, setReadiness] = useState<"all" | ReadinessStatus>("all")

  const filtered = useMemo(() => {
    if (!projects) return []
    const query = search.trim().toLowerCase()
    return projects.filter((project) => {
      const matchesName =
        query.length === 0 || project.name.toLowerCase().includes(query)
      const matchesReadiness =
        readiness === "all" || project.readiness === readiness
      return matchesName && matchesReadiness
    })
  }, [projects, search, readiness])

  const hasProjects = !!projects && projects.length > 0

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Project"
        description="Semua project kamu."
        actions={
          <Button asChild>
            <Link href="/app/projects/new">
              <Plus />
              Buat Project
            </Link>
          </Button>
        }
      />

      {hasProjects && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari project berdasarkan nama..."
              className="pl-9"
              aria-label="Cari project"
            />
          </div>
          <Select
            value={readiness}
            onValueChange={(value) =>
              setReadiness(value as "all" | ReadinessStatus)
            }
          >
            <SelectTrigger className="w-full sm:w-60" aria-label="Filter kesiapan">
              <SelectValue placeholder="Semua status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              {READINESS_OPTIONS.map(([status, info]) => (
                <SelectItem key={status} value={status}>
                  {info.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <ProjectCardSkeleton key={index} />
          ))}
        </div>
      ) : !hasProjects ? (
        <EmptyState
          icon={FolderPlus}
          title="Belum ada project"
          description="Mulai dengan membuat project pertamamu. Kami bantu dari ide sampai denah."
          action={
            <Button asChild>
              <Link href="/app/projects/new">
                <Plus />
                Buat Project
              </Link>
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-muted/30 px-6 py-14 text-center text-sm text-muted-foreground">
          Tidak ada project yang cocok.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  )
}
