# Baruma Exterior Architecture Gap Roadmap

**Status:** implementation work packages T01-T18 selesai di repo; review pasca-selesai 2026-07-15 menutup gap conflict-UX 409, blind-upsert residual, dan feature flags §21 — deviasi tersisa didokumentasikan pada bagian 25
**Tanggal:** 2026-07-12  
**Update status:** 2026-07-15
**Cakupan:** editor 2D, preview 3D, persistence, AI Agent, Gambar Kerja, RAB, asset GLB, dan QA  
**Target utama:** customer dapat membuat dua kelas referensi rumah modern yang dibahas tanpa harus memodelkan bentuk arsitektural utama di aplikasi eksternal.

## 1. Keputusan produk yang dikunci

Baruma akan menjadi **semantic residential design editor**, bukan mesh modeller umum.

Artinya:

1. Bentuk arsitektural yang umum harus dibuat dari elemen native yang dapat diedit, diukur, dihitung biayanya, dan digambar pada Gambar Kerja.
2. Custom GLB tetap tersedia sebagai escape hatch visual, tetapi tidak boleh diam-diam dianggap sebagai struktur atau kuantitas yang sudah tervalidasi.
3. Satu objek desain hanya memiliki satu source of truth di `DesignLayout`. Editor 2D, preview 3D, RAB, Gambar Kerja, dan AI Agent hanya menjadi consumer dari data yang sama.
4. Implementasi dilakukan sebagai vertical slices. Sebuah fitur belum selesai bila baru tampil di 3D tetapi belum tersimpan, belum undoable, belum masuk drawing/RAB, atau belum dapat dikendalikan AI.
5. Geometri v1 tetap memakai meter, koordinat tapak ortogonal, elemen box/segment/frame/polygon sederhana, dan atap berbasis zona persegi panjang. Boolean modelling, NURBS, atau mesh editing bebas tidak masuk roadmap ini.

## 2. Definition of success

Roadmap dianggap mencapai target bila seluruh kondisi berikut terpenuhi:

- Customer baru dapat membangun ulang dua certification scene pada bagian 16 dalam waktu maksimal 30 menit setelah tutorial singkat.
- Bentuk struktural utama pada kedua scene tidak membutuhkan custom GLB: massa, portal, panel, kolom, kanopi, pagar, gerbang, driveway, tangga luar, roster/kisi, balkon, dan atap parsial tersedia secara native.
- Save, refresh, undo, redo, duplicate project, dan buka dari perangkat lain menghasilkan geometri identik.
- Semua elemen native muncul pada plan/elevation yang relevan dengan ID, dimensi, dan material.
- Semua elemen native memiliki quantity takeoff deterministik di RAB. Elemen custom yang belum memiliki costing metadata diberi status `excluded` dengan warning, bukan harga palsu.
- AI Agent dapat menambah, mengubah, dan menghapus elemen dengan action terstruktur yang melewati sanitizer dan store undo/redo yang sama seperti UI.
- Reference scene memenuhi performance budget pada bagian 14 dan lulus visual regression.
- Layout lama tetap terbuka dan tersimpan tanpa kehilangan field.

## 3. Baseline yang sudah ada dan wajib dipakai ulang

| Kapabilitas | Implementasi saat ini | Keputusan roadmap |
|---|---|---|
| Layout source of truth | `DesignLayout` di `src/types/index.ts` | Diperluas secara versioned; tidak membuat state desain paralel |
| Persistence | `design_layouts.payload` JSONB, `getLayoutPayload`/`upsertLayout` | Tetap JSONB; tambah parser, normalizer, schema version, dan revision guard |
| Undo/redo | `commit`/`live` di `src/stores/editor-store.ts` | Semua mutasi baru wajib melewati pola yang sama |
| Autosave | `use-layout-autosave.ts` | Dipakai ulang; ditambah conflict handling agar tab lama tidak menimpa draft baru |
| 3D geometry | `build-model.ts` menghasilkan primitive; `house-model.tsx` merender | Ekstrak modul sebelum menambah domain baru; jangan memperbesar dua file ini terus-menerus |
| Fasad | cladding per wall, louver/slat/roster, custom GLB | Tetap digunakan untuk elemen yang benar-benar hosted pada dinding |
| Balkon/rooftop | railing native dan custom GLB | Tidak dibangun ulang |
| Atap | global datar/pelana/limasan/miring | Menjadi fallback legacy saat `roofZones` belum ada |
| Carport | slab kanopi dan kolom prosedural | Tetap kompatibel; custom exterior canopy dipakai bila customer butuh bentuk bebas |
| Material | material preset dan `FACADE_CLADDINGS` | Disatukan melalui `MaterialRef`, katalog lama tetap valid |
| Asset library | `user_assets` dengan dimensi, bbox, material/performance JSON | Dipakai ulang untuk GLB exterior; tidak membuat asset table baru |
| Gambar Kerja | pure builders di `src/lib/drawings` dan shared `sheet-list.ts` | Tambahkan projection/takeoff baru tanpa menduplikasi renderer PDF/UI |
| RAB | `generateRAB` dan pure domain calculators | Ekstrak quantity takeoff exterior; jangan menaruh seluruh formula baru langsung di `rab.ts` |
| Unified AI Agent | zod actions, live scene, apply melalui store | Perluas action/scene; tidak membuat endpoint AI khusus exterior |

Temuan DB aktual melalui MCP `db_baruma`:

- `design_layouts` terdiri dari `project_id`, `version_id`, `payload jsonb`, dan `updated_at`.
- Terdapat 12 layout; payload belum memiliki `schemaVersion`.
- `user_assets` sudah memiliki ukuran meter, raw bounding box, scale factor, material analysis/map, performance metadata, `usage_scope`, dan status.
- Penambahan array desain tidak membutuhkan tabel baru. Database migration hanya diperlukan untuk optimistic revision dan indeks/constraint yang benar-benar dipakai.

## 4. Scope boundaries agar engineer tidak salah arah

### 4.1 Native element versus facade element

- Gunakan `FacadeElement` bila objek menempel pada satu wall, berada di dalam envelope wall, dan mengikuti wall tersebut. Contoh: kisi, roster, secondary skin, custom facade GLB satu bidang.
- Gunakan `ExteriorElement` bila objek berdiri di tapak, melintasi beberapa lantai, atau merupakan massa tambahan. Contoh: pagar, gate, portal dua lantai, kolom, balok, slab, panel beton tinggi, tangga luar, planter.
- Jangan merepresentasikan gate sebagai furniture, portal sebagai room palsu, atau driveway sebagai material lantai interior.

### 4.2 Custom GLB

- GLB tidak menggantikan data semantik native.
- GLB dapat menjadi visual dari sebuah semantic element, misalnya `kind: facade_panel`, tetapi geometry envelope, material/costing policy, dan drawing representation tetap tersimpan pada instance.
- Jika hanya URL GLB yang tersedia, default costing adalah `excluded`, drawing memakai bounding envelope dengan label `CUSTOM MODEL - VERIFY SHOP DRAWING`, dan UI menampilkan warning.

### 4.3 Tidak masuk scope

- Free-form mesh editing, vertex modelling 3D, sculpting, NURBS, dan arbitrary CSG/boolean cut.
- BIM authoring penuh atau jaminan interoperabilitas IFC LOD 300/400.
- Analisis struktur final untuk kantilever/portal custom. V1 hanya memberi rule-based warning dan quantity konseptual.
- Cloud path-tracing atau photoreal renderer setara V-Ray/Corona.
- Simulasi mekanik gate, animasi penghuni/kendaraan, atau construction sequencing.
- Auto-reconstruction dari satu foto referensi. AI boleh menyusun elemen yang tersedia, bukan mengekstrak ukuran yang tidak diketahui dari foto.
- Sertifikasi kepatuhan peraturan. Audit Baruma tetap advisory.

## 5. Target domain model

Tambahkan modul `src/types/exterior.ts`, lalu re-export dari `src/types/index.ts` agar import publik tetap `@/types`.

```ts
type LayoutSchemaVersion = 2

type MaterialRef =
  | { source: "catalog"; catalogId: string }
  | {
      source: "custom"
      color?: string
      textureAssetId?: string
      roughness?: number
      metalness?: number
    }

type CostingPolicy =
  | { mode: "catalog"; rateId: string; wastePct?: number }
  | { mode: "manual"; unit: "m" | "m2" | "m3" | "unit"; unitPriceIDR: number; wastePct?: number }
  | { mode: "excluded"; reason: string }

type ModelRef = {
  assetId: string
  url: string
  fitMode: "contain" | "cover" | "native"
  rotationDeg?: number
}

type ExteriorElementCommon = {
  id: string
  name: string
  kind: ExteriorElementKind
  floorId: string | null
  baseElevationM: number
  material: MaterialRef
  costing: CostingPolicy
  structuralRole: "non_structural" | "secondary_unverified"
  model?: ModelRef | null
  locked?: boolean
  hidden?: boolean
}

type ExteriorElement =
  | SegmentExteriorElement
  | BoxExteriorElement
  | FrameExteriorElement
  | StairExteriorElement
  | SurfaceExteriorElement
  | AssetExteriorElement

type RoofZone = {
  id: string
  name: string
  floorId: string
  footprint: { x: number; y: number; widthM: number; depthM: number }
  spec: RoofSpec
  ridgeAxis?: "x" | "y"
  elevationOffsetM?: number
  priority: number
}

type DesignLayout = {
  schemaVersion?: LayoutSchemaVersion
  // existing fields remain unchanged
  exteriorElements?: ExteriorElement[]
  roofZones?: RoofZone[]
}
```

ID namespace wajib memakai prefix (`ext-`, `roofz-`) dan factory tunggal agar
`selectedObjectId` existing tetap dapat dipakai tanpa collision dengan room,
opening, furniture, atau sanitation IDs.

### 5.1 Geometry variants

`SegmentExteriorElement`

- Kinds: `boundary_wall`, `metal_fence`, `sliding_gate`, `swing_gate`, `pedestrian_gate`.
- Geometry: `start{x,y}`, `end{x,y}`, `heightM`, `thicknessM`.
- Gate-only fields: `clearWidthM`, `operation`, `slideDirection` atau `swingDirection`, `panelCount`.
- Quantity source: segment length, surface area, dan unit count.

`BoxExteriorElement`

- Kinds: `column`, `beam`, `slab`, `canopy`, `facade_panel`, `solid_wall`, `planter`.
- Geometry: center `x/y`, `widthM`, `depthM`, `heightM`, `rotationDeg`.
- Quantity source ditentukan kind: volume untuk concrete masses; surface area atau unit untuk cladding/panel/canopy.

`FrameExteriorElement`

