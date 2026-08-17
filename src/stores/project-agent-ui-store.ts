import { create } from "zustand"

import type { AssistantMode } from "@/lib/assistant/actions"

export type RequestedAgentMode = "auto" | AssistantMode

type ProjectAgentUiState = {
  open: boolean
  requestedMode: RequestedAgentMode
  draft: string
  draftNonce: number
  progressMessage: string | null
  setOpen: (open: boolean) => void
  setRequestedMode: (mode: RequestedAgentMode) => void
  injectDraft: (text: string, mode?: RequestedAgentMode) => void
  consumeDraft: () => void
  setProgressMessage: (message: string | null) => void
  reset: () => void
}

export const useProjectAgentUiStore = create<ProjectAgentUiState>((set) => ({
  open: false,
  requestedMode: "auto",
  draft: "",
  draftNonce: 0,
  progressMessage: null,
  setOpen: (open) => set({ open }),
  setRequestedMode: (requestedMode) => set({ requestedMode }),
  injectDraft: (text, requestedMode) => set((state) => ({
    open: true,
    requestedMode: requestedMode ?? state.requestedMode,
    draft: text,
    draftNonce: state.draftNonce + 1,
  })),
  consumeDraft: () => set({ draft: "" }),
  setProgressMessage: (progressMessage) => set({ progressMessage }),
  reset: () => set({ open: false, requestedMode: "auto", draft: "", draftNonce: 0, progressMessage: null }),
}))
