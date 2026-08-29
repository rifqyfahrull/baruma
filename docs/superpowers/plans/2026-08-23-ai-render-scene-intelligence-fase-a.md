# AI Render Scene Intelligence — Fase A (Eksterior Cerdas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI render eksterior memahami bangunan & sudut pandang: analyzer server-side deterministik (pose kamera + layout DB → `SceneFacts`), prompt v2 kaya, tombol "Sudut saat ini", plus lapisan LLM polish opsional (flag off).

**Architecture:** Klien mengirim pose kamera `{position, target, fov}` bersama capture; server memuat layout via `getLayoutPayload`, menjalankan `analyzeScene` (pure TS), menyusun prompt v2, opsional memoles via `polishScene` (never-throw, cache per hash facts). Pipeline job/kredit/webhook tidak berubah. Spec: `docs/superpowers/specs/2026-08-23-ai-render-scene-intelligence-design.md`.

**Tech Stack:** Next.js App Router, TypeScript, zod, Vitest, pg (`query` helper), three.js (klien).

## Global Constraints

- **Deterministik**: `analyzeScene` & `compilePromptV2` pure — input sama → output byte-identik (dibuktikan snapshot test). Dilarang `Math.random`/`Date.now` di jalur ini.
- **Never-throw**: `polishScene` SELALU resolve `string | null` — flag off / error / timeout **5000 ms** → `null`. Flag env: `AI_RENDER_POLISH === "1"` (default off).
- **User tidak pernah menulis prompt bebas** (anti prompt-injection — tak berubah dari v1).
- **Konvensi dunia** (lib/three/compass.ts): utara = −z, timur = +x; world x = site.x − site.widthM/2, world z = site.y − site.depthM/2. Sisi **"s" = depan** (kamera preset "front" berada di +z).
- `PROMPT_GEOMETRY_GUARD` dipertahankan **verbatim** di akhir semua prompt.
- Kredit tak berubah: `RENDER_CREDIT_COST` (cepat 1 / presisi 2); polish tidak menambah biaya kredit.
- **Backward compat**: request lama (`sceneMeta` tanpa `pose`) tetap dilayani lewat `compilePrompt` lama.
- Migrasi idempoten (`IF NOT EXISTS`), file `db/migrations/0040_ai_render_scene_intel.sql`.
- Bahasa komentar kode: Indonesia (idiom repo). Fragmen prompt: Inggris.
- Verifikasi per task: `rtk vitest run <files>`; verifikasi akhir: `rtk tsc --noEmit`, `rtk vitest run`, `rtk next build`.

## File Structure (Fase A)

| File | Status | Tanggung jawab |
|---|---|---|
| `db/migrations/0040_ai_render_scene_intel.sql` | Create | Kolom `target`/`room_id`/`camera_pose` + tabel `render_polish_cache` |
| `src/lib/server/repo/renders.ts` | Modify | Kolom baru di row/insert/COLS |
| `src/lib/server/repo/render-polish-cache.ts` | Create | get/set cache polish |
| `src/lib/server/ai-render/analyze.ts` | Create | `CameraPose`, `SceneFacts`, `analyzeScene` |
| `src/lib/server/ai-render/prompt.ts` | Modify | `describeSceneFacts`, `compilePromptV2` |
| `src/lib/server/ai-render/polish.ts` | Create | `polishScene` (flag + chatText + cache) |
| `src/lib/server/ai-render/index.ts` | Modify | Re-export API baru |
| `src/app/api/v1/projects/[id]/renders/route.ts` | Modify | Schema `pose`, jalur analyze→polish→prompt v2 |
| `src/components/preview-3d/house-scene.tsx` | Modify | `captureRenderInputs` ikut kembalikan pose |
| `src/lib/three/render-capture.ts` | Modify | `poseKey` (kuantisasi pose utk params_hash) |
| `src/components/preview-3d/ai-render-dialog.tsx` | Modify | Bidikan "Sudut saat ini", kirim pose, hapus sceneMeta |
| `src/lib/data/source.ts`, `src/lib/data/http.ts`, `src/lib/mock/index.ts` | Modify | Kontrak `createRender` + pose |
| `e2e/ai-render.spec.ts` | Modify | Spec sudut kustom |

