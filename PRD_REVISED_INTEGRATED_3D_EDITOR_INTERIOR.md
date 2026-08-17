# PRD Revisi & Implementation Spec - Integrated 3D Editor + Interior Design + Realistic Assets

Product: Baruma  
Module: Integrated 3D Editor with Interior Design Layer  
Status: Revised PRD for implementation  
Date: 2026-06-24  
Owner: Product + Engineering  
Supersedes: `PRD & Implementation Spec - Modul Ruang Detail + Interior Design + Realistic 3D Assets.md`

## 1. Executive Summary

Baruma membutuhkan satu pengalaman editor 3D terpadu untuk melihat denah rumah, memilih ruang, menambahkan furniture interior, mengatur style, mengecek warning ergonomi, melihat estimasi budget, dan menyiapkan export. Interior design tidak boleh menjadi editor terpisah atau menu desain sendiri. Interior adalah layer kerja di dalam 3D editor existing.

Canonical route:

```txt
/app/projects/[projectId]/preview-3d
```

Route lama `/app/projects/[projectId]/interior` hanya boleh menjadi backward-compatible redirect ke `/preview-3d`. Halaman `Materials` dan `Furniture` tetap boleh ada, tetapi posisinya sebagai schedule/data management, bukan tempat utama mendesain interior.

Keputusan produk utama:

1. Satu 3D editor untuk layout rumah + interior.
2. Furniture seperti kasur, lemari, TV, sofa, meja, kitchen set, dan item interior lain harus bisa ditambahkan, dipilih, dipindah, di-rotate, dan dihapus dari 3D editor.
3. Sidebar editor harus floating di atas canvas, punya overflow sendiri, dan tidak membuat halaman utama ikut scroll.
4. Label interior harus bisa show/hide.
5. Modal/dialog/sheet/dropdown aplikasi harus selalu tampil di atas label atau HTML overlay dari scene 3D.
6. Realistic 3D assets memakai GLB bila tersedia, tetapi selalu punya fallback geometri agar editor tetap berfungsi.
7. Semua perubahan wajib E2E tested.

## 2. Problem Statement

Versi PRD sebelumnya memosisikan interior sebagai modul/halaman baru yang berdiri sendiri. Pola itu membuat beberapa masalah:

- Pengguna merasa ada dua editor berbeda: 3D preview rumah dan interior room editor.
- State furniture, budget, warning, dan style rawan terpecah antara halaman interior dan preview 3D.
- Furniture bisa muncul di 2D layout interior tetapi tidak menjadi bagian dari pengalaman 3D editor utama.
- UX sidebar dan overflow menjadi sulit konsisten karena ada banyak permukaan editor.
- Testing menjadi tidak mewakili workflow nyata yang diinginkan user.

Solusi revisi: interior menjadi layer di dalam integrated 3D editor. Data management boleh terpisah, tetapi aktivitas desain visual terjadi di satu tempat.

## 3. Goals

### 3.1 Product Goals

- Pengguna membuka satu 3D editor dan langsung bisa melihat rumah serta interior dalam konteks layout penuh.
- Pengguna bisa memilih ruang dari scene atau sidebar, lalu mengatur interior ruang tersebut.
- Pengguna bisa menambahkan furniture melalui pencarian dan quick add.
- Pengguna bisa mengedit furniture aktif: pilih, geser/nudge, rotate, hapus, dan reset ruang.
- Pengguna bisa mengganti style interior dan melihat perubahan pada palette, material, budget, dan scene.
- Pengguna bisa menampilkan atau menyembunyikan label ruang dan label interior secara terpisah.
- Pengguna bisa membuka schedule material/furniture dari editor tanpa berpindah ke editor lain.
- Pengguna mendapat warning ergonomi dan budget secara real-time setelah perubahan.
- Pengguna mendapat render 3D yang informatif, stabil, dan performan, bukan harus photorealistic.

### 3.2 Engineering Goals

- Gunakan domain model existing Baruma:
  - `DesignLayout`
  - `Room`
  - `RoomType`
  - `InteriorPlan`
  - `RoomInteriorPlan`
  - `FurnitureItem`
  - `PlacedFurniture`
  - `MaterialAssignment`
  - `LightingFixture`
