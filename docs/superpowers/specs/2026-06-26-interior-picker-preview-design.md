# Spec — Bagian 3: Preview 3D di Katalog Picker

- **Tanggal:** 2026-06-26
- **Status:** Disetujui
- **Modul:** Interior Design / 3D Preview (picker)
- **Branch:** `feat/interior-3d-models`

## 1. Tujuan
Di panel "Tambah furniture", saat user mengarahkan (hover) atau men-fokus (keyboard) sebuah
item katalog, sebuah **panel 3D mini** menampilkan **model asli** item itu (GLB/prosedural),
berputar pelan, sehingga user bisa melihat bentuknya sebelum menaruh. Klik item tetap menambah
ke ruang seperti sekarang.

## 2. Non-Tujuan
- Thumbnail per item (grid gambar) — tidak; satu preview bersama yang berubah saat hover.
- Tidak mengubah logika tambah/cari furniture yang sudah ada.
- Tidak ada pipeline render PNG.

## 3. Arsitektur

### 3.1 Reuse pipeline model (Bagian 1)
`export` `GlbModel` dari `src/components/preview-3d/furniture-model.tsx` agar preview memakai
ulang loader + normalisasi (bbox→fit) yang sama, tanpa duplikasi.

### 3.2 Komponen baru — `src/components/preview-3d/furniture-preview.tsx` (`"use client"`)
- `PreviewModel({ furnitureId, category, dims, color })`: pakai `resolveFurnitureSource({furnitureId, category})`:
  - `glb` → `<Suspense fallback={<ProceduralFurniture/>}>` + `<GlbErrorBoundary fallback={procedural}>` membungkus `<GlbModel url dims/>` (model duduk di y=0, center x/z).
  - `procedural` → `<ProceduralFurniture archetype dims color/>`.
  - `box` → mesh box (sama seperti FurnitureModel).
  (Fallback archetype = `archetypeForCategory(category) ?? "generic"`.)
- `FurniturePreview({ item }: { item: FurnitureItem | null })`:
  - Jika `item` null → placeholder kecil ("Arahkan ke furnitur untuk pratinjau").
  - Jika ada → `<Canvas>` mini (1 konteks WebGL) berisi: pencahayaan (ambient + 1 directional +
    hemisphere ringan), `<PreviewModel furnitureId={item.id} category={item.category}
    dims={{w:item.widthM, d:item.depthM, h:item.heightM}} color={...}/>` dibungkus `<Suspense>`,
    dan `<OrbitControls autoRotate autoRotateSpeed={1.2} enableZoom={false} enablePan={false}
    target={[0, item.heightM/2, 0]}/>`. Kamera di-set jarak ∝ `max(w,d,h)` melihat ke center.
  - Tinggi panel kecil (mis. ~150px), `dpr={[1,2]}`, `gl={{ alpha: true }}` (background transparan).
- Komponen di-`dynamic(ssr:false)`-kan jika perlu (sudah berada di subtree `ssr:false`, tapi
  pastikan tidak SSR `<Canvas>`).

### 3.3 Integrasi — `FurnitureQuickAdd` ([interior-workspace.tsx:315](../../../src/components/interior/interior-workspace.tsx#L315))
- State `previewItem: FurnitureItem | null`.
- Tiap tombol item: tambah `onPointerEnter={() => setPreviewItem(item)}` dan
  `onFocus={() => setPreviewItem(item)}` (a11y keyboard). `onMouseLeave` panel tidak mereset
  (biar stabil).
- Render `<FurniturePreview item={previewItem ?? visible[0] ?? null}/>` **di atas grid** item
  (default = item pertama yang tampil). Berlaku untuk varian `compact` (sidebar 3D) & penuh.
- Warna model preview pakai helper warna yang ada (mis. `interiorFurnitureColor`-style per kategori,
  atau warna netral konsisten).

## 4. Error & performa
- GLB gagal/loading → fallback prosedural (sama seperti scene); placeholder saat tak ada item.
- 1 canvas preview tambahan; mount hanya saat picker tampil; model lazy (Suspense); auto-rotate
  via OrbitControls (tanpa render-loop manual berat). Tidak meng-crash picker (ErrorBoundary GLB).

## 5. Testing (e2e benar-benar diuji)
- **Unit/smoke**: `furniture-preview.test.tsx` — `FurniturePreview` & `PreviewModel` ter-export
  sebagai fungsi (cegah error import/JSX/circular). `resolveFurnitureSource` sudah teruji.
- **Type/build**: `npx tsc --noEmit` 0; `npm run build` sukses.
- **E2E (Playwright)**: di `/app/projects/proj-demo-8x8/preview-3d`, buka panel tambah furniture,
  hover sebuah item katalog → pastikan **muncul canvas preview** (jumlah `canvas` ≥ 2, atau ada
  testid preview) **tanpa console error**; suite lama tetap hijau. File `e2e/interior-picker-preview.spec.ts`.

## 6. Risiko
- Dua canvas pada satu halaman: aman (≤ limit konteks). Jika perangkat lemah, preview tetap punya
  fallback dan tidak memblokir picker.
- Reuse `GlbModel` lewat export — pastikan tidak menimbulkan import siklik (furniture-preview →
  furniture-model; furniture-model tidak mengimpor preview).
- a11y: hover + focus dua-duanya memicu preview.
