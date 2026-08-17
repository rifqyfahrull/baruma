# Tangga & Kolam — Gelombang 2 (Realisme Bentuk) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tangga berbentuk L/U dengan bordes, kolam dengan tangga masuk + kedalaman bervariasi (dangkal→dalam), RAB struktur kolam per m³ (bukan m² kasar), dan railing + lebar untuk tangga eksterior.

**Architecture:** Semua geometri baru berupa derivasi pure di modul yang sudah ada (`src/lib/stairs/geometry.ts`, `src/lib/three/pool.ts`) — UI/3D/denah/potongan/RAB hanya konsumen. Bentuk L/U diturunkan otomatis dari footprint room lewat transformasi frame lokal (satu jalur matematika untuk 4 arah × 2 belokan, bukan 8 cabang). Jalur "lurus" existing TIDAK disentuh — L/U adalah cabang baru; layout lama merender byte-identical.

**Tech Stack:** TypeScript, zod, Vitest. Prasyarat: Gelombang 1 selesai (`2026-07-15-tangga-kolam-gelombang1-plan.md`, commit 3f9d24a..410da9c).

**Sumber:** `docs/superpowers/plans/2026-07-15-tangga-kolam-investigasi-lapangan.md` (WP: TG-2, TG-5 + basis RAB eksterior dari TG-4, KL-2, KL-5).

## Global Constraints