- Gunakan `useInteriorStore` sebagai source of truth interior runtime.
- Gunakan `usePreviewStore` hanya untuk state presentasi preview 3D.
- Jangan membuat model paralel seperti `InteriorRoom` jika informasinya sudah ada di `Room` atau `RoomInteriorPlan`.
- Jangan membuat route editor interior baru.
- Asset GLB harus lazy-loaded dan punya fallback.
- Unit, component, dan E2E tests harus menutup critical path.

## 4. Non-Goals

- Tidak membuat halaman desain interior baru yang berdiri sendiri.
- Tidak membuat flow tab interior dengan 2D Layout, 3D Room, Moodboard, Budget sebagai editor utama.
- Tidak menjanjikan render photorealistic atau ray-tracing.
- Tidak menggantikan pekerjaan arsitek/interior designer profesional.
- Tidak membuat procurement atau checkout furniture.
- Tidak membuat backend produksi baru dalam fase ini. Persistensi boleh memakai data source/mock API existing sampai backend final tersedia.

## 5. Information Architecture

### 5.1 Canonical Routes

```txt
/app/projects/[projectId]/preview-3d
```

Fungsi:

- Full-house 3D preview.
- Integrated interior editor.
- Room selection.
- Furniture add/edit/delete.
- Interior label controls.
- Warnings and budget summary.
- Link ke schedule/data management.

```txt
/app/projects/[projectId]/materials
/app/projects/[projectId]/furniture
```

Fungsi:

- Read-only or management-oriented schedule.
- Menampilkan material/furniture per ruang.
- Menjadi tempat pengaturan harga, catalog, atau schedule detail.
- Bukan editor visual utama.

```txt
/app/projects/[projectId]/exports
```

Fungsi:

- Export contractor pack, interior pack, screenshot, schedule, dan data lain sesuai entitlement.

### 5.2 Redirect Routes

```txt
/app/projects/[projectId]/interior
```

Behavior:

- Redirect ke `/app/projects/[projectId]/preview-3d`.
- Jika ada query `?room=[roomId]`, pertahankan sebagai query target.
- Tidak render editor interior sendiri.

### 5.3 Navigation Rule

Project navigation tidak boleh menampilkan "Interior" sebagai editor terpisah. Label yang disarankan:

- `3D Preview` atau `3D Editor`
- `Materials`
- `Furniture`
- `Exports`

## 6. UX Requirements

### 6.1 Desktop Layout

Desktop 3D editor memakai layout:

```txt
-------------------------------------------------------
|                                                     |
|             Full 3D canvas / scene                  |
|                                                     |
|                         --------------------------  |
|                         | Floating editor panel  |  |
|                         | independent overflow   |  |
|                         | interior controls      |  |
|                         --------------------------  |
|                                                     |
-------------------------------------------------------
```

Requirements:

- Scene/canvas mengambil area utama.
- Sidebar editor berada sebagai floating panel di kanan.
- Sidebar `position: absolute` di dalam container preview.
- Sidebar punya height bounded (`top`, `bottom`) dan `overflow: hidden`.
- Konten internal sidebar punya `overflow-y: auto`.
- Tidak boleh ada horizontal scroll di sidebar pada desktop.
- Style selector compact wajib satu kolom di floating panel.
- Tombol dan label panjang harus truncate/wrap secara profesional.
- Scene tetap bisa rotate/zoom/pan walaupun sidebar floating.

### 6.2 Mobile Layout

Mobile 3D editor memakai drawer/sheet:

- Canvas tetap menjadi permukaan utama.
- Tombol kontrol membuka drawer.
- Drawer maksimal sekitar 80-85svh.
- Isi drawer punya overflow sendiri.
- Tidak ada horizontal overflow.
- Semua kontrol utama tetap tersedia: room selection, add furniture, active furniture, edit/delete, labels, view, materials, floors.

### 6.3 Floating Editor Panel Sections

Panel 3D editor minimal berisi:

1. Header `Preview 3D`.
2. Selected room summary.
3. Interior 3D editor:
   - daftar ruang yang didukung interior;
   - style selector compact;
   - furniture quick add;
   - active furniture list;
   - selected furniture inspector;
   - warning ergonomi;
   - budget mid;
   - link ke Materials/Furniture schedule;
   - reset interior ruang.
4. View controls:
   - isometric;
   - front;
   - top;
   - rooftop;
   - screenshot.
5. Material preset controls.
6. Floor visibility controls.
7. Display options:
   - roof visibility;
   - room labels;
   - interior labels;
   - furniture visibility.