---

### Task 1: Migrasi 0040 + kolom repo + cache polish

**Files:**
- Create: `db/migrations/0040_ai_render_scene_intel.sql`
- Modify: `src/lib/server/repo/renders.ts`
- Create: `src/lib/server/repo/render-polish-cache.ts`
- Test: `src/lib/server/repo/renders.test.ts` (tambah kasus), `src/lib/server/repo/render-polish-cache.test.ts`

**Interfaces:**
- Consumes: `query` dari `@/lib/server/db` (pola persis `renders.ts` yang ada).
- Produces: `createRenderJob` opts baru `cameraPose?: unknown`, `RenderJob.cameraPose?: unknown`; `getPolishCache(factsHash: string): Promise<string | null>`; `setPolishCache(factsHash: string, description: string): Promise<void>`.

- [ ] **Step 1: Tulis migrasi**

```sql
-- 0040: AI Render Scene Intelligence (Fase A) — pose kamera per job + kolom
-- target/room_id (dipakai Fase B interior; ditambahkan sekarang supaya satu
-- migrasi, lihat spec 2026-08-23) + cache hasil LLM polish per hash facts
-- (satu hasil dipakai lintas job selama layout tidak berubah). Idempoten.
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS target text NOT NULL DEFAULT 'exterior';
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS room_id text;
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS camera_pose jsonb;

CREATE TABLE IF NOT EXISTS render_polish_cache (
  facts_hash text PRIMARY KEY,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Tambah kolom di renders.ts**

Di `RenderJobRow` tambah `target: string`, `room_id: string | null`, `camera_pose: unknown`. Di `RenderJob` tambah `target: string`, `roomId?: string`, `cameraPose?: unknown`. Perluas `COLS` dengan `, target, room_id, camera_pose`. Di `rowToRenderJob` map: `target: row.target`, `roomId: row.room_id ?? undefined`, `cameraPose: row.camera_pose ?? undefined`. Di `createRenderJob` opts tambah `cameraPose?: unknown` dan sisipkan kolom `camera_pose` ke INSERT (nilai `opts.cameraPose === undefined ? null : JSON.stringify(opts.cameraPose)`), `target` TIDAK di-insert eksplisit (DEFAULT 'exterior').

- [ ] **Step 3: Tulis render-polish-cache.ts**

```typescript
/**
 * Cache hasil LLM polish per hash(SceneFacts) — lihat spec 2026-08-23.
 * Satu hasil dipakai lintas job selama layout & pose kelas sama. INSERT
 * ON CONFLICT DO NOTHING: race dua job dgn facts sama aman (yang kalah
 * memakai baris pemenang).
 */
import { query } from "@/lib/server/db"

export async function getPolishCache(factsHash: string): Promise<string | null> {
  const res = await query<{ description: string }>(
    `SELECT description FROM render_polish_cache WHERE facts_hash = $1`,
    [factsHash]
  )
  return res.rows[0]?.description ?? null
}

