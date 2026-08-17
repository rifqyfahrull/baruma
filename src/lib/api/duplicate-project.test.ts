import { describe, it, expect, vi, beforeEach } from "vitest"

const getProject = vi.fn()
const getBrief = vi.fn()
const createProject = vi.fn()
const getLayoutDocument = vi.fn()
const saveLayout = vi.fn()
const getInterior = vi.fn()
const saveInterior = vi.fn()
vi.mock("@/lib/data", () => ({
  data: {
    getProject: (id: string) => getProject(id),
    getBrief: (id: string) => getBrief(id),
    createProject: (input: unknown) => createProject(input),
    getLayoutDocument: (id: string) => getLayoutDocument(id),
    saveLayout: (id: string, input: unknown) => saveLayout(id, input),
    getInterior: (id: string) => getInterior(id),
    saveInterior: (id: string, payload: unknown) => saveInterior(id, payload),
  },
}))

vi.mock("@/lib/brief/brief-to-form", () => ({
  briefToFormValues: vi.fn(() => ({ name: "Rumah A" })),
}))

import { duplicateProject } from "./duplicate-project"

describe("duplicateProject", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProject.mockResolvedValue({ id: "p1", name: "Rumah A", currentVersionId: "ver-p1" })
    getBrief.mockResolvedValue({ projectId: "p1" })
    createProject.mockResolvedValue({
      project: { id: "p2", name: "Rumah A (Salinan)", currentVersionId: "ver-p2" },
      brief: { projectId: "p2" },
    })
    getLayoutDocument.mockImplementation(async (id: string) =>
      id === "p1"
        ? { layout: { id: "layout-p1", projectId: "p1", versionId: "ver-p1", rooms: [] }, revision: 5 }
        : { layout: { id: "layout-p2", projectId: "p2", versionId: "ver-p2", rooms: [] }, revision: 1 }
    )
    saveLayout.mockImplementation(async (_id: string, input: { layout: unknown }) => ({
      layout: input.layout,
      revision: 2,
    }))
    getInterior.mockResolvedValue(null)
    saveInterior.mockResolvedValue(undefined)
  })

  it("membuat project baru bernama '(Salinan)' dari brief sumber", async () => {
    const result = await duplicateProject("p1")
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Rumah A (Salinan)" })
    )
    expect(result.id).toBe("p2")
  })

  it("menyalin denah sumber ke identitas layout project baru via revision guard", async () => {
    await duplicateProject("p1")
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

  it("menyalin interior bila project sumber punya interior", async () => {
    getInterior.mockResolvedValueOnce({ plan: { rooms: [] } })
    await duplicateProject("p1")
    expect(saveInterior).toHaveBeenCalledWith("p2", { plan: { rooms: [] } })
  })

  it("tidak memanggil saveInterior bila sumber tanpa interior", async () => {
    await duplicateProject("p1")
    expect(saveInterior).not.toHaveBeenCalled()
  })

  it("melempar bila project/brief sumber tidak ditemukan", async () => {
    getProject.mockResolvedValueOnce(null)
    await expect(duplicateProject("p1")).rejects.toThrow()
  })
})
