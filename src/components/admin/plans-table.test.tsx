import { describe, it, expect, vi, beforeAll, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { PlanRow } from "@/types"

// jsdom doesn't implement ResizeObserver — Radix Select's trigger measures
// itself via @radix-ui/react-use-size as soon as it mounts (even closed),
// which the plan-form's Periode <Select> does inside the edit dialog.
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error - test-only stub, not a full ResizeObserver
  window.ResizeObserver = ResizeObserverStub
})

const getAdminPlans = vi.fn()
const updatePlan = vi.fn()

// PlansTable's hooks (useAdminPlans/useUpdatePlan) wrap data.* in
// useQuery/useMutation — mocking the data-source boundary exercises the
// real hooks + component, mirroring src/app/app/billing/page.test.tsx.
vi.mock("@/lib/data", () => ({
  data: {
    getAdminPlans: (...args: unknown[]) => getAdminPlans(...args),
    updatePlan: (...args: unknown[]) => updatePlan(...args),
  },
}))

import { PlansTable } from "./plans-table"

function fakePlan(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: "pro",
    name: "Pro",
    priceIdr: 149000,
    period: "month",
    tagline: "Tagline pro",
    featured: true,
    sortOrder: 1,
    active: true,
    features: ["Fitur A", "Fitur B"],
    limits: ["Batas A"],
    entitlements: {
      creditsPerPeriod: 100,
      maxProjects: 10,
      exportPdf: true,
      glbUpload: true,
      aiRenderHd: true,
    },
    ...overrides,
  }
}

function renderTable() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PlansTable />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  getAdminPlans.mockReset()
  updatePlan.mockReset()
})

describe("PlansTable", () => {
  it("renders a row per plan with name, formatted price, and the Populer badge", async () => {
    getAdminPlans.mockResolvedValue([fakePlan(), fakePlan({ id: "free", name: "Free", priceIdr: 0, featured: false })])
    renderTable()

    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
    expect(screen.getByText("Rp 149rb")).toBeTruthy()
    expect(screen.getByText("Free")).toBeTruthy()
    expect(screen.getByText("Gratis")).toBeTruthy()
    expect(screen.getByText("Populer")).toBeTruthy()
  })

  it("shows an empty state when there are no plans", async () => {
    getAdminPlans.mockResolvedValue([])
    renderTable()
    await waitFor(() => expect(screen.getByText("Belum ada plan.")).toBeTruthy())
  })

  it("toggling the Aktif switch calls updatePlan with the flipped field", async () => {
    getAdminPlans.mockResolvedValue([fakePlan()])
    updatePlan.mockResolvedValue(fakePlan({ active: false }))
    renderTable()

    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
    fireEvent.click(screen.getByRole("switch", { name: "Aktifkan plan Pro" }))

    await waitFor(() => expect(updatePlan).toHaveBeenCalled())
    const payload = updatePlan.mock.calls[0][0] as PlanRow
    expect(payload.id).toBe("pro")
    expect(payload.active).toBe(false)
  })

  it("opens the edit dialog with aria-labeled inputs and submits the updated payload", async () => {
    getAdminPlans.mockResolvedValue([fakePlan()])
    updatePlan.mockResolvedValue(fakePlan({ priceIdr: 199000 }))
    renderTable()

    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Edit plan Pro" }))

    const priceInput = await screen.findByLabelText("Harga plan dalam rupiah")
    // Spot-check a sampling of the required aria-labels are present.
    expect(screen.getByLabelText("Nama plan")).toBeTruthy()
    expect(screen.getByLabelText("Periode plan")).toBeTruthy()
    expect(screen.getByLabelText("Tagline plan")).toBeTruthy()
    expect(screen.getByLabelText("Urutan tampil plan")).toBeTruthy()
    expect(screen.getByLabelText("Tandai plan sebagai unggulan")).toBeTruthy()
    expect(screen.getByLabelText("Aktifkan plan")).toBeTruthy()
    expect(screen.getByLabelText("Daftar fitur plan, satu per baris")).toBeTruthy()
    expect(screen.getByLabelText("Daftar batasan plan, satu per baris")).toBeTruthy()
    expect(screen.getByLabelText("Kredit AI per periode")).toBeTruthy()
    expect(
      screen.getByLabelText("Maksimal jumlah proyek (kosongkan untuk tanpa batas)")
    ).toBeTruthy()
    expect(screen.getByLabelText("Izinkan export PDF")).toBeTruthy()
    expect(screen.getByLabelText("Izinkan upload model GLB")).toBeTruthy()

    fireEvent.change(priceInput, { target: { value: "199000" } })
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }))

    await waitFor(() => expect(updatePlan).toHaveBeenCalled())
    const payload = updatePlan.mock.calls[0][0] as PlanRow
    expect(payload.id).toBe("pro")
    expect(payload.priceIdr).toBe(199000)
  })
})
