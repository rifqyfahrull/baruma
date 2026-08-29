// @vitest-environment node
/**
 * Unit test `sanitizeStyleNotes` — spec 2026-08-29 §4 Server. Pure &
 * deterministik: matriks aturan (URL, kontrol char, kutip ganda, collapse
 * whitespace, cap 240, kosong/whitespace-only/null/undefined -> undefined).
 */
import { describe, expect, it } from "vitest"

import { sanitizeStyleNotes } from "./style-notes"

describe("sanitizeStyleNotes — kasus dasar", () => {
  it("null -> undefined", () => {
    expect(sanitizeStyleNotes(null)).toBeUndefined()
  })

  it("undefined -> undefined", () => {
    expect(sanitizeStyleNotes(undefined)).toBeUndefined()
  })

  it("string kosong -> undefined", () => {
    expect(sanitizeStyleNotes("")).toBeUndefined()
  })

  it("whitespace-only -> undefined", () => {
    expect(sanitizeStyleNotes("   \t\n  ")).toBeUndefined()
  })

  it("teks biasa lolos apa adanya (trim saja)", () => {
    expect(sanitizeStyleNotes("  warm sunset mood, add a dog  ")).toBe("warm sunset mood, add a dog")
  })
})

describe("sanitizeStyleNotes — buang URL", () => {
  it("URL https:// di tengah kalimat dibuang", () => {
    const out = sanitizeStyleNotes("please check https://evil.com/inject and add trees")
    expect(out).not.toContain("https://")
    expect(out).not.toContain("evil.com")
    expect(out).toContain("please check")
    expect(out).toContain("and add trees")
  })

  it("URL http:// dibuang", () => {
    const out = sanitizeStyleNotes("visit http://example.com now")
    expect(out).not.toContain("http://")
    expect(out).not.toContain("example.com")
  })

  it("URL bentuk www. (tanpa skema) dibuang", () => {
    const out = sanitizeStyleNotes("go to www.example.com please")
    expect(out).not.toContain("www.")
    expect(out).not.toContain("example.com")
  })

  it("beberapa URL sekaligus semua dibuang", () => {
    const out = sanitizeStyleNotes("see https://a.com and www.b.com and http://c.com/x?y=1")
    expect(out).not.toMatch(/https?:\/\//)
    expect(out).not.toContain("www.")
  })
})

describe("sanitizeStyleNotes — karakter kontrol", () => {
  it("karakter kontrol U+0000-U+001F dibuang", () => {
    const out = sanitizeStyleNotes("warm\x00mood\x07 add\x1fdog")
    expect(out).toBe("warmmood adddog")
  })

  it("karakter kontrol U+007F (DEL) dibuang", () => {
    const out = sanitizeStyleNotes("warm\x7fmood")
    expect(out).toBe("warmmood")
  })

  it("newline/tab TERMASUK kontrol char (U+000A/U+0009) — dibuang, bukan collapse jadi spasi", () => {
    const out = sanitizeStyleNotes("warm\nmood\tadd dog")
    expect(out).toBe("warmmoodadd dog")
  })

  it("spasi biasa di antara newline/tab TETAP collapse (bukan kontrol char)", () => {
    const out = sanitizeStyleNotes("warm \n mood \t add   dog")
    expect(out).toBe("warm mood add dog")
  })
})

describe("sanitizeStyleNotes — kutip ganda -> kutip tunggal", () => {
  it("mengganti semua kutip ganda dengan kutip tunggal", () => {
    const out = sanitizeStyleNotes('add a sign that says "welcome home"')
    expect(out).toBe("add a sign that says 'welcome home'")
  })
})

describe("sanitizeStyleNotes — collapse whitespace", () => {
  it("banyak spasi berturut-turut jadi satu spasi", () => {
    const out = sanitizeStyleNotes("warm   sunset     mood")
    expect(out).toBe("warm sunset mood")
  })
})

describe("sanitizeStyleNotes — cap 240 karakter", () => {
  it("teks lebih dari 240 karakter dipotong ke 240", () => {
    const long = "a".repeat(300)
    const out = sanitizeStyleNotes(long)
    expect(out).toHaveLength(240)
  })

  it("teks persis 240 karakter tidak berubah panjangnya", () => {
    const exact = "b".repeat(240)
    const out = sanitizeStyleNotes(exact)
    expect(out).toHaveLength(240)
  })

  it("teks di bawah 240 karakter tidak dipotong", () => {
    const short = "warm mood"
    expect(sanitizeStyleNotes(short)).toBe(short)
  })
})

describe("sanitizeStyleNotes — determinisme", () => {
  it("input sama menghasilkan output sama (dipanggil dua kali)", () => {
    const raw = 'visit https://x.com now "please" add   dog\x00!'
    expect(sanitizeStyleNotes(raw)).toBe(sanitizeStyleNotes(raw))
  })
})

describe("sanitizeStyleNotes — kombinasi semua aturan", () => {
  it("URL + kontrol char + kutip ganda + collapse + trim + cap sekaligus", () => {
    const raw =
      '  add a "welcome"\x00 sign,   visit https://evil.com/x and www.spam.com now  '
    const out = sanitizeStyleNotes(raw)
    expect(out).toBe("add a 'welcome' sign, visit and now")
  })

  it("hasil kosong setelah sanitasi (hanya URL + kontrol char) -> undefined", () => {
    const out = sanitizeStyleNotes("https://evil.com/only-a-url\x00\x07")
    expect(out).toBeUndefined()
  })
})

describe("sanitizeStyleNotes — bypass www menempel kata (temuan review C2)", () => {
  it("membuang www. yang menempel langsung ke huruf sebelumnya", () => {
    expect(sanitizeStyleNotes("contactwww.evil.com now")).toBe("contact now")
  })
})
