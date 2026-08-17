# Baruma — Panduan Arsitektur & Fitur (Engineering Guide)

> Dokumen ini untuk engineer baru: menjelaskan **konsep aplikasi, arsitektur, model data, katalog fitur, konvensi/jebakan, dan batasan**. Pelengkap [PRD.md](./PRD.md) (visi produk) & [API.md](./API.md) (kontrak endpoint).
>
> ⚠️ Baca juga [AGENTS.md](../AGENTS.md): **ini Next.js versi baru** — API/konvensi bisa beda dari yang kamu hafal; cek `node_modules/next/dist/docs/` sebelum menulis kode Next.
>
> Update engineering terbaru dicatat di [CHANGELOG.md](./CHANGELOG.md).

---

## 1. Apa itu Baruma

Baruma adalah **SaaS desain rumah/arsitektur berbasis web** — anak produk dari **tampil.dev** (akun Mayar & Supabase dibagi). Prod: `https://baruma.tampil.dev`, repo `rfq13/baruma`, **auto-deploy saat push ke `main`**.

**Target utama (paling penting):** memungkinkan **orang awam menghasilkan desain & arsitektur rumah yang advance/keren dengan MUDAH** — bukan photorealistic rendering, bukan hand-coding geometri. Semua fitur harus:
- Menutup use-case lapangan arsitek/desainer nyata ("ini bukan projek mainan").
- Terintegrasi penuh: **3D ↔ 2D ↔ RAB ↔ Gambar Kerja** membaca satu sumber kebenaran (`DesignLayout`).
- Mudah dari editor 3D (banyak fitur punya "quick-add" 1-klik).

Alur user tipikal: buat proyek → isi brief (dibantu AI) → lihat alternatif layout → edit **denah 2D** → **preview 3D** (fasad, atap, interior) → **RAB** → **Gambar Kerja** → export contractor pack.

---

## 2. Tech Stack & Arsitektur

| Lapisan | Teknologi |
|---|---|
| Framework | **Next.js 16** (App Router), TypeScript |
| UI | shadcn/ui + Tailwind CSS |
| Form | React Hook Form + Zod |
| Server state | **TanStack Query** (`src/lib/api/hooks.ts`) |
| Client state | **Zustand** (3 store: editor, preview, interior) |
| 2D editor | **SVG** (`src/components/editor/plan-canvas.tsx`) |
| 3D | **React Three Fiber / three.js** (r184) + drei |
| Auth | **Supabase SSO** (di-broker via tampil.dev) |
| Storage | S3-compatible (rustfs, `storage.tampil.dev`) via aws4fetch |
| Billing | **Mayar** (shared account tampil.dev) |
| Deploy | GitHub Actions → SSH ke droplet, migration seed di CI |

### 2.1 Data layer yang bisa ditukar

Kontrak data ada di **`src/lib/data/source.ts`** (interface `DataSource`). Dua implementasi:
- **Mock** (`src/lib/mock/`) — in-memory, dev/demo.
- **HTTP** (`src/lib/data/http.ts`) — backend eksternal (API asli).

Pemilihan: `NEXT_PUBLIC_DATA_SOURCE=http` paksa HTTP; `=mock` paksa mock; else HTTP iff `NEXT_PUBLIC_API_URL` di-set (default = mock in-memory). Seluruh UI (via TanStack hooks) berjalan identik di mock (local/e2e, tanpa DB/Supabase) atau backend HTTP — swap satu env flag. `http.ts` melempar `ApiError(msg, status, code)` (branch kode error billing). **PENTING:** di prod = HTTP (backend), jadi logika yang hanya ada di `src/lib/mock/` (mis. RAB detail kolam/MEP) **belum tentu tampil di prod** — lihat §8.

**Hooks** (`api/hooks.ts`): tiap hook bungkus satu method `data.*`; UI tak pernah sentuh mock/http langsung. Pola: `useLayout`/`useInterior` `staleTime:Infinity` (jangan clobber edit lokal); `useIngestionJob` poll 2s sampai terminal; `useGenerateAlternatives` re-invalidate bertahap (LLM enrich ~40s). Auth, storage, deploy: §4.15 & §7.

### 2.2 Tiga Zustand store

- **`editor-store.ts`** — sumber kebenaran `DesignLayout` yang diedit + undo/redo (immer `commit()`). Semua mutasi denah lewat sini. Aksi utama (§3.3).
- **`preview-store.ts`** — state **view 3D** (seleksi opening/dinding/atap/lampu/railing/ruang, visibilitas lantai, mode malam, studi matahari, preset material, exploded). Seleksi quick-editor saling eksklusif.
- **`interior-store.ts`** — rencana interior (furnitur per ruang, material, lighting, budget) + undo/redo sendiri.

### 2.3 Pipeline 3D (inti)

**`src/lib/three/build-model.ts` → `buildModel(layout, site, project, opts)` → `{ prims, labels, height }`.** Modul **murni** (tanpa import three.js) — data box (`Prim`) yang di-render R3F jadi mesh. `Prim = { id, kind: PrimKind, floorId, roomId?, pos, args, tint?, opening?, ... }`.

- `PrimKind`: `slab | tile | garden | pool | wall | riser | door | window | furniture | roof | roof_gable | roof_hip | roof_skillion | fascia | rail | rail_glass | louver | stair | exterior`.
- Renderer: **`src/components/preview-3d/house-model.tsx`** memetakan tiap prim → mesh, meng-handle klik (edit-dari-3D), material per-ruang, hover lokal.
- **`frameloop="demand"`** (GPU idle saat statis); `ScreenshotBridge` untuk screenshot headless.
- **Z-fighting** diselesaikan `assignDepthRanks()` (spatial-bucketing 3D lintas-lantai) → `polygonOffset`, BUKAN menggeser geometri.

