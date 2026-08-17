"use client"

import * as React from "react"

import { useEditorStore } from "@/stores/editor-store"
import { useSaveLayout } from "@/lib/api/hooks"
import { ApiError } from "@/lib/data/http"

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict"

/**
 * Debounced autosave for denah edits. Watches the editor store's `dirty` flag
 * and, 1500ms after the last change, persists the current layout via
 * useSaveLayout so other devices/tabs see it on open/refresh.
 *
 * HTTP 409 (revision guard: tab/perangkat lain menyimpan lebih dulu) bersifat
 * terminal untuk sesi ini: autosave BERHENTI — retry dengan revision basi
 * hanya akan 409 lagi — status menjadi "conflict", store tetap dirty, dan
 * LayoutConflictBanner menawarkan reload atau simpan-sebagai-salinan.
 *
 * `opts.enabled` (default true): saat false, hook tidak memasang efek apa pun
 * (tidak menonton `dirty`, tidak memanggil useSaveLayout's mutate) dan selalu
 * mengembalikan "idle" — dipakai jalur read-only (viewer publik) yang tetap
 * harus memanggil hook ini unconditional (rules-of-hooks) tanpa efek samping.
 */
export function useLayoutAutosave(projectId: string, opts?: { enabled?: boolean }): SaveStatus {
  const enabled = opts?.enabled ?? true
  const layout = useEditorStore((s) => s.layout)
  const dirty = useEditorStore((s) => s.dirty)
  const layoutRevision = useEditorStore((s) => s.layoutRevision)
  const editSequence = useEditorStore((s) => s.editSequence)
  const markSaved = useEditorStore((s) => s.markSaved)
  const save = useSaveLayout(projectId)
  const [status, setStatus] = React.useState<SaveStatus>("idle")
  const inFlightRef = React.useRef(false)
  const queuedRef = React.useRef(false)
  const conflictRef = React.useRef(false)
  const lastSaveKeyRef = React.useRef<string | null>(null)
  const [savePulse, setSavePulse] = React.useState(0)

  const saveRef = React.useRef(save)

  React.useEffect(() => {
    saveRef.current = save
  }, [save])

  React.useEffect(() => {
    if (!enabled) return
    if (conflictRef.current) return
    if (!dirty || !layout) return
    if (!layoutRevision) return
    const handle = setTimeout(() => {
      if (conflictRef.current) return
      if (inFlightRef.current) {
        queuedRef.current = true
        return
      }
      queuedRef.current = false
      const saveKey = `${layoutRevision}:${editSequence}`
      if (lastSaveKeyRef.current === saveKey) return
      lastSaveKeyRef.current = saveKey
      inFlightRef.current = true
      const savedEditSequence = editSequence
      setStatus("saving")
      saveRef.current.mutate({ layout, expectedRevision: layoutRevision }, {
        onSuccess: (document) => {
          markSaved(savedEditSequence, document.revision)
          setStatus(
            useEditorStore.getState().editSequence === savedEditSequence ? "saved" : "saving"
          )
        },
        onError: (error) => {
          lastSaveKeyRef.current = null
          if (error instanceof ApiError && error.status === 409) {
            conflictRef.current = true
            setStatus("conflict")
          } else {
            setStatus("error")
          }
        },
        onSettled: (_document, error) => {
          inFlightRef.current = false
          if (!error && (queuedRef.current || useEditorStore.getState().dirty)) {
            queuedRef.current = false
            setSavePulse((value) => value + 1)
          }
        },
      })
    }, 1500)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, dirty, layout, layoutRevision, editSequence, savePulse])

  return enabled ? status : "idle"
}
