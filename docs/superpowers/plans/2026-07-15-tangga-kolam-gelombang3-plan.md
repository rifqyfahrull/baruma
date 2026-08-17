# Tangga & Kolam — Gelombang 3 (Kelas Premium) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kolam kelas premium: sistem overflow + balancing tank, validasi keselamatan & beban (kolam di lantai atas/dak), spa lengkap (jet/heater/chlorinator + filter cartridge). Plus bersih-bersih tipe `Stair`/`Pool` dorman yang membingungkan engineer.

**Architecture:** Semua fitur baru = field opsional pada `Room` + derivasi pure di modul yang sudah ada (`pool-circulation.ts`, `pool-electrical.ts`) atau modul pure baru (`pool-safety.ts`). Perilaku lama (skimmer, spa tanpa jet, kolam lantai dasar) tetap byte-identical: field absent → cabang lama. Konsumen (3D, denah pipa, RAB, kelistrikan PLN, review) hanya membaca derivasi.

**Tech Stack:** TypeScript, zod, Vitest. Prasyarat: Gelombang 1 & 2 selesai (`2026-07-15-tangga-kolam-gelombang1-plan.md`, `...gelombang2-plan.md`; commit s/d de2cd1b).

**Sumber:** `docs/superpowers/plans/2026-07-15-tangga-kolam-investigasi-lapangan.md` (WP: KL-4, KL-6, KL-7, TG-6, KL-8).

## Global Constraints

