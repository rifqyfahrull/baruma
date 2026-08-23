import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

// jsdom tak mengimplementasikan scrollTo (dipakai efek auto-scroll pesan).
beforeEach(() => {
  Element.prototype.scrollTo = vi.fn()
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const messagesMock = { value: vi.fn() }
const sendMock = { value: vi.fn() }
const setStatusMock = { value: vi.fn() }
vi.mock("@/lib/api/hooks", () => ({
  useAssistantMessages: (...args: unknown[]) => messagesMock.value(...args),
  useSendProjectAgentMessage: (...args: unknown[]) => sendMock.value(...args),
  useSetAssistantStatus: (...args: unknown[]) => setStatusMock.value(...args),
}))

import { ProjectAgentPanel } from "./project-agent-panel"
import { useProjectAgentUiStore } from "@/stores/project-agent-ui-store"

beforeEach(() => {
  messagesMock.value.mockReturnValue({ data: [], isLoading: false })
  sendMock.value.mockReturnValue({ mutate: vi.fn(), isPending: false })
  setStatusMock.value.mockReturnValue({ mutate: vi.fn(), isPending: false })
  useProjectAgentUiStore.getState().reset()
})

afterEach(() => {
  cleanup()
  messagesMock.value.mockReset()
  sendMock.value.mockReset()
  setStatusMock.value.mockReset()
})

describe("ProjectAgentPanel — credit hint (WS-D §5)", () => {
  it("shows a subtle '1 kredit per pesan' hint near the input", () => {
    render(<ProjectAgentPanel projectId="proj-123" surface="editor" />)
    expect(screen.getByText("1 kredit per pesan.")).toBeTruthy()
  })
})