export async function setPolishCache(factsHash: string, description: string): Promise<void> {
  await query(
    `INSERT INTO render_polish_cache (facts_hash, description)
     VALUES ($1, $2) ON CONFLICT (facts_hash) DO NOTHING`,
    [factsHash, description]
  )
}
```

- [ ] **Step 4: Test** — ikuti idiom mock `query` yang sudah dipakai `renders.test.ts` (vi.mock `@/lib/server/db`). Kasus: (a) `createRenderJob` dgn `cameraPose` menyertakan kolom `camera_pose` dan JSON.stringify nilai; tanpa `cameraPose` → null. (b) `rowToRenderJob` (via `getRenderJob` mock row) memetakan `target`/`room_id`/`camera_pose`. (c) polish cache: get miss → null; set lalu get (mock berurutan) → description; SQL set mengandung `ON CONFLICT (facts_hash) DO NOTHING`.

- [ ] **Step 5: Jalankan test** — `rtk vitest run src/lib/server/repo/renders.test.ts src/lib/server/repo/render-polish-cache.test.ts` → PASS.

- [ ] **Step 6: Commit** — `feat(ai-render): migrasi 0040 pose kamera + cache polish`

---

### Task 2: Analyzer deterministik `analyze.ts`

**Files:**
- Create: `src/lib/server/ai-render/analyze.ts`
- Test: `src/lib/server/ai-render/analyze.test.ts`

**Interfaces:**
- Consumes: `DesignLayout`, `Site` dari `@/types`; `ExteriorElement` dari `@/types/exterior`; `facadeCladdingById` dari `@/lib/three/facade-claddings`.
- Produces (dipakai Task 3 & 5, nama persis):

```typescript
export type CameraPose = {
  /** World three.js: x timur, y atas, z selatan (utara = −z, compass.ts). */
  position: [number, number, number]
  target: [number, number, number]
  /** Derajat, vertikal (PerspectiveCamera.fov). */
  fov: number
}
export type FacadeSideId = "n" | "s" | "w" | "e"
export interface SideFacts {
  side: FacadeSideId
  claddings: string[]      // label katalog, unik, urut abjad
  windowCount: number
  doorCount: number
  garageDoorCount: number
  facadeElements: string[] // kind unik, urut abjad
  balconyCount: number
}
export interface SceneFacts {
  camera: {
    heightClass: "eye-level" | "elevated" | "aerial"
    distanceClass: "close-up" | "medium" | "wide"
    lensMm: 24 | 35 | 50
    visibleSides: FacadeSideId[] // 1–2, primer dulu
  }
  massing: {
    siteWidthM: number; siteDepthM: number
    footprintWidthM: number; footprintDepthM: number
    floors: number; approxHeightM: number
    hasRooftopDeck: boolean; rooftopRailing?: string
  }
  sides: SideFacts[]           // hanya sisi terlihat, urutan = visibleSides
  exteriorInFrame: string[]    // kind unik urut abjad, hanya yang masuk frustum
  roof: { zoneTypes: string[]; globalType: string; skylightCount: number }
  lighting: { exteriorLampCount: number }
  vegetationPresent: boolean
}
export function analyzeScene(layout: DesignLayout, site: Site, pose: CameraPose): SceneFacts
```

- [ ] **Step 1: Tulis failing test dulu** (`analyze.test.ts`, vitest node env). Fixture minimal: site 10×15; 2 ruang lantai "lantai-1" — `r1` (x0,y5,w5,d10, type "kamar"), `r2` (x5,y5,w5,d10, type "dapur"); `layout.facade = { "r1:s": "beton_ekspos" }`; satu opening window `wallId:"r1:s"`; satu `facadeElements` kind `"louver_band"` wallId `"r1:s"`; `exteriorElements`: satu `fence` segment start(0,14.5) end(10,14.5) + satu `tree` di (1,1) (belakang rumah); `roofZones` satu `pelana`; `exteriorLamps` 2 item; floors `[{id:"lantai-1"...},{id:"lantai-2"...}]`. Pose kamera depan eye-level: `position:[0, 1.6, 14]`, `target:[0, 1.5, 0]`, `fov: 50` (world; site center cx=5, cz=7.5 → kamera di selatan bangunan). Assert:
  - `visibleSides` = `["s"]`; `heightClass` = `"eye-level"`; `lensMm` = 35
  - `sides[0]`: claddings `["Beton ekspos"]` (label katalog), windowCount 1, facadeElements `["louver_band"]`
  - `exteriorInFrame` memuat `"fence"` dan TIDAK memuat `"tree"` (di belakang kamera)
  - `roof.zoneTypes` = `["pelana"]`; `lighting.exteriorLampCount` = 2; `massing.floors` = 2
  - Pose kamera iso tenggara `position:[18, 12, 18]` → `visibleSides` = `["s","e"]` (primer "s" bila azimuth lebih dekat ke 0°) dan `heightClass` = `"aerial"` bila y=12 ≥ 9.
- [ ] **Step 2: Run test → FAIL** (module not found).
- [ ] **Step 3: Implementasi `analyze.ts`.** Algoritma (semua pure, angka dibulatkan 1 desimal via `round1 = (v)=>Math.round(v*10)/10`):

```typescript
// Konversi world→site: siteX = worldX + site.widthM/2; siteY = worldZ + site.depthM/2.
// Footprint = bbox rooms floor pertama non-rooftop (fallback: seluruh site).
// Azimuth kamera relatif pusat footprint (world xz): az = atan2(dx, dz) → derajat [0,360).
// Ring sisi: s=0°, e=90°, n=180°, w=270°. Primer = selisih sudut minimum.
// Sekunder = tetangga ring terdekat bila 20° ≤ selisih-dari-sumbu-primer ≤ 70°.
// heightClass: y<2.5 eye-level; y<9 elevated; else aerial.
// diag = hypot(footprintW, footprintD); dist = |pos−center| 3D;
// ratio = dist/diag: <1.0 close-up; <2.2 medium; else wide.
// lensMm: fov≥55→24; fov≥35→35; else 50.
// edgeRooms(side): rooms SEMUA lantai yang tepinya menyentuh tepi bbox sisi itu
//   (toleransi 0.25 m). s: |r.y+r.depth − (fy+fd)|≤0.25; n: |r.y − fy|≤0.25;
//   w: |r.x − fx|≤0.25; e: |r.x+r.width − (fx+fw)|≤0.25.
// SideFacts: dari entries facade/openings/facadeElements dgn wallId ===
//   `${roomId}:${side}` utk roomId ∈ edgeRooms(side). claddings via
//   facadeCladdingById(id)?.label ?? id, unik + sort. Opening type "window" →
//   windowCount; type "door": kind==="garage_door" → garageDoorCount, selain
//   itu doorCount. balconyCount = edgeRooms bertipe "balkon".
// exteriorInFrame: titik wakil elemen (segment → midpoint; box/frame/gable/
//   stair/asset → (x+widthM/2, y+depthM/2); surface → centroid points; stair
//   pakai lengthM utk depth) → world → sudut antara proyeksi-xz(target−position)
//   dan (titik−position) ≤ min(100, fov*1.35)/2 + 12° DAN jarak ≤ 3×diag.
//   Skip element.hidden. Kind unik + sort.
// roof: zoneTypes = unique(roofZones non-hidden .type) sort; globalType =
//   layout.roof?.type ?? "datar"; skylightCount = layout.skylights?.length ?? 0.
// floors = layout.floors.filter(f=>f.id!=="floor-rooftop").length || 1;
// approxHeightM = round1(floors*3.2 + (adaTipeAtapNonDatar ? 1.8 : 0.3));
// hasRooftopDeck = layout.floors.some(f=>f.id==="floor-rooftop");
// rooftopRailing = hasRooftopDeck ? (layout.rooftopRailingStyle ?? "kaca") : undefined.
```

  Tidak ada I/O, tidak throw: input aneh (footprint kosong, fov 0) → fallback aman (footprint=site, fov di-clamp 10–120).
- [ ] **Step 4: Run test → PASS.** `rtk vitest run src/lib/server/ai-render/analyze.test.ts`
- [ ] **Step 5: Commit** — `feat(ai-render): analyzer deterministik pose+layout -> SceneFacts`

---

### Task 3: Prompt v2 (`describeSceneFacts` + `compilePromptV2`)

**Files:**
- Modify: `src/lib/server/ai-render/prompt.ts`
- Modify: `src/lib/server/ai-render/index.ts` (re-export `compilePromptV2`, `describeSceneFacts`, `analyzeScene`, tipe `CameraPose`/`SceneFacts`)
- Test: `src/lib/server/ai-render/prompt.test.ts` (+ snapshot)

**Interfaces:**
- Consumes: `SceneFacts`, `FacadeSideId` dari `./analyze` (Task 2).
- Produces: `describeSceneFacts(facts: SceneFacts): string`; `compilePromptV2(facts: SceneFacts, presetId: string, polishedDescription?: string | null): string`. `compilePrompt` lama TIDAK diubah.

- [ ] **Step 1: Failing snapshot test** — dua fixture `SceneFacts` (eye-level depan; aerial iso 2 sisi + rooftop deck + preset "malam" dgn lampCount 3) → `expect(compilePromptV2(facts, "tropis-siang")).toMatchSnapshot()` dst; plus assert `compilePromptV2(facts, "x", "POLISHED")` memuat `"POLISHED"` dan TIDAK memuat hasil `describeSceneFacts(facts)`; dan semua output diakhiri `PROMPT_GEOMETRY_GUARD`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implementasi.** Label sisi: `{ s: "front (south)", n: "rear (north)", e: "east side", w: "west side" }`. Klausa berurutan TETAP (join `"; "`):
  1. `"{heightClass} camera view of the {label sisi, join ' and '} facade, {distanceClass} distance, {lensMm}mm architectural lens"`
  2. `"{floors}-storey house, footprint {fw} x {fd} meters on a {sw} x {sd} meter lot, approximate height {h} meters"` (+ `", rooftop deck with {railing} railing"` bila ada)
  3. Per sisi terlihat: `"{label}: {claddings join ', '} cladding"` + `", {n} window(s)"` bila >0 + `", {n} door(s)"` + `", {n} garage door(s)"` + `", {kind join ', '}"` (facadeElements) + `", {n} balcony(ies)"` — bagian kosong dilewati; sisi tanpa fakta sama sekali dilewati.
  4. `"visible site elements: {exteriorInFrame join ', '}"` bila tak kosong (kind diterjemahkan snake_case → spasi).
  5. `"roof: {zoneTypes join ', '}"` (fallback `globalType`) + `" with {n} skylight(s)"` bila >0.
  6. HANYA preset `"malam"` dan lampCount>0: `"{n} warm exterior lamps glowing"`.

  `compilePromptV2` merangkai persis pola `compilePrompt` lama — tiap bagian diberi titik lalu di-join spasi:

```typescript
return [
  `${PROMPT_BASE}.`,
  `${(polishedDescription?.trim() || describeSceneFacts(facts))}.`,
  `${preset.promptFragment}.`,
  `${PROMPT_GEOMETRY_GUARD}.`,
].join(" ")
```
- [ ] **Step 4: Run → PASS** (snapshot tertulis). `rtk vitest run src/lib/server/ai-render/prompt.test.ts`
- [ ] **Step 5: Commit** — `feat(ai-render): prompt v2 dari SceneFacts (klausa deterministik)`

---

### Task 4: `polish.ts` — lapisan LLM opsional

**Files:**
- Create: `src/lib/server/ai-render/polish.ts`
- Test: `src/lib/server/ai-render/polish.test.ts`

**Interfaces:**
- Consumes: `chatText` dari `@/lib/server/llm` (`chatText(messages: ChatMsg[]): Promise<string | null>`); `getPolishCache`/`setPolishCache` (Task 1); `describeSceneFacts` (Task 3); `SceneFacts` (Task 2).
- Produces: `polishScene(facts: SceneFacts): Promise<string | null>`; `factsHash(facts: SceneFacts): string` (diekspor untuk test/route).

- [ ] **Step 1: Failing test.** Mock `@/lib/server/llm`, `@/lib/server/repo/render-polish-cache`. Kasus: (a) env `AI_RENDER_POLISH` unset → resolve `null`, `chatText` TIDAK dipanggil; (b) flag "1" + cache hit → kembalikan cache, `chatText` TIDAK dipanggil; (c) flag "1" + cache miss + chatText resolve teks → kembalikan teks ter-trim & `setPolishCache` terpanggil dgn hash sama; (d) chatText reject → resolve `null` (tidak throw); (e) chatText menggantung > timeout → `null` (pakai `vi.useFakeTimers` + advanceTimersByTimeAsync(5000)); (f) `factsHash` deterministik: dua objek facts identik → hash sama.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implementasi:**

```typescript
/**
 * Lapisan LLM opsional (spec 2026-08-23 §Hybrid): memoles deskripsi scene
 * deterministik jadi paragraf arsitektural yang lebih luwes. KONTRAK
 * NEVER-THROW: selalu resolve string|null — null = pakai deskripsi
 * deterministik apa adanya. Flag AI_RENDER_POLISH=1 (default off). Hasil
 * di-cache per factsHash (render_polish_cache) supaya render ulang layout
 * sama tidak membayar LLM lagi & params_hash tetap bermakna.
 * CATATAN 2 REPO: file INI satu-satunya titik divergensi — repo utama pakai
 * chatText (Agent Lab); Emergent memakai openai-client. Jaga tetap kecil.
 */
