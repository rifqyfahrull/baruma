import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

import HelpPage from "./page"

afterEach(cleanup)

describe("HelpPage", () => {
  it("renders the FAQ, shortcut, and kontak sections", () => {
    render(<HelpPage />)

    expect(screen.getByRole("heading", { name: "Bantuan" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Pertanyaan umum" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Pintasan keyboard" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Kontak" })).toBeTruthy()

    // FAQ questions (accordion triggers) are present even before expanding.
    expect(
      screen.getByText("Apa itu kredit, dan aksi apa saja yang memakainya?")
    ).toBeTruthy()
    expect(
      screen.getByText("Bagaimana cara membagikan project ke kontraktor?")
    ).toBeTruthy()
    expect(screen.getByText("Apa batasan tiap plan?")).toBeTruthy()

    // Real editor shortcuts (verified against editor/page.tsx keydown handler).
    expect(screen.getByText("Hapus objek terpilih")).toBeTruthy()
    expect(screen.getByText("Ganti ke alat pilih (select)")).toBeTruthy()
    expect(
      screen.getByText("Buka command palette (cari halaman/project)")
    ).toBeTruthy()
  })

  it("uses the default support email placeholder when the env var is unset", () => {
    delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL

    render(<HelpPage />)

    const link = screen.getByRole("link", { name: "support@baruma.id" })
    expect(link.getAttribute("href")).toBe("mailto:support@baruma.id")
  })

  it("uses NEXT_PUBLIC_SUPPORT_EMAIL when set", () => {
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL = "bantuan@baruma.id"

    render(<HelpPage />)

    const link = screen.getByRole("link", { name: "bantuan@baruma.id" })
    expect(link.getAttribute("href")).toBe("mailto:bantuan@baruma.id")

    delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL
  })
})
