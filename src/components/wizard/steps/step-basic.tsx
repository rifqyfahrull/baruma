"use client"

import { HOUSE_STYLES } from "@/lib/constants"
import { SelectField, TextField } from "../fields"
import type { WizardForm } from "../types"

const styleOptions = Object.entries(HOUSE_STYLES).map(([value, label]) => ({
  value,
  label,
}))

export function StepBasic({ form }: { form: WizardForm }) {
  return (
    <div className="space-y-5">
      <TextField
        form={form}
        name="name"
        label="Nama project"
        placeholder="Contoh: Rumah Impian Keluarga"
      />
      <TextField
        form={form}
        name="city"
        label="Lokasi (kota/kabupaten)"
        placeholder="Contoh: Sidoarjo"
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          form={form}
          name="projectType"
          label="Tipe project"
          options={[
            { value: "new", label: "Rumah baru" },
            { value: "renovation", label: "Renovasi" },
          ]}
        />
        <SelectField
          form={form}
          name="style"
          label="Gaya awal"
          options={styleOptions}
        />
      </div>
    </div>
  )
}
