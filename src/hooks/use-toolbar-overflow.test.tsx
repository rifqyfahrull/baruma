import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import * as React from "react"

import { useToolbarOverflow } from "./use-toolbar-overflow"

function Probe({ forceCompact = false }: { forceCompact?: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const compact = useToolbarOverflow(ref, forceCompact)
  return (
    <div ref={ref} data-testid="probe">
      {compact ? "compact" : "expanded"}
    </div>
  )
}

describe("useToolbarOverflow", () => {
  let originalResizeObserver: typeof ResizeObserver | undefined
  let originalRectFn: typeof HTMLElement.prototype.getBoundingClientRect
  let top = 0
  let scrollHeight = 0

  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", { value: 500, configurable: true, writable: true })
    originalResizeObserver = window.ResizeObserver
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver

    originalRectFn = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: top, toJSON() {} }
    }
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return scrollHeight
      },
    })
  })

  afterEach(() => {
    window.ResizeObserver = originalResizeObserver as typeof ResizeObserver
    HTMLElement.prototype.getBoundingClientRect = originalRectFn
    Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight")
    cleanup()
  })

  it("stays expanded when content height fits the available viewport", () => {
    top = 12
    scrollHeight = 300 // 300 < 500 - 12 - gutter
    render(<Probe />)
    expect(screen.getByTestId("probe").textContent).toBe("expanded")
  })

  it("goes compact when content height exceeds the available viewport", () => {
    top = 12
    scrollHeight = 900 // 900 > 500 - 12 - gutter
    render(<Probe />)
    expect(screen.getByTestId("probe").textContent).toBe("compact")
  })

  it("skips measurement while forceCompact is true (does not report compact from a collapsed DOM)", () => {
    top = 12
    scrollHeight = 20 // seolah sudah diciutkan penyebab lain (mis. lebar sempit)
    render(<Probe forceCompact />)
    // measure() early-returns, state tetap default (expanded) — bukan false-positive
    // dari mengukur DOM yang sudah dipersempit oleh alasan lain.
    expect(screen.getByTestId("probe").textContent).toBe("expanded")
  })
})
