import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { AiRenderJob, FeatureCapabilities } from "@/types"
import { sampleProject, makeLayout } from "@/test-utils/fixtures"
import { usePreviewStore } from "@/stores/preview-store"
import { ApiError } from "@/lib/data/http"

const capabilitiesRef: { current: FeatureCapabilities } = {
  current: {
    exterior_elements_v1: true,
    roof_zones_v1: true,
    presentation_mode_v1: true,
    ai_render_v1: true,
  },
}
vi.mock("@/hooks/use-project-capabilities", () => ({
  useProjectCapabilities: () => capabilitiesRef.current,
}))

const { getCurrentUserMock, listRendersMock, createRenderMock, getRenderMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  listRendersMock: vi.fn(),
  createRenderMock: vi.fn(),
  getRenderMock: vi.fn(),
}))
vi.mock("@/lib/data", () => ({
  data: {
    getCurrentUser: getCurrentUserMock,
    listRenders: listRendersMock,
    createRender: createRenderMock,
    getRender: getRenderMock,
  },
}))

// Upload leg (signed URL + PUT) di-bypass — sudah dites via
// requestRenderUploadUrl/route/hooks lain; di sini kita fokus pada
// orkestrasi UI + body yang dikirim ke createRender.
const { uploadRenderInputMock } = vi.hoisted(() => ({
  uploadRenderInputMock: vi.fn(async (_projectId: string, _dataUrl: string, filename: string) =>
    `renders/mock-user/proj-test/${filename}`
  ),
}))
vi.mock("@/lib/api/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/hooks")>()
  return { ...actual, uploadRenderInput: uploadRenderInputMock }
})

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn() },
}))
vi.mock("sonner", () => ({ toast: toastMock }))

import { AiRenderDialog } from "./ai-render-dialog"
import { TooltipProvider } from "@/components/ui/tooltip"

const freeUser = {
  id: "u1",
  name: "Uji",
  email: "uji@example.com",
  plan: "free" as const,
  creditsUsed: 3,
  creditsTotal: 10,
  entitlements: {
    creditsPerPeriod: 10,
    maxProjects: 1,
    exportPdf: false,
    glbUpload: false,
    aiRenderHd: false,
  },
}

const proUser = {
  ...freeUser,
  plan: "pro" as const,
  entitlements: { ...freeUser.entitlements, aiRenderHd: true },
}

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <AiRenderDialog project={sampleProject} layout={makeLayout()} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

function openDialog() {
  fireEvent.click(screen.getByTestId("ai-render-open"))
}

beforeEach(() => {
  listRendersMock.mockResolvedValue([])
  usePreviewStore.setState({
    captureRenderInputs: vi.fn(async () => ({
      beauty: "data:image/png;base64,AAAA",
      depth: "data:image/png;base64,BBBB",
      width: 10,
      height: 10,
    })),
  })
})

afterEach(() => {
  cleanup()
  getCurrentUserMock.mockReset()
  listRendersMock.mockReset()
  createRenderMock.mockReset()
  getRenderMock.mockReset()
  uploadRenderInputMock.mockClear()
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  usePreviewStore.setState({ captureRenderInputs: null })
})

describe("AiRenderDialog — gating Presisi (aiRenderHd)", () => {
  it("shows disabled Presisi with upsell hint on a free plan (locked, never hidden)", async () => {
    getCurrentUserMock.mockResolvedValue(freeUser)
    renderDialog()
    openDialog()

    fireEvent.click(screen.getByTestId("ai-render-mode-presisi"))

    await waitFor(() => {
      expect(screen.getByTestId("ai-render-locked-presisi")).toBeTruthy()
    })
    expect(screen.getByRole("link", { name: /Upgrade ke Pro/ })).toBeTruthy()
    const submit = screen.getByTestId("ai-render-submit") as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it("unlocks Presisi on a plan with aiRenderHd", async () => {
    getCurrentUserMock.mockResolvedValue(proUser)
    renderDialog()
    openDialog()

    fireEvent.click(screen.getByTestId("ai-render-mode-presisi"))

    await waitFor(() => {
      expect(screen.queryByTestId("ai-render-locked-presisi")).toBeNull()
    })
    const submit = screen.getByTestId("ai-render-submit") as HTMLButtonElement
    expect(submit.disabled).toBe(false)
  })
})

describe("AiRenderDialog — biaya kredit per mode", () => {
  it("shows the correct credit cost on the submit button per mode", async () => {
    getCurrentUserMock.mockResolvedValue(proUser)
    renderDialog()
    openDialog()

    expect(screen.getByTestId("ai-render-submit").textContent).toMatch(/Render — 1 kredit/)

    fireEvent.click(screen.getByTestId("ai-render-mode-presisi"))
    await waitFor(() => {
      expect(screen.getByTestId("ai-render-submit").textContent).toMatch(/Render — 2 kredit/)
    })
  })
})

describe("AiRenderDialog — alur submit happy path", () => {
  it("captures, uploads, and POSTs a body with mode/preset/inputKeys", async () => {
    getCurrentUserMock.mockResolvedValue(proUser)
    const job: AiRenderJob = {
      id: "rnd-1",
      status: "succeeded",
      mode: "cepat",
      preset: "tropis-siang",
      shotId: "iso-siang",
      watermarked: false,
      outputUrl: "/api/v1/assets/file/renders/rnd-1.png",
      createdAt: "2026-01-01T00:00:00.000Z",
    }
    createRenderMock.mockResolvedValue({ job, cached: false })
    getRenderMock.mockResolvedValue(job)

    renderDialog()
    openDialog()

    fireEvent.click(screen.getByTestId("ai-render-submit"))

    await waitFor(
      () => {
        expect(screen.getByTestId("ai-render-result-image")).toBeTruthy()
      },
      { timeout: 3000 }
    )

    expect(uploadRenderInputMock).toHaveBeenCalledWith(
      "proj-test",
      "data:image/png;base64,AAAA",
      expect.stringContaining("beauty")
    )
    expect(createRenderMock).toHaveBeenCalledTimes(1)
    const [projectIdArg, bodyArg] = createRenderMock.mock.calls[0]
    expect(projectIdArg).toBe("proj-test")
    expect(bodyArg).toMatchObject({
      mode: "cepat",
      preset: "tropis-siang",
      shotId: "iso-siang",
      inputKeys: { beauty: expect.stringContaining("beauty") },
    })
    expect(bodyArg.inputKeys.depth).toBeUndefined()
    expect(typeof bodyArg.clientRequestId).toBe("string")
    expect(bodyArg.clientRequestId.length).toBeGreaterThan(0)

    // Label kejujuran selalu tampil di hasil.
    expect(screen.getByText("Visualisasi konsep — bukan gambar kerja")).toBeTruthy()
  })

  it("does not call createRender when captureRenderInputs fails (no credit spent)", async () => {
    getCurrentUserMock.mockResolvedValue(proUser)
    usePreviewStore.setState({ captureRenderInputs: vi.fn(async () => null) })

    renderDialog()
    openDialog()
    fireEvent.click(screen.getByTestId("ai-render-submit"))

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled()
    })
    expect(createRenderMock).not.toHaveBeenCalled()
  })
})

