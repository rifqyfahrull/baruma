import { describe, it, expect, afterEach, vi } from "vitest"
import { render, cleanup } from "@testing-library/react"

import { UmamiScript } from "./umami-script"

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  cleanup()
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllEnvs()
})

describe("UmamiScript", () => {
  it("renders nothing when both env vars are unset", () => {
    delete process.env.NEXT_PUBLIC_UMAMI_SRC
    delete process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID

    const { container } = render(<UmamiScript />)
    expect(container.innerHTML).toBe("")
  })

  it("renders nothing when only the src is set (missing website id)", () => {
    process.env.NEXT_PUBLIC_UMAMI_SRC = "https://cloud.umami.is/script.js"
    delete process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID

    const { container } = render(<UmamiScript />)
    expect(container.innerHTML).toBe("")
  })

  it("injects a script tag with the website id when both env vars are set", () => {
    // next/script's `afterInteractive` strategy renders nothing into the
    // React tree — it appends a real <script> to document.body via an
    // effect (node_modules/next/dist/client/script.js), so we assert there
    // instead of inside the render container.
    process.env.NEXT_PUBLIC_UMAMI_SRC = "https://cloud.umami.is/script.js"
    process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID = "abc-123"

    render(<UmamiScript />)
    const script = document.querySelector('script[data-website-id="abc-123"]')
    expect(script).not.toBeNull()
    expect(script?.getAttribute("src")).toBe("https://cloud.umami.is/script.js")
  })
})
