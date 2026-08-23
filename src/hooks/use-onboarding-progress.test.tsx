import { describe, it, expect, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

import {
  markOnboardingSeen,
  useOnboardingSeen,
  useOnboardingDismissed,
} from "./use-onboarding-progress"

afterEach(() => {
  window.localStorage.clear()
})

describe("markOnboardingSeen / useOnboardingSeen", () => {
  it("starts empty when nothing has been marked", () => {
    const { result } = renderHook(() => useOnboardingSeen())
    expect(result.current.size).toBe(0)
  })

  it("useOnboardingSeen reflects a milestone marked before mount", () => {
    markOnboardingSeen("preview3d")

    const { result } = renderHook(() => useOnboardingSeen())
    expect(result.current.has("preview3d")).toBe(true)
    expect(result.current.has("rab")).toBe(false)
  })

  it("accumulates multiple milestones across calls", () => {
    markOnboardingSeen("preview3d")
    markOnboardingSeen("rab")

    const { result } = renderHook(() => useOnboardingSeen())
    expect(result.current.has("preview3d")).toBe(true)
    expect(result.current.has("rab")).toBe(true)
  })

  it("is idempotent — marking the same milestone twice does not duplicate", () => {
    markOnboardingSeen("rab")
    markOnboardingSeen("rab")

    const raw = window.localStorage.getItem("baruma:onboarding:seen")
    expect(JSON.parse(raw ?? "[]")).toEqual(["rab"])
  })
})

describe("useOnboardingDismissed", () => {
  it("starts not dismissed", () => {
    const { result } = renderHook(() => useOnboardingDismissed())
    expect(result.current[0]).toBe(false)
  })

  it("persists dismissal to localStorage and updates state", () => {
    const { result } = renderHook(() => useOnboardingDismissed())

    act(() => {
      result.current[1]()
    })

    expect(result.current[0]).toBe(true)
    expect(window.localStorage.getItem("baruma:onboarding:dismissed")).toBe("1")
  })

  it("a fresh mount after dismissal starts dismissed (persisted across sessions)", () => {
    const first = renderHook(() => useOnboardingDismissed())
    act(() => {
      first.result.current[1]()
    })

    const second = renderHook(() => useOnboardingDismissed())
    expect(second.result.current[0]).toBe(true)
  })
})
