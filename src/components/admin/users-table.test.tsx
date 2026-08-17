import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { AdminUserRow } from "@/types"

const getAdminUsers = vi.fn()
const updateUserRole = vi.fn()
const updateUserPlan = vi.fn()
const adjustUserCredits = vi.fn()
const createPhantomLogin = vi.fn()

vi.mock("@/lib/data", () => ({
  data: {
    getAdminUsers: (...args: unknown[]) => getAdminUsers(...args),
    updateUserRole: (...args: unknown[]) => updateUserRole(...args),
    updateUserPlan: (...args: unknown[]) => updateUserPlan(...args),
    adjustUserCredits: (...args: unknown[]) => adjustUserCredits(...args),
    createPhantomLogin: (...args: unknown[]) => createPhantomLogin(...args),
  },
}))

import { UsersTable } from "./users-table"

function fakeUser(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: "u1",
    name: "Budi Santoso",
    email: "budi@contoh.id",
    plan: "free",
    role: "user",
    creditsUsed: 2,
    creditsTotal: 10,
    ...overrides,
  }
}

function renderTable() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <UsersTable />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  getAdminUsers.mockReset()
  updateUserRole.mockReset()
  updateUserPlan.mockReset()
  adjustUserCredits.mockReset()
  createPhantomLogin.mockReset()
  vi.restoreAllMocks()
})

describe("UsersTable", () => {
  it("renders a row per user with name, email, credits, and select aria-labels", async () => {
    getAdminUsers.mockResolvedValue([fakeUser()])
    renderTable()

    await waitFor(() => expect(screen.getByText("Budi Santoso")).toBeTruthy())
    expect(screen.getByText("budi@contoh.id")).toBeTruthy()
    expect(screen.getByText("2/10")).toBeTruthy()
    expect(screen.getByLabelText("Ubah plan untuk Budi Santoso")).toBeTruthy()
    expect(screen.getByLabelText("Ubah role untuk Budi Santoso")).toBeTruthy()
  })

  it("shows an empty state when there are no users", async () => {
    getAdminUsers.mockResolvedValue([])
    renderTable()
    await waitFor(() =>
      expect(screen.getByText("Belum ada pengguna.")).toBeTruthy()
    )
  })

  it("opens the 'Sesuaikan kredit' dialog and submits delta + reason", async () => {
    getAdminUsers.mockResolvedValue([fakeUser()])
    adjustUserCredits.mockResolvedValue(undefined)
    renderTable()

    await waitFor(() => expect(screen.getByText("Budi Santoso")).toBeTruthy())
    fireEvent.click(
      screen.getByRole("button", { name: "Sesuaikan kredit untuk Budi Santoso" })
    )

    const deltaInput = await screen.findByLabelText(
      "Perubahan jumlah kredit (boleh negatif)"
    )
    const reasonInput = screen.getByLabelText("Alasan penyesuaian kredit")
    fireEvent.change(deltaInput, { target: { value: "50" } })
    fireEvent.change(reasonInput, { target: { value: "Bonus promo" } })
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }))

    await waitFor(() =>
      expect(adjustUserCredits).toHaveBeenCalledWith("u1", 50, "Bonus promo")
    )
  })

  it("does not submit the credits dialog when reason is empty", async () => {
    getAdminUsers.mockResolvedValue([fakeUser()])
    renderTable()

    await waitFor(() => expect(screen.getByText("Budi Santoso")).toBeTruthy())
    fireEvent.click(
      screen.getByRole("button", { name: "Sesuaikan kredit untuk Budi Santoso" })
    )
    await screen.findByLabelText("Alasan penyesuaian kredit")

    const submitButton = screen.getByRole("button", {
      name: "Simpan",
    }) as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)
    expect(adjustUserCredits).not.toHaveBeenCalled()
  })

  it("creates a phantom login and opens it in a new tab", async () => {
    getAdminUsers.mockResolvedValue([fakeUser()])
    createPhantomLogin.mockResolvedValue({
      url: "/app/dashboard#phantom_token=token-u1",
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    })
    const replace = vi.fn()
    const close = vi.fn()
    vi.spyOn(window, "open").mockReturnValue({
      opener: window,
      document: {
        title: "",
        body: { innerHTML: "" },
      },
      location: { replace },
      close,
    } as unknown as Window)

    renderTable()

    await waitFor(() => expect(screen.getByText("Budi Santoso")).toBeTruthy())
    fireEvent.click(
      screen.getByRole("button", { name: "Phantom login sebagai Budi Santoso" })
    )

    await waitFor(() => expect(createPhantomLogin).toHaveBeenCalledWith("u1"))
    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank")
    expect(replace).toHaveBeenCalledWith("/app/dashboard#phantom_token=token-u1")
    expect(close).not.toHaveBeenCalled()
  })
})