describe("AiRenderDialog — error 402 insufficient_credits", () => {
  it("routes through handlePlanError (upgrade toast) instead of a generic error", async () => {
    getCurrentUserMock.mockResolvedValue(proUser)
    createRenderMock.mockRejectedValue(
      new ApiError("insufficient", 402, "insufficient_credits", { message: "Kredit habis." })
    )

    renderDialog()
    openDialog()
    fireEvent.click(screen.getByTestId("ai-render-submit"))

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "Kredit habis.",
        expect.objectContaining({ action: expect.objectContaining({ label: "Upgrade plan" }) })
      )
    })
    expect(screen.queryByTestId("ai-render-error")).toBeNull()
  })
})

describe("AiRenderDialog — Riwayat Render (galeri)", () => {
  it("renders history jobs with status badges", async () => {
    getCurrentUserMock.mockResolvedValue(proUser)
    listRendersMock.mockResolvedValue([
      {
        id: "rnd-a",
        status: "succeeded",
        mode: "cepat",
        preset: "tropis-siang",
        shotId: "iso-siang",
        watermarked: true,
        outputUrl: "/api/v1/assets/file/renders/a.png",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "rnd-b",
        status: "processing",
        mode: "presisi",
        preset: "malam",
        shotId: "depan-siang",
        watermarked: false,
        outputUrl: null,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "rnd-c",
        status: "failed",
        mode: "cepat",
        preset: "malam",
        shotId: "depan-siang",
        watermarked: false,
        outputUrl: null,
        errorMessage: "Provider gagal",
        createdAt: "2026-01-03T00:00:00.000Z",
      },
    ] satisfies AiRenderJob[])

    renderDialog()
    openDialog()
    // Radix Tabs mengganti tab lewat onMouseDown (bukan onClick) — lihat
    // @radix-ui/react-tabs TabsTrigger.
    fireEvent.mouseDown(screen.getByTestId("ai-render-tab-riwayat"), { button: 0 })

    await waitFor(() => {
      expect(screen.getByTestId("ai-render-gallery")).toBeTruthy()
    })
    expect(screen.getByTestId("ai-render-gallery-item-rnd-a")).toBeTruthy()
    expect(screen.getByTestId("ai-render-gallery-item-rnd-b")).toBeTruthy()
    expect(screen.getByTestId("ai-render-gallery-item-rnd-c")).toBeTruthy()
    expect(screen.getByText("Selesai")).toBeTruthy()
    expect(screen.getByText("Merender…")).toBeTruthy()
    expect(screen.getByText("Gagal")).toBeTruthy()
  })

  it("shows an empty state when there is no render yet", async () => {
    getCurrentUserMock.mockResolvedValue(proUser)
    listRendersMock.mockResolvedValue([])

    renderDialog()
    openDialog()
    // Radix Tabs mengganti tab lewat onMouseDown (bukan onClick) — lihat
    // @radix-ui/react-tabs TabsTrigger.
    fireEvent.mouseDown(screen.getByTestId("ai-render-tab-riwayat"), { button: 0 })

    await waitFor(() => {
      expect(screen.getByText(/Belum ada render/)).toBeTruthy()
    })
  })
})

describe("AiRenderDialog — flag ai_render_v1", () => {
  afterEach(() => {
    capabilitiesRef.current = { ...capabilitiesRef.current, ai_render_v1: true }
  })

  it("renders nothing (no entry point) when the flag is disabled", () => {
    getCurrentUserMock.mockResolvedValue(proUser)
    capabilitiesRef.current = { ...capabilitiesRef.current, ai_render_v1: false }
    const { container } = renderDialog()
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId("ai-render-open")).toBeNull()
  })
})
