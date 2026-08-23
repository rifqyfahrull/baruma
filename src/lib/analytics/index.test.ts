import { describe, it, expect, afterEach, vi } from "vitest"

import { track } from "./index"

type TestWindow = Window & {
  dataLayer?: Record<string, unknown>[]
  umami?: { track: (event: string, props?: Record<string, unknown>) => void }
}

afterEach(() => {
  const w = window as TestWindow
  delete w.dataLayer
  delete w.umami
})

describe("track()", () => {
  it("pushes to window.dataLayer (backward-compat transport)", () => {
    track("project_created", { project_id: "p1" })

    const w = window as TestWindow
    expect(w.dataLayer).toBeDefined()
    expect(w.dataLayer?.at(-1)).toMatchObject({
      event: "project_created",
      project_id: "p1",
    })
  })

  it("does not throw when window.umami is absent (script not loaded / env unset)", () => {
    expect(() => track("editor_opened", { project_id: "p1" })).not.toThrow()
  })

  it("forwards the event to window.umami.track when the Umami script has loaded", () => {
    const umamiTrack = vi.fn()
    ;(window as TestWindow).umami = { track: umamiTrack }

    track("rab_opened", { project_id: "p2" })

    expect(umamiTrack).toHaveBeenCalledWith("rab_opened", { project_id: "p2" })
  })

  it("still pushes to dataLayer even when Umami is present", () => {
    const umamiTrack = vi.fn()
    ;(window as TestWindow).umami = { track: umamiTrack }

    track("preview_3d_opened", { project_id: "p3" })

    const w = window as TestWindow
    expect(w.dataLayer?.at(-1)).toMatchObject({ event: "preview_3d_opened" })
    expect(umamiTrack).toHaveBeenCalled()
  })
})