**⚠️ PrimKind exhaustive switches:** menambah `PrimKind` WAJIB menambah case di `build-model.ts`, `surface.ts` (baseColor + surfaceForKind), dan exports/glb baseColor — kalau tidak, build gagal. Kind `exterior` membawa owner `ExteriorElement`, optional polygon, rotation, material/model reference, dan tetap diekspor sebagai geometry semantic/fallback.

---

## 3. Model Data (`DesignLayout`)

Satu proyek punya satu `DesignLayout` (di-version). Semua fitur (2D/3D/RAB/gambar) membacanya.

```ts
DesignLayout = {
  id, projectId, versionId
  floors: Floor[]           // {id, level, name, heightM}. id konvensi: "floor-1", "floor-2", "floor-rooftop"
  rooms: Room[]             // unit ruang (lihat §3.1)
  walls, openings: Opening[] // pintu/jendela pada tepi ruang
  stairs: Stair[], pools: Pool[]  // (legacy array; tangga/kolam KINI = Room type "tangga"/"kolam")
  roof?: RoofSpec           // {type: datar|pelana|limasan|miring, slopeDeg, overhangM, material, lowSide?, fascia?}
  rooftopArea?              // rect deck parsial; absent = dak penuh footprint
  rooftopRailingStyle?, rooftopRailingModelUrl?  // railing DAK (dak bukan Room)
  facade?: Record<wallId, claddingId>       // cladding muka LUAR per dinding
  facadeInner?: Record<wallId, claddingId>  // aksen muka DALAM
  facadeElements?: FacadeElement[]          // louver_band | slat_horizontal | roster_screen
  exteriorLamps?, electrical?, water?, sanitation?
  structural?: { soilBearingKPa }
  validation: ValidationResult
}
```

### 3.1 `Room` & `RoomType`

`RoomType`: `kamar_tidur, kamar_mandi, ruang_tamu, ruang_keluarga, dapur, ruang_makan, musholla, laundry, gudang, balkon, rooftop_lounge, area_kumpul, kolam, taman, workspace, carport, void, tangga`.

**OPEN_TYPES** (tanpa dinding, render terbuka): `kolam, taman, carport, balkon, rooftop_lounge, void`.

`Room` selain geometri (x, y, width, depth, floorId, areaM2) membawa field spesifik-tipe:
- **balkon**: `railingStyle` (kaca/besi/tembok/kayu) + `railingModelUrl`/`railingModelAssetId` (GLB kustom).
- **kolam**: `poolKind` (renang/plunge/anak/spa), `poolDepthM`, `poolFinish` (keramik_biru/mozaik_hijau/pebble_gelap/batu_alam).
- **tangga**: `stairDirection` (arah naik n/s/w/e).
- Umum: `zoneId`/`zoneIds` (open-plan → drop dinding antar-ruang sezona), `levelOffsetM` (split-level).

### 3.2 Konvensi geometri penting

- **wallId** = `` `${roomId}:${side}` `` (side = n/s/w/e).
- **Aturan dedupe dinding:** dinding batas dimiliki ruang di sisi **utara/barat** garis (dinding s/e-nya). Strip di atas/bawah bukaan (`wh-`/`ws-`) harus membawa id+side **ruang pemilik**, bukan ruang seberang (kalau salah → "tembok di atas pintu beda sendiri").
- **Footprint bangunan** = bbox semua ruang non-rooftop (`buildingFootprint()` di `structural/grid.ts`) — dipakai atap/slab/RAB agar tidak seluas kavling.
- **Stacking lantai 3D:** `floorStep = WALL_H(2.8) + SLAB_T(0.15)`. Rooftop **bertumpu** di atas lantai reguler teratas (bukan satu tingkat di atasnya). `Floor.heightM` **dipakai gambar kerja 2D tapi DIABAIKAN di 3D** (3D selalu floorStep tetap) — lihat §8.

### 3.3 Aksi editor-store (kapabilitas mutasi)

Semua undo-aware. Rooms: `addRoom, updateRoom, dragRoomTo, dragResize, deleteSelected, toggleLock`. Elemen: `addOpening, updateOpening, dragOpeningResize`, `addPool, addStair, addRooftopTerrace, addWallLamp, updateLamp`, `addElectricalPoint/addWaterPoint (+move/update/remove)`, `setSanitation`. Fasad/atap: `setWallCladding, applyFacadePreset, addFacadeElement/update/remove, setRoof, setRooftop, setRooftopArea, setRooftopRailingStyle, setRooftopRailingModel`. Floors: `addFloor, removeFloor, setSelectedFloor`. Lain: `setSoilBearing, toggleDimensions, setDimensionUnit, undo, redo`.

---

## 4. Katalog Fitur

### 4.1 2D Editor denah (`/editor`)

SVG `plan-canvas.tsx` + toolbar. Tambah ruang (palet semua `RoomType`, termasuk Kolam/Tangga/Void), gambar dinding & bukaan (pintu/jendela — klik untuk melubangi), titik **listrik** & **air** (tab), **dimensi** (overlay dimensi berdimensi metrik/imperial yang diturunkan otomatis dari tepi ruang — toggle di toolbar), drag/resize dengan **snap** & alignment, undo/redo. Inspector ruang (kanan) mengatur field spesifik (mis. arah tangga, railing balkon, level split).

