import * as React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const saveLayout = vi.fn()
vi.mock("@/lib/data", () => ({
  data: {
    saveLayout: (id: string, payload: unknown) => saveLayout(id, payload),
    getLayout: vi.fn(async () => null),
  },
}))

import { useLayoutAutosave } from "./use-layout-autosave"
import { useEditorStore } from "@/stores/editor-store"
import { ApiError } from "@/lib/data/http"
import { makeLayout } from "@/test-utils/fixtures"

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe("useLayoutAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveLayout.mockClear()
    saveLayout.mockReset() // Reset to default implementation
    const layout = makeLayout()
    useEditorStore.setState({
      layout,
      dirty: false,
      layoutRevision: 1,
      editSequence: 0,
    })
  })
  afterEach(() => vi.useRealTimers())

  it("saves once after a debounce when the store turns dirty", async () => {
    saveLayout.mockImplementation(async (_id: string, payload: { layout: unknown }) => ({
      layout: payload.layout,
      revision: 2,
    }))
    renderHook(() => useLayoutAutosave("p1"), { wrapper })
    expect(saveLayout).not.toHaveBeenCalled()

    act(() => {
      useEditorStore.setState({ dirty: true })
    })
    // before debounce elapses: no save
    act(() => { vi.advanceTimersByTime(1000) })
    expect(saveLayout).not.toHaveBeenCalled()
    // after debounce: exactly one save
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(saveLayout).toHaveBeenCalledTimes(1)
  })

  it("keeps dirty when another edit happens while a save is in-flight", async () => {
    const resolvers: Array<() => void> = []
    saveLayout.mockImplementation(async (_id: string, payload: { layout: unknown }) =>
      new Promise((resolve) => {
        resolvers.push(() => resolve({ layout: payload.layout, revision: 2 }))
      })
    )

    renderHook(() => useLayoutAutosave("p1"), { wrapper })

    act(() => {
      useEditorStore.setState({ dirty: true, editSequence: 1 })
    })
    await act(async () => {
      vi.advanceTimersByTime(1600)
    })
    expect(saveLayout).toHaveBeenCalled()

    act(() => {
      useEditorStore.setState({ dirty: true, editSequence: 2 })
    })
    await act(async () => {
      for (const resolve of resolvers) resolve()
      await vi.runAllTimersAsync()
    })

    expect(useEditorStore.getState().dirty).toBe(true)
    expect(useEditorStore.getState().layoutRevision).toBe(2)
  })

  it("stops autosaving and reports conflict when the server rejects with 409", async () => {
    saveLayout.mockImplementation(async () => {
      throw new ApiError("API PUT /projects/p1/layout → 409", 409)
    })

    const { result } = renderHook(() => useLayoutAutosave("p1"), { wrapper })

    act(() => {
      useEditorStore.setState({ dirty: true, editSequence: 1 })
    })
    await act(async () => {
      vi.advanceTimersByTime(1600)
      await vi.runAllTimersAsync()
    })

    expect(saveLayout).toHaveBeenCalledTimes(1)
    // 409 berarti tab lain sudah menyimpan revision lebih baru: autosave
    // berhenti (bukan retry dengan revision basi) dan user diberi pilihan.
    expect(result.current).toBe("conflict")
    expect(useEditorStore.getState().dirty).toBe(true)

    // Edit berikutnya TIDAK boleh memicu save baru selama konflik belum
    // diselesaikan lewat reload / simpan-sebagai-salinan.
    act(() => {
      useEditorStore.setState({ dirty: true, editSequence: 2 })
    })
    await act(async () => {
      vi.advanceTimersByTime(2000)
      await vi.runAllTimersAsync()
    })
    expect(saveLayout).toHaveBeenCalledTimes(1)
    expect(result.current).toBe("conflict")
  })

  it("keeps store dirty and returns error status when autosave rejects", async () => {
    // Set up the mock to reject for this test
    saveLayout.mockImplementation(async () => {
      throw new Error("boom")
    })

    const { result } = renderHook(() => useLayoutAutosave("p1"), { wrapper })

    act(() => {
      useEditorStore.setState({ dirty: true })
    })
    expect(useEditorStore.getState().dirty).toBe(true)

    // Advance past debounce; mutation will fire
    act(() => {
      vi.advanceTimersByTime(1500)
    })

    // Flush all pending promises to let the mutation settle
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    // Verify the mutation was attempted
    expect(saveLayout).toHaveBeenCalled()
    // And the hook's status should be "error"
    expect(result.current).toBe("error")
    // After rejection: store should still be dirty (markSaved not called on error)
    expect(useEditorStore.getState().dirty).toBe(true)
  })
})