### 6.4 Label Layering

3D scene boleh memakai HTML labels untuk room/furniture labels, tetapi:

- App modal/dialog/sheet/dropdown/popover/toast harus selalu tampil di atas label 3D.
- HTML label dari scene harus punya z-index range di bawah overlay app.
- Target app overlay minimum: `z-index >= 50`.
- Target 3D labels: maksimum effective z-index `< 50`.
- Label harus `pointer-events: none` kecuali ada alasan interaksi yang eksplisit.
- E2E wajib mengecek modal/dialog tidak tertutup oleh label 3D.

## 7. User Flows

### 7.1 Open Integrated 3D Editor

1. User membuka project.
2. User klik `3D Preview` atau `3D Editor`.
3. App membuka `/app/projects/[projectId]/preview-3d`.
4. Scene 3D load secara lazy.
5. Interior plan dibuat dari layout existing bila belum ada.
6. Ruang interior pertama otomatis dipilih.
7. Sidebar floating menampilkan kontrol interior.

Success criteria:

- Tidak ada halaman Interior terpisah.
- Furniture default tampil di scene jika `showFurniture` aktif.
- Label interior tampil jika `showInteriorLabels` aktif.

### 7.2 Add Furniture

1. User memilih ruang.
2. User mencari item, misalnya `kasur`, `lemari`, `TV`, `sofa`, atau `meja`.
3. User klik item.
4. Item muncul di active furniture list.
5. Item muncul di scene 3D pada posisi default yang masuk akal.
6. Budget dan warning dihitung ulang.

Success criteria:

- Item bisa ditambahkan meski tidak recommended untuk room type, tetapi diberi status manual atau warning bila perlu.
- Object baru otomatis selected.
- Object tidak diletakkan keluar dari batas ruang.

### 7.3 Edit Furniture

1. User memilih furniture dari scene atau active furniture list.
2. Sidebar menampilkan inspector.
3. User bisa:
   - geser kiri/kanan/maju/mundur;
   - rotate 90 derajat;
   - hapus;
   - reset ruang.
4. Scene, list, warning, dan budget update.

Success criteria:

- Perubahan terjadi di satu source of truth.
- Tidak ada mismatch antara scene dan sidebar.
- Delete menghapus object dari scene dan list.

### 7.4 Toggle Interior Labels

1. User membuka display options.
2. User mematikan `Label interior`.
3. Semua label furniture interior hilang.
4. User mengaktifkan kembali.
5. Label interior tampil lagi.

Success criteria:

- Toggle interior labels tidak mempengaruhi label ruang.
- Toggle room labels tidak mempengaruhi label interior.

### 7.5 Open Management Pages

1. User klik `Materials` atau `Furniture` dari sidebar.
2. App membuka schedule page.
3. Page menampilkan data dari interior plan/layout.
4. User dapat kembali ke 3D editor.

Success criteria:

- Materials/Furniture adalah schedule/data management.
- Tidak ada editor visual terpisah di halaman tersebut.

## 8. Functional Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-01 | `/preview-3d` adalah satu-satunya editor visual untuk 3D + interior. | P0 |
| FR-02 | `/interior` redirect ke `/preview-3d`. | P0 |
| FR-03 | Project nav tidak punya menu Interior sebagai editor terpisah. | P0 |
| FR-04 | User bisa memilih ruang dari scene atau sidebar. | P0 |
| FR-05 | User bisa mencari dan menambahkan furniture: kasur, lemari, TV, sofa, meja, kitchen, appliance, decor. | P0 |
| FR-06 | User bisa memilih furniture dari scene atau active list. | P0 |
| FR-07 | User bisa nudge furniture kiri/kanan/maju/mundur. | P0 |
| FR-08 | User bisa rotate furniture per 90 derajat. | P0 |
| FR-09 | User bisa delete furniture. | P0 |
| FR-10 | User bisa reset interior per ruang. | P1 |
| FR-11 | User bisa mengganti style interior dari floating sidebar. | P0 |
| FR-12 | Style change menghitung ulang palette, materials, warnings, dan budget. | P0 |
| FR-13 | User bisa show/hide furniture interior. | P0 |
| FR-14 | User bisa show/hide label interior terpisah dari label ruang. | P0 |
| FR-15 | Modal/dialog/sheet/dropdown selalu di atas semua label 3D. | P0 |
| FR-16 | Sidebar desktop floating, independent overflow, tanpa horizontal scroll. | P0 |
| FR-17 | Mobile memakai drawer dengan controls lengkap. | P1 |
| FR-18 | Furniture placement memakai koordinat lokal ruang dalam meter. | P0 |
| FR-19 | Move/rotate clamp ke batas ruang dan recalculate warnings. | P0 |
| FR-20 | GLB asset dipakai bila tersedia dan valid. | P1 |
| FR-21 | Fallback primitive digunakan bila GLB gagal, belum ada, atau terlalu berat. | P0 |
| FR-22 | Materials/Furniture schedule memakai data interior yang sama. | P0 |
| FR-23 | Interior Pack export memakai furniture/material/budget/warning dari source of truth yang sama. | P1 |
| FR-24 | Semua flow P0 punya E2E tests. | P0 |

