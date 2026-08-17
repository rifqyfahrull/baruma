# Alat "Samakan footprint" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyediakan alat editor 2D yang menyamakan batas luar bangunan lantai aktif ke footprint lantai acuan (edge-alignment bbox), plus koreksi `proj-modern-tropis-1`.

**Architecture:** Fungsi murni `alignFloorRoomsToFootprint` di `src/lib/geometry/floor-align.ts` menghitung ruang lantai aktif yang baru (hanya ruang ekspos di sisi yang diubah; interior dibiarkan; ruang degenerate dihapus). Aksi store `alignFloorToReference` memakai pola `commit()` (undo-able). UI berupa dropdown "Samakan" di `floor-switcher.tsx`.

**Tech Stack:** TypeScript, Vitest, Zustand (`useEditorStore`), shadcn/Radix `DropdownMenu`, Next.js (baca panduan di `node_modules/next/dist/docs/` sebelum menulis kode Next — versi ini punya breaking changes).

## Global Constraints

- Versi ini BUKAN Next.js yang Anda kenal — baca guide di `node_modules/next/dist/docs/` sebelum menulis kode.
- Reuse helper yang ada, jangan duplikasi: `isOutdoorRoom` (`@/lib/geometry/connectivity`), `Rect` (`@/lib/geometry`), `roomArea`/`round2` (`@/lib/geometry`), `WALL_T = 0.12` (`@/lib/three/build-model`).
- Semua mutasi layout lewat pola `commit()` di store (satu entri undo). Jangan memutasi state langsung.
- TDD: tulis test dulu, pastikan gagal, baru implementasi.
- Bahasa UI: Indonesia. Commit tiap task selesai hijau.

---

### Task 1: Algoritma murni `floor-align.ts` (+ unit tests)

**Files:**
- Create: `src/lib/geometry/floor-align.ts`
- Test: `src/lib/geometry/floor-align.test.ts`

**Interfaces:**
- Produces: `type AlignSummary = { grown: string[]; shrunk: string[]; removed: string[] }`
- Produces: `function indoorFootprintBBox(rooms: Room[]): Rect | null`
- Produces: `function alignFloorRoomsToFootprint(rooms: Room[], target: Rect): { rooms: Room[]; summary: AlignSummary }`
- `Rect = { x: number; y: number; width: number; depth: number }` dari `@/lib/geometry`

- [ ] **Step 1: Tulis test gagal** — buat `src/lib/geometry/floor-align.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import type { Room } from "@/types"
import { indoorFootprintBBox, alignFloorRoomsToFootprint } from "./floor-align"

const r = (over: Partial<Room>): Room => ({
  id: "r", floorId: "f2", name: "R", type: "kamar_tidur",
  x: 0, y: 0, width: 3, depth: 3, areaM2: 9, ...over,
})

describe("indoorFootprintBBox", () => {
  it("returns null for empty / all-outdoor rooms", () => {
    expect(indoorFootprintBBox([])).toBeNull()
    expect(indoorFootprintBBox([r({ type: "carport" }), r({ type: "taman" })])).toBeNull()
  })

  it("bboxes indoor rooms only (outdoor excluded)", () => {
    const rooms = [
      r({ id: "a", x: 0, y: 0, width: 4, depth: 2 }),
      r({ id: "b", x: 2, y: 2, width: 3, depth: 3 }),
      r({ id: "c", type: "taman", x: 0, y: 20, width: 5, depth: 5 }),
    ]
    expect(indoorFootprintBBox(rooms)).toEqual({ x: 0, y: 0, width: 5, depth: 5 })
  })
})

describe("alignFloorRoomsToFootprint", () => {
  it("grows exposed east rooms to the target east edge (multi-band)", () => {
    const rooms = [
      r({ id: "k1", x: 0, y: 0, width: 3, depth: 3 }),
      r({ id: "k2", x: 0, y: 3, width: 3, depth: 3 }),
    ]
    const target = { x: 0, y: 0, width: 6, depth: 6 }
    const res = alignFloorRoomsToFootprint(rooms, target)
    expect(res.rooms.map((rr) => [rr.id, rr.width])).toEqual([["k1", 6], ["k2", 6]])
    expect(res.summary.grown).toEqual(["k1", "k2"])
    expect(res.rooms.every((rr) => rr.areaM2 === rr.width * rr.depth)).toBe(true)
  })

  it("shrinks rooms overhanging the target south edge", () => {
    const rooms = [r({ id: "s", x: 0, y: 0, width: 3, depth: 8 })]
    const target = { x: 0, y: 0, width: 3, depth: 5 }
    const res = alignFloorRoomsToFootprint(rooms, target)
    expect(res.rooms[0].depth).toBe(5)
    expect(res.summary.shrunk).toEqual(["s"])
  })

  it("leaves interior (non-exposed) rooms untouched", () => {
    const rooms = [
      r({ id: "out", x: 0, y: 0, width: 3, depth: 3 }),   // exposed east
      r({ id: "in", x: 3, y: 0, width: 3, depth: 3 }),     // interior (east neighbor)
      r({ id: "edge", x: 6, y: 0, width: 3, depth: 3 }),   // exposed east
    ]
    const target = { x: 0, y: 0, width: 12, depth: 3 }
    const res = alignFloorRoomsToFootprint(rooms, target)
    const byId = Object.fromEntries(res.rooms.map((rr) => [rr.id, rr]))
    expect(byId["in"].width).toBe(3) // interior unchanged
    expect(byId["out"].width).toBe(3) // grows only from its own east? No — out has east neighbor "in"
    expect(byId["edge"].width).toBe(6) // edge room grows to target
  })

  it("removes rooms that become degenerate (fully beyond target)", () => {
    const rooms = [r({ id: "hang", x: 0, y: 10, width: 3, depth: 3 })]
    const target = { x: 0, y: 0, width: 3, depth: 5 }
    const res = alignFloorRoomsToFootprint(rooms, target)
    expect(res.rooms).toHaveLength(0)
    expect(res.summary.removed).toEqual(["hang"])
  })

  it("returns input unchanged when already aligned", () => {
    const rooms = [r({ id: "a", x: 0, y: 0, width: 3, depth: 3 })]
    const target = { x: 0, y: 0, width: 3, depth: 3 }
    const res = alignFloorRoomsToFootprint(rooms, target)
    expect(res.rooms[0]).toEqual(rooms[0])
    expect(res.summary).toEqual({ grown: [], shrunk: [], removed: [] })
  })
})
```

