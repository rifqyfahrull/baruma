# SP6 — Perencanaan Struktur (perhitungan SNI) + 3D Realistis (web-PBR)

**Date:** 2026-07-04
**Status:** Design (awaiting review)
**Covers:** checklist poin **15 (Perencanaan Struktur Bangunan)** + **2 (Visualisasi 3D Eksterior Realistis)**. Sub-projek TERAKHIR (master roadmap). Satu siklus/branch (keputusan user), dua bagian independen (nol file bersama).

## Context

- **Struktur (poin 15) kini "catatan saja":** `structuralNotes(project)` (`src/lib/validation.ts`) hanya 2 `ValidationIssue` kaleng (lantai≥3, rooftop). RAB struktur = 3 baris **%-anggaran** (Pondasi&sloof, Kolom&balok, Plat lantai — `mock/rab.ts`), bukan teknik. Tak ada kolom/balok/pondasi sebagai elemen; tak ada input daya dukung tanah (σ); beban tak dimodelkan. Keputusan user (roadmap): **perhitungan teknik sungguhan** berbasis SNI disederhanakan untuk rumah ≤3 lantai.
- **3D (poin 2) kini skematik:** `preview-3d` merender prim box warna datar (`house-model.tsx` `meshStandardMaterial color` flat), **shadows dimatikan** (`house-scene.tsx` `shadows={false}`), tanpa tekstur/sky/envMap. `MATERIAL_PRESETS` (`lib/three/materials.ts`) = hex datar saja. three ^0.184 + @react-three/fiber ^9 + drei ^10 (r3f/drei tersedia; `@react-three/postprocessing` TIDAK terpasang).
- **Keputusan user (terkunci):** (1) satu SP6 besar; (2) RAB struktur **direbasis ke volume nyata** dari kalkulasi + tuntaskan **unifikasi footprint** (carry-over SP3/SP5); (3) tekstur PBR **prosedural runtime** (nol aset eksternal — drei Environment/HDRI CDN terlarang).

---

## BAGIAN A — Struktur (perhitungan SNI)

### Keputusan desain A

1. **Input σ (daya dukung tanah) baru: `DesignLayout.structural?: { soilBearingKPa: number }`** (JSONB, editable seperti `roof`; default absen = **150 kPa** [tanah sedang]). Editable di editor (inspector "Struktur", pola `RoofInspector`) + AI `setSoilBearing`. Batas UI 50–400 kPa (clamp defensif — PUT tanpa zod). Tanpa derivasi (tak seperti occupants); default masuk akal + terdokumentasi.

2. **Grid kolom diturunkan dari denah** (`lib/structural/grid.ts` `deriveColumnGrid(layout)`): footprint = building bbox (rooms non-rooftop, **helper footprint bersama** — lihat unifikasi §A6); bagi lebar & dalam jadi bentang ≤ `MAX_SPAN = 4.0 m` (jumlah kolom per sumbu = `ceil(dim/MAX_SPAN)+1`, jarak = dim/(n−1)); kolom di titik perpotongan grid (posisi absolut). Output: `{ columns: {x,y}[], spanX, spanY, nx, ny }`.

3. **Beban (SNI 1727:2020 disederhanakan, kg/m² → kPa):**
   - Mati (DL): lantai `DL_FLOOR = 5.0 kPa` (slab 0,15×24=3,6 + finishing 1,2 + partisi 1,5 ≈ dibulatkan), atap `DL_ROOF = 1.5 kPa`.
   - Hidup (LL): lantai hunian `LL_FLOOR = 2.0 kPa`, atap/teras `LL_ROOF = 1.0 kPa`.
   - Kombinasi ultimit `wu = 1.2·DL + 1.6·LL`; layan `ws = DL + LL`.

4. **Load takedown per kolom** (`lib/structural/takedown.ts`): luas tributari kolom = `spanX·spanY` (interior), ½ (tepi), ¼ (sudut) — v1 pakai tributari penuh `spanX·spanY` untuk semua (konservatif, disederhanakan; terdokumentasi). Beban kumulatif kolom = Σ per lantai di atasnya `Atrib × wu_lantai` (+ atap `Atrib × wu_atap`); layan analog. `Pu` (kN) & `Ps` (kN) per kolom terbawah.

