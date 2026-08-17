"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm, type FieldPath, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowLeft, ArrowRight, Check, Loader2, Save } from "lucide-react"
import { toast } from "sonner"

import {
  WIZARD_STEP_FIELDS,
  createProjectSchema,
  type CreateProjectInput,
} from "@/lib/schemas/project"
import { useUpdateBrief } from "@/lib/api/hooks"
import { buildBriefFields } from "@/lib/brief/build-brief"
import { track } from "@/lib/analytics"
import { cn } from "@/lib/utils"
import { Form } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { StepSite } from "./steps/step-site"
import { StepBuilding } from "./steps/step-building"
import { StepRooms } from "./steps/step-rooms"
import { StepSummary } from "./steps/step-summary"

/**
 * Edit covers the brief's design inputs (tanah / bangunan / ruang) + a review
 * step. Project-level fields (name / style / type) are carried in the form for
 * an accurate rebuilt summary but are not edited here.
 */
const EDIT_STEPS = [
  { id: "site", title: "Data tanah", subtitle: "Ukuran & kondisi lahan" },
  { id: "building", title: "Bangunan", subtitle: "Lantai, budget, prioritas" },
  { id: "rooms", title: "Kebutuhan ruang", subtitle: "Ruang yang diinginkan" },
  { id: "summary", title: "Ringkasan", subtitle: "Cek & simpan perubahan" },
] as const

export function EditBriefWizard({
  projectId,
  initialValues,
}: {
  projectId: string
  initialValues: CreateProjectInput
}) {
  const router = useRouter()
  const [step, setStep] = React.useState(0)
  const update = useUpdateBrief(projectId)

  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema as never) as Resolver<CreateProjectInput>,
    defaultValues: initialValues,
    mode: "onTouched",
  })

  const stepDef = EDIT_STEPS[step]
  const isLast = step === EDIT_STEPS.length - 1
  const progress = ((step + 1) / EDIT_STEPS.length) * 100

  const goNext = async () => {
    const fields = WIZARD_STEP_FIELDS[
      stepDef.id as keyof typeof WIZARD_STEP_FIELDS
    ] as readonly string[]
    const valid = await form.trigger(fields as FieldPath<CreateProjectInput>[])
    if (!valid) return
    setStep((s) => Math.min(s + 1, EDIT_STEPS.length - 1))
  }

  const goBack = () => setStep((s) => Math.max(s - 1, 0))

  const submit = async () => {
    const valid = await form.trigger()
    if (!valid) {
      toast.error("Masih ada data yang perlu dilengkapi.")
      return
    }
    try {
      await update.mutateAsync(buildBriefFields(form.getValues()))
      track("brief_updated", { project_id: projectId })
      toast.success("Brief berhasil diperbarui.")
      router.push(`/app/projects/${projectId}/brief`)
    } catch {
      toast.error("Gagal menyimpan brief. Coba lagi.")
    }
  }

  return (
    <Form {...form}>
      <div className="space-y-6">
        {/* Stepper */}
        <div>
          <ol className="hidden items-center gap-2 md:flex">
            {EDIT_STEPS.map((s, i) => {
              const done = i < step
              const active = i === step
              return (
                <li key={s.id} className="flex flex-1 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => i < step && setStep(i)}
                    disabled={i > step}
                    className={cn(
                      "flex items-center gap-2 text-left",
                      i <= step ? "cursor-pointer" : "cursor-default"
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold transition-colors",
                        active && "border-primary bg-primary text-primary-foreground",
                        done && "border-primary bg-primary/10 text-primary",
                        !active && !done && "border-border text-muted-foreground"
                      )}
                    >
                      {done ? <Check className="size-4" /> : i + 1}
                    </span>
                    <span className="hidden lg:block">
                      <span
                        className={cn(
                          "block text-sm font-medium",
                          active ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {s.title}
                      </span>
                    </span>
                  </button>
                  {i < EDIT_STEPS.length - 1 && (
                    <span
                      className={cn(
                        "h-px flex-1",
                        i < step ? "bg-primary" : "bg-border"
                      )}
                    />
                  )}
                </li>
              )
            })}
          </ol>

          {/* Mobile */}
          <div className="md:hidden">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">{stepDef.title}</span>
              <span className="text-muted-foreground">
                Langkah {step + 1} dari {EDIT_STEPS.length}
              </span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        </div>

        {/* Step card */}
        <Card>
          <CardContent className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">{stepDef.title}</h2>
              <p className="text-sm text-muted-foreground">{stepDef.subtitle}</p>
            </div>

            {stepDef.id === "site" && <StepSite form={form} />}
            {stepDef.id === "building" && <StepBuilding form={form} />}
            {stepDef.id === "rooms" && <StepRooms form={form} />}
            {stepDef.id === "summary" && <StepSummary form={form} />}
          </CardContent>
        </Card>

        {/* Footer nav */}
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={goBack} disabled={step === 0}>
            <ArrowLeft />
            Kembali
          </Button>

          {isLast ? (
            <Button type="button" onClick={submit} disabled={update.isPending}>
              {update.isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  Menyimpan…
                </>
              ) : (
                <>
                  <Save />
                  Simpan perubahan
                </>
              )}
            </Button>
          ) : (
            <Button type="button" onClick={goNext}>
              Lanjut
              <ArrowRight />
            </Button>
          )}
        </div>
      </div>
    </Form>
  )
}
