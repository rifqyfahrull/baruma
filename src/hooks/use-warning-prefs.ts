"use client"

/**
 * Hook RINGAN (tanpa dependensi UI berat — DropdownMenu/Dialog/Textarea) yang
 * menghitung issues/prefs/unread untuk tab "Cek" (editor/page.tsx). Dipisah
 * dari `editor-warnings-panel.tsx` (yang berisi `EditorWarningsList`, di-lazy
 * -load di belakang tab) supaya badge unread-count di header panel — yang
 * HARUS tersedia sebelum tab "Cek" pernah dibuka — tidak menyeret seluruh
 * chunk daftar peringatan (dialog detail, dropdown aksi, dst.) ke first-load
 * JS route editor.
 */

import * as React from "react"

import type { WarningPrefs } from "@/components/editor/editor-warnings-panel"
import { useEditorStore } from "@/stores/editor-store"

function readPrefs(storageKey: string): WarningPrefs {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as WarningPrefs) : {}
  } catch {
    return {}
  }
}

function writePrefs(storageKey: string, prefs: WarningPrefs): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(prefs))
  } catch {
    // Local warning notes are convenience UI state; ignore storage failures.
  }
}

/**
 * Sumber kebenaran tunggal untuk issues/prefs/unread — dipanggil SEKALI di
 * `EditorClient` (editor/page.tsx) supaya badge count di tab trigger dan isi
 * daftar (EditorWarningsList, lazy) selalu sinkron.
 */
export function useWarningPrefs(projectId: string) {
  const layout = useEditorStore((s) => s.layout)
  const storageKey = `editor:warnings:${projectId}`
  const [prefs, setPrefs] = React.useState<WarningPrefs>(() => readPrefs(storageKey))

  const issues = layout?.validation.issues ?? []
  const unread = issues.filter((issue) => !prefs[issue.id]?.read).length

  const updateIssuePrefs = React.useCallback(
    (issueId: string, patch: WarningPrefs[string]) => {
      setPrefs((current) => {
        const next = { ...current, [issueId]: { ...current[issueId], ...patch } }
        writePrefs(storageKey, next)
        return next
      })
    },
    [storageKey]
  )

  return { layout, issues, prefs, unread, updateIssuePrefs }
}
