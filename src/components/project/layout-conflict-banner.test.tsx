import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react"

const getProject = vi.fn()
const getBrief = vi.fn()
const getLayoutDocument = vi.fn()
const saveLayout = vi.fn()
const createProject = vi.fn()
vi.mock("@/lib/data", () => ({
  data: {
    getProject: (id: string) => getProject(id),
    getBrief: (id: string) => getBrief(id),
    getLayoutDocument: (id: string) => getLayoutDocument(id),
    saveLayout: (id: string, input: unknown) => saveLayout(id, input),
    createProject: (input: unknown) => createProject(input),
  },
}))

vi.mock("@/lib/brief/brief-to-form", () => ({
  briefToFormValues: vi.fn(() => ({ name: "Rumah A" })),
}))

import { LayoutConflictBanner } from "./layout-conflict-banner"
import { useSaveStatusStore } from "@/stores/save-status-store"
import { useEditorStore } from "@/stores/editor-store"
import { makeLayout } from "@/test-utils/fixtures"

describe("LayoutConflictBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.setState({ layout: makeLayout(), dirty: true })
    useSaveStatusStore.setState({ status: "conflict", dirty: true })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    useSaveStatusStore.getState().reset()
  })

  it("renders nothing when there is no save conflict", () => {
    useSaveStatusStore.setState({ status: "saved", dirty: false })
    const { container } = render(<LayoutConflictBanner projectId="p1" />)
    expect(container.firstChild).toBeNull()
  })

  it("shows the conflict banner with reload and save-as-copy choices", () => {
    render(<LayoutConflictBanner projectId="p1" />)
    expect(screen.getByTestId("layout-conflict-banner")).toBeTruthy()
    expect(screen.getByRole("button", { name: /muat ulang/i })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: /simpan sebagai salinan/i })
    ).toBeTruthy()
  })

  it("reloads the page when the user chooses reload", () => {
    const reload = vi.fn()
    vi.stubGlobal("location", { ...window.location, reload })

    render(<LayoutConflictBanner projectId="p1" />)
    fireEvent.click(screen.getByRole("button", { name: /muat ulang/i }))
    expect(reload).toHaveBeenCalled()
  })

  it("saves local edits into a duplicated project and navigates there", async () => {
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    getProject.mockResolvedValue({
      id: "p1",
      name: "Rumah A",
      currentVersionId: "ver-p1",
    })
    getBrief.mockResolvedValue({ projectId: "p1" })
    createProject.mockResolvedValue({
      project: { id: "p2", name: "Rumah A (Salinan)", currentVersionId: "ver-p2" },
      brief: { projectId: "p2" },
    })
    getLayoutDocument.mockResolvedValue({
      layout: { ...makeLayout(), id: "layout-p2", projectId: "p2", versionId: "ver-p2" },
      revision: 1,
    })
    saveLayout.mockImplementation(async (_id: string, input: { layout: unknown }) => ({
      layout: input.layout,
      revision: 2,
    }))

    render(<LayoutConflictBanner projectId="p1" />)
    fireEvent.click(screen.getByRole("button", { name: /simpan sebagai salinan/i }))

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("/app/projects/p2/editor")
    )

    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Rumah A (Salinan)" })
    )
    // Layout lokal (dengan edit yang belum tersimpan) ditulis ke project baru
    // memakai identitas layout project baru + revision hasil GET-nya.
    expect(saveLayout).toHaveBeenCalledWith(
      "p2",
      expect.objectContaining({
        expectedRevision: 1,
        layout: expect.objectContaining({
          id: "layout-p2",
          projectId: "p2",
          versionId: "ver-p2",
        }),
      })
    )
  })
})
