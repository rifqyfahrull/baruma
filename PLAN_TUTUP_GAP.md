# Rencana Teknis — Menutup Gap Fasad (Cantilever & Porthole)

> Rencana eksekusi untuk 2 gap P1 di `TODOS.md`. Belum ada perubahan kode.
> Dibuat 2026-08-09. Referensi kode terverifikasi via pembacaan langsung.

Legenda: **MVP** = dampak-visual tinggi, risiko rendah, tak menyentuh geometri inti · **Full** = akurat dari segala sudut, menyentuh `build-model.ts`.

---

## Gap 1 — Jendela bulat / Porthole (ref #4, #11)

### Kondisi sekarang (terverifikasi)
- `Opening` (`src/types/index.ts`) sudah punya `kind?: OpeningKind` + `modelUrl` + `frameMaterial/frameColor`. **Tidak ada** field bentuk.
- `OpeningKind` union (`src/types/index.ts` ~L428) — belum ada `porthole`.
- Visual per-kind di `src/lib/three/opening-visuals.ts` (`openingVisualSpec`, switch `case`).
- Mesh daun/kaca digambar di `src/components/preview-3d/house-model.tsx` (~L1502, `OpeningMesh`, membaca `prim.opening`).
- Lubang dinding dibuat di `src/lib/three/build-model.ts` via `openingSegment` (`src/lib/geometry/index.ts:192`) + `subtractRectHoles` → **selalu persegi**.
- Gambar kerja elevasi: `src/lib/drawings/elevation.ts` menggambar bukaan.

### Track A — MVP (rekomendasi pertama)
Porthole sebagai **visual bundar di dalam lubang persegi kecil** (dari tampak depan sudah terbaca bundar; lubang kotak di belakang tak terlihat).

Langkah:
1. `src/types/index.ts` — tambah `"porthole"` ke `OpeningKind`.
2. `src/lib/three/opening-visuals.ts` — `case "porthole"`: purpose `vision`, operation `fixed`, hint bentuk bundar (mis. `shape: "round"` di spec bila perlu field baru di return type).
3. `src/components/preview-3d/house-model.tsx` (`OpeningMesh`) — bila `kind==="porthole"`: render **bingkai torus + kaca disc** (`CircleGeometry`/`RingGeometry`) alih-alih rect frame; diameter = `min(widthM, heightM)`. Kaca transparan seperti window lain.
4. `src/lib/drawings/elevation.ts` — bila porthole, gambar **lingkaran** (bukan rect) di elevasi supaya gambar kerja konsisten.
5. UI: pastikan `porthole` muncul di picker jenis bukaan (opening inspector — `src/components/inspector/opening-inspector.tsx`, cek daftar `OpeningKind` yang ditawarkan).
6. Opsi: tawarkan porthole di template `brick_gable_roster`/`japandi` sebagai bukaan aksen kecil.

Test:
- Unit: `openingVisualSpec("porthole")` mengembalikan spec valid.
- Unit `elevation.ts`: porthole menghasilkan primitive lingkaran.
- (Opsional) snapshot certification-visual bila porthole dipakai di scene.

Sentuhan: ~4–5 file · **risiko rendah** (tak mengubah pemotongan lubang). Lubang tetap kotak kecil di balik disc — kompromi sadar.

### Track B — Full (lubang bundar sejati)
1. `src/lib/three/build-model.ts` — untuk `porthole`, ganti lubang persegi dengan **aproksimasi lingkaran** (poligon N-gon / cincin box mengelilingi kaca) pada dinding host; sisakan "dinding penuh − cakram".
2. Sesuaikan header/sill logic (porthole tak butuh header lintel persegi).
3. Validasi: porthole tak boleh lebih besar dari tinggi dinding; sill+diameter ≤ wallH.

Sentuhan: `build-model.ts` (modul geometri inti 1988 baris) · **risiko medium-tinggi** (regresi pemotongan dinding). Lakukan hanya setelah MVP terbukti dipakai.

---

## Gap 2 — Cantilever (lantai atas menjorok, ref #1, #5, #14)