### 4.2 3D Preview (`/preview-3d`) — panel kontrol kaya

Mesin: `buildModel` → `HouseModel`. **Banyak fitur punya editor "klik elemen di 3D" + quick-add.** Ringkasan:

**Material & tampilan:** preset material (`materials.ts`), mode **Realistis/Sederhana**, **mode malam** (jendela memancar cahaya hangat), **studi matahari** (lintasan & bayangan nyata dari kota/jam/tanggal — `solar.ts`, 29 kota; "Putar sehari"), exploded view, toggle visibilitas per lantai, **paket foto** (multi-shot render).

**Fasad (§4.3), Atap+Rooftop (§4.4), Bukaan (§4.5), Railing (§4.6), Kolam (§4.7), Tangga (§4.8), Lampu+Listrik (§4.9), Furnitur/interior (§4.10)** — detail di bawah.

### 4.3 Fasad (klik dinding di 3D)

- **Cladding per dinding** — 11 material (batu alam/andesit, marmer krem/carrara, granit, beton ekspos, kayu ×3, bata ekspos/putih) via `facade-claddings.ts`; muka luar & dalam terpisah (`facade`/`facadeInner`).
- **Gaya Fasad 1-klik** — 4 preset (`facade-presets.ts`: dua-tona modern, minimalis putih, tropis kayu, batu mewah) yang orkestrasi cladding + louver seluruh muka.
- **Kisi / roster fasad** (`FacadeElement`, menonjol di muka luar, menutup beberapa jendela): **`louver_band`** (sirip vertikal), **`slat_horizontal`** (bilah horizontal), **`roster_screen`** (grid = krawangan/breeze-block). 3 finish (kayu/aluminium gelap/putih). Render sebagai prim `louver` (tanpa PrimKind baru).
- **Facade Composer / frontage native** — tiga template customer-facing menghasilkan portal, panel vertikal, canopy, pagar/gate, driveway/walkway, planter, serta komposisi cladding/roster sebagai semantic actions. Template mengganti template-owned elements tetapi mempertahankan exterior manual dan dicatat sebagai satu undo entry.
- **Parity exterior** — `lib/three/exterior-primitives.ts` menurunkan `exteriorElements` ke Preview 3D; `lib/exterior/projection.ts` menjadi proyeksi denah/elevasi; `lib/exterior/quantities.ts` + `rates.ts` memasok RAB traceable. Custom GLB mengganti visual envelope, bukan quantity atau identity.

### 4.4 Atap & Rooftop (klik atap di 3D)

- **Tipe atap:** `datar | pelana | limasan | miring(skillion)` + `slopeDeg`, `overhangM`, `material`, **lis fascia** (band tepi gelap), skillion `lowSide` (arah air).
- **Rooftop dak:** toggle "Rooftop (dak beton)" (menambah `floor-rooftop`). **Cakupan:** penuh (dak menutupi seluruh atap → atap miring ditekan) vs **sebagian** (`rooftopArea` — dak di sebagian, atap pelana/limas menutupi sisanya via `rooftopStrips`). Tombol **"Jadikan rooftop sebagian"** (`defaultDeckArea`).
- **Teras rooftop** furnishable: **"+ Ruang teras"** → `rooftop_lounge` room (bisa diisi furnitur di editor Interior).
- **Railing dak** (§4.6). ⚠️ **Jebakan:** dak/teras/railing digate pada `hasRooftopFloor` (LAYOUT), tapi `project.rooftop` adalah flag terpisah yang bisa **divergen** (Rumah Qyfa: layout punya rooftop, flag proyek false). Toggle rooftop hanya mengubah layout.

### 4.5 Bukaan pintu/jendela (klik bukaan di 3D)

Kind/operasi/kusen (material+warna), **shading** (overhang/vertical_fin/screen/secondary_skin), privasi, `sillHeightM`/`headHeightM`. **Model GLB kustom** (`modelUrl` — ganti daun) & **gorden/tirai** (`curtainModelUrl` — overlay di sisi dalam jendela, tidak mengganti kaca, di-fit overhang, `interiorSign` menentukan sisi dalam).

### 4.6 Railing (balkon + dak rooftop) — paritas penuh

Gaya **Kaca/Besi/Tembok/Kayu** + **Model GLB kustom** dari My Library (di-tile keliling). **Balkon**: per-Room (`railingStyle`/`railingModelUrl`), muncul saat klik railing ATAU **pilih ruang balkon**. **Dak rooftop**: bukan Room → disimpan di layout (`rooftopRailingStyle`/`rooftopRailingModelUrl`), diedit dari panel Atap "Railing dak" / klik railing dak / pilih ruang di lantai rooftop. Prim railing dak ber-`roomId = ROOFTOP_RAIL_ID` (sentinel, agar clickable) & `floorId = "floor-rooftop"` (ikut sembunyi saat lantai rooftop di-hide).

### 4.7 Kolam renang (fitur lengkap "sesuai lapangan")

