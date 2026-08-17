"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm, type FieldPath, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import {
  WIZARD_STEP_FIELDS,
  createProjectSchema,
  type CreateProjectInput,
} from "@/lib/schemas/project"
import { useCreateProject } from "@/lib/api/hooks"
import { track } from "@/lib/analytics"
import { cn } from "@/lib/utils"
import { Form } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { WIZARD_STEPS } from "./types"
import { StepBasic } from "./steps/step-basic"
import { StepSite } from "./steps/step-site"
import { StepBuilding } from "./steps/step-building"
import { StepRooms } from "./steps/step-rooms"
import { StepSummary } from "./steps/step-summary"

const defaultValues: CreateProjectInput = {
  name: "",
  city: "",
  projectType: "new",
  style: "modern_tropis",
  widthM: 8,
  depthM: 12,
  frontOrientation: "unknown",
  sidesAttached: 2,
  frontRoadWidthM: 5,
  carport: true,
  siteNotes: "",
  floors: 2,
  rooftop: false,
  budgetMinIDR: 500_000_000,
  budgetMaxIDR: 1_000_000_000,
  finishingLevel: "menengah",
  priorities: [],
  rooms: [
    { roomType: "ruang_tamu", name: "Ruang tamu", required: true, quantity: 1, sizePreference: "standard" },
    { roomType: "dapur", name: "Dapur", required: true, quantity: 1, sizePreference: "standard" },
    { roomType: "kamar_tidur", name: "Kamar tidur", required: true, quantity: 2, sizePreference: "standard" },
    { roomType: "kamar_mandi", name: "Kamar mandi", required: true, quantity: 2, sizePreference: "standard" },
  ],
}

export function CreateProjectWizard() {
  const router = useRouter()
  const [step, setStep] = React.useState(0)
  const create = useCreateProject()

  const form = useForm<CreateProjectInput>({
    // zodResolver's overloads pin zod's internal version literal; cast keeps
    // runtime intact (resolvers 5.4 + zod 4.4 work) while satisfying TS.
    resolver: zodResolver(createProjectSchema as never) as Resolver<CreateProjectInput>,
    defaultValues,
    mode: "onTouched",
  })

  const stepDef = WIZARD_STEPS[step]
  const isLast = step === WIZARD_STEPS.length - 1
  const progress = ((step + 1) / WIZARD_STEPS.length) * 100

  const goNext = async () => {
    const fields = WIZARD_STEP_FIELDS[
      stepDef.id as keyof typeof WIZARD_STEP_FIELDS
    ] as readonly string[]
    const valid = await form.trigger(
      fields as FieldPath<CreateProjectInput>[]
    )
    if (!valid) return
    track("wizard_step_completed", { step: stepDef.id, source: "create_wizard" })
    setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1))
  }

  const goBack = () => setStep((s) => Math.max(s - 1, 0))

  const submit = async () => {
    const valid = await form.trigger()
    if (!valid) {
      toast.error("Masih ada data yang perlu dilengkapi.")
      return
    }
    try {
      const { project } = await create.mutateAsync(form.getValues())
      track("project_created", { project_id: project.id, source: "create_wizard" })
      track("brief_generated", { project_id: project.id })
      toast.success("Project berhasil dibuat.")
      router.push(`/app/projects/${project.id}/brief`)
    } catch {
      toast.error("Gagal membuat project. Coba lagi.")
    }
  }

  return (
    <Form {...form}>
      <div className="space-y-6">
        {/* Stepper */}
        <div>
          <ol className="hidden items-center gap-2 md:flex">
            {WIZARD_STEPS.map((s, i) => {
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
                        active &&
                          "border-primary bg-primary text-primary-foreground",
                        done && "border-primary bg-primary/10 text-primary",
                        !active &&
                          !done &&
                          "border-border text-muted-foreground"
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
                  {i < WIZARD_STEPS.length - 1 && (
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
                Langkah {step + 1} dari {WIZARD_STEPS.length}
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
              <p className="text-sm text-muted-foreground">
                {stepDef.subtitle}
              </p>
            </div>

            {step === 0 && <StepBasic form={form} />}
            {step === 1 && <StepSite form={form} />}
            {step === 2 && <StepBuilding form={form} />}
            {step === 3 && <StepRooms form={form} />}
            {step === 4 && <StepSummary form={form} />}
          </CardContent>
        </Card>

        {/* Footer nav */}
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={goBack}
            disabled={step === 0}
          >
            <ArrowLeft />
            Kembali
          </Button>

          {isLast ? (
            <Button type="button" onClick={submit} disabled={create.isPending}>
              {create.isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  Membuat…
                </>
              ) : (
                <>
                  <Sparkles />
                  Buat project
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
