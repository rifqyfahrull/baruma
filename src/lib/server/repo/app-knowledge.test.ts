// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const query = vi.fn()
vi.mock("@/lib/server/db", () => ({ query: (...a: unknown[]) => query(...a) }))

import { retrieveAppKnowledge, formatAppKnowledgeNote, appMechanicsNote } from "./app-knowledge"

beforeEach(() => {
  query.mockReset()
  query.mockResolvedValue({ rows: [] })
})

describe("retrieveAppKnowledge", () => {
  it("tak query bila tak ada kata bermakna", async () => {
    const r = await retrieveAppKnowledge("apa itu?")
    expect(r).toEqual([])
    expect(query).not.toHaveBeenCalled()
  })

  it("meneruskan kata bermakna & limit ke query", async () => {
    await retrieveAppKnowledge("tambah ruang baru")
    const params = query.mock.calls.at(-1)?.[1] as [string[], number, boolean]
    expect(params[0]).toContain("ruang")
    expect(params[1]).toBe(4)
  })

  it("mendeteksi niat aksi dari verba (hapus/tambah/pindah/…) & meneruskannya sbg parameter boost", async () => {
    await retrieveAppKnowledge("hapus stopkontak di ruang keluarga")
    const actionIntent = query.mock.calls.at(-1)?.[1]?.[2]
    expect(actionIntent).toBe(true)
  })

  it("pertanyaan tanpa verba aksi → actionIntent false", async () => {
    await retrieveAppKnowledge("apa fungsi kolam renang di aplikasi ini")
    const actionIntent = query.mock.calls.at(-1)?.[1]?.[2]
    expect(actionIntent).toBe(false)
  })

  it("mencocokkan kata utuh (bukan substring) & nama+keywords", async () => {
    await retrieveAppKnowledge("void")
    const sql = String(query.mock.calls.at(-1)?.[0])
    expect(sql).toContain("ak.name ILIKE")
    expect(sql).toContain("ak.keywords")
    expect(sql).toContain("\\m")
    expect(sql).toContain("\\M")
  })

  it("membobot kind='action' lebih tinggi HANYA saat actionIntent true", async () => {
    await retrieveAppKnowledge("hapus lampu taman")
    const sql = String(query.mock.calls.at(-1)?.[0])
    expect(sql).toContain("ak0.kind = 'action'")
    expect(sql).toContain("1.6")
    // boost diterapkan DI DALAM CTE scored (sebelum ambang WHERE), bukan cuma
    // ORDER BY — kalau tidak, aksi bernilai rendah sudah terbuang duluan.
    expect(sql).toMatch(/scored AS \([\s\S]*1\.6[\s\S]*\)\s*SELECT/)
  })

  it("meneruskan baris hasil apa adanya (penyaringan sudah di SQL)", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: "action:deleteRoom", kind: "action", name: "deleteRoom", knowledge: {} }],
    })
    const r = await retrieveAppKnowledge("hapus ruang tamu")
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe("action:deleteRoom")
  })
})

describe("formatAppKnowledgeNote", () => {
  it("array kosong → string kosong", () => {
    expect(formatAppKnowledgeNote([])).toBe("")
  })

  it("meringkas what/effects/constraints/pitfalls jadi bullet kompak", () => {
    const note = formatAppKnowledgeNote([
      {
        id: "mechanic:dinding-otomatis",
        kind: "mechanic",
        name: "Dinding otomatis dari persegi ruang",
        knowledge: {
          what: "Dinding diturunkan dari persegi ruang saat render.",
          effects: ["Ruang tipe OPEN_TYPES dirender tanpa dinding"],
          constraints: ["Tidak disimpan sbg data terpisah"],
          pitfalls: ["Mengira perlu menggambar dinding manual"],
        },
      },
    ])
    expect(note).toContain("Dinding otomatis dari persegi ruang (mechanic)")
    expect(note).toContain("Dinding diturunkan dari persegi ruang saat render.")
    expect(note).toContain("effects: Ruang tipe OPEN_TYPES dirender tanpa dinding")
    expect(note).toContain("pitfalls: Mengira perlu menggambar dinding manual")
  })
})

describe("appMechanicsNote", () => {
  it("gagal-diam: error query → undefined, tak melempar", async () => {
    query.mockRejectedValueOnce(new Error("db down"))
    await expect(appMechanicsNote("tambah ruang")).resolves.toBeUndefined()
  })

  it("tak ada hasil → undefined (bukan string kosong)", async () => {
    const r = await appMechanicsNote("apa itu?")
    expect(r).toBeUndefined()
  })

  it("ada hasil → note terformat", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: "action:addRoom", kind: "action", name: "addRoom", knowledge: { what: "Buat ruang baru." } }],
    })
    const r = await appMechanicsNote("tambah ruang")
    expect(r).toContain("addRoom")
  })
})
