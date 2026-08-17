"use client"

import { FormEvent, KeyboardEvent, ReactNode, useMemo, useState } from "react"
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Database,
  FileSearch,
  KeyRound,
  Layers3,
  Loader2,
  MessageSquareText,
  RotateCcw,
  Send,
  ShieldCheck,
  ShieldQuestion,
  Terminal,
  Trash2,
  Wifi,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const DEFAULT_BASE_URL = "https://freetokenfaucet.com/v1"
const DEFAULT_MODEL = "deepseek-v4-pro"

type Role = "user" | "assistant"

interface ChatMessage {
  id: string
  role: Role
  content: string
}

interface Diagnostics {
  baseUrl?: string
  host?: string
  model?: string
  providerModel?: string
  responseId?: string
  httpStatus?: number
  latencyMs?: number
  contentType?: string
  finishReason?: string
  usage?: unknown
  apiKeySource?: string
  riskSignals?: string[]
  rawPreview?: string
}

interface ChatResponse {
  ok: boolean
  message?: string
  error?: string
  diagnostics?: Diagnostics
}

interface WorkflowStage {
  stage: string
  status: string
  gate: string
}

interface WorkflowResponse {
  ok: boolean
  error?: string
  db?: {
    configured: boolean
    source: string
    // host/database/redacted DIHAPUS dari respons (audit #4: disclosure).
    risk: string
  }
  registry?: {
    sourceName: string
    sourceUrl: string
    accessMode: string
    apiFirst: boolean
    browserAllowed: boolean
    downloadAllowed: boolean
    guardrails: string[]
  }
  planner?: {
    category: string
    subcategory: string
    targetAccepted: number
    targetCandidates: number
    licenseAllowlist: string[]
    searchQueries: string[]
    negativeTerms: string[]
  }
  workflow?: WorkflowStage[]
  qualityGates?: {
    webStandardProfile: Record<string, number>
    hardBlockers: string[]
  }
  sqlBootstrap?: string[]
}

function newId() {
  return Math.random().toString(36).slice(2)
}

