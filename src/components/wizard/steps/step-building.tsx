"use client"

import { Check } from "lucide-react"

import {
  BUDGET_PRESETS,
  FINISHING_LEVELS,
  PRIORITIES,
  PRIORITY_ORDER,
} from "@/lib/constants"
import { formatIDRRange } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { NumberField, SelectField, SwitchField } from "../fields"
import type { WizardForm } from "../types"

const finishingOptions = Object.entries(FINISHING_LEVELS).map(
  ([value, meta]) => ({ value, label: `${meta.label} — ${meta.description}` })
)

export function StepBuilding({ form }: { form: WizardForm }) {
  const min = form.watch("budgetMinIDR")
  const max = form.watch("budgetMaxIDR")
  const priorities = form.watch("priorities") ?? []
  const prioritiesError = form.formState.errors.priorities?.message

  const togglePriority = (p: (typeof PRIORITY_ORDER)[number]) => {
    const next = priorities.includes(p)
      ? priorities.filter((x) => x !== p)
      : [...priorities, p]
    form.setValue("priorities", next, { shouldValidate: true })
  }

  const setBudget = (lo: number, hi: number) => {
    form.setValue("budgetMinIDR", lo, { shouldValidate: true })
    form.setValue("budgetMaxIDR", hi, { shouldValidate: true })
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <NumberField
          form={form}
          name="floors"
          label="Jumlah lantai"
          min={1}
          max={4}
          step={1}
        />
        <SwitchField
          form={form}
          name="rooftop"
          label="Pakai rooftop"
          description="Area atap untuk lounge/jemur."
        />
      </div>

      <div className="space-y-2.5">
        <Label>Range budget</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BUDGET_PRESETS.map((preset) => {
            const active =
              min === preset.value.minIDR && max === preset.value.maxIDR
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() =>
                  setBudget(preset.value.minIDR, preset.value.maxIDR)
                }
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-muted"
                )}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
        <p className="text-sm text-muted-foreground">
          Estimasi anggaran: {formatIDRRange(min || 0, max || 0)}
        </p>
      </div>

      <SelectField
        form={form}
        name="finishingLevel"
        label="Target kualitas finishing"
        options={finishingOptions}
      />

      <div className="space-y-2.5">
        <Label>Prioritas utama</Label>
        <p className="text-sm text-muted-foreground">
          Pilih hal yang paling penting buat kamu (boleh lebih dari satu).
        </p>
        <div className="flex flex-wrap gap-2">
          {PRIORITY_ORDER.map((p) => {
            const active = priorities.includes(p)
            return (
              <button
                key={p}
                type="button"
                onClick={() => togglePriority(p)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-muted"
                )}
              >
                {active && <Check className="size-3.5" />}
                {PRIORITIES[p]}
              </button>
            )
          })}
        </div>
        {prioritiesError && (
          <p className="text-sm text-destructive">{prioritiesError}</p>
        )}
      </div>
    </div>
  )
}