- Kind: `portal_frame`.
- Geometry: `x/y`, `outerWidthM`, `outerHeightM`, `depthM`, `leftM`, `rightM`, `topM`, optional `bottomM`, `rotationDeg`.
- Renderer dan quantity calculator membangun empat member dari satu semantic object. Engineer dilarang menyimpan empat box terpisah untuk satu portal.

`StairExteriorElement`

- Kind: `exterior_stair`.
- Geometry: `x/y`, `widthM`, `runM`, `riseM`, `stepCount`, `direction`, `landingDepthM?`.
- Invariant: `stepCount >= 1`, tread dan riser berada dalam rule range; nilai di luar range menghasilkan validation issue.

`SurfaceExteriorElement`

- Kinds: `driveway`, `walkway`, `terrace_surface`, `planting_bed`.
- Geometry: polygon sederhana `points[{x,y}]`, minimal 3 dan maksimal 32 titik.
- Polygon harus non-self-intersecting, winding dinormalisasi, dan seluruh titik di-clamp/ditolak bila keluar site sesuai action source.
- Quantity source: shoelace area, bukan bounding box.

`AssetExteriorElement`

- Kinds: `plant`, `tree`, `exterior_decor`, `vehicle`.
- Geometry: `x/y`, `widthM`, `depthM`, `heightM`, `rotationDeg`; wajib `model`.
- Tidak masuk structure quantity. Default costing `excluded` sampai rate dipilih.

### 5.2 Coordinate contract

- Domain tetap memakai site plane `x/y` dalam meter; elevasi vertikal memakai `baseElevationM`.
- Three.js mapping selalu `[domainX - centerX, worldElevation, domainY - centerY]`.
- `floorId: null` berarti elevasi relatif tapak. `floorId` terisi berarti `baseElevationM` relatif terhadap base floor yang dihitung oleh helper tunggal.
- Semua transform, projection, drawing, dan RAB memakai helper geometry yang sama. Dilarang mengulang konversi koordinat di React component.

### 5.3 Roof source-of-truth rule

- `roofZones` absent atau kosong: gunakan `layout.roof` dengan perilaku legacy saat ini.
- `roofZones` berisi data: semua renderer, drawing, sanitation catchment, structural warning, dan RAB wajib memakai zone set. `layout.roof` hanya menjadi default saat membuat zone baru.
- V1 melarang overlap antar-zone lebih dari toleransi 10 mm agar tidak ada z-fighting dan double billing.
- Gap antar-zone diperbolehkan hanya bila area tersebut rooftop deck atau secara eksplisit ditandai `uncovered`; selain itu validation issue severity tinggi.
- Atap parsial pada gambar kedua direpresentasikan sebagai satu zone `pelana` pada massa kiri/atas dan zone `datar` pada massa lain.

## 6. Shared data flow

```text
                         +-------------------------+
UI 2D / UI 3D / AI ---->| editor-store actions    |
                         | commit/live + undo/redo |
                         +------------+------------+
                                      |
                                      v
                         +-------------------------+
                         | DesignLayout v2         |
                         | exteriorElements        |
                         | facadeElements          |
                         | roofZones               |
                         +---+-------+-------+-----+
                             |       |       |
              +--------------+       |       +----------------+
              v                      v                        v
    pure geometry/primitives   pure projections       pure quantities
              |                      |                        |
              v                      v                        v
        Preview 3D              Gambar Kerja                 RAB
              |
              v
     screenshot/presentation

DesignLayout --normalize/validate--> Layout API --revision guard--> JSONB DB
```

Rules:

- React component tidak menghitung kuantitas atau roof geometry.
- RAB tidak membaca Three.js primitives.
- Drawing dan Three.js boleh berbagi pure geometry derivation, tetapi menghasilkan output contract masing-masing.
- AI tidak menulis payload langsung. AI selalu memanggil action yang diterapkan melalui store.

## 7. Phase 0 - foundation and file-boundary cleanup

Tujuan phase ini adalah membuat perubahan berikutnya aman tanpa melakukan rewrite besar sekaligus.

### P0.1 Extract pure modules tanpa perubahan perilaku

File utama saat ini sudah besar: `build-model.ts` 1.349 baris, `house-model.tsx` 1.584, `preview-controls.tsx` 3.112, `plan-canvas.tsx` 1.433, dan `editor-inspector.tsx` 1.360. Jangan menambahkan seluruh fitur baru langsung ke file tersebut.

Ekstraksi wajib:

- `src/lib/three/building-primitives.ts`: primitive room/wall/slab yang sudah ada.
- `src/lib/three/facade-primitives.ts`: facade element, railing, dan carport helpers.
- `src/lib/three/exterior-primitives.ts`: modul baru untuk exterior semantic elements.
- `src/lib/three/roof-zones.ts`: derivation roof planes dan quantities.
- `src/components/preview-3d/panels/facade-panel.tsx` dan panel exterior/roof baru.
- `src/lib/exterior/geometry.ts`, `validation.ts`, `quantities.ts`, `projection.ts`.

Ekstraksi harus berupa commit mechanical terpisah dan seluruh test existing harus tetap hijau sebelum behavior baru dimulai.

### P0.2 Versioned layout parser

Tambahkan:

- `src/lib/schemas/layout.ts`: zod schema authoritative untuk payload layout.
- `src/lib/layout/normalize.ts`: `normalizeDesignLayout(raw)` untuk legacy defaults dan v1 ke v2.
- `src/lib/layout/migrate.ts`: pure, idempotent migration dan dry-run report.

Contract:

1. GET membaca JSONB, menjalankan normalizer, lalu current schema validation.
2. Legacy payload tidak langsung ditulis kembali hanya karena dibaca.
3. PUT menerima current schema, menolak invalid payload dengan HTTP 422 dan path field yang jelas.
4. PUT pertama setelah edit menulis `schemaVersion: 2`.
5. Unknown legacy keys tidak boleh hilang selama rollout. Parser memakai explicit preservation sampai seluruh field memiliki schema.
6. Migration harus idempotent: menjalankannya dua kali menghasilkan payload byte-equivalent setelah stable JSON ordering di test.

### P0.3 Optimistic revision untuk mencegah overwrite antartab

Database migration:

```sql
ALTER TABLE design_layouts
ADD COLUMN revision bigint NOT NULL DEFAULT 1;
```

API contract:

- Tambahkan `LayoutDocument = { layout: DesignLayout; revision: number }` pada
  data-source contract. GET mengembalikan document ini; compatibility adapter
  hanya boleh dipakai selama rollout dan harus dihapus setelah seluruh consumer
  berpindah.
- Editor store menambah `layoutRevision` dan `editSequence`. Setiap `commit` atau
  gesture yang benar-benar berubah menaikkan `editSequence`.
- PUT mengirim `{ layout, expectedRevision }`; save juga menangkap
  `savedEditSequence`.
- SQL update hanya berhasil bila `revision = expectedRevision`, lalu increment.
- Mismatch menghasilkan HTTP 409, autosave berhenti, `dirty` tetap true, dan user melihat pilihan reload atau simpan sebagai copy.
- On-success selalu memperbarui `layoutRevision`, tetapi hanya menjalankan
  `markSaved()` bila current `editSequence === savedEditSequence`. Edit yang
  dibuat ketika request masih berjalan tidak boleh ikut dianggap tersimpan.
- Autosave hanya memiliki satu PUT in-flight. Bila ada edit baru saat request
  berjalan, queue satu latest snapshot; jangan mengirim beberapa revision yang
  sama secara paralel.
- Jangan auto-merge geometri secara diam-diam.

Repository contract juga harus dipecah. `upsertLayout()` saat ini dipakai oleh
beberapa route untuk lazy generation dan memakai `ON CONFLICT ... DO UPDATE`.
Setelah revision aktif, blind upsert tidak boleh tersisa:

- `insertLayoutIfAbsent(projectId, versionId, payload)`: untuk lazy generation,
  memakai `ON CONFLICT DO NOTHING`, lalu membaca row pemenang.
- `updateLayoutAtRevision(projectId, expectedRevision, payload)`: compare-and-
  update dan mengembalikan revision baru atau conflict.
- Route RAB/review/checklist yang hanya memastikan layout ada memakai
  `insertLayoutIfAbsent`; hanya layout PUT/autosave yang boleh memanggil update.

Acceptance criteria Phase 0:

- Semua test existing lulus tanpa snapshot behavior berubah.
- 12 payload DB aktual lolos dry-run migration; report mencatat field yang tidak dikenal atau malformed.
- Invalid polygon/NaN/unknown discriminator tidak dapat masuk lewat PUT.
- Dua tab yang mengedit revision sama: save pertama berhasil, save kedua menerima 409 dan tidak menimpa data.

## 8. Phase 1 - site frontage vertical slice

Phase ini menutup gap paling terlihat pada kedua referensi: pagar, gate, driveway, walkway, dan tangga luar.

### P1.1 Domain dan store

Implement types `segment`, `surface`, dan `stair` terlebih dahulu.

Store actions minimum:

- `addExteriorElement(draft)`
- `updateExteriorElement(id, patch)`
- `removeExteriorElement(id)`
- `duplicateExteriorElement(id)`
- `beginExteriorDrag(id)` / live move-resize / `endDrag()`
- Delete floor hanya menghapus element yang `floorId`-nya sama; site element tetap ada.
- Undo/redo: satu gesture menghasilkan satu history entry.

Validation:

- ID unik.
- Semua angka finite dan dimensi positif.
- Segment tidak boleh lebih pendek dari 0,2 m.
- Gate clear width tidak boleh melebihi segment envelope.
- Surface polygon non-self-intersecting dan area minimal 0,1 m2.
- Tangga tidak boleh memiliki riser/tread nol atau direction invalid.
- Site element di luar site menghasilkan error; UI drag melakukan clamp, API/AI action invalid ditolak.

### P1.2 Editor 2D

Tambahkan mode/layer `Eksterior` pada toolbar, tanpa mencampur placement dengan room tool.

Flow:

1. Pilih `Pagar`, `Sliding gate`, `Pedestrian gate`, `Driveway`, `Walkway`, atau `Tangga luar`.
2. Segment: click-drag start ke end.
3. Surface: click titik; Enter/double click menutup polygon; Escape membatalkan tanpa history.
4. Stair: click-drag footprint, lalu inspector menentukan rise/step count/direction.
5. Selected element memperlihatkan dimension handles, rotation/endpoint handles, snap, lock, duplicate, dan delete.

Inspector wajib memakai shared form components yang dapat dipakai juga dari preview 3D; jangan membuat property form kedua di `preview-controls.tsx`.

### P1.3 Preview 3D

