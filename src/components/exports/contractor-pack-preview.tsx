"use client"

import { Eye } from "lucide-react"

import type { ReadinessStatus, ThumbnailVariant } from "@/types"
import { COPY } from "@/lib/constants"
import { Logo } from "@/components/shared/logo"
import { ReadinessBadge } from "@/components/shared/readiness-badge"
import { LayoutThumbnail } from "@/components/shared/layout-thumbnail"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const SECTIONS = [
  "Ringkasan proyek & data tanah",
  "Denah 2D per lantai",
  "Pratinjau 3D",
  "RAB / estimasi biaya ringkas",
  "Catatan risiko & checklist review",
]

export function ContractorPackPreview({
  projectName,
  location,
  thumbnail,
  readiness,
}: {
  projectName: string
  location?: string
  thumbnail: ThumbnailVariant
  readiness: ReadinessStatus
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Eye /> Preview
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pratinjau Contractor Pack</DialogTitle>
        </DialogHeader>

        {/* Mock document page */}
        <div className="relative overflow-hidden rounded-lg border bg-white text-neutral-900 shadow-sm">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <span className="rotate-[-28deg] text-5xl font-bold tracking-widest text-neutral-900/5">
              DRAFT
            </span>
          </div>

          <div className="relative space-y-4 p-5">
            <div className="flex items-center justify-between">
              <Logo size="sm" />
              <ReadinessBadge status={readiness} size="sm" />
            </div>

            <div>
              <p className="text-xs tracking-wide text-neutral-500 uppercase">
                Paket Diskusi Kontraktor
              </p>
              <h3 className="text-lg font-semibold">{projectName}</h3>
              {location && (
                <p className="text-sm text-neutral-500">{location}</p>
              )}
            </div>

            <LayoutThumbnail
              variant={thumbnail}
              className="aspect-[16/10] border"
            />

            <div>
              <p className="mb-1.5 text-xs font-medium text-neutral-500">
                Isi paket
              </p>
              <ol className="space-y-1 text-sm">
                {SECTIONS.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-neutral-400">{i + 1}.</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>

            <p className="border-t pt-2 text-[0.7rem] text-neutral-500">
              {COPY.draftNotice}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
