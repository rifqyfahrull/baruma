import { describe, expect, it } from "vitest"

import { floorplanActionSchema, interiorActionSchema } from "./actions"
import {
  FEATURE_CATALOG,
  answerFeatureQuestion,
  featureCatalogPromptBlock,
  isAgentExecutable,
  isFeatureQuestion,
  matchFeatures,
} from "./feature-catalog"

const REAL_ACTIONS = new Set<string>([
  ...floorplanActionSchema.options.map((o) => o.shape.type.value),
  ...interiorActionSchema.options.map((o) => o.shape.type.value),
])

describe("feature-catalog integritas", () => {
  it("setiap trigger 'agent' menunjuk action type NYATA di actions.ts", () => {
    const bad: string[] = []
    for (const f of FEATURE_CATALOG) {
      for (const t of f.triggers) {
        if (t.kind === "agent" && !REAL_ACTIONS.has(t.action)) {
          bad.push(`${f.id} → ${t.action}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it("id unik, dan tiap entri punya keyword + contoh frasa + trigger", () => {
    const ids = FEATURE_CATALOG.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FEATURE_CATALOG) {
      expect(f.keywords.length, `${f.id} keywords`).toBeGreaterThan(0)
      expect(f.examplePhrases.length, `${f.id} contoh`).toBeGreaterThan(0)
      expect(f.triggers.length, `${f.id} trigger`).toBeGreaterThan(0)
    }
  })

  it("fitur ui_only tidak menandai dirinya agent-executable", () => {
    const skylight = FEATURE_CATALOG.find((f) => f.id === "skylight")!
    expect(isAgentExecutable(skylight)).toBe(false)
    const addRoom = FEATURE_CATALOG.find((f) => f.id === "add-room")!
    expect(isAgentExecutable(addRoom)).toBe(true)
  })

  it("entri terbaru (lampu eksterior, struktur, kelola bukaan) valid & punya action nyata", () => {
    const exteriorLamp = FEATURE_CATALOG.find((f) => f.id === "exterior-lamp")!
    expect(isAgentExecutable(exteriorLamp)).toBe(true)
    const soilBearing = FEATURE_CATALOG.find((f) => f.id === "soil-bearing")!
    expect(isAgentExecutable(soilBearing)).toBe(true)
    expect(soilBearing.category).toBe("struktur")
    const manageOpening = FEATURE_CATALOG.find((f) => f.id === "manage-opening")!
    expect(isAgentExecutable(manageOpening)).toBe(true)
  })
})

describe("matchFeatures — intent Bahasa Indonesia", () => {
  const cases: Array<[string, string]> = [
    ["saya mau bikin void terbuka ke langit di tengah", "open-to-sky"],
    ["tambahkan mezzanine di atas ruang keluarga", "mezzanine"],
    ["pasang roster terakota di fasad", "roster"],
    ["bikin atap pelana", "set-roof"],
    ["kasih skylight di atas tangga", "skylight"],
    ["susah bikin koridor di celah sempit", "add-room-in-gap"],
    ["bikin lantai 2 menjorok ke depan", "cantilever"],
    ["auto generate titik listrik", "electrical"],
  ]
  it.each(cases)("'%s' → fitur teratas mengandung %s", (q, expectedId) => {
    const ids = matchFeatures(q).map((f) => f.id)
    expect(ids).toContain(expectedId)
  })

  it("query tanpa kecocokan → kosong", () => {
    expect(matchFeatures("cuaca hari ini cerah sekali")).toEqual([])
  })

  const newCases: Array<[string, string]> = [
    ["pasang lampu dinding eksterior di teras", "exterior-lamp"],
    ["atur daya dukung tanah 180 kPa", "soil-bearing"],
    ["geser pintu kamar sedikit ke kanan", "manage-opening"],
    ["hapus jendela ruang tamu", "manage-opening"],
  ]
  it.each(newCases)("'%s' → fitur teratas mengandung %s", (q, expectedId) => {
    const ids = matchFeatures(q).map((f) => f.id)
    expect(ids).toContain(expectedId)
  })
})

describe("isFeatureQuestion / answerFeatureQuestion", () => {
  it("mengenali pertanyaan kemampuan fitur", () => {
    expect(isFeatureQuestion("bisa gak bikin skylight?")).toBe(true)
    expect(isFeatureQuestion("apakah ada fitur mezzanine?")).toBe(true)
    expect(isFeatureQuestion("gimana cara bikin void terbuka ke langit?")).toBe(true)
    expect(isFeatureQuestion("fitur apa saja yang ada?")).toBe(true)
  })

  it("tidak mengenali perintah edit sebagai pertanyaan", () => {
    expect(isFeatureQuestion("tambahkan skylight di atas tangga")).toBe(false)
    expect(isFeatureQuestion("tolong buatkan kamar mandi")).toBe(false)
    // Kalimat perintah dengan tanda tanya tetap perintah.
    expect(isFeatureQuestion("tambahkan skylight?")).toBe(false)
  })

  it("menjawab fitur UI-only dengan panduan (tanpa mengarang action)", () => {
    const answer = answerFeatureQuestion("bisa gak bikin void terbuka ke langit?")
    expect(answer).not.toBeNull()
    expect(answer).toContain("open-to-sky")
    expect(answer).toContain("courtyard")
  })

  it("pertanyaan meta 'fitur apa saja' merangkum katalog", () => {
    const answer = answerFeatureQuestion("fitur apa saja yang tersedia di baruma?")
    expect(answer).not.toBeNull()
    expect(answer).toContain("Berikut fitur-fitur")
    expect(answer).toContain("Ruang")
    expect(answer).toContain("Fasad")
  })

  it("pertanyaan fitur agent-executable TIDAK ditangkap (biarkan pipeline edit)", () => {
    // "bisa tambah kamar?" → add-room punya action → jangan dijawab katalog.
    expect(answerFeatureQuestion("bisa tambah kamar di lantai 2?")).toBeNull()
  })

  it("pertanyaan pengetahuan murni tidak ditangkap", () => {
    expect(answerFeatureQuestion("bagaimana tata letak yang baik?")).toBeNull()
    expect(answerFeatureQuestion("kenapa pakai kitchen island?")).toBeNull()
  })
})

describe("featureCatalogPromptBlock", () => {
  it("menyertakan penanda [UI] & nama fitur ui_only", () => {
    const block = featureCatalogPromptBlock()
    expect(block).toContain("[UI]")
    expect(block).toContain("Mezzanine")
    expect(block).toContain("Skylight")
  })
})