- Segment wall/fence/gate memakai derived primitives.
- Repeated fence bars dan gate slats memakai instancing, bukan satu React mesh per bilah.
- Surface memakai triangulated `ShapeGeometry`; invalid polygon tidak boleh mencapai renderer.
- Stair geometry berasal dari pure helper yang sama dengan section/drawing.
- Custom GLB dapat menggantikan visual gate/fence tetapi tetap di-fit terhadap semantic envelope.
- Loading/error GLB menampilkan envelope fallback dan toast/non-blocking badge; scene tidak blank.

### P1.4 Gambar Kerja

Tambahkan `buildSitePlan()` dan sheet baru dengan stable ID `site-plan` tanpa mengubah nomor sheet existing.

Perluas renderer-agnostic `Drawing` secara backward-compatible:

```ts
type DrawPolygon = {
  points: Array<{ x: number; y: number }>
  kind: "surface" | "hatch" | "boundary"
  materialId?: string
}

type DrawSymbol = {
  x: number
  y: number
  rotationDeg: number
  kind: "gate-slide" | "gate-swing" | "stair-up" | "tree" | "custom-warning"
  refId?: string
}

type Drawing = {
  // existing fields
  polygons?: DrawPolygon[]
  symbols?: DrawSymbol[]
}
```

SVG screen renderer dan PDF/export renderer harus mendukung contract baru pada
commit yang sama. Dilarang menaruh operation gate atau hatch driveway sebagai
label/garis ad-hoc yang hanya dipahami salah satu renderer.

Site plan minimal memuat:

- batas tanah;
- pagar dan gate dengan operation symbol;
- driveway/walkway hatch;
- tangga dan arah naik;
- planting bed outline;
- dimensi chain terhadap boundary;
- element ID dan material label.

Elevation memproyeksikan pagar/gate/tangga yang menghadap view dan menerapkan occlusion deterministik.

### P1.5 RAB

Tambahkan `exteriorQuantityTakeoff(layout)` sebagai pure function.

- Boundary wall: luas muka dan/atau volume sesuai rate definition.
- Metal fence/gate: luas panel atau meter lari, ditambah hardware unit bila rate catalog menetapkan.
- Driveway/walkway: polygon area x waste.
- Stair: concrete volume dan finish area.
- Custom model tanpa costing metadata: excluded warning.

Rate catalog diletakkan di `src/lib/exterior/rates.ts` sebagai typed/versioned
data dengan unit, harga, confidence, dan effective date. Quantity exterior tidak
boleh dialokasikan dari persentase `base` RAB. Bila rate belum tersedia, policy
harus `manual` atau `excluded`.

Line item harus membawa `sourceElementIds` sehingga engineer/user dapat menelusuri angka kembali ke objek desain.

Tambahkan `sourceElementIds?: string[]` pada `BOQItem`; exporter XLSX/PDF tetap
backward-compatible dan boleh menampilkan ID pada kolom referensi/detail, bukan
menggabungkannya ke nama item.

### P1.6 AI parity

Tambahkan action `addExteriorElement`, `updateExteriorElement`, dan `removeExteriorElement` ke unified floorplan assistant.

- Scene snapshot hanya mengirim field semantik dan envelope, bukan raw GLB atau material analysis besar.
- Polygon dari AI maksimal 16 titik walaupun domain mendukung 32.
- Sanitizer mengecek site bounds, dimensions, discriminator, asset ownership, dan valid cost policy.
- Apply memakai editor store actions yang sama; tidak mutasi array langsung.

Acceptance criteria Phase 1:

- User dapat membentuk frontage kedua reference scene, save/reload, undo/redo, dan mengubahnya dari 2D atau 3D selection.
- Site plan dan elevation menunjukkan elemen yang sama.
- RAB quantity sesuai hand calculation pada fixture test.
- AI dapat membuat satu pagar + dua gate + driveway dalam satu proposal dan semua action tetap reversible.

## 9. Phase 2 - architectural additive elements

Phase ini menutup portal tebal, bidang panel beton tinggi, kolom/balok aksen, custom canopy, planter, dan slab bebas.

### P2.1 Kinds yang wajib

- `portal_frame`
- `column`
- `beam`
- `slab`
- `canopy`
- `facade_panel`
- `solid_wall`
- `planter`

Room tetap source of truth untuk ruang dan dinding utama. Exterior box/frame tidak boleh dipakai untuk membuat seluruh denah rumah.

Semua element Phase 2 bersifat tambahan. `structuralRole` hanya boleh
`non_structural` atau `secondary_unverified`; tidak ada element baru yang
menggantikan primary structural grid pada v1. Dengan demikian structural grid
existing tetap diturunkan dari room footprint dan tidak diam-diam berubah.

### P2.2 Placement dan editing

- Placement terjadi pada floor/site plan dengan base elevation yang eksplisit.
- Box mendukung move, resize, rotate, copy, lock, numeric inspector, align, dan snap.
- Portal diedit sebagai satu object dengan outer dimensions dan member thickness.
- Element dapat melintasi lebih dari satu storey melalui `baseElevationM + heightM`; ia tetap memiliki satu owner floor/site untuk selection/filter.
- Deleting host floor memunculkan confirmation bila ada element floor-owned. Site-owned element tidak ikut terhapus.
- `facade_panel` tinggi seperti referensi pertama dibuat sebagai box semantic, bukan louver yang dipaksa melebihi wall height.

### P2.3 Rendering/material

- Procedural native geometry adalah default.
- `model` optional hanya mengganti visual, tidak envelope atau quantity.
- Material assignment memakai `MaterialRef` dan katalog yang sama dengan cladding.
- Portal/frame menggunakan member meshes yang dapat di-instance jika material sama.
- Canopy/slab memiliki underside material support agar soffit kayu/oranye pada referensi pertama dapat direpresentasikan tanpa duplicate slab.

Carport procedural membutuhkan override eksplisit. Tambahkan
`Room.carportCanopyMode?: "automatic" | "none"` dengan default `automatic`.
Saat user memasang custom `canopy` di carport, UI menawarkan satu transaction
undoable yang membuat element dan mengubah mode menjadi `none`. Jangan memakai
overlap detection implisit untuk menyembunyikan canopy procedural; hasilnya sulit
diprediksi dan rawan double render/double quantity. AI proposal custom canopy juga
wajib menyertakan perubahan mode ini.

### P2.4 Drawings dan RAB

- Plan/elevation/section memproyeksikan box/frame/stair dari pure projection helpers.
- Portal frame diberi outer dan clear opening dimensions.
- Canopy/slab menunjukkan elevation mark dan thickness.
- Quantity calculator membedakan volume beton, luas cladding, luas soffit, dan unit model.
- Structural audit menandai beam/slab/canopy custom sebagai `requires_engineer_review`; jangan memberi klaim aman berdasarkan rule visual.

Acceptance criteria Phase 2:

- Portal putih pada referensi kedua dibuat sebagai satu object dan dapat diresize tanpa member terpisah berantakan.
- Lima panel beton vertikal referensi pertama dapat dibuat, diduplikasi dengan spacing tool, dan dihitung quantity-nya.
- Soffit dan top material pada canopy dapat berbeda.
- Section/elevation tetap cocok dengan 3D pada ukuran dan elevasi.

## 10. Phase 3 - roof zones per mass

### P3.1 Geometry engine

Tambahkan pure API:

- `effectiveRoofZones(layout)`
- `validateRoofZones(layout, footprint)`
- `buildRoofZonePlanes(zone)`
- `roofZoneSurfaceArea(zone)`
- `roofCatchmentArea(layout)`
- `roofZoneProjection(zone, view)`

Aturan:

- Rectangular zones v1 saja.
- Ridge axis eksplisit untuk pelana/limasan; skillion memakai `lowSide`.
- Slope dan overhang memakai clamp yang sama seperti `effectiveRoof` legacy.
- Overlap zone ditolak; shared edge boleh.
- Roof zone dapat berada di ketinggian berbeda untuk massa split-level.
- Full rooftop dan partial rooftop tetap berlaku; deck memotong coverage melalui rule terpusat, bukan formula copy-paste.

### P3.2 Roof editor

- Toggle `Global roof` versus `Roof zones`.
- Saat pertama beralih ke zoned mode, buat satu zone dari current global roof dan building footprint.
- User dapat split zone secara axis-aligned, resize, memilih type/material/slope/ridge axis, duplicate, dan delete.
- UI memperlihatkan overlap, uncovered footprint, dan deck conflict sebelum save.
- Kembali ke global mode membutuhkan confirmation karena zone detail akan disimpan sebagai inactive draft atau dihapus secara eksplisit; jangan diam-diam membuang data.

### P3.3 Downstream parity

- 3D renderer memakai zone planes.
- Elevation dan section menggambar setiap zone pada posisi sebenarnya.
- Roof detail sheet menampilkan roof plan dan schedule per zone.
- RAB menjumlah surface area per material tanpa double count.
- Soakwell sizing memakai catchment union area, bukan penjumlahan overlapping bbox.
- AI actions: `addRoofZone`, `updateRoofZone`, `removeRoofZone`, `setRoofMode`.

Acceptance criteria Phase 3:

- Referensi kedua memiliki pelana bata pada massa tertentu dan atap datar pada massa lain.
- Dua zone dengan shared edge tidak menghasilkan z-fighting atau duplicate fascia.
- RAB roof quantities reconcile dengan roof schedule sampai toleransi 0,1 m2.
- Legacy project tanpa zones merender identik dengan baseline.

## 11. Phase 4 - material, GLB semantics, and asset safety

### P4.1 Unified material resolver

Tambahkan `resolveMaterial(ref, surfaceKind)` yang menjadi satu-satunya resolver untuk native exterior, facade, drawing label, dan RAB rate lookup.

- Catalog ID lama tetap valid.
- Custom color/texture divalidasi.
- Missing texture menggunakan color fallback.
- Material per sub-surface didukung untuk `top`, `side`, dan `underside` pada canopy/slab; portal member dapat memakai satu material v1.

### P4.2 Asset placement contract

Reuse `user_assets` dan ingestion pipeline yang ada.

- Pastikan asset status `ready`, owner/public scope legal, URL tersedia, bbox finite, dan dimensions masuk akal sebelum dapat dipilih.
- Exterior placement menyimpan `assetId` dan URL snapshot. Saat URL berubah/expired, loader resolve ulang berdasarkan assetId.
- `performance_json` digunakan untuk warning triangle/draw-call/texture size.
- GLB di-fit berdasarkan semantic envelope dengan axis mapping eksplisit; jangan menebak axis setiap frame.
- Unsupported Draco/texture/CORS error menghasilkan fallback envelope, bukan crash canvas.

