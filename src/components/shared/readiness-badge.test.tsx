import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

import { ReadinessBadge } from "@/components/shared/readiness-badge"

afterEach(cleanup)

describe("ReadinessBadge", () => {
  it("renders the engineer-review label", () => {
    render(<ReadinessBadge status="engineer_review_required" />)
    expect(screen.getByText("Perlu Review Engineer")).toBeTruthy()
  })

  it("renders the contractor-ready label", () => {
    render(<ReadinessBadge status="contractor_discussion_ready" />)
    expect(screen.getByText("Siap Diskusi Kontraktor")).toBeTruthy()
  })

  it("renders the concept-ready label", () => {
    render(<ReadinessBadge status="concept_ready" />)
    expect(screen.getByText("Konsep Siap")).toBeTruthy()
  })
})
