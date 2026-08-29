"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { BrainCircuit, Check, Loader2, Send, ShieldAlert, Sparkles, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  useAssistantMessages,
  useSendProjectAgentMessage,
  useSetAssistantStatus,
} from "@/lib/api/hooks"
import { handlePlanError } from "@/lib/api/plan-error"
import type {
  AssistantMessage,
  AssistantMode,
  AssistantSurface,
  FloorplanAction,
  InteriorAction,
} from "@/lib/assistant/actions"
import {
  applyFloorplanActionsAtomic,
  applyInteriorActionsAtomic,
  buildFloorplanScene,
  buildInteriorScene,
} from "@/lib/assistant/apply"
import { AgentClarificationWizard } from "@/components/assistant/agent-clarification-wizard"
import { parseClarificationSteps } from "@/lib/assistant/clarification-parser"
import { useEditorStore } from "@/stores/editor-store"
import { useInteriorStore } from "@/stores/interior-store"
import { usePreviewStore } from "@/stores/preview-store"
import { useProjectAgentUiStore, type RequestedAgentMode } from "@/stores/project-agent-ui-store"
import { cn } from "@/lib/utils"

/** Aksi `aiRender` — bagian dari KEDUA union (floorplan & interior, lihat
 *  `aiRenderActionSchema`). Dipakai untuk narrow array saat memisahkannya
 *  dari aksi "nyata" sebelum apply atomic — lihat `applyMessage`. */
type AiRenderAction = Extract<FloorplanAction | InteriorAction, { type: "aiRender" }>
function isAiRenderAction(a: FloorplanAction | InteriorAction): a is AiRenderAction {
  return a.type === "aiRender"
}

const MODE_LABEL: Record<AssistantMode, string> = {
  brief: "Brief",
  floorplan: "Denah",
  interior: "Interior",
}
const MODE_OPTIONS: Array<{ value: RequestedAgentMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "brief", label: "Brief" },
  { value: "floorplan", label: "Denah" },
  { value: "interior", label: "Interior" },
]

const SUGGESTIONS: Record<AssistantSurface, string[]> = {
  project: ["Apa langkah terbaik berikutnya untuk proyek ini?"],
  brief: ["Apakah brief ini realistis?", "Buat rekomendasi yang lebih hemat"],
  alternatives: ["Jelaskan trade-off alternatif yang saya pilih"],
  editor: ["Tambahkan jendela di ruang tamu", "Periksa denah terhadap standar"],
  "preview-3d": ["Tata interior agar terasa lebih lega", "Ganti gaya interior jadi Japandi"],
  rab: ["Jelaskan komponen biaya terbesar dan cara menghematnya"],
  drawings: ["Jelaskan gambar kerja yang perlu saya prioritaskan"],
  exports: ["Export mana yang cocok untuk dibawa ke kontraktor?"],
  review: ["Jelaskan risiko paling penting dalam review ini"],
  furniture: ["Sarankan furnitur yang cocok untuk ruang ini"],
  materials: ["Sarankan kombinasi material yang konsisten"],
}

function newRequestId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `req-${random.replace(/[^A-Za-z0-9_-]/g, "-")}`
}

function parseInlineMarkdown(text: string): React.ReactNode[] {
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  const parts = text.split(regex)

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <em key={index} className="italic">
          {part.slice(1, -1)}
        </em>
      )
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={index} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}

function MarkdownMessage({ content }: { content: string }) {
  const lines = content.split("\n")
  return (
    <div className="space-y-1.5 leading-relaxed">
      {lines.map((line, idx) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={idx} className="h-1" />

        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/50" />
              <span>{parseInlineMarkdown(trimmed.slice(2))}</span>
            </div>
          )
        }

        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/)
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="shrink-0 font-semibold text-foreground/80">{numMatch[1]}.</span>
              <span>{parseInlineMarkdown(numMatch[2])}</span>
            </div>
          )
        }

        return (
          <p key={idx} className="whitespace-pre-wrap">
            {parseInlineMarkdown(line)}
          </p>
        )
      })}
    </div>
  )
}

function unwrapContentText(content: string): string {
  if (!content) return ""
  const text = content.trim()
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.reply === "string") return parsed.reply
        if (typeof parsed.content === "string") return parsed.content
        if (typeof parsed.text === "string") return parsed.text
        if (typeof parsed.answer === "string") return parsed.answer
      }
    } catch {
      /* fallback to raw text */
    }
  }
  return text
}