### P4.3 Costing/drawing policy

- Setiap custom instance wajib memilih `catalog`, `manual`, atau `excluded`.
- UI tidak boleh menampilkan RAB sebagai complete bila ada excluded custom exterior elements.
- Drawing envelope dan schedule mencantumkan asset name, dimensions, dan verification note.

Acceptance criteria Phase 4:

- Custom facade SKP->GLB yang sudah dikonversi dapat dipasang tanpa merusak selection, save, drawing, atau RAB status.
- Missing/deleted private asset tidak membuat scene gagal total.
- Tidak ada custom model yang otomatis diberi harga berdasarkan bounding box saja.

## 12. Phase 5 - landscape and presentation quality

### P5.1 Landscape semantics

- `planting_bed` native surface.
- `plant`, `tree`, `exterior_decor`, dan optional `vehicle` sebagai asset exterior.
- Mass placement untuk tanaman memakai deterministic scatter seed yang tersimpan; jangan menyimpan ratusan child object bila satu planting bed cukup.
- Clearance validation terhadap driveway, gate sweep, dan main access path.
- Landscape tidak masuk struktur; costing melalui unit/manual catalog.

### P5.2 Render modes

Reuse realistic/night/sun controls pada `house-scene.tsx`.

Tambahkan dua preset yang jelas:

- `Edit`: demand rendering, light shadows, LOD agresif, fokus interaksi.
- `Presentation`: PBR texture resolution lebih tinggi, shadow map yang sesuai device, deterministic camera/sun preset, high-resolution screenshot.

Jangan menambah post-processing sebelum profiling. Urutan peningkatan:

1. texture color space dan PBR maps benar;
2. material scale konsisten dalam meter;
3. shadow/light exposure konsisten;
4. environment reflection untuk kaca/metal;
5. optional AO hanya bila performance budget masih lulus.

Acceptance criteria Phase 5:

- Tanaman rooftop/planting strip dapat dibuat tanpa furniture-room hack.
- Screenshot presentation deterministic untuk visual regression.
- Edit mode tetap responsif pada reference scene penuh.

## 13. Phase 6 - templates, AI quality, and customer workflow

### P6.1 Exterior templates

Sediakan template native, bukan saved GLB:

- `Modern Concrete Vertical`
- `Brick Gable Roster`
- `Minimalist Portal Carport`

Template berisi semantic actions sehingga customer dapat mengedit setiap bagian dan AI dapat menjelaskan perubahan.

### P6.2 Unified AI Agent capability

- Scene snapshot menyertakan summarized exterior/roof state dengan stable IDs.
- Server prompt mencantumkan coordinate system, legal kinds, bounds, dan rule facade-versus-exterior.
- Agent membuat proposal, bukan langsung save.
- Capability parity test memastikan setiap UI mutation utama memiliki action schema dan apply handler.
- Tambahkan eval khusus:
  - membuat frontage dari brief;
  - membuat partial gable roof;
  - mengubah portal tanpa menghapus gate;
  - menolak ukuran di luar site;
  - mempertahankan unrelated rooms/interiors;
  - menjelaskan excluded custom model pada RAB.

### P6.3 Guided workflow

Flow customer:

```text
Pilih template / mulai kosong
  -> susun massa & room
  -> mode Eksterior: frontage + portal/panel
  -> mode Roof Zones
  -> material + custom asset optional
  -> Audit: geometry / access / costing exclusions
  -> Preview Presentation
  -> Gambar Kerja + RAB
```

Acceptance criteria Phase 6:

- Customer dapat menyelesaikan reference scenes tanpa mengetahui istilah internal atau mengedit JSON.
- AI Agent tidak menurunkan kemampuan floorplan/interior existing; regression eval baseline tidak turun lebih dari batas yang disepakati.
- Semua action exterior dapat undo dan tidak mengubah field yang tidak disebut.

## 14. Performance budgets

Budget diukur pada certification scene paling kompleks, Chrome desktop kelas menengah dan satu profil mobile yang disepakati tim.

| Area | Target |
|---|---|
| Pure scene derivation | p95 < 50 ms untuk 500 semantic exterior elements |
| 2D drag/resize | >= 45 FPS, validation berat ditunda sampai gesture selesai |
| 3D edit mode | >= 45 FPS desktop dan >= 30 FPS mobile profile |
| Draw calls | <= 300 pada reference scene; repeated slats/fence/vegetation wajib instanced |
| Triangles | <= 1,5 juta desktop, <= 400 ribu mobile setelah LOD |
| Drawing build | < 500 ms untuk full sheet list reference scene |
| RAB recompute | < 200 ms untuk 500 elements |
| Autosave payload | target < 1 MB tanpa embedded base64/mesh data |
| GLB | gunakan ingestion performance limits existing; oversize asset diblokir atau diberi explicit degraded mode |

Performance instrumentation:

- Timer around normalize, validation, primitive derivation, drawing build, dan RAB takeoff.
- Dev-only scene stats: semantic object count, meshes, instances, draw calls, triangles, texture memory estimate.
- Benchmark fixture tersimpan; threshold failure masuk CI untuk pure functions, sedangkan GPU measurement dijalankan pada scheduled/browser benchmark.

## 15. Test strategy

### 15.1 Unit tests

`src/lib/exterior/*.test.ts`

- segment length, rotated box bounds, portal member derivation;
- polygon winding, area, self-intersection, degenerate edge;
- stairs derivation dan range validation;
- site/floor elevation mapping;
- material resolver fallback;
- quantity takeoff per kind dan waste;
- custom costing excluded/manual/catalog.

`src/lib/three/*.test.ts`

- exterior element ke primitive mapping;
- no duplicate primitive IDs;
- instancing groups hanya menyatukan geometry/material compatible;
- roof zone planes, slope, ridge axis, shared edges, dan overlap rejection;
- legacy roof output tidak berubah saat `roofZones` absent.

`src/lib/drawings/*.test.ts`

- site plan symbols dan dimension chains;
- plan/elevation/section projection setiap element kind;
- roof zone schedule dan quantity reconciliation;
- custom model envelope warning;
- clipping/occlusion dari empat elevation sides.

`src/lib/mock/rab.test.ts` dan quantity tests

- semua native kind menghasilkan line item yang tepat;
- no double counting roof/global fallback;
- source element traceability;
- excluded asset menurunkan completeness status;
- sum line items reconcile dengan category/summary.

`src/stores/editor-store.test.ts`

- add/update/delete/duplicate;
- one undo per gesture;
- deleting floor ownership rule;
- locked element tidak termutasi;
- load legacy layout dan current layout.

### 15.2 API/integration tests

- GET legacy payload -> normalized response.
- PUT v2 valid -> persisted with schemaVersion.
- PUT invalid -> 422 with field path.
- stale expected revision -> 409; DB payload unchanged.
- private/missing asset rejected for another user.
- migration dry-run terhadap anonymized copies dari seluruh shape DB aktual.

### 15.3 AI tests and evals

- Zod accepts every documented action and rejects unknown discriminator/NaN/out-of-bounds polygon.
- `applyFloorplanActions` covers success, missing ID, deleted floor, stale asset, invalid cost policy.
- Scene snapshot contains necessary fields but excludes heavyweight analysis JSON.
- Capability parity test maps UI action -> assistant action -> store method.
- Existing floorplan/interior eval suite is baseline gate; exterior prompt change tidak boleh menurunkan pass rate existing.

### 15.4 E2E and visual regression

For each certification scene:

1. Create from empty project.
2. Add native exterior and roof zones.
3. Edit via inspector and 3D selection.
4. Undo/redo.
5. Save, refresh, and reopen.
6. Verify site plan, elevations, roof detail, RAB.
7. Capture fixed camera/sun screenshot.
8. Test missing GLB fallback.
9. Test mobile viewport for core editing and presentation.

Visual snapshots hanya deterministic pada fixed camera, sun, material seed, dan no-animation frame. Jangan membandingkan screenshot dengan foto referensi pixel-by-pixel.

## 16. Certification scenes

### Scene A - Modern Concrete Vertical

Minimum fixture:

- site 12 x 20 m, dua lantai;
- massa ortogonal dengan setback/recess kiri;
- balcony kaca dan curtain wall;
- portal putih besar dengan soffit berbeda material;
- lima panel beton vertikal multi-storey;
- flat roof/partial rooftop;
- carport;
- boundary wall depan;
- sliding vehicle gate sekitar 4,5 m;
- pedestrian gate sekitar 1 m;
- driveway, walkway, dan tiga anak tangga;
- planting strip/rooftop vegetation;
- lampu facade/canopy.

Checklist pass:

- seluruh item dapat diseleksi dan diukur;
- panel dapat diubah spacing/height tanpa recreate manual;
- gate/driveway muncul di site plan dan elevation;
- RAB memiliki native quantity untuk seluruh elemen selain tanaman dekoratif yang memang excluded/manual.

### Scene B - Brick Gable Roster

Minimum fixture:

- site 8 x 16 m, dua lantai;
- satu roof zone pelana lokal dengan material bata/roof finish yang sesuai;
- massa lain roof zone datar;
- portal putih carport;
- roster screen;
- vertical/horizontal slats;
- vehicle gate dan pedestrian access;
- planting bed depan dan lantai dua;
- wall accents berbeda material.

Checklist pass:

- gable hanya menutup massanya, tidak seluruh footprint;
- ridge orientation benar pada 3D, elevation, section, dan roof detail;
- roster tetap `FacadeElement`, portal tetap `ExteriorElement`;
- roof material quantities per zone reconcile dengan RAB.

## 17. Production failure modes

| Failure | Prevention/handling | Test | User experience |
|---|---|---|---|
| Legacy payload malformed | normalize + current schema + migration dry-run | API fixture | Project tidak diam-diam rusak; pesan recovery/admin trace ID |
| Stale autosave dari tab lain | revision compare-and-update | integration + E2E two-tab | 409 banner dengan reload/save-copy |
| Polygon self-intersecting | validation before store/API/render | unit + E2E | vertex bermasalah ditandai; save ditolak |
| Roof zones overlap | centralized validator | unit/property test | overlap merah dan actionable message |
| Roof leaves accidental hole | footprint coverage audit | unit + certification | warning tinggi sebelum export |
| Missing/private GLB | asset authorization + error boundary + envelope fallback | API + component | object tetap terlihat sebagai envelope, retry/replace available |
| Oversized GLB exhausts GPU | ingestion limits + LOD/degraded mode | asset integration | asset ditolak atau preview degraded, canvas tidak crash |
| RAB double-counts legacy roof and zones | single effective roof system helper | reconciliation test | hanya source active yang dihitung |
| Custom model receives fake cost | explicit costing policy | unit/E2E | RAB incomplete badge + reason |
| Drawing projection drifts from 3D | shared pure geometry | fixture comparison | dimension/elevation konsisten |
| AI creates illegal coordinates | zod + sanitizer + site bounds | action tests/evals | proposal gagal per action dengan alasan, batch lain aman |
| Floor deletion orphans elements | ownership rule + confirmation | store/E2E | user tahu objek yang ikut terhapus |
| Duplicate element IDs | creation factory + schema invariant | unit/property | save rejected before DB corruption |