## 9. Domain Model

### 9.1 Source of Truth

Gunakan model existing Baruma. Jangan membuat model paralel untuk hal yang sama.

Core types:

```ts
type DesignLayout = {
  id: string
  projectId: string
  versionId: string
  floors: Floor[]
  rooms: Room[]
  walls: Wall[]
  openings: Opening[]
  stairs: Stair[]
  pools: Pool[]
  interiors?: RoomInteriorPlan[]
  validation: ValidationResult
}

type InteriorPlan = {
  projectId: string
  versionId: string
  style: InteriorStyleId
  rooms: RoomInteriorPlan[]
  totalEstimate: InteriorBudgetEstimate
  warnings: InteriorWarning[]
  generatedAt: string
}

type RoomInteriorPlan = {
  roomId: string
  roomName: string
  roomType: RoomType
  floorId: string
  style: InteriorStyleId
  furniture: PlacedFurniture[]
  materials: MaterialAssignment[]
  lighting: LightingFixture[]
  colorPalette: InteriorStylePreset["colors"]
  warnings: InteriorWarning[]
  budgetEstimate: InteriorBudgetEstimate
  score: {
    clearance: number
    usability: number
    styleMatch: number
    cost: number
    naturalLight: number
    circulation: number
  }
}
```

Rules:

- `Room` tetap source of truth untuk geometri dan room type.
- `RoomType` memakai enum existing bahasa Indonesia, seperti `ruang_tamu`, `kamar_tidur`, `dapur`.
- `RoomInteriorPlan.roomId` harus match `Room.id`.
- `PlacedFurniture.roomId` harus match `Room.id`.
- Semua dimensi memakai meter.
- Semua nilai uang memakai IDR integer.

### 9.2 Furniture Asset Extension

Untuk realistic assets, `FurnitureItem` boleh diperluas dengan optional metadata:

```ts
type FurnitureAssetMetadata = {
  glbUrl?: string
  thumbnailUrl?: string
  fallbackKind: "box" | "bed" | "sofa" | "table" | "cabinet" | "tv" | "appliance" | "decor"
  source: "local" | "vendor" | "generated" | "placeholder"
  license: "owned" | "cc0" | "cc-by" | "unknown"
  author?: string
  fileSizeKB?: number
  triangleCount?: number
  textureMaxPx?: number
  lod?: {
    low?: string
    medium?: string
    high?: string
  }
}
```

Rules:

- `asset` optional. Editor tetap berjalan tanpa GLB.
- `license = "unknown"` tidak boleh dipakai untuk production asset.
- GLB yang melebihi budget harus fallback ke primitive atau LOD rendah.
- Metadata asset tidak mengganti dimensi furniture. Dimensi tetap dari `FurnitureItem` dan `PlacedFurniture`.

## 10. State Architecture

### 10.1 Stores

Gunakan dua store dengan batas tanggung jawab jelas:

```txt
useInteriorStore
  - projectId
  - layout
  - plan
  - style
  - selectedRoomId
  - selectedFurnitureId
  - load()
  - selectRoom()
  - selectFurniture()
  - setStyle()
  - addFurniture()
  - moveFurniture()
  - rotateFurniture()
  - removeFurniture()
  - resetRoom()

usePreviewStore
  - visibleFloors
  - exploded
  - showRoof
  - showLabels
  - showInteriorLabels
  - showFurniture
  - materialPreset
  - selectedRoomId
  - viewPreset
  - canvasEl
```

