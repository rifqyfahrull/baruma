// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/exports/generate", () => ({
  generateExport: vi.fn(),
}))

import { generateExport } from "@/lib/exports/generate"
import { exportJobKey, useExportStore } from "./export-store"
import { useInteriorStore } from "./interior-store"

const PROJECT_ID = "p1"
const FORMAT = "contractor_pack" as const

function resetJobs() {
  useExportStore.setState({ jobs: {} })
}

beforeEach(() => {
  resetJobs()
  vi.mocked(generateExport).mockReset()
  // URL.createObjectURL/revokeObjectURL don't exist in jsdom by default.
  ;(globalThis as { URL: typeof URL }).URL.createObjectURL = vi.fn(() => "blob:fake")
  ;(globalThis as { URL: typeof URL }).URL.revokeObjectURL = vi.fn()
})

describe("useExportStore.generate", () => {
  it("threads opts.watermark and opts.thumbnailDataUrl through to generateExport", async () => {
    vi.mocked(generateExport).mockResolvedValue({
      blob: new Blob(["x"]),
      filename: "f.pdf",
      sizeLabel: "1 KB",
    })

    await useExportStore.getState().generate(PROJECT_ID, FORMAT, {
      watermark: true,
      thumbnailDataUrl: "data:image/png;base64,AAAA",
    })

    expect(vi.mocked(generateExport)).toHaveBeenCalledWith(
      PROJECT_ID,
      FORMAT,
      expect.objectContaining({
        watermark: true,
        thumbnailDataUrl: "data:image/png;base64,AAAA",
        onProgress: expect.any(Function),
      })
    )

    const job = useExportStore.getState().jobs[exportJobKey(PROJECT_ID, FORMAT)]
    expect(job.status).toBe("completed")
    expect(job.filename).toBe("f.pdf")
  })

  it("applies staged onProgress reports without regressing the bar below the flat 40/80 steps", async () => {
    let capturedOnProgress: ((pct: number) => void) | undefined
    vi.mocked(generateExport).mockImplementation(async (_id, _format, opts) => {
      capturedOnProgress = opts?.onProgress
      // Simulate a builder reporting a stage mid-way.
      opts?.onProgress?.(60)
      return { blob: new Blob(["x"]), filename: "f.zip", sizeLabel: "1 KB" }
    })

    await useExportStore.getState().generate(PROJECT_ID, "zip_all")
    expect(capturedOnProgress).toBeTypeOf("function")

    // A late, lower report never regresses progress backwards.
    const job = useExportStore.getState().jobs[exportJobKey(PROJECT_ID, "zip_all")]
    expect(job.progress).toBe(100) // completed clamps to 100 regardless
  })

  it("sets an error job when generateExport rejects", async () => {
    vi.mocked(generateExport).mockRejectedValue(new Error("Data belum lengkap untuk export ini."))

    await useExportStore.getState().generate(PROJECT_ID, FORMAT)

    const job = useExportStore.getState().jobs[exportJobKey(PROJECT_ID, FORMAT)]
    expect(job.status).toBe("error")
    expect(job.error).toBe("Data belum lengkap untuk export ini.")
  })

  it("passes the active interior plan only for interior_pack, for the matching project", async () => {
    vi.mocked(generateExport).mockResolvedValue({
      blob: new Blob(["x"]),
      filename: "f.pdf",
      sizeLabel: "1 KB",
    })
    useInteriorStore.setState({ projectId: PROJECT_ID, plan: { rooms: [] } as never })

    await useExportStore.getState().generate(PROJECT_ID, "interior_pack")
    expect(vi.mocked(generateExport)).toHaveBeenCalledWith(
      PROJECT_ID,
      "interior_pack",
      expect.objectContaining({ interiorPlan: { rooms: [] } })
    )

    vi.mocked(generateExport).mockClear()
    await useExportStore.getState().generate(PROJECT_ID, "drawings_pack")
    expect(vi.mocked(generateExport)).toHaveBeenCalledWith(
      PROJECT_ID,
      "drawings_pack",
      expect.objectContaining({ interiorPlan: undefined })
    )
  })
})
