import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { Project } from "@/types"

const listProjects = vi.fn()

vi.mock("@/lib/data", () => ({
  data: {
    listProjects: (...args: unknown[]) => listProjects(...args),
  },
}))

import { OnboardingChecklist } from "./onboarding-checklist"

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Rumah Test",
    status: "draft",
    readiness: "concept_ready",
    projectType: "new",
    thumbnail: "compact",
    site: { widthM: 8, depthM: 12, areaM2: 96 },
    floors: 1,
    rooftop: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

function renderChecklist() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <OnboardingChecklist />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  listProjects.mockReset()
  window.localStorage.clear()
})

describe("OnboardingChecklist", () => {
  it("renders nothing while projects are loading", () => {
    listProjects.mockReturnValue(new Promise(() => {}))
    renderChecklist()
    expect(screen.queryByTestId("onboarding-checklist")).toBeNull()
  })

  it("shows step 1 done and steps 2-4 pending for a user with a fresh, unstarted project", async () => {
    listProjects.mockResolvedValue([baseProject()])

    renderChecklist()

    const card = await screen.findByTestId("onboarding-checklist")
    expect(within(card).getByText("1/4 selesai")).toBeTruthy()

    const projectStep = within(card).getByText("Buat project pertama").closest("a")
    const altStep = within(card).getByText("Pilih alternatif layout").closest("a")
    expect(projectStep?.className).toContain("border-success/30")
    expect(altStep?.className).not.toContain("border-success/30")
  })

  it("marks 'Pilih alternatif layout' done once a project has currentVersionId", async () => {
    listProjects.mockResolvedValue([baseProject({ currentVersionId: "ver-1" })])

    renderChecklist()

    const card = await screen.findByTestId("onboarding-checklist")
    expect(within(card).getByText("2/4 selesai")).toBeTruthy()
  })

  it("marks preview3d/rab steps done from localStorage (markOnboardingSeen)", async () => {
    window.localStorage.setItem(
      "baruma:onboarding:seen",
      JSON.stringify(["preview3d", "rab"])
    )
    listProjects.mockResolvedValue([baseProject()])

    renderChecklist()

    const card = await screen.findByTestId("onboarding-checklist")
    expect(within(card).getByText("3/4 selesai")).toBeTruthy()
  })

  it("renders nothing once all 4 steps are complete", () => {
    window.localStorage.setItem(
      "baruma:onboarding:seen",
      JSON.stringify(["preview3d", "rab"])
    )
    listProjects.mockResolvedValue([baseProject({ currentVersionId: "ver-1" })])

    renderChecklist()

    // Query resolves asynchronously — assert it stays absent after settling.
    return waitFor(() => {
      expect(listProjects).toHaveBeenCalled()
    }).then(() => {
      expect(screen.queryByTestId("onboarding-checklist")).toBeNull()
    })
  })

  it("hides the checklist and persists dismissal after clicking the close button", async () => {
    listProjects.mockResolvedValue([baseProject()])

    const { unmount } = renderChecklist()
    const card = await screen.findByTestId("onboarding-checklist")
    const closeBtn = within(card).getByRole("button", {
      name: "Tutup checklist onboarding",
    })
    closeBtn.click()

    await waitFor(() =>
      expect(screen.queryByTestId("onboarding-checklist")).toBeNull()
    )
    expect(window.localStorage.getItem("baruma:onboarding:dismissed")).toBe("1")

    // A fresh mount (e.g. next dashboard visit) stays dismissed.
    unmount()
    renderChecklist()
    await waitFor(() => expect(listProjects).toHaveBeenCalled())
    expect(screen.queryByTestId("onboarding-checklist")).toBeNull()
  })
})