import { chatText } from "@/lib/server/llm"
import { getPolishCache, setPolishCache } from "@/lib/server/repo/render-polish-cache"
import { describeSceneFacts } from "./prompt"
import type { SceneFacts } from "./analyze"

const POLISH_TIMEOUT_MS = 5000

export function polishEnabled(): boolean {
  return process.env.AI_RENDER_POLISH === "1"
}

/** FNV-1a 32-bit atas JSON facts — idiom sama projectSeed/renderParamsHash. */
export function factsHash(facts: SceneFacts): string {
  const key = JSON.stringify(facts)
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export async function polishScene(facts: SceneFacts): Promise<string | null> {
  if (!polishEnabled()) return null
  try {
    const hash = factsHash(facts)
    const cached = await getPolishCache(hash)
    if (cached) return cached
    const base = describeSceneFacts(facts)
    const result = await Promise.race([
      chatText([
        {
          role: "system",
          content:
            "You rewrite structured architectural scene facts into ONE fluent English " +
            "paragraph for a photorealistic image prompt. Keep EVERY fact (sides, counts, " +
            "materials, dimensions) exactly as given; never invent or drop elements; no " +
            "camera/style/lighting words; max 90 words; output the paragraph only.",
        },
        { role: "user", content: base },
      ]),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), POLISH_TIMEOUT_MS)),
    ])
    const text = typeof result === "string" ? result.trim() : ""
    if (!text) return null
    await setPolishCache(hash, text)
    return text
  } catch (e) {
    console.error("[ai-render/polish]", e instanceof Error ? e.message : e)
    return null
  }
}
```

- [ ] **Step 4: Run → PASS.** `rtk vitest run src/lib/server/ai-render/polish.test.ts`
- [ ] **Step 5: Commit** — `feat(ai-render): polishScene LLM opsional (flag off, cache, never-throw)`

---

### Task 5: Route POST — jalur pose → analyze → polish → prompt v2

**Files:**
- Modify: `src/app/api/v1/projects/[id]/renders/route.ts`
- Test: `src/app/api/v1/projects/[id]/renders/route.test.ts` (tambah kasus; JANGAN ubah kasus lama — backward compat harus tetap hijau)

**Interfaces:**
- Consumes: `analyzeScene`/`CameraPose` (Task 2), `compilePromptV2` (Task 3), `polishScene` (Task 4), `getLayoutPayload` dari `@/lib/server/repo/layouts`, `createRenderJob` dgn `cameraPose` (Task 1).
- Produces: body POST menerima `pose` opsional; `sceneMeta` menjadi opsional; minimal salah satu wajib.

- [ ] **Step 1: Failing test.** Mock modul (idiom test route yang ada): `getLayoutPayload` → fixture layout Task 2. Kasus baru: (a) body dgn `pose` valid TANPA `sceneMeta` → 201, `compilePromptV2` terpakai (assert via provider.submit menerima prompt yang memuat `"facade"` — string khas describeSceneFacts) dan `createRenderJob` dipanggil dgn `cameraPose` = pose; (b) body TANPA `pose` DAN TANPA `sceneMeta` → 400; (c) `pose.fov` 500 → 400; (d) pose ada tapi `getLayoutPayload` → null DAN `sceneMeta` ada → jatuh ke `compilePrompt` lama (prompt memuat `"roof type:"`); (e) kasus lama `sceneMeta`-only → tetap 201 (regresi guard).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implementasi.** Ubah `bodySchema`:

```typescript
const poseSchema = z.object({
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  target: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  fov: z.number().min(10).max(120),
})
// di bodySchema: pose: poseSchema.optional(), sceneMeta: <schema lama>.optional()
```

  Setelah parse: `if (!parsed.data.pose && !parsed.data.sceneMeta) return err(400, "Butuh pose atau sceneMeta")`. Ganti blok `const prompt = compilePrompt(...)`:

```typescript
let prompt: string
let cameraPose: CameraPose | undefined
if (pose) {
  const layout = await getLayoutPayload(projectId)
  if (layout) {
    const facts = analyzeScene(layout, project.site, pose)
    const polished = await polishScene(facts)
    prompt = compilePromptV2(facts, preset, polished)
    cameraPose = pose
  } else if (sceneMeta) {
    prompt = compilePrompt(sceneMeta, preset) // layout belum tersimpan — fallback lama
  } else {
    return err(400, "Layout proyek belum tersimpan")
  }
} else {
  prompt = compilePrompt(sceneMeta!, preset) // guard di atas menjamin ada
}
```

  Teruskan `cameraPose` ke `createRenderJob`. Tidak ada perubahan lain (kredit/cache/flag/watermark tetap).
- [ ] **Step 4: Run → PASS** — `rtk vitest run "src/app/api/v1/projects/[id]/renders/route.test.ts"` (kasus lama + baru semua hijau).
- [ ] **Step 5: Commit** — `feat(ai-render): route POST jalur pose -> analyzeScene -> prompt v2`

---

### Task 6: Klien — pose dari bridge, bidikan "Sudut saat ini", kirim pose

**Files:**
- Modify: `src/components/preview-3d/house-scene.tsx` (captureRenderInputs), `src/stores/preview-store.ts` (tipe return), `src/lib/three/render-capture.ts` (`poseKey`), `src/components/preview-3d/ai-render-dialog.tsx`, `src/lib/data/source.ts`, `src/lib/data/http.ts`, `src/lib/mock/index.ts`
- Test: `src/lib/three/render-capture.test.ts` (tambah `poseKey`), `src/components/preview-3d/ai-render-dialog.test.tsx` (sesuaikan mock)

**Interfaces:**
- Consumes: tipe `CameraPose` BENTUKNYA sama dgn server tapi didefinisikan klien-side di `render-capture.ts` (jangan import modul server ke bundle klien): `export type CapturedPose = { position: [number, number, number]; target: [number, number, number]; fov: number }`.
- Produces: `captureRenderInputs()` → `{ beauty, depth, width, height, pose: CapturedPose }`; `poseKey(pose: CapturedPose): string`; `DataSource.createRender` input: `pose: CapturedPose`, `sceneMeta` DIHAPUS dari kontrak (server masih menerimanya opsional utk klien lama yang sudah ter-deploy).

- [ ] **Step 1: Failing test `poseKey`** di `render-capture.test.ts`:

```typescript
it("poseKey mengkuantisasi 0.1 m/0.5° — jitter kecil tidak mengubah kunci", () => {
  const a = poseKey({ position: [1.234, 5.678, -3.21], target: [0, 1.5, 0], fov: 50 })
  const b = poseKey({ position: [1.26, 5.66, -3.24], target: [0.04, 1.5, 0], fov: 50.2 })
  expect(a).toBe(b)
  const c = poseKey({ position: [2.4, 5.7, -3.2], target: [0, 1.5, 0], fov: 50 })
  expect(a).not.toBe(c)
})
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implementasi klien:**
  - `render-capture.ts`: tambah `CapturedPose` + `export function poseKey(p: CapturedPose): string` — tiap komponen posisi/target dibulatkan ke 0.1 (`Math.round(v*10)/10`... pakai `(Math.round(v/0.1)*0.1).toFixed(1)`), fov ke 0.5 (`(Math.round(p.fov*2)/2).toFixed(1)`), join `:` dgn prefix `pose`.
  - `house-scene.tsx` (dalam `setCaptureRenderInputs`): sebelum `return`, susun pose:

