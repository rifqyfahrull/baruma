import { describe, it, expect } from "vitest"
import { renderHook, act } from "@testing-library/react"

import { useFokusMode } from "@/hooks/use-fokus-mode"
import { useUIStore } from "@/stores/ui-store"

describe("useFokusMode", () => {
  it("renders safely outside SidebarProvider without throwing", () => {
    useUIStore.setState({ fokusMode: false })
    const { result } = renderHook(() => useFokusMode())

    expect(result.current.fokusMode).toBe(false)

    act(() => {
      result.current.toggle()
    })

    expect(result.current.fokusMode).toBe(true)
    expect(useUIStore.getState().fokusMode).toBe(true)
  })
})
