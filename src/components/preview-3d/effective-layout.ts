import type { DesignLayout } from "@/types"

/**
 * Keep /preview-3d in sync with the /editor draft: the editor's zustand store
 * (`useEditorStore`) is a module singleton that survives route navigation, so
 * when it holds a live draft for THIS project we render that (reflecting even
 * unsaved edits). Otherwise fall back to the fetched/saved layout.
 */
export function pickEffectiveLayout(
  editorLayout: DesignLayout | null,
  fetchedLayout: DesignLayout | null | undefined,
  projectId: string
): DesignLayout | null {
  if (editorLayout && editorLayout.projectId === projectId) return editorLayout
  return fetchedLayout ?? null
}
