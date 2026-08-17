import { describe, it, expect, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

import { FloatingPanel } from "@/components/layout/floating-panel"

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe("FloatingPanel", () => {
  it("renders children, the aside, and a scrollable body when expanded (default)", () => {
    render(
      <FloatingPanel
        side="right"
        title="Properti"
        storageKey="panel:t1"
        testId="aside-x"
        bodyTestId="body-x"
      >
        <div>PANEL BODY</div>
      </FloatingPanel>
    )

    expect(screen.getByText("PANEL BODY")).toBeTruthy()
    expect(screen.getByTestId("aside-x")).toBeTruthy()
    expect(screen.getByTestId("body-x").className).toContain("overflow-y-auto")
  })

  it("caps the aside height to the viewport so it never grows past the screen", () => {
    render(
      <FloatingPanel side="right" title="Properti" storageKey="panel:vh" testId="aside-vh">
        <div>PANEL BODY</div>
      </FloatingPanel>
    )

    // Backstops inset-y-4 (1rem top + 1rem bottom): even if an ancestor's
    // height resolves taller than the viewport, the panel itself must not.
    expect(screen.getByTestId("aside-vh").className).toContain(
      "max-h-[calc(100svh-2rem)]"
    )
  })

  it("minimizes to a pill and removes children when the minimize button is clicked", () => {
    render(
      <FloatingPanel side="right" title="Properti" storageKey="panel:t2">
        <div>PANEL BODY</div>
      </FloatingPanel>
    )

    fireEvent.click(screen.getByRole("button", { name: /Minimize/i }))

    expect(screen.queryByText("PANEL BODY")).toBeNull()
    expect(screen.getByRole("button", { name: /Buka/i })).toBeTruthy()
  })

  it("re-expands and shows children again when the pill is clicked", () => {
    render(
      <FloatingPanel side="right" title="Properti" storageKey="panel:t3">
        <div>PANEL BODY</div>
      </FloatingPanel>
    )

    fireEvent.click(screen.getByRole("button", { name: /Minimize/i }))
    expect(screen.queryByText("PANEL BODY")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Buka/i }))
    expect(screen.getByText("PANEL BODY")).toBeTruthy()
  })

  it("pins the aside to the correct edge based on side", () => {
    const { unmount } = render(
      <FloatingPanel side="left" title="Nav" storageKey="panel:tl" testId="a-left">
        <div>L</div>
      </FloatingPanel>
    )
    expect(screen.getByTestId("a-left").className).toContain("left-4")
    unmount()

    render(
      <FloatingPanel side="right" title="Nav" storageKey="panel:tr" testId="a-right">
        <div>R</div>
      </FloatingPanel>
    )
    expect(screen.getByTestId("a-right").className).toContain("right-4")
  })

  it("seeds the minimized state from localStorage and persists on toggle", () => {
    window.localStorage.setItem("panel:seed", "1")

    render(
      <FloatingPanel side="right" title="Properti" storageKey="panel:seed">
        <div>PANEL BODY</div>
      </FloatingPanel>
    )

    // Seeded from localStorage "1" -> starts minimized.
    expect(screen.queryByText("PANEL BODY")).toBeNull()
    expect(screen.getByRole("button", { name: /Buka/i })).toBeTruthy()

    // Expand -> value flips to "0".
    fireEvent.click(screen.getByRole("button", { name: /Buka/i }))
    expect(window.localStorage.getItem("panel:seed")).toBe("0")
    expect(screen.getByText("PANEL BODY")).toBeTruthy()

    // Minimize again -> value flips back to "1".
    fireEvent.click(screen.getByRole("button", { name: /Minimize/i }))
    expect(window.localStorage.getItem("panel:seed")).toBe("1")
  })

  it("notifies onMinimizedChange on mount and on every toggle", () => {
    const calls: boolean[] = []

    render(
      <FloatingPanel
        side="left"
        title="Gambar Kerja"
        storageKey="panel:t7"
        onMinimizedChange={(minimized) => calls.push(minimized)}
      >
        <div>PANEL BODY</div>
      </FloatingPanel>
    )

    // Default expanded -> initial notification is false.
    expect(calls).toEqual([false])

    fireEvent.click(screen.getByRole("button", { name: /Minimize/i }))
    expect(calls).toEqual([false, true])

    fireEvent.click(screen.getByRole("button", { name: /Buka/i }))
    expect(calls).toEqual([false, true, false])
  })

  it("notifies onMinimizedChange with true on mount when seeded minimized", () => {
    window.localStorage.setItem("panel:t8", "1")
    const calls: boolean[] = []

    render(
      <FloatingPanel
        side="left"
        title="Gambar Kerja"
        storageKey="panel:t8"
        onMinimizedChange={(minimized) => calls.push(minimized)}
      >
        <div>PANEL BODY</div>
      </FloatingPanel>
    )

    expect(calls).toEqual([true])
  })

  it("shows the pill and hides children when forceMinimized is true, even while expanded", () => {
    render(
      <FloatingPanel
        side="right"
        title="Preview 3D"
        minimizeLabel="Preview 3D"
        storageKey="panel:force1"
        forceMinimized
      >
        <div>PANEL BODY</div>
      </FloatingPanel>
    )

    expect(screen.queryByText("PANEL BODY")).toBeNull()
    expect(screen.getByRole("button", { name: "Buka Preview 3D" })).toBeTruthy()
  })

  it("expands the panel when the forced pill is clicked (tempOverride) without exiting forceMinimized", () => {
    render(
      <FloatingPanel
        side="right"
        title="Preview 3D"
        minimizeLabel="Preview 3D"
        storageKey="panel:force2"
        forceMinimized
      >
        <div>PANEL BODY</div>
      </FloatingPanel>
    )

    expect(screen.queryByText("PANEL BODY")).toBeNull()

    // Click the pill — the user temporarily expands the panel.
    fireEvent.click(screen.getByRole("button", { name: "Buka Preview 3D" }))

    // Panel is now visible despite forceMinimized still being true.
    expect(screen.getByText("PANEL BODY")).toBeTruthy()
  })

  it("collapses back to the forced pill when the minimize button is clicked inside a temp-overridden panel", () => {
    render(
      <FloatingPanel
        side="right"
        title="Preview 3D"
        minimizeLabel="Preview 3D"
        storageKey="panel:force3"
        forceMinimized
      >
        <div>PANEL BODY</div>
      </FloatingPanel>
    )

    // Expand via temp override.
    fireEvent.click(screen.getByRole("button", { name: "Buka Preview 3D" }))
    expect(screen.getByText("PANEL BODY")).toBeTruthy()

    // Minimize from inside the panel.
    fireEvent.click(screen.getByRole("button", { name: /Minimize/i }))

    // Back to pill.
    expect(screen.queryByText("PANEL BODY")).toBeNull()
    expect(screen.getByRole("button", { name: "Buka Preview 3D" })).toBeTruthy()
  })

  it("returns to normal minimized state when forceMinimized goes away after temp-override", () => {
    const { rerender } = render(
      <FloatingPanel
        side="right"
        title="Preview 3D"
        minimizeLabel="Preview 3D"
        storageKey="panel:force4"
        forceMinimized
      >
        <div>PANEL BODY</div>
      </FloatingPanel>
    )

    // Expand via temp override.
    fireEvent.click(screen.getByRole("button", { name: "Buka Preview 3D" }))
    expect(screen.getByText("PANEL BODY")).toBeTruthy()

    // Remove forceMinimized (simulates exiting clean mode externally).
    rerender(
      <FloatingPanel
        side="right"
        title="Preview 3D"
        minimizeLabel="Preview 3D"
        storageKey="panel:force4"
      >
        <div>PANEL BODY</div>
      </FloatingPanel>
    )

    // Panel stays expanded (the user's base preference, not persisted,
    // returns to default expanded).
    expect(screen.getByText("PANEL BODY")).toBeTruthy()
  })

  it("passes through testId and bodyTestId", () => {
    render(
      <FloatingPanel
        side="right"
        title="Properti"
        storageKey="panel:t6"
        testId="my-aside"
        bodyTestId="my-body"
      >
        <div>B</div>
      </FloatingPanel>
    )

    expect(screen.getByTestId("my-aside")).toBeTruthy()
    expect(screen.getByTestId("my-body")).toBeTruthy()
  })
})