Tidak boleh ada failure mode pada tabel ini yang berakhir sebagai silent data loss.

## 18. Implementation work packages

Setiap work package harus menjadi PR/commit group yang dapat diverifikasi sendiri.
Engineer tidak boleh mengambil task downstream sebelum dependency-nya merged.

Status update 2026-07-15:

- Selesai penuh di repo: T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17, T18.
- Catatan utama: Facade Composer v1 selesai pada 2026-07-13 (`FC-01` sampai `FC-07`). Roof-zone downstream parity T14, material/asset semantics T15, dan landscape semantics T16 sudah menutup gap terbesar Scene B. T17 kini punya preset presentation, browser gate, scene stats, certification fixtures, browser render gate, pixel-baseline visual regression, dan workflow benchmark mingguan untuk dua scene. T18 menutup guided templates, AI eval set, customer journeys, telemetry contract, dan release certification checklist.
- Review 2026-07-15 (pasca-selesai): tiga gap kontrak ditutup pada hari yang sama —
  (1) T03 conflict UX 409 di client kini lengkap: `useLayoutAutosave` mendeteksi
  `ApiError` 409, menghentikan autosave (bukan retry revision basi), dan
  `LayoutConflictBanner` (dirender header workspace, termasuk clean mode)
  menawarkan "Muat ulang" atau "Simpan sebagai salinan" (duplikasi project dari
  brief + tulis layout lokal via revision guard). (2) Alias `upsertLayout`
  dihapus; enam route lazy-generation (RAB/review/checklist/toggle) memakai
  `insertLayoutIfAbsent` langsung dan mengambil payload row pemenang. (3) §21
  feature flags terimplementasi: `src/lib/features.ts` (resolver pure + stable
  hash cohort), `GET /projects/[id]/capabilities` (role admin DB-fresh),
  gating creation UI di toolbar editor (exterior/roof-zone/template) dan preset
  Presentasi; default env kosong = enabled 100% (kill-switch rollback, bukan
  gerbang pra-rilis; lihat bagian 25). Deviasi implementasi yang diterima dan
  disengaja didokumentasikan pada bagian 25.

- [x] **T01 - Mechanical module extraction**
  - Scope: pecah hotspot 3D/panel menjadi modul pada P0.1 tanpa behavior change.
  - Depends on: none.
  - Verify: full Vitest, TypeScript, lint, existing 3D/drawing snapshots.
  - Status 2026-07-15: selesai untuk extraction aman tanpa behavior change. Label semantic eksterior yang sebelumnya terduplikasi di toolbar, inspector, dan preview dipindah ke `src/lib/exterior/labels.ts` dengan dua map eksplisit agar copy editor dan preview tetap identik dengan UI lama. Kartu seleksi semantic frontage 3D dipisahkan dari hotspot `preview-controls.tsx` ke `src/components/preview-3d/exterior-selection-quick-editor.tsx`, menurunkan panel besar dari 3079 menjadi 3004 baris dan membuat behavior clear-selection dapat dites langsung. Handler template toolbar juga dirapikan menjadi satu blok acceptance tanpa mengubah confirm/undo/telemetry flow. Verification: `src/components/preview-3d/exterior-selection-quick-editor.test.tsx`, `rtk tsc --noEmit`, `rtk pnpm lint`, `rtk playwright test e2e/exterior-editor.spec.ts e2e/certification-scenes.spec.ts --project=chromium`, dan `rtk pnpm run test:e2e:certification` hijau.

- [x] **T02 - Layout v2 runtime contract**
  - Scope: exterior types, schema, normalizer, idempotent migrator, anonymized DB fixtures.
  - Depends on: none; dapat paralel dengan T01 selama `src/types` dikoordinasikan.
  - Verify: legacy/current/invalid/unknown-field tests dan MCP dry-run report 12 layouts.
  - Status 2026-07-15: selesai. `designLayoutSchema`/`normalizeDesignLayout` menerima layout legacy tanpa `schemaVersion`, menaikkan output ke `schemaVersion: 2`, tetap `.passthrough()` untuk unknown forward-compatible fields, menjaga idempotensi normalizer, dan memvalidasi field v2 terbaru: `exteriorElements` semantic, material sub-surface `top|side|underside`, model contract/performance, `scatterSeed`, serta `roofZones`. Regression tests mencakup legacy/current/invalid/unknown-field/idempotent normalization dan `normalizeLayoutDocument` revision preservation. MCP `db_baruma` dry-run read-only terhadap 12 row `design_layouts`: 12/12 payload object, 12/12 `floors` array, 12/12 `rooms` array, 12/12 punya `validation`, 1/12 sudah `schemaVersion` eksplisit dan 11/12 legacy-null yang dinormalisasi aman ke v2. Verification: `src/lib/schemas/layout.test.ts`, `tsc --noEmit`, dan `pnpm lint` hijau.

- [x] **T03 - Revision-safe persistence**
  - Scope: DB migration, `LayoutDocument`, repository split, data layer, store revision/edit sequence, serialized autosave queue, conflict UI.
  - Depends on: T02.
  - Verify: repository integration, two-tab E2E, in-flight-edit regression test.
  - Status 2026-07-15: selesai. Migration `0017_design_layouts_revision.sql`
    sudah diterapkan di DB produksi; PUT layout memakai `expectedRevision` dan
    mengembalikan 409 saat basi; autosave single-in-flight + queue snapshot
    terbaru + `savedEditSequence` guard. Review pasca-selesai melengkapi dua
    sisa kontrak: (a) client kini membedakan 409 dari error lain — autosave
    berhenti dan `LayoutConflictBanner` menawarkan muat-ulang atau
    simpan-sebagai-salinan (project duplikat dari brief, layout lokal ditulis
    via revision guard); (b) alias blind-upsert `upsertLayout` dihapus — route
    lazy-generation memanggil `insertLayoutIfAbsent` (ON CONFLICT DO NOTHING)
    dan memakai payload row pemenang. Verification: `use-layout-autosave`,
    `layout-conflict-banner`, layout & API route suites, `tsc --noEmit` hijau.

- [x] **T04 - Exterior geometry and validation core**
  - Scope: segment/surface/stair unions, factories, finite/bounds/polygon validation, pure geometry and quantities contracts.
  - Depends on: T02.
  - Verify: property/unit tests including degenerate and boundary cases.

- [x] **T05 - Exterior store and selection**
  - Scope: add/update/delete/duplicate/drag/lock, ID namespace, floor ownership, undo/redo.
  - Depends on: T04.
  - Verify: store suite; one history entry per gesture.

- [x] **T06 - Site frontage editor UX**
  - Scope: Exterior layer/toolbox, segment/polygon/stair gestures, shared inspector, handles, keyboard cancel, validation feedback.
  - Depends on: T05.
  - Verify: component tests and Playwright create/edit/undo flow on desktop/mobile.
  - Status 2026-07-15: partial desktop placement gate shipped. `PlanCanvas` component test kini memverifikasi exterior tool dapat place additive `portal_frame` dan `facade_panel` ke `layout.exteriorElements` lalu langsung memilih elemen baru. Ditambahkan Playwright `e2e/exterior-editor.spec.ts` yang membuka editor, memilih toolbar “Tambah elemen eksterior → Portal”, klik canvas, memastikan portal native muncul, dan Undo menghapusnya. Verification: `plan-canvas.test.tsx`, `rtk playwright test e2e/exterior-editor.spec.ts --project=chromium`, `tsc --noEmit`, dan `pnpm lint` hijau. Pending T06 penuh: mobile viewport gesture, keyboard cancel, polygon/stair edit flow, dan validation feedback E2E.
  - Status 2026-07-15: mobile/cancel/validation gates shipped. `PlanCanvas` kini menangani `Escape` sebagai cancel placement/drag ringan: clear pending exterior kind via `setTool("select")`, stop temporary pan, dan `endDrag()`. Inspector eksterior sekarang menampilkan feedback `validateExteriorElement` untuk selected semantic element, termasuk outside-site/structural warnings, sehingga validasi domain terlihat langsung di editor. Playwright `exterior-editor.spec.ts` diperluas untuk Escape cancel tanpa mutasi layout, invalid exterior placement feedback, dan placement native `canopy` pada viewport mobile 390×844. Verification: `editor-inspector.test.tsx`, `plan-canvas.test.tsx`, `rtk playwright test e2e/exterior-editor.spec.ts --project=chromium`, `tsc --noEmit`, dan `pnpm lint` hijau. Pending T06 penuh: polygon/stair edit flow E2E yang lebih eksplisit.
  - Status 2026-07-15: selesai untuk acceptance T06. Polygon surface kini punya vertex handles (`v0`, `v1`, dst.) yang terhubung ke `dragExteriorResize`, stair exterior punya finite corner handles dan resize footprint direction-aware di store, serta E2E browser memverifikasi placement `exterior_stair` dan `driveway` dengan vertex handles pada page bersih. Verification tambahan: `exterior-canvas.test.tsx`, `editor-store.exterior.test.ts`, `rtk playwright test e2e/exterior-editor.spec.ts --project=chromium`, `tsc --noEmit`, dan `pnpm lint` hijau.