- **Kustom:** tipe (renang/plunge/anak/spa — masing-masing rentang kedalaman), kedalaman, finish (warna air). Klik air kolam di 3D → PoolQuickEditor. **"Tambah kolam"** penempatan pintar: halaman terbesar (site−footprint) → dak rooftop (kalau lahan penuh, mis. Qyfa → plunge di dak) → footprint. Render air **recessed** depth-aware + **coping** (bibir batu).
- **Perairan/sirkulasi** (`pool-circulation.ts`): volume→turnover→debit→pompa(HP)→filter pasir(Ø)→skimmer/inlet/main-drain→Ø & panjang pipa + **denah pipa skematik (SVG)**.
- **Kelistrikan** (`pool-electrical.ts`): pompa(kW)→MCB, lampu bawah air 12V + trafo, bonding ekipotensial. **Beban pompa+lampu otomatis masuk hitungan daya PLN** (`deriveApplianceLoads`).
- RAB kolam itemized (struktur, pompa/filter/pipa/fitting, panel/lampu/bonding) — **catatan: di mock RAB; prod pakai backend** (§8).

### 4.8 Tangga (akses antar-lantai)

Ruang tipe `tangga` render anak tangga solid + handrail naik ke lantai atas. **Kunci:** slab lantai di atasnya **dilubangi otomatis** di sekitar tangga (`subtractRectHoles` di `geometry/slab.ts`) — dulu slab satu box padat = tangga naik ke plafon buntu. `void` room melubangi slab lantainya sendiri (atrium). Tombol **"Tambah tangga"** di panel 3D (butuh ≥2 lantai). Posisi & arah diatur di 2D editor.

### 4.9 Lampu eksterior, listrik & PLN

Lampu editable (klik → warna/intensitas/tinggi/model GLB) `lamps.ts`. Titik listrik/air + **jalur kabel/pipa**, watt/beban → **daya PLN tersarankan** + estimasi energi/bulan + RAB listrik (`electrical/costing.ts`) — detail engine di §4.12 (MEP).

### 4.10 Interior (`/interior`)

Editor interior per ruang: katalog furnitur (search + kategori), material per permukaan (lantai/dinding/plafon), lighting, **budget** per ruang & total, moodboard. Furnitur bisa **model GLB** (My Library / upload). Denah 2D interior + preview 3D room + drag/rotate/snap-ke-dinding. **Catatan:** panel "Tambah furniture" inline dihapus dari Interior Editor & panel 3D — furnitur ditambah via **"Tambah Model 3D Kustom"** / My Library / sheet Furniture Library di Inspector.

### 4.11 Gambar Kerja / Working Drawings (`/drawings`, `src/lib/drawings/`)

**Kontrak** (`drawings/types.ts`): tiap builder = **fungsi murni `DesignLayout → Drawing`**. `Drawing` = data renderer-agnostic dalam **meter, y-UP** (`{ widthM, heightM, lines[], labels[], dims[], levels[], title }`). Renderer SVG/PDF membalik y & skala ke sheet fisik (A3, 1:50/100/200/500 via `pickSheetScale`). **Catatan kontrak: tidak ada primitif tabel/style/text-align** — tabel ditiru dari label bertumpuk + grid garis.

**Registry** (`sheet-list.ts` `buildSheetList`) = sumber tunggal untuk halaman interaktif & PDF pack; enumerasi sheet per lantai reguler, urutan e2e-gated: Denah `D-*` → Tampak `A-01..04` → Potongan `A-05/06` → Kusen `K-*` → Pola Lantai `L-*` → Plafon `C-*` → Listrik `E-*` → Air `P-*` → Riser `P-R` → Sanitasi `S-*` → Struktur (pondasi/kolom/balok/kalkulasi) → Detail Atap `R-01`.

Jenis gambar (tiap punya `*.test.ts`):
- **Denah** (`layout-sheet.ts`) — tampak atas per lantai: outline ruang, label, bukaan, anak tangga+arah NAIK, railing balkon, kanopi carport, louver fasad (mirror prim 3D).
- **Tampak** (`elevation.ts`) — siluet ortografis per sisi n/s/e/w; proyeksi footprint, oklusi bukaan, profil atap (`roofProfile`: pelana/limasan/skillion), fasad. **`floor.heightM` diakumulasi untuk tinggi lantai** (beda dari 3D!).
- **Potongan** (`section.ts`) — cross-section pada `cutX/cutY` (slider di halaman); mirror tampak.
- **Rencana Listrik** (`electrical-plan.ts`) — simbol lampu/titik, relasi saklar→lampu, homerun Manhattan dari panel, tabel skedul panel dari `buildCircuits`.
- **Rencana Plafon** (`ceiling-plan.ts`) — tinggi plafon = `floor.heightM − 0.4 + levelOffsetM`, material, simbol lighting.
- **Kusen** (`kusen.ts` skedul + `kusen-plan.ts` denah kode + `kusen-sheets.ts` detail parametrik dengan arc ayun pintu).
- **Pola Lantai** (`floor-pattern.ts`) — grid nat sesuai ukuran keramik + hitung pcs (+10% waste).
- **Detail Atap** (`roof-detail.ts`) — potongan setengah bentang (kuda-kuda/king-post) atau build-up dak; partial rooftop → denah atap ringkas di atasnya.
- **Rencana Air** (`plumbing-plan.ts`), **Diagram Riser** (`riser-diagram.ts`, skematik), **Sanitasi** (`sanitation-detail.ts`: septic/soakwell/bak kontrol, ukuran dari `water/sanitation.ts` — konsisten dgn RAB, + `SNI_DISCLAIMER`).
- **Struktur** (`structural-plan.ts` pondasi/kolom/balok + `structural-calc.ts`) — proyeksi dari modul struktur (§4.12), `STRUCT_DISCLAIMER`.

