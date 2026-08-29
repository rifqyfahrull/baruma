# AI Render Scene Intelligence — Fase B (Interior per Ruang) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render AI interior per ruangan: pilih ruang (atau "Sudut saat ini" dari dalam ruang), kamera eye-level otomatis, `RoomFacts` analyzer deterministik, basis prompt interior — di atas pipeline Fase A yang sudah live.

**Architecture:** Menumpang penuh pada infrastruktur Fase A (pose kamera, layout server-side, polish, kolom `target`/`room_id` sudah ada di migrasi 0043 — TIDAK ada migrasi baru). Baru: `analyze-room.ts` (RoomFacts), basis prompt interior di `prompt.ts`, cabang `target=interior` di route, penempatan kamera interior di klien (`requestInteriorView` + efek CameraRig), UI pilih ruangan di dialog. Spec: `docs/superpowers/specs/2026-08-23-ai-render-scene-intelligence-design.md` §RoomFacts.

**Tech Stack:** sama dengan Fase A (Next.js App Router, zod, Vitest, pg, three.js klien).

## Global Constraints

- Semua konstrain Fase A tetap berlaku (deterministik, never-throw polish, geometry guard verbatim, kredit tak berubah, backward compat, bahasa komentar Indonesia / fragmen prompt Inggris).
- **Tidak ada migrasi DB baru** — `render_jobs.target` (default 'exterior') & `room_id` sudah ada (0043). Fase B mulai MENULIS kolom itu.
- `analyzeRoom` pure & deterministik; ruang tak ditemukan → `null` (route → 400 **SEBELUM** `spendCreditsOnce`, meniru fix orphan-spend Fase A).
- Konvensi dunia sama (utara = −z; world x = site.x − widthM/2, world z = site.y − depthM/2). Tinggi dinding `WALL_H` & tebal slab `SLAB_T` dari `src/lib/three/build-model.ts`; elevasi lantai dari `floorElevations` (`src/lib/geometry/vertical.ts`) — keduanya murni (verifikasi tak menyeret three.js ke server sebelum dipakai; kalau `build-model.ts` mengimpor three, salin konstanta numeriknya ke analyze-room dgn komentar sumber).
- Jalur eksterior Fase A (target default 'exterior') tidak berubah perilaku sedikit pun — test lama tetap hijau tanpa dimodifikasi.
- Verifikasi per task `rtk vitest run <files>`; akhir: `rtk tsc --noEmit`, `rtk vitest run`, `rtk next build`, e2e.

## File Structure (Fase B)

| File | Status | Tanggung jawab |
|---|---|---|
| `src/lib/server/ai-render/analyze-room.ts` | Create | `RoomFacts`, `analyzeRoom` (by roomId ATAU deteksi dari pose) |
| `src/lib/server/ai-render/prompt.ts` | Modify | `INTERIOR_PROMPT_BASE`, `describeRoomFacts`, `compilePromptInterior`, `interiorLightClause` |
| `src/lib/server/ai-render/polish.ts` | Modify | Perluas tipe input `SceneFacts \| RoomFacts` |
| `src/lib/server/ai-render/index.ts` | Modify | Re-export API interior |
| `src/lib/server/repo/renders.ts` | Modify | `createRenderJob` opts `target?`/`roomId?` → INSERT |
| `src/lib/server/ai-render/view.ts` | Modify | `RenderJobView` + `target`/`roomId` (label galeri) |
| `src/app/api/v1/projects/[id]/renders/route.ts` | Modify | Body `target`/`roomId`, cabang interior |
| `src/stores/preview-store.ts` | Modify | `requestInteriorView(roomId)` + `interiorViewNonce` |
| `src/components/preview-3d/camera-rig.tsx` | Modify | Efek penempatan kamera interior eye-level |
| `src/components/preview-3d/ai-render-dialog.tsx` | Modify | Switcher Eksterior/Interior + dropdown ruangan (prop `layout` terpakai lagi) |
| `src/lib/data/source.ts` | Modify | createRender input + `target`/`roomId` |
| `e2e/ai-render.spec.ts` | Modify | Kasus interior |

---

### Task 1: `analyze-room.ts` — RoomFacts analyzer

