"use client"

import * as React from "react"
import Link from "next/link"
import { Box, Calculator, Check, ChevronDown, FolderPlus, LayoutGrid, X } from "lucide-react"

import { useProjects } from "@/lib/api/hooks"
import { stageHref } from "@/lib/nav"
import {
  useOnboardingDismissed,
  useOnboardingSeen,
} from "@/hooks/use-onboarding-progress"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

type Step = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  done: boolean
}

/**
 * Checklist onboarding 4 langkah di dashboard (WS-E §2, PRD §10.2 "checklist
 * onboarding"). Status setiap langkah diturunkan dari SINYAL NYATA, bukan
 * flag terpisah yang bisa basi:
 *
 * 1. "Buat project pertama" — `projects.length > 0`.
 * 2. "Pilih alternatif layout" — `project.currentVersionId` terisi. Field
 *    ini HANYA di-set oleh `selectAlternative()` (lihat src/lib/mock/index.ts
 *    dan src/app/api/v1/projects/[id]/alternatives/[altId]/select/route.ts)
 *    — sinyal paling langsung bahwa user sudah memilih satu alternatif,
 *    lebih tepat daripada `status` (yang juga berubah karena aksi lain).
 * 3. "Lihat preview 3D" — kunjungan halaman preview-3d, dicatat via
 *    `markOnboardingSeen("preview3d")` (localStorage, lihat
 *    use-onboarding-progress.ts) karena tak ada field project untuk ini.
 * 4. "Cek estimasi RAB" — sama, `markOnboardingSeen("rab")`.
 *
 * Render HANYA saat: ada project (query sudah selesai), belum semua langkah
 * selesai, dan belum di-dismiss. Collapsible (ciut/lebar) + dismissible
 * (tombol X, persist di localStorage) — keduanya state lokal, tidak
 * memengaruhi progres langkah itu sendiri.
 */
export function OnboardingChecklist() {
  const { data: projects, isLoading } = useProjects()
  const [dismissed, dismiss] = useOnboardingDismissed()
  const seen = useOnboardingSeen()
  const [open, setOpen] = React.useState(true)

  const list = projects ?? []
  const firstProjectId = list[0]?.id
  const hasProject = list.length > 0
  const hasChosenAlternative = list.some((p) => Boolean(p.currentVersionId))

  const steps: Step[] = [
    {
      key: "project",
      label: "Buat project pertama",
      icon: FolderPlus,
      href: "/app/projects/new",
      done: hasProject,
    },
    {
      key: "alternative",
      label: "Pilih alternatif layout",
      icon: LayoutGrid,
      href: firstProjectId ? stageHref(firstProjectId, "alternatives") : "/app/projects",
      done: hasChosenAlternative,
    },
    {
      key: "preview3d",
      label: "Lihat preview 3D",
      icon: Box,
      href: firstProjectId ? stageHref(firstProjectId, "preview-3d") : "/app/projects",
      done: seen.has("preview3d"),
    },
    {
      key: "rab",
      label: "Cek estimasi RAB",
      icon: Calculator,
      href: firstProjectId ? stageHref(firstProjectId, "rab") : "/app/projects",
      done: seen.has("rab"),
    },
  ]

  const doneCount = steps.filter((s) => s.done).length
  const allDone = doneCount === steps.length

  // Tunggu query pertama selesai supaya tak sempat kelip "0/4" lalu hilang
  // begitu data project datang.
  if (isLoading || dismissed || allDone) return null

  return (
    <Card data-testid="onboarding-checklist" className="border-primary/20">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex flex-1 items-center gap-2 text-left"
              aria-expanded={open}
            >
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  !open && "-rotate-90"
                )}
              />
              <span className="text-sm font-semibold">
                Mulai di Baruma
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {doneCount}/{steps.length} selesai
              </span>
            </button>
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Tutup checklist onboarding"
            onClick={dismiss}
          >
            <X className="size-4" />
          </Button>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="grid gap-2 pt-0 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step) => (
              <Link
                key={step.key}
                href={step.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border p-3 text-sm transition-colors hover:bg-accent",
                  step.done && "border-success/30 bg-success/5"
                )}
              >
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full",
                    step.done
                      ? "bg-success text-success-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {step.done ? (
                    <Check className="size-4" />
                  ) : (
                    <step.icon className="size-3.5" />
                  )}
                </span>
                <span
                  className={cn(
                    "font-medium",
                    step.done && "text-muted-foreground line-through"
                  )}
                >
                  {step.label}
                </span>
              </Link>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
