import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react"
import { toast } from "sonner"

const updateProject = vi.fn()
vi.mock("@/lib/data", () => ({
  data: {
    updateProject: (id: string, patch: unknown) => updateProject(id, patch),
  },
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RenameProjectDialog } from "./rename-project-dialog"

function renderDialog(props: Partial<React.ComponentProps<typeof RenameProjectDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onOpenChange = vi.fn()
  const utils = render(
    <QueryClientProvider client={qc}>
      <RenameProjectDialog
        projectId="proj-1"
        currentName="Rumah Qyfa"
        open
        onOpenChange={onOpenChange}
        {...props}
      />
    </QueryClientProvider>
  )
  return { ...utils, onOpenChange }
}

afterEach(() => {
  cleanup()
  updateProject.mockReset()
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

describe("RenameProjectDialog", () => {
  it("menampilkan nama saat ini di input", () => {
    renderDialog()
    expect(screen.getByDisplayValue("Rumah Qyfa")).toBeTruthy()
  })

  it("tombol Simpan disabled saat nama belum berubah", () => {
    renderDialog()
    expect(
      (screen.getByRole("button", { name: "Simpan" }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it("tombol Simpan disabled saat nama < 2 karakter", () => {
    renderDialog()
    const input = screen.getByDisplayValue("Rumah Qyfa")
    fireEvent.change(input, { target: { value: "A" } })
    expect(
      (screen.getByRole("button", { name: "Simpan" }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(screen.getByText(/minimal 2 karakter/i)).toBeTruthy()
  })

  it("menyimpan nama baru dan menutup dialog saat sukses", async () => {
    updateProject.mockResolvedValue({ id: "proj-1", name: "Rumah Baru" })
    const { onOpenChange } = renderDialog()
    const input = screen.getByDisplayValue("Rumah Qyfa")
    fireEvent.change(input, { target: { value: "Rumah Baru" } })
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }))

    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith("proj-1", { name: "Rumah Baru" })
      expect(toast.success).toHaveBeenCalledWith("Nama project diperbarui.")
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it("submit via Enter memicu simpan", async () => {
    updateProject.mockResolvedValue({ id: "proj-1", name: "Rumah Baru" })
    renderDialog()
    const input = screen.getByDisplayValue("Rumah Qyfa")
    fireEvent.change(input, { target: { value: "Rumah Baru" } })
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith("proj-1", { name: "Rumah Baru" })
    })
  })

  it("menampilkan toast error saat mutation gagal", async () => {
    updateProject.mockRejectedValue(new Error("network"))
    renderDialog()
    const input = screen.getByDisplayValue("Rumah Qyfa")
    fireEvent.change(input, { target: { value: "Rumah Baru" } })
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Gagal mengganti nama project.")
    })
  })
})
