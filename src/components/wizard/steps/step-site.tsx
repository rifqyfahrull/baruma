"use client"

import * as React from "react"
import { ChevronDown, Ruler, Scale } from "lucide-react"

import { formatArea, formatNumber } from "@/lib/format"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import {
  NumberField,
  PercentField,
  SelectField,
  SwitchField,
  TextareaField,
} from "../fields"
import type { WizardForm } from "../types"

const orientationOptions = [
  { value: "north", label: "Utara" },
  { value: "east", label: "Timur" },
  { value: "south", label: "Selatan" },
  { value: "west", label: "Barat" },
  { value: "unknown", label: "Belum tahu" },
]

export function StepSite({ form }: { form: WizardForm }) {
  const width = form.watch("widthM")
  const depth = form.watch("depthM")
  const area =
    Number.isFinite(width) && Number.isFinite(depth) ? width * depth : 0

  const regulation = form.watch("regulation")
  const hasRegulationValue = Boolean(
    regulation &&
      (regulation.maxKdb !== undefined ||
        regulation.maxKlb !== undefined ||
        regulation.gsbM !== undefined ||
        regulation.minKdh !== undefined)
  )
  const [regulationOpen, setRegulationOpen] = React.useState(hasRegulationValue)

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <NumberField
          form={form}
          name="widthM"
          label="Lebar tanah"
          unit="m"
          min={3}
          max={50}
          step={0.5}
        />
        <NumberField
          form={form}
          name="depthM"
          label="Panjang tanah"
          unit="m"
          min={3}
          max={100}
          step={0.5}
        />
      </div>

      <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3.5">
        <span className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
          <Ruler className="size-4.5" />
        </span>
        <div>
          <p className="text-xs text-muted-foreground">Luas tanah (otomatis)</p>
          <p className="font-semibold">
            {area > 0 ? formatArea(area) : "—"}{" "}
            {area > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                ({formatNumber(width)} × {formatNumber(depth)} m)
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          form={form}
          name="frontOrientation"
          label="Arah hadap depan"
          options={orientationOptions}
        />
        <NumberField
          form={form}
          name="sidesAttached"
          label="Sisi menempel tetangga"
          min={0}
          max={4}
          step={1}
          description="0–4 sisi"
        />
      </div>

      <NumberField
        form={form}
        name="frontRoadWidthM"
        label="Lebar jalan depan (opsional)"
        unit="m"
        min={0}
        max={30}
        step={0.5}
      />

      <SwitchField
        form={form}
        name="carport"
        label="Butuh carport"
        description="Sediakan area parkir mobil di depan."
      />

      <TextareaField
        form={form}
        name="siteNotes"
        label="Catatan kondisi tanah (opsional)"
        placeholder="Contoh: ada kontur turun di belakang, dekat sungai, dll."
      />

      <Collapsible
        open={regulationOpen}
        onOpenChange={setRegulationOpen}
        className="rounded-lg border p-3.5"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left"
            aria-label="Buka aturan tata ruang (opsional)"
          >
            <Scale className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">
              Aturan tata ruang (opsional)
            </span>
            <ChevronDown
              className={cn(
                "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
                regulationOpen && "rotate-180"
              )}
            />
          </button>
        </CollapsibleTrigger>

        <p className="mt-1.5 text-xs text-muted-foreground">
          Isi jika Anda tahu angka Perda/RDTR lokasi Anda. Kosongkan untuk
          pakai default nasional (advisory).
        </p>

        <CollapsibleContent className="mt-3.5 space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <PercentField
              form={form}
              name="regulation.maxKdb"
              label="KDB maksimum (%)"
              min={5}
              max={100}
              step={1}
              description="Koefisien Dasar Bangunan — persentase lahan yang boleh tertutup bangunan."
            />
            <NumberField
              form={form}
              name="regulation.maxKlb"
              label="KLB maksimum"
              min={0.1}
              max={10}
              step={0.1}
              description="Koefisien Lantai Bangunan — total luas lantai dibagi luas lahan."
            />
            <NumberField
              form={form}
              name="regulation.gsbM"
              label="GSB depan (meter)"
              unit="m"
              min={0}
              max={20}
              step={0.5}
              description="Garis Sempadan Bangunan — jarak minimum bangunan dari batas depan lahan."
            />
            <PercentField
              form={form}
              name="regulation.minKdh"
              label="KDH minimum (%)"
              min={5}
              max={100}
              step={1}
              description="Koefisien Dasar Hijau — persentase lahan yang wajib tetap ruang terbuka hijau/resapan."
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