Catatan untuk test "leaves interior untouched": `out` (x0) punya neighbor `in` (x3) tepat di timurnya → TIDAK ekspos timur → tidak digrow. `edge` (x6) ekspos timur → digrow ke 12 → width 6. Jika hasil berbeda dari komentar, sesuaikan ekspektasi dengan logika `isExposed` (ekspos = tak ada neighbor dalam toleransi `WALL_T` di sisi itu).

- [ ] **Step 2: Jalankan test → pastikan gagal**

Run: `pnpm vitest run src/lib/geometry/floor-align.test.ts`
Expected: FAIL — `Cannot find module './floor-align'` (file belum ada).

- [ ] **Step 3: Tulis implementasi** — buat `src/lib/geometry/floor-align.ts`:

```ts
/**
 * Penyelarasan footprint lantai aktif ke lantai acuan (edge-alignment bbox).
 * Hanya ruang yang TEREKSPOS di sebuah sisi yang diubah; ruang interior
 * dibiarkan; ruang yang jadi degenerate (lebar/depth ≤ 0) dihapus.
 */
import type { Room } from "@/types"
import { isOutdoorRoom } from "./connectivity"
import { roomArea, round2, type Rect } from "./index"

// Toleransi adjacency: celah ≤ tebal tembok (WALL_T = 0.12) dianggap
// bertetangga sehingga tidak "ekspos" (konsisten dgn build-model.ts).
const TOL = 0.12

export type AlignSummary = { grown: string[]; shrunk: string[]; removed: string[] }

/** Bbox union ruang INDOOR (ruang terbuka dikecualikan). null bila tak ada. */
export function indoorFootprintBBox(rooms: Room[]): Rect | null {
  const indoor = rooms.filter((r) => !isOutdoorRoom(r))
  if (indoor.length === 0) return null
  const xs = indoor.map((r) => [r.x, r.x + r.width])
  const ys = indoor.map((r) => [r.y, r.y + r.depth])
  const minX = Math.min(...xs.map(([a]) => a))
  const maxX = Math.max(...xs.map(([, b]) => b))
  const minY = Math.min(...ys.map(([a]) => a))
  const maxY = Math.max(...ys.map(([, b]) => b))
  return { x: round2(minX), y: round2(minY), width: round2(maxX - minX), depth: round2(maxY - minY) }
}

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0)
}

function isExposed(room: Room, rooms: Room[], side: "n" | "e" | "s" | "w"): boolean {
  for (const o of rooms) {
    if (o.id === room.id) continue
    if (side === "e" || side === "w") {
      if (overlap1d(room.y, room.y + room.depth, o.y, o.y + o.depth) <= TOL) continue
      if (side === "e" && Math.abs(o.x - (room.x + room.width)) <= TOL) return false
      if (side === "w" && Math.abs(room.x - (o.x + o.width)) <= TOL) return false
    } else {
      if (overlap1d(room.x, room.x + room.width, o.x, o.x + o.width) <= TOL) continue
      if (side === "s" && Math.abs(o.y - (room.y + room.depth)) <= TOL) return false
      if (side === "n" && Math.abs(room.y - (o.y + o.depth)) <= TOL) return false
    }
  }
  return true
}

/**
 * Samakan batas luar ruang aktif ke `target` (bbox lantai acuan).
 * Eksposisi dihitung terhadap himpunan ruang ORIGINAL (deterministik).
 */
export function alignFloorRoomsToFootprint(
  rooms: Room[],
  target: Rect
): { rooms: Room[]; summary: AlignSummary } {
  const none: AlignSummary = { grown: [], shrunk: [], removed: [] }
  if (rooms.length === 0 || target.width <= 0 || target.depth <= 0) return { rooms, summary: none }

  const targetN = target.y
  const targetS = target.y + target.depth
  const targetW = target.x
  const targetE = target.x + target.width

  const grown = new Set<string>()
  const shrunk = new Set<string>()

  const out = rooms.map((r) => {
    let { x, y, width, depth } = r
    const exp = {
      n: isExposed(r, rooms, "n"),
      e: isExposed(r, rooms, "e"),
      s: isExposed(r, rooms, "s"),
      w: isExposed(r, rooms, "w"),
    }
    if (exp.e) {
      const edge = x + width
      if (edge < targetE - TOL) { width = targetE - x; grown.add(r.id) }
      else if (edge > targetE + TOL) { width = targetE - x; shrunk.add(r.id) }
    }
    if (exp.w) {
      const edge = x
      if (edge > targetW + TOL) { width += x - targetW; x = targetW; grown.add(r.id) }
      else if (edge < targetW - TOL) { width -= targetW - x; x = targetW; shrunk.add(r.id) }
    }
    if (exp.s) {
      const edge = y + depth
      if (edge < targetS - TOL) { depth = targetS - y; grown.add(r.id) }
      else if (edge > targetS + TOL) { depth = targetS - y; shrunk.add(r.id) }
    }
    if (exp.n) {
      const edge = y
      if (edge > targetN + TOL) { depth += y - targetN; y = targetN; grown.add(r.id) }
      else if (edge < targetN - TOL) { depth -= targetN - y; y = targetN; shrunk.add(r.id) }
    }
    const w = round2(Math.max(0, width))
    const d = round2(Math.max(0, depth))
    return { ...r, x: round2(x), y: round2(y), width: w, depth: d, areaM2: roomArea(w, d) }
  })

  const kept = out.filter((rr) => rr.width > 0 && rr.depth > 0)
  const removed = out.filter((rr) => rr.width <= 0 || rr.depth <= 0).map((rr) => rr.id)
  return {
    rooms: kept,
    summary: { grown: [...grown], shrunk: [...shrunk], removed },
  }
}
```

