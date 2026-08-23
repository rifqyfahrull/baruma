import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-123" }),
  useRouter: () => ({ push: vi.fn() }),
}))

const altsMock = { value: vi.fn() }
const genMock = { value: vi.fn() }
const selectMock = { value: vi.fn() }
vi.mock("@/lib/api/hooks", () => ({
  useAlternatives: (...args: unknown[]) => altsMock.value(...args),
  useGenerateAlternatives: (...args: unknown[]) => genMock.value(...args),
  useSelectAlternative: (...args: unknown[]) => selectMock.value(...args),
}))

import AlternativesPage from "./page"

const ALT = {
  id: "alt-1",
  projectId: "proj-123",
  name: "Compact Courtyard Pool",
  type: "hemat_biaya" as const,
  score: 87,
  thumbnail: "courtyard" as const,
  description: "",
  keyFeatures: [],
  pros: [],
  cons: [],
  estimatedCost: { minIDR: 400_000_000, maxIDR: 500_000_000 },
  readiness: "concept_ready" as const,
  risks: [],
  areaM2: 60,
  roomCount: 5,
  floors: 1,
}

beforeEach(() => {
  altsMock.value.mockReturnValue({ data: [ALT], isLoading: false })
  genMock.value.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  selectMock.value.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
})

afterEach(() => {
  cleanup()
  altsMock.value.mockReset()
  genMock.value.mockReset()
  selectMock.value.mockReset()
})

describe("AlternativesPage — Regenerate cost label (WS-D §5)", () => {
  it("shows the credit cost on the Regenerate button", () => {
    render(<AlternativesPage />)
    expect(screen.getByRole("button", { name: /Regenerate — 1 kredit/ })).toBeTruthy()
  })
})
