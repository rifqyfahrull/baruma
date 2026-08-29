# AI Render — Split-Level/Mezzanine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deteksi ruang, kamera interior, facts, dan hitungan lantai AI Render menjadi benar & kaya untuk lantai mezzanine (`Floor.kind:"mezzanine"`) dan split-level (`Room.levelOffsetM`).

**Architecture:** Perubahan terkonsentrasi di analyzer server (`analyze-room.ts`, `analyze.ts`), prompt (`prompt.ts`), dan satu efek klien (`camera-rig.tsx`). Tanpa perubahan route/DB/kontrak API. Spec: `docs/superpowers/specs/2026-08-29-ai-render-split-level-mezzanine-design.md` (baca penuh — semua formula & ambang ada di sana).

**Tech Stack:** sama dgn Fase A/B (TypeScript, Vitest, three.js klien).

## Global Constraints

- Semua konstrain Fase A/B berlaku (pure/deterministik, never-throw, komentar Indonesia, fragmen prompt Inggris).
- **Snapshot lama byte-identik** untuk layout TANPA mezzanine/levelOffsetM/void — fakta baru harus default-off sempurna.
- Resolver: pemenang = dasar efektif TERTINGGI (`elev.baseY + (levelOffsetM ?? 0)`); band top = `base + elev.floorToFloorM`; seri → urutan array; tak ada kandidat → `null`.
- `doubleHeight`: ruang `type:"void"` di lantai reguler berikutnya (stacking) dgn overlap denah ≥50% luas ruang ini.
- `mezzanineOverlooking`: hanya `floorKind:"mezzanine"`; ruang lantai INDUK (reguler terakhir sebelum mezzanine di array) dgn overlap terbesar (>0).
- Hitungan lantai eksterior & rooftop-detect memakai `isMezzanineFloor`/`isRooftopFloor` dari `@/lib/editor/floors` (verifikasi pure — sudah diimpor `vertical.ts` yang server-safe).
- Verifikasi per task `rtk vitest run <files>`; akhir: `rtk tsc --noEmit`, `rtk vitest run`, `rtk next build`, e2e `rtk playwright test e2e/ai-render.spec.ts`.

---

### Task 1: Resolver v2 + RoomFacts baru (`analyze-room.ts`)

**Files:** Modify `src/lib/server/ai-render/analyze-room.ts` + `analyze-room.test.ts`.

**Interfaces (Produces — dipakai Task 2):** `RoomFacts` bertambah `floorKind: "regular" | "mezzanine"`, `mezzanineOverlooking?: string`, `doubleHeight: boolean`, `levelOffsetM?: number`; `ceilingHeightM` kini per-lantai (`round1(elev.wallHM)`, double-height: `round1(wallHM + f2f lantai void)`).

- [ ] **Step 1 (test dulu):** fixture baru: lantai `lantai-1` (reguler, heightM 5.9 supaya mezzanine muat) + `lantai-mezz` (`kind:"mezzanine"`, `baseOffsetM: 2.8`, `heightM: 2.2`) + `lantai-2` (reguler) ; ruang `r-bawah` (lantai-1, ruang keluarga, rect besar), `r-mezz` (lantai-mezz, rect overlap sebagian r-bawah), `r-void` (lantai-2, `type:"void"`, rect overlap ≥50% r-bawah). Kasus: (a) kamera plan di overlap r-bawah∩r-mezz, y = baseY mezz + 1.5 → resolve `r-mezz` (platform tertinggi); (b) y = 1.5 → `r-bawah`; (c) ruang dgn `levelOffsetM: 1.2` — y 1.4 di bawah band tergeser → ruang lain/null sesuai fixture, y 2.0 → ruang itu; (d) facts `r-mezz`: `floorKind:"mezzanine"`, `ceilingHeightM = round1(2.2 − SLAB_T)`, `mezzanineOverlooking` = nama r-bawah; (e) facts `r-bawah`: `doubleHeight: true`, `ceilingHeightM` = wallHM lantai-1 + f2f lantai-2; overlap void <50% (fixture kedua) → false; (f) fixture LAMA (tanpa mezzanine) semua assertion existing tak berubah.
- [ ] **Step 2:** run → FAIL. **Step 3:** implementasi per spec (resolver v2, facts baru; `Floor.kind` absen = regular; gunakan urutan array utk induk mezzanine & lantai reguler berikutnya). **Step 4:** `rtk vitest run src/lib/server/ai-render/analyze-room.test.ts` PASS + tsc. **Step 5:** commit `feat(ai-render): resolver platform-tertinggi + RoomFacts mezzanine/split-level/double-height`.