function formatMessageTime(isoString?: string): string {
  if (!isoString) return ""
  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return ""
    return date.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  } catch {
    return ""
  }
}

function getCalendarDayKey(isoString?: string): string {
  if (!isoString) return ""
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return ""
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function formatDaySeparatorLabel(isoString?: string): string {
  if (!isoString) return ""
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return ""

  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()

  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()

  if (isToday) {
    return `Hari ini, ${d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`
  }
  if (isYesterday) {
    return `Kemarin, ${d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`
  }
  return d.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

export function ProjectAgentPanel({
  projectId,
  surface,
}: {
  projectId: string
  surface: AssistantSurface
}) {
  const router = useRouter()
  const { data: messages = [], isLoading } = useAssistantMessages(projectId)
  const send = useSendProjectAgentMessage(projectId)
  const setStatus = useSetAssistantStatus(projectId)
  const requestedMode = useProjectAgentUiStore((state) => state.requestedMode)
  const setRequestedMode = useProjectAgentUiStore((state) => state.setRequestedMode)
  const draft = useProjectAgentUiStore((state) => state.draft)
  const draftNonce = useProjectAgentUiStore((state) => state.draftNonce)
  const progressMessage = useProjectAgentUiStore((state) => state.progressMessage)
  const consumeDraft = useProjectAgentUiStore((state) => state.consumeDraft)
  const [input, setInput] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const consumedNonce = React.useRef(0)

  const editorLayout = useEditorStore((state) => state.layout)
  const interiorProjectId = useInteriorStore((state) => state.projectId)
  const interiorPlan = useInteriorStore((state) => state.plan)
  const interiorLayout = useInteriorStore((state) => state.layout)

  React.useEffect(() => {
    if (!draft || consumedNonce.current === draftNonce) return
    consumedNonce.current = draftNonce
    setInput((current) => current.trim() ? `${current.trim()}\n\n${draft}` : draft)
    consumeDraft()
  }, [consumeDraft, draft, draftNonce])

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, send.isPending])

  function liveScene() {
    const preferred = requestedMode === "auto"
      ? surface === "editor" ? "floorplan" : surface === "preview-3d" || surface === "furniture" || surface === "materials" ? "interior" : null
      : requestedMode
    if (preferred === "floorplan" && editorLayout?.projectId === projectId) {
      const payload = buildFloorplanScene()
      return payload ? { mode: "floorplan" as const, versionId: editorLayout.versionId, payload } : undefined
    }
    if (
      preferred === "interior" &&
      interiorProjectId === projectId &&
      interiorPlan &&
      interiorLayout?.projectId === projectId
    ) {
      const payload = buildInteriorScene()
      return payload ? { mode: "interior" as const, versionId: interiorPlan.versionId, payload } : undefined
    }
    return undefined
  }

  function submit(raw: string) {
    const instruction = raw.trim()
    if (!instruction || send.isPending) return
    setInput("")
    send.mutate(
      {
        surface,
        requestedMode,
        instruction,
        liveScene: liveScene(),
        clientRequestId: newRequestId(),
      },
      {
        onError: (error) => {
          setInput(instruction)
          if (!handlePlanError(error)) toast.error("AI Agent gagal merespons. Coba lagi sebentar.")
        },
      }
    )
  }

  function canApply(message: AssistantMessage): boolean {
    if (message.mode === "floorplan") return editorLayout?.projectId === projectId
    if (message.mode === "interior") {
      return interiorProjectId === projectId && interiorLayout?.projectId === projectId && !!interiorPlan
    }
    return false
  }

  function openTarget(message: AssistantMessage) {
    const target = message.mode === "floorplan" ? "editor" : "preview-3d"
    router.push(`/app/projects/${projectId}/${target}`)
    toast.info(`Buka ${message.mode === "floorplan" ? "Editor Denah" : "Interior"} untuk menerapkan usulan.`)
  }

  function applyMessage(message: AssistantMessage) {
    if (!message.actions?.length || message.mode === "brief") return
    if (!canApply(message)) {
      openTarget(message)
      return
    }
    const actions = message.actions as (FloorplanAction | InteriorAction)[]
    // Aksi `aiRender` DIINTERSEP di sini — bukan diteruskan ke apply atomic
    // (apply.ts hanya no-op defensif utknya). Buka dialog Render AI
    // pre-filled lewat store alih-alih render langsung dari chat (spec
    // 2026-08-29 ai-render-chat-style-notes: user tetap menekan Generate
    // sendiri, kredit terpotong sadar). Hanya aksi PERTAMA yang dipakai bila
    // AI mengeluarkan lebih dari satu (tak terduga dlm praktik).
    const aiRenderActions = actions.filter(isAiRenderAction)
    const rest = actions.filter((a) => !isAiRenderAction(a))

    if (aiRenderActions.length > 0) {
      const first = aiRenderActions[0]
      usePreviewStore.getState().requestAiRenderPrefill({
        target: first.target,
        roomId: first.roomId,
        presetId: first.presetId,
        styleNotes: first.styleNotes,
      })
      toast.info("Dialog Render AI disiapkan — buka Preview 3D bila belum")
    }

    if (rest.length === 0) {
      // Pesan berisi aiRender saja: tak ada apply atomic (rest kosong akan
      // langsung false-kan applyFloorplanActionsAtomic/applyInteriorActionsAtomic
      // — array kosong dianggap gagal), jadi lewati; tetap tandai "applied"
      // supaya kartu usulan tak menggantung di "proposed" selamanya.
      setStatus.mutate({ messageId: message.id, status: "applied" })
      return
    }

    const success = message.mode === "floorplan"
      ? applyFloorplanActionsAtomic(rest as FloorplanAction[])
      : applyInteriorActionsAtomic(rest as InteriorAction[])
    if (!success) {
      toast.error("Usulan sudah tidak cocok dengan kondisi terbaru. Minta AI Agent membuat usulan baru.")
      return
    }
    setStatus.mutate(
      { messageId: message.id, status: "applied" },
      { onSuccess: () => toast.success(`${rest.length} perubahan diterapkan sebagai satu langkah Undo.`) }
    )
  }

  const proposedByMode = React.useMemo(() => {
    const latest = new Map<AssistantMode, string>()
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message.role === "assistant" && message.status === "proposed" && !latest.has(message.mode)) {
        latest.set(message.mode, message.id)
      }
    }
    return latest
  }, [messages])

  const latestAssistantMessage = React.useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].role === "assistant") return messages[index]
    }
    return null
  }, [messages])

  const [dismissedWizardId, setDismissedWizardId] = React.useState<string | null>(null)

  const activeClarificationSteps = React.useMemo(() => {
    if (!latestAssistantMessage || latestAssistantMessage.id === dismissedWizardId) return []
    return parseClarificationSteps(latestAssistantMessage.content, latestAssistantMessage.needsClarify)
  }, [latestAssistantMessage, dismissedWizardId])

  const empty = !isLoading && messages.length === 0
  const showWizard = activeClarificationSteps.length >= 2 && !send.isPending

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="project-agent-panel">
      <div className="flex flex-wrap gap-1 border-b px-4 pb-3">
        {MODE_OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="xs"
            variant={requestedMode === option.value ? "default" : "outline"}
            onClick={() => setRequestedMode(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memuat percakapan…
          </div>
        )}
        {empty && (
          <div className="space-y-3">
            <div className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-2 font-medium text-foreground">
                <Sparkles className="size-4 text-info" /> Dua agent bekerja bersama di percakapan ini
              </p>
              <p className="mt-1">Agent Utama merencanakan, Agent Denah mengeksekusi — plus tanya brief atau tata interior dari percakapan yang sama.</p>
            </div>
            {SUGGESTIONS[surface].map((suggestion) => (
              <Button key={suggestion} variant="outline" size="sm" className="h-auto w-full justify-start text-left" onClick={() => submit(suggestion)}>
                {suggestion}
              </Button>
            ))}
          </div>
        )}

        {messages.map((message, messageIdx) => {
          const currentDayKey = getCalendarDayKey(message.createdAt)
          const previousDayKey = messageIdx > 0 ? getCalendarDayKey(messages[messageIdx - 1].createdAt) : null
          const showDaySeparator = !!currentDayKey && currentDayKey !== previousDayKey
          const timeStr = formatMessageTime(message.createdAt)

          const isValidationFeedback =
            message.role === "user" &&
            (message.content.startsWith("Usulanmu BELUM valid:") ||
             message.content.includes("tumpang-tindih") ||
             message.content.includes("memunculkan peringatan baru"))


          return (
            <React.Fragment key={message.id}>
              {showDaySeparator && (
                <div className="my-4 flex items-center justify-center gap-2">
                  <div className="h-px flex-1 bg-border/60" />
                  <span className="rounded-full border bg-muted/80 px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-2xs">
                    {formatDaySeparatorLabel(message.createdAt)}
                  </span>
                  <div className="h-px flex-1 bg-border/60" />
                </div>
              )}

              <div className="space-y-1.5">
                {isValidationFeedback ? (
                  <div className="my-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 shadow-2xs">
                    <div className="flex items-center justify-between font-semibold">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
                        <span>Pemeriksaan Validasi Denah (Sistem Otomatis)</span>
                      </div>
                      {timeStr && <span className="text-[10px] font-normal opacity-80">{timeStr}</span>}
                    </div>
                    <p className="mt-1.5 leading-relaxed opacity-90">
                      Validator otomatis menemukan tumpang-tindih pada usulan denah dan menginstruksikan AI Agent untuk melakukan penyelarasan mandiri.
                    </p>
                  </div>
                ) : message.role === "user" ? (
                  <div className="ml-8 rounded-2xl bg-primary/10 px-3.5 py-2.5 text-sm text-foreground">
                    <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <span>Anda</span>
                        <span className="rounded bg-background/70 px-1.5 py-0.5 text-[9px]">{MODE_LABEL[message.mode]}</span>
                      </div>
                      {timeStr && <span className="font-normal text-muted-foreground/75">{timeStr}</span>}
                    </div>
                    <MarkdownMessage content={unwrapContentText(message.content)} />
                  </div>
                ) : (
                  <div className="mr-4 py-1 text-sm text-foreground">
                    {message.plannerNote && (
                      <div className="mb-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
                        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">
                          <BrainCircuit className="size-3.5" />
                          <span>Agent Utama · Rencana Arsitek</span>
                        </div>
                        <div className="leading-relaxed">
                          <MarkdownMessage content={message.plannerNote} />
                        </div>
                      </div>
                    )}
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="size-3.5 text-primary" />
                        <span className="font-medium text-foreground">
                          {message.plannerNote ? "Agent Denah" : "AI Agent"}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase">{MODE_LABEL[message.mode]}</span>
                      </div>
                      {timeStr && <span className="text-[10px] font-normal text-muted-foreground/75">{timeStr}</span>}
                    </div>
                    <div className="pl-0 leading-relaxed">
                      <MarkdownMessage content={unwrapContentText(message.content)} />
                    </div>
                  </div>
                )}


                {message.role === "assistant" && message.actionLabels?.length ? (
                  <div className="mr-8 space-y-2 rounded-xl border border-info/40 bg-info/5 p-3">
                    <p className="text-xs font-semibold">Usulan perubahan ({message.actionLabels.length})</p>
                    <ul className="space-y-1 text-sm">
                      {message.actionLabels.map((label, index) => (
                        <li key={`${message.id}-${index}`} className="flex gap-2">
                          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-info" /> {label}
                        </li>
                      ))}
                    </ul>
                    {message.status === "proposed" && proposedByMode.get(message.mode) === message.id ? (
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" className="flex-1" disabled={setStatus.isPending} onClick={() => applyMessage(message)}>
                          <Check /> {canApply(message) ? "Terapkan" : `Buka ${message.mode === "floorplan" ? "Denah" : "Interior"}`}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ messageId: message.id, status: "dismissed" })}>
                          <X /> Abaikan
                        </Button>
                      </div>
                    ) : (
                      <p className={cn("text-xs font-medium", message.status === "applied" ? "text-success" : "text-muted-foreground")}>
                        {message.status === "applied" ? "✓ Diterapkan" : message.status === "dismissed" ? "Diabaikan" : "Riwayat"}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </React.Fragment>
          )
        })}
        {send.isPending && (
          <div className="mr-4 flex items-center gap-2 py-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="size-4 animate-spin text-primary" /> {progressMessage ?? "AI Agent sedang menyusun…"}
          </div>
        )}
      </div>

      {showWizard && (
        <AgentClarificationWizard
          steps={activeClarificationSteps}
          onSubmitAll={(summary) => submit(summary)}
          onDismiss={() => {
            if (latestAssistantMessage) {
              setDismissedWizardId(latestAssistantMessage.id)
            }
          }}
        />
      )}

      <div className="border-t px-4 pt-3">
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); submit(input) }}>
          <Input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Tanyakan atau minta perubahan…"
            disabled={send.isPending}
            aria-label="Pesan untuk AI Agent"
          />
          <Button type="submit" size="icon" disabled={send.isPending || !input.trim()} aria-label="Kirim pesan">
            <Send />
          </Button>
        </form>
        <p className="pb-3 pt-1.5 text-[11px] text-muted-foreground">1 kredit per pesan.</p>
      </div>
    </div>
  )
}