- [ ] **Step 4: Jalankan test → pastikan hijau**

Run: `pnpm vitest run src/lib/geometry/floor-align.test.ts`
Expected: PASS (5 kasus). Jika kasus "interior untouched" gagal karena detail `isExposed`, sesuaikan komentar test dengan perilaku yang benar (interior = ada neighbor tepat di sisi itu, tak digrow).

- [ ] **Step 5: Commit**

```bash
git add src/lib/geometry/floor-align.ts src/lib/geometry/floor-align.test.ts
git commit -m "feat(geometry): floor footprint alignment (bbox edge-alignment)"
```

---

### Task 2: Aksi store `alignFloorToReference` (+ test)

**Files:**
- Modify: `src/stores/editor-store.ts` (tipe aksi + implementasi + import)
- Test: `src/stores/editor-store.test.ts` (tambah describe baru)

**Interfaces:**
- Consumes: `indoorFootprintBBox`, `alignFloorRoomsToFootprint` dari `@/lib/geometry/floor-align`; `isOutdoorRoom` dari `@/lib/geometry/connectivity`; `AlignSummary` type.
- Produces: `alignFloorToReference(floorId: string, refFloorId: string): AlignSummary | null` — null bila no-op (lantai sama / tak ada ruang / tak ada perubahan).