**Partial rooftop & split-level** dipusatkan di `elevation.buildPartialRoof` (dipakai tampak+potongan) & `roof-detail.partialRoofPlan`; `levelOffsetM` dihormati tampak/potongan/plafon. `normalize()` menggeser geometri agar tak ke-clip origin negatif.

### 4.12 RAB / BOQ (`/rab`, `src/lib/mock/rab.ts` + `src/lib/rab/`)

**Prinsip:** RAB & gambar kerja **memanggil fungsi yang sama** (modul murni di `structural/`, `electrical/`, `water/`, `three/pool-*`) agar angka estimasi tak menyimpang dari gambar. `generateRAB(project, brief, layout, finishingOverride?) → RAB`.

**Kategori biaya:** `struktur, arsitektur, plumbing, listrik, finishing, kolam, rooftop`. Tiap `BOQItem`: volume dibulatkan 0,1; total ke ribuan; **unit price di-back-compute** (`total/volume`) agar rekonsiliasi pas. Tiap baris punya `confidence` (low/medium/high).

**Volume dari layout:** built area = Σ `room.areaM2`; **footprint bangunan** (bbox non-rooftop) menggerakkan atap & struktur (bukan seluas kavling); atap = footprint × faktor slope (datar ×1,1; miring `(1/cos)·1,15`, di-clamp `effectiveRoof`); partial rooftop hanya menagih strip beratap; kolam & dak rooftop dari modul masing-masing.

**Finishing:** standar 3,5jt/m² · menengah 5jt · premium 7,5jt (`base = builtArea × perM2`).

**Struktur pakai volume beton NYATA** (bukan % budget): pondasi telapak, kolom, balok+sloof, plat lantai — dari pipeline `deriveColumnGrid → columnLoad → sizeColumn/sizeBeam → sizeFooting`. Kusen dari `kusenSchedule/kusenPrice` (satu-satunya baris `high`). Listrik & kolam itemized bila dimodelkan (else fallback %).

**Summary** (`rab/summarize.ts`): `mid = Σ`, `low = mid×0,88`, `high = mid×1,15`; recompute dari unitPrice×volume saat user edit manual. **Export** (`rab/export-rab.ts`): `.xlsx` (SheetJS lazy) + print-to-PDF HTML.

**Batasan:** harga hardcoded Jabodetabek 2026 (bukan price-DB live); layout PUT tak ada zod → semua baca defensif.

#### MEP & struktur (modul murni pendukung)
- **Listrik** (`electrical/costing.ts`): `deriveApplianceLoads` (beban rumah tangga per tipe ruang + **pompa/lampu kolam**) → `totalVA` (demand 0,7 × margin 1,25) → `recommendedPlnVA` (tier PLN [900…11000]) + estimasi kabel Manhattan + energi/bulan (tarif 1444,7/kWh). `circuits.ts`: 1 penerangan + 1 stopkontak + 1 khusus per titik daya, `mcbFor(va)`.
- **Air** (`water/`): `WATER_SYSTEM` (bersih/kotor/limbah), `PIPE_DIAMETER` (SNI 8153), `autoGenerateWater`; sanitasi (`sanitation.ts`): `sizeSepticTank` (SNI 2398, dari okupan), `sizeSoakwell` (SNI 8456, dari roofArea), `sizeControlBoxes`, `autoSizeSanitation` (+ `placeAvoidingObstacles`).
- **Struktur** (`structural/`): `loads.ts` (DL/LL, MAX_SPAN 4m, SOIL_DEFAULT 150 kPa), `grid.ts` (`buildingFootprint`, `deriveColumnGrid` — bay ≤4m), `takedown.ts` (`columnLoad` tributary penuh, konservatif), `sizing.ts` (`sizeColumn`/`sizeBeam`), `foundation.ts` (`sizeFooting`, deep-note bila area >4m²). Semua SNI disederhanakan (satu balok representatif, kolom seragam) — confidence `medium`.

### 4.13 Brief, Alternatif, Review & AI Assistant (SNI-aware)

**Prinsip AI (penting):** **mesin deterministik menghitung SEMUA; LLM hanya merangkai kalimat/routing.** Tiap perubahan geometri di-re-validasi ke scene nyata + standar SNI sebelum boleh masuk layout. Output LLM tidak pernah dipercaya untuk geometri — di-sanitize (id/angka di-clamp ke scene), disimulasikan, di-re-validasi, baru di-apply lewat store undo-aware **setelah user tekan "Terapkan"**.