- Semua command lewat Git Bash prefix `rtk`. TDD ketat (RED → GREEN → commit per task).
- Tangga interior = `Room type:"tangga"`; kolam = `Room type:"kolam"`. JANGAN memakai tipe dorman `Stair`/`Pool`.
- **Back-compat mutlak**: `stairShape` absent → perilaku lurus existing (kode lama tidak diubah, hanya di-branch); `poolShallowM`/`poolDeepM` absent → kedalaman uniform existing; `poolEntrySide` absent → tanpa tangga masuk. Test existing tidak boleh berubah ekspektasinya, KECUALI yang disebut eksplisit di Task 9 & 10 (RAB kolam & eksterior — perubahan yang memang disengaja).
- Room schema zod `.passthrough()` — field baru tetap ditambah eksplisit (pola `stairRiserM` Gelombang 1).
- Konstanta kenyamanan tangga hanya hidup di `src/lib/stairs/geometry.ts`; konstanta konstruksi kolam baru hanya di modul yang ditunjuk task-nya.
- Semua item RAB baru: confidence `"low"`, `sourceElementIds`, notes. Struktur kolam & tangga tetap ber-notes "Perlu review struktur."
- **Di luar scope (Gelombang 3 — jangan dikerjakan)**: overflow/balancing tank, pagar pengaman & validasi beban dak, jet spa/heater, railing untuk tangga L/U interior (ruang tangga dikelilingi dinding; dicatat sebagai asumsi), bentuk kolam non-persegi.
- Commit message bahasa Indonesia via heredoc bash (JANGAN PowerShell multiline — commit Gelombang 1 sempat kena artefak `` `n ``), diakhiri `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Hotspot (`build-model.ts`, `layout-sheet.ts`, `section.ts`, `rab.ts`, `preview-controls.tsx`, `editor-inspector.tsx`): patch integrasi kecil saja; logika di modul pure.

---

### Task 1: Domain L/U — `interiorStairLayout` (frame lokal, bordes, degradasi)

Fondasi seluruh TG-2. Field baru + derivasi segmen. Belum ada perubahan renderer.

**Files:**
- Modify: `src/types/index.ts` (di bawah `stairRiserM`)
- Modify: `src/lib/schemas/layout.ts` (room schema, di bawah `stairRiserM`)
- Modify: `src/lib/stairs/geometry.ts`
- Test: `src/lib/stairs/geometry.test.ts`

**Interfaces (dipakai Task 2–5):**

```ts
export type StairShape = "lurus" | "L" | "U"
export type StairTurn = "kiri" | "kanan"

export type StairSegment = {
  kind: "run" | "landing"
  /** Rect plan-space (meter, koordinat tapak seperti Room). */
  x: number; y: number; width: number; depth: number
  /** Arah naik segmen run; untuk landing = arah keluar (run berikutnya). */
  dir: StairDir
  /** Elevasi dasar & puncak segmen relatif lantai (m). Landing: sama. */
  elevStartM: number
  elevEndM: number
  /** Run saja: */
  steps?: number
  treadM?: number
  runLenM?: number
  /** Nomor anak pertama segmen (1-based) — penomoran menerus antar run. */
  firstStepNo?: number
}

export type InteriorStairLayout = {
  shape: StairShape          // hasil EFEKTIF (bisa terdegradasi ke "lurus")
  degraded: boolean          // true bila L/U diminta tapi ruang terlalu kecil
  segments: StairSegment[]
  totalSteps: number
  riserM: number
  laneM: number              // lebar jalur run L/U
}

export function interiorStairLayout(
  room: Pick<Room, "x" | "y" | "width" | "depth" | "stairDirection" | "stairRiserM" | "stairShape" | "stairTurn">,
  totalRiseM: number,
): InteriorStairLayout
```

Aturan geometri (dikunci — jangan improvisasi):
- `lane = clamp(round2(min(LA, LB) / 2), 0.6, 1.6)` — LA = panjang room searah `dir`, LB = tegak lurus. Untuk U, lane dihitung dari `LB/2` (dua jalur bertumpuk): `laneU = clamp(round2(LB / 2), 0.6, 1.6)`.
- **L**: run1 = strip selebar `lane` di sisi BERLAWANAN arah belok, panjang `LA − lane`; bordes = kotak `lane × lane` di ujung run1; run2 = strip di ujung-A, arah = belok, panjang `LB − lane`.
- **U**: run1 = strip `lane` sisi berlawanan belok, panjang `LA − lane`; bordes = `lane × (2·lane)` di ujung-A; run2 = strip sejajar BERBALIK ARAH, panjang `LA − lane`.
- Distribusi anak: `steps1 = clamp(Math.round(totalSteps × len1/(len1+len2)), 1, totalSteps − 1)`; `steps2 = totalSteps − steps1`; bordes datar di elevasi `steps1 × riserM`.
- **Degradasi**: bila `LA − lane < 0.6` (atau untuk U: `2·laneU > LB` tidak mungkin karena laneU=LB/2, tapi cek `LA − laneU < 0.6`) → kembalikan layout LURUS (satu segmen dari `interiorStairSpec`) dengan `degraded: true`. Tidak boleh melempar error.
- `shape` absent/`"lurus"` → satu segmen run dari `interiorStairSpec` (delegasi, nilai identik).

- [x] **Step 1: Field domain + schema**

`src/types/index.ts`, tepat di bawah `stairRiserM`:

```ts
  /** Bentuk tangga: lurus (default), L (belok 90° dgn bordes), U (balik arah).
   *  L/U diturunkan otomatis dari footprint room; terdegradasi ke lurus bila
   *  ruang terlalu kecil (lihat interiorStairLayout). */
  stairShape?: "lurus" | "L" | "U" | null;
  /** Arah belok run kedua relatif arah jalan (default "kanan"). */
  stairTurn?: "kiri" | "kanan" | null;
```

`src/lib/schemas/layout.ts`, di bawah `stairRiserM` dalam room schema:

```ts
          stairShape: z.enum(["lurus", "L", "U"]).nullable().optional(),
          stairTurn: z.enum(["kiri", "kanan"]).nullable().optional(),
```

Run: `rtk tsc --noEmit` → PASS. `rtk vitest run src/lib/schemas/layout.test.ts` → PASS.

- [x] **Step 2: Failing test — frame, L, U, degradasi (hand-computed)**

Tambahkan ke `src/lib/stairs/geometry.test.ts`:

```ts
import { interiorStairLayout } from "./geometry"

describe("interiorStairLayout — bentuk L/U dengan bordes", () => {
  const base = { x: 1, y: 1, width: 3, depth: 2.5 }

  it("lurus/absent → satu segmen run identik dengan interiorStairSpec", () => {
    const layout = interiorStairLayout({ ...base }, 3.15)
    const spec = interiorStairSpec({ ...base }, 3.15)
    expect(layout.shape).toBe("lurus")
    expect(layout.degraded).toBe(false)
    expect(layout.segments).toHaveLength(1)
    expect(layout.segments[0]).toMatchObject({
      kind: "run", x: 1, y: 1, width: 3, depth: 2.5,
      dir: spec.dir, steps: spec.steps, elevStartM: 0,
    })
    expect(layout.segments[0].elevEndM).toBeCloseTo(3.15, 5)
    expect(layout.totalSteps).toBe(spec.steps)
  })

  it("L, dir e, belok kanan: run1 strip utara → bordes tenggara → run2 ke selatan", () => {
    // Room 3×2.5 @ (1,1). dir=e: LA=3 (x), LB=2.5 (y). lane=1.25 (clamp(2.5/2)).
    // Kanan dari arah e = s (+y). run1 di strip BERLAWANAN belok: y∈[1, 2.25].
    const layout = interiorStairLayout(
      { ...base, stairDirection: "e", stairShape: "L", stairTurn: "kanan" }, 3.15)
    expect(layout.shape).toBe("L")
    expect(layout.laneM).toBeCloseTo(1.25, 5)
    const [run1, landing, run2] = layout.segments
    // run1: x∈[1, 2.75] (LA−lane=1.75), y∈[1, 2.25], naik ke timur
    expect(run1).toMatchObject({ kind: "run", dir: "e" })
    expect(run1.x).toBeCloseTo(1, 5);     expect(run1.width).toBeCloseTo(1.75, 5)
    expect(run1.y).toBeCloseTo(1, 5);     expect(run1.depth).toBeCloseTo(1.25, 5)
    // bordes: x∈[2.75, 4], y∈[1, 2.25]
    expect(landing).toMatchObject({ kind: "landing", dir: "s" })
    expect(landing.x).toBeCloseTo(2.75, 5); expect(landing.width).toBeCloseTo(1.25, 5)
    expect(landing.y).toBeCloseTo(1, 5);    expect(landing.depth).toBeCloseTo(1.25, 5)
    // run2: x∈[2.75, 4], y∈[2.25, 3.5], naik ke selatan (belok kanan dari e)
    expect(run2).toMatchObject({ kind: "run", dir: "s" })
    expect(run2.y).toBeCloseTo(2.25, 5);  expect(run2.depth).toBeCloseTo(1.25, 5)
    // distribusi anak: total 18 (3.15/0.175=18); steps1=round(18×1.75/3)=11, steps2=7
    expect(layout.totalSteps).toBe(18)
    expect(run1.steps).toBe(11)
    expect(run2.steps).toBe(7)
    expect(landing.elevStartM).toBeCloseTo(11 * (3.15 / 18), 5)
    expect(run2.firstStepNo).toBe(12)
    expect(run2.elevEndM).toBeCloseTo(3.15, 5)
  })

  it("L belok kiri = cermin: run1 strip selatan, run2 ke utara", () => {
    const layout = interiorStairLayout(
      { ...base, stairDirection: "e", stairShape: "L", stairTurn: "kiri" }, 3.15)
    const [run1, , run2] = layout.segments
    expect(run1.y).toBeCloseTo(2.25, 5)   // strip y∈[2.25, 3.5]
    expect(run2.dir).toBe("n")
    expect(run2.y).toBeCloseTo(1, 5)      // y∈[1, 2.25]
  })

  it("U, dir e, belok kanan: dua run sejajar berlawanan arah + bordes selebar 2 lane", () => {
    const layout = interiorStairLayout(
      { ...base, stairDirection: "e", stairShape: "U", stairTurn: "kanan" }, 3.15)
    const [run1, landing, run2] = layout.segments
    expect(run1.dir).toBe("e")
    expect(run2.dir).toBe("w")            // balik arah
    expect(run1.width).toBeCloseTo(1.75, 5)
    expect(run2.width).toBeCloseTo(1.75, 5)
    expect(landing.width).toBeCloseTo(1.25, 5)   // lane di sumbu A
    expect(landing.depth).toBeCloseTo(2.5, 5)    // 2×lane di sumbu B
    expect(run1.steps! + run2.steps!).toBe(layout.totalSteps)
  })

  it("ruang terlalu kecil untuk L → degradasi ke lurus tanpa crash", () => {
    const layout = interiorStairLayout(
      { x: 0, y: 0, width: 1.0, depth: 1.0, stairShape: "L" }, 3.15)
    expect(layout.shape).toBe("lurus")
    expect(layout.degraded).toBe(true)
    expect(layout.segments).toHaveLength(1)
  })
})
```

- [x] **Step 3: Verifikasi RED**

Run: `rtk vitest run src/lib/stairs/geometry.test.ts`
Expected: FAIL — `interiorStairLayout` belum ada.

- [x] **Step 4: Implementasi**

Tambahkan ke `src/lib/stairs/geometry.ts`:

```ts
export type StairShape = "lurus" | "L" | "U"
export type StairTurn = "kiri" | "kanan"

export type StairSegment = {
  kind: "run" | "landing"
  x: number; y: number; width: number; depth: number
  dir: StairDir
  elevStartM: number
  elevEndM: number
  steps?: number
  treadM?: number
  runLenM?: number
  firstStepNo?: number
}

export type InteriorStairLayout = {
  shape: StairShape
  degraded: boolean
  segments: StairSegment[]
  totalSteps: number
  riserM: number
  laneM: number
}

/** Run minimum agar bentuk L/U masuk akal; di bawah ini degradasi ke lurus. */
const MIN_RUN_M = 0.6

/** Vektor arah plan-space (y bertambah ke selatan — konvensi sideVec denah). */
const DIR_VEC: Record<StairDir, { x: number; y: number }> = {
  n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 }, e: { x: 1, y: 0 },
}
const DIR_OF_VEC = (v: { x: number; y: number }): StairDir =>
  v.x === 1 ? "e" : v.x === -1 ? "w" : v.y === 1 ? "s" : "n"

/**
 * Frame lokal tangga: a = jarak searah jalan (dir), b = jarak ke KANAN arah
 * jalan. Satu jalur matematika untuk 4 arah — rect lokal dipetakan balik ke
 * plan lewat dua sudut. `mirror` (belok kiri) mencerminkan sumbu b.
 */
function stairFrame(
  room: Pick<Room, "x" | "y" | "width" | "depth">,
  dir: StairDir,
  mirror: boolean,
) {
  const u = DIR_VEC[dir]
  const r = { x: -u.y, y: u.x } // kanan dari arah jalan
  const LA = u.x !== 0 ? room.width : room.depth
  const LB = u.x !== 0 ? room.depth : room.width
  const ox = room.x + (u.x < 0 || r.x < 0 ? room.width : 0)
  const oy = room.y + (u.y < 0 || r.y < 0 ? room.depth : 0)
  const toPlanPoint = (a: number, bRaw: number) => {
    const b = mirror ? LB - bRaw : bRaw
    return { x: ox + u.x * a + r.x * b, y: oy + u.y * a + r.y * b }
  }
  /** Rect lokal [a0,a1]×[b0,b1] → rect plan {x,y,width,depth}. */
  const toPlanRect = (a0: number, a1: number, b0: number, b1: number) => {
    const p = toPlanPoint(a0, b0)
    const q = toPlanPoint(a1, b1)
    return {
      x: round2(Math.min(p.x, q.x)),
      y: round2(Math.min(p.y, q.y)),
      width: round2(Math.abs(p.x - q.x)),
      depth: round2(Math.abs(p.y - q.y)),
    }
  }
  /** Arah plan dari arah lokal (+a = dir; +b = kanan; mirror membalik b). */
  const planDir = (local: "a+" | "a-" | "b+" | "b-"): StairDir => {
    if (local === "a+") return dir
    if (local === "a-") return DIR_OF_VEC({ x: -u.x, y: -u.y })
    const sign = (local === "b+") !== mirror ? 1 : -1
    return DIR_OF_VEC({ x: r.x * sign, y: r.y * sign })
  }
  return { LA, LB, toPlanRect, planDir }
}

export function interiorStairLayout(
  room: Pick<Room, "x" | "y" | "width" | "depth" | "stairDirection" | "stairRiserM" | "stairShape" | "stairTurn">,
  totalRiseM: number,
): InteriorStairLayout {
  const spec = interiorStairSpec(room, totalRiseM)
  const shape: StairShape = room.stairShape ?? "lurus"

  const straight = (degraded: boolean): InteriorStairLayout => ({
    shape: "lurus",
    degraded,
    segments: [{
      kind: "run",
      x: room.x, y: room.y, width: room.width, depth: room.depth,
      dir: spec.dir, elevStartM: 0, elevEndM: totalRiseM,
      steps: spec.steps, treadM: spec.treadM, runLenM: spec.runLenM,
      firstStepNo: 1,
    }],
    totalSteps: spec.steps,
    riserM: spec.riserM,
    laneM: spec.widthM,
  })
  if (shape === "lurus") return straight(false)

  const mirror = (room.stairTurn ?? "kanan") === "kiri"
  const frame = stairFrame(room, spec.dir, mirror)
  const { LA, LB } = frame
  const lane =
    shape === "U"
      ? Math.min(Math.max(round2(LB / 2), 0.6), 1.6)
      : Math.min(Math.max(round2(Math.min(LA, LB) / 2), 0.6), 1.6)
  const runLen = LA - lane
  if (runLen < MIN_RUN_M || (shape === "U" && 2 * lane > LB + 1e-6)) {
    return straight(true)
  }

  const len2 = shape === "L" ? LB - lane : runLen
  if (len2 < MIN_RUN_M) return straight(true)

  const totalSteps = spec.steps
  const riserM = totalRiseM / totalSteps
  const steps1 = Math.min(
    Math.max(Math.round((totalSteps * runLen) / (runLen + len2)), 1),
    totalSteps - 1,
  )
  const steps2 = totalSteps - steps1
  const elevLanding = steps1 * riserM

  // Rect lokal: run1 di b∈[0,lane] (sisi berlawanan belok — mirror menangani
  // kiri/kanan), bordes di ujung-A, run2 sesuai bentuk.
  const run1Rect = frame.toPlanRect(0, runLen, 0, lane)
  const landingRect =
    shape === "L"
      ? frame.toPlanRect(runLen, LA, 0, lane)
      : frame.toPlanRect(runLen, LA, 0, 2 * lane)
  const run2Rect =
    shape === "L"
      ? frame.toPlanRect(runLen, LA, lane, LB)
      : frame.toPlanRect(0, runLen, lane, 2 * lane)
  const run2Dir = shape === "L" ? frame.planDir("b+") : frame.planDir("a-")

  return {
    shape,
    degraded: false,
    segments: [
      {
        kind: "run", ...run1Rect, dir: spec.dir,
        elevStartM: 0, elevEndM: round2(elevLanding),
        steps: steps1, treadM: runLen / steps1, runLenM: runLen, firstStepNo: 1,
      },
      {
        kind: "landing", ...landingRect, dir: run2Dir,
        elevStartM: round2(elevLanding), elevEndM: round2(elevLanding),
      },
      {
        kind: "run", ...run2Rect, dir: run2Dir,
        elevStartM: round2(elevLanding), elevEndM: totalRiseM,
        steps: steps2, treadM: len2 / steps2, runLenM: len2,
        firstStepNo: steps1 + 1,
      },
    ],
    totalSteps,
    riserM,
    laneM: lane,
  }
}
```

- [x] **Step 5: Verifikasi GREEN + regresi**

Run: `rtk vitest run src/lib/stairs/geometry.test.ts src/lib/schemas/layout.test.ts` → PASS semua.

- [x] **Step 6: Commit**

```bash
rtk git add src/types/index.ts src/lib/schemas/layout.ts src/lib/stairs/geometry.ts src/lib/stairs/geometry.test.ts
rtk git commit -m "$(cat <<'EOF'
feat(stairs): domain bentuk L/U — interiorStairLayout dengan bordes & degradasi

Field Room.stairShape/stairTurn + derivasi segmen via frame lokal (satu jalur
matematika untuk 4 arah × 2 belokan). Distribusi anak proporsional panjang
run, bordes datar di sambungan, degradasi aman ke lurus bila ruang < 0.6 m
per run. Bentuk lurus tetap delegasi ke interiorStairSpec (byte-identical).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 3D L/U di build-model

**Files:**
- Modify: `src/lib/three/build-model.ts` (blok `if (room.type === "tangga")`, baris ±588)
- Test: `src/lib/three/build-model.test.ts`

**Interfaces:**
- Consumes: `interiorStairLayout` (Task 1).
- Produces: prim `stair-<room.id>-<n>` (anak, menerus antar run) dan `stairland-<room.id>` (bordes, kind `"stair"`). Railing existing HANYA untuk bentuk lurus (L/U dikelilingi dinding room — asumsi Gelombang 2, dicatat di komentar).

- [x] **Step 1: Failing test**

Tambahkan ke `src/lib/three/build-model.test.ts` (ikuti pola fixture layout di file):

```ts
it("tangga bentuk L: prim anak per run + bordes solid, tanpa railing", () => {
  const layout = makeLayout()
  const stair = { ...layout.rooms[0], id: "room-stair", name: "Tangga",
    type: "tangga" as const, x: 1, y: 1, width: 3, depth: 2.5,
    stairDirection: "e" as const, stairShape: "L" as const, stairTurn: "kanan" as const }
  const { prims } = buildModel({ ...layout, rooms: [...layout.rooms, stair] })
  const steps = prims.filter((p) => p.id.startsWith("stair-room-stair-"))
  const landing = prims.find((p) => p.id === "stairland-room-stair")
  expect(steps.length).toBe(18)             // 11 + 7 anak menerus
  expect(landing).toBeDefined()
  expect(landing!.kind).toBe("stair")
  // L/U tidak menggambar railing strail-
  expect(prims.some((p) => p.id.startsWith("strail-room-stair"))).toBe(false)
})

it("tangga tanpa stairShape merender persis seperti sebelumnya (regresi lurus)", () => {
  const layout = makeLayout()
  const stair = { ...layout.rooms[0], id: "room-stair", name: "Tangga",
    type: "tangga" as const, x: 1, y: 1, width: 2.5, depth: 2.5 }
  const { prims } = buildModel({ ...layout, rooms: [...layout.rooms, stair] })
  expect(prims.some((p) => p.id.startsWith("strail-room-stair"))).toBe(true)
  expect(prims.some((p) => p.id === "stairland-room-stair")).toBe(false)
})
```

Run: `rtk vitest run src/lib/three/build-model.test.ts` → test baru FAIL, lama PASS.

- [x] **Step 2: Implementasi**

Di blok tangga build-model.ts, bungkus kode existing menjadi cabang lurus dan tambah cabang L/U. Struktur akhir:

```ts
      if (room.type === "tangga") {
        const stairLayout = interiorStairLayout(room, WALL_H + SLAB_T)
        if (stairLayout.shape === "lurus") {
          // ── KODE EXISTING GELOMBANG 1 — JANGAN DIUBAH SATU BARIS PUN ──
          const spec = interiorStairSpec(room, WALL_H + SLAB_T)
          /* … seluruh isi blok lama (loop anak + railing) tetap di sini … */
        } else {
          // ── L/U: anak per run (nomor menerus) + bordes solid. Railing
          // di-skip: ruang tangga dikelilingi dinding (asumsi Gelombang 2).
          for (const seg of stairLayout.segments) {
            if (seg.kind === "landing") {
              const h = seg.elevStartM
              prims.push({
                id: `stairland-${room.id}`,
                kind: "stair",
                floorId: floor.id,
                roomId: room.id,
                pos: [seg.x + seg.width / 2 - cx, roomTopY + h / 2, seg.y + seg.depth / 2 - cz],
                args: [seg.width, h, seg.depth],
              })
              continue
            }
            const segHorizontal = seg.dir === "w" || seg.dir === "e"
            const tread = seg.treadM!
            for (let s = 0; s < seg.steps!; s++) {
              const hStep = seg.elevStartM + (seg.elevEndM - seg.elevStartM) * ((s + 1) / seg.steps!)
              const along = (s + 0.5) * tread
              const cxs =
                seg.dir === "e" ? seg.x + along
                : seg.dir === "w" ? seg.x + seg.width - along
                : seg.x + seg.width / 2
              const cys =
                seg.dir === "s" ? seg.y + along
                : seg.dir === "n" ? seg.y + seg.depth - along
                : seg.y + seg.depth / 2
              prims.push({
                id: `stair-${room.id}-${seg.firstStepNo! - 1 + s}`,
                kind: "stair",
                floorId: floor.id,
                roomId: room.id,
                pos: [cxs - cx, roomTopY + hStep / 2, cys - cz],
                args: segHorizontal
                  ? [tread, hStep, segHorizontal ? (seg.dir === "e" || seg.dir === "w" ? seg.depth : seg.width) : seg.width]
                  : [seg.width, hStep, tread],
              })
            }
          }
        }
      }
```

PERHATIAN implementasi args lebar: untuk run horizontal (e/w) lebar jalur = `seg.depth`; vertikal (n/s) = `seg.width`. Sederhanakan ekspresi args menjadi:

```ts
              const laneW = segHorizontal ? seg.depth : seg.width
              // …
              args: segHorizontal ? [tread, hStep, laneW] : [laneW, hStep, tread],
```

Import `interiorStairLayout` digabung ke import `@/lib/stairs/geometry` yang sudah ada.

- [x] **Step 3: Verifikasi GREEN**

Run: `rtk vitest run src/lib/three/build-model.test.ts src/lib/three/glb.test.ts src/lib/three/scene-stats.test.ts` → PASS semua (glb/scene-stats ikut membaca prim — pastikan tak ada regresi).

- [x] **Step 4: Commit**

```bash
rtk git add src/lib/three/build-model.ts src/lib/three/build-model.test.ts
rtk git commit -m "$(cat <<'EOF'
feat(stairs): render 3D tangga L/U — anak per run menerus + bordes solid

Cabang baru di build-model; jalur lurus existing tidak disentuh (regresi
dijaga test). Railing L/U sengaja di-skip: ruang tangga dikelilingi dinding.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Denah & potongan L/U

**Files:**
- Modify: `src/lib/drawings/layout-sheet.ts` (blok tangga)
- Modify: `src/lib/drawings/section.ts` (blok tangga Gelombang 1)
- Test: `src/lib/drawings/layout-sheet.test.ts`, `src/lib/drawings/section.test.ts`

**Interfaces:** Consumes `interiorStairLayout`, `stairProfilePoints`.

- [x] **Step 1: Failing test denah**

Tambahkan ke `layout-sheet.test.ts`:

```ts
it("denah tangga L: tread per run, label BORDES, penomoran menerus 1..18", () => {
  const layout = makeLayout()
  const stair = { ...layout.rooms[0], id: "room-stair", name: "Tangga",
    type: "tangga" as const, x: 1, y: 1, width: 3, depth: 2.5,
    stairDirection: "e" as const, stairShape: "L" as const, stairTurn: "kanan" as const }
  const d = buildLayoutSheet({ ...layout, rooms: [...layout.rooms, stair] }, layout.floors[0].id)
  expect(d.labels.some((l) => l.refId === "room-stair" && l.text === "BORDES")).toBe(true)
  const nums = d.labels
    .filter((l) => l.refId === "room-stair" && /^\d+$/.test(l.text))
    .map((l) => Number(l.text))
    .sort((a, b) => a - b)
  expect(nums[0]).toBe(1)
  expect(nums[nums.length - 1]).toBe(18)   // menerus lintas run
})
```

Run: `rtk vitest run src/lib/drawings/layout-sheet.test.ts` → FAIL.

- [x] **Step 2: Implementasi denah**

Di blok `if (room.type === "tangga")` layout-sheet.ts, bungkus kode existing sebagai cabang lurus (`stairLayout.shape === "lurus"`, TANPA mengubah isinya) dan tambah cabang L/U:

```ts
      const stairLayout = interiorStairLayout(room, WALL_H + SLAB_T)
      if (stairLayout.shape === "lurus") {
        /* … seluruh blok existing (tread, penomoran, panah NAIK) … */
      } else {
        for (const seg of stairLayout.segments) {
          const sx0 = round2(seg.x); const sy0 = round2(seg.y)
          const sx1 = round2(seg.x + seg.width); const sy1 = round2(seg.y + seg.depth)
          if (seg.kind === "landing") {
            pushRect(lines, sx0, sy0, sx1, sy1, "outline")
            labels.push({
              x: round2(seg.x + seg.width / 2), y: round2(seg.y + seg.depth / 2),
              text: "BORDES", kind: "room", refId: room.id,
            })
            continue
          }
          const segHorizontal = seg.dir === "w" || seg.dir === "e"
          const tread = seg.treadM!
          for (let k = 1; k < seg.steps!; k++) {
            if (segHorizontal) {
              const x = round2(seg.dir === "e" ? seg.x + k * tread : seg.x + seg.width - k * tread)
              lines.push({ x1: x, y1: sy0, x2: x, y2: sy1, kind: "outline", refId: room.id })
            } else {
              const y = round2(seg.dir === "s" ? seg.y + k * tread : seg.y + seg.depth - k * tread)
              lines.push({ x1: sx0, y1: y, x2: sx1, y2: y, kind: "outline", refId: room.id })
            }
          }
          // Penomoran menerus — pola sama dgn lurus, offset 25% lebar jalur.
          const uSeg = sideVec(seg.dir)
          const perpSeg = { x: -uSeg.y, y: uSeg.x }
          const laneW = segHorizontal ? seg.depth : seg.width
          for (let k = 0; k < seg.steps!; k++) {
            const along = (k + 0.5) * tread
            const bx = seg.dir === "e" ? seg.x + along : seg.dir === "w" ? seg.x + seg.width - along : seg.x + seg.width / 2
            const by = seg.dir === "s" ? seg.y + along : seg.dir === "n" ? seg.y + seg.depth - along : seg.y + seg.depth / 2
            labels.push({
              x: round2(bx + perpSeg.x * laneW * 0.25),
              y: round2(by + perpSeg.y * laneW * 0.25),
              text: String(seg.firstStepNo! + k), kind: "room", refId: room.id,
            })
          }
        }
        // Panah NAIK hanya pada run pertama (bordes memutus garis jalan).
        const first = stairLayout.segments[0]
        const uF = sideVec(first.dir)
        const fLen = first.runLenM!
        const fcx = first.x + first.width / 2
        const fcy = first.y + first.depth / 2
        const half = fLen / 2 - Math.min(ARROW_MARGIN_M, fLen / 4)
        const tx = round2(fcx + uF.x * half); const ty = round2(fcy + uF.y * half)
        lines.push({ x1: round2(fcx - uF.x * half), y1: round2(fcy - uF.y * half), x2: tx, y2: ty, kind: "opening", refId: room.id })
        const perpF = { x: -uF.y, y: uF.x }
        for (const s of [-1, 1]) {
          lines.push({ x1: tx, y1: ty,
            x2: round2(tx - uF.x * ARROW_HEAD_M + s * perpF.x * ARROW_HEAD_HALF_M),
            y2: round2(ty - uF.y * ARROW_HEAD_M + s * perpF.y * ARROW_HEAD_HALF_M),
            kind: "opening", refId: room.id })
        }
        labels.push({ x: round2(tx - uF.x * NAIK_PULLBACK_M), y: round2(ty - uF.y * NAIK_PULLBACK_M),
          text: "NAIK", kind: "room", refId: room.id })
      }
```

- [x] **Step 3: Failing test + implementasi potongan**

Test di `section.test.ts`:

```ts
it("potongan tangga L: run sejajar bidang tergambar + garis bordes datar", () => {
  const layout = makeLayout()
  const stair = { ...layout.rooms[0], id: "room-stair", name: "Tangga",
    type: "tangga" as const, x: 1, y: 1, width: 3, depth: 2.5,
    stairDirection: "s" as const, stairShape: "L" as const, stairTurn: "kanan" as const }
  // dir s → run1 sejajar bidang axis "x"; potong di x=1.3 (dalam strip run1)
  const d = buildSection({ ...layout, rooms: [...layout.rooms, stair] }, { axis: "x", positionM: 1.3 })
  const cutLines = d.lines.filter((l) => l.refId === "room-stair" && l.kind === "cut")
  expect(cutLines.length).toBeGreaterThanOrEqual(6)   // zig-zag run1
})
```

Run → FAIL. Implementasi: di blok tangga section.ts (Gelombang 1), ganti pemakaian `interiorStairSpec` tunggal menjadi per-segmen:

```ts
      if (room.type === "tangga") {
        const stairLayout = interiorStairLayout(room, WALL_H + SLAB_T)
        for (const seg of stairLayout.segments) {
          // Segmen hanya digambar bila bidang potong menembus rect-nya.
          const inCut = axis === "x"
            ? seg.x <= positionM && positionM <= seg.x + seg.width
            : seg.y <= positionM && positionM <= seg.y + seg.depth
          if (!inCut) continue
          const [sh0, sh1] = axis === "x"
            ? [round2(seg.y), round2(seg.y + seg.depth)]
            : [round2(seg.x), round2(seg.x + seg.width)]
          if (seg.kind === "landing") {
            lines.push({ x1: sh0, y1: round2(baseY + off + seg.elevStartM),
              x2: sh1, y2: round2(baseY + off + seg.elevStartM), kind: "cut", refId: room.id })
            continue
          }
          const segHorizontal = seg.dir === "w" || seg.dir === "e"
          const runParallel = axis === "x" ? !segHorizontal : segHorizontal
          if (!runParallel) continue
          const ascending = seg.dir === "s" || seg.dir === "e"
          const segSpec = {
            dir: seg.dir, horizontalRun: segHorizontal,
            runLenM: seg.runLenM!, widthM: 0,
            totalRiseM: seg.elevEndM - seg.elevStartM,
            steps: seg.steps!, riserM: (seg.elevEndM - seg.elevStartM) / seg.steps!,
            treadM: seg.treadM!,
          }
          const pts = stairProfilePoints(segSpec, ascending ? sh0 : sh1, baseY + off + seg.elevStartM, ascending)
          for (let i = 0; i < pts.length - 1; i++) {
            lines.push({ x1: round2(pts[i].h), y1: round2(pts[i].y),
              x2: round2(pts[i + 1].h), y2: round2(pts[i + 1].y), kind: "cut", refId: room.id })
          }
        }
        if (stairLayout.segments.some((s) =>
          (axis === "x" ? s.x <= positionM && positionM <= s.x + s.width : s.y <= positionM && positionM <= s.y + s.depth))) {
          labels.push({
            x: round2((h0 + h1) / 2),
            y: round2(baseY + off + stairLayout.riserM * stairLayout.totalSteps / 2),
            text: `TANGGA ${stairLayout.totalSteps} anak · R ${Math.round(stairLayout.riserM * 100)} cm`,
            kind: "room", refId: room.id,
          })
        }
      }
```

Catatan: cabang ini MENGGANTIKAN blok Gelombang 1 (bentuk lurus menghasilkan satu segmen dengan nilai identik — test lurus Gelombang 1 di section.test harus tetap lulus TANPA diubah; itulah gerbang regresinya).

- [x] **Step 4: Verifikasi**

Run: `rtk vitest run src/lib/drawings/layout-sheet.test.ts src/lib/drawings/section.test.ts` → PASS semua (baru + Gelombang 1).

- [x] **Step 5: Commit**

```bash
rtk git add src/lib/drawings/layout-sheet.ts src/lib/drawings/layout-sheet.test.ts src/lib/drawings/section.ts src/lib/drawings/section.test.ts
rtk git commit -m "$(cat <<'EOF'
feat(stairs): denah & potongan tangga L/U — tread per run, BORDES, penomoran menerus

Denah menggambar tread + nomor anak menerus lintas run + label BORDES +
panah NAIK di run pertama. Potongan menggambar zig-zag per segmen yang
ditembus bidang potong + garis datar bordes; bentuk lurus tetap lewat jalur
segmen tunggal yang identik (regresi test Gelombang 1 dijaga).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: UI inspector bentuk tangga + AI parity

**Files:**
- Modify: `src/components/editor/editor-inspector.tsx` (blok tangga Gelombang 1)
- Modify: `src/lib/assistant/actions.ts` (2 tempat pola `stairRiserM`), `src/lib/assistant/apply.ts`
- Test: `src/components/editor/editor-inspector.test.tsx`, `rtk vitest run src/lib/assistant`

- [x] **Step 1: Failing test inspector**

```tsx
it("ruang tangga: pilihan bentuk Lurus/L/U dan arah belok tampil dan memanggil updateRoom", () => {
  const layout = makeLayout()
  const stair = { ...layout.rooms[0], id: "room-stair", name: "Tangga",
    type: "tangga" as const, width: 3, depth: 2.5 }
  useEditorStore.setState({ layout: { ...layout, rooms: [...layout.rooms, stair] }, selectedObjectId: "room-stair" })
  render(<EditorInspector />)
  fireEvent.click(screen.getByRole("button", { name: "Bentuk L" }))
  expect(useEditorStore.getState().layout!.rooms.find((r) => r.id === "room-stair")!.stairShape).toBe("L")
  fireEvent.click(screen.getByRole("button", { name: "Belok kiri" }))
  expect(useEditorStore.getState().layout!.rooms.find((r) => r.id === "room-stair")!.stairTurn).toBe("kiri")
})
```

Run: `rtk vitest run src/components/editor/editor-inspector.test.tsx` → FAIL.

- [x] **Step 2: Implementasi inspector**

Di blok tangga (setelah input riser Gelombang 1), tambahkan:

```tsx
              <div className="space-y-1.5">
                <Label>Bentuk tangga</Label>
                <div className="flex gap-1">
                  {([["lurus", "Bentuk lurus"], ["L", "Bentuk L"], ["U", "Bentuk U"]] as const).map(([v, label]) => (
                    <Button
                      key={v}
                      size="sm"
                      variant={(room.stairShape ?? "lurus") === v ? "default" : "outline"}
                      aria-label={label}
                      onClick={() => updateRoom(room.id, { stairShape: v === "lurus" ? null : v })}
                    >
                      {v === "lurus" ? "Lurus" : v}
                    </Button>
                  ))}
                </div>
                {(room.stairShape === "L" || room.stairShape === "U") && (
                  <div className="flex gap-1">
                    {([["kanan", "Belok kanan"], ["kiri", "Belok kiri"]] as const).map(([v, label]) => (
                      <Button
                        key={v}
                        size="sm"
                        variant={(room.stairTurn ?? "kanan") === v ? "default" : "outline"}
                        aria-label={label}
                        onClick={() => updateRoom(room.id, { stairTurn: v })}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                )}
                {interiorStairLayout(room, WALL_H + SLAB_T).degraded && (
                  <p className="text-[11px] text-warning">
                    Ruang terlalu kecil untuk bentuk ini — sementara digambar lurus.
                  </p>
                )}
              </div>
```

Import `interiorStairLayout` digabung ke import stairs yang sudah ada. Ringkasan anak/tanjakan existing tetap memakai `interiorStairSpec` (nilai total sama).

- [x] **Step 3: AI parity**

Di `src/lib/assistant/actions.ts`, di KEDUA tempat `stairRiserM` (pola Gelombang 1), tambahkan di bawahnya:

```ts
  stairShape: z.enum(["lurus", "L", "U"]).nullable().optional(),
  stairTurn: z.enum(["kiri", "kanan"]).nullable().optional(),
```

Di `src/lib/assistant/apply.ts` (baris pola `stairRiserM: r.stairRiserM`), tambahkan:

```ts
      stairShape: r.stairShape,
      stairTurn: r.stairTurn,
```

- [x] **Step 4: Verifikasi + commit**

Run: `rtk vitest run src/components/editor/editor-inspector.test.tsx src/lib/assistant` → PASS (perbaiki capability-parity bila menuntut daftar field — ikuti pesan test).

```bash
rtk git add src/components/editor/ src/lib/assistant/
rtk git commit -m "$(cat <<'EOF'
feat(stairs): pilihan bentuk Lurus/L/U + arah belok di inspector, paritas AI

Tombol bentuk & belok memanggil updateRoom (undo-aware); peringatan degradasi
tampil bila ruang terlalu kecil. stairShape/stairTurn masuk schema patch AI.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: RAB tangga L/U (kuantitas layout-aware)

**Files:**
- Modify: `src/lib/stairs/geometry.ts` (+ `interiorStairQuantitiesFromLayout`)
- Modify: `src/lib/mock/rab.ts` (blok tangga Gelombang 1: ganti pemanggilan)
- Test: `src/lib/stairs/geometry.test.ts`, `src/lib/mock/rab.test.ts`

- [x] **Step 1: Failing test**

```ts
import { interiorStairQuantitiesFromLayout } from "./geometry"

describe("interiorStairQuantitiesFromLayout", () => {
  it("lurus = identik dengan interiorStairQuantities", () => {
    const room = { x: 1, y: 1, width: 2.7, depth: 1.0, stairDirection: "e" as const }
    const layout = interiorStairLayout(room, 0.54)
    const legacy = interiorStairQuantities(interiorStairSpec(room, 0.54))
    const q = interiorStairQuantitiesFromLayout(layout)
    expect(q.concreteM3).toBeCloseTo(legacy.concreteM3, 5)
    expect(q.finishM2).toBeCloseTo(legacy.finishM2, 5)
    expect(q.railingM).toBeCloseTo(legacy.railingM, 5)
  })

  it("bentuk L menambah pelat bordes dan menjumlah dua run", () => {
    const room = { x: 1, y: 1, width: 3, depth: 2.5, stairDirection: "e" as const,
      stairShape: "L" as const, stairTurn: "kanan" as const }
    const l = interiorStairLayout(room, 3.15)
    const q = interiorStairQuantitiesFromLayout(l)
    const [run1, landing, run2] = l.segments
    const lane = l.laneM
    const slope1 = Math.sqrt(run1.runLenM! ** 2 + (run1.elevEndM - run1.elevStartM) ** 2)
    const slope2 = Math.sqrt(run2.runLenM! ** 2 + (run2.elevEndM - run2.elevStartM) ** 2)
    const expectSlab = (slope1 + slope2) * lane * 0.12 + landing.width * landing.depth * 0.12
    const expectSteps =
      run1.steps! * 0.5 * ((run1.elevEndM - run1.elevStartM) / run1.steps!) * run1.treadM! * lane +
      run2.steps! * 0.5 * ((run2.elevEndM - run2.elevStartM) / run2.steps!) * run2.treadM! * lane
    expect(q.concreteM3).toBeCloseTo(expectSlab + expectSteps, 4)
    // railing L/U = 0 (tidak dirender — konsisten 3D)
    expect(q.railingM).toBe(0)
  })
})
```

Run: `rtk vitest run src/lib/stairs/geometry.test.ts` → FAIL.

- [x] **Step 2: Implementasi**

```ts
export function interiorStairQuantitiesFromLayout(
  layout: InteriorStairLayout,
): InteriorStairQuantities {
  if (layout.shape === "lurus") {
    const seg = layout.segments[0]
    const spec: InteriorStairSpec = {
      dir: seg.dir,
      horizontalRun: seg.dir === "w" || seg.dir === "e",
      runLenM: seg.runLenM!,
      widthM: layout.laneM,
      totalRiseM: seg.elevEndM,
      steps: seg.steps!,
      riserM: seg.elevEndM / seg.steps!,
      treadM: seg.treadM!,
    }
    return interiorStairQuantities(spec)
  }
  let concreteM3 = 0
  let finishM2 = 0
  for (const seg of layout.segments) {
    if (seg.kind === "landing") {
      concreteM3 += seg.width * seg.depth * STAIR_SLAB_T_M
      finishM2 += seg.width * seg.depth
      continue
    }
    const rise = seg.elevEndM - seg.elevStartM
    const slope = Math.sqrt(seg.runLenM! ** 2 + rise ** 2)
    const riser = rise / seg.steps!
    concreteM3 += slope * layout.laneM * STAIR_SLAB_T_M
    concreteM3 += seg.steps! * 0.5 * riser * seg.treadM! * layout.laneM
    finishM2 += seg.steps! * (seg.treadM! + riser) * layout.laneM
  }
  // Railing L/U tidak dirender (dinding keliling) — konsisten dgn 3D & RAB.
  return { concreteM3, finishM2, railingM: 0 }
}
```

- [x] **Step 3: rab.ts — ganti derivasi**

Di blok tangga rab.ts (Gelombang 1), ganti dua baris derivasi:

```ts
    const stairLayout = interiorStairLayout(room, WALL_H + SLAB_T)
    const spec = interiorStairSpec(room, WALL_H + SLAB_T)
    const q = interiorStairQuantitiesFromLayout(stairLayout)
```

(`spec` tetap dipakai untuk teks notes `${spec.steps} anak…`.) Tambahkan pada notes beton bila L/U: ganti string notes menjadi:

```ts
        notes: `${spec.steps} anak${stairLayout.shape !== "lurus" ? ` bentuk ${stairLayout.shape} + bordes` : ""}, riser ${Math.round(spec.riserM * 100)} cm, pelat miring 12 cm. Perlu review struktur.`,
```

Item railing: hanya push bila `q.railingM > 0` (bungkus objek railing existing dengan kondisi).

- [x] **Step 4: Failing → GREEN test RAB**

Tambahkan ke `rab.test.ts` (describe stair Gelombang 1):

```ts
  it("tangga bentuk L: tanpa item railing, notes menyebut bordes", () => {
    const layoutL = stairLayout()
    layoutL.rooms = layoutL.rooms.map((r) =>
      r.id === "room-stair"
        ? { ...r, width: 3, depth: 2.5, stairShape: "L" as const, stairTurn: "kanan" as const }
        : r)
    const rab = generateRAB(sampleProject, sampleBrief, layoutL)
    expect(rab.items.some((i) => i.item.includes("Railing tangga"))).toBe(false)
    expect(rab.items.find((i) => i.item.includes("Beton tangga"))!.notes).toContain("bordes")
  })
```

Run: `rtk vitest run src/lib/mock/rab.test.ts src/lib/stairs/geometry.test.ts` → PASS semua.

- [x] **Step 5: Commit**

```bash
rtk git add src/lib/stairs/ src/lib/mock/rab.ts src/lib/mock/rab.test.ts
rtk git commit -m "$(cat <<'EOF'
feat(stairs): RAB tangga L/U — pelat bordes ikut beton, railing 0 saat L/U

interiorStairQuantitiesFromLayout menjumlah pelat miring per run + prisma
anak + pelat bordes; bentuk lurus identik dengan kuantitas Gelombang 1.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Kolam — kedalaman bervariasi + sisi masuk (domain & sirkulasi)

**Files:**
- Modify: `src/types/index.ts` (di bawah `poolFinish`)
- Modify: `src/lib/schemas/layout.ts` (room schema)
- Modify: `src/lib/three/pool.ts` (+ `effectivePoolDepthRange`)
- Modify: `src/lib/three/pool-circulation.ts` (pakai kedalaman rata-rata)
- Modify: `src/lib/assistant/actions.ts` + `apply.ts` (paritas AI)
- Test: `src/lib/three/pool.test.ts` (atau file test pool existing — cari `effectivePoolDepth` di test; bila belum ada file, buat `src/lib/three/pool.test.ts`), `src/lib/three/pool-circulation.test.ts`

**Interfaces:**

```ts
// src/lib/three/pool.ts
export type PoolDepthRange = { shallowM: number; deepM: number; avgM: number }
export function effectivePoolDepthRange(
  room: Pick<Room, "poolKind" | "poolDepthM" | "poolShallowM" | "poolDeepM">,
): PoolDepthRange
```

Aturan: kedua field ada → masing-masing di-clamp ke min/max tipe, lalu `shallow = min(a,b)`, `deep = max(a,b)`, `avg = round2((shallow+deep)/2)`. Salah satu/keduanya absent → uniform: `shallow = deep = avg = effectivePoolDepth(room)`.

- [x] **Step 1: Field + schema**

`src/types/index.ts` di bawah `poolFinish`:

```ts
  /** Kedalaman ujung dangkal/dalam (m) — keduanya terisi = dasar miring;
   *  absent = kedalaman uniform poolDepthM. Sirkulasi memakai rata-rata. */
  poolShallowM?: number | null;
  poolDeepM?: number | null;
  /** Sisi tangga masuk kolam (undakan). Absent = tanpa tangga masuk. */
  poolEntrySide?: "n" | "s" | "w" | "e" | null;
```

`src/lib/schemas/layout.ts` room schema:

```ts
          poolShallowM: z.number().nullable().optional(),
          poolDeepM: z.number().nullable().optional(),
          poolEntrySide: z.enum(["n", "s", "w", "e"]).nullable().optional(),
```

- [x] **Step 2: Failing test range + sirkulasi**

Buat/tambahkan test (`src/lib/three/pool.test.ts` bila belum ada — impor `describe/expect/it` dari vitest):

```ts
import { effectivePoolDepthRange } from "./pool"
import { poolCirculation } from "./pool-circulation"

describe("effectivePoolDepthRange", () => {
  it("absent → uniform = effectivePoolDepth", () => {
    const r = effectivePoolDepthRange({ poolKind: "renang" })
    expect(r).toEqual({ shallowM: 1.5, deepM: 1.5, avgM: 1.5 })
  })
  it("dangkal/dalam di-clamp ke rentang tipe dan diurutkan", () => {
    const r = effectivePoolDepthRange({ poolKind: "renang", poolShallowM: 3.5, poolDeepM: 1.0 })
    expect(r.shallowM).toBe(1.0)   // diurutkan: min
    expect(r.deepM).toBe(2.5)      // 3.5 di-clamp ke max renang 2.5
    expect(r.avgM).toBeCloseTo(1.75, 5)
  })
})

describe("poolCirculation dengan kedalaman bervariasi", () => {
  it("volume memakai kedalaman rata-rata", () => {
    const c = poolCirculation({ width: 4, depth: 8, areaM2: 32, poolKind: "renang",
      poolShallowM: 1.0, poolDeepM: 1.6 })
    expect(c.avgDepthM).toBeCloseTo(1.3, 5)
    expect(c.volumeM3).toBeCloseTo(41.6, 1)   // 32 × 1.3
    expect(c.flowM3h).toBeCloseTo(6.9, 1)     // 41.6 / 6
  })
})
```

Run: `rtk vitest run src/lib/three/pool.test.ts` → FAIL.

- [x] **Step 3: Implementasi**

`pool.ts` (di bawah `effectivePoolDepth`):

```ts
export type PoolDepthRange = { shallowM: number; deepM: number; avgM: number }

/** Rentang kedalaman efektif: dangkal→dalam bila keduanya diisi (dasar
 *  miring), else uniform. Sirkulasi/RAB memakai avgM. */
export function effectivePoolDepthRange(
  room: Pick<Room, "poolKind" | "poolDepthM" | "poolShallowM" | "poolDeepM">,
): PoolDepthRange {
  const spec = POOL_KINDS[room.poolKind ?? "renang"]
  if (typeof room.poolShallowM === "number" && typeof room.poolDeepM === "number") {
    const a = clamp(room.poolShallowM, spec.minDepthM, spec.maxDepthM)
    const b = clamp(room.poolDeepM, spec.minDepthM, spec.maxDepthM)
    const shallowM = Math.min(a, b)
    const deepM = Math.max(a, b)
    return { shallowM, deepM, avgM: round2((shallowM + deepM) / 2) }
  }
  const d = effectivePoolDepth(room)
  return { shallowM: d, deepM: d, avgM: d }
}
```

(cek: `round2` sudah diimpor pool.ts? bila belum, impor dari `@/lib/geometry`.)

`pool-circulation.ts`: ganti baris `const avgDepthM = effectivePoolDepth(room)` menjadi:

```ts
  const avgDepthM = effectivePoolDepthRange(room).avgM
```

dan perluas `Pick` signature `poolCirculation`/`poolFittings` dengan `"poolShallowM" | "poolDeepM"`; ganti import `effectivePoolDepth` → `effectivePoolDepthRange`.

- [x] **Step 4: AI parity + verifikasi**

`actions.ts` (kedua tempat pola `stairRiserM`): tambah

```ts
  poolShallowM: z.number().nullable().optional(),
  poolDeepM: z.number().nullable().optional(),
  poolEntrySide: z.enum(["n", "s", "w", "e"]).nullable().optional(),
```

`apply.ts` (pola yang sama): teruskan tiga field itu.

Run: `rtk vitest run src/lib/three src/lib/assistant src/lib/schemas/layout.test.ts src/lib/mock/rab.test.ts` → PASS (rab memakai poolCirculation — uniform tak berubah).

- [x] **Step 5: Commit**

```bash
rtk git add src/types/index.ts src/lib/schemas/layout.ts src/lib/three/pool.ts src/lib/three/pool.test.ts src/lib/three/pool-circulation.ts src/lib/assistant/
rtk git commit -m "$(cat <<'EOF'
feat(pool): kedalaman dangkal→dalam + sisi masuk — domain, range efektif, sirkulasi rata-rata

poolShallowM/poolDeepM (clamp per tipe, auto-urut) + poolEntrySide; sirkulasi
memakai kedalaman rata-rata; absent = uniform (perilaku lama byte-identical).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Kolam — tangga masuk 3D + kontrol di PoolQuickEditor

**Files:**
- Modify: `src/lib/three/build-model.ts` (blok `isPool`, setelah coping baris ±571)
- Modify: `src/components/preview-3d/preview-controls.tsx` (PoolQuickEditor, setelah slider Kedalaman)
- Test: `src/lib/three/build-model.test.ts`

- [x] **Step 1: Failing test 3D**

```ts
it("kolam dengan poolEntrySide merender undakan masuk menurun (pool-step-)", () => {
  const layout = makeLayout()
  const pool = { ...layout.rooms[0], id: "room-pool", name: "Kolam",
    type: "kolam" as const, x: 1, y: 1, width: 4, depth: 8, areaM2: 32,
    poolKind: "renang" as const, poolShallowM: 1.2, poolDeepM: 1.8,
    poolEntrySide: "n" as const }
  const { prims } = buildModel({ ...layout, rooms: [...layout.rooms, pool] })
  const steps = prims.filter((p) => p.id.startsWith("pool-step-room-pool-"))
  // shallow 1.2 → k = clamp(round(1.2/0.25),3,5) = 5 → 4 blok solid menurun
  expect(steps.length).toBe(4)
  const heights = steps.map((p) => p.args[1])
  expect(heights[0]).toBeCloseTo(0.96, 2)
  expect(heights[3]).toBeCloseTo(0.24, 2)
})

it("kolam tanpa poolEntrySide tidak punya prim pool-step- (regresi)", () => {
  const layout = makeLayout()
  const pool = { ...layout.rooms[0], id: "room-pool", name: "Kolam",
    type: "kolam" as const, x: 1, y: 1, width: 4, depth: 8, areaM2: 32, poolKind: "renang" as const }
  const { prims } = buildModel({ ...layout, rooms: [...layout.rooms, pool] })
  expect(prims.some((p) => p.id.startsWith("pool-step-"))).toBe(false)
})
```

Run → FAIL.

- [x] **Step 2: Implementasi 3D**

Di blok `isPool` build-model.ts, setelah loop coping, tambahkan (import `effectivePoolDepthRange` dari `@/lib/three/pool` digabung ke import pool yang sudah ada):

```ts
        // Tangga masuk kolam: undakan solid menurun di sisi poolEntrySide.
        // k anak (riser ±25 cm dari kedalaman dangkal); blok terakhir = dasar.
        if (room.poolEntrySide) {
          const range = effectivePoolDepthRange(room)
          const k = Math.min(5, Math.max(3, Math.round(range.shallowM / 0.25)))
          const stepRiser = range.shallowM / k
          const stepTread = 0.35
          const side = room.poolEntrySide
          const horizontalSide = side === "n" || side === "s"
          const stepW = Math.min(1.2, (horizontalSide ? w : d) - 0.6)
          const floorY = waterTop - range.shallowM
          for (let i = 0; i < k - 1; i++) {
            const hStep = range.shallowM - stepRiser * (i + 1)
            const inset = cw + stepTread * (i + 0.5)
            const px = side === "w" ? room.x + inset
              : side === "e" ? room.x + w - inset
              : room.x + w / 2
            const py = side === "n" ? room.y + inset
              : side === "s" ? room.y + d - inset
              : room.y + d / 2
            prims.push({
              id: `pool-step-${room.id}-${i}`,
              kind: "tile",
              floorId: floor.id,
              roomId: room.id,
              tint: fin.coping,
              pos: [px - cx, floorY + hStep / 2, py - cz],
              args: horizontalSide ? [stepW, hStep, stepTread] : [stepTread, hStep, stepW],
            })
          }
        }
```

Catatan penempatan: `waterTop`, `cw` (lebar coping), `fin`, `w`, `d` sudah ada di scope blok isPool (lihat baris 538-571). Bila nama variabel berbeda, ikuti nama di file — JANGAN menghitung ulang.

- [x] **Step 3: Kontrol PoolQuickEditor**

Di `preview-controls.tsx` PoolQuickEditor, SETELAH kontrol slider "Kedalaman", tambahkan:

```tsx
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Kedalaman bervariasi (opsional)</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted-foreground">
                Dangkal (m)
                <Input
                  type="number" step={0.1}
                  value={room.poolShallowM ?? ""}
                  placeholder="uniform"
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    updateRoom(room.id, { poolShallowM: Number.isFinite(v) ? v : null })
                  }}
                />
              </label>
              <label className="text-[11px] text-muted-foreground">
                Dalam (m)
                <Input
                  type="number" step={0.1}
                  value={room.poolDeepM ?? ""}
                  placeholder="uniform"
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    updateRoom(room.id, { poolDeepM: Number.isFinite(v) ? v : null })
                  }}
                />
              </label>
            </div>
            <p className="text-xs font-medium">Tangga masuk</p>
            <div className="flex gap-1">
              {([["n", "Utara"], ["e", "Timur"], ["s", "Selatan"], ["w", "Barat"]] as const).map(([v, label]) => (
                <Button
                  key={v} size="sm"
                  variant={room.poolEntrySide === v ? "default" : "outline"}
                  aria-label={`Tangga masuk sisi ${label}`}
                  onClick={() =>
                    updateRoom(room.id, { poolEntrySide: room.poolEntrySide === v ? null : v })
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
```

(`updateRoom`/`Input`/`Button` sudah tersedia di PoolQuickEditor — cek nama binding `updateRoom` di komponen itu; bila memakai nama lain (mis. dari `useEditorStore`), ikuti pola kontrol Kedalaman yang persis di atasnya.)

- [x] **Step 4: Verifikasi + commit**

Run: `rtk vitest run src/lib/three/build-model.test.ts src/components/preview-3d 2>&1 | tail -3` → PASS.

```bash
rtk git add src/lib/three/build-model.ts src/lib/three/build-model.test.ts src/components/preview-3d/preview-controls.tsx
rtk git commit -m "$(cat <<'EOF'
feat(pool): tangga masuk 3D (undakan menurun) + kontrol dangkal/dalam & sisi masuk

Undakan solid k-1 blok (riser ±25 cm dari kedalaman dangkal) di sisi
poolEntrySide; kontrol PoolQuickEditor: input dangkal/dalam + 4 tombol sisi
(klik ulang = hapus). Tanpa field → tidak ada prim baru (regresi dijaga).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Sheet Detail Kolam — dasar miring

**Files:**
- Modify: `src/lib/drawings/pool-detail.ts`
- Test: `src/lib/drawings/pool-detail.test.ts`

- [x] **Step 1: Failing test**

```ts
it("kolam dangkal→dalam: dasar miring, dua level, potongan searah sumbu masuk", () => {
  const base = makeLayout()
  const l = { ...base, rooms: [...base.rooms, { ...base.rooms[0], id: "room-pool",
    name: "Kolam", type: "kolam" as const, x: 1, y: 1, width: 4, depth: 8, areaM2: 32,
    poolKind: "renang" as const, poolShallowM: 1.2, poolDeepM: 1.8, poolEntrySide: "n" as const }] }
  const d = buildPoolDetail(l)
  expect(d.levels.some((lv) => lv.label === "-1.20")).toBe(true)
  expect(d.levels.some((lv) => lv.label === "-1.80")).toBe(true)
  // garis dasar miring: satu garis cut dengan y1 ≠ y2
  expect(d.lines.some((ln) => ln.refId === "room-pool" && ln.kind === "cut" && ln.y1 !== ln.y2)).toBe(true)
})
```

Run → FAIL. (Test flat existing HARUS tetap lulus tanpa diubah.)

- [x] **Step 2: Implementasi**

Di `drawOne` pool-detail.ts:
1. Ganti `const depth = effectivePoolDepth(pool)` → `const range = effectivePoolDepthRange(pool)` (update import), dan tentukan panjang potongan searah sumbu masuk: `const lenAlong = (pool.poolEntrySide === "w" || pool.poolEntrySide === "e" || !pool.poolEntrySide) ? pool.width : pool.depth` — pakai `lenAlong` menggantikan `innerW`.
2. Dinding kiri = sisi DANGKAL, kanan = DALAM: garis dinding kiri turun ke `-range.shallowM - FLOOR_T`, kanan ke `-range.deepM - FLOOR_T`.
3. Lantai kolam = garis miring `{ x1: inL, y1: -range.shallowM, x2: inR, y2: -range.deepM, kind: "cut", refId }`; lantai kerja & slab bawah mengikuti kedalaman masing-masing ujung (garis miring paralel offset `FLOOR_T` dan `FLOOR_T+LEAN_T`).
4. Levels: `-range.shallowM` dan `-range.deepM` (dua entri; bila uniform keduanya sama → dedup dengan cek `range.deepM !== range.shallowM`). Label pakai `.toFixed(2)`.
5. Dim chain y: `points: [0, round2(-range.shallowM), round2(-range.deepM)]` (uniform → dua titik seperti sekarang).
6. Catatan baris 1: `` `${pool.name} — ${lenAlong.toFixed(1)} m × kedalaman ${range.shallowM.toFixed(2)}–${range.deepM.toFixed(2)} m` `` (uniform → satu angka seperti sekarang: pakai kondisi).
7. `maxDepth` pemanggil memakai `range.deepM`.

Uniform path harus menghasilkan output identik dengan sebelumnya (test flat Gelombang 1 adalah gerbangnya).

- [x] **Step 3: Verifikasi + commit**

Run: `rtk vitest run src/lib/drawings/pool-detail.test.ts` → PASS semua.

```bash
rtk git add src/lib/drawings/pool-detail.ts src/lib/drawings/pool-detail.test.ts
rtk git commit -m "$(cat <<'EOF'
feat(pool): Detail Kolam menggambar dasar miring dangkal→dalam + dua level

Potongan mengikuti sumbu sisi masuk; dinding dangkal/dalam beda kedalaman,
lantai + lantai kerja miring; uniform tetap identik (regresi dijaga).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: KL-5 — RAB struktur kolam per m³ (mengganti rate m² kasar)

**PERUBAHAN PERILAKU DISENGAJA** — item "Struktur & waterproofing kolam" (poolArea × 6.5jt × 0.6) DIGANTI lima item terukur. Test existing yang meng-assert item lama HARUS di-update (satu-satunya task yang boleh mengubah ekspektasi lama).

**Files:**
- Modify: `src/lib/mock/rab.ts` (baris ±509-518)
- Test: `src/lib/mock/rab.test.ts`

Konstanta (hidup di rab.ts, dekat blok kolam):

```ts
  const POOL_EXCAVATION_IDR_M3 = 125_000
  const POOL_CONCRETE_IDR_M3 = 4_500_000
  const POOL_WP_IDR_M2 = 185_000
  const POOL_COPING_IDR_M = 275_000
  const POOL_FINISH_IDR_M2: Record<PoolFinish, number> = {
    keramik_biru: 350_000, mozaik_hijau: 550_000, pebble_gelap: 450_000, batu_alam: 500_000,
  }
  const POOL_WALL_T = 0.2
  const POOL_FLOOR_T = 0.2
  const POOL_FREEBOARD = 0.15
```

Rumus per kolam (pure, dari dimensi room + `effectivePoolDepthRange`):
- `keliling = 2 × (width + depth)`; `area = areaM2 > 0 ? areaM2 : width×depth`; `avg = range.avgM`
- galian = `area × (avg + POOL_FLOOR_T + 0.05) × 1.1` m³
- beton = `keliling × (avg + POOL_FREEBOARD) × POOL_WALL_T + area × POOL_FLOOR_T` m³
- area basah = `area + keliling × avg` m²
- coping = `keliling` m

- [x] **Step 1: Failing test (hand calculation)**

Tambahkan describe baru di `rab.test.ts`:

```ts
describe("RAB struktur kolam per m³ (KL-5)", () => {
  function poolLayout(): DesignLayout {
    const base = makeLayout()
    return { ...base, rooms: [...base.rooms, { ...base.rooms[0], id: "room-pool",
      name: "Kolam", type: "kolam", x: 1, y: 1, width: 4, depth: 8, areaM2: 32,
      poolKind: "renang", poolFinish: "mozaik_hijau" }] }
  }

  it("item lama m² kasar hilang; lima item terukur muncul dengan sourceElementIds", () => {
    const rab = generateRAB(sampleProject, sampleBrief, poolLayout())
    expect(rab.items.some((i) => i.item === "Struktur & waterproofing kolam")).toBe(false)
    // avg renang default 1.5; keliling 24; area 32
    const beton = rab.items.find((i) => i.item.includes("Beton bertulang kolam"))!
    expect(beton.unit).toBe("m³")
    expect(beton.volume).toBeCloseTo(24 * (1.5 + 0.15) * 0.2 + 32 * 0.2, 1) // 7.92 + 6.4 = 14.3
    expect(beton.sourceElementIds).toEqual(["room-pool"])
    expect(beton.notes).toContain("review struktur")
    const galian = rab.items.find((i) => i.item.includes("Galian"))!
    expect(galian.volume).toBeCloseTo(32 * (1.5 + 0.25) * 1.1, 1) // 61.6
    const wp = rab.items.find((i) => i.item.includes("Waterproofing"))!
    expect(wp.volume).toBeCloseTo(32 + 24 * 1.5, 1) // 68
    const finish = rab.items.find((i) => i.item.includes("Finishing kolam"))!
    expect(finish.totalIDR).toBe(Math.round((32 + 24 * 1.5) * 550_000 / 1000) * 1000) // mozaik
    expect(rab.items.some((i) => i.item.includes("Coping"))).toBe(true)
  })

  it("summary tetap reconcile", () => {
    const rab = generateRAB(sampleProject, sampleBrief, poolLayout())
    expect(rab.summary.midIDR).toBe(rab.items.reduce((s, i) => s + i.totalIDR, 0))
  })
})
```

Run → FAIL. Kemudian cari test lama yang meng-assert "Struktur & waterproofing kolam" (`rtk grep "Struktur & waterproofing" src/`) — update ekspektasinya ke item baru (jangan dihapus: ganti assertion agar tetap menjaga kategori kolam).

- [x] **Step 2: Implementasi**

Ganti `specs.push({ … "Struktur & waterproofing kolam" … })` (rab.ts ±510-518) dengan loop per kolam:

```ts
    for (const pool of poolRooms) {
      const range = effectivePoolDepthRange(pool)
      const keliling = 2 * (pool.width + pool.depth)
      const area = pool.areaM2 > 0 ? pool.areaM2 : pool.width * pool.depth
      const galianM3 = area * (range.avgM + POOL_FLOOR_T + 0.05) * 1.1
      const betonM3 = keliling * (range.avgM + POOL_FREEBOARD) * POOL_WALL_T + area * POOL_FLOOR_T
      const basahM2 = area + keliling * range.avgM
      const finish = effectivePoolFinish(pool)
      specs.push(
        { category: "kolam", item: `Galian & urugan kolam — ${pool.name}`,
          volume: galianM3, unit: "m³", total: galianM3 * POOL_EXCAVATION_IDR_M3,
          confidence: "low", sourceElementIds: [pool.id] },
        { category: "kolam", item: `Beton bertulang kolam (dinding+lantai) — ${pool.name}`,
          volume: betonM3, unit: "m³", total: betonM3 * POOL_CONCRETE_IDR_M3,
          confidence: "low", notes: "K-300, dinding & lantai t=20 cm. Perlu review struktur.",
          sourceElementIds: [pool.id] },
        { category: "kolam", item: `Waterproofing area basah — ${pool.name}`,
          volume: basahM2, unit: "m²", total: basahM2 * POOL_WP_IDR_M2,
          confidence: "low", sourceElementIds: [pool.id] },
        { category: "kolam", item: `Finishing kolam (${POOL_FINISHES[finish].label}) — ${pool.name}`,
          volume: basahM2, unit: "m²", total: basahM2 * POOL_FINISH_IDR_M2[finish],
          confidence: "low", sourceElementIds: [pool.id] },
        { category: "kolam", item: `Coping bibir kolam — ${pool.name}`,
          volume: keliling, unit: "m", total: keliling * POOL_COPING_IDR_M,
          confidence: "low", sourceElementIds: [pool.id] },
      )
    }
```

Import yang dibutuhkan: `effectivePoolDepthRange`, `effectivePoolFinish`, `POOL_FINISHES` dari `@/lib/three/pool`, dan tipe `PoolFinish` dari `@/types` (gabungkan ke import existing).

- [x] **Step 3: Verifikasi + commit**

Run: `rtk vitest run src/lib/mock/rab.test.ts` → PASS semua (baru + lama yang diupdate).

```bash
rtk git add src/lib/mock/rab.ts src/lib/mock/rab.test.ts
rtk git commit -m "$(cat <<'EOF'
feat(pool): RAB struktur kolam terukur — galian/beton m3/WP/finishing per finish/coping

Mengganti item lama 'Struktur & waterproofing kolam' (m2 x rate kasar) dengan
lima item dari dimensi & kedalaman nyata (rata-rata dangkal/dalam), rate per
finish, sourceElementIds per kolam. Perubahan ekspektasi test disengaja.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: TG-5 — railing tangga eksterior + lebar di inspector + RAB volume

**Files:**
- Modify: `src/lib/three/exterior-primitives.ts` (`stairPrimitives`, baris ±200-234)
- Modify: `src/components/editor/editor-inspector.tsx` (`StairFields`, baris ±2306-2365)
- Modify: `src/lib/exterior/rates.ts` (+2 rate), `src/lib/exterior/quantities.ts` (stair branch)
- Test: `src/lib/three/exterior-primitives.test.ts`, `src/components/editor/editor-inspector.test.tsx`, `src/lib/exterior/quantities.test.ts`, `src/lib/mock/rab.test.ts`

**PERUBAHAN PERILAKU DISENGAJA (RAB eksterior)**: item "Tangga luar" (m² × ext-stair-v1) diganti dua item volume+finish. Test yang meng-assert item lama di-update.

- [x] **Step 1: Failing test railing 3D**

Tambahkan ke `exterior-primitives.test.ts` (ikuti pola fixture element existing di file):

```ts
it("exterior stair riseM >= 0.6 merender handrail dua sisi + post", () => {
  const el = makeStairElement({ x: 2, y: 2 })   // default rise 3 → railing wajib
  const prims = exteriorElementPrimitives([el], context)
  expect(prims.some((p) => p.id.includes("-rail-a-"))).toBe(true)
  expect(prims.some((p) => p.id.includes("-rail-b-"))).toBe(true)
  expect(prims.some((p) => p.id.includes("-railpost-"))).toBe(true)
})

it("undakan pendek (riseM < 0.6) tanpa railing", () => {
  const el = { ...makeStairElement({ x: 2, y: 2 }), riseM: 0.35, lengthM: 1 }
  const prims = exteriorElementPrimitives([el], context)
  expect(prims.some((p) => p.id.includes("-rail-"))).toBe(false)
})
```

(`makeStairElement` dari `@/lib/exterior/factories`; `context` = fixture context yang dipakai test lain di file itu — ikuti persis.)

Run → FAIL.

- [x] **Step 2: Implementasi railing**

Di `stairPrimitives` exterior-primitives.ts, ubah `return Array.from(...)` menjadi akumulasi lalu tambahkan railing:

```ts
  const prims: Prim[] = Array.from({ length: steps }, (_, index) => {
    /* … isi existing tidak berubah … */
  })
  // Handrail 0,9 m dua sisi bila total naik >= 0.6 m (3-4 anak) — paritas
  // dengan tangga interior; undakan taman pendek tidak butuh railing.
  if (element.riseM >= 0.6) {
    for (let index = 0; index < steps; index++) {
      const height = riser * (index + 1)
      const distance = tread * (index + 0.5)
      const railY = y0 + height + 0.9
      for (const [tag, edge] of [["a", 0.04], ["b", element.widthM - 0.04]] as const) {
        const px = alongX
          ? element.x + vector.x * distance
          : element.x - element.widthM / 2 + edge
        const pz = alongX
          ? element.y - element.widthM / 2 + edge
          : element.y + vector.z * distance
        prims.push({
          id: `ext-${element.id}-rail-${tag}-${index}`,
          kind: "exterior" as const,
          floorId: element.floorId ?? null,
          exteriorElement: metadata(element),
          pos: [px - context.centerX, railY, pz - context.centerZ],
          args: alongX ? [tread + 0.02, 0.05, 0.05] : [0.05, 0.05, tread + 0.02],
        })
        if (index % 3 === 0) {
          prims.push({
            id: `ext-${element.id}-railpost-${tag}-${index}`,
            kind: "exterior" as const,
            floorId: element.floorId ?? null,
            exteriorElement: metadata(element),
            pos: [px - context.centerX, y0 + height + 0.45, pz - context.centerZ],
            args: [0.04, 0.9, 0.04],
          })
        }
      }
    }
  }
  return prims
```

PERHATIAN sumbu: prim eksterior memakai koordinat pusat elemen `element.x/element.y` dengan lebar `element.widthM` tegak lurus arah — cek dulu bagaimana step existing memposisikan lebar (args index ke-3 saat `alongX`). Bila step existing TIDAK meng-offset lebar dari pusat (lebar disebar simetris oleh args), maka offset `edge` di atas benar (dari `-widthM/2`). Verifikasi dengan test scene-stats/certification yang membaca prim eksterior.

- [x] **Step 3: Field Lebar di StairFields**

Di `StairFields` (editor-inspector.tsx), tambahkan state + Field mengikuti pola Panjang/Riser yang persis ada di komponen itu:

```tsx
  const [width, setWidth] = React.useState(String(element.widthM));
```

commit key union menjadi `"lengthM" | "riseM" | "widthM"`, dan di grid tambahkan:

```tsx
      <Field label="Lebar (m)">
        <Input
          type="number"
          step={0.1}
          min={0.5}
          value={width}
          disabled={element.locked}
          onChange={(e) => setWidth(e.target.value)}
          onBlur={() => commit("widthM", width, 0.5)}
        />
      </Field>
```

Test inspector:

```tsx
it("StairFields eksterior: field Lebar mengubah widthM", () => {
  // setup element exterior_stair terseleksi — ikuti pola test exterior fields existing di file
  // lalu:
  const input = screen.getByLabelText(/Lebar \(m\)/i) // atau melalui label Field — ikuti idiom file
  fireEvent.change(input, { target: { value: "1.5" } })
  fireEvent.blur(input)
  expect(useEditorStore.getState().layout!.exteriorElements!.find((e) => e.kind === "exterior_stair")!.widthM).toBe(1.5)
})
```

(Bila `Field` merender label bukan sebagai `<label for>`, gunakan query yang dipakai test exterior lain di file itu — JANGAN mengubah komponen `Field`.)

- [x] **Step 4: RAB eksterior volume + finish**

`src/lib/exterior/rates.ts` — tambah dua rate mengikuti bentuk entri existing (lihat `ext-stair-v1` sebagai contoh bentuk):

```ts
  "ext-stair-beton-v1": { unit: "m3", unitPriceIDR: 4_500_000, confidence: "low", label: "Beton tangga luar", effectiveDate: "2026-07-15" },
  "ext-stair-finish-v1": { unit: "m2", unitPriceIDR: 350_000, confidence: "low", label: "Finishing tangga luar", effectiveDate: "2026-07-15" },
```

(SESUAIKAN nama field dengan tipe rate existing di file — baca dulu; nilai harga & unit di atas yang mengikat.)

`src/lib/exterior/quantities.ts` — ganti isi `stairQuantities` (baris ±221-234): dua kuantitas menggantikan satu:

```ts
  const steps = stairStepCount(element)
  const tread = stairTreadM(element)
  const riser = stairRiserM(element)
  const betonM3 = 0.5 * element.widthM * element.lengthM * element.riseM
  const finishM2 = steps * (tread + riser) * element.widthM
  return [
    { item: "Tangga luar — beton", qty: betonM3, unit: "m3", rateId: "ext-stair-beton-v1", sourceElementIds: [element.id] },
    { item: "Tangga luar — finishing", qty: finishM2, unit: "m2", rateId: "ext-stair-finish-v1", sourceElementIds: [element.id] },
  ]
```

(SESUAIKAN bentuk return dengan tipe `ExteriorQuantity` existing — baca dulu field persisnya; kuantitas & rateId di atas yang mengikat.) Update test `quantities.test.ts` stair case + test rab eksterior yang meng-assert "Tangga luar" lama.

- [x] **Step 5: Verifikasi + commit**

Run: `rtk vitest run src/lib/three/exterior-primitives.test.ts src/lib/exterior src/lib/mock/rab.test.ts src/components/editor/editor-inspector.test.tsx src/lib/exterior/certification-scenes.test.ts` → PASS (certification scene A punya tangga luar — bila budget/komposisi berubah karena prim railing baru, update ekspektasi HANYA angka prim/draw-call, jangan menaikkan budget §14).

```bash
rtk git add src/lib/three/exterior-primitives.ts src/lib/three/exterior-primitives.test.ts src/components/editor/ src/lib/exterior/
rtk git commit -m "$(cat <<'EOF'
feat(exterior): railing tangga luar (auto bila naik >= 0.6 m) + lebar di inspector + RAB volume

Handrail 0,9 m dua sisi + post per 3 anak (paritas interior); field Lebar di
StairFields; RAB tangga luar kini beton 0.5*w*l*rise m3 + finishing
(tread+riser)*lebar*anak m2 menggantikan basis m2 kasar (test diupdate sengaja).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Gerbang penuh + status dokumen + push

- [x] **Step 1: Full gates**

```bash
rtk tsc --noEmit
rtk lint
rtk vitest run
rtk playwright test e2e/exterior-editor.spec.ts e2e/drawings.spec.ts e2e/critical-flows.spec.ts e2e/certification-scenes.spec.ts --project=chromium
rtk next build
```

Expected: semua hijau (certification budget tidak boleh regress — railing eksterior menambah prim; bila draw-call scene A melewati budget, kecilkan post interval BUKAN menaikkan budget).

- [x] **Step 2: Update status dokumen investigasi**

Di `2026-07-15-tangga-kolam-investigasi-lapangan.md`, perbarui baris `**Status:**`: tambahkan `Gelombang 2 selesai <tanggal> (TG-2, TG-5+RAB-eksterior, KL-2, KL-5)`.

- [x] **Step 3: Commit + push**

```bash
rtk git add docs/superpowers/plans/
rtk git commit -m "$(cat <<'EOF'
docs(plans): tandai Gelombang 2 tangga & kolam selesai

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
rtk git push origin main
```

---

## Self-review notes (sudah dijalankan penulis plan)

- **Cakupan**: TG-2 (Task 1–5), KL-2 (Task 6–8), KL-5 (Task 9), TG-5 + basis RAB eksterior (Task 10). Semua item Gelombang 2 dari dokumen investigasi tercakup; yang keluar scope tercantum di Global Constraints.
- **Konsistensi tipe**: `InteriorStairLayout`/`StairSegment` (Task 1) dipakai Task 2/3/5 dengan field sama; `effectivePoolDepthRange` (Task 6) dipakai Task 7/8/9.
- **Angka test dihitung tangan**: lane 1.25 dari 2.5/2; steps 11/7 dari round(18×1.75/3); pool avg 1.3 → vol 41.6 → flow 6.9; beton kolam 14.3 m³; galian 61.6 m³; WP 68 m²; undakan masuk 4 blok 0.96/0.72/0.48/0.24.
- **Titik yang SENGAJA menyuruh engineer membaca file dulu** (bukan placeholder — pagar anti-tebak): bentuk entri `rates.ts` & `ExteriorQuantity` (Task 10 Step 4), nama binding `updateRoom` di PoolQuickEditor (Task 7 Step 3), idiom query test `Field` (Task 10 Step 3), nama variabel scope blok isPool (Task 7 Step 2). Nilai bisnis (harga, rumus, ID) tetap dipatok plan.
- **Dua task berubah-perilaku** ditandai tegas (Task 9, Task 10) — hanya di sana ekspektasi test lama boleh diubah.