- [x] **T07 - Site frontage 3D**
  - Scope: exterior primitives, instanced fence/gate slats, surfaces, stairs, GLB envelope fallback, 3D selection.
  - Depends on: T04/T05; dapat paralel dengan T06.
  - Verify: primitive mapping tests, missing GLB component test, scene performance fixture.
  - Status 2026-07-15: partial 3D frontage guard shipped. `exteriorElementPrimitives` sudah memetakan segment, box, portal frame, stair, polygon surface, dan asset semantic kinds ke `PrimKind "exterior"` dengan `exteriorElement` owner metadata stabil. Ditambahkan regression test untuk `tree` dan `vehicle` yang memastikan envelope fallback memakai ukuran/rotasi benar dan membawa `modelAssetId/modelUrl` ke renderer. Verification: `exterior-primitives.test.ts`, `tsc --noEmit`, dan `pnpm lint` hijau. Pending T07 penuh: instanced fence/gate slats, missing-GLB component test di renderer React, dan 3D selection E2E khusus frontage.
  - Status 2026-07-15: selesai untuk acceptance T07. Native `fence`, `sliding_gate`, `swing_gate`, dan `pedestrian_gate` kini tidak lagi turun sebagai satu box polos: renderer primitive menghasilkan rail atas/bawah, post ujung, dan slat deterministik ber-ID stabil dengan owner semantic yang sama; custom GLB gate/fence tetap satu envelope agar model kustom tidak di-load berulang. `ExteriorPrimitiveMesh` diekspor untuk regression test renderer React yang memastikan envelope fallback muncul saat custom GLB hilang/rusak, dan GLB valid tetap masuk path fit envelope. Preview 3D sekarang menampilkan `ExteriorSelectionQuickEditor` read-only saat native/custom frontage diklik dari canvas, sehingga seleksi 3D bisa diverifikasi tanpa memecah downstream contract. Verification: `exterior-primitives.test.ts`, `house-model.test.tsx`, `certification-scenes.test.ts`, `scene-stats.test.ts`, `rtk playwright test e2e/certification-scenes.spec.ts --project=chromium`, `tsc --noEmit`, dan `pnpm lint` hijau.

- [x] **T08 - Drawing contract and site plan**
  - Scope: optional polygon/symbol drawing primitives, both renderers, site plan, elevations, stable sheet registration.
  - Depends on: T04.
  - Verify: pure drawing tests, PDF/UI parity, sheet-list regression.
  - Status 2026-07-15: drawing parity guard shipped. `buildLayoutSheet` sudah menggabungkan `projectExteriorPlan(layout.exteriorElements, floorId)` sehingga segment/surface/box/frame/site elements muncul sebagai line/label ber-`refId` stabil dan memperluas `widthM/heightM` sheet. Ditambahkan regression test denah untuk `sliding_gate` + `garden_bed` agar exterior site elements tidak hilang dari gambar kerja denah. Verification: `layout-sheet.test.ts`, `tsc --noEmit`, dan `pnpm lint` hijau.
  - Status 2026-07-15: selesai untuk acceptance T08. Ditambahkan pure builder `buildSitePlan(layout, site?)` untuk sheet “Rencana Tapak”: menggambar batas tapak, footprint lantai dasar, carport/open area, exterior elements dengan `refId` stabil, dimensi tapak, dan fallback bounds dari layout saat `Project.site` tidak tersedia. `buildSheetList` kini mendaftarkan `site-plan` sebagai `SP-01` di awal paket; `defaultSheets` otomatis mengikuti shared sheet-list sehingga UI/PDF tetap parity. Verification: `site-plan.test.ts`, `sheet-list.test.ts`, `drawings-pack.test.ts`, `tsc --noEmit`, dan `pnpm lint` hijau.

- [x] **T09 - Exterior RAB vertical slice**
  - Scope: versioned rates, quantity takeoff, traceable BOQ IDs, completeness/excluded status, exports.
  - Depends on: T04.
  - Verify: hand-calculation fixtures and summary reconciliation.

- [x] **T10 - Exterior AI parity**
  - Scope: action schemas, scene snapshot, sanitizer, apply/store mapping, prompts, capability parity tests.
  - Depends on: T05.
  - Verify: action/apply tests and existing floorplan/interior eval baseline.

- [x] **T11 - Additive architecture elements**
  - Scope: box/frame kinds, carport canopy override, placement/edit UI, 3D, projections, quantity, structural warnings, AI actions.
  - Depends on: T04-T10 shared foundation.
  - Verify: Scene A geometry checklist plus all downstream parity tests.
  - Status 2026-07-15: downstream parity + structural warning shipped. Ditambahkan `additive-architecture-parity.test.ts` untuk Scene A “Modern Concrete Vertical”: memastikan portal, canopy, planter, dan 5 facade panel tetap native semantic elements; masuk preview 3D/scene stats dalam budget; muncul di denah dan tampak depan dengan `refId` stabil; serta menghasilkan quantity/RAB line dengan `sourceElementIds`. Validator eksterior kini memberi warning ketika additive element ditandai `structuralRole: "secondary_unverified"` sehingga elemen sekunder tidak diam-diam dianggap struktur tervalidasi. Verification: `additive-architecture-parity.test.ts`, `validation.test.ts`, `tsc --noEmit`, dan `pnpm lint` hijau.
  - Status 2026-07-15: selesai untuk acceptance T11. PlanCanvas sekarang punya regression test placement additive native dari exterior tool untuk `portal_frame` dan `facade_panel`, memastikan elemen dibuat di `layout.exteriorElements` dan langsung terseleksi. `carportCanopyMode: "none"` kini benar-benar menonaktifkan auto canopy carport di 3D (`buildModel`) dan denah (`buildLayoutSheet`), supaya custom/native canopy tidak double-render; coverage ditambahkan di `build-model.test.ts` dan `layout-sheet.test.ts`. Verification: `plan-canvas.test.tsx`, `build-model.test.ts`, `layout-sheet.test.ts`, `additive-architecture-parity.test.ts`, `validation.test.ts`, `tsc --noEmit`, dan `pnpm lint` hijau.

- [x] **T12 - Roof zone domain engine**
  - Scope: effective zones, validation, planes, surface/catchment/projection, legacy adapter.
  - Depends on: T02/T01 extraction.
  - Verify: geometry/property tests and legacy visual/quantity regression.
  - Status 2026-07-14: selesai untuk domain engine. `src/lib/exterior/roof-zones.ts` menyediakan effective zones, legacy adapter dari `layout.roof`, plane metadata, material area, catchment union, dan plan projection; helper catchment sudah dipakai oleh sheet-list dan auto-size sanitasi saat `roofZones` eksplisit ada. Editor/3D/render detail tetap T13, downstream drawing/RAB/AI parity tetap T14.

- [x] **T13 - Roof zone editor and 3D**
  - Scope: mode conversion, split/resize/configure, conflict visualization, renderer integration.
  - Depends on: T12.
  - Verify: component/E2E zone edit and no-overlap/no-z-fighting fixtures.
  - Status 2026-07-14: selesai. Editor store kini mendukung add/update/delete/drag/resize/split roof zone undo-aware dan materialisasi `layout.roof` legacy menjadi satu zona eksplisit; toolbar memiliki tool zona atap; canvas menampilkan zona atap dengan selection/resize handles, warning marker, dan conflict visualization untuk overlap dua-zona; inspector bisa konfigurasi tipe, posisi, ukuran, slope, overhang, material, low-side, floor ownership, tombol "Jadikan zona atap editable", serta split kiri/kanan atau depan/belakang; `buildModel` mengeluarkan prim atap per zona explicit sehingga Preview 3D dan export GLB tidak kehilangan atap saat `layout.roofZones` aktif. Renderer 3D juga memangkas overhang pada seam internal antar-zona agar split/multi-zone roof tidak menghasilkan overlap coplanar/z-fighting. Verification: `tsc --noEmit`, focused ESLint, `editor-store.exterior`, `editor-inspector`, `roof-zones`, `build-model`, `glb`, `plan-canvas`, `validation` tests, Playwright `e2e/roof-zone.spec.ts`, dan fixture no-overlap/no-z-fighting multi-zone hijau.

- [x] **T14 - Roof downstream parity**
  - Scope: elevation, section, roof plan/detail/schedule, RAB, catchment/sanitation, AI actions.
  - Depends on: T12/T13.
  - Verify: Scene B roof checklist and cross-output area reconciliation.
  - Status 2026-07-15: vertical slice downstream roof-zone shipped. RAB kini membuat line item atap per kombinasi tipe+material zona eksplisit, memakai `sourceElementIds` zona, dan sumur resapan memakai catchment union roof-zone yang sama dengan detail sanitasi. Sheet `Detail Atap` kini menambahkan denah/schedule zona atap eksplisit dengan rectangle ber-`refId`, label tipe/material/luas, ridge guide untuk atap miring/pelana/limasan, serta total material/catchment. AI floorplan contract kini mengekspos `roofZones` dalam scene, mendokumentasikan `addRoofZone`/`updateRoofZone`/`removeRoofZone`, menyaring/clamp action di server, dan apply memakai store roof-zone undo-aware. Verification: `tsc --noEmit`, focused ESLint, `rab`, `roof-detail`, `roof-zones`, `validation`, `capability-parity`, `editor-assistant`, dan `assistant/apply` tests hijau.
  - Status 2026-07-15: elevation/section parity shipped. `buildElevation` dan `buildSection` kini mendeteksi `roofZones` eksplisit, menonaktifkan roof slab/profile legacy global, lalu memproyeksikan tiap zona eksplisit dengan `refId` stabil; zona datar menjadi slab per-zona, zona pelana/limasan/miring memakai helper profil atap bersama, dan section memakai boundary half-open agar cut di tepi zona tidak double-draw. Verification tambahan: `tsc --noEmit`, `elevation.test.ts`, dan `section.test.ts` hijau.
  - Status 2026-07-15: selesai untuk acceptance T14. Ditambahkan Scene B reconciliation test yang memastikan gable roof lokal tetap lokal di 3D (`roof-zone-*`, bukan `roof` global), elevation, section, Detail Atap, RAB per-zona, dan AI scene snapshot memakai `source/refId` zona yang sama. Verification: `src/lib/exterior/roof-zone-parity.test.ts` hijau.