- **Brief** (`lib/brief/build-brief.ts`): transform murni dari wizard → brief (spaceProgram, constraints, risks, assumptions). **AI Brief chat** (`server/brief-assistant.ts`, credit-gated) menjawab dari **audit nyata** (`summarizeAuditForPrompt(auditDesign())`), bukan "vibes".
- **Design-Audit engine** (`lib/audit/`, **murni, 0-LLM, read-only**): `auditDesign({project,layout,brief}) → {score 0–100, findings[]}`. Cek: luas/lebar ruang vs `ROOM_STANDARDS` (SNI 03-1733), cahaya (rasio jendela ≥10%), sirkulasi (pintu ≥0,8m), struktur, sanitasi, regulasi (KDB/KLB/GSB), kelengkapan program. Kartu **"Cek Standar"** selalu tampil (proaktif, baca store live).
- **Auto-fix trilogi** (`auto-fix.ts` → `reflow.ts` → `fix-all.ts`): (1) perbesar ruang & tambah jendela; (2) **reflow** (geser tetangga yang menghalangi, hanya bila tetangga tetap SNI-compliant); (3) `collectSafeFixes` = "perbaiki semua" (jalan berurutan di scene yang di-re-simulate).
- **Editor AI Assistant** (`lib/assistant/` + `server/editor-assistant.ts`): mengusulkan **actions** terstruktur (~35 tipe floorplan + interior, zod schema = sumber tunggal). Pipeline request: (1) short-circuit audit-intent (gratis), (2) handler deterministik keyword-match (`deterministic.ts`, gratis, verifikasi ke ruang kosong nyata via `findFreeRect`), (3) **build-dari-kosong** (`server/initial-floorplan.ts` → `buildInitialFloorplan`, gratis): scene tanpa ruang + intent "buat denah"/"denah N lantai" → susun ruang dari brief secara deterministik, **dipasang di BOTH route `/agent` dan `/editor/assistant`** (parity; sebelumnya hanya editor — itulah sebabnya "buatkan denah sesuai brief" di panel 3D gagal/klarifikasi asing), (4) credit gate + `runFloorplanAgentPass` (satu pass konsolidasi: 1x LLM propose → reconciler geometris deterministik `reconcileOverlappingRooms`/`reconcileFloorplanOverlaps` [tanpa biaya LLM] → maksimal 1x revisi LLM → reconcile lagi → **menolak** dengan pesan manusiawi (`humanizeViolations`, tanpa koordinat mentah) kalau tetap melanggar). Worst-case 2x panggilan LLM sekuensial, bukan 3x.
- **Unified Project AI Agent** (`/api/v1/projects/[id]/agent`, `project-agent.ts`, `ProjectAgentShell`): satu thread persisten per proyek untuk **Brief + Denah + Interior**, dipasang sekali di project layout sehingga riwayat/input bertahan saat navigasi. Orchestrator memilih runner lama berdasarkan context chip, intent, lalu surface; tidak memakai satu prompt raksasa. Scene live hanya menang bila project/version cocok, selain itu dibangun dari layout/interior persisted. Turn memakai `clientRequestId` + lease dan credit ledger idempoten. Proposal diterapkan **all-or-nothing** dan dikompresi menjadi satu langkah Undo; action stale membatalkan seluruh batch.
- **Review** (`/review`, `mock/review.ts` + `server/repo/review.ts`): warning agregat (risks brief + `validation.issues` + biaya-vs-budget + catatan izin PBG), checklist per-role (arsitek/engineer_struktur/mep/kontraktor/pbg_legal), AI summary, comment thread.
- **Validasi layout** (`lib/validation.ts`): `validateLayout` cek out-of-bounds (danger), ruang <4m², ventilasi, rooftop-di-luar-deck, overlap, sanitasi-di-bawah-ruang (severity dari `sanitationOverlapSeverity` — **satu sumber**, dipakai audit + assistant juga). `passed=false` hanya bila ada `danger`.

### 4.14 Aset 3D & pipeline SKP→GLB

- **My Library** (`/asset-library`): upload **GLB** (hanya .glb — `.skp` DITOLAK di app), ingestion (validasi, scale, metadata), kategori. **Aset global (is_public)** = katalog Baruma **read-only** untuk non-owner (flag `editable`). 150+ aset furnitur global + rumah referensi (`building_reference`).
- **Import .skp:** butuh konversi offline. Pipeline dev di `D:/tmp/blender-skp/` (Blender 3.6 headless + addon sketchup_importer): `batch_in_process.py` (copy-first ke scratch, hindari gotcha path/serialisasi) → GLB (Draco) → thumbnail QA → kurasi (bbox 0,05–8 m). GLB **TIDAK pernah di-commit ke git** (object storage = sumber kebenaran; `public/models/*.glb` gitignored, deploy download sebelum build).
- **Import rumah jadi proyek editable:** SKP→GLB→upload `asset-library/global/buildings/` → `generateLayout(project,brief)` (template) + `generateInteriorPlan` via harness vitest sekali-pakai → **migration seed** (§9). Denah = TEMPLATE (model sumber monolitik tanpa partisi ruang), GLB asli = aset referensi. Contoh live: 3 rumah Koleksi 3 (`proj-k3-*`).

### 4.15 Auth, Billing & Admin

**Auth — Supabase SSO via tampil.dev** (`lib/supabase/`): sesi cookie berbagi domain `.tampil.dev` (`NEXT_PUBLIC_AUTH_COOKIE_DOMAIN`) → login di salah satu app meng-auth keduanya. `middleware.ts` (`updateSupabaseSession`) refresh token + guard: `/app/*` → redirect `/login` bila belum login; `/login`+`/register` guest-only; `/reset-password` sengaja tak di-guard. Self-heal cookie `sb-*` korup. **OAuth Google & recovery di-broker via `NEXT_PUBLIC_SSO_ORIGIN`** (tampil.dev) karena PKCE butuh callback di origin awal; login email/password native. **Turnstile** (captcha) hanya saat `NEXT_PUBLIC_TURNSTILE_SITE_KEY` ada. **Guard `/api`** (middleware tak cover /api): `requireUser` = Bearer JWT (HS256, `BARUMA_JWT_SECRET`, 30d) ATAU cookie Supabase → `resolveBarumaProfile`.

