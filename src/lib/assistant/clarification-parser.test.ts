import { describe, expect, it } from "vitest"
import { parseClarificationSteps } from "./clarification-parser"

describe("parseClarificationSteps", () => {
  it("parses multi-point clarification requests with bold headers", () => {
    const text = `
Baik, mari kita susun brief desain rumah Anda. Saya perlu beberapa informasi awal:

1. **Gaya rumah** – misalnya minimalis, industrial, klasik, tropis, atau lainnya?
2. **Jumlah lantai** – berapa lantai yang direncanakan?
3. **Kebutuhan ruang** – ruang tamu, kamar tidur, dapur, dll.
4. **Prioritas utama** – misalnya pencahayaan alami, efisiensi biaya, atau fungsionalitas?
5. **Batasan** – ada anggaran maksimal atau luas tanah tertentu?

Silakan jawab poin-poin di atas.
`

    const steps = parseClarificationSteps(text)
    expect(steps).toHaveLength(5)
    expect(steps[0].title).toBe("Gaya rumah")
    expect(steps[0].options).toEqual(["minimalis", "industrial", "klasik", "tropis"])
    expect(steps[1].title).toBe("Jumlah lantai")
    expect(steps[1].options).toContain("1 Lantai")
    expect(steps[3].title).toBe("Prioritas utama")
    expect(steps[3].options).toEqual(["pencahayaan alami", "efisiensi biaya", "fungsionalitas"])
  })
})
