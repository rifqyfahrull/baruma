import { create } from "zustand"

import type { ExportFormat } from "@/types"
import { generateExport } from "@/lib/exports/generate"
import { useInteriorStore } from "@/stores/interior-store"

type Job = {
  status: "processing" | "completed" | "error"
  progress: number
  blobUrl?: string
  filename?: string
  fileSize?: string
  lastGeneratedAt?: string
  error?: string
}

type ExportStore = {
  jobs: Record<string, Job>
  generate: (projectId: string, format: ExportFormat) => Promise<void>
  download: (projectId: string, format: ExportFormat) => void
}

const key = (projectId: string, format: ExportFormat) => `${projectId}:${format}`

export const useExportStore = create<ExportStore>((set, get) => ({
  jobs: {},

  generate: async (projectId, format) => {
    const k = key(projectId, format)
    const existing = get().jobs[k]
    if (existing?.status === "processing") return // already running

    // Revoke any previous object URL to avoid memory leaks
    if (existing?.blobUrl) {
      URL.revokeObjectURL(existing.blobUrl)
    }

    set((s) => ({
      jobs: { ...s.jobs, [k]: { status: "processing", progress: 40 } },
    }))

    // Give the UI a tick to show the progress bar before heavy work starts
    await new Promise<void>((r) => setTimeout(r, 0))

    set((s) => ({
      jobs: { ...s.jobs, [k]: { ...s.jobs[k], progress: 80 } },
    }))

    try {
      const interiorState = useInteriorStore.getState()
      const interiorPlan =
        format === "interior_pack" && interiorState.projectId === projectId
          ? interiorState.plan ?? undefined
          : undefined
      const { blob, filename, sizeLabel } = await generateExport(projectId, format, {
        interiorPlan,
      })
      const blobUrl = URL.createObjectURL(blob)
      set((s) => ({
        jobs: {
          ...s.jobs,
          [k]: {
            status: "completed",
            progress: 100,
            blobUrl,
            filename,
            fileSize: sizeLabel,
            lastGeneratedAt: new Date().toISOString(),
          },
        },
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : "Terjadi kesalahan."
      set((s) => ({
        jobs: {
          ...s.jobs,
          [k]: { status: "error", progress: 0, error: message },
        },
      }))
    }
  },

  download: (projectId, format) => {
    const k = key(projectId, format)
    const job = get().jobs[k]
    if (!job?.blobUrl || !job.filename) return
    triggerDownload(job.blobUrl, job.filename)
  },
}))

export const exportJobKey = key

/** Triggers a browser file-download from an existing object URL. */
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
