import * as React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const saveInterior = vi.fn()
vi.mock("@/lib/data", () => ({
  data: {
    saveInterior: (id: string, payload: unknown) => saveInterior(id, payload),
    getInterior: vi.fn(async () => null),
  },
}))

import { useInteriorAutosave } from "./use-interior-autosave"
import { useInteriorStore } from "@/stores/interior-store"
import { generateInteriorPlan } from "@/lib/interior/plan"
import { makeLayout } from "@/test-utils/fixtures"

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe("useInteriorAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveInterior.mockClear()
    saveInterior.mockReset() // Reset to default implementation
    const layout = makeLayout()
    const plan = generateInteriorPlan(layout, { projectId: "p1", style: "modern_tropical" })
    useInteriorStore.setState({ projectId: "p1", layout, plan, dirty: false, style: "modern_tropical" })
  })
  afterEach(() => vi.useRealTimers())

  it("saves once after a debounce when the store turns dirty", async () => {
    saveInterior.mockImplementation(async (_id: string, payload: unknown) => payload)
    renderHook(() => useInteriorAutosave("p1"), { wrapper })
    expect(saveInterior).not.toHaveBeenCalled()

    act(() => {
      useInteriorStore.setState({ dirty: true })
    })
    // before debounce elapses: no save
    act(() => { vi.advanceTimersByTime(500) })
    expect(saveInterior).not.toHaveBeenCalled()
    // after debounce: exactly one save
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(saveInterior).toHaveBeenCalledTimes(1)
  })

  it("keeps store dirty and returns error status when autosave rejects", async () => {
    // Set up the mock to reject for this test
    saveInterior.mockImplementation(async () => {
      throw new Error("boom")
    })

    const { result } = renderHook(() => useInteriorAutosave("p1"), { wrapper })

    act(() => {
      useInteriorStore.setState({ dirty: true })
    })
    expect(useInteriorStore.getState().dirty).toBe(true)

    // Advance past debounce; mutation will fire
    act(() => {
      vi.advanceTimersByTime(800)
    })

    // Flush all pending promises to let the mutation settle
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    // Verify the mutation was attempted
    expect(saveInterior).toHaveBeenCalled()
    // And the hook's status should be "error"
    expect(result.current).toBe("error")
    // After rejection: store should still be dirty (markSaved not called on error)
    expect(useInteriorStore.getState().dirty).toBe(true)
  })
})
