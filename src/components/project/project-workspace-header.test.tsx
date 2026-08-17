import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { toast } from "sonner"

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

const projectMock = { value: vi.fn() }
const renameMock = { value: vi.fn() }
vi.mock("@/lib/api/hooks", () => ({
  useProject: (...args: unknown[]) => projectMock.value(...args),
  useRenameProject: (...args: unknown[]) => renameMock.value(...args),
}))

const trackMock = { value: vi.fn() }
vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock.value(...args),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import { ProjectWorkspaceHeader } from "./project-workspace-header"

function renderHeader(projectId = "proj-123") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ProjectWorkspaceHeader projectId={projectId} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  renameMock.value.mockReturnValue({ mutate: vi.fn(), isPending: false })
})

afterEach(() => {
  cleanup()
  projectMock.value.mockReset()
  trackMock.value.mockReset()
  renameMock.value.mockReset()
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  vi.mocked(toast.info).mockReset()
  vi.stubGlobal("open", vi.fn())
})

describe("ProjectWorkspaceHeader — share dialog", () => {
  it("opens the share dialog and shows a copyable link to the review page", async () => {
    projectMock.value.mockReturnValue({
      data: { id: "proj-123", name: "Rumah Qyfa", readiness: "concept_ready" },
      isLoading: false,
    })

    renderHeader()
    await fireEvent.click(screen.getByRole("button", { name: /Bagikan/i }))

    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByText("Bagikan project")).toBeTruthy()
    const input = screen.getByDisplayValue(/app\/projects\/proj-123\/review/)
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).readOnly).toBe(true)
  })

  it("tracks the share_click event when the dialog opens", async () => {
    projectMock.value.mockReturnValue({
      data: { id: "proj-123", name: "Rumah Qyfa", readiness: "concept_ready" },
      isLoading: false,
    })

    renderHeader()
    await fireEvent.click(screen.getByRole("button", { name: /Bagikan/i }))

    await waitFor(() =>
      expect(trackMock.value).toHaveBeenCalledWith("share_clicked", { project_id: "proj-123" })
    )
  })

  it("copies the share link to the clipboard", async () => {
    projectMock.value.mockReturnValue({
      data: { id: "proj-123", name: "Rumah Qyfa", readiness: "concept_ready" },
      isLoading: false,
    })

    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })

    renderHeader()
    await fireEvent.click(screen.getByRole("button", { name: /Bagikan/i }))
    await fireEvent.click(screen.getByRole("button", { name: /Salin tautan/i }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("/app/projects/proj-123/review")
      )
      expect(toast.success).toHaveBeenCalledWith("Tautan disalin.")
    })
  })

  it("opens WhatsApp share in a new tab", async () => {
    projectMock.value.mockReturnValue({
      data: { id: "proj-123", name: "Rumah Qyfa", readiness: "concept_ready" },
      isLoading: false,
    })

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)

    renderHeader()
    await fireEvent.click(screen.getByRole("button", { name: /Bagikan/i }))
    await fireEvent.click(screen.getByRole("button", { name: /WhatsApp/i }))

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://wa.me/?text="),
      "_blank",
      "noopener,noreferrer"
    )
    openSpy.mockRestore()
  })

  it("opens the preview link in a new tab", async () => {
    projectMock.value.mockReturnValue({
      data: { id: "proj-123", name: "Rumah Qyfa", readiness: "concept_ready" },
      isLoading: false,
    })

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)

    renderHeader()
    await fireEvent.click(screen.getByRole("button", { name: /Bagikan/i }))
    await fireEvent.click(screen.getByRole("button", { name: /Buka pratinjau tautan/i }))

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("/app/projects/proj-123/review"),
      "_blank",
      "noopener,noreferrer"
    )
    openSpy.mockRestore()
  })
})

describe("ProjectWorkspaceHeader — rename dialog", () => {
  it("opens rename dialog via pencil button with current name prefilled", async () => {
    projectMock.value.mockReturnValue({
      data: { id: "proj-123", name: "Rumah Qyfa", readiness: "concept_ready" },
      isLoading: false,
    })

    renderHeader()
    await fireEvent.click(screen.getByRole("button", { name: /Ganti nama project/i }))

    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByDisplayValue("Rumah Qyfa")).toBeTruthy()
  })

  it("calls rename mutation with new name and closes dialog on success", async () => {
    projectMock.value.mockReturnValue({
      data: { id: "proj-123", name: "Rumah Qyfa", readiness: "concept_ready" },
      isLoading: false,
    })
    const mutate = vi.fn((_vars, opts) => opts?.onSuccess?.({ id: "proj-123", name: "Rumah Baru" }))
    renameMock.value.mockReturnValue({ mutate, isPending: false })

    renderHeader()
    await fireEvent.click(screen.getByRole("button", { name: /Ganti nama project/i }))
    const input = screen.getByDisplayValue("Rumah Qyfa")
    fireEvent.change(input, { target: { value: "Rumah Baru" } })
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }))

    expect(mutate).toHaveBeenCalledWith(
      { projectId: "proj-123", name: "Rumah Baru" },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Nama project diperbarui.")
    })
  })
})