### Task 2: Prompt (`describeRoomFacts`) label mezzanine + klausa baru

**Files:** Modify `src/lib/server/ai-render/prompt.ts` + `prompt.test.ts` (+snap).

- [ ] **Step 1 (test dulu):** snapshot baru ruang mezzanine (overlooking + ceiling rendah) & ruang double-height + assertion: output memuat `"on the mezzanine level, overlooking the ..."`, `"double-height ceiling"`, `"split-level, raised 1.2 m"` (fixture levelOffsetM 1.2) / `"lowered"` utk negatif; SEMUA snapshot lama byte-identik (fakta baru absen → klausa tak muncul).
- [ ] **Step 2:** FAIL → implementasi per spec (label lantai via `floorKind`; klausa dimensi + double-height; klausa split-level). **Step 3:** vitest prompt+polish PASS (polish tak berubah — RoomFacts tetap satu tipe) + tsc. **Step 4:** commit `feat(ai-render): prompt interior sadar mezzanine/double-height/split-level`.

### Task 3: Eksterior massing (`analyze.ts`)

**Files:** Modify `src/lib/server/ai-render/analyze.ts`, `analyze.test.ts`, `prompt.ts` (klausa massing) + snap bila perlu.

- [ ] **Step 1 (test dulu):** fixture 2 reguler + 1 mezzanine + rooftop → `massing.floors === 2`, `massing.hasMezzanine === true`; fixture lama tanpa mezzanine → `hasMezzanine false`, floors tak berubah; prompt massing memuat `"with a mezzanine level"` hanya bila true (snapshot lama utuh).
- [ ] **Step 2:** FAIL → implementasi: import `isMezzanineFloor`/`isRooftopFloor` dari `@/lib/editor/floors`; `floors = layout.floors.filter(f => !isMezzanineFloor(f) && !isRooftopFloor(f)).length || 1`; `hasRooftopDeck` juga beralih ke `isRooftopFloor` (id lama "floor-rooftop" tetap terdeteksi — fungsi itu menormalkan keduanya; verifikasi baca implementasinya). `SceneFacts.massing` + `hasMezzanine: boolean`; klausa massing di `describeSceneFacts`. **Step 3:** vitest analyze+prompt PASS + tsc. **Step 4:** commit `feat(ai-render): massing eksterior — mezzanine bukan lantai penuh + fakta mezzanine`.

### Task 4: Kamera interior (`camera-rig.tsx`) + verifikasi penuh

**Files:** Modify `src/components/preview-3d/camera-rig.tsx`; test via ekstraksi helper murni `interiorCameraPose(room, elev, exploded)` ke `src/lib/three/interior-camera.ts` (+test) yang dipakai efek — supaya matematika kamera akhirnya ber-unit-test (menutup catatan M5 Fase B).

- [ ] **Step 1 (test dulu):** `src/lib/three/interior-camera.test.ts` — helper murni: (a) ruang biasa → eye = baseY+SLAB_T+1.5; (b) `levelOffsetM 1.2` → +1.2; (c) mezzanine wallHM 2.05 → eye = platform + (2.05−0.3)=1.75 → clamp min(1.5,1.75)=1.5 tetap 1.5; wallHM 1.6 → eye = platform+1.3; target selalu < eye; posisi tetap di dalam rect (offset 0.35 half-diagonal — formula Fase B dipindah utuh).
- [ ] **Step 2:** FAIL → ekstrak helper (pindahkan formula dari camera-rig, tambah levelOffsetM+clamp), camera-rig memanggil helper. **Step 3:** `rtk vitest run src/lib/three/interior-camera.test.ts` PASS; e2e `rtk playwright test e2e/ai-render.spec.ts` 6/6; `rtk tsc --noEmit` 0; `rtk vitest run` penuh 0 fail; `rtk next build` 0. **Step 4:** commit `feat(ai-render): kamera interior sadar levelOffsetM + clamp plafon (helper teruji)`.

## Catatan eksekutor

Task 1 → 2 berurutan; Task 3 independen setelah 1 (menyentuh prompt.ts juga — kerjakan setelah Task 2 utk hindari konflik); Task 4 terakhir. Jangan sentuh route/DB/dialog.
