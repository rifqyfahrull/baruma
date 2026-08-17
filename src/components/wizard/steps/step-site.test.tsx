import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { Form } from "@/components/ui/form"
import {
  createProjectSchema,
  type CreateProjectInput,
} from "@/lib/schemas/project"
import { StepSite } from "./step-site"

// Radix Select (arah hadap depan) butuh ResizeObserver — tak ada di jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

afterEach(cleanup)

const baseValues: CreateProjectInput = {
  name: "Rumah A",
  city: "Bandung",
  projectType: "new",
  style: "modern_tropis",
  widthM: 8,
  depthM: 12,
  frontOrientation: "unknown",
  sidesAttached: 0,
  frontRoadWidthM: 5,
  carport: true,
  siteNotes: "",
  floors: 2,
  rooftop: false,
  budgetMinIDR: 500_000_000,
  budgetMaxIDR: 1_000_000_000,
  finishingLevel: "menengah",
  priorities: ["hemat_biaya"],
  rooms: [
    {
      roomType: "ruang_tamu",
      name: "Ruang tamu",
      required: true,
      quantity: 1,
      sizePreference: "standard",
    },
  ],
}

function Harness({
  onValues,
  initial,
}: {
  onValues: (v: CreateProjectInput) => void
  initial?: Partial<CreateProjectInput>
}) {
  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema as never) as Resolver<CreateProjectInput>,
    defaultValues: { ...baseValues, ...initial },
    mode: "onSubmit",
  })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onValues)}>
        <StepSite form={form} />
        <button type="submit">Submit</button>
      </form>
    </Form>
  )
}

describe("StepSite — Aturan tata ruang (opsional)", () => {
  it("section tertutup secara default dan bisa dibuka lewat trigger-nya", () => {
    render(<Harness onValues={vi.fn()} />)
    expect(screen.queryByLabelText("KDB maksimum (%)")).toBeNull()

    fireEvent.click(
      screen.getByRole("button", { name: "Buka aturan tata ruang (opsional)" })
    )
    expect(screen.getByLabelText("KDB maksimum (%)")).toBeTruthy()
    expect(screen.getByLabelText("KLB maksimum")).toBeTruthy()
    expect(screen.getByLabelText("GSB depan (meter)")).toBeTruthy()
    expect(screen.getByLabelText("KDH minimum (%)")).toBeTruthy()
  })

  it("section terbuka otomatis saat sudah ada nilai regulation ter-prefill (mode edit)", () => {
    render(
      <Harness
        onValues={vi.fn()}
        initial={{ regulation: { maxKdb: 0.6, minKdh: 0.15 } }}
      />
    )
    expect(screen.getByLabelText("KDB maksimum (%)")).toBeTruthy()
  })

  it("menampilkan rasio sebagai persen (0.6 -> 60) untuk KDB/KDH yang sudah terisi", () => {
    render(
      <Harness
        onValues={vi.fn()}
        initial={{ regulation: { maxKdb: 0.6, minKdh: 0.15 } }}
      />
    )
    expect(
      (screen.getByLabelText("KDB maksimum (%)") as HTMLInputElement).value
    ).toBe("60")
    expect(
      (screen.getByLabelText("KDH minimum (%)") as HTMLInputElement).value
    ).toBe("15")
  })

  it("field kosong -> submit TIDAK menyertakan angka (undefined, bukan 0)", async () => {
    const onValues = vi.fn()
    render(<Harness onValues={onValues} />)
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    await vi.waitFor(() => expect(onValues).toHaveBeenCalledTimes(1))
    const submitted = onValues.mock.calls[0][0] as CreateProjectInput
    expect(
      submitted.regulation === undefined ||
        (submitted.regulation.maxKdb === undefined &&
          submitted.regulation.maxKlb === undefined &&
          submitted.regulation.gsbM === undefined &&
          submitted.regulation.minKdh === undefined)
    ).toBe(true)
  })

  it("mengisi KDB 60% dan KDH 15% -> submit menyimpan rasio 0.6 dan 0.15 (bukan 60/15)", async () => {
    const onValues = vi.fn()
    render(<Harness onValues={onValues} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Buka aturan tata ruang (opsional)" })
    )

    fireEvent.change(screen.getByLabelText("KDB maksimum (%)"), {
      target: { value: "60" },
    })
    fireEvent.change(screen.getByLabelText("KLB maksimum"), {
      target: { value: "1.8" },
    })
    fireEvent.change(screen.getByLabelText("GSB depan (meter)"), {
      target: { value: "3" },
    })
    fireEvent.change(screen.getByLabelText("KDH minimum (%)"), {
      target: { value: "15" },
    })

    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    await vi.waitFor(() => expect(onValues).toHaveBeenCalledTimes(1))
    const submitted = onValues.mock.calls[0][0] as CreateProjectInput
    expect(submitted.regulation).toEqual({
      maxKdb: 0.6,
      maxKlb: 1.8,
      gsbM: 3,
      minKdh: 0.15,
    })
  })
})