Rules:

- Jangan membuat `interior-editor-store.ts` baru kecuali menggantikan store existing melalui migrasi eksplisit.
- `useInteriorStore` adalah source of truth untuk interior data.
- `usePreviewStore` adalah source of truth untuk presentation/view state.
- Selected room harus sync dua arah antara preview dan interior store.
- Selected furniture hanya hidup di interior store.

### 10.2 Persistence

Fase MVP:

- Runtime state dibuat dari layout dan preset.
- Schedule pages boleh regenerate dari layout jika belum ada persisted interior plan.
- Jika persistence mock/API tersedia, simpan ke `DesignLayout.interiors` atau field version-level yang setara.

Fase next:

- Add debounced autosave setelah add/move/rotate/delete/style change.
- Tampilkan unsaved indicator bila network persistence gagal.
- Export membaca data persisted terakhir atau runtime snapshot saat user export.

## 11. Placement and Validation Rules

### 11.1 Coordinates

- `PlacedFurniture.x` dan `PlacedFurniture.y` adalah koordinat lokal ruang.
- Origin `(0, 0)` berada di sudut kiri/depan ruang sesuai sistem layout.
- `widthM`, `depthM`, `heightM` dalam meter.
- `rotationDeg` hanya `0 | 90 | 180 | 270`.

### 11.2 Default Placement

Generator harus memberi posisi awal yang masuk akal per room type:

- Ruang tamu/keluarga:
  - sofa menghadap area TV;
  - coffee table di depan sofa;
  - TV/cabinet di sisi berlawanan;
  - rug berada di area tengah.
- Kamar tidur:
  - kasur berada di posisi yang menyisakan akses samping bila ruang cukup;
  - wardrobe dekat sisi ruang;
  - side table dekat kasur.
- Dapur:
  - kitchen set menempel salah satu sisi;
  - kulkas tidak menabrak kitchen flow.
- Ruang makan:
  - meja makan di area tengah dengan clearance kursi.
- Rooftop/balkon:
  - item outdoor tidak menutup jalur drainase atau akses.

### 11.3 Move and Rotate

- Move harus clamp object agar tidak keluar ruang.
- Rotate harus swap `widthM` dan `depthM`, lalu clamp posisi.
- Move/rotate harus recalculate:
  - overlap warning;
  - density warning;
  - clearance warning;
  - budget estimate bila perlu.

### 11.4 Warnings

Warning minimal:

- Furniture overlap.
- Furniture keluar ruang.
- Furniture density > 55 persen luas ruang.
- Akses samping kasur terlalu sempit.
- Tarikan kursi meja makan terlalu sempit.
- Material outdoor untuk rooftop/balkon.
- Beban rooftop perlu review engineer.
- Bukaan belum terbaca untuk ruang yang butuh natural light.

## 12. Realistic 3D Asset Requirements

### 12.1 Rendering Strategy

Renderer furniture harus memilih representasi dengan urutan:

1. GLB LOD rendah/medium jika tersedia, valid, licensed, dan masih dalam budget.
2. Primitive semantic fallback, misalnya sofa/bed/table/cabinet/tv shape.
3. Box fallback generik.

GLB load tidak boleh membuat scene gagal total. Error per asset harus ditangkap di level object atau asset boundary.

### 12.2 Performance Budget

MVP asset budget:

| Metric | Target |
| --- | --- |
| GLB common item | <= 1 MB |
| GLB large item | <= 2 MB |
| Initial total 3D asset download | <= 8 MB |
| Common item triangle count | <= 10k |
| Hero/large item triangle count | <= 20k |
| Texture max size | <= 1024 px |
| Visible furniture objects | <= 30 before degradation |
| Asset fallback timeout | <= 4 seconds |

Degradation behavior:

- Jika asset belum selesai load setelah timeout, tampilkan fallback.
- Jika WebGL gagal, tampilkan fallback page dengan link ke 2D editor.
- Jika device lambat, prefer primitive/fallback untuk item kecil.
- Texture dan model berat tidak boleh preload di luar `/preview-3d`.

### 12.3 Dynamic Loading

- `three`, R3F, Drei, dan asset loader hanya load saat route `/preview-3d` mount.
- Management pages Materials/Furniture tidak boleh memuat dependency 3D berat.
- GLB assets lazy-load per visible room/floor.
- Furniture di lantai hidden tidak perlu load GLB.