### Kondisi sekarang (terverifikasi)
- `Floor` = `{ id, level, name, heightM }` (`src/types/index.ts`) — **tanpa offset**.
- Semua lantai berbagi satu `footprint = buildingFootprint(layout)` (`src/lib/structural/grid.ts`), dipakai di loop `layout.floors.forEach((floor, i) => ...)` (`build-model.ts:588`).
- Penutupan bidang bawah (soffit) untuk lubang tangga/dak sudah ada (mesin `roof-holes.ts` + parapet) — pola yang bisa dicontoh untuk menutup soffit overhang.
- Ada elemen eksterior box (`canopy/planter/slab`) via `makeBoxElement` (`src/lib/exterior/factories.ts`), sudah dirender.

### Track A — MVP kosmetik: elemen "overhang slab" (rekomendasi pertama)
Tambah **1 kind box eksterior** yang membaca sebagai tepi lantai atas menjorok di atas carport/teras — tanpa mengubah massa lantai.

Langkah:
1. `src/lib/schemas/layout.ts` — tambah `"overhang_slab"` ke enum box exterior (grup `facade_panel/canopy/planter/...`).
2. `src/types/exterior.ts` — tambahkan ke union kind box (ikuti `canopy`).
3. `src/components/preview-3d/house-model.tsx` — render sama seperti `canopy`/`slab` (box datar tebal), default material beton/putih, posisi z di ketinggian pelat lantai atas.
4. `src/lib/exterior/factories.ts` — dukung di `makeBoxElement` (kemungkinan sudah generik).
5. Wire ke template `cantilever_wood_slat`: ganti `canopy` menjorok → `overhang_slab` selebar carport pada `zM ≈ tinggi lantai 1`, memberi kesan lantai atas menjorok.
6. UI: muncul otomatis di inspector eksterior (list kind).

Test: `facade-templates.test.ts` — template `cantilever_wood_slat` menghasilkan elemen `overhang_slab`; tak ada NaN.

Sentuhan: ~4–5 file · **risiko rendah**. Catatan jujur: ini **kosmetik** (bukan massa lantai sungguhan) — ruang di lantai atas tetap sesuai footprint bawah.

### Track B — Full: `Floor.offset` (massing sungguhan)
1. `src/types/index.ts` — `Floor.offsetM?: { dx: number; dy: number }` (default 0).
2. `src/lib/schemas/layout.ts` — validasi offset (batas mis. ≤ 1.5 m, tak melebihi lebar carport).
3. `src/lib/three/build-model.ts` — saat membangun lantai ber-offset: geser posisi ruang/dinding/slab lantai itu sebesar `offsetM`; hitung **footprint efektif per-lantai** (bukan satu global).
4. **Tutup soffit** bidang bawah bagian yang menjorok (tak ada lantai di bawahnya) — pakai pola penutup slab/parapet yang sudah ada di `roof-holes.ts`/logika dak.
5. `src/lib/structural/grid.ts` — `buildingFootprint` jadi sadar-offset (union footprint semua lantai) agar atap/struktur/RAB ikut benar.
6. Editor UI — kontrol offset per-lantai (mis. di panel lantai / inspector), plus indikator di denah.
7. Validasi struktural — peringatan bila cantilever > batas wajar tanpa kolom penopang.
8. Update konsumen footprint: `elevation.ts` (tampak), `sheet-list.ts` (gambar kerja), RAB (`rab.ts`).

Sentuhan: schema + `build-model.ts` + `grid.ts` + editor + validasi + drawings/RAB · **risiko medium, scope besar**. Butuh test regresi 3D + drawings menyeluruh. Kandidat pekerjaan tersendiri (1 PR fokus).

---

## Urutan yang disarankan

1. **Porthole MVP** (Gap 1 Track A) — cepat, sangat kelihatan, risiko rendah.
2. **Overhang-slab element** (Gap 2 Track A) — melengkapi kesan cantilever di template.
3. Evaluasi pemakaian nyata → baru pertimbangkan **Full** (lubang bundar sejati / `Floor.offset`) sebagai PR terpisah dengan test regresi geometri.

## Prinsip eksekusi
- Tiap track = commit sendiri, dengan test yang gagal-dulu-lalu-hijau.
- Jangan gabung MVP + Full dalam satu PR (Full menyentuh geometri inti; MVP tidak).
- Setelah tiap track selesai, tandai di `TODOS.md` dan update `ANALISA_FASAD_RUMAH_DEPAN.md` §0.