**Billing — Mayar** (`lib/billing/`, port dari tampil.dev, **satu merchant account**): `providers/mayar.ts` `createCheckout` (harga dari DB `getPlan().priceIdr`, order id prefix `brm-`) + `parseWebhook` (verifikasi token `timingSafeEqual`, idempoten via `UPDATE ... WHERE status='pending'`). `POST /api/checkout` (requireUser) + `POST /api/webhooks/payment` (gate token saja, semua non-token error di-swallow 200 anti retry-storm). Billing **manual-renew** (tanpa auto-recurring); reminder di `/app/billing`.

**Admin** (`/app/admin`, `server/auth-server.ts`): gate `isAdminEmail` (profile `role='admin'` ATAU `ADMIN_EMAILS` allowlist) — **`requireAdmin` selalu re-fetch profile dari DB**, session role UI-only tak dipercaya, fail-closed. Tab Plans/Transaksi/Users; route `/api/v1/admin/*` semua requireAdmin. Users tab punya Phantom Login: admin membuat JWT target user berdurasi pendek lewat `/api/v1/admin/users/phantom-login`, membuka tab baru dengan token di URL fragment, lalu tab itu menyimpan token di `sessionStorage` dan mengirimnya sebagai Bearer untuk API. Cookie Supabase admin tetap global, tetapi sesi phantom hanya hidup di tab yang menyimpan token tersebut.

**Pricing** (`lib/pricing.ts` display-only; `server/repo/plans.ts` + `plan-defaults.ts`): plan **DB-driven** (Free Rp0/10 kredit, Pro Rp149k/100 kredit featured, Studio Rp499k/500 kredit), `entitlements` (creditsPerPeriod, maxProjects, exportPdf, glbUpload). Kredit: handler deterministik + audit gratis; hanya LLM call yang spend 1 kredit (refund bila gagal).

---

## 5. Konvensi & Jebakan (WAJIB tahu)

1. **PrimKind exhaustive switch** — tambah kind → update build-model + surface.ts (baseColor+surfaceForKind) + glb baseColor, atau build gagal.
2. **Aturan dedupe dinding** & **strip bukaan** (§3.2) — salah owner = tembok di atas pintu "beda sendiri".
3. **snap-to-wall:** `WALL_T=0.12`, batas ruang = centerline dinding; `WALL_FACE_INSET_M=0.06` agar item nempel muka dalam; `isWallHangingItem` + `defaultWallMountHeight` auto-lift dekor tipis (jam/lukisan).
4. **frameloop="demand"** — GPU idle saat statis; jangan bikin animasi tak sadar re-render.
5. **hover lokal** (RoomTilePrim leaf) & **FurnitureLayer** subscribe store sendiri — cegah reconcile seluruh pohon prim tiap pointermove.
6. **rooftop `project.rooftop` vs `hasRooftopFloor`** (§4.4) — selalu gate visual rooftop ke LAYOUT (hasRooftopFloor).
7. **`ROOFTOP_RAIL_ID`** sentinel roomId — dak bukan Room; jangan pakai id Room asli.
8. **GLB-out-of-git** — jangan commit .glb; upload storage + `scripts/sync-catalog-models.mjs`.
9. **`round1` TIDAK diekspor** dari `@/lib/geometry` (hanya `round2`) — definisikan lokal.
10. **RTK** (global CLAUDE.md): prefix perintah shell dengan `rtk` untuk hemat token.

---

## 6. Testing & Gates

Sebelum push (WAJIB, standing rule): **`rtk tsc` (0 error) · `npx vitest run` (semua hijau) · `npx next build` (OK)**. ~1600+ unit test (`*.test.ts` kolok dengan sumbernya). e2e Playwright di `e2e/` (TIDAK di gate deploy). Push `main` = auto-deploy.

---

## 7. Deploy & Storage

**Deploy** (`.github/workflows/deploy.yml`): push `main` → GitHub Actions SSH ke droplet (`concurrency: baruma-deploy`): fetch+reset `origin/main` → tulis `.env.local` (validasi `AUTH_SECRET`/`DATABASE_URL`/`BARUMA_JWT_SECRET`) → `pnpm install` → **`sync-catalog-models.mjs download`** (tarik GLB/tekstur SEBELUM build) → `next build` → **`node scripts/migrate.mjs`** → `pm2 restart baruma` (:3000) + nginx (:80→:3000, buffer besar utk cookie Supabase, timeout 300s utk AI) → smoke test 200.

**Migrasi** (`scripts/migrate.mjs`): `db/migrations/*.sql` diterapkan urut nama, tiap file 1 transaksi, tracked di **`schema_migrations`** (jalan sekali). Error "sudah ada" (SQLSTATE 42P07 dll.) di-**baseline** (dicatat, tak re-run); error lain → exit non-zero **memblokir deploy**. Kini 0001…0016 (0013/0015 = data seed; 0016 = unified Agent turn/idempotency).

**Seed data ke prod:** DB pusat **TIDAK bisa di-reach dari mesin dev** (VPC/tailnet timeout; dbBaruma MCP read-only) → tulis via **migration seed** (idempotent, `where exists (profiles)`, `on conflict do nothing`, jsonb dollar-quoted `$tag$`, cek tag anti-collision). CI/droplet yang punya `DATABASE_URL` menerapkannya saat deploy.