## 13. Component Architecture

Recommended ownership:

```txt
src/app/app/projects/[projectId]/preview-3d/page.tsx
  - route loader
  - dynamic import Preview3DView

src/components/preview-3d/preview-3d-view.tsx
  - layout shell
  - SceneBoundary
  - desktop floating sidebar
  - mobile drawer
  - store initialization/sync

src/components/preview-3d/house-scene.tsx
  - Canvas, lights, camera

src/components/preview-3d/house-model.tsx
  - layout model
  - interior furniture scene objects
  - labels with z-index below app overlays

src/components/preview-3d/preview-controls.tsx
  - floating editor controls
  - room selection
  - interior controls
  - view/material/floor/display controls

src/components/interior/interior-workspace.tsx
  - reusable pieces only
  - style selector
  - quick add
  - warning list

src/lib/interior/plan.ts
  - generation
  - placement
  - validation
  - budget recompute

src/lib/interior/presets.ts
  - style, furniture, material libraries

src/stores/interior-store.ts
  - interior source of truth

src/stores/preview-store.ts
  - visual presentation state
```

Rules:

- Components reusable dari `interior-workspace.tsx` boleh dipakai di `preview-controls`.
- Jangan render full `InteriorWorkspace` sebagai halaman editor baru.
- Jika ada code lama yang masih berupa separate interior UI, perlakukan sebagai legacy/reusable extraction target.

## 14. Data and API Integration

Gunakan pattern data existing:

- `src/lib/api/hooks`
- data source/mock API existing
- `/api/v1` bila route API sudah tersedia

Tidak boleh membuat mock API island baru yang tidak terhubung ke project/layout source of truth.

Expected data flow:

```txt
Project + DesignLayout
        |
        v
generateInteriorPlan(layout, style)
        |
        v
useInteriorStore.plan
        |
        +--> 3D scene furniture
        +--> floating sidebar
        +--> materials schedule
        +--> furniture schedule
        +--> export pack
```

Future persistence API:

```txt
GET  /api/v1/projects/:projectId/layout
PUT  /api/v1/projects/:projectId/layout/interiors
POST /api/v1/projects/:projectId/exports/interior-pack
```

Payload harus tetap memakai Baruma domain model, bukan model PRD lama yang paralel.

## 15. Branding Requirements

- Semua copy harus memakai `Baruma`.
- Tidak boleh ada `RumahCAD AI`.
- File metadata, page title, empty state, export title, dan PDF copy harus konsisten.

## 16. Accessibility Requirements

- Semua button icon punya accessible label.
- Search furniture punya `aria-label`.
- Toggle label interior memakai switch dengan label yang bisa dibaca screen reader.
- Drawer mobile punya title.
- Keyboard user bisa:
  - membuka controls;
  - search furniture;
  - add furniture;
  - pilih active furniture;
  - delete selected furniture;
  - toggle labels.
- Focus ring tidak boleh tertutup canvas.
- Scene-only action harus punya alternatif di sidebar.

## 17. Analytics

Track event minimal:

```txt
preview_3d_opened
preview_room_selected
interior_style_selected
interior_furniture_added
interior_furniture_selected
interior_furniture_moved
interior_furniture_rotated
interior_furniture_removed
interior_labels_toggled
interior_room_reset
interior_schedule_opened
interior_asset_fallback_used
```

Event payload tidak boleh menyimpan data sensitif. Gunakan:

- `project_id`
- `room_id`
- `room_type`
- `furniture_id`
- `style`
- `fallback_reason`

## 18. Acceptance Criteria

### 18.1 Product Acceptance

- User dapat membuka `/preview-3d` dan melihat rumah dalam 3D.
- User dapat memilih ruang dan melihat panel interior di floating sidebar.
- User dapat menambahkan sofa, TV, kasur, lemari, meja, dan item lain dari search.
- User dapat edit posisi, rotate, dan delete furniture.
- User dapat toggle `Label interior`.
- User dapat melihat furniture di scene 3D yang sama, bukan di preview interior terpisah.
- User dapat membuka Materials/Furniture schedule dari sidebar.
- User tidak melihat menu Interior sebagai editor terpisah.
- `/interior` redirect ke `/preview-3d`.
- Semua copy memakai Baruma.

### 18.2 UX Acceptance