**Files:**
- Create: `src/lib/server/ai-render/analyze-room.ts`
- Test: `src/lib/server/ai-render/analyze-room.test.ts`

**Interfaces:**
- Consumes: `DesignLayout`, `Site`, `Room`, `Opening`, `RoomInteriorPlan`, `PlacedFurniture`, `MaterialAssignment`, `LightingFixture` dari `@/types`; `CameraPose`, `FacadeSideId` dari `./analyze`; `floorElevations` dari `@/lib/geometry/vertical` (verifikasi pure — bila menyeret three, hitung baseY manual: `index * (WALL_H + SLAB_T)` dgn konstanta disalin + komentar sumber).
- Produces (dipakai Task 2 & 3, nama persis):

```typescript
export interface FurnitureFact {
  name: string          // PlacedFurniture.name
  category: string
  /** Posisi relatif kasar: "against the north wall" | "near the center" |
   *  "in the south-east corner" — deterministik dari x/y vs rect ruang. */
  placement: string
}
export interface RoomFacts {
  roomId: string
  roomName: string
  roomType: string
  floorIndex: number       // 0 = lantai dasar
  widthM: number; depthM: number; areaM2: number
  ceilingHeightM: number   // WALL_H dibulatkan 1 desimal
  style?: string           // RoomInteriorPlan.style bila ada
  /** RoomInteriorPlan.colorPalette (nilai objek colors di-flatten jadi daftar
   *  string, urut key abjad) — spec §RoomFacts menyebut palet warna eksplisit. */
  colorPalette?: string[]
  materials: Array<{ surface: string; name: string }>  // urut surface abjad
  furniture: FurnitureFact[]                            // urut nama abjad
  windowSides: FacadeSideId[]  // sisi ruang yang punya jendela (urut ring s,e,n,w)
  doorCount: number
  hasCurtains: boolean         // ada opening window dgn curtainModelUrl terisi
  skylightCount: number        // skylight layout yang rect-nya overlap rect ruang
  lighting: { fixtureCount: number; warmCount: number }  // dari RoomInteriorPlan.lighting (qty dijumlah)
}
export function analyzeRoom(
  layout: DesignLayout,
  site: Site,
  sel: { roomId?: string; pose?: CameraPose }
): RoomFacts | null
```

- [ ] **Step 1: Failing test.** Fixture: site 10×15; floors `[{id:"lantai-1"},{id:"lantai-2"}]`; room `r1` (x1,y6,w4,d5, name "Kamar Tidur Utama", type "kamar", floorId "lantai-1"); openings: window `wallId:"r1:s"` dgn `curtainModelUrl:"x.glb"`, window `wallId:"r1:e"`, door `wallId:"r1:n"`; `interiors:[{roomId:"r1", style:"japandi", furniture:[{name:"Bed", category:"bed", x:1.2, y:6.4, widthM:2, depthM:1.8, ...}, {name:"Wardrobe", category:"storage", x:4.2, y:9.5, ...}], materials:[{surface:"floor", name:"Parket kayu", ...}], lighting:[{type:"downlight", colorTemperature:"warm", qty:4, ...}], ...}]`; `skylights:[{x:2,y:7,widthM:1,depthM:1,...}]`. Assert:
  - `analyzeRoom(layout, site, {roomId:"r1"})`: roomName/type benar; `windowSides` = `["s","e"]`; `doorCount` 1; `hasCurtains` true; `skylightCount` 1; `materials` `[{surface:"floor", name:"Parket kayu"}]`; `lighting` `{fixtureCount:4, warmCount:4}`; `furniture[0].placement` mengandung "wall" atau "corner" (Bed di y6.4 dekat tepi utara ruang → "against the north wall").
  - `{roomId:"nope"}` → `null`.
  - Deteksi pose: kamera world di dalam r1 lantai dasar — site (3, 8.5) → world `[-2, 1.5, 1]` → `{pose:{position:[-2,1.5,1], target:[0,1.4,3], fov:60}}` → RoomFacts r1. Kamera di luar semua ruang → `null`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implementasi.** Algoritma:
  - Resolusi ruang: `sel.roomId` → cari langsung. `sel.pose` → konversi world→site (`siteX = pos[0]+widthM/2`, `siteY = pos[2]+depthM/2`), kandidat = rooms yang rect-nya memuat titik; pilih yang elevasi lantainya memuat `pos[1]` (`baseY ≤ y < baseY + WALL_H + SLAB_T`, baseY dari `floorElevations`); tak ada → `null`. Keduanya kosong → `null`.
  - `floorIndex` dari urutan `layout.floors` non-rooftop.
  - `placement` furnitur (pusat item = x+widthM/2, y+depthM/2, koordinat site; rect ruang diketahui): jarak ke tiap tepi ruang; ≤0.7 m ke SATU tepi → `against the {north|south|east|west} wall` (tepi y-min ruang = north — konsisten kompas denah); ≤0.7 m ke DUA tepi → `in the {north|south}-{east|west} corner`; selainnya `near the center`.
  - `windowSides`: openings type "window" dgn `wallId === "r1:{side}"` → kumpulkan side, urut ring `["s","e","n","w"]`.
  - `skylightCount`: overlap rect sederhana (interval x & y beririsan).
  - `materials`/`furniture`/`lighting`/`style` dari `layout.interiors?.find(p => p.roomId === roomId)` — absen → array kosong/undefined (analyzer tak pernah throw).
  - `ceilingHeightM` = round1(WALL_H).