```typescript
const persp = camera as THREE.PerspectiveCamera
const dir = new THREE.Vector3()
persp.getWorldDirection(dir)
const pose = {
  position: persp.position.toArray() as [number, number, number],
  target: persp.position.clone().addScaledVector(dir, 10).toArray() as [number, number, number],
  fov: persp.fov,
}
return { beauty, depth, width, height, pose }
```

  - `preview-store.ts`: perluas tipe `captureRenderInputs` return dgn `pose: { position: [number, number, number]; target: [number, number, number]; fov: number }`.
  - `ai-render-dialog.tsx`: (1) daftar bidikan = `PHOTO_SHOTS` + entri lokal `{ id: "sudut-ini", label: "Sudut saat ini" }`; bila `shotId === "sudut-ini"` LEWATI `requestView`/set lighting (capture apa adanya, state tidak diubah kecuali sunStudy off); (2) simpan `captured.pose`; (3) `paramsHash`: field `view` diisi `shot.view` utk preset, `poseKey(captured.pose)` utk "sudut-ini"; `lighting` utk "sudut-ini" = `"apa-adanya"`; (4) payload `createRender.mutate`: ganti `sceneMeta` dgn `pose: captured.pose`; `shotId` tetap dikirim ("sudut-ini" valid — kolom `shot_id` bebas string); (5) hapus `deriveSceneMeta` + import `facadeCladdingById` yang jadi yatim.
  - `source.ts`/`http.ts`/`mock/index.ts`: kontrak `createRender` — hapus `sceneMeta`, tambah `pose: { position: [number,number,number]; target: [number,number,number]; fov: number }`; http meneruskan apa adanya; mock mengabaikan pose (tetap resolve job mock).
