import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

import { PricingPlans } from "./pricing-plans"
import { DEFAULT_PLANS } from "@/lib/server/repo/plan-defaults"

afterEach(cleanup)

describe("PricingPlans", () => {
  it("renders each plan's name, formatted price/period, and tagline", () => {
    render(<PricingPlans plans={DEFAULT_PLANS} />)

    expect(screen.getByText("Free")).toBeTruthy()
    expect(screen.getByText("Gratis")).toBeTruthy()
    expect(screen.getByText("selamanya")).toBeTruthy()
    expect(
      screen.getByText("Untuk mencoba dan eksplorasi konsep awal.")
    ).toBeTruthy()

    expect(screen.getByText("Pro")).toBeTruthy()
    expect(screen.getByText("Rp 149rb")).toBeTruthy()

    expect(screen.getByText("Studio")).toBeTruthy()
    expect(screen.getByText("Rp 499rb")).toBeTruthy()
    expect(screen.getAllByText("/bulan")).toHaveLength(2) // pro + studio
  })

  it("shows the Populer badge only on the featured plan", () => {
    render(<PricingPlans plans={DEFAULT_PLANS} />)
    expect(screen.getAllByText("Populer")).toHaveLength(1)
  })

  it("renders each plan's features and limits", () => {
    render(<PricingPlans plans={DEFAULT_PLANS} />)

    // free: a feature + both limits
    expect(screen.getByText("1 project aktif")).toBeTruthy()
    expect(screen.getByText("Watermark pada export")).toBeTruthy()
    expect(screen.getByText("Tanpa DXF/IFC")).toBeTruthy()

    // pro: no limits left (only "Tanpa watermark")
    expect(screen.getByText("AI assistant penuh")).toBeTruthy()
    expect(screen.getByText("Tanpa watermark")).toBeTruthy()

    // studio: no limits at all
    expect(screen.getByText("Kolaborasi tim")).toBeTruthy()
  })

  it("CTA links to /register with plan-specific copy", () => {
    render(<PricingPlans plans={DEFAULT_PLANS} />)

    const freeCta = screen.getByRole("link", { name: "Mulai gratis" })
    const proCta = screen.getByRole("link", { name: "Pilih Pro" })
    const studioCta = screen.getByRole("link", { name: "Pilih Studio" })

    for (const link of [freeCta, proCta, studioCta]) {
      expect(link.getAttribute("href")).toBe("/register")
    }
  })
})