- [ ] **Step 4: Run → PASS** (`rtk vitest run src/lib/server/ai-render/analyze-room.test.ts`) + `rtk tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(ai-render): analyzeRoom — RoomFacts deterministik (byId + deteksi pose)`

---

### Task 2: Prompt interior + polish menerima RoomFacts

**Files:**
- Modify: `src/lib/server/ai-render/prompt.ts`, `src/lib/server/ai-render/polish.ts`, `src/lib/server/ai-render/index.ts`
- Test: `src/lib/server/ai-render/prompt.test.ts` (+snapshot), `src/lib/server/ai-render/polish.test.ts` (1 kasus tipe)

**Interfaces:**
- Produces: `describeRoomFacts(facts: RoomFacts): string`; `compilePromptInterior(facts: RoomFacts, presetId: string, polishedDescription?: string | null): string`; `interiorLightClause(facts: RoomFacts, presetId: string): string | null`. `polishScene` kini bertipe `(facts: SceneFacts | RoomFacts)` (factsHash ikut dilebarkan — implementasi tak berubah, JSON.stringify).

- [ ] **Step 1: Failing snapshot test** — fixture RoomFacts kamar japandi (dari Task 1) + ruang minim (tanpa interiors). Assert: output diakhiri `PROMPT_GEOMETRY_GUARD.`; polished override + preset "malam" dgn `lighting.fixtureCount>0` tetap memuat klausa lampu interior (pola `nightLampClause` Fase A); basis interior ≠ `PROMPT_BASE` eksterior (mengandung "interior").
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implementasi.**

```typescript
const INTERIOR_PROMPT_BASE =
  "photorealistic interior architectural photography of a residential room, " +
  "professional interior design magazine photography, natural light from the windows, " +
  "sharp focus, high dynamic range, shot on a 16-24mm wide-angle lens at eye level"
```

  Klausa `describeRoomFacts` berurutan tetap (join "; "):
  1. `"{roomType EN} \"{roomName}\" on {floor label}, {w} x {d} meters ({area} m2), {ceiling} meter ceiling"` — map tipe→EN kecil (`kamar`→"bedroom", `dapur`→"kitchen", `kamar_mandi`→"bathroom", `ruang_keluarga`→"family room", `ruang_tamu`→"living room", `ruang_makan`→"dining room", `tangga`→"stairwell", fallback tipe mentah); floor label: index 0 → "the ground floor", n → "floor {n+1}".
  2. `"{style} interior style"` bila ada (+ `", color palette: {colorPalette join ', '}"` bila ada).
  3. `"materials: {surface}: {name}, ..."` bila ada.
  4. `"furniture: {name} {placement}, ..."` bila ada.
  5. `"daylight from the {sisi EN join ' and '} window(s)"` bila windowSides tak kosong (+ `", sheer curtains"` bila hasCurtains) ; `"{n} skylight(s) overhead"` bila >0.
  6. Preset "malam" & fixtureCount>0 → `interiorLightClause`: `"{fixtureCount} interior light fixtures on ({warmCount} warm)"` — dipisah agar bisa di-append setelah polish (persis pola `nightLampClause`).
  `compilePromptInterior` merangkai `[INTERIOR_PROMPT_BASE., description., preset.promptFragment., PROMPT_GEOMETRY_GUARD.]` join spasi; polished menggantikan description + `interiorLightClause` di-append bila ada (pola Fase A).