- Semua command lewat Git Bash prefix `rtk`. TDD ketat (RED → GREEN → commit per task).
- Kolam = `Room type:"kolam"`. JANGAN memakai tipe dorman `Stair`/`Pool` (Task 7 justru mendeprekasinya).
- **Back-compat mutlak**: `poolCirculationType` absent → `"skimmer"` (perilaku lama); `poolHasJets`/`poolHeater`/`poolSaltChlorinator` absent → tanpa beban/item tambahan; kolam di lantai dasar → tanpa warning beban. Test existing tidak boleh berubah ekspektasinya KECUALI yang disebut eksplisit di Task 5 (filter cartridge untuk spa/plunge — perubahan disengaja).
- Room schema zod `.passthrough()` — field baru tetap ditambah eksplisit (pola Gelombang 2).
- Konstanta konstruksi/hidraulik/listrik baru hanya di modul yang ditunjuk task-nya (`pool.ts`, `pool-circulation.ts`, `pool-electrical.ts`, `pool-safety.ts`).
- Semua item RAB baru: confidence `"low"`, `sourceElementIds`, notes. Struktur balancing tank ber-notes "Perlu review struktur."
- Commit message bahasa Indonesia via **heredoc bash** (JANGAN PowerShell multiline — hindari artefak `` `n ``), diakhiri `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Di luar scope (dicatat sebagai debt, jangan dikerjakan)**: pool cover otomatis; ruang mesin/backwash sebagai geometri terpisah; jarak-ke-batas-lahan di KL-6 (butuh `Project.site`, tidak tersedia di `poolSafetyIssues` layout-only — ditandai future); analisis struktur beban dak yang sesungguhnya (V1 hanya warning rule-based).
- Hotspot (`pool-circulation.ts`, `pool-electrical.ts`, `rab.ts`, `preview-controls.tsx`, `build-model.ts`, `review.ts`): patch integrasi kecil; logika di modul pure.

---

### Task 1: KL-4 domain — sistem overflow + balancing tank (pure)

**Files:**
- Modify: `src/types/index.ts` (di bawah `poolEntrySide`)
- Modify: `src/lib/schemas/layout.ts` (room schema, di bawah `poolEntrySide`)
- Modify: `src/lib/three/pool-circulation.ts`
- Modify: `src/lib/assistant/actions.ts` (2 tempat pola `poolEntrySide`), `src/lib/assistant/apply.ts`
- Test: `src/lib/three/pool.test.ts`

**Interfaces (dipakai Task 2–3):**
```ts
export type PoolCirculationType = "skimmer" | "overflow"
// PoolCirculation bertambah field:
//   circulationType: PoolCirculationType
//   gutterM: number          // keliling gutter (overflow), 0 utk skimmer
//   balancingTankM3: number  // 7% volume (overflow), 0 utk skimmer
```
Aturan (dikunci): overflow → `skimmers = 0` (gutter keliling menggantikan skimmer), `gutterM = round1(2×(w+d))`, `balancingTankM3 = round2(volumeM3 × 0.07)`. Skimmer (default) → perilaku lama persis.

- [x] **Step 1: Field domain + schema + AI**

`src/types/index.ts`, tepat di bawah `poolEntrySide`:
```ts
  /** Sistem sirkulasi kolam: skimmer (default, ekonomis) atau overflow
   *  (gutter keliling + balancing tank — kelas premium). */
  poolCirculationType?: "skimmer" | "overflow" | null;
```

`src/lib/schemas/layout.ts`, di bawah `poolEntrySide`:
```ts
          poolCirculationType: z.enum(["skimmer", "overflow"]).nullable().optional(),
```

`src/lib/assistant/actions.ts` (KEDUA tempat pola `poolEntrySide`), tambah di bawahnya:
```ts
  poolCirculationType: z.enum(["skimmer", "overflow"]).nullable().optional(),
```
`src/lib/assistant/apply.ts` (pola `poolEntrySide: r.poolEntrySide`), tambah:
```ts
      poolCirculationType: r.poolCirculationType,
```

Run: `rtk tsc --noEmit` → PASS. `rtk vitest run src/lib/schemas/layout.test.ts` → PASS.

- [x] **Step 2: Failing test (hand-calc)**

Tambahkan ke `src/lib/three/pool.test.ts`:
```ts
import { poolCirculation } from "./pool-circulation"

describe("poolCirculation — sistem overflow (KL-4)", () => {
  const base = { width: 4, depth: 8, areaM2: 32, poolKind: "renang" as const }

  it("skimmer (default) — perilaku lama, tanpa gutter/balancing", () => {
    const c = poolCirculation(base)
    expect(c.circulationType).toBe("skimmer")
    expect(c.gutterM).toBe(0)
    expect(c.balancingTankM3).toBe(0)
    expect(c.skimmers).toBeGreaterThan(0)
  })

  it("overflow — skimmer 0, gutter keliling, balancing tank 7% volume", () => {
    const c = poolCirculation({ ...base, poolCirculationType: "overflow" })
    expect(c.circulationType).toBe("overflow")
    expect(c.skimmers).toBe(0)
    expect(c.gutterM).toBe(24) // 2*(4+8)
    // volume 48 → balancing 3.36
    expect(c.balancingTankM3).toBeCloseTo(3.36, 2)
  })
})
```

Run: `rtk vitest run src/lib/three/pool.test.ts` → FAIL.

- [x] **Step 3: Implementasi di pool-circulation.ts**

Tambah tipe & field. Di `PoolCirculation` type tambahkan:
```ts
  circulationType: PoolCirculationType
  /** Panjang gutter keliling (m) — overflow saja, else 0. */
  gutterM: number
  /** Volume balancing tank (m³) ≈ 7% volume kolam — overflow saja, else 0. */
  balancingTankM3: number
```
Tambah export tipe (dekat `PoolFilterKind`):
```ts
export type PoolCirculationType = "skimmer" | "overflow"
```
Perluas `Pick` signature `poolCirculation` dengan `"poolCirculationType"`. Setelah `const mainDrains = ...`, ganti blok skimmer/return + return object:
```ts
  const circulationType: PoolCirculationType = room.poolCirculationType ?? "skimmer"
  const overflow = circulationType === "overflow"
  const skimmersEff = overflow ? 0 : skimmers
  const gutterM = overflow ? round1(2 * (room.width + room.depth)) : 0
  const balancingTankM3 = overflow ? round2(volumeM3 * 0.07) : 0

  const fittings = skimmersEff + returns + mainDrains
  const estPipeM = round1(2 * (room.width + room.depth) + fittings * 4)

  return {
    areaM2: round1(areaM2),
    avgDepthM,
    volumeM3,
    turnoverHours,
    flowM3h,
    pumpHp,
    filterKind: "pasir",
    filterDiaInch,
    skimmers: skimmersEff,
    returns,
    mainDrains,
    suctionPipeMm,
    returnPipeMm,
    estPipeM,
    circulationType,
    gutterM,
    balancingTankM3,
  }
```
(Hapus `const fittings`/`const estPipeM` lama yang di atas — dipindah ke blok ini.)

Perluas `Pick` signature `poolFittings` dengan `"poolCirculationType"`. Di `poolFittings`, bungkus loop skimmer agar hanya skimmer-mode, dan tambah glyph balancing tank untuk overflow:
```ts
  if (c.circulationType === "skimmer") {
    for (let i = 0; i < c.skimmers; i++) {
      out.push({ kind: "skimmer", u: (i + 1) / (c.skimmers + 1), v: 0, label: "Skimmer" })
    }
  }
  // ... loop return & drain tetap ...
  out.push({ kind: "equipment", u: 1.18, v: 0.5, label: "Pompa & filter" })
  if (c.circulationType === "overflow") {
    out.push({ kind: "equipment", u: 1.18, v: 0.15, label: "Balancing tank" })
  }
```

Run: `rtk vitest run src/lib/three/pool.test.ts` → PASS.

- [x] **Step 4: Verifikasi silang + commit**

Run: `rtk vitest run src/lib/three src/lib/assistant src/lib/mock/rab.test.ts` → PASS (skimmer default → RAB tak berubah).

```bash
rtk git add src/types/index.ts src/lib/schemas/layout.ts src/lib/three/pool-circulation.ts src/lib/three/pool.test.ts src/lib/assistant/
rtk git commit -m "$(cat <<'EOF'
feat(pool): sistem overflow + balancing tank — domain sirkulasi (KL-4)

poolCirculationType skimmer|overflow. Overflow: skimmer digantikan gutter
keliling (gutterM) + balancing tank 7% volume (balancingTankM3); poolFittings
menambah glyph balancing tank. Skimmer default = perilaku lama byte-identical.
Field masuk schema layout & patch AI.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: KL-4 denah pipa + PoolQuickEditor toggle

**Files:**
- Modify: `src/lib/drawings/pool-piping.ts` (`scheduleRows` + `drawOnePool`)
- Modify: `src/components/preview-3d/preview-controls.tsx` (PoolQuickEditor, section "Sistem perairan")
- Test: `src/lib/drawings/pool-piping.test.ts`

- [x] **Step 1: Failing test denah**

Tambahkan ke `src/lib/drawings/pool-piping.test.ts`:
```ts
it("kolam overflow: skedul memuat gutter + balancing tank, tanpa skimmer", () => {
  const base = poolLayout() // helper existing di file (kolam renang 4×8)
  base.rooms = base.rooms.map((r) =>
    r.id === "room-pool" ? { ...r, poolCirculationType: "overflow" } : r)
  const d = buildPoolPiping(base)
  const texts = d.labels.map((l) => l.text).join("\n")
  expect(texts).toContain("Balancing tank")
  expect(texts).toContain("Gutter keliling")
  expect(texts).not.toContain("Skimmer")
})
```
(Jika helper `poolLayout()` belum ada di file, ikuti fixture yang dipakai test lain di file — buat inline seperti test existing.)

Run: `rtk vitest run src/lib/drawings/pool-piping.test.ts` → FAIL.

- [x] **Step 2: Implementasi**

Di `scheduleRows` (pool-piping.ts), ganti baris skimmer/filter agar adaptif:
```ts
function scheduleRows(pool: Room, c: ReturnType<typeof poolCirculation>): string[] {
  const e = poolElectrical(pool)
  const rows = [
    `Volume ${c.volumeM3} m³ · Turnover ${c.turnoverHours} jam · Debit ${c.flowM3h} m³/jam`,
    `Pompa ${c.pumpHp} HP (${e.pumpKw.toFixed(2)} kW) · MCB ${e.pumpBreakerA} A`,
    c.filterKind === "cartridge" ? `Filter cartridge` : `Filter pasir Ø${c.filterDiaInch}"`,
    c.circulationType === "overflow"
      ? `Gutter keliling ±${c.gutterM} m · Inlet ${c.returns} · Main drain ${c.mainDrains}`
      : `Skimmer ${c.skimmers} · Inlet ${c.returns} · Main drain ${c.mainDrains}`,
    `Hisap Ø${c.suctionPipeMm} / balik Ø${c.returnPipeMm} mm · Pipa ±${c.estPipeM} m`,
    `Lampu ${e.lights}×${25} W 12V · Trafo ${e.transformerVa} VA · Bonding ±${e.bondingM} m`,
  ]
  if (c.circulationType === "overflow") {
    rows.push(`Balancing tank ±${c.balancingTankM3} m³`)
  }
  return rows
}
```

Run: `rtk vitest run src/lib/drawings/pool-piping.test.ts` → PASS (glyph "Balancing tank" sudah dari `poolFittings` Task 1; "Gutter keliling" dari schedule row baru).

- [x] **Step 3: PoolQuickEditor toggle**

Di preview-controls.tsx, section "Sistem perairan" (sebelum `const c = poolCirculation(pool)` block atau tepat di dalamnya), tambahkan toggle di atas grid Spec:
```tsx
                <div className="flex gap-1 pb-1">
                  {(
                    [
                      ["skimmer", "Skimmer"],
                      ["overflow", "Overflow"],
                    ] as const
                  ).map(([v, label]) => (
                    <Button
                      key={v}
                      size="sm"
                      variant={(pool.poolCirculationType ?? "skimmer") === v ? "default" : "outline"}
                      aria-label={`Sistem ${label}`}
                      onClick={() =>
                        updateRoom(pool.id, { poolCirculationType: v === "skimmer" ? null : v })
                      }
                    >
                      {label}
                    </Button>
                  ))}
                </div>
```
Dan ganti baris Spec skimmer agar adaptif:
```tsx
                  {c.circulationType === "overflow" ? (
                    <Spec k="Gutter" v={`±${c.gutterM} m`} />
                  ) : (
                    <Spec k="Skimmer" v={`${c.skimmers}`} />
                  )}
```
Tambah Spec balancing tank saat overflow (di grid): `{c.circulationType === "overflow" && <Spec k="Balancing" v={`${c.balancingTankM3} m³`} />}`.

- [x] **Step 4: Verifikasi + commit**

Run: `rtk vitest run src/lib/drawings/pool-piping.test.ts src/components/preview-3d 2>&1 | tail -3` → PASS. `rtk tsc --noEmit` → PASS.

```bash
rtk git add src/lib/drawings/pool-piping.ts src/lib/drawings/pool-piping.test.ts src/components/preview-3d/preview-controls.tsx
rtk git commit -m "$(cat <<'EOF'
feat(pool): denah pipa & UI overflow — gutter + balancing tank di skedul MEP

Skedul Denah Pipa Kolam menyesuaikan untuk overflow (gutter keliling +
balancing tank, tanpa skimmer); PoolQuickEditor punya toggle Skimmer/Overflow
dan spec adaptif. Skimmer default tak berubah.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: KL-4 RAB — balancing tank + gutter

**Files:**
- Modify: `src/lib/mock/rab.ts` (blok MEP kolam, setelah item "Pipa sirkulasi + fitting")
- Test: `src/lib/mock/rab.test.ts`

Rate (konstanta di rab.ts, confidence low): balancing tank beton Rp 4.500.000/m³; gutter grating Rp 450.000/m.

- [x] **Step 1: Failing test**

Tambahkan ke `rab.test.ts` (describe KL-5 pool atau baru):
```ts
it("kolam overflow: item balancing tank (m³) + gutter (m) muncul; skimmer-only tidak", () => {
  const base = makeLayout()
  const overflowLayout: DesignLayout = { ...base, rooms: [...base.rooms,
    { ...base.rooms[0], id: "room-pool", name: "Kolam", type: "kolam",
      x: 1, y: 1, width: 4, depth: 8, areaM2: 32, poolKind: "renang",
      poolCirculationType: "overflow" }] }
  const rab = generateRAB(sampleProject, sampleBrief, overflowLayout)
  expect(rab.items.some((i) => i.item.includes("Balancing tank"))).toBe(true)
  expect(rab.items.some((i) => i.item.includes("Gutter"))).toBe(true)

  const skimmerLayout: DesignLayout = { ...base, rooms: [...base.rooms,
    { ...base.rooms[0], id: "room-pool", name: "Kolam", type: "kolam",
      x: 1, y: 1, width: 4, depth: 8, areaM2: 32, poolKind: "renang" }] }
  const rab2 = generateRAB(sampleProject, sampleBrief, skimmerLayout)
  expect(rab2.items.some((i) => i.item.includes("Balancing tank"))).toBe(false)
})
```

Run: `rtk vitest run src/lib/mock/rab.test.ts` → FAIL.

- [x] **Step 2: Implementasi**

Di rab.ts, setelah `specs.push(... "Pipa sirkulasi + fitting" ...)`, tambahkan (memakai `circ` array yang sudah ada):
```ts
    const overflowPools = poolRooms.filter((r) => (r.poolCirculationType ?? "skimmer") === "overflow")
    if (overflowPools.length > 0) {
      const oc = overflowPools.map((r) => ({ id: r.id, c: poolCirculation(r) }))
      const totalBalancingM3 = oc.reduce((s, x) => s + x.c.balancingTankM3, 0)
      const totalGutterM = oc.reduce((s, x) => s + x.c.gutterM, 0)
      const ids = oc.map((x) => x.id)
      specs.push(
        {
          category: "kolam",
          item: "Balancing tank beton (sistem overflow)",
          volume: round1(totalBalancingM3),
          unit: "m³",
          total: totalBalancingM3 * 4_500_000,
          confidence: "low",
          notes: "±7% volume kolam, K-300. Perlu review struktur.",
          sourceElementIds: ids,
        },
        {
          category: "kolam",
          item: "Gutter keliling + grating (sistem overflow)",
          volume: round1(totalGutterM),
          unit: "m",
          total: totalGutterM * 450_000,
          confidence: "low",
          sourceElementIds: ids,
        },
      )
    }
```

Run: `rtk vitest run src/lib/mock/rab.test.ts` → PASS.

- [x] **Step 3: Commit**

```bash
rtk git add src/lib/mock/rab.ts src/lib/mock/rab.test.ts
rtk git commit -m "$(cat <<'EOF'
feat(pool): RAB overflow — balancing tank beton m³ + gutter grating m lari

Hanya untuk kolam poolCirculationType overflow; sourceElementIds per kolam.
Skimmer-only tak menambah item. Balancing tank ber-notes review struktur.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: KL-6 — validasi keselamatan & beban kolam (modul pure + wire ke review)

**Files:**
- Create: `src/lib/water/pool-safety.ts`
- Create: `src/lib/water/pool-safety.test.ts`
- Modify: `src/lib/mock/review.ts` (push warnings)
- Test tambahan: (review test bila ada — cek `src/lib/mock/review.test.ts`)

**Interfaces:**
```ts
export type PoolSafetyIssue = {
  level: "warning" | "danger" | "info"
  poolId: string
  title: string
  message: string
}
export function poolSafetyIssues(
  layout: Pick<DesignLayout, "rooms" | "floors">,
  brief: Pick<Brief, "spaceProgram">,
): PoolSafetyIssue[]
```
Aturan:
- Kolam di `floor-rooftop` ATAU lantai `level > 1` → **danger** "Kolam di lantai atas: beban air ±X ton — wajib analisis struktur & ruang mesin." X = `Math.round(poolCirculation(room).volumeM3)` (air ≈ 1 t/m³).
- Brief menyebut anak (spaceProgram ada item `roomType === "kamar_anak"` ATAU nama cocok `/anak|balita|bayi/i`) → **warning** per kolam "Ada anak di rumah — pasang pagar pengaman kolam tinggi ≥ 1,1 m." 
- (Jarak ke batas lahan: DEFERRED — butuh `Project.site`, tidak tersedia di sini; dicatat di komentar modul.)

- [x] **Step 1: Failing test**

```ts
// src/lib/water/pool-safety.test.ts
import { describe, expect, it } from "vitest"

import { poolSafetyIssues } from "./pool-safety"
import type { DesignLayout, Brief } from "@/types"

const floors = [
  { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3 },
  { id: "floor-rooftop", level: 3, name: "Rooftop", heightM: 3 },
]
const poolAt = (floorId: string) => ({
  id: "room-pool", floorId, name: "Kolam", type: "kolam" as const,
  x: 1, y: 1, width: 4, depth: 8, areaM2: 32, poolKind: "renang" as const,
})
const briefNoKids = { spaceProgram: [] } as unknown as Brief
const briefKids = {
  spaceProgram: [{ roomType: "kamar_anak", name: "Kamar Anak", required: true, quantity: 1 }],
} as unknown as Brief

describe("poolSafetyIssues", () => {
  it("kolam di dak → danger beban ton (air ~1 t/m³)", () => {
    const issues = poolSafetyIssues(
      { rooms: [poolAt("floor-rooftop")], floors } as DesignLayout, briefNoKids)
    const load = issues.find((i) => i.level === "danger")
    expect(load).toBeDefined()
    expect(load!.message).toContain("48 ton") // volume 32×1.5 = 48
  })

  it("kolam lantai dasar tanpa anak → tanpa issue", () => {
    const issues = poolSafetyIssues(
      { rooms: [poolAt("floor-1")], floors } as DesignLayout, briefNoKids)
    expect(issues).toHaveLength(0)
  })

  it("ada kamar anak → warning pagar pengaman", () => {
    const issues = poolSafetyIssues(
      { rooms: [poolAt("floor-1")], floors } as DesignLayout, briefKids)
    expect(issues.some((i) => i.level === "warning" && /pagar pengaman/i.test(i.message))).toBe(true)
  })
})
```

Run: `rtk vitest run src/lib/water/pool-safety.test.ts` → FAIL.

- [x] **Step 2: Implementasi**

```ts
// src/lib/water/pool-safety.ts
/**
 * Validasi keselamatan & beban kolam (KL-6) — advisory rule-based, BUKAN
 * analisis struktur final. Air ≈ 1 t/m³: kolam di lantai atas/dak menambah
 * beban besar → wajib engineer struktur + ruang mesin. Bila brief menyebut
 * anak, sarankan pagar pengaman. Modul murni, mudah ditest.
 *
 * DEFERRED (Gelombang berikutnya): jarak ke batas lahan (butuh Project.site,
 * tidak tersedia di kontrak layout-only ini).
 */
import type { Brief, DesignLayout } from "@/types"
import { poolCirculation } from "@/lib/three/pool-circulation"

export type PoolSafetyIssue = {
  level: "warning" | "danger" | "info"
  poolId: string
  title: string
  message: string
}

const CHILD_RE = /anak|balita|bayi/i

function briefHasChildren(brief: Pick<Brief, "spaceProgram">): boolean {
  return (brief.spaceProgram ?? []).some(
    (i) => i.roomType === "kamar_anak" || CHILD_RE.test(i.name ?? ""),
  )
}

export function poolSafetyIssues(
  layout: Pick<DesignLayout, "rooms" | "floors">,
  brief: Pick<Brief, "spaceProgram">,
): PoolSafetyIssue[] {
  const issues: PoolSafetyIssue[] = []
  const pools = layout.rooms.filter((r) => r.type === "kolam")
  const hasKids = briefHasChildren(brief)
  for (const pool of pools) {
    const floor = layout.floors.find((f) => f.id === pool.floorId)
    const upper = pool.floorId === "floor-rooftop" || (floor?.level ?? 1) > 1
    if (upper) {
      const tons = Math.round(poolCirculation(pool).volumeM3)
      issues.push({
        level: "danger",
        poolId: pool.id,
        title: "Beban kolam di lantai atas",
        message: `Kolam di lantai atas: beban air ±${tons} ton — wajib analisis struktur & ruang mesin.`,
      })
    }
    if (hasKids) {
      issues.push({
        level: "warning",
        poolId: pool.id,
        title: "Keselamatan anak",
        message: "Ada anak di rumah — pasang pagar pengaman kolam tinggi ≥ 1,1 m.",
      })
    }
  }
  return issues
}
```

Run: `rtk vitest run src/lib/water/pool-safety.test.ts` → PASS.

- [x] **Step 3: Wire ke generateReview**

Di `src/lib/mock/review.ts`, setelah blok `const hasPool = ...` (atau dekat warnings lain), tambahkan:
```ts
  for (const issue of poolSafetyIssues(layout, brief)) {
    warnings.push({
      id: `pool-safety-${issue.poolId}-${issue.level}`,
      level: issue.level,
      category: "structural",
      title: issue.title,
      message: issue.message,
    })
  }
```
Import: `import { poolSafetyIssues } from "@/lib/water/pool-safety"`. (Cek: `RiskWarning` category menerima `"structural"` — lihat tipe; bila enum berbeda, ikuti nilai valid. `warnings` sudah dideklarasi di atas.)

Run: `rtk vitest run src/lib/mock` → PASS (perbaiki `review.test.ts` bila meng-assert jumlah warning tetap — sesuaikan ke jumlah baru untuk fixture berkolam-di-dak).

- [x] **Step 4: Commit**

```bash
rtk git add src/lib/water/pool-safety.ts src/lib/water/pool-safety.test.ts src/lib/mock/review.ts src/lib/mock/review.test.ts
rtk git commit -m "$(cat <<'EOF'
feat(pool): validasi keselamatan & beban (KL-6) — warning kolam di dak + pagar anak

poolSafetyIssues (modul pure): kolam di lantai atas/dak → danger beban air
±X ton (1 t/m³) wajib engineer struktur; brief dengan anak → warning pagar
pengaman ≥1,1 m. Diteruskan ke generateReview. Jarak-ke-batas ditunda
(butuh Project.site).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: KL-7 domain — spa lengkap (jet/heater/chlorinator) + filter cartridge + kelistrikan (pure)

**PERUBAHAN PERILAKU DISENGAJA**: `filterKind` menjadi `"cartridge"` untuk spa (dan plunge kecil < 15 m³). Test/UI yang meng-assert "pasir" untuk spa/plunge di-update.

**Files:**
- Modify: `src/types/index.ts` (di bawah `poolCirculationType`)
- Modify: `src/lib/schemas/layout.ts` + `src/lib/assistant/actions.ts` (2×) + `apply.ts`
- Modify: `src/lib/three/pool-circulation.ts` (filterKind cartridge)
- Modify: `src/lib/three/pool-electrical.ts` (jet/heater/chlorinator watt)
- Modify: `src/lib/electrical/costing.ts` (`deriveApplianceLoads`)
- Test: `src/lib/three/pool.test.ts`, `src/lib/electrical/costing.test.ts`

**Interfaces:**
```ts
// PoolElectrical bertambah:
//   jetBlowerW: number    // 1500 bila poolHasJets (spa/plunge), else 0
//   heaterW: number       // 3000 bila poolHeater, else 0
//   chlorinatorW: number  // 150 bila poolSaltChlorinator, else 0
// (totalLoadW sudah termasuk ketiganya)
// PoolCirculation.filterKind: "cartridge" utk spa & plunge<15m³, else "pasir"
```
Konstanta beban (di pool-electrical.ts): `POOL_JET_BLOWER_W = 1500`, `POOL_HEATER_W = 3000`, `POOL_CHLORINATOR_W = 150`.

- [x] **Step 1: Field domain + schema + AI**

`src/types/index.ts` di bawah `poolCirculationType`:
```ts
  /** Spa/jacuzzi: aktifkan jet/blower (menambah beban listrik & RAB). */
  poolHasJets?: boolean | null;
  /** Pemanas air kolam (listrik) — opsional. */
  poolHeater?: boolean | null;
  /** Sistem klorinasi garam (salt chlorinator) — opsional. */
  poolSaltChlorinator?: boolean | null;
```
`src/lib/schemas/layout.ts`:
```ts
          poolHasJets: z.boolean().nullable().optional(),
          poolHeater: z.boolean().nullable().optional(),
          poolSaltChlorinator: z.boolean().nullable().optional(),
```
`actions.ts` (2×) + `apply.ts` (3 baris `poolHasJets: r.poolHasJets`, dst.) — pola sama.

- [x] **Step 2: Failing test (filter cartridge + electrical)**

Tambahkan ke `src/lib/three/pool.test.ts`:
```ts
describe("poolCirculation — filter cartridge spa/plunge (KL-7)", () => {
  it("spa → cartridge", () => {
    const c = poolCirculation({ width: 2, depth: 2, areaM2: 4, poolKind: "spa" })
    expect(c.filterKind).toBe("cartridge")
  })
  it("renang → tetap pasir", () => {
    const c = poolCirculation({ width: 4, depth: 8, areaM2: 32, poolKind: "renang" })
    expect(c.filterKind).toBe("pasir")
  })
})
```
Tambahkan ke `src/lib/three/pool.test.ts` (electrical):
```ts
import { poolElectrical } from "./pool-electrical"

describe("poolElectrical — beban spa (KL-7)", () => {
  const spa = { width: 2, depth: 2, areaM2: 4, poolKind: "spa" as const }
  it("tanpa opsi → jet/heater/chlorinator 0", () => {
    const e = poolElectrical(spa)
    expect(e.jetBlowerW).toBe(0)
    expect(e.heaterW).toBe(0)
    expect(e.chlorinatorW).toBe(0)
  })
  it("dengan opsi → watt sesuai + totalLoadW termasuk", () => {
    const e = poolElectrical({ ...spa, poolHasJets: true, poolHeater: true, poolSaltChlorinator: true })
    expect(e.jetBlowerW).toBe(1500)
    expect(e.heaterW).toBe(3000)
    expect(e.chlorinatorW).toBe(150)
    expect(e.totalLoadW).toBeGreaterThanOrEqual(1500 + 3000 + 150)
  })
})
```

Run: `rtk vitest run src/lib/three/pool.test.ts` → FAIL.

- [x] **Step 3: Implementasi circulation + electrical**

`pool-circulation.ts`: ganti `filterKind: "pasir"` di return dengan variabel:
```ts
  const filterKind: PoolFilterKind =
    kind === "spa" || (kind === "plunge" && volumeM3 < 15) ? "cartridge" : "pasir"
```
dan pakai `filterKind` di return object.

`pool-electrical.ts`: tambah konstanta + perluas `Pick` dengan `"poolHasJets" | "poolHeater" | "poolSaltChlorinator" | "poolShallowM" | "poolDeepM"` (poolShallow/Deep sudah dibutuhkan poolCirculation via room; teruskan). Tambah field ke `PoolElectrical` type (`jetBlowerW`, `heaterW`, `chlorinatorW`). Hitung:
```ts
  const jetBlowerW = room.poolHasJets ? POOL_JET_BLOWER_W : 0
  const heaterW = room.poolHeater ? POOL_HEATER_W : 0
  const chlorinatorW = room.poolSaltChlorinator ? POOL_CHLORINATOR_W : 0
  const totalLoadW = Math.round(pumpKw * 1000 + lightsTotalW + jetBlowerW + heaterW + chlorinatorW)
```
dan sertakan ketiganya di return.

Run: `rtk vitest run src/lib/three/pool.test.ts` → PASS. (Perbaiki test/UI lain yang meng-assert filter "pasir" utk spa — grep `filterKind` & "pasir" dulu: `rtk grep 'Filter pasir' src/`.)

- [x] **Step 4: deriveApplianceLoads + verifikasi**

Di `costing.ts` `deriveApplianceLoads`, di blok `poolRooms.length > 0`, tambahkan setelah lampu-kolam:
```ts
    const jetW = poolRooms.reduce((s, r) => s + poolElectrical(r).jetBlowerW, 0)
    if (jetW > 0) out.push({ id: "jet-spa", label: "Jet/blower spa", watt: jetW, qty: 1, hoursPerDay: 1, source: "spa" })
    const heaterW = poolRooms.reduce((s, r) => s + poolElectrical(r).heaterW, 0)
    if (heaterW > 0) out.push({ id: "heater-kolam", label: "Pemanas kolam", watt: heaterW, qty: 1, hoursPerDay: 2, source: "kolam" })
    const chlorW = poolRooms.reduce((s, r) => s + poolElectrical(r).chlorinatorW, 0)
    if (chlorW > 0) out.push({ id: "chlorinator-kolam", label: "Salt chlorinator", watt: chlorW, qty: 1, hoursPerDay: 8, source: "kolam" })
```
Tambahkan test di `costing.test.ts` (ikuti pola test existing): kolam spa dengan jets → `deriveApplianceLoads` memuat entri `jet-spa`.

Run: `rtk vitest run src/lib/electrical src/lib/three/pool.test.ts` → PASS.

- [x] **Step 5: Commit**

```bash
rtk git add src/types/index.ts src/lib/schemas/layout.ts src/lib/assistant/ src/lib/three/pool-circulation.ts src/lib/three/pool-electrical.ts src/lib/three/pool.test.ts src/lib/electrical/
rtk git commit -m "$(cat <<'EOF'
feat(pool): spa lengkap (KL-7) — jet/heater/chlorinator + filter cartridge + beban PLN

Field poolHasJets/poolHeater/poolSaltChlorinator; poolElectrical menghitung
jetBlowerW 1500 / heaterW 3000 / chlorinatorW 150 (0 bila off) dan
deriveApplianceLoads menambah beban PLN. filterKind cartridge utk spa &
plunge<15m³ (perubahan disengaja), pasir utk lainnya. Field masuk schema & AI.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: KL-7 RAB + PoolQuickEditor + filter label

**Files:**
- Modify: `src/lib/mock/rab.ts` (blok MEP kolam)
- Modify: `src/components/preview-3d/preview-controls.tsx` (PoolQuickEditor: toggles spa + filter label)
- Test: `src/lib/mock/rab.test.ts`

Rate (di rab.ts): jet set spa Rp 6.500.000; heater Rp 8.500.000; salt chlorinator Rp 7.500.000 — per kolam yang mengaktifkan.

- [x] **Step 1: Failing test RAB**

```ts
it("spa dengan jet/heater/chlorinator: tiga item ekstra; tanpa opsi tidak", () => {
  const base = makeLayout()
  const spaLayout: DesignLayout = { ...base, rooms: [...base.rooms,
    { ...base.rooms[0], id: "room-spa", name: "Spa", type: "kolam",
      x: 1, y: 1, width: 2, depth: 2, areaM2: 4, poolKind: "spa",
      poolHasJets: true, poolHeater: true, poolSaltChlorinator: true }] }
  const rab = generateRAB(sampleProject, sampleBrief, spaLayout)
  expect(rab.items.some((i) => i.item.includes("Jet/blower spa"))).toBe(true)
  expect(rab.items.some((i) => i.item.includes("Pemanas kolam"))).toBe(true)
  expect(rab.items.some((i) => i.item.includes("Salt chlorinator"))).toBe(true)
  expect(rab.summary.midIDR).toBe(rab.items.reduce((s, i) => s + i.totalIDR, 0))
})
```

Run: `rtk vitest run src/lib/mock/rab.test.ts` → FAIL.

- [x] **Step 2: Implementasi RAB**

Di rab.ts, setelah blok kelistrikan kolam (bonding), tambahkan:
```ts
    const jetPools = poolRooms.filter((r) => r.poolHasJets)
    if (jetPools.length > 0) {
      specs.push({ category: "kolam", item: "Jet/blower spa", volume: jetPools.length, unit: "set",
        total: jetPools.length * 6_500_000, confidence: "low", sourceElementIds: jetPools.map((r) => r.id) })
    }
    const heaterPools = poolRooms.filter((r) => r.poolHeater)
    if (heaterPools.length > 0) {
      specs.push({ category: "kolam", item: "Pemanas kolam (heater)", volume: heaterPools.length, unit: "unit",
        total: heaterPools.length * 8_500_000, confidence: "low", sourceElementIds: heaterPools.map((r) => r.id) })
    }
    const chlorPools = poolRooms.filter((r) => r.poolSaltChlorinator)
    if (chlorPools.length > 0) {
      specs.push({ category: "kolam", item: "Salt chlorinator", volume: chlorPools.length, unit: "unit",
        total: chlorPools.length * 7_500_000, confidence: "low", sourceElementIds: chlorPools.map((r) => r.id) })
    }
```

Run: `rtk vitest run src/lib/mock/rab.test.ts` → PASS.

- [x] **Step 3: PoolQuickEditor — toggles spa + filter label**

Di preview-controls.tsx, ganti Spec Filter agar adaptif: `<Spec k="Filter" v={c.filterKind === "cartridge" ? "cartridge" : `pasir Ø${c.filterDiaInch}″`} />`.
Setelah section Finish (atau di dekat kontrol tipe), tambahkan toggles hanya untuk spa/plunge:
```tsx
          {(pool.poolKind === "spa" || pool.poolKind === "plunge") && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">Opsi spa</p>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["poolHasJets", "Jet/blower"],
                    ["poolHeater", "Pemanas"],
                    ["poolSaltChlorinator", "Salt chlorinator"],
                  ] as const
                ).map(([key, label]) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={pool[key] ? "default" : "outline"}
                    aria-label={label}
                    onClick={() => updateRoom(pool.id, { [key]: pool[key] ? null : true })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}
```

Run: `rtk vitest run src/components/preview-3d 2>&1 | tail -3` → PASS. `rtk tsc --noEmit` → PASS.

- [x] **Step 4: Commit**

```bash
rtk git add src/lib/mock/rab.ts src/lib/mock/rab.test.ts src/components/preview-3d/preview-controls.tsx
rtk git commit -m "$(cat <<'EOF'
feat(pool): RAB spa + kontrol UI — jet/heater/chlorinator item + toggle spa/plunge

RAB menambah jet set/heater/chlorinator per kolam yang mengaktifkan;
PoolQuickEditor menampilkan toggle opsi spa (hanya spa/plunge) dan label
filter cartridge/pasir adaptif.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: TG-6 + KL-8 — deprekasi tipe `Stair`/`Pool` dorman

Tipe `Stair`/`Pool` dan array `stairs`/`pools` selalu `[]` dan membingungkan (tangga/kolam nyata = `Room`). **Deprekasi, BUKAN hapus** — blast radius 46 file test menyetel `stairs: []`/`pools: []`; hapus total berisiko besar dan tak sepadan.

**Files:**
- Modify: `src/types/index.ts` (`@deprecated` + jadikan `stairs?`/`pools?` opsional)
- Modify: `src/lib/three/scene-stats.ts` (buang 2 baris baca dorman)
- Test: `src/lib/three/scene-stats.test.ts`

- [x] **Step 1: Failing test scene-stats**

Di `scene-stats.test.ts`, tambahkan/ubah test `countSemanticObjects` agar memverifikasi tangga/kolam NYATA (Room) yang dihitung, bukan array dorman:
```ts
it("countSemanticObjects menghitung room tangga/kolam via rooms, bukan array dorman", () => {
  const l = layout([
    room({ id: "r1", type: "ruang_tamu" }),
    room({ id: "r2", type: "tangga" }),
    room({ id: "r3", type: "kolam" }),
  ])
  // rooms.length (3) + openings(0) + ... ; array stairs/pools dorman TIDAK menambah
  expect(countSemanticObjects(l)).toBe(3)
})
```
(Sesuaikan helper `layout`/`room` dengan yang ada di file.) Bila test lama meng-assert nilai yang bergantung `layout.stairs.length` (selalu 0), nilainya tak berubah — aman.

Run: `rtk vitest run src/lib/three/scene-stats.test.ts` → mungkin sudah PASS (karena stairs/pools = 0). Bila belum ada test khusus, test baru ini menjadi guard.

- [x] **Step 2: Implementasi**

`scene-stats.ts` — hapus dua baris:
```ts
    layout.stairs.length +
    layout.pools.length +
```
(Room tangga/kolam sudah terhitung di `layout.rooms.length` — dua baris ini hanya menambah 0.)

`types/index.ts` — tandai deprecated + opsional:
```ts
/** @deprecated Tangga nyata = `Room` dengan `type:"tangga"` (+stairShape/stairDirection).
 *  Tipe ini legacy, `layout.stairs` selalu `[]`. Jangan dipakai untuk fitur baru. */
export type Stair = { /* … tetap … */ };

/** @deprecated Kolam nyata = `Room` dengan `type:"kolam"` (+poolKind/poolDepthM/…).
 *  Tipe ini legacy, `layout.pools` selalu `[]`. Jangan dipakai untuk fitur baru. */
export type Pool = { /* … tetap … */ };
```
Di `DesignLayout`, jadikan opsional (tetap diterima untuk back-compat):
```ts
  /** @deprecated legacy, selalu []. Tangga = Room type:"tangga". */
  stairs?: Stair[];
  /** @deprecated legacy, selalu []. Kolam = Room type:"kolam". */
  pools?: Pool[];
```
Schema `layout.ts` tetap `stairs: z.array(z.unknown()).default([])` (default menangani absent — tak perlu diubah).

Run: `rtk tsc --noEmit` → PASS. `rtk vitest run src/lib/three/scene-stats.test.ts` → PASS.

- [x] **Step 3: Commit**

```bash
rtk git add src/types/index.ts src/lib/three/scene-stats.ts src/lib/three/scene-stats.test.ts
rtk git commit -m "$(cat <<'EOF'
refactor(types): deprekasi tipe Stair/Pool dorman (TG-6/KL-8)

Tipe Stair/Pool + array stairs/pools ditandai @deprecated & dijadikan
opsional — selalu [] (tangga/kolam nyata = Room). scene-stats berhenti
membaca array dorman (Room sudah dihitung di rooms.length). Tidak dihapus
total: blast radius 46 file test; schema tetap default [] utk back-compat.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Gerbang penuh + status dokumen + push

- [x] **Step 1: Full gates**

```bash
rtk tsc --noEmit
rtk lint
rtk vitest run
rtk playwright test e2e/drawings.spec.ts e2e/critical-flows.spec.ts e2e/certification-scenes.spec.ts --project=chromium
rtk next build
```
Expected: semua hijau. Bila lint menandai unused var sisa refactor, bereskan.

- [x] **Step 2: Update status dokumen investigasi**

Di `2026-07-15-tangga-kolam-investigasi-lapangan.md` baris `**Status:**`: ubah "Gelombang 3 … belum" menjadi "Gelombang 1–3 selesai <tanggal> (G3: KL-4 overflow+balancing tank, KL-6 keselamatan+beban, KL-7 spa lengkap, TG-6/KL-8 deprekasi tipe dorman)".

- [x] **Step 3: Commit + push**

```bash
rtk git add docs/superpowers/plans/
rtk git commit -m "$(cat <<'EOF'
docs(plans): Gelombang 3 tangga & kolam selesai — semua task tercentang

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
rtk git push origin main
```

---

## Self-review notes (sudah dijalankan penulis plan)

- **Cakupan**: KL-4 (Task 1–3), KL-6 (Task 4), KL-7 (Task 5–6), TG-6+KL-8 (Task 7). Semua item Gelombang 3 dari dokumen investigasi tercakup; yang keluar scope (pool cover, ruang mesin geometri, jarak batas KL-6, analisis struktur riil) tercantum di Global Constraints.
- **Konsistensi tipe**: `PoolCirculationType`/`gutterM`/`balancingTankM3` (Task 1) dipakai Task 2/3; `jetBlowerW`/`heaterW`/`chlorinatorW` (Task 5) dipakai Task 6; `poolSafetyIssues` (Task 4) dipakai review.
- **Angka test dihitung tangan**: overflow gutter 24 = 2×(4+8); balancing 3.36 = 48×0.07; beban dak 48 ton = 32×1.5; jet 1500/heater 3000/chlorinator 150 W.
- **Titik yang SENGAJA menyuruh engineer baca file dulu** (pagar anti-tebak, bukan placeholder): kategori valid `RiskWarning.category` (Task 4 Step 3), fixture `poolLayout()`/`layout`/`room` helper di file test masing-masing, jumlah warning `review.test.ts`. Nilai bisnis (harga, watt, rumus) dipatok plan.
- **Perubahan perilaku disengaja** ditandai tegas: Task 5 (filter cartridge spa/plunge). Task 7 deprekasi non-breaking (opsional + default schema).
