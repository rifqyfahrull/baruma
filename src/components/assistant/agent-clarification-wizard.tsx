"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, Edit3, Send, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ClarificationStep } from "@/lib/assistant/clarification-parser"
import { cn } from "@/lib/utils"

export function AgentClarificationWizard({
  steps,
  onSubmitAll,
  onDismiss,
}: {
  steps: ClarificationStep[]
  onSubmitAll: (summary: string) => void
  onDismiss: () => void
}) {
  const [currentStepIdx, setCurrentStepIdx] = React.useState(0)
  const [answers, setAnswers] = React.useState<Record<number, string>>({})
  const [customInput, setCustomInput] = React.useState("")
  const [isCustomActive, setIsCustomActive] = React.useState(false)

  const currentStep = steps[currentStepIdx]
  if (!currentStep) return null

  const isFirst = currentStepIdx === 0
  const isLast = currentStepIdx === steps.length - 1
  const selectedAnswer = answers[currentStep.index] || ""

  function handleSelectOption(option: string) {
    setIsCustomActive(false)
    setCustomInput("")
    const updated = { ...answers, [currentStep.index]: option }
    setAnswers(updated)

    // Auto-advance to next step if not on last step
    if (!isLast) {
      setTimeout(() => {
        setCurrentStepIdx((prev) => Math.min(prev + 1, steps.length - 1))
      }, 150)
    }
  }

  function handleSaveCustom(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (!customInput.trim()) return
    const updated = { ...answers, [currentStep.index]: customInput.trim() }
    setAnswers(updated)
    setIsCustomActive(false)

    if (!isLast) {
      setCurrentStepIdx((prev) => Math.min(prev + 1, steps.length - 1))
    }
  }

  function handleFinalSubmit() {
    const summaryLines: string[] = []
    for (const s of steps) {
      const val = answers[s.index] || "Belum ditentukan"
      summaryLines.push(`${s.index}. ${s.title}: ${val}`)
    }
    const finalSummary = `Berikut jawaban untuk poin-poin klarifikasi Anda:\n\n${summaryLines.join("\n")}`
    onSubmitAll(finalSummary)
  }

  const answeredCount = Object.keys(answers).length

  return (
    <div className="mx-2 mb-2 rounded-2xl border border-primary/20 bg-card p-4 shadow-xl animate-in slide-in-from-bottom-4 duration-200">
      {/* Top Header */}
      <div className="mb-3 flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {currentStepIdx + 1}
          </span>
          <div>
            <h4 className="text-xs font-semibold text-foreground">
              {currentStep.title}
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Langkah {currentStepIdx + 1} dari {steps.length}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
          title="Tutup wizard"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Step Pills for direct jump */}
      <div className="mb-3 flex max-w-full flex-wrap gap-1 overflow-hidden">
        {steps.map((s, idx) => {
          const isCurrent = idx === currentStepIdx
          const isAnswered = !!answers[s.index]
          return (
            <button
              key={s.index}
              type="button"
              onClick={() => setCurrentStepIdx(idx)}
              className={cn(
                "flex shrink min-w-0 max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all",
                isCurrent
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : isAnswered
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              <span className="shrink-0">{s.index}.</span>
              <span className="truncate">{s.title}</span>
              {isAnswered && <span className="shrink-0 text-[10px]">✓</span>}
            </button>
          )
        })}
      </div>

      {/* Full Question Text */}
      <p className="mb-3 text-xs text-foreground/90 leading-relaxed font-medium">
        {currentStep.question}
      </p>

      {/* Options Stack */}
      <div className="space-y-1.5 mb-3">
        {currentStep.options.map((opt, optIdx) => {
          const isSelected = selectedAnswer === opt && !isCustomActive
          return (
            <button
              key={opt}
              type="button"
              onClick={() => handleSelectOption(opt)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs transition-all",
                isSelected
                  ? "border-primary bg-primary/10 font-semibold text-primary shadow-sm"
                  : "border-border/60 bg-background/60 text-foreground hover:border-primary/40 hover:bg-accent/40"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full border border-current text-[10px]">
                  {optIdx + 1}
                </span>
                <span>{opt}</span>
              </div>
              {isSelected && <span className="text-xs font-bold">✓</span>}
            </button>
          )
        })}

        {/* Option 5: Lainnya (tulis manual) */}
        {!isCustomActive ? (
          <button
            type="button"
            onClick={() => setIsCustomActive(true)}
            className={cn(
              "flex w-full items-center justify-between rounded-xl border border-dashed px-3 py-2.5 text-left text-xs transition-all",
              selectedAnswer && !currentStep.options.includes(selectedAnswer)
                ? "border-primary bg-primary/10 font-semibold text-primary"
                : "border-muted-foreground/30 text-muted-foreground hover:border-foreground hover:text-foreground"
            )}
          >
            <div className="flex items-center gap-2">
              <Edit3 className="size-3.5" />
              <span>
                {selectedAnswer && !currentStep.options.includes(selectedAnswer)
                  ? `Custom: "${selectedAnswer}"`
                  : "Lainnya (tulis manual)..."}
              </span>
            </div>
          </button>
        ) : (
          <form onSubmit={handleSaveCustom} className="flex gap-1.5 pt-1">
            <Input
              autoFocus
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="Tuliskan jawaban kustom Anda..."
              className="h-8 text-xs"
            />
            <Button type="submit" size="xs" disabled={!customInput.trim()}>
              Simpan
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setIsCustomActive(false)}
            >
              Batal
            </Button>
          </form>
        )}
      </div>

      {/* Footer Nav Controls */}
      <div className="flex items-center justify-between border-t pt-3">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={isFirst}
          onClick={() => setCurrentStepIdx((prev) => Math.max(0, prev - 1))}
          className="text-xs"
        >
          <ChevronLeft className="mr-1 size-3.5" /> Kembali
        </Button>

        <div className="flex items-center gap-2">
          {!isLast ? (
            <Button
              type="button"
              size="xs"
              onClick={() => setCurrentStepIdx((prev) => Math.min(prev + 1, steps.length - 1))}
              className="text-xs"
            >
              Lanjut <ChevronRight className="ml-1 size-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="xs"
              onClick={handleFinalSubmit}
              className="bg-primary text-primary-foreground font-semibold text-xs shadow-md hover:bg-primary/90"
            >
              <Send className="mr-1.5 size-3" />
              Kirim Semua Jawaban ({answeredCount}/{steps.length})
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
