import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { toast } from "sonner"

import type { User } from "@/types"

const getCurrentUser = vi.fn()
const updateProfile = vi.fn()
vi.mock("@/lib/data", () => ({
  data: {
    getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
    updateProfile: (...args: unknown[]) => updateProfile(...args),
  },
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const updateUser = vi.fn()
const supabaseBrowserConfigured = vi.fn(() => true)
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { updateUser: (...args: unknown[]) => updateUser(...args) },
  }),
  supabaseBrowserConfigured: () => supabaseBrowserConfigured(),
}))

import ProfilePage from "./page"

const baseUser: User = {
  id: "u1",
  name: "Rifqy Fakhrul",
  email: "rifqy@example.com",
  plan: "free",
  creditsUsed: 2,
  creditsTotal: 10,
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ProfilePage />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  getCurrentUser.mockReset()
  updateProfile.mockReset()
  updateUser.mockReset()
  supabaseBrowserConfigured.mockReset()
  supabaseBrowserConfigured.mockReturnValue(true)
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

describe("ProfilePage — ganti nama", () => {
  it("menampilkan nama saat ini di input, tombol Simpan disabled saat belum berubah", async () => {
    getCurrentUser.mockResolvedValue(baseUser)
    renderPage()
    await waitFor(() =>
      expect(screen.getByDisplayValue("Rifqy Fakhrul")).toBeTruthy()
    )
    expect(
      (screen.getByRole("button", { name: "Simpan" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it("tombol Simpan disabled saat nama < 2 karakter", async () => {
    getCurrentUser.mockResolvedValue(baseUser)
    renderPage()
    const input = await screen.findByDisplayValue("Rifqy Fakhrul")
    fireEvent.change(input, { target: { value: "A" } })
    expect(
      (screen.getByRole("button", { name: "Simpan" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it("menyimpan nama baru dan menampilkan toast sukses", async () => {
    getCurrentUser.mockResolvedValue(baseUser)
    updateProfile.mockResolvedValue({ ...baseUser, name: "Nama Baru" })
    renderPage()
    const input = await screen.findByDisplayValue("Rifqy Fakhrul")
    fireEvent.change(input, { target: { value: "Nama Baru" } })
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }))

    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith({ name: "Nama Baru" })
      expect(toast.success).toHaveBeenCalledWith("Nama diperbarui.")
    })
  })

  it("menampilkan toast error saat mutation gagal", async () => {
    getCurrentUser.mockResolvedValue(baseUser)
    updateProfile.mockRejectedValue(new Error("network"))
    renderPage()
    const input = await screen.findByDisplayValue("Rifqy Fakhrul")
    fireEvent.change(input, { target: { value: "Nama Baru" } })
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Gagal memperbarui nama.")
    })
  })
})

describe("ProfilePage — ganti password", () => {
  it("menolak password < 8 karakter tanpa memanggil Supabase", async () => {
    getCurrentUser.mockResolvedValue(baseUser)
    renderPage()
    fireEvent.change(await screen.findByLabelText("Password baru"), {
      target: { value: "short" },
    })
    fireEvent.change(screen.getByLabelText("Ulangi password"), {
      target: { value: "short" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Simpan password" }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Password minimal 8 karakter.")
    })
    expect(updateUser).not.toHaveBeenCalled()
  })

  it("menolak saat konfirmasi password tidak cocok", async () => {
    getCurrentUser.mockResolvedValue(baseUser)
    renderPage()
    fireEvent.change(await screen.findByLabelText("Password baru"), {
      target: { value: "password123" },
    })
    fireEvent.change(screen.getByLabelText("Ulangi password"), {
      target: { value: "password456" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Simpan password" }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Konfirmasi password tidak cocok."
      )
    })
    expect(updateUser).not.toHaveBeenCalled()
  })

  it("memanggil supabase.auth.updateUser saat valid, lalu toast sukses & mengosongkan form", async () => {
    getCurrentUser.mockResolvedValue(baseUser)
    updateUser.mockResolvedValue({ error: null })
    renderPage()
    const pw = (await screen.findByLabelText(
      "Password baru"
    )) as HTMLInputElement
    const confirm = screen.getByLabelText(
      "Ulangi password"
    ) as HTMLInputElement
    fireEvent.change(pw, { target: { value: "password123" } })
    fireEvent.change(confirm, { target: { value: "password123" } })
    fireEvent.click(screen.getByRole("button", { name: "Simpan password" }))

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith({ password: "password123" })
      expect(toast.success).toHaveBeenCalledWith("Password diperbarui.")
    })
    expect(pw.value).toBe("")
    expect(confirm.value).toBe("")
  })

  it("menampilkan toast error saat Supabase menolak", async () => {
    getCurrentUser.mockResolvedValue(baseUser)
    updateUser.mockResolvedValue({ error: { message: "weak" } })
    renderPage()
    fireEvent.change(await screen.findByLabelText("Password baru"), {
      target: { value: "password123" },
    })
    fireEvent.change(screen.getByLabelText("Ulangi password"), {
      target: { value: "password123" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Simpan password" }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Gagal memperbarui password.")
    })
  })

  it("tidak memanggil Supabase saat belum dikonfigurasi (mode mock/dev)", async () => {
    getCurrentUser.mockResolvedValue(baseUser)
    supabaseBrowserConfigured.mockReturnValue(false)
    renderPage()
    fireEvent.change(await screen.findByLabelText("Password baru"), {
      target: { value: "password123" },
    })
    fireEvent.change(screen.getByLabelText("Ulangi password"), {
      target: { value: "password123" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Simpan password" }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Ganti password tidak tersedia di mode ini."
      )
    })
    expect(updateUser).not.toHaveBeenCalled()
  })
})