- [ ] **Step 4: polish.ts** — ubah signature `polishScene(facts: SceneFacts | RoomFacts)` + `factsHash` sama; 1 test baru: RoomFacts diterima (mock chatText, flag on) & hash deterministik.
- [ ] **Step 5: Run semua → PASS** + tsc. Re-export dari index.ts (`analyzeRoom`, tipe `RoomFacts`, `compilePromptInterior`, `describeRoomFacts`).
- [ ] **Step 6: Commit** — `feat(ai-render): prompt interior + polish menerima RoomFacts`

---

### Task 3: Route — cabang `target=interior` + repo tulis target/roomId

**Files:**
- Modify: `src/app/api/v1/projects/[id]/renders/route.ts`, `src/lib/server/repo/renders.ts`, `src/lib/server/ai-render/view.ts`
- Test: `route.test.ts` (tambah; kasus lama TIDAK diubah), `renders.test.ts` (insert target/roomId)

**Interfaces:**
- Body: `target: z.enum(["exterior","interior"]).optional()` (absen = "exterior"), `roomId: z.string().min(1).optional()`.
- `createRenderJob` opts + `target?: string`, `roomId?: string` → kolom `target` (absen → biarkan DEFAULT via omit ATAU insert eksplisit 'exterior' — pilih insert eksplisit sekarang karena opts tersedia; sesuaikan test Task 1 Fase A TANPA mengubah assertion-nya? Assertion lama menegaskan `target` TIDAK ada di kolom INSERT — ubah PENDEKATAN: insert `target` HANYA bila `opts.target !== undefined`, dynamic column, sehingga test lama tetap valid).
- `RenderJobView` + `target: string`, `roomId?: string`.

- [ ] **Step 1: Failing tests.** (a) `target:"interior"` + `roomId` valid + pose → 201, provider.submit menerima prompt mengandung `"interior"` dan `createRenderJob` dipanggil dgn `target:"interior"`, `roomId`; (b) `target:"interior"` + roomId TIDAK ada di layout → 400 "Ruangan tidak ditemukan" DAN `spendCreditsOnce` TIDAK terpanggil; (c) `target:"interior"` TANPA roomId + pose DI DALAM ruang → 201 (deteksi); pose di LUAR semua ruang → 400; (d) `target:"interior"` tanpa pose → 400 (interior wajib pose); (e) kasus lama eksterior/sceneMeta tetap hijau tak tersentuh.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implementasi.** Di blok pra-spend (setelah cache-hit, tempat layout dimuat): bila `target === "interior"` → wajib `pose` (400 bila absen) → `layout` wajib ada (400 "Layout proyek belum tersimpan") → `roomFacts = analyzeRoom(layout, project.site, { roomId, pose })`; `null` → 400 "Ruangan tidak ditemukan" (SEMUA sebelum spend). Setelah spend, cabang prompt: interior → `compilePromptInterior(roomFacts, preset, await polishScene(roomFacts))`; teruskan `target` & `roomId: roomFacts.roomId` ke createRenderJob. Eksterior → jalur Fase A persis.
- [ ] **Step 4: Run → PASS** (route + renders test) + tsc.
- [ ] **Step 5: Commit** — `feat(ai-render): route target=interior -> analyzeRoom -> prompt interior`

---

### Task 4: Klien — kamera interior + UI pilih ruangan

**Files:**
- Modify: `src/stores/preview-store.ts`, `src/components/preview-3d/camera-rig.tsx`, `src/components/preview-3d/ai-render-dialog.tsx`, `src/lib/data/source.ts`
- Test: `ai-render-dialog.test.tsx` (kasus interior), store test bila ada idiomnya

