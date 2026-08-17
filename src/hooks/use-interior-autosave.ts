"use client"

import * as React from "react"

import { useInteriorStore } from "@/stores/interior-store"
import { useSaveInterior } from "@/lib/api/hooks"
import { toSavedInterior } from "@/lib/interior/plan"

export type SaveStatus = "idle" | "saving" | "saved" | "error"

/**
 * Debounced autosave for interior edits. Watches the store's `dirty` flag and,
 * 800ms after the last change, persists the current plan via useSaveInterior.
 *
 * `opts.enabled` (default true): saat false, hook tidak memasang efek apa pun
 * dan selalu mengembalikan "idle" — dipakai jalur read-only (viewer publik)
 * yang tetap harus memanggil hook ini unconditional (rules-of-hooks).
 */
export function useInteriorAutosave(projectId: string, opts?: { enabled?: boolean }): SaveStatus {
  const enabled = opts?.enabled ?? true
  const plan = useInteriorStore((s) => s.plan)
  const dirty = useInteriorStore((s) => s.dirty)
  const markSaved = useInteriorStore((s) => s.markSaved)
  const save = useSaveInterior(projectId)
  const [status, setStatus] = React.useState<SaveStatus>("idle")

  const saveRef = React.useRef(save)
  React.useEffect(() => {
    saveRef.current = save
  }, [save])

  React.useEffect(() => {
    if (!enabled) return
    if (!dirty || !plan) return
    const handle = setTimeout(() => {
      setStatus("saving")
      saveRef.current.mutate(toSavedInterior(plan), {
        onSuccess: () => {
          markSaved()
          setStatus("saved")
        },
        onError: () => setStatus("error"),
      })
    }, 800)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, dirty, plan])

  return enabled ? status : "idle"
}