5. **Dimensi kolom & balok (SNI 2847 pendekatan praktis):**
   - `f'c = 25 MPa`, `fy = 400 MPa`.
   - Kolom: `Ag_req = Pu·1000 / (0.33·f'c)` mm²; sisi = `max(150, roundUp50(√Ag_req))` mm (persegi). (0,33·f'c ≈ kapasitas aksial praktis kolom pendek berpengekang.)
   - Balok: tinggi `h = max(300, roundUp50(span·1000/12))` mm; lebar `b = max(150, roundUp50(h/2))` mm. (span/12 lendutan praktis balok menerus.)
   - Sloof: `150×200` mm standar (v1 tetap).

6. **Pondasi dari σ** (`lib/structural/foundation.ts`): telapak (footplat) tiap kolom `A_ftg = Ps / σ` m² (σ kPa = kN/m²); sisi = `roundUp(√A_ftg, 0.1)` m, min 0,8; tebal 0,25 m; rekomendasi jenis: `Ps` kecil & σ tinggi → footplat; σ rendah/`Ps` besar → catatan "pertimbangkan tiang pancang/strauss (konsultasi ahli)".

7. **`structuralNotes` di-upgrade** → `ValidationIssue[]` berbasis kalkulasi (mis. "Kolom terbebani X kN → 250×250 mm", "σ 150 kPa → telapak 1,2×1,2 m", "Bentang Y m > 4 m → tambah kolom/balok tinggi"), tetap `category:"structural"`.

8. **Sheet baru (Gambar Kerja + PDF), pola `sanitation-detail.ts`:**
   - **Rencana Pondasi** (F-01): denah grid kolom + telapak (persegi berdimensi per titik) + label ukuran + σ.
   - **Rencana Kolom** per lantai (K-01…): denah grid + penampang kolom + label dimensi + beban Pu.
   - **Rencana Balok** per lantai (B-01…): grid balok antar kolom + label b×h + bentang.
   - **Tabel Perhitungan Struktur** (ST-01): tabel (label bertumpuk — `Drawing` tanpa primitif tabel) asumsi (DL/LL/f'c/fy/σ), langkah (Atrib, wu, Pu, Ps, Ag, dimensi), hasil per elemen. **Disclaimer WAJIB verbatim:** *"Perhitungan pendekatan — wajib diverifikasi insinyur struktur berlisensi sebelum konstruksi (persyaratan PBG)."*

9. **RAB struktur direbasis ke volume nyata** (`mock/rab.ts`): ganti 3 baris %-anggaran →
   - "Pondasi telapak" volume = Σ volume telapak (m³) dari sizing; harga per m³ beton.
   - "Kolom beton" volume = Σ (Ag × tinggi lantai × jumlah) m³.
   - "Balok & sloof" volume = Σ (b×h × panjang bentang) m³.
   - "Plat lantai" volume = builtArea × 0,12 m³ (tebal plat).
   confidence medium; **UNIFIKASI FOOTPRINT**: satu helper `buildingFootprint(layout)` (bbox ruang non-rooftop) dipakai grid + RAB struktur + (selaraskan) baris atap/soakwell yang kini pakai `site.areaM2` — RAB atap/pondasi kini konsisten dgn gambar. Total RAB berubah; tes existing disesuaikan (bukan dilemahkan).

10. **AI parity:** aksi floorplan `setSoilBearing { soilBearingKPa }` (schema+clamp 50–400+describe+apply+prompt) — pola `setRoof`.

### Non-goals A (v1)
Analisis gempa/beban lateral dinamik (SNI 1726 penuh — hanya catatan); penulangan detail (jumlah/diameter tulangan — hanya dimensi penampang); portal/SAP analisis matriks; tiang pancang mendetail (hanya rekomendasi); tributari tepi/sudut tereduksi (pakai penuh konservatif).

---

## BAGIAN B — 3D Realistis (web-PBR eksterior)

### Keputusan desain B

11. **Shadows aktif:** `house-scene.tsx` `<Canvas shadows>` (PCFSoft default r3f); matahari `directionalLight castShadow` dgn frustum shadow-camera disetel ke bbox rumah; prim sudah `castShadow`/`receiveShadow` (kini efektif). Ground plane `receiveShadow`.

12. **Tekstur PBR prosedural** (`lib/three/textures.ts`, nol aset eksternal): fungsi generate `CanvasTexture` per material — dinding (plester halus + noise), lantai/tegel (grid nat + variasi), atap (genteng bergaris/sisik), kaca (halus reflektif). map + `roughnessMap`/`normalMap` prosedural (canvas → DataTexture/CanvasTexture). Di-memo (generate sekali). Fallback warna bila WebGL terbatas.

13. **`MATERIAL_PRESETS` diperluas:** tambah `roughness`, `metalness`, dan referensi tekstur prosedural per permukaan (wall/floor/roof/glass) tiap preset. `house-model.tsx`/`roof-geometry.tsx` `meshStandardMaterial` pakai map+roughness+metalness (base sudah standard material).

14. **Matahari + langit:** drei `<Sky>` prosedural (azimuth/elevasi) + state `preview-store` posisi matahari (slider di `preview-controls`) yang menggerakkan `<Sky>` sunPosition + arah `directionalLight`. Toggle "Realistis" (on/off — fallback ke mode datar kini untuk perangkat lemah).

15. **Bayangan lembut + AO:** drei `<SoftShadows>` (PCSS prosedural) atau `<ContactShadows>` di bawah bangunan; AO ringan via `aoMap` prosedural atau `<AccumulativeShadows>` (tanpa dep baru). Tanpa `@react-three/postprocessing` (SSAO = future).

16. **Scope: eksterior `/preview-3d` saja** (roadmap "3D eksterior realistis"). Interior scene (`interior-room-scene.tsx`, sudah punya shadows) = non-goal v1, menyusul.

### Non-goals B (v1)
SSAO/postprocessing (butuh dep baru); HDRI/envMap eksternal (terlarang); tekstur foto di-bundle (prosedural dulu); PBR interior; ray-tracing/GI; animasi matahari waktu-nyata.

---

## Deliverables ringkas

| # | Bagian | Artefak |
|---|---|---|
| A | Struktur | `layout.structural` (σ) + `lib/structural/{loads,grid,takedown,sizing,foundation}.ts` + sheets pondasi/kolom/balok/tabel-hitung + RAB rebasis + footprint bersama + editor inspector σ + AI setSoilBearing |
| B | 3D PBR | shadows aktif + `lib/three/textures.ts` prosedural + MATERIAL_PRESETS diperluas + `<Sky>`+posisi matahari + `<SoftShadows>`/AO + toggle Realistis |

## Testing
- **A pure:** deriveColumnGrid (jumlah/jarak kolom utk bbox contoh, bentang ≤4m); takedown (Pu/Ps per kolom, 2 lantai); sizing (Ag→sisi kolom, h/b balok, contoh Pu eksak); foundation (A_ftg=Ps/σ); RAB struktur volume nyata + footprint bersama konsisten; structuralNotes kalkulasi; sanitize setSoilBearing clamp 50–400.
- **B:** textures.ts (menghasilkan CanvasTexture non-null, dimensi); MATERIAL_PRESETS shape (roughness/metalness ada); preview-store sun state; render smoke (jsdom/mock r3f terbatas — utamakan unit pure + e2e).
- **E2E:** sheet Rencana Pondasi/Kolom + Tabel Perhitungan (teks /kN|Pu|telapak|PBG/); editor set σ → inspector; `/preview-3d` toggle Realistis → canvas tetap render (tanpa console error), slider matahari ada. Existing tak dilemahkan.
- **Gate penuh:** tsc · vitest · build · **Playwright FULL**.

## Sequencing (≈14 task; A dulu lalu B)
**A:** T1 σ type+store+editor+AI → T2 `loads.ts`+konstanta → T3 `grid.ts` deriveColumnGrid → T4 `takedown.ts` → T5 `sizing.ts` (kolom+balok) + `foundation.ts` → T6 sheets pondasi/kolom/balok + tabel-hitung → T7 sheet-list + halaman/PDF → T8 structuralNotes + RAB rebasis + **footprint bersama** → **B:** T9 shadows + sun `<Sky>` + preview-store posisi matahari + controls → T10 `textures.ts` prosedural + MATERIAL_PRESETS diperluas → T11 house-model/roof-geometry pakai tekstur + `<SoftShadows>`/AO + toggle Realistis → T12 e2e + gate penuh + review akhir.

## Self-review
**Coverage:** poin 15 (A: T1-T8), poin 2 (B: T9-T11), RAB (T8), e2e (T12). **Placeholder:** tidak ada — σ default+batas, DL/LL, f'c/fy, MAX_SPAN, rumus Ag/h/b/A_ftg, disclaimer, sumber tekstur, komponen drei dipatok. **Konsistensi:** footprint bersama (grid↔RAB↔atap); disclaimer verbatim = pola SP5; sheet-list auto page↔PDF. **Risiko:** (A) kebenaran kalkulasi + liabilitas → disclaimer wajib (pola terbukti SP5); footprint rebasis ubah RAB total & ~tes existing → task sendiri (T8) dgn penyesuaian tes; Drawing tanpa tabel → label bertumpuk (pola sanitation). (B) tekstur prosedural di bawah aturan aset → nol eksternal; performa shadow di GPU lemah → toggle Realistis + fallback datar + SceneBoundary.
