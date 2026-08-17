"use client"

import type { FieldPath } from "react-hook-form"

import type { CreateProjectInput } from "@/lib/schemas/project"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { WizardForm } from "./types"

type Name = FieldPath<CreateProjectInput>

export function TextField({
  form,
  name,
  label,
  placeholder,
  description,
}: {
  form: WizardForm
  name: Name
  label: string
  placeholder?: string
  description?: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              placeholder={placeholder}
              {...field}
              value={(field.value as string) ?? ""}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function NumberField({
  form,
  name,
  label,
  unit,
  min,
  max,
  step,
  description,
}: {
  form: WizardForm
  name: Name
  label: string
  unit?: string
  min?: number
  max?: number
  step?: number
  description?: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => {
        const value = field.value as number | undefined
        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <div className="relative">
              {/* FormControl (Slot) must wrap the <Input> directly — not a
                  wrapper <div> — so its id/aria-* land on the actual form
                  control the <FormLabel htmlFor> points to. A div in
                  between breaks label↔control association (getByLabelText,
                  screen readers, browser-use E2E selectors). */}
              <FormControl>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={min}
                  max={max}
                  step={step}
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={
                    value === undefined || Number.isNaN(value) ? "" : value
                  }
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === "" ? undefined : e.target.valueAsNumber
                    )
                  }
                  className={unit ? "pr-12" : undefined}
                />
              </FormControl>
              {unit && (
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                  {unit}
                </span>
              )}
            </div>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}

/**
 * Percent-facing input backed by a 0..1 ratio field (e.g. KDB/KDH). Displays
 * and edits whole percent (60), stores the ratio (0.6) so it matches
 * `SiteRegulation`'s contract directly — no separate conversion step at
 * submit time.
 */
export function PercentField({
  form,
  name,
  label,
  min,
  max,
  step,
  description,
}: {
  form: WizardForm
  name: Name
  label: string
  min?: number
  max?: number
  step?: number
  description?: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => {
        const ratio = field.value as number | undefined
        const percent =
          ratio === undefined || Number.isNaN(ratio)
            ? ""
            : Math.round(ratio * 1000) / 10
        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <div className="relative">
              <FormControl>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={min}
                  max={max}
                  step={step}
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={percent}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === ""
                        ? undefined
                        : e.target.valueAsNumber / 100
                    )
                  }
                  className="pr-9"
                />
              </FormControl>
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                %
              </span>
            </div>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}

export function SelectField({
  form,
  name,
  label,
  options,
  placeholder = "Pilih…",
  description,
}: {
  form: WizardForm
  name: Name
  label: string
  options: { value: string; label: string }[]
  placeholder?: string
  description?: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select
            onValueChange={field.onChange}
            value={(field.value as string) ?? ""}
          >
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function SwitchField({
  form,
  name,
  label,
  description,
}: {
  form: WizardForm
  name: Name
  label: string
  description?: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3.5">
          <div className="space-y-0.5 pr-4">
            <FormLabel>{label}</FormLabel>
            {description && (
              <FormDescription>{description}</FormDescription>
            )}
          </div>
          <FormControl>
            <Switch
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
            />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

export function TextareaField({
  form,
  name,
  label,
  placeholder,
  description,
}: {
  form: WizardForm
  name: Name
  label: string
  placeholder?: string
  description?: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Textarea
              placeholder={placeholder}
              {...field}
              value={(field.value as string) ?? ""}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