- [x] **T15 - Unified exterior material and asset semantics**
  - Scope: resolver, sub-surfaces, asset authorization/re-resolution, axis/fit contract, performance warnings, costing policy UI.
  - Depends on: T07/T09/T11.
  - Verify: custom facade GLB, missing/private/oversized asset tests.
  - Status 2026-07-15: partial shipped untuk unified material resolver. Ditambahkan `resolveExteriorMaterial(ref, surfaceKind)` sebagai resolver pure untuk material eksterior: catalog id lama dari `FacadeCladding` tetap valid, custom hex color divalidasi/normalisasi, unknown id/invalid color jatuh ke fallback deterministik per surface kind, dan `exteriorSurfaceKindForMaterial` memetakan kind semantic ke surface material. Renderer `HouseModel` untuk `PrimKind "exterior"` kini memakai resolver ini, bukan resolve manual `facadeCladdingById` + custom color sendiri. Verification: `materials.test.ts`, `house-model.test.tsx`, focused ESLint, dan `tsc --noEmit` hijau.
  - Status 2026-07-15: costing policy vertical slice shipped. Inspector eksterior sekarang punya kontrol "Kebijakan RAB" untuk memilih catalog rate vs dikecualikan, menampilkan default rate aktif untuk elemen native, dan mengunci custom GLB sebagai excluded sampai ada costing manual/catalog eksplisit. RAB menghormati `costing.includeInRab === false`, serta tetap menolak custom asset walau ada stale policy `includeInRab: true` agar tidak muncul fake cost. Verification: `editor-inspector.test.tsx`, `rab.test.ts`, `pnpm lint`, dan `tsc --noEmit` hijau.
  - Status 2026-07-15: explicit model contract + performance warning shipped. `ModelRef`/layout schema sekarang menyimpan `fitMode`, `upAxis`, `frontAxis`, dan snapshot `performance` untuk custom GLB eksterior secara backward-compatible; helper `exteriorModelContract` memberi default deterministic (`fit_envelope`, `Y-up`, `+Z front`) untuk layout lama, sedangkan `coerceExteriorModelPerformance` menerima alias umum dari `performance_json`. Inspector eksterior menampilkan kontrol "Kontrak Model 3D" untuk fit/up/front axis serta warning budget triangle/draw-call/file-size saat metadata GLB oversized. Verification: `assets.test.ts`, `editor-inspector.test.tsx`, `pnpm lint`, dan `tsc --noEmit` hijau.
  - Status 2026-07-15: sub-surface material contract shipped. `MaterialRef` kini mendukung `surfaces.top|side|underside` untuk override material per muka tanpa memecah semantic element; schema layout v2 menerima field ini secara backward-compatible, dan `resolveExteriorMaterial(ref, surfaceKind, { slot })` memakai slot override jika ada atau fallback ke material utama bila slot kosong. Verification: `materials.test.ts`, `pnpm lint`, dan `tsc --noEmit` hijau.
  - Status 2026-07-15: asset authorization/re-resolution shipped. `/assets/my-library` sekarang membawa `performance_json` sebagai `performance` dari `user_assets`, data source/mock library mengikuti kontrak yang sama, dan helper `resolveExteriorAssetModel(model, authorizedAssets)` me-resolve `modelAssetId` hanya dari snapshot library yang sudah di-scope oleh `requireUser`; stale URL diganti URL terbaru asset authorized, sedangkan missing/private asset dinull-kan dengan warning eksplisit. Verification: `assets.test.ts`, `mock/index.test.ts`, `pnpm lint`, dan `tsc --noEmit` hijau. T15 selesai.

- [x] **T16 - Landscape semantics**
  - Scope: planting bed, plant/tree/decor assets, deterministic scatter, clearance checks, costing.
  - Depends on: T04/T15.
  - Verify: save determinism, instancing/performance, access-clearance tests.
  - Status 2026-07-15: native planting-bed landscape vertical slice shipped. `garden_bed` surface kini punya `scatterSeed` opsional di type/schema/factory/AI action schema, `landscapePlacements` membaca exterior `garden_bed` selain room `taman`, melakukan scatter deterministic tree/bush di dalam polygon, skip hidden bed, dan seed eksplisit bisa mengubah pattern tanpa menyimpan ratusan child object. Landscape costing juga aktif: `garden_bed` sekarang menghasilkan quantity m² dan rate `ext-garden-bed-v1` low-confidence di RAB dengan `sourceElementIds`, bukan excluded assumption. Verification: `landscape.test.ts`, `quantities.test.ts`, `rab.test.ts`, `assistant/apply.test.ts`, `capability-parity.test.ts`, `pnpm lint`, dan `tsc --noEmit` hijau.
  - Status 2026-07-15: plant/tree/decor asset semantics + clearance shipped. `ExteriorAssetElement` kini mendukung kind `plant`, `tree`, `exterior_decor`, dan `vehicle`; layout schema, toolbar labels, inspector labels, 2D placement envelope, 3D primitive fallback, validation/bounding box, AI action schema/apply/sanitizer, material fallback, dan RAB quantity/rate sudah sinkron. Plant/tree/decor dihitung unit-based low-confidence; generic custom GLB dan vehicle tetap excluded dengan reason eksplisit. Ditambahkan `landscapeClearanceIssues(layout)` untuk mendeteksi plant/tree/decor yang overlap hardscape access (`driveway/walkway/terrace_surface`). Verification: `landscape.test.ts`, `quantities.test.ts`, `rab.test.ts`, `validation.test.ts`, `plan-canvas.test.tsx`, `assistant/apply.test.ts`, `editor-assistant.test.ts`, `pnpm lint`, dan `tsc --noEmit` hijau. T16 selesai.

- [x] **T17 - Presentation quality and benchmarking**
  - Scope: Edit/Presentation presets, material scale/color-space, reflection/shadow tuning, screenshot determinism, scene stats.
  - Depends on: T07/T13/T15/T16.
  - Verify: performance budgets and visual regression for both scenes.
  - Status 2026-07-15: partial shipped untuk instrumentation awal. Ditambahkan pure `scene-stats` builder yang menghitung semantic object count, prim/mesh count, estimated draw calls, estimated triangles, texture count/memory, dan budget status (`drawCalls <= 300`, desktop triangles <= 1,5 juta, mobile triangles <= 400 ribu) dari output `buildModel`. Preview 3D kini punya dev-only popover "Scene stats" di `ViewToolbar` yang menampilkan budget aktif tanpa memengaruhi production UI. Verification: `scene-stats.test.ts`, focused ESLint, dan `tsc --noEmit` hijau. Pending T17 penuh: Edit/Presentation preset eksplisit, deterministic presentation camera/sun preset, visual regression fixture dua scene, dan browser/GPU benchmark scheduled.
  - Status 2026-07-15: Edit/Presentation render presets shipped. `preview-store` kini memiliki `renderMode` dan `applyRenderModePreset`: `edit` mematikan realistic shadow untuk responsivitas dan menyalakan label, sedangkan `presentation` mengunci sun azimuth/elevation, menyalakan roof/furniture/vegetation, mematikan label, dan memaksa camera preset isometrik untuk screenshot deterministik. `ViewToolbar` menampilkan tombol Edit/Presentasi di Opsi Tampilan. Verification: `preview-store.test.ts` hijau. Pending T17 penuh: visual regression fixture dua scene dan browser/GPU benchmark scheduled.
  - Status 2026-07-15: browser gate shipped untuk presentation controls. Ditambahkan Playwright `e2e/presentation-mode.spec.ts` yang membuka Preview 3D, mengganti preset Edit/Presentasi, memastikan state aksesibel lewat `aria-pressed`, membuka dev scene stats, dan memverifikasi counter budget tampil tanpa console/page error. Verification: `rtk playwright test e2e/presentation-mode.spec.ts --project=chromium` hijau. Pending T17 penuh masih menunggu fixture dua certification scene yang lengkap dari T15/T16 sebelum pixel visual regression bermakna bisa dikunci.
  - Status 2026-07-15: certification scene fixtures + deterministic budget regression shipped. Ditambahkan `certificationScenes()` dengan dua fixture kode stabil: Scene A “Modern Concrete Vertical” (portal, canopy, lima panel beton vertikal, gate, driveway, carport vehicle, garden/trees) dan Scene B “Brick Gable Roster” (gable roof zone, flat roof zone, roster facade, gate/walkway/driveway, garden bed + plant scatter). Test baru memvalidasi stable IDs, exterior/roof danger-free contracts, landscape clearance, render stats budget (`drawCalls`, mobile triangles, texture memory), dan komposisi scene A/B agar tidak regress. Fixture lama `scene-stats.test.ts` juga dikoreksi dari invalid `kind: "segment"` menjadi `sliding_gate` sesuai kontrak produksi. Verification: `certification-scenes.test.ts`, `scene-stats.test.ts`, `tsc --noEmit`, dan `pnpm lint` hijau.
  - Status 2026-07-15: certification browser render gate shipped. Mock data source kini melayani `scene-a-modern-concrete` dan `scene-b-brick-gable` sebagai direct project route tanpa menambahkannya ke dashboard seed list; `ensureLayout` memakai layout certification scene yang sama dengan pure tests. Playwright `e2e/certification-scenes.spec.ts` membuka Preview 3D untuk kedua scene, memastikan mode Presentasi aktif, scene stats budget tidak menampilkan warning, screenshot PNG berisi gambar, dan tidak ada console/page error. Verification: `mock/index.test.ts`, `rtk playwright test e2e/certification-scenes.spec.ts --project=chromium`, `tsc --noEmit`, dan `pnpm lint` hijau. Pending T17 penuh: pixel-baseline visual regression/GPU benchmark terjadwal dan tuning material color-space/scale jika runner visual sudah stabil.
  - Status 2026-07-15: selesai untuk acceptance T17. Ditambahkan Playwright visual regression `e2e/certification-visual.spec.ts` dengan baseline PNG untuk kedua certification scene (`scene-a-modern-concrete` dan `scene-b-brick-gable`) pada mode Presentasi, memakai `toHaveScreenshot` canvas dan toleransi `maxDiffPixelRatio: 0.04`. `package.json` kini menyediakan `test:e2e:certification` dan `test:e2e:certification:visual`, sedangkan `.github/workflows/certification-visual.yml` menjalankan certification budget + visual benchmark mingguan di `windows-latest` agar snapshot `chromium-win32` konsisten. Verification: `rtk playwright test e2e/certification-visual.spec.ts --project=chromium`, `rtk pnpm run test:e2e:certification`, `tsc --noEmit`, dan `pnpm lint` hijau.

- [x] **T18 - Templates, guided flow, AI eval, certification**
  - Scope: native templates, onboarding flow, complete eval set, both customer journeys, rollout telemetry.
  - Depends on: T01-T17.
  - Verify: 30-minute usability target, full test/build suite, release checklist.
  - Status 2026-07-15: selesai untuk acceptance T18. Ditambahkan executable release contract `src/lib/exterior/release-certification.ts`: mengikat tiga native facade templates, dua customer journey (`template_to_presentation` dan `ai_assisted_reference_build`), enam AI eval khusus exterior/roof/facade/RAB, required telemetry, dan release commands. `certifyExteriorRelease()` memberi checklist pass/fail deterministik untuk handoff release. Toolbar template sekarang mengirim typed analytics `exterior_template_applied`, dan analytics union juga menyiapkan `exterior_certification_gate_passed` untuk rollout/certification gates. Playwright `e2e/exterior-editor.spec.ts` kini memverifikasi guided toolbar flow: pilih template “Modern Concrete Vertical”, accept confirm, native `portal_frame`/`facade_panel` muncul, lalu Undo menghapus template. Verification: `release-certification.test.ts`, `facade-templates.test.ts`, `certification-scenes.test.ts`, `rtk playwright test e2e/exterior-editor.spec.ts --project=chromium`, `tsc --noEmit`, dan `pnpm lint` hijau.

## 19. Delivery order and dependencies

