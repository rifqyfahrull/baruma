import type { UseFormReturn } from "react-hook-form"

import type { CreateProjectInput } from "@/lib/schemas/project"

export type WizardForm = UseFormReturn<CreateProjectInput>

export type WizardStepId = "basic" | "site" | "building" | "rooms" | "summary"

export type WizardStepDef = {
  id: WizardStepId
  title: string
  subtitle: string
}

export const WIZARD_STEPS: WizardStepDef[] = [
  { id: "basic", title: "Info dasar", subtitle: "Nama & lokasi project" },
  { id: "site", title: "Data tanah", subtitle: "Ukuran & kondisi lahan" },
  { id: "building", title: "Bangunan", subtitle: "Lantai, budget, prioritas" },
  { id: "rooms", title: "Kebutuhan ruang", subtitle: "Ruang yang diinginkan" },
  { id: "summary", title: "Ringkasan", subtitle: "Cek & buat project" },
]