- Desktop sidebar `position: absolute`.
- Desktop sidebar punya independent vertical overflow.
- Desktop sidebar tidak punya horizontal overflow.
- Style selector compact tidak pecah layout.
- Mobile controls tersedia di drawer.
- Button text tidak keluar container.
- Modal/dialog/sheet/dropdown selalu di atas label 3D.
- Canvas tetap usable walau sidebar floating.

### 18.3 Engineering Acceptance

- Tidak ada `InteriorRoom` model baru yang menjadi source of truth paralel.
- `useInteriorStore` dan `usePreviewStore` punya boundary yang jelas.
- Furniture placement memakai meter dan room-local coordinates.
- Add/move/rotate/delete recalculate warning dan budget.
- GLB asset failure tidak menjatuhkan scene.
- 3D dependencies lazy-loaded hanya di preview route.
- Unit, component, dan E2E tests pass.

## 19. Test Plan

### 19.1 Unit Tests

Target files:

- `src/lib/interior/plan.test.ts`
- additional tests near geometry/asset helpers if added

Cases:

- `generateInteriorPlan` menghasilkan room plan untuk supported rooms.
- Default room type mapping memakai enum existing.
- `addFurnitureToRoom` menambah item dan update budget.
- `movePlacedFurniture` clamp object ke batas ruang.
- `rotatePlacedFurniture` swap dimensions dan clamp.
- `removePlacedFurniture` menghapus item dan update budget.
- Overlap warning muncul saat furniture bertabrakan.
- Density warning muncul saat furniture terlalu padat.
- Bed clearance warning muncul saat akses samping sempit.
- Material/lighting budget masuk total estimate.
- Asset metadata resolver memilih fallback bila GLB invalid/berat.

### 19.2 Component Tests

Targets:

- `PreviewControls`
- `InteriorStyleSelector`
- `FurnitureQuickAdd`
- `HouseModel` label behavior where practical

Cases:

- Floating sidebar content bisa scroll secara independen.
- Compact style selector tidak membuat horizontal overflow.
- Search `kasur`, `lemari`, `TV`, `sofa` menemukan item.
- Add furniture memanggil store action.
- Active furniture list menampilkan item terbaru.
- Delete button memanggil remove action.
- Toggle interior label mengubah state `showInteriorLabels`.

### 19.3 E2E Tests

Canonical E2E path:

```txt
/app/projects/[projectId]/preview-3d
```

Mandatory E2E cases:

1. 3D preview route renders canvas or graceful fallback.
2. Floating sidebar exists on desktop and is absolute.
3. Sidebar scroll container has `overflow-y: auto`.
4. Sidebar has no horizontal overflow.
5. Interior editor appears inside 3D preview.
6. User searches `kasur` and adds `Kasur Queen`.
7. Added furniture appears in active furniture list.
8. Added furniture appears in 3D scene when canvas is available.
9. User can rotate selected furniture.
10. User can delete selected furniture.
11. Toggle `Label interior` hides labels and toggling again shows labels.
12. Effective z-index of 3D labels is below modal/dialog overlay threshold.
13. Open a modal/sheet while labels are visible; modal/sheet remains frontmost.
14. User can navigate to Materials schedule and see material table.
15. User can navigate to Furniture schedule and see furniture table.
16. `/interior` redirects to `/preview-3d`.
17. No `RumahCAD AI` text appears in critical routes.

Recommended command:

```bash
rtk playwright test e2e/critical-flows.spec.ts -g "Interior in 3D preview"
```

Full verification before merge:

```bash
rtk tsc --noEmit
rtk proxy pnpm lint
rtk vitest run
rtk playwright test
rtk proxy pnpm build
```

Do not run Next build and Playwright concurrently because both can touch `.next`.

## 20. Edge Cases

- Layout has no supported interior rooms.
- Room is too small for selected furniture.
- User adds non-recommended furniture to room.
- User deletes all furniture in a room.
- User changes style after manual edits.
- User hides furniture but labels are still on.
- User hides labels while furniture selected.
- User changes floor visibility while furniture selected.
- GLB missing, corrupt, slow, or over budget.
- Asset license missing or unknown.
- WebGL unsupported.
- Browser zoom/mobile viewport creates tight sidebar layout.
- Scene labels overlap visually with object labels.
- Modal/dialog opens while 3D labels are visible.
- Export requested before persistence completes.