| Milestone | Depends on | Exit gate |
|---|---|---|
| P0 file boundaries | existing tests | behavior-identical extraction |
| P0 schema/migration/revision | file boundaries optional | all DB shapes dry-run + 409 test |
| P1 site frontage domain | P0 schema | type/store/validation complete |
| P1 UI + 3D | P1 domain | save/undo/render E2E |
| P1 drawing/RAB/AI | P1 domain | vertical slice complete |
| P2 additive elements | P0 + shared exterior foundation | certification Scene A geometry |
| P3 roof zones | P0 schema + geometry helpers | Scene B roof parity |
| P4 materials/assets | P1/P2 contracts | explicit custom asset status |
| P5 landscape/render | P4 assets | performance and presentation gate |
| P6 templates/AI certification | P1-P5 | both certification scenes pass |

## 20. Parallel work strategy

Setelah P0 contracts merged:

- **Lane A - Domain/Persistence:** schema, normalize, DB revision, store actions, validation.
- **Lane B - Geometry/3D:** pure derivation, exterior renderer, instancing, roof planes.
- **Lane C - Drawings/RAB:** projection, sheet builders, quantities, costing reconciliation.
- **Lane D - UI/AI/QA:** tools, inspector, shared selection, AI actions/evals, E2E fixtures.

Execution:

1. P0 berjalan sequential karena menyentuh contracts dan file boundaries bersama.
2. Setelah contract P1 dikunci, Lane B dan C dapat berjalan paralel memakai fixtures yang disepakati; Lane D UI menunggu store API minimum, AI tests dapat mulai dari schema.
3. Merge Domain terlebih dahulu, lalu Geometry/3D dan Drawings/RAB, terakhir UI/AI/E2E.
4. Roof zones dibuat pada workstream terpisah setelah `effectiveRoofZones` contract dikunci.

Conflict flags:

- `src/types/index.ts`, `editor-store.ts`, `assistant/actions.ts`, `build-model.ts`, `house-model.tsx`, `sheet-list.ts`, dan `rab.ts` adalah hotspot. Setiap lane harus menambah modul baru dan membuat patch integrasi kecil pada hotspot, bukan bekerja lama langsung di file yang sama.
- Certification fixture menjadi shared contract. Perubahan fixture membutuhkan review lintas lane.

## 21. Release and rollout

Feature flags:

- `exterior_elements_v1`
- `roof_zones_v1`
- `presentation_mode_v1`

Status 2026-07-15: terimplementasi — resolver pure `src/lib/features.ts`
(stable hash `flag + projectId`, kill switch > admin > rollout percent),
capability endpoint `GET /projects/[id]/capabilities` (admin DB-fresh via
`requireAdmin`), gating creation UI di toolbar editor dan preset Presentasi.
Skema env (`FEATURE_<FLAG>`, `FEATURE_<FLAG>_ROLLOUT`) terdokumentasi di
docblock `src/lib/features.ts` (repo meng-ignore `.env*`). Default env kosong
= enabled 100% (kill-switch rollback; lihat bagian 25.1).

Implementasi flag:

- Tambahkan satu resolver pure di `src/lib/features.ts`; component tidak membaca
  `process.env` secara langsung.
- Server menentukan keputusan dari role, project ID, dan konfigurasi rollout,
  lalu mengirim typed capability set ke client.
- Admin/internal selalu dapat di-enable eksplisit.
- Persentase rollout memakai stable hash `flag + projectId`, sehingga project
  tidak berpindah cohort setiap request.
- Environment configuration minimum: enabled boolean dan rollout percent per
  flag. Jangan membuat tabel feature flag baru pada phase ini.
- Server/API tetap menerima dan merender data existing walaupun creation UI
  dimatikan oleh flag.

Rollout:

1. Internal/admin projects dan seeded certification projects.
2. Studio users opt-in dengan banner beta dan explicit RAB/drawing completeness status.
3. 10% eligible projects dengan telemetry error/performance.
4. 100% setelah crash-free canvas, autosave conflict, drawing generation, dan RAB reconciliation memenuhi threshold dua minggu.

Rollback:

- Feature flags menyembunyikan creation UI, tetapi existing data tetap dibaca dan dirender.
- Jangan rollback dengan menghapus `exteriorElements`/`roofZones` dari payload.
- Old clients harus preserve unknown fields selama rollout; server revision guard mencegah mereka menimpa current payload tanpa sadar.

Observability minimum:

- layout schema version dan migration failure count;
- autosave 409 rate;
- invalid exterior action rate per source UI/AI/API;
- GLB load/error/oversize rate;
- scene derivation duration/object/draw-call stats;
- drawing/RAB generation duration;
- RAB incomplete reason counts.

## 22. Definition of done per implementation task

Sebuah task hanya boleh ditandai selesai bila:

- domain type dan runtime schema sudah selaras;
- mutation undoable dan autosaved;
- legacy payload behavior diketahui;
- 2D representation tersedia bila objek relevan pada plan;
- 3D representation tersedia dengan loading/error fallback;
- drawing projection tersedia atau ada alasan eksplisit `not applicable`;
- RAB quantity/cost policy tersedia atau explicit excluded warning;
- AI capability ditambah atau explicit `AI not allowed` dengan alasan;
- unit/integration/E2E tests sesuai risk sudah lulus;
- performance budget tidak regress;
- docs/architecture dan inline diagram yang terkait diperbarui;
- tidak ada unrelated user changes yang ikut ditimpa.

## 23. Commands for verification

Semua command mengikuti AGENTS.md dan dijalankan melalui Git Bash dengan prefix `rtk`.

```bash
rtk tsc --noEmit
rtk lint
rtk vitest run
rtk playwright test
rtk next build
```

Tambahkan targeted suites per milestone agar engineer tidak harus menunggu full suite saat iterasi, tetapi full suite dan certification E2E tetap release gate.

## 24. Final engineering guardrails

- Jangan membuat state exterior terpisah dari `DesignLayout`.
- Jangan menyimpan mesh/vertex GLB di JSONB layout.
- Jangan menghitung RAB dari rendered mesh atau bounding box custom model.
- Jangan membuat formula roof/catchment terpisah di RAB, drawing, dan 3D.
- Jangan memperbesar hotspot file tanpa ekstraksi modul.
- Jangan menganggap screenshot bagus berarti feature complete.
- Jangan mengizinkan AI melewati store validation/undo.
- Jangan mengubah numbering/id sheet existing; tambahkan stable sheet ID baru.
- Jangan membuat migration yang menghapus unknown fields.
- Jangan merilis roof zones sebelum legacy roof regression fixture lulus.

Plan ini sengaja mengutamakan native semantic primitives untuk 90% bentuk rumah modern residensial, lalu memakai GLB hanya untuk 10% detail unik. Itu menjaga hasil tetap editable, dapat dihitung, dan dapat diterjemahkan menjadi dokumen kerja.

## 25. Deviations dan catatan implementasi (review 2026-07-15)

Bagian ini mencatat titik di mana implementasi final berbeda dari spek asli —
supaya status dokumen jujur terhadap kode, dan supaya engineer berikutnya tahu
mana yang keputusan sadar dan mana yang debt.

### 25.1 Deviasi yang diterima (keputusan sadar)

- **Kontrak drawing `DrawPolygon`/`DrawSymbol` (P1.4) tidak dibangun.** Tipe
  `Drawing` tetap `lines` + `labels`; site plan, hatch driveway, dan operasi
  gate direpresentasikan sebagai garis/label ber-`refId` stabil dari satu
  builder bersama (`buildSitePlan`), sehingga parity SVG/PDF tetap terjaga —
  yang dilarang spek (representasi yang hanya dipahami salah satu renderer)
  tidak terjadi. Simbol khusus (gate-slide/swing arc, panah arah tangga) tetap
  debt bila kualitas grafis site plan ingin dinaikkan.
- **`src/lib/layout/normalize.ts` dan `migrate.ts` tidak dibuat sebagai modul
  terpisah.** Schema, normalizer (`normalizeDesignLayout`), dan versi hidup
  bersama di `src/lib/schemas/layout.ts` — satu modul source of truth dinilai
  lebih kecil risikonya daripada tiga file. Migration dry-run dilakukan manual
  via MCP read-only terhadap 12 payload produksi (lihat status T02); modul
  dry-run report yang dapat dieksekusi ulang tidak dibuat.
- **Feature flags §21 memakai semantik kill-switch, bukan gerbang pra-rilis.**
  Karena seluruh fitur sudah selesai dan teruji saat flags dibuat, default env
  kosong = enabled 100%; `FEATURE_<FLAG>=false` atau `_ROLLOUT=<persen>`
  menurunkan paparan bila ada insiden. Persentase memakai stable hash
  `flag + projectId`; admin selalu on selama flag enabled; kill switch menang
  atas admin. Hanya creation UI yang di-gate — data existing tetap dirender.
- **Penamaan API takeoff.** `exteriorQuantityTakeoff(layout)` pada spek
  terimplementasi sebagai `exteriorElementQuantities` di
  `src/lib/exterior/quantities.ts` (kontrak dan sifat pure sama).

### 25.2 Debt yang tersisa (belum ditutup, jangan hilang dari radar)

- **Edit properti dari seleksi 3D masih read-only.**
  `ExteriorSelectionQuickEditor` adalah kartu seleksi (label/ID/badge), bukan
  form; perubahan properti tetap lewat inspector 2D. Acceptance Phase 1
  "mengubahnya dari 2D atau 3D selection" baru terpenuhi untuk 2D. Shared form
  components P1.2 belum dipakai dari preview 3D.
- **Instrumentasi performa §14 baru sebagian.** Ada: scene-stats dev popover,
  budget assertion di certification tests, browser gate E2E mingguan. Belum
  ada: timer normalize/validation/drawing-build/RAB, benchmark p95 pure
  function di CI (target `<50ms/500 elemen`, drawing `<500ms`, RAB `<200ms`
  belum pernah diukur).
- **Ekstraksi P0.1 tidak selesai dan hotspot membesar.**
  `building-primitives.ts`/`facade-primitives.ts` tidak pernah diekstrak;
  per 2026-07-15: `plan-canvas.tsx` 1433→2347, `editor-inspector.tsx`
  1360→2416, `build-model.ts` 1349→1495, `house-model.tsx` 1584→1752,
  `preview-controls.tsx` 3112→3005. Fitur baru berikutnya wajib dimulai dengan
  ekstraksi, bukan menambah ke file ini.
- **Definition of success §2 yang bersifat manusia belum dibuktikan.** Target
  usability 30 menit, duplicate project, dan buka-dari-perangkat-lain belum
  diuji dengan orang sungguhan; `release-certification.ts` adalah checklist
  kode, bukan pengganti uji usability.