function formatJson(value: unknown) {
  if (value === undefined || value === null) return "-"
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function verdictFromDiagnostics(diagnostics?: Diagnostics, ok?: boolean) {
  if (!diagnostics) return { label: "Belum dites", tone: "idle" as const }
  if (!ok) return { label: "Perlu dicurigai", tone: "danger" as const }
  if (diagnostics.host && !diagnostics.host.includes("deepseek.com")) {
    return { label: "Berfungsi, domain pihak ketiga", tone: "warning" as const }
  }
  return { label: "Respons kompatibel", tone: "success" as const }
}

export function FaucetCheckClient() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [apiKey, setApiKey] = useState("")
  const [dbUrl, setDbUrl] = useState("")
  const [sourceName, setSourceName] = useState("Sketchfab")
  const [sourceUrl, setSourceUrl] = useState("https://sketchfab.com")
  const [accessMode, setAccessMode] = useState("api_download")
  const [assetCategory, setAssetCategory] = useState("window")
  const [assetSubcategory, setAssetSubcategory] = useState("sliding_window")
  const [targetCount, setTargetCount] = useState("100")
  const [input, setInput] = useState(
    "Buatkan JSON research planner untuk mencari sliding aluminium window 3D model yang legal, CC0/CC-BY, dan siap divalidasi GLB."
  )
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: newId(),
      role: "assistant",
      content:
        "Siap. Kirim prompt kecil dulu untuk mengecek apakah endpoint benar-benar OpenAI-compatible, bukan untuk menilai aman secara mutlak.",
    },
  ])
  const [diagnostics, setDiagnostics] = useState<Diagnostics | undefined>()
  const [workflow, setWorkflow] = useState<WorkflowResponse | undefined>()
  const [lastOk, setLastOk] = useState<boolean | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(false)

  const verdict = useMemo(() => verdictFromDiagnostics(diagnostics, lastOk), [diagnostics, lastOk])
  const requestMessages = useMemo(
    () =>
      messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .slice(-10)
        .map((message) => ({ role: message.role, content: message.content })),
    [messages]
  )

  async function sendMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    const userMessage: ChatMessage = { id: newId(), role: "user", content: trimmed }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput("")
    setIsLoading(true)

    try {
      const response = await fetch("/api/v1/faucet-check/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          baseUrl,
          model,
          messages: [
            ...requestMessages,
            { role: "user", content: trimmed },
          ],
        }),
      })
      const data = (await response.json()) as ChatResponse
      setDiagnostics(data.diagnostics)
      setLastOk(Boolean(data.ok))

      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          content: data.ok
            ? data.message ?? "Provider membalas tanpa isi pesan."
            : `Tes gagal: ${data.error ?? "Provider tidak memberi detail error."}`,
        },
      ])
    } catch (error) {
      setLastOk(false)
      setDiagnostics({
        baseUrl,
        host: "same-origin proxy",
        model,
        riskSignals: ["Request ke proxy lokal gagal sebelum mencapai provider."],
        rawPreview: error instanceof Error ? error.message : String(error),
      })
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          content: "Tes gagal sebelum mencapai provider. Cek dev server atau network lokal.",
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  async function runWorkflowPreflight() {
    if (isWorkflowLoading) return
    setIsWorkflowLoading(true)
    try {
      const response = await fetch("/api/v1/faucet-check/asset-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dbUrl,
          sourceName,
          sourceUrl,
          accessMode,
          category: assetCategory,
          subcategory: assetSubcategory,
          targetCount,
          licenseAllowlist: "CC0, CC-BY, owned, partner",
        }),
      })
      setWorkflow((await response.json()) as WorkflowResponse)
    } catch (error) {
      setWorkflow({
        ok: false,
        error: error instanceof Error ? error.message : "Gagal menjalankan workflow preflight.",
      })
    } finally {
      setIsWorkflowLoading(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  function resetConversation() {
    setMessages([
      {
        id: newId(),
        role: "assistant",
        content:
          "Percakapan direset. Mulai lagi dengan prompt pendek agar sinyal diagnosisnya bersih.",
      },
    ])
    setDiagnostics(undefined)
    setLastOk(undefined)
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:py-6">
        <aside className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-sm lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)]">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldQuestion className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight">Faucet API Check</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Chat tester untuk melihat bukti teknis awal, bukan vonis hukum.
              </p>
            </div>
          </div>

          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              Base URL
              <Input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                className="font-mono text-xs"
                spellCheck={false}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Model
              <Input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="font-mono text-xs"
                spellCheck={false}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              API key sementara
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Opsional (.env.local)"
                  className="pl-8 text-xs"
                  spellCheck={false}
                />
              </div>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              DB_URL
              <div className="relative">
                <Database className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="password"
                  value={dbUrl}
                  onChange={(event) => setDbUrl(event.target.value)}
                  placeholder="postgres://..."
                  className="pl-8 text-xs"
                  spellCheck={false}
                />
              </div>
            </label>
          </div>

          <section className="grid gap-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <FileSearch className="size-4 text-primary" aria-hidden="true" />
              <span className="text-sm font-semibold">Asset PRD preflight</span>
            </div>
            <label className="grid gap-1.5 text-xs font-medium">
              Source
              <Input
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
                className="h-7 text-xs"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-medium">
              Source URL
              <Input
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                className="h-7 font-mono text-xs"
                spellCheck={false}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-medium">
              Access mode
              <select
                value={accessMode}
                onChange={(event) => setAccessMode(event.target.value)}
                className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="api_download">api_download</option>
                <option value="browser_download_allowed">browser_download_allowed</option>
                <option value="manual_purchase">manual_purchase</option>
                <option value="metadata_only">metadata_only</option>
                <option value="blocked">blocked</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1.5 text-xs font-medium">
                Category
                <Input
                  value={assetCategory}
                  onChange={(event) => setAssetCategory(event.target.value)}
                  className="h-7 text-xs"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-medium">
                Target
                <Input
                  value={targetCount}
                  onChange={(event) => setTargetCount(event.target.value)}
                  className="h-7 text-xs"
                  inputMode="numeric"
                />
              </label>
            </div>
            <label className="grid gap-1.5 text-xs font-medium">
              Subcategory
              <Input
                value={assetSubcategory}
                onChange={(event) => setAssetSubcategory(event.target.value)}
                className="h-7 text-xs"
              />
            </label>
            <Button type="button" onClick={runWorkflowPreflight} disabled={isWorkflowLoading}>
              {isWorkflowLoading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              Run preflight
            </Button>
          </section>

          <section className="grid gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Verdict cepat</span>
              <Badge
                variant={
                  verdict.tone === "success"
                    ? "default"
                    : verdict.tone === "danger"
                      ? "destructive"
                      : "outline"
                }
                className={cn(verdict.tone === "warning" && "border-warning/40 text-warning-foreground")}
              >
                {verdict.label}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Metric icon={Wifi} label="HTTP" value={diagnostics?.httpStatus ?? "-"} />
              <Metric icon={Clock} label="Latency" value={diagnostics?.latencyMs ? `${diagnostics.latencyMs} ms` : "-"} />
            </div>
            <ul className="grid gap-2 text-xs leading-relaxed text-muted-foreground">
              {(diagnostics?.riskSignals ?? [
                "Belum ada request. Kirim pesan untuk melihat sinyal risiko.",
              ]).map((signal) => (
                <li key={signal} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
                  <span>{signal}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section className="flex min-h-[calc(100dvh-2rem)] min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm lg:min-h-[calc(100dvh-3rem)]">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                <MessageSquareText className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">Chat compatibility test</h2>
                <p className="truncate text-xs text-muted-foreground">
                  {diagnostics?.host ?? "Menunggu request"} · {model} · asset ingestion PRD
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={resetConversation}>
                <RotateCcw aria-hidden="true" />
                Reset
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={() => setApiKey("")}>
                <Trash2 aria-hidden="true" />
                Clear key
              </Button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-h-0 flex-col">
              <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={cn(
                      "flex gap-3",
                      message.role === "user" && "justify-end"
                    )}
                  >
                    {message.role === "assistant" && (
                      <Avatar className="bg-primary text-primary-foreground">
                        <Bot className="size-4" aria-hidden="true" />
                      </Avatar>
                    )}
                    <div
                      className={cn(
                        "max-w-[min(720px,85%)] rounded-lg px-3 py-2 text-sm leading-relaxed shadow-sm",
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "border bg-background"
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    </div>
                  </article>
                ))}
                {isLoading && (
                  <div className="flex gap-3">
                    <Avatar className="bg-primary text-primary-foreground">
                      <Bot className="size-4" aria-hidden="true" />
                    </Avatar>
                    <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Menguji endpoint...
                    </div>
                  </div>
                )}
              </div>

              <form onSubmit={sendMessage} className="border-t bg-background p-3">
                <div className="flex gap-2">
                  <Textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Tulis prompt uji..."
                    className="min-h-12 resize-none"
                  />
                  <Button type="submit" size="icon-lg" disabled={isLoading || !input.trim()} aria-label="Kirim pesan">
                    {isLoading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
                  </Button>
                </div>
              </form>
            </div>

            <aside className="border-t bg-muted/20 p-4 lg:border-l lg:border-t-0">
              <div className="flex items-center gap-2">
                {lastOk ? (
                  <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />
                )}
                <h3 className="text-sm font-semibold">Diagnostics</h3>
              </div>
              <dl className="mt-4 grid gap-3 text-sm">
                <Detail label="Host" value={diagnostics?.host} />
                <Detail label="Model request" value={diagnostics?.model} />
                <Detail label="Model response" value={diagnostics?.providerModel} />
                <Detail label="Finish reason" value={diagnostics?.finishReason} />
                <Detail label="Key source" value={diagnostics?.apiKeySource} />
                <Detail label="Content type" value={diagnostics?.contentType} />
              </dl>

              <div className="mt-5 grid gap-2">
                <p className="text-xs font-medium uppercase text-muted-foreground">Usage</p>
                <pre className="max-h-40 overflow-auto rounded-lg border bg-background p-3 text-xs leading-relaxed">
                  {formatJson(diagnostics?.usage)}
                </pre>
              </div>

              {diagnostics?.rawPreview && (
                <div className="mt-5 grid gap-2">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Raw/error preview</p>
                  <pre className="max-h-48 overflow-auto rounded-lg border bg-background p-3 text-xs leading-relaxed whitespace-pre-wrap">
                    {diagnostics.rawPreview}
                  </pre>
                </div>
              )}

              <div className="mt-5 grid gap-2">
                <div className="flex items-center gap-2">
                  <Layers3 className="size-4 text-primary" aria-hidden="true" />
                  <p className="text-xs font-medium uppercase text-muted-foreground">Asset workflow</p>
                </div>
                {!workflow ? (
                  <p className="rounded-lg border bg-background p-3 text-xs leading-relaxed text-muted-foreground">
                    Jalankan preflight untuk melihat source registry, license gate, dan DB catalog target.
                  </p>
                ) : workflow.ok ? (
                  <div className="grid gap-3">
                    <div className="rounded-lg border bg-background p-3 text-xs leading-relaxed">
                      <div className="font-medium">DB catalog</div>
                      <div className="mt-1 text-muted-foreground">
                        {workflow.db?.configured
                          ? `Terkonfigurasi (${workflow.db.source})`
                          : "Belum dikonfigurasi"}
                      </div>
                      <div className="mt-1 break-words text-[11px] text-muted-foreground">
                        {workflow.db?.risk || "-"}
                      </div>
                    </div>
                    <div className="rounded-lg border bg-background p-3 text-xs leading-relaxed">
                      <div className="font-medium">Planner</div>
                      <div className="mt-1 text-muted-foreground">
                        {workflow.planner?.targetCandidates} candidates untuk {workflow.planner?.targetAccepted} accepted assets
                      </div>
                      <ul className="mt-2 grid gap-1">
                        {(workflow.planner?.searchQueries ?? []).map((query) => (
                          <li key={query} className="break-words font-mono text-[11px] text-muted-foreground">
                            {query}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="max-h-72 overflow-auto rounded-lg border bg-background p-3">
                      <ol className="grid gap-2 text-xs">
                        {(workflow.workflow ?? []).map((stage) => (
                          <li key={stage.stage} className="grid gap-1 border-b pb-2 last:border-b-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{stage.stage}</span>
                              <Badge variant={stage.status === "blocked" ? "destructive" : "outline"}>
                                {stage.status}
                              </Badge>
                            </div>
                            <span className="text-muted-foreground">{stage.gate}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                ) : (
                  <p className="rounded-lg border bg-background p-3 text-xs text-destructive">
                    {workflow.error ?? "Workflow preflight gagal."}
                  </p>
                )}
              </div>
            </aside>
          </div>
        </section>
      </main>
    </div>
  )
}

function Avatar({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", className)}>
      {children}
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wifi
  label: string
  value: ReactNode
}) {
  return (
    <div className="rounded-lg border bg-background p-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-xs">{value}</div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value?: unknown }) {
  return (
    <div className="grid gap-1 border-b pb-2 last:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-mono text-xs">{value ? String(value) : "-"}</dd>
    </div>
  )
}
