import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { useEditorStore } from "@/stores/editor-store"
import { makeLayout, sampleSite } from "@/test-utils/fixtures"
import type { Project } from "@/types"
import { DesignAuditCard } from "./design-audit-card"

/**
 * Verifies the SiteRegulation override findings (kategori "regulasi"/"cahaya"
 * baru dari audit engine) surface generically through DesignAuditCard — tak
 * ada lookup kategori khusus di komponen, jadi cukup pastikan title/standard
 * baru benar-benar tampil.
 */
describe("DesignAuditCard — temuan regulasi/cahaya dari override Perda", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
  })
  afterEach(cleanup)

  it("menampilkan temuan regulasi:kdh saat KDH override lebih ketat dari kondisi layout", () => {
    const project: Pick<Project, "floors" | "rooftop" | "readiness" | "site"> = {
      floors: 2,
      rooftop: false,
      readiness: "engineer_review_required",
      site: {
        widthM: 8,
        depthM: 8,
        areaM2: 64,
        regulation: { minKdh: 0.9 },
      },
    }
    render(<DesignAuditCard project={project} onFix={vi.fn()} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Buka detail cek standar desain" })
    )
    expect(screen.getByText(/KDH \d+% di bawah 90%/)).toBeTruthy()
    expect(
      screen.getByText("KDH (sesuai angka Perda yang Anda isi)")
    ).toBeTruthy()
  })

  it("menampilkan temuan pencahayaan:narrow-attached untuk lahan sempit diapit 2 sisi tanpa void/skylight", () => {
    const project: Pick<Project, "floors" | "rooftop" | "readiness" | "site"> = {
      floors: 2,
      rooftop: false,
      readiness: "engineer_review_required",
      site: { widthM: 8, depthM: 8, areaM2: 64, sidesAttached: 2 },
    }
    render(<DesignAuditCard project={project} onFix={vi.fn()} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Buka detail cek standar desain" })
    )
    expect(
      screen.getByText(
        /Lahan sempit \(lebar 8 m\) diapit tetangga di 2 sisi tanpa sumber cahaya tengah/
      )
    ).toBeTruthy()
  })

  it("KDB/KLB/GSB menyebut sumber 'sesuai angka Perda yang Anda isi' saat regulation diisi", () => {
    const project: Pick<Project, "floors" | "rooftop" | "readiness" | "site"> = {
      floors: 2,
      rooftop: false,
      readiness: "engineer_review_required",
      site: {
        widthM: 8,
        depthM: 8,
        areaM2: 64,
        frontRoadWidthM: 5,
        regulation: { maxKdb: 0.1, gsbM: 10 },
      },
    }
    render(<DesignAuditCard project={project} onFix={vi.fn()} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Buka detail cek standar desain" })
    )
    expect(
      screen.getByText("KDB (sesuai angka Perda yang Anda isi)")
    ).toBeTruthy()
    expect(
      screen.getByText("GSB (sesuai angka Perda yang Anda isi)")
    ).toBeTruthy()
  })
})