## 21. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Separate interior editor reappears | User confusion, duplicate state | Treat `/preview-3d` as only visual editor; `/interior` redirect only |
| Store divergence | Scene and schedule mismatch | `useInteriorStore` owns interior plan; schedule/export read same data |
| GLB assets too heavy | Slow/blank scene | Hard asset budget, timeout, primitive fallback |
| HTML labels cover app modal | Broken UX | Cap 3D label z-index below overlay layer and test it |
| Floating sidebar overflow | Controls unusable | Independent scroll, compact controls, E2E overflow check |
| Manual edits lost on style change | User frustration | In MVP, style reset must be explicit or clearly communicated; next phase preserve manual placements |
| Asset licensing unclear | Legal risk | No production asset with `license = unknown` |

## 22. Implementation Roadmap

### Phase 0 - Align Information Architecture

- Remove Interior nav entry if present.
- Ensure `/interior` redirects to `/preview-3d`.
- Ensure Materials/Furniture pages are schedule/data management only.
- Replace stale `RumahCAD AI` branding with `Baruma`.

### Phase 1 - Integrated Editor Baseline

- Initialize interior plan inside `Preview3DView`.
- Sync selected room between preview store and interior store.
- Render interior controls inside `PreviewControls`.
- Ensure desktop floating sidebar and mobile drawer are stable.
- Add label interior toggle to display options.

### Phase 2 - Furniture Editing

- Search and add furniture from sidebar.
- Select furniture from scene/list.
- Nudge, rotate, delete, reset room.
- Recalculate warning and budget on every edit.
- Ensure active furniture list and scene are always consistent.

### Phase 3 - Realistic Asset Layer

- Add optional asset metadata to furniture catalog.
- Implement asset resolver with fallback strategy.
- Add per-object GLB load boundary.
- Add performance guardrails and fallback timeout.
- Keep primitive fallback for all furniture.

### Phase 4 - Persistence and Export

- Persist `RoomInteriorPlan[]` to layout/version data source.
- Make Materials/Furniture schedule read persisted/runtime interior plan.
- Include interior plan in Interior Pack export.
- Include disclaimer that estimates are conceptual.

### Phase 5 - QA and Hardening

- Add unit tests for plan generation/editing/budget/warnings.
- Add component tests for controls.
- Add E2E tests for integrated 3D editor.
- Run tsc, lint, vitest, playwright, build.
- Fix visual overflow regressions found in screenshots.

## 23. Definition of Done

Feature is done when:

- `/preview-3d` is the single integrated 3D editor.
- No separate Interior editor is reachable from nav.
- `/interior` redirects to `/preview-3d`.
- User can add, edit, rotate, and delete furniture from the 3D editor.
- User can search for kasur, lemari, TV, sofa, meja, and other catalog items.
- Furniture appears in the same full-house 3D scene.
- User can show/hide interior labels.
- App modal/dialog/sheet overlays are always above 3D labels.
- Floating sidebar is neat, bounded, and independently scrollable.
- Materials/Furniture pages behave as schedule/data management.
- Branding says Baruma everywhere.
- Required E2E tests pass.
- TypeScript, lint, unit tests, E2E, and production build pass.

## 24. Explicit Replacements From Previous PRD

The following previous ideas are rejected or revised:

| Previous PRD concept | Revised decision |
| --- | --- |
| `Living Room Interior Designer Module` as separate module | Integrated interior layer in 3D editor |
| `/interior` and `/interior/[roomId]` editor routes | Redirect to `/preview-3d`, optional room query |
| Interior detail page with tabs Brief/Options/2D/3D/Cost | Floating sidebar inside one 3D editor |
| New `InteriorRoom` source model | Use existing `Room` and `RoomInteriorPlan` |
| Separate `interior-editor-store.ts` | Use `useInteriorStore` + `usePreviewStore` boundaries |
| E2E opens Interior page | E2E opens `/preview-3d` |
| "RumahCAD AI" branding | "Baruma" |

## 25. Handoff Checklist

Before implementation starts:

- [ ] Confirm this revised PRD is the accepted source for 3D editor development.
- [ ] Mark the older PRD as superseded or archive it.
- [ ] Create tasks using the roadmap phases above.
- [ ] Keep all visual editor work under `/preview-3d`.
- [ ] Add or update E2E before declaring the module complete.
