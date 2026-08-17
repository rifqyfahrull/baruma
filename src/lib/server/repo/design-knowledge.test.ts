// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const query = vi.fn()
vi.mock("@/lib/server/db", () => ({ query: (...a: unknown[]) => query(...a) }))

import { retrieveDesignKnowledge, formatDesignKnowledgeNote, sceneKnowledgeNote } from "./design-knowledge"

beforeEach(() => {
  query.mockReset()
  query.mockResolvedValue({ rows: [] })
})

describe("retrieveDesignKnowledge", () => {
  it("membuang stopword & meneruskan kata bermakna ke query", async () => {
    await retrieveDesignKnowledge("kenapa saya harus pakai kitchen island?")
    const params = query.mock.calls.at(-1)?.[1] as [string[], number]
    const words = params[0]
    expect(words).toContain("kitchen")
    expect(words).toContain("island")
    expect(words).not.toContain("saya")
    expect(words).not.toContain("kenapa")
    // parameter kedua = limit (pola %kata% tak dipakai lagi — kini kata utuh)
    expect(params[1]).toBe(3)
  })

  it("membuang kata-tanya yang dulu memicu grounding ngawur", async () => {
    // "mana" pernah menarik topik "Batu paliMANan" via pencocokan substring.
    await retrieveDesignKnowledge("gudang sebaiknya ditaruh di mana?")
    const words = query.mock.calls.at(-1)?.[1]?.[0] as string[]
    expect(words).not.toContain("mana")
    expect(words).not.toContain("ditaruh")
    expect(words).not.toContain("sebaiknya")
    expect(words).toContain("gudang")
  })

  it("mencocokkan KATA UTUH, bukan substring (anti 'mana'→'palimanan')", async () => {
    await retrieveDesignKnowledge("kitchen island")
    const sql = String(query.mock.calls.at(-1)?.[0])
    expect(sql).toContain("~*")
    expect(sql).toContain("\\m")
    expect(sql).toContain("\\M")
    expect(sql).not.toContain("ILIKE")
  })

  it("mencocokkan juga keywords bahasa awam, dgn bobot nama topik lebih tinggi", async () => {
    // Pemilik rumah bilang "atap cor rembes", bukan "waterproofing dak beton".
    await retrieveDesignKnowledge("atap cor rembes")
    const sql = String(query.mock.calls.at(-1)?.[0])
    expect(sql).toContain("dk.keywords")
    expect(sql).toContain("in_topic")
    // cocok di nama topik dibobot 1.5×; dominasi nama hanya dari nama topik
    expect(sql).toContain("THEN 1.5")
    expect(sql).toContain("CASE WHEN m.in_topic")
  })

  it("menyaring relevansi di SQL: butuh >=2 kata cocok atau 1 kata dominan", async () => {
    const sql = String(
      (await retrieveDesignKnowledge("kitchen island"), query.mock.calls.at(-1)?.[0]),
    )
    expect(sql).toContain("hits >= 2")
    expect(sql).toContain("cover >= 0.6")
    expect(sql).toContain("0.7 *")
  })

  it("ekspansi sinonim: 'gerbang' ikut mencari 'gate'", async () => {
    await retrieveDesignKnowledge("model gerbang minimalis")
    const words = query.mock.calls.at(-1)?.[1]?.[0] as string[]
    expect(words).toContain("gerbang")
    expect(words).toContain("gate")
  })

  it("pertanyaan tanpa kata bermakna → tak query, array kosong", async () => {
    const r = await retrieveDesignKnowledge("apa itu?")
    expect(r).toEqual([])
    expect(query).not.toHaveBeenCalled()
  })

  it("meneruskan baris hasil apa adanya (penyaringan sudah di SQL)", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: "furniture:kitchen-island", topic_type: "furniture", topic: "Kitchen island", knowledge: {} },
      ],
    })
    const r = await retrieveDesignKnowledge("kitchen island")
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe("furniture:kitchen-island")
  })
})

describe("sceneKnowledgeNote", () => {
  it("memakai ruang TERPILIH sbg konteks (instruksi editor sering cuma 'rapikan')", async () => {
    await sceneKnowledgeNote(
      {
        selectedRoomId: "r2",
        rooms: [
          { roomId: "r1", name: "Ruang tamu", type: "ruang_tamu" },
          { roomId: "r2", name: "Kamar tidur utama", type: "kamar_tidur" },
        ],
      },
      "rapikan",
    )
    const words = query.mock.calls.at(-1)?.[1]?.[0] as string[]
    expect(words).toContain("kamar")
    expect(words).toContain("tidur")
    // ruang yang TIDAK dipilih tak ikut mengotori konteks
    expect(words).not.toContain("tamu")
  })

  it("mengambil topik ruang LANGSUNG by-nama, tak bergantung skor fuzzy", async () => {
    // "tata ulang" pada Dapur sempat mengembalikan Melamine/PVC sheet karena
    // kata instruksi generik mengalahkan topik ruangnya sendiri.
    query.mockResolvedValueOnce({
      rows: [{ id: "room:dapur", topic_type: "room", topic: "Dapur", knowledge: { layout_principles: ["zonasi basah-kering"] } }],
    })
    const note = await sceneKnowledgeNote(
      { selectedRoomId: "r1", rooms: [{ roomId: "r1", name: "Dapur", type: "dapur" }] },
      "tata ulang",
    )
    const exactSql = String(query.mock.calls[0]?.[0])
    expect(exactSql).toContain("lower(topic) = ANY")
    expect(query.mock.calls[0]?.[1]?.[0]).toEqual(["dapur"])
    expect(note).toContain("Dapur")
    expect(note).toContain("zonasi basah-kering")
  })

  it("tanpa ruang terpilih, memakai beberapa ruang pertama", async () => {
    await sceneKnowledgeNote(
      { rooms: [{ id: "r1", name: "Dapur", type: "dapur" }] },
      "tata ulang",
    )
    expect(query.mock.calls.at(-1)?.[1]?.[0]).toContain("dapur")
  })

  it("gagal-diam: error retrieval → undefined, prompt tetap jalan", async () => {
    query.mockRejectedValueOnce(new Error("db down"))
    await expect(
      sceneKnowledgeNote({ rooms: [{ id: "r1", name: "Dapur", type: "dapur" }] }, "tata"),
    ).resolves.toBeUndefined()
  })
})

describe("formatDesignKnowledgeNote", () => {
  it("array kosong → string kosong", () => {
    expect(formatDesignKnowledgeNote([])).toBe("")
  })

  it("meringkas array & string field jadi bullet kompak", () => {
    const note = formatDesignKnowledgeNote([
      {
        id: "furniture:kitchen-island",
        topic_type: "furniture",
        topic: "Kitchen island",
        knowledge: {
          why_used: ["Menambah area kerja", "Storage ekstra"],
          when_not_to_use: ["Dapur < 3 meter"],
          tropical_note: "Pilih material tahan lembap",
        },
      },
    ])
    expect(note).toContain("Kitchen island (furniture)")
    expect(note).toContain("why_used: Menambah area kerja; Storage ekstra")
    expect(note).toContain("when_not_to_use: Dapur < 3 meter")
    expect(note).toContain("tropical_note: Pilih material tahan lembap")
  })
})