- [ ] **Step 4: Sesuaikan `ai-render-dialog.test.tsx`** — mock `captureRenderInputs` kini mengembalikan `pose` (fixture `{position:[0,1.6,14], target:[0,1.5,0], fov:50}`); assert payload mutate memuat `pose` dan TIDAK memuat `sceneMeta`; tambah kasus pilih "Sudut saat ini" → `requestView` TIDAK terpanggil.
- [ ] **Step 5: Run → PASS** — `rtk vitest run src/lib/three/render-capture.test.ts src/components/preview-3d/ai-render-dialog.test.tsx`
- [ ] **Step 6: Commit** — `feat(ai-render): klien kirim pose kamera + bidikan "Sudut saat ini"`

---

### Task 7: E2E + verifikasi penuh

**Files:**
- Modify: `e2e/ai-render.spec.ts`
- Test: seluruh suite

- [ ] **Step 1: Tambah spec e2e** (provider mock, pola spec yang ada): buka dialog Render AI → pilih bidikan "Sudut saat ini" → submit → tunggu hasil mock sukses; assert request POST `/renders` (route intercept `page.waitForRequest`) body memuat `pose.position` array 3 angka dan tidak memuat `sceneMeta`.
- [ ] **Step 2: Jalankan** `rtk playwright test e2e/ai-render.spec.ts` → PASS (di lingkungan dev server + `AI_RENDER_PROVIDER=mock`, cara yang sama spec lama dijalankan).
- [ ] **Step 3: Verifikasi penuh** — `rtk tsc --noEmit` (0 error), `rtk vitest run` (0 fail), `rtk next build` (0 error/warning).
- [ ] **Step 4: Commit** — `feat(ai-render): e2e sudut kustom + verifikasi fase A`

---

## Catatan untuk eksekutor

- Task 2–4 murni server & saling independen setelah Task 1–2 selesai; Task 5 butuh 1–4; Task 6 butuh 5 (kontrak API); Task 7 terakhir.
- JANGAN mengubah `compilePrompt` lama, `RENDER_CREDIT_COST`, alur kredit/cache/webhook.
- Fase B (interior) di luar plan ini — kolom `target`/`room_id` sudah disiapkan migrasi 0040 tapi TIDAK dipakai kode Fase A (selalu default 'exterior'/null).
