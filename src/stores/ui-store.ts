import { create } from "zustand"

/**
 * Global UI state (PRD §12.2). Editor/3D-view state lives in editor-store.ts
 * (added in milestone FE-4). This store covers chrome-level toggles that span
 * the whole app.
 */
type UIStore = {
  commandOpen: boolean
  aiAssistantOpen: boolean
  setCommandOpen: (open: boolean) => void
  toggleCommand: () => void
  setAiAssistantOpen: (open: boolean) => void
  toggleAiAssistant: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  commandOpen: false,
  aiAssistantOpen: false,
  setCommandOpen: (open) => set({ commandOpen: open }),
  toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),
  setAiAssistantOpen: (open) => set({ aiAssistantOpen: open }),
  toggleAiAssistant: () => set((s) => ({ aiAssistantOpen: !s.aiAssistantOpen })),
}))
