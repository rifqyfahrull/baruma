import { describe, expect, it, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

import type { Entitlements } from "@/types"
import { ExportCard } from "./export-card"

afterEach(() => {
  cleanup()
})

const studioEntitlements: Entitlements = {
  creditsPerPeriod: 500,
  maxProjects: 50,
  exportPdf: true,
  glbUpload: true,
  aiRenderHd: true,
}

const freeEntitlements: Entitlements = {
  creditsPerPeriod: 10,
  maxProjects: 1,
  exportPdf: false,
  glbUpload: false,
  aiRenderHd: false,
}

describe("ExportCard", () => {
  it("locks a proOnly format when entitlements.exportPdf is false", () => {
    render(
      <ExportCard
        format="dxf"
        readiness="concept_ready"
        plan="free"
        entitlements={freeEntitlements}
        projectId="proj-locked-1"
        projectName="Demo"
      />
    )

    expect(screen.getByText("Pro")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: /Upgrade untuk akses/ })
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Generate" })).toBeNull()
  })

  it("unlocks a proOnly format when entitlements.exportPdf is true", () => {
    render(
      <ExportCard
        format="dxf"
        readiness="concept_ready"
        plan="studio"
        entitlements={studioEntitlements}
        projectId="proj-unlocked-1"
        projectName="Demo"
      />
    )

    expect(screen.queryByText("Pro")).toBeNull()
    expect(
      screen.queryByRole("link", { name: /Upgrade untuk akses/ })
    ).toBeNull()
    expect(screen.getByRole("button", { name: "Generate" })).toBeTruthy()
  })

  it("keeps a non-proOnly format unlocked regardless of entitlements", () => {
    render(
      <ExportCard
        format="contractor_pack"
        readiness="concept_ready"
        plan="free"
        entitlements={freeEntitlements}
        projectId="proj-nonpro-1"
        projectName="Demo"
      />
    )

    expect(screen.queryByText("Pro")).toBeNull()
    expect(screen.getByRole("button", { name: "Generate" })).toBeTruthy()
  })

  it("keeps a non-proOnly format unlocked even with null entitlements", () => {
    render(
      <ExportCard
        format="glb"
        readiness="concept_ready"
        plan="free"
        entitlements={null}
        projectId="proj-nonpro-2"
        projectName="Demo"
      />
    )

    expect(screen.queryByText("Pro")).toBeNull()
    expect(screen.getByRole("button", { name: "Generate" })).toBeTruthy()
  })

  it("defaults to locked (safe default) when entitlements is null on a proOnly format", () => {
    render(
      <ExportCard
        format="ifc"
        readiness="concept_ready"
        plan="free"
        entitlements={null}
        projectId="proj-null-1"
        projectName="Demo"
      />
    )

    expect(screen.getByText("Pro")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Generate" })).toBeNull()
  })

  it("defaults to locked (safe default) when entitlements is undefined on a proOnly format", () => {
    render(
      <ExportCard
        format="zip_all"
        readiness="concept_ready"
        plan="free"
        projectId="proj-undefined-1"
        projectName="Demo"
      />
    )

    expect(screen.getByText("Pro")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Generate" })).toBeNull()
  })

  it("zip_all generates for real for an unlocked (Pro/Studio) user — no longer a stub", () => {
    render(
      <ExportCard
        format="zip_all"
        readiness="concept_ready"
        plan="studio"
        entitlements={studioEntitlements}
        projectId="proj-zip-1"
        projectName="Demo"
      />
    )
    expect(screen.queryByText("Pro")).toBeNull()
    expect(screen.getByRole("button", { name: "Generate" })).toBeTruthy()
  })

  it("shows a disabled 'Segera hadir' state for ifc when unlocked (Pro/Studio) — never a Buat that errors", () => {
    render(
      <ExportCard
        format="ifc"
        readiness="concept_ready"
        plan="studio"
        entitlements={studioEntitlements}
        projectId="proj-comingsoon-1"
        projectName="Demo"
      />
    )

    expect(screen.getAllByText("Segera hadir").length).toBeGreaterThan(0)
    expect(screen.queryByRole("button", { name: "Generate" })).toBeNull()
    const button = screen.getByRole("button", { name: "Segera hadir" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    // Locked-state "Pro" upsell isn't shown once unlocked either.
    expect(screen.queryByText("Pro")).toBeNull()
  })

  it("still shows the Pro upsell (not 'Segera hadir') for ifc while locked — existing free-plan behaviour is unchanged", () => {
    render(
      <ExportCard
        format="ifc"
        readiness="concept_ready"
        plan="free"
        entitlements={freeEntitlements}
        projectId="proj-comingsoon-locked-1"
        projectName="Demo"
      />
    )

    expect(screen.getByText("Pro")).toBeTruthy()
    expect(screen.queryByText("Segera hadir")).toBeNull()
    expect(
      screen.getByRole("link", { name: /Upgrade untuk akses/ })
    ).toBeTruthy()
  })
})
