// @vitest-environment jsdom
import * as React from "react"
import { describe, it, expect, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import { CompassRose } from "./compass-rose"

afterEach(cleanup)

describe("CompassRose", () => {
  it("menampilkan 4 label arah U/T/S/B dengan aria-label", () => {
    render(<CompassRose />)
    const rose = screen.getByTestId("compass-rose")
    expect(rose.getAttribute("aria-label")).toContain("Utara")
    for (const label of ["U", "T", "S", "B"]) {
      expect(rose.textContent).toContain(label)
    }
  })

  it("default rotasi 0 (utara ke atas — konvensi kanvas 2D)", () => {
    render(<CompassRose />)
    expect(screen.getByTestId("compass-needle").style.transform).toBe("rotate(0deg)")
  })

  it("menerapkan rotationDeg ke jarum (jalur 3D)", () => {
    render(<CompassRose rotationDeg={45} />)
    expect(screen.getByTestId("compass-needle").style.transform).toBe("rotate(45deg)")
  })

  it("meneruskan ref ke elemen jarum utk mutasi langsung (CompassBridge)", () => {
    const ref = React.createRef<HTMLDivElement>()
    render(<CompassRose ref={ref} />)
    expect(ref.current).not.toBeNull()
    ref.current!.style.transform = "rotate(90deg)"
    expect(screen.getByTestId("compass-needle").style.transform).toBe("rotate(90deg)")
  })
})
