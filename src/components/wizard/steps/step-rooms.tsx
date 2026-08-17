"use client"

import { useFieldArray, type FieldPath } from "react-hook-form"
import { Check, Trash2 } from "lucide-react"

import { ROOM_TYPES, SELECTABLE_ROOMS } from "@/lib/constants"
import type {
  CreateProjectInput,
  RoomRequirementInput,
} from "@/lib/schemas/project"

type WizardRoomType = RoomRequirementInput["roomType"]
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { WizardForm } from "../types"

const sizeOptions = [
  { value: "small", label: "Kecil" },
  { value: "standard", label: "Standar" },
  { value: "large", label: "Luas" },
]

export function StepRooms({ form }: { form: WizardForm }) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "rooms",
  })
  const floors = form.watch("floors") || 1
  const roomsError = form.formState.errors.rooms?.message

  const selectedTypes = new Set(fields.map((f) => f.roomType))

  const toggleRoom = (rt: WizardRoomType) => {
    const idx = fields.findIndex((f) => f.roomType === rt)
    if (idx >= 0) {
      remove(idx)
    } else {
      append({
        roomType: rt,
        name: ROOM_TYPES[rt].label,
        required: true,
        quantity: 1,
        sizePreference: "standard",
        notes: "",
      })
    }
  }

  const floorOptions = Array.from({ length: floors }, (_, i) => ({
    value: String(i + 1),
    label: `Lantai ${i + 1}`,
  }))

  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <Label>Pilih ruang yang diinginkan</Label>
        <div className="flex flex-wrap gap-2">
          {(SELECTABLE_ROOMS as WizardRoomType[]).map((rt) => {
            const active = selectedTypes.has(rt)
            return (
              <button
                key={rt}
                type="button"
                onClick={() => toggleRoom(rt)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-muted"
                )}
              >
                {active && <Check className="size-3.5" />}
                {ROOM_TYPES[rt].label}
              </button>
            )
          })}
        </div>
        {roomsError && <p className="text-sm text-destructive">{roomsError}</p>}
      </div>

      {fields.length > 0 && (
        <div className="space-y-3">
          <Label>Atur detail ruang ({fields.length})</Label>
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="rounded-xl border bg-card p-3.5"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-medium">
                    {ROOM_TYPES[field.roomType].label}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => remove(index)}
                    aria-label="Hapus ruang"
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Quantity */}
                  <FormField
                    control={form.control}
                    name={
                      `rooms.${index}.quantity` as FieldPath<CreateProjectInput>
                    }
                    render={({ field: f }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-muted-foreground">
                          Jumlah
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            max={10}
                            value={(f.value as number) ?? 1}
                            onChange={(e) =>
                              f.onChange(
                                e.target.value === ""
                                  ? 1
                                  : e.target.valueAsNumber
                              )
                            }
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {/* Preferred floor */}
                  <FormField
                    control={form.control}
                    name={
                      `rooms.${index}.preferredFloor` as FieldPath<CreateProjectInput>
                    }
                    render={({ field: f }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-muted-foreground">
                          Lantai
                        </FormLabel>
                        <Select
                          value={f.value != null ? String(f.value) : ""}
                          onValueChange={(v) => f.onChange(Number(v))}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Mana saja" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {floorOptions.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />

                  {/* Size */}
                  <FormField
                    control={form.control}
                    name={
                      `rooms.${index}.sizePreference` as FieldPath<CreateProjectInput>
                    }
                    render={({ field: f }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-muted-foreground">
                          Ukuran
                        </FormLabel>
                        <Select
                          value={(f.value as string) ?? "standard"}
                          onValueChange={f.onChange}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {sizeOptions.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />

                  {/* Required */}
                  <FormField
                    control={form.control}
                    name={
                      `rooms.${index}.required` as FieldPath<CreateProjectInput>
                    }
                    render={({ field: f }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-muted-foreground">
                          Wajib ada
                        </FormLabel>
                        <div className="flex h-9 items-center">
                          <FormControl>
                            <Switch
                              checked={Boolean(f.value)}
                              onCheckedChange={f.onChange}
                            />
                          </FormControl>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