**Interfaces:**
- Store: `interiorViewRoomId: string | null`, `interiorViewNonce: number`, `requestInteriorView(roomId: string): void` (pola persis `requestFocusRoom`).
- Dialog payload createRender + `target: "exterior" | "interior"`, `roomId?: string`.

- [ ] **Step 1: Failing dialog test** — mode Interior dipilih + ruangan dipilih → submit memanggil `requestInteriorView` dgn roomId, payload mutate memuat `target:"interior"` & `roomId`, dan `requestView` TIDAK dipanggil utk penempatan (restore boleh).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implementasi.**
  - Store: tambahkan state+action (bump nonce, set roomId) — meniru `requestFocusRoom` (preview-store.ts:308).
  - CameraRig: efek baru atas `interiorViewNonce` — ruang dicari dari `interiorViewRoomId`; `baseY` dari `floorElevations` (idiom efek fly-to-room persis, camera-rig.tsx:45-61); posisi kamera DI DALAM ruang: sudut ruang terjauh dari pusat diagonal → `pos = (cx - dx*0.35, baseY + SLAB_T + 1.5, cz - dz*0.35)` di mana (dx,dz) = vektor setengah-diagonal terpanjang; target = pusat ruang pada tinggi 1.3 m (`baseY + SLAB_T + 1.3`); `controls.target.set` + `update()` + `invalidate()`.
  - Dialog: state `target` ("exterior" default) + `roomId`; UI: dua tombol segmented (idiom tombol mode cepat/presisi yang sudah ada di dialog) + `<select>` ruangan bila interior — opsi dari `layout.rooms` digrup per lantai (prop `layout` sudah tersedia; kembali terpakai — hapus komentar "tak terbaca" Fase A), label `{room.name} — {floor label}`; skip tipe non-ruangan (`taman`, `kolam`, `void`, `tangga` boleh tetap masuk? SERTAKAN semua kecuali `taman`/`kolam`/`void`). Orkestrasi submit interior: simpan state seperti biasa; `requestInteriorView(roomId)`; paksa `setShowFurniture(true)` (simpan nilai lama, pulihkan di finally); settle 2×rAF+400ms; capture (pose otomatis = kamera interior); restore. `paramsHash`: `view = "interior:" + roomId` (atau poseKey utk sudut-ini-interior), `lighting` mengikuti preset seperti eksterior. "Sudut saat ini" + target interior → TANPA `requestInteriorView` (kamera user apa adanya), `roomId` TIDAK dikirim (deteksi server).
  - source.ts: perluas input createRender (`target?`, `roomId?`); http meneruskan otomatis; mock abaikan.
- [ ] **Step 4: Run → PASS** (`rtk vitest run src/components/preview-3d/ai-render-dialog.test.tsx`) + tsc penuh.
- [ ] **Step 5: Commit** — `feat(ai-render): UI interior per ruang + kamera eye-level otomatis`

---

### Task 5: E2E + verifikasi penuh

**Files:** `e2e/ai-render.spec.ts`

- [ ] **Step 1:** Kasus e2e baru (mock provider, pola kasus "Sudut saat ini" Fase A): buka dialog → pilih target Interior → pilih ruangan pertama → submit → hasil mock sukses muncul; bukti capture nyata = PUT upload `*-beauty.png` terjadi (idiom kasus Fase A).
- [ ] **Step 2:** `rtk playwright test e2e/ai-render.spec.ts` → semua pass.
- [ ] **Step 3:** `rtk tsc --noEmit` 0; `rtk vitest run` 0 fail; `rtk next build` 0 error.
- [ ] **Step 4: Commit** — `feat(ai-render): e2e interior + verifikasi fase B`

## Catatan untuk eksekutor

- Task 1 → 2 → 3 berurutan (kontrak); Task 4 butuh 3; Task 5 terakhir.
- JANGAN sentuh jalur eksterior Fase A, kredit/cache/webhook, `compilePrompt`/`compilePromptV2` yang ada (kecuali penambahan aditif yang plan ini sebut).
- Kandidat Fase C (JANGAN dikerjakan): occlusion modeling eksterior, deteksi ruang multi-lantai ambigu (split-level `levelOffsetM`).