- [ ] **Step 1: Tulis test gagal** — tambah di `src/stores/editor-store.test.ts` (tambahkan `alignFloorToReference` di import store sudah lewat `useEditorStore`, dan buat layout 2-lantai):

```ts
describe("editor-store alignFloorToReference", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(
      {
        id: "l", projectId: "p", versionId: "v",
        floors: [
          { id: "f1", level: 1, name: "Lantai 1", heightM: 3 },
          { id: "f2", level: 2, name: "Lantai 2", heightM: 3 },
        ],
        rooms: [
          { id: "a1", floorId: "f1", name: "A1", type: "ruang_tamu", x: 0, y: 0, width: 6, depth: 4, areaM2: 24 },
          { id: "a2", floorId: "f1", name: "A2", type: "dapur", x: 0, y: 4, width: 6, depth: 2, areaM2: 12 },
          { id: "b1", floorId: "f2", name: "B1", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 4, areaM2: 12 },
        ],
        walls: [], openings: [], stairs: [], pools: [],
        validation: { passed: true, issues: [] },
      } as DesignLayout,
      sampleSite, []
    )
  })

  it("grows floor-2 rooms to match floor-1 indoor footprint", () => {
    const summary = useEditorStore.getState().alignFloorToReference("f2", "f1")
    const b1 = useEditorStore.getState().layout!.rooms.find((rr) => rr.id === "b1")!
    expect(b1.width).toBe(6)   // lantai1 indoor bbox width = 6
    expect(summary?.grown).toContain("b1")
  })

  it("is undo-able as a single history entry", () => {
    const before = useEditorStore.getState().layout!.rooms.find((rr) => rr.id === "b1")!.width
    useEditorStore.getState().alignFloorToReference("f2", "f1")
    useEditorStore.getState().undo()
    const after = useEditorStore.getState().layout!.rooms.find((rr) => rr.id === "b1")!.width
    expect(after).toBe(before)
  })

  it("returns null and mutates nothing for same floor or empty ref", () => {
    expect(useEditorStore.getState().alignFloorToReference("f2", "f2")).toBeNull()
    expect(useEditorStore.getState().alignFloorToReference("f2", "f1")).not.toBeNull()
  })
})
```

Tambahkan import `type { DesignLayout }` bila belum ada di file (sudah ada). `sampleSite` sudah di-import.

- [ ] **Step 2: Jalankan test → pastikan gagal**

Run: `pnpm vitest run src/stores/editor-store.test.ts -t alignFloorToReference`
Expected: FAIL — `alignFloorToReference is not a function`.

- [ ] **Step 3: Implementasi store**

Tambah import di `src/stores/editor-store.ts`:
```ts
import { alignFloorRoomsToFootprint, indoorFootprintBBox, type AlignSummary } from "@/lib/geometry/floor-align"
import { isOutdoorRoom } from "@/lib/geometry/connectivity"
```

Tambah tipe aksi (di `EditorState` interface, dekat aksi lain):
```ts
  alignFloorToReference: (floorId: string, refFloorId: string) => AlignSummary | null;
```

Tambah implementasi (dekat `addFloor`/`removeFloor`):
```ts
    alignFloorToReference: (floorId, refFloorId) => {
      const { layout } = get();
      if (!layout || floorId === refFloorId) return null;
      const floorRooms = layout.rooms.filter(
        (r) => r.floorId === floorId && !isOutdoorRoom(r)
      );
      const refRooms = layout.rooms.filter(
        (r) => r.floorId === refFloorId && !isOutdoorRoom(r)
      );
      if (floorRooms.length === 0 || refRooms.length === 0) return null;
      const target = indoorFootprintBBox(refRooms);
      if (!target) return null;
      const res = alignFloorRoomsToFootprint(floorRooms, target);
      const noop =
        res.summary.grown.length === 0 &&
        res.summary.shrunk.length === 0 &&
        res.summary.removed.length === 0;
      if (noop) return null;
      const activeId = new Set(floorRooms.map((r) => r.id));
      commit((l) => {
        l.rooms = l.rooms.filter((r) => !(r.floorId === floorId && !isOutdoorRoom(r)));
        l.rooms = [...l.rooms, ...res.rooms];
      });
      return res.summary;
    },
```

- [ ] **Step 4: Jalankan test → pastikan hijau**

Run: `pnpm vitest run src/stores/editor-store.test.ts`
Expected: PASS (semua kasus editor-store lama + 3 baru). Cek `pnpm tsc --noEmit` bersih.

