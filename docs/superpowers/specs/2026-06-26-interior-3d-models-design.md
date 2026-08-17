# Spec — Realistic Furniture Rendering in 3D (Hybrid GLB + Procedural)

- **Tanggal:** 2026-06-26
- **Status:** Disetujui (user mendelegasikan eksekusi penuh)
- **Modul:** Interior Design / 3D Preview
- **Branch:** `feat/interior-3d-models` (di atas `feat/interior-persistence`)

## 1. Masalah & Tujuan

Furnitur di 3D preview saat ini digambar sebagai **box polos** berwarna
([house-model.tsx:159](../../../src/components/preview-3d/house-model.tsx#L159)) — kasur, sofa,
lemari semuanya kotak. User ingin furnitur **terlihat realistis** (model 3D), dan
mendukung **import file .glb** yang dia sediakan, tanpa membuat tampilan rusak/kosong.

**Tujuan (Bagian 1 — render saja):**
- Furnitur dirender sebagai model 3D, bukan kotak, dengan **3 lapis sumber**:
  GLB (jika ada file terdaftar) → model **prosedural** bergaya per kategori → box.
- **Seamless**: model GLB apa pun otomatis dinormalisasi agar pas footprint ruang,
  duduk di lantai, dan menghadap sesuai rotasi — tanpa setting manual per file.
- **Tidak pernah blank / tidak pernah crash**: loading & error punya fallback berlapis.
- Performa terjaga (lazy, cache, dukungan Draco) meski file besar (test file 18–33 MB).
- Interaksi yang ada (klik pilih, hover cursor, highlight seleksi, label) **tetap jalan**.

**Non-Tujuan (spec terpisah berikutnya):**
- Drag mulus di 3D (tarik pakai mouse) — Bagian 2.
- Katalog picker dengan thumbnail — Bagian 3.
- Ganti warna tembok / keramik / pintu — modul desain permukaan terpisah.
- Scene ruangan utuh (`appartement.glb`, `alte163_chodba_v2.glb` bukan furnitur tunggal →
  tidak didaftarkan; di luar scope).

## 2. Aset uji yang tersedia

`public/models/` (disediakan user): `bed.glb` (1.9MB → kasur), `cute_little_armchair_-_kc002…glb`
(18MB → kursi/seating untuk uji), `appartement.glb` & `alte163_chodba_v2.glb` (scene utuh,
di luar scope). Test mapping awal: `queen-bed → /models/bed.glb`,
`sofa-3-seat → /models/cute_little_armchair_-_kc002_3d_model.glb`. Sisa item → prosedural.

## 3. Arsitektur

Tiga unit murni + satu komponen render + satu titik integrasi:

```
furniture-models.ts   resolveFurnitureSource(item) -> {kind:'glb',url} | {kind:'procedural',archetype} | {kind:'box'}
fit-transform.ts      computeFitTransform(bbox, target) -> {scale, position}   (pure math)
furniture-procedural.tsx  <ProceduralFurniture archetype dims/> -> primitives composed to dims
furniture-model.tsx   <FurnitureModel item position selected onSelect/> -> GLB|procedural|box + fallback + selection
house-model.tsx       replace inline furniture <mesh> block with <FurnitureModel/>
```

### 3.1 Resolver — `src/lib/three/furniture-models.ts`
- `FURNITURE_MODEL_REGISTRY: Record<string /*furnitureId*/, string /*url*/>` — hanya item ber-GLB.
- `CATEGORY_ARCHETYPE: Record<FurnitureCategory, Archetype>` — pemetaan kategori → archetype
  prosedural (`seating | bed | table | wardrobe | cabinet | appliance | kitchen | bathroom | decor_flat | generic`).
- `resolveFurnitureSource(item: { furnitureId; category })`:
  GLB terdaftar → `{kind:'glb',url}`; else archetype dikenal → `{kind:'procedural',archetype}`;
  else `{kind:'box'}`.
- `preloadRegisteredModels()` memanggil `useGLTF.preload(url)` untuk tiap url (dipanggil sekali di sisi klien).

### 3.2 Fit math — `src/lib/three/fit-transform.ts` (pure, unit-tested)
- `computeFitTransform(bbox: { size:[x,y,z]; center:[x,y,z] }, target: { w; d; h }): { scale:number; position:[x,y,z] }`
  - skala **uniform** = min(target.w/size.x, target.h/size.y, target.d/size.z) (jaga proporsi, muat dalam footprint).
  - position menggeser agar pusat x/z model di 0 dan **alas (y) menempel 0** (`-center*scale`, dengan y dasar = `-(center.y - size.y/2)*scale`).
  - guard size 0 → scale 1.

### 3.3 Procedural archetypes — `src/lib/three/furniture-procedural.tsx`
- Komponen `<ProceduralFurniture archetype dims={{w,d,h}} color />` mengembalikan `<group>` berisi
  primitif yang dirakit **pas ke dims** (origin: pusat x/z, alas y=0). Archetype:
  - `seating`: alas + sandaran + 2 lengan + bantal duduk.
  - `bed`: rangka rendah + matras + 1–2 bantal.
  - `table`: papan atas + 4 kaki.
  - `wardrobe`/`cabinet`: body + garis pintu + 2 gagang.
  - `appliance`: body membulat + panel (kulkas/mesin cuci) atau layar tipis (TV via heuristik id).
  - `kitchen`: counter + kabinet bawah + backsplash.
  - `bathroom`: heuristik per id (shower frame / vanity+mirror / toilet) — fallback box bila tak yakin.
  - `decor_flat`: lembaran tipis (karpet/sajadah).
  - `generic`: box membulat.
- Warna default mengikuti `interiorFurnitureColor(item)` yang sudah ada (palette konsisten);
  material `meshStandardMaterial` (roughness tinggi) selaras gaya scene.

### 3.4 `<FurnitureModel>` — `src/components/preview-3d/furniture-model.tsx`
Props: `{ item: PlacedFurniture; position:[x,y,z]; rotationDeg; selected; onSelect; onHover }`.
- Bungkus dalam `<group position rotation={[0, -rotationDeg*π/180, 0]}>`.
- `resolveFurnitureSource(item)`:
  - **glb**: `<Suspense fallback={<ProceduralFurniture .../>}>` membungkus `<GlbModel url dims/>`.
    `GlbModel` pakai `useGLTF(url)`, **clone** scene (drei `<Clone>` atau `scene.clone(true)`),
    hitung `THREE.Box3` → `computeFitTransform` → terapkan `scale`+`position` pada group dalam.
    Dibungkus **ErrorBoundary** → on error render `<ProceduralFurniture/>`.
  - **procedural**: `<ProceduralFurniture/>`.
  - **box**: `<mesh><boxGeometry/></mesh>` (perilaku lama).
- **Interaksi**: mesh/group menerima `onClick` (stopPropagation → onSelect), `onPointerOver/Out` (cursor).
- **Seleksi**: saat `selected`, render **selection cage** — wireframe box tipis di footprint
  (`<lineSegments>` dari `EdgesGeometry(BoxGeometry(w,h,d))`, warna `SHARED_COLORS.selected`).
  Robust untuk GLB & prosedural (tak bergantung material).
- **Draco**: konfigurasi sekali — `useGLTF` dengan decoder lokal dari
  `three/examples/jsm/libs/draco/` (disalin ke `public/draco/`); file non-draco tetap jalan.

### 3.5 Integrasi — `src/components/preview-3d/house-model.tsx`
- Ganti blok `roomPlan.furniture.map(... <mesh><boxGeometry/>...)` ([:148–198](../../../src/components/preview-3d/house-model.tsx#L148))
  dengan `<FurnitureModel item position rotationDeg selected onSelect onHover/>`, mempertahankan
  perhitungan `pos` & label `Html` yang sudah ada. `sceneFurnitureHeight/YOffset` tetap dipakai
  untuk box-fallback dims; GLB/prosedural pakai dims item (w×d×h) langsung dengan alas di `slabTopY`.
- `preloadRegisteredModels()` dipanggil sekali (efek di `HouseScene`/`HouseModel`).

## 4. Error handling & performa
- **Loading**: Suspense fallback = prosedural (bukan blank). Scene tetap interaktif.
- **Gagal load / GLB rusak**: ErrorBoundary per item → prosedural. `SceneBoundary` global tetap jaring akhir.
- **File besar**: lazy (hanya mount untuk lantai/ruang tampil — sudah ter-gate), `useGLTF` cache per-URL,
  Draco didukung. Spec menyertakan langkah **menyalin draco decoder ke `public/draco/`**; rekomendasi
  kompresi (gltf-transform) dicatat sebagai opsional (pipeline tak menunggu).
- **Instansi**: clone per penempatan agar transform tak saling memengaruhi.

## 5. Testing (e2e benar-benar diuji)
- **Unit (vitest)**:
  - `fit-transform.test.ts`: skala uniform benar (muat footprint, jaga proporsi), alas y=0, guard size 0.
  - `furniture-models.test.ts`: urutan resolver glb→procedural→box; registry & archetype mapping.
  - `furniture-procedural` sizing: archetype menghasilkan bounding box ≈ dims (uji via fungsi pembangun murni / smoke).
- **Build**: `npm run build` 0 error; `npx tsc --noEmit` 0 error.
- **E2E (Playwright, suite sudah ada di `e2e/`)**:
  - Extend/ tambah test di `e2e/critical-flows.spec.ts` (atau file baru `e2e/interior-3d-models.spec.ts`):
    buka `/app/projects/proj-demo-8x8/preview-3d`, pastikan `canvas` render (atau fallback) **tanpa
    console error**, tambah furnitur ber-GLB (Kasur Queen → bed.glb), pastikan scene tetap render,
    ambil **screenshot artifact** (`e2e/artifacts/preview-3d-glb.png`).
  - Jalankan seluruh suite e2e + unit → semua hijau (tanpa regresi pada test interior yang ada).
- **Verifikasi visual**: screenshot Playwright disimpan untuk ditinjau pagi hari.

## 6. Risiko & catatan
- Kualitas prosedural subyektif → archetype dibuat konservatif (silhouette jelas, proporsi benar,
  palette konsisten) dan diverifikasi lewat screenshot.
- WebGL headless: e2e sudah menangani `canvas OR fallback`; GLB diverifikasi via "tidak crash + tidak ada
  console error + screenshot", bukan pixel-match.
- Draco decoder disalin ke `public/draco/`; jika tak ada file draco-compressed, jalur normal tetap jalan.
- `appartement.glb`/`alte163_chodba_v2.glb` tidak didaftarkan (scene utuh, bukan furnitur).
