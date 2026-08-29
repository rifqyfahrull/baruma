import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

// jsdom tak mengimplementasikan scrollTo (dipakai efek auto-scroll pesan).
beforeEach(() => {
  Element.prototype.scrollTo = vi.fn()
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const messagesMock = { value: vi.fn() }
const sendMock = { value: vi.fn() }
const setStatusMock = { value: vi.fn() }
vi.mock("@/lib/api/hooks", () => ({
  useAssistantMessages: (...args: unknown[]) => messagesMock.value(...args),
  useSendProjectAgentMessage: (...args: unknown[]) => sendMock.value(...args),
  useSetAssistantStatus: (...args: unknown[]) => setStatusMock.value(...args),
}))

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock("sonner", () => ({ toast: toastMock }))

import { ProjectAgentPanel } from "./project-agent-panel"
import { useProjectAgentUiStore } from "@/stores/project-agent-ui-store"
import { useEditorStore } from "@/stores/editor-store"
import { usePreviewStore } from "@/stores/preview-store"
import { makeLayout, sampleSite } from "@/test-utils/fixtures"
import type { AssistantMessage } from "@/lib/assistant/actions"

beforeEach(() => {
  messagesMock.value.mockReturnValue({ data: [], isLoading: false })
  sendMock.value.mockReturnValue({ mutate: vi.fn(), isPending: false })
  setStatusMock.value.mockReturnValue({ mutate: vi.fn(), isPending: false })
  useProjectAgentUiStore.getState().reset()
})

afterEach(() => {
  cleanup()
  messagesMock.value.mockReset()
  sendMock.value.mockReset()
  setStatusMock.value.mockReset()
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  toastMock.info.mockReset()
})

describe("ProjectAgentPanel — credit hint (WS-D §5)", () => {
  it("shows a subtle '1 kredit per pesan' hint near the input", () => {
    render(<ProjectAgentPanel projectId="proj-123" surface="editor" />)
    expect(screen.getByText("1 kredit per pesan.")).toBeTruthy()
  })
})

describe("ProjectAgentPanel — aksi aiRender diintersep sebelum apply atomic (chat pre-fill dialog Render AI)", () => {
  const baseMessage: AssistantMessage = {
    id: "m1",
    projectId: "proj-test",
    mode: "floorplan",
    role: "assistant",
    content: "Usulan",
    actionLabels: ["Buka dialog Render AI", "Tambah gudang"],
    status: "proposed",
    createdAt: "2026-08-29T00:00:00.000Z",
    actions: [],
  }

  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
    usePreviewStore.setState({ aiRenderPrefill: null })
  })

  it("[aiRender, addRoom]: prefill terpanggil 1× dgn payload, HANYA addRoom di-apply, toast 'N perubahan' menghitung 1", () => {
    const mutateFn = vi.fn(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()
    )
    setStatusMock.value.mockReturnValue({ mutate: mutateFn, isPending: false })
    // spyOn di atas properti yang bisa saja SUDAH jadi spy (belum di-restore
    // dari test sebelumnya di describe ini) mengembalikan spy YANG SAMA
    // dgn riwayat panggilan lama — mockClear() mengisolasi assersi test ini.
    const prefillSpy = vi.spyOn(usePreviewStore.getState(), "requestAiRenderPrefill")
    prefillSpy.mockClear()

    const message: AssistantMessage = {
      ...baseMessage,
      actions: [
        { type: "aiRender", target: "interior", roomId: "r1", presetId: "tropis-siang", styleNotes: "hangat" },
        { type: "addRoom", roomType: "gudang" },
      ],
    }
    messagesMock.value.mockReturnValue({ data: [message], isLoading: false })

    render(<ProjectAgentPanel projectId="proj-test" surface="editor" />)
    const roomsBefore = useEditorStore.getState().layout!.rooms.length

    fireEvent.click(screen.getByRole("button", { name: /Terapkan/ }))

    expect(prefillSpy).toHaveBeenCalledTimes(1)
    expect(prefillSpy).toHaveBeenCalledWith({
      target: "interior",
      roomId: "r1",
      presetId: "tropis-siang",
      styleNotes: "hangat",
    })
    expect(toastMock.info).toHaveBeenCalledWith(
      "Dialog Render AI disiapkan — buka Preview 3D bila belum"
    )
    // hanya addRoom yang diterapkan — layout bertambah SATU ruang.
    expect(useEditorStore.getState().layout!.rooms.length).toBe(roomsBefore + 1)
    expect(toastMock.success).toHaveBeenCalledWith(
      "1 perubahan diterapkan sebagai satu langkah Undo."
    )
  })

  it("pesan berisi aiRender SAJA: prefill terpanggil, TANPA apply atomic, TANPA toast 'perubahan'", () => {
    const mutateFn = vi.fn()
    setStatusMock.value.mockReturnValue({ mutate: mutateFn, isPending: false })
    // spyOn di atas properti yang bisa saja SUDAH jadi spy (belum di-restore
    // dari test sebelumnya di describe ini) mengembalikan spy YANG SAMA
    // dgn riwayat panggilan lama — mockClear() mengisolasi assersi test ini.
    const prefillSpy = vi.spyOn(usePreviewStore.getState(), "requestAiRenderPrefill")
    prefillSpy.mockClear()

    const message: AssistantMessage = {
      ...baseMessage,
      actionLabels: ["Buka dialog Render AI"],
      actions: [{ type: "aiRender", target: "exterior" }],
    }
    messagesMock.value.mockReturnValue({ data: [message], isLoading: false })

    render(<ProjectAgentPanel projectId="proj-test" surface="editor" />)
    const layoutBefore = useEditorStore.getState().layout

    fireEvent.click(screen.getByRole("button", { name: /Terapkan/ }))

    expect(prefillSpy).toHaveBeenCalledTimes(1)
    expect(prefillSpy).toHaveBeenCalledWith({
      target: "exterior",
      roomId: undefined,
      presetId: undefined,
      styleNotes: undefined,
    })
    expect(toastMock.info).toHaveBeenCalledWith(
      "Dialog Render AI disiapkan — buka Preview 3D bila belum"
    )
    // layout TIDAK berubah — tak ada apply atomic dipanggil utk daftar kosong.
    expect(useEditorStore.getState().layout).toBe(layoutBefore)
    expect(toastMock.success).not.toHaveBeenCalled()
    // pesan tetap ditandai "applied" walau tak ada perubahan layout nyata —
    // supaya kartu usulan tak menggantung selamanya di "proposed".
    expect(mutateFn).toHaveBeenCalledWith({ messageId: "m1", status: "applied" })
  })
})