- [ ] **Step 5: Commit**

```bash
git add src/stores/editor-store.ts src/stores/editor-store.test.ts
git commit -m "feat(store): alignFloorToReference action (undo-able)"
```

---

### Task 3: UI "Samakan footprint" di FloorSwitcher (+ component test)

**Files:**
- Modify: `src/components/editor/floor-switcher.tsx`
- Create test: `src/components/editor/floor-switcher.test.tsx`

**Interfaces:**
- Consumes: `useEditorStore` → `alignFloorToReference`, `selectedFloorId`, `floors`.
- Reuses: `DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuTrigger` dari `@/components/ui/dropdown-menu`; icon `AlignEndHorizontal` dari `lucide-react`.

- [ ] **Step 1: Tulis test gagal** — buat `src/components/editor/floor-switcher.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"

import { FloorSwitcher } from "./floor-switcher"
import { useEditorStore } from "@/stores/editor-store"
import { sampleSite } from "@/test-utils/fixtures"
import type { DesignLayout } from "@/types"

function twoFloorLayout(): DesignLayout {
  return {
    id: "l", projectId: "p", versionId: "v",
    floors: [
      { id: "f1", level: 1, name: "Lantai 1", heightM: 3 },
      { id: "f2", level: 2, name: "Lantai 2", heightM: 3 },
    ],
    rooms: [
      { id: "a1", floorId: "f1", name: "A1", type: "ruang_tamu", x: 0, y: 0, width: 6, depth: 4, areaM2: 24 },
      { id: "b1", floorId: "f2", name: "B1", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 4, areaM2: 12 },
    ],
    walls: [], openings: [], stairs: [], pools: [],
    validation: { passed: true, issues: [] },
  }
}

describe("FloorSwitcher — Samakan footprint", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    vi.spyOn(window, "alert").mockImplementation(() => {})
    useEditorStore.getState().loadLayout(twoFloorLayout(), sampleSite, [])
    useEditorStore.getState().setSelectedFloor("f2")
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders a Samakan control only when more than one floor exists", () => {
    render(<FloorSwitcher />)
    expect(screen.getByLabelText("Samakan footprint")).toBeTruthy()
  })

  it("aligns the active floor to the selected reference floor via the dropdown", () => {
    render(<FloorSwitcher />)
    fireEvent.pointerDown(screen.getByLabelText("Samakan footprint"))
    fireEvent.click(screen.getByText("Samakan dengan Lantai 1"))
    const b1 = useEditorStore.getState().layout!.rooms.find((rr) => rr.id === "b1")!
    expect(b1.width).toBe(6)
  })
})
```

- [ ] **Step 2: Jalankan test → pastikan gagal**

Run: `pnpm vitest run src/components/editor/floor-switcher.test.tsx`
Expected: FAIL — tidak ada `aria-label="Samakan footprint"`.

- [ ] **Step 3: Implementasi UI** — ubah `src/components/editor/floor-switcher.tsx`:

Tambah import:
```tsx
import { AlignEndHorizontal, Layers, Plus, Trash2 } from "lucide-react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
```

Di dalam komponen, ambil aksi:
```tsx
  const alignFloorToReference = useEditorStore((s) => s.alignFloorToReference)
```

Render tombol Samakan (tambahkan sebelum tombol `+`, hanya bila `floors.length > 1`):
```tsx
      {floors.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Samakan footprint"
              title="Samakan footprint dengan lantai lain"
              className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted"
            >
              <AlignEndHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {floors
              .filter((f) => f.id !== selectedFloorId)
              .map((f) => (
                <DropdownMenuItem
                  key={f.id}
                  onClick={() => {
                    const summary = alignFloorToReference(selectedFloorId, f.id)
                    if (!summary) {
                      window.alert("Tidak ada perubahan (footprint sudah sejajar atau lantai kosong).")
                    } else {
                      window.alert(
                        `Samakan footprint ke ${f.name}: ${summary.grown.length} dilebarkan, ` +
                        `${summary.shrunk.length} disusutkan, ${summary.removed.length} dihapus.`
                      )
                    }
                  }}
                >
                  Samakan dengan {f.name}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
```

Catatan: `selectedFloorId` bisa null bila belum pilih — guard `filter((f) => f.id !== selectedFloorId)` aman; bila null semua item muncul (jarang, karena loadLayout meng-set lantai pertama).

- [ ] **Step 4: Jalankan test → pastikan hijau**