**Storage GLB** (`server/storage.ts`, aws4fetch, bucket private): key `uploads/<userId>/<projectId>/…` (privat) atau `asset-library/<slug>/(buildings|furniture)/…` (katalog global read-only). **Proxy route** `/api/v1/assets/file/[...key]` = satu-satunya gerbang (middleware skip /api): GET `requireUser` + cek owner; PUT `requireUser` + `requirePlanFeature("glbUpload")` + cap 100MB. **GLB tak pernah di-git** (`public/models/*.glb` gitignored); `sync-catalog-models.mjs` (upload/download/check) jembatani; deploy download sebelum build.

### 7.1 Env vars kunci

| Env | Guna |
|---|---|
| `NEXT_PUBLIC_DATA_SOURCE`, `NEXT_PUBLIC_API_URL` | swap mock↔HTTP + base API |
| `DATABASE_URL` | Postgres (data + migrasi) |
| `BARUMA_JWT_SECRET` | JWT API HS256 (30d) |
| `NEXT_PUBLIC_SUPABASE_URL`, `_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase Auth (shared tampil.dev) |
| `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN` (`.tampil.dev`), `NEXT_PUBLIC_SSO_ORIGIN` | cookie cross-subdomain + broker OAuth/recovery |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | captcha (opsional) |
| `STORAGE_ENDPOINT`/`_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`/`_BUCKET`/`_PUBLIC_URL`/`_REGION` | object storage GLB/tekstur |
| `AGENT_LAB_URL`, `AGENT_LAB_KEY` | Koneksi Baruma ke Agent Lab; provider/model/provider-key hanya dikonfigurasi di Agent Lab |
| `MAYAR_API_BASE_URL`/`_API_KEY`/`_WEBHOOK_TOKEN` | billing |
| `ADMIN_EMAILS` | allowlist admin bootstrap |

**Layanan eksternal:** Supabase Auth (via SSO tampil.dev), Cloudflare Turnstile, Google OAuth (brokered), object storage S3-compatible (R2/RustFS), Agent Lab (satu-satunya gateway LLM), Mayar (pembayaran), droplet (pm2+nginx), GitHub Actions.

---

## 8. Batasan & Gap Diketahui

- **Denah 3D vs Gambar Kerja tinggi lantai:** `Floor.heightM` dipakai gambar 2D tapi **diabaikan 3D** (floorStep tetap 2,95 m). Lantai 2/rooftop dgn tinggi custom tampil beda antara 2D & 3D.
- **RAB detail kolam/MEP baru di mock** (`src/lib/mock/rab.ts`); **prod pakai backend API**, jadi rincian itu belum tampil di RAB prod. Yang tampil di prod = spec/denah client-side di panel.
- **Impor rumah = denah TEMPLATE** (generateLayout), BUKAN floorplan asli model SKP (mesh monolitik tanpa partisi — ekstraksi floorplan tidak viable jangka pendek). GLB asli disimpan sebagai referensi.
- **Import .skp otomatis di app** belum ada (butuh Blender di server + antrian). Konversi masih offline.
- **Tangga** di ruang terbuka masih dapat 4 dinding otomatis (belum ada opsi "tangga terbuka"); posisi/arah masih diatur di 2D.
- **Fasad multi-massa** (bangunan banyak massa) belum ada.
- **Loose-end:** dead code `FurnitureQuickAdd` + 4 e2e spec (`preview-3d-interior-add`) perlu diarahkan ke alur furnitur baru; `preview-controls.tsx` sempat ter-reformat (semicolon) tak sengaja — kosmetik.
- **UI editing terfragmentasi:** ±24 permukaan editing, 12 field seleksi di 3 store, 0 primitif inspector bersama; dinding tak bisa diedit dari 2D. Audit lengkap + blueprint unifikasi (EntityRef, satu selection slice, inspector registry, roadmap 4 fase): [UNIFIKASI_UI_EDITOR.md](./UNIFIKASI_UI_EDITOR.md) — P0–P2 sudah dieksekusi (registry 8 kind).
- **Idiom arsitektur modern belum memadai:** mezzanine/split-level terblokir stacking 3D `index × konstanta`; courtyard tertutup atap (footprint/atap buta-lubang); skylight belum ada sebagai geometri (label "skylight" di UI menyesatkan); split-facade terbatas granularitas satu-dinding-penuh. Audit 3 jalur + desain + roadmap 5 fase: [ARSITEKTUR_MODERN.md](./ARSITEKTUR_MODERN.md).

---

## 9. Referensi Cepat File Kunci

| Area | File |
|---|---|
| Model 3D (prims) | `src/lib/three/build-model.ts` + `components/preview-3d/house-model.tsx` |
| Store denah | `src/stores/editor-store.ts` |
| Store 3D view | `src/stores/preview-store.ts` |
| Data contract | `src/lib/data/source.ts` |
| Tipe inti | `src/types/index.ts` |
| Fasad | `src/lib/three/facade-claddings.ts`, `facade-presets.ts` |
| Atap/rooftop | `src/lib/geometry/roof.ts`, `geometry/rooftop.ts`, `three/roof-geometry-core.ts` |
| Kolam | `src/lib/three/pool.ts`, `pool-circulation.ts`, `pool-electrical.ts` |
| Slab/lubang tangga | `src/lib/geometry/slab.ts` |
| Interior | `src/lib/interior/plan.ts` + `components/interior/` |
| RAB | `src/lib/rab/`, `src/lib/mock/rab.ts` |
| Listrik/PLN | `src/lib/electrical/costing.ts`, `circuits.ts` |
| Gambar kerja | `src/lib/drawings/` |
| Migrasi/seed | `db/migrations/`, `scripts/migrate.mjs`, `.github/workflows/deploy.yml` |