Run: `pnpm vitest run src/components/editor/floor-switcher.test.tsx`
Expected: PASS (2 kasus). Cek `pnpm tsc --noEmit` bersih.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/floor-switcher.tsx src/components/editor/floor-switcher.test.tsx
git commit -m "feat(editor): samakan footprint control in floor switcher"
```

---

### Task 4: Koreksi `proj-modern-tropis-1` (migration dari data live)

**Files:**
- Create: `db/migrations/0033_align_floor2_footprint.sql`
- (sementara) scratch test untuk menghitung koordinat — hapus setelah dipakai (minta izin user bila akan dihapus).

**Interfaces:**
- Consumes: `alignFloorRoomsToFootprint`, `indoorFootprintBBox` dari Task 1; query DB via MCP `dbBaruma`.

- [ ] **Step 1: Ambil data live proyek**

Query via `dbBaruma`:
```sql
SELECT payload FROM design_layouts WHERE project_id = 'proj-modern-tropis-1';
```
Catat daftar ruang `floor-1` (indoor: bukan carport/taman/kolam/balkon/rooftop_lounge/void) dan `floor-k4KTN1` (atau id lantai2 yang aktif sekarang — cek `floors[]`).

- [ ] **Step 2: Hitung ruang lantai2 yang diselaraskan**

Buat scratch test sementara `src/lib/three/floor-align-scratch.test.ts` (atau reuse `floor-align.test.ts` dengan blok `it.only`) yang me-load ruang live tadi, panggil:
```ts
const target = indoorFootprintBBox(floor1IndoorRooms)!
const res = alignFloorRoomsToFootprint(floor2IndoorRooms, target)
console.log(res.rooms.map((rr) => ({ id: rr.id, x: rr.x, y: rr.y, width: rr.width, depth: rr.depth })))
```
Jalankan, catat output koordinat ruang lantai2 yang baru.

- [ ] **Step 3: Tulis migration idempoten**

Buat `db/migrations/0033_align_floor2_footprint.sql` mengikuti pola `0032_fix_roofzone_floor.sql` (BEGIN/COMMIT, `jsonb_set` pada `payload->'rooms'`), untuk tiap ruang lantai2 yang berubah:

```sql
-- 0033 — samakan footprint lantai2 proj-modern-tropis-1 ke lantai1
BEGIN;

UPDATE design_layouts SET payload = jsonb_set(
  payload, '{rooms}', (
    SELECT jsonb_agg(
      CASE
        WHEN o->>'id' = '<roomId>'
          AND (o->>'x')::numeric = <oldX>
          AND (o->>'y')::numeric = <oldY>
        THEN o
          || jsonb_build_object('x', <newX>, 'y', <newY>,
                                'width', <newW>, 'depth', <newD>,
                                'areaM2', <newArea>)
        ELSE o
      END ORDER BY ord)
    FROM jsonb_array_elements(payload->'rooms') WITH ORDINALITY AS t(o, ord)
  ))
WHERE project_id = 'proj-modern-tropis-1'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload->'rooms') o
    WHERE o->>'id' = '<roomId>' AND (o->>'x')::numeric = <oldX>
  );

COMMIT;
```
Ganti `<roomId>`, `<oldX>`, `<newX>` dst dengan nilai hasil Step 2. Ulangi blok UPDATE per ruang (atau satu UPDATE dengan banyak `WHEN`).

- [ ] **Step 4: Verifikasi + commit**

- Cek SQL valid: jalankan per bagian terhadap copy di DB test bila tersedia, atau setidaknya pastikan sintaks konsisten dengan `0032`.
- Commit:
```bash
git add db/migrations/0033_align_floor2_footprint.sql
git commit -m "fix(data): align floor-2 footprint to floor-1 for proj-modern-tropis-1"
```
- Hapus scratch test (minta izin user) & push bersama.

---

## Self-Review

- **Spec coverage**: Task1 = algoritma+bbox, Task2 = aksi store undo-able, Task3 = UI dropdown default-bawah+drodown, Task4 = koreksi proyek. Semua bagian spec tercakup; non-goals (overlay ghost, scale seragam) tidak disentuh.
- **Placeholder**: tidak ada TBD; semua kode & command eksplisit. Task4 data-dependent tapi step-nya konkret (nilai diisi dari Step 2 saat eksekusi).
- **Type consistency**: `alignFloorRoomsToFootprint`, `indoorFootprintBBox`, `AlignSummary`, `alignFloorToReference` dipakai konsisten antar task; `Rect` dari `@/lib/geometry`.
