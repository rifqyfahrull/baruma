# Arsitektur Modern: Mezzanine · Split-Level · Split-Facade · Courtyard · Skylight

> Dokumen analisa + perencanaan (2026-08). Lahir dari audit 3 jalur (vertikal/section,
> courtyard+skylight, fasad) atas kode nyata — setiap klaim gap dirujuk file:line.
> Prinsipnya sama dengan `UNIFIKASI_UI_EDITOR.md`: dokumen dulu, eksekusi bertahap,
> tiap fase shippable dengan test hijau.

---

## 0. Ringkasan eksekutif

Lima idiom rumah modern yang diminta ternyata terhambat oleh **tiga akar masalah
struktural yang sama**, bukan lima masalah terpisah:

| Akar masalah | Bukti kunci | Fitur yang terblokir |
|---|---|---|
| **A. Vertikal 3D = `index × konstanta`** — `baseY = floorIndex * (WALL_H + SLAB_T)`; `Floor.heightM` **tidak pernah dibaca 3D** (0 hit), padahal section/elevation/RAB memakainya (sudah divergen diam-diam: 3D 2.95 m vs data 3.2 m) | `build-model.ts:468,503-505`; `drawings/section.ts:85`; `mock/rab.ts:128` | Mezzanine, split-level, double-height, tinggi lantai kustom |
| **B. Footprint & atap buta-lubang** — `buildingFootprint` = bounding box (`structural/grid.ts:56`); atap dituang utuh seluas footprint tanpa satu pun `subtractRectHoles` (`build-model.ts:1582,1637,1693`) | taman di tengah rumah **tetap tertutup atap**; void lantai teratas = sumur cahaya buntu | Courtyard, skylight |
| **C. Fasad bergranularitas "satu dinding penuh"** — key cladding `roomId:side` tanpa dimensi tinggi/offset (`types/index.ts:745`); dinding penutup `w-edge-*` tanpa `roomId` → tak bisa diklik/di-cladding (`build-model.ts:618`; `house-model.tsx:258`) | fasad dua-tona per-lantai, band horizontal, massa berlapis mustahil diekspresikan | Split-facade |

Kabar baiknya: **mesin-mesin pendukungnya sudah matang** — `subtractRectHoles`/
`subtractSpans` (lubang & pagar), `stairs/geometry.ts` (parametrik penuh terhadap
`totalRiseM`, hanya call site yang mengunci `WALL_H+SLAB_T`), sun-study berbasis
lintang kota + bayangan (skylight akan langsung "terasa"), layer denah Atap +
inspector registry terpadu (rumah UX siap huni untuk entity baru), dan skema layout
`.passthrough()` (field baru persist tanpa migrasi DB).

Dan satu temuan yang perlu ditindak cepat terlepas dari roadmap: **"skylight" sudah
live di UI & AI hari ini tapi bohong** — `OPENING_KIND_META.skylight` menghasilkan
jendela dinding sill 2.6 m (clerestory), tanpa `case` visual sendiri
(`constants/index.ts:341`; `opening-visuals.ts:66-176`). Ini bug yang bisa ditemui
user sekarang, bukan sekadar gap.

---

## 1. Prinsip produk: powerful tanpa menyulitkan

Semua desain di bawah tunduk pada empat aturan (diambil dari pola yang terbukti di
unifikasi UI):

1. **Satu klik untuk memulai, inspector terpadu untuk mendalami.** Setiap fitur
   punya affordance 1-klik ("+ Mezzanine", "+ Skylight", "Jadikan courtyard") yang
   menghasilkan default arsitektural yang benar; detail diatur lewat kartu registry
   (kind baru) yang identik di 2D & 3D.
2. **Geometri ikut aturan, bukan user ikut geometri.** Auto-fit/snap, auto-railing,
   auto-cut (pola stairExitCut) — user menyatakan *niat* ("ruang ini terbuka ke
   langit"), engine menurunkan konsekuensi (lubang atap, railing, drainase).
3. **Validasi sebagai arsitek pendamping, bukan penghalang.** Aturan nyata (headroom
   mezzanine, rasio cahaya, courtyard beratap = kontradiksi) masuk `validateLayout`
   sebagai warning berlabel standar — meniru pola akses-dak yang baru dibangun.
4. **Satu sumber kebenaran vertikal.** 3D, section, elevation, ceiling-plan, RAB
   harus membaca elevasi dari tabel yang sama — hari ini mereka sudah berbeda
   jawaban (HC-2, HC-9 audit vertikal).

---

## 2. Analisa & desain per fitur

### 2.1 Split-Facade — termurah, paling terlihat, tanpa prasyarat

**Definisi arsitektural.** Fasad modern berlapis: material berbeda per lantai
("podium batu, atas plester"), band horizontal/vertikal, aksen bidang, massa
maju-mundur.

**Gap (audit fasad):** key `layout.facade` per dinding penuh (K1); span dinding
sudah terpecah horizontal oleh pintu/zona tapi berbagi satu key (K2); `w-edge-*`
(penutup fasad lantai atas — justru bidang fasad terbesar rumah 2 lantai!) tanpa
`roomId` → mati (K3); preset menyapu 4 sisi semua ruang tanpa sadar lantai/interior
(K10); tak ada UI material untuk `exteriorElements` (K8); `mapRepeat` tekstur
konstan → skala bata/kayu tak konsisten antar segmen (K7).

**Desain.**
- **F1. Band cladding vertikal per dinding** — perluas key: `roomId:side` (=
  seluruh tinggi, kompat lama) plus `roomId:side@{sill}-{head}` (band). Build-model
  memecah box dinding per band (pola `wh-`/`ws-` strip bukaan yang sudah membawa
  `wallSide` — terbukti). Kartu Wall terpadu mendapat sub-editor band (tambah band,
  sill/head NumField, swatch per band). Skema `.passthrough()` → tanpa migrasi.
- **F2. `w-edge` jadi warga penuh** — beri `roomId` sintetis `edge-{floorId}`
  (pola `ROOFTOP_RAIL_ID`), guard di WallInspectorCard untuk id sintetis → bidang
  fasad lantai atas bisa diklik & di-cladding dari 3D dan 2D.
- **F3. Preset fasad sadar-lantai & sadar-luar** — alternasi hero/accent/base per
  `floorId` (bukan `i % 2` datar), lewati dinding interior (cek
  `roomsAdjacentOnSide` — helper ada), jangan sentuh dinding courtyard yang di-set
  manual. Pure function bertest (`facade-presets.test.ts`).
- **F4. Material picker elemen eksterior** — tempelkan `CladdingGrid` (sudah
  generic) ke kartu Exterior terpadu → panel/kolom/kanopi/portal dapat 11 material
  katalog. Rendering-nya sudah jalan hari ini.
- **F5. `mapRepeat` proporsional panjang prim** (`surface.ts:130-133`) — hilangkan
  stretch sebelum band memperbanyak segmen.
- **F6. Generator aksen 1-klik** — parameterkan blueprint
  `modern_concrete_vertical` (`facade-templates.ts:180-195`) jadi generator "sirip
  vertikal / band horizontal" (pitch, tinggi, sisi) di kartu Wall.

**Risiko:** rendah. Semuanya additive; satu-satunya yang menyentuh geometri dinding
adalah F1 (pecah box per band — pola sudah ada). Ekspor GLB belum membawa cladding
(temuan QW9) — catat sebagai isu terpisah.

### 2.2 Skylight — bertumpu pada layer Atap + sun-study yang sudah ada

**Definisi arsitektural.** Bukaan kaca di bidang atap untuk cahaya zenithal —
di rumah tropis modern lazim di koridor tengah, kamar mandi dalam, tangga.

**Gap (audit courtyard/skylight):** `parseOpeningWall` hard-gate n/s/w/e (#11) —
opening tidak bisa hidup di atap; `Opening` tak punya koordinat 2D bidang (#12);
label "skylight" sudah menipu user hari ini (#13); tak ada material atap tembus
cahaya (#14); tak ada validator yang memberi kredit skylight (#16).

**Desain — jangan paksakan ke `Opening`.** Skylight bukan opening dinding; ia
entitas bidang-atap. Koleksi baru:

```ts
layout.skylights?: Array<{
  id: string;
  x: number; y: number;          // site coords (rect, seperti roofZone/deck)
  widthM: number; depthM: number;
  kind: "fixed" | "operable";    // operable = bisa buka (ventilasi)
  // bidang host diresolusi otomatis: atap datar / dak rooftop / zona datar
}>
```

- **Geometri:** fase 1 dibatasi **bidang datar** (atap `datar`, dak rooftop, zona
  `datar`) — lubangi slab/atap via `subtractRectHoles` (mesin yang sama dengan
  lubang tangga), isi prim `roof_glass` transparan (pola `rail_glass`,
  opacity ~0.35, `castShadow: false` → **berkas cahaya masuk otomatis** dari
  directional light sun-study yang sudah ada). Atap miring = fase lanjut
  (butuh lubang di BufferGeometry prisma — sengaja ditunda).
- **UX:** tombol "+ Skylight" di kartu Atap; rect muncul di **layer Atap 2D**,
  draggable + auto-fit (mesin snap zona atap yang baru dibangun); kartu inspector
  kind `skylight` (registry) — ukuran, jenis, hapus. Di 3D bisa diklik.
- **Kredit validasi:** `auditDaylight` menghitung luas skylight (faktor 1.0 — SNI
  memperlakukan pencahayaan atas ≥ jendela dinding) untuk ruang yang rect-nya
  tepat di bawah; `auto-fix` untuk ruang *landlocked* menawarkan skylight alih-alih
  menyerah (`auto-fix.ts:84-87` hari ini menyerah).
- **Perbaikan segera (terpisah dari fitur):** ganti label
  `OPENING_KIND_META.skylight` → "Jendela clerestory" agar berhenti berbohong,
  dengan alias data lama tetap valid.
- **`garden`/`tile` receiveShadow** dibereskan di fase ini (satu baris,
  `house-model.tsx:330`) — prasyarat visual bersama courtyard.

**Risiko:** sedang-rendah. Koleksi baru + lubang pada bidang yang lubangnya sudah
terpecahkan. Yang diawasi: interaksi dengan deck parsial (skylight harus di-clamp
ke bidang host, pola `clampRooftopArea`).

### 2.3 Courtyard — niat eksplisit `openToSky`, bukan tebak-tebakan

**Definisi arsitektural.** Halaman dalam terbuka ke langit di tengah massa —
jantung rumah tropis modern: cahaya, ventilasi silang, resapan.

**Gap:** atap menutup taman tengah (#1-2); overhang zona menjorok ke lubang (#3);
audit cahaya memberi **false pass** pada jendela-ke-courtyard-beratap
(`design-audit.ts:166`); RAB & resapan menghitung courtyard sebagai atap
(`rab.ts:218,266`); ironi keras: validasi **menuntut** taman untuk resapan
(`validation.ts:24`) lalu engine menutupinya dengan atap. Marketing sudah menjual
"Compact Courtyard Pool" yang enginenya tidak bisa render (#9).

**Desain.**
- **Data:** properti `openToSky?: boolean` pada `Room` (berlaku untuk `taman`,
  `kolam`, `void`) — *niat* user, bukan tipe ruang baru (tak memecah semantik
  resapan/vegetasi yang sudah menempel di `taman`).
- **Geometri:**
  - Atap **datar** & dak: kurangi rect `openToSky` dari slab atap via
    `subtractRectHoles` — selesai.
  - Atap **miring/pelana/limasan**: satu tombol "Jadikan courtyard (lubangi
    atap)" → auto-konversi ke **cincin roofZones** memakai guillotine
    `rooftopStrips` (algoritmanya persis, tinggal ganti domain), dengan
    `overhangM` dinolkan pada tepi yang menghadap lubang (menutup kendala #3).
    User lalu bebas mengedit zona per strip di layer Atap.
  - Void `openToSky` di lantai teratas = **light well tembus** (lubang slab
    SEKALIGUS atap) — menyembuhkan "sumur cahaya buntu".
- **Konsekuensi otomatis (aturan, bukan UI):** dinding keliling dari tetangga
  solid sudah bekerja hari ini (temuan positif §4a audit); railing/pagar tepi
  courtyard lantai atas via mesin hazard yang ada; cladding dinding courtyard
  sudah bisa (§5 audit) — preset diajari melewatinya (F3 fasad).
- **Validasi & hitungan:** courtyard `openToSky=false` yang memuat sumur resapan →
  warning "resapan di bawah atap"; catchment & RAB atap dikurangi luas courtyard
  (`rab.ts:218,266`; `sheet-list.ts:120`); audit cahaya hanya mengkredit jendela
  ke courtyard yang benar-benar terbuka.
- **UX:** ToggleRow "Terbuka ke langit" di kartu ruang (tipe taman/kolam/void) +
  badge di layer Atap (lubang digambar dengan notasi ✕ silang roof plan).

**Risiko:** sedang. Perubahan emisi atap datar aman (subtraksi rect); jalur
auto-cincin zona harus mempertahankan e2e roof-zone; RAB berubah angka (dikunci
test kuantitas baru).

### 2.4 Split-Level — meng-upgrade yang setengah jadi

**Definisi arsitektural.** Lantai-lantai bergeser setengah tinggi; ruang keluarga
turun 3-4 anak tangga dari foyer, dsb.

**Yang sudah ada:** `levelOffsetM` (snap 0.18, warning >0.20) menggeser lantai,
dinding, bukaan, kolam, tangga (audit vertikal §2) — fondasi yang benar.

**Gap:** dinding tetap `WALL_H` penuh → ruang +offset dindingnya menembus slab
atas (HC-4); tak ada batas keras (`z.number().finite()` — offset 1.5 m diterima,
HC-8); section vs ceiling-plan **bertentangan** soal plafon ikut offset atau tidak
(HC-9); beda level >20 cm hanya diberi warning teks — tak ada tangga kecil
otomatis; tak ada validasi geometrik apa pun.

**Desain.**
- **F1. Plafon rata, dinding menyesuaikan** (keputusan arsitektural yang
  diusulkan): ruang ber-offset +h memakai tinggi dinding `WALL_H − h` sehingga
  puncak dinding sejajar tetangganya (plafon satu bidang — praktik umum
  split-level); section & ceiling-plan disatukan ke aturan yang sama (menutup
  HC-9). Offset negatif (turun) menaikkan dinding maksimal sampai batas slab.
- **F2. Clamp keras** `levelOffsetM ∈ [−0.9, +0.9]` (5 riser) di store + zod +
  NumField; di luar itu arahkan ke "lantai terpisah".
- **F3. Undakan konektor otomatis:** dua ruang terhubung (pintu / zona sama /
  bukaan lebar) dengan `|Δoffset| > 0.20` mendapat anak tangga kecil otomatis di
  bentang koneksinya (2-5 anak, riser = Δ/n ≤ 0.19) — digambar 3D + notasi 2D,
  tanpa UI baru sama sekali. Warning lama tinggal untuk kasus tak terhubung.
- **F4. Validasi:** offset yang membuat sisa headroom < 2.1 m di bawah slab atas →
  warning berlabel standar.

**Risiko:** sedang. F1 mengubah visual layout ber-offset yang sudah ada (dinding
memendek) — perubahan perilaku yang diinginkan tapi harus dipin test + disebut di
changelog.

### 2.5 Mezzanine — paling dalam, dibangun terakhir di atas fondasi

**Definisi arsitektural.** Lantai antara parsial (lazim ~⅓–½ luas lantai bawah)
di dalam ruang double-height; khas rumah kecil modern (studio + mezzanine tidur).

**Gap:** mustahil hari ini — stacking `index × konstanta` (HC-1); `Floor.heightM`
mati di 3D (HC-2); tak ada UI tinggi lantai (HC-3); slab selalu seluas footprint
(HC-10); tangga selalu naik persis satu lantai & selalu melubangi slab atas
(HC-6/7); `"floor-rooftop"` magic string sebagai satu-satunya "tipe lantai"
(HC-12); railing GLB tak tersedia untuk void (HC-13).

**Desain (setelah Fondasi Vertikal §3):**
- **Data:** `Floor.kind?: "regular" | "mezzanine" | "rooftop"` (migrasi
  `floor-rooftop` → `kind:"rooftop"`, id lama tetap valid) + `Floor.baseOffsetM?`
  untuk mezzanine (elevasi relatif lantai induk, default ½ tinggi induk).
- **Geometri:** slab mezzanine = **union ruang-ruangnya saja** (bukan footprint —
  `subtractRectHoles` terbalik: hanya rect ruang), tepi terbuka otomatis dapat
  railing interior (mesin hazard + `railSidePrims`), TIDAK menaikkan atap
  (`regularFloors` tidak menghitung mezzanine — menutup HC-10), tangga menuju
  mezzanine memakai `totalRiseM = baseOffsetM` (call site tangga sudah
  diparametrikkan di Fondasi).
- **UX:** tombol "+ Mezzanine" pada lantai aktif (FloorSwitcher) → membuat layer
  mezzanine di atasnya dengan satu ruang default 40% luas + tangga + railing;
  denah mezzanine menampilkan ghost lantai induk (pola layer Atap); kartu Floor
  baru (tinggi, elevasi, hapus).
- **Validasi arsitek:** headroom bawah ≥ 2.2 m & atas ≥ 2.0 m (warning), luas
  mezzanine ≤ 50% ruang induk (info), wajib railing tepi terbuka (otomatis,
  tinggal dipastikan).

**Risiko:** tertinggi — menyentuh stacking global. Karena itu ia **terakhir**, dan
fondasinya dikerjakan terpisah lebih dulu.

---

## 3. Fondasi Vertikal (prasyarat mezzanine & split-level penuh)

Satu pekerjaan lintas-fitur yang harus benar sekali:

1. **Tabel elevasi tunggal** — `floorElevations(layout): Map<floorId, {baseY,
   floorToFloorM, wallHM}>` (prefix-sum dari `Floor.heightM`), dipakai build-model,
   camera-rig, house-scene, exterior-primitives, section, elevation, ceiling-plan,
   RAB. Menutup HC-1/HC-2 dan divergensi 2.95-vs-3.2 dengan **satu keputusan
   migrasi**: `heightM` = floor-to-floor resmi; data lama dinormalisasi saat load
   (`3.2 → 2.95`) supaya visual 3D existing byte-stabil, default proyek baru 3.0.
2. **Tinggi dinding per lantai** — `wallHM = floorToFloorM − SLAB_T`, menggantikan
   `WALL_H` di emisi dinding/bukaan/label (HC-4); konstanta `WALL_H` tinggal
   fallback.
3. **UI tinggi lantai** — `updateFloor(id, {heightM})` + NumField di kartu
   ringkasan/floor (HC-3), clamp 2.4–4.5 m, warning < 2.7 m (kenyamanan tropis).
4. **Rise tangga parametrik** — 7 call site `WALL_H + SLAB_T` membaca tabel elevasi
   (selisih elevasi lantai tujuan) (HC-6); lubang slab & exit-cut hanya untuk
   tangga yang benar-benar menembus (HC-7).

Golden test 3D (`build-model.test.ts`, `zfight`) adalah jaring pengaman sekaligus
biaya terbesar fase ini — normalisasi 3.2→2.95 dipilih justru agar mayoritas
snapshot tak berubah.

---

## 4. Roadmap eksekusi

| Fase | Isi | Prasyarat | Risiko | Nilai user |
|---|---|---|---|---|
| **A. Split-Facade** (§2.1 F1–F6) | band cladding, w-edge hidup, preset sadar-lantai, material eksterior, mapRepeat, generator aksen | — | rendah | tinggi & langsung terlihat |
| **B. Skylight datar + perbaikan misnomer** (§2.2) | koleksi `skylights`, layer Atap, kartu registry, kredit cahaya, receiveShadow | — (paralel dgn A) | sedang-rendah | tinggi |
| **C. Courtyard** (§2.3) | `openToSky`, lubang atap datar, auto-cincin zona utk atap miring, koreksi RAB/resapan/audit cahaya | B (berbagi mesin lubang atap) | sedang | tinggi (sudah dijanjikan marketing) |
| **D. Fondasi Vertikal** (§3) | tabel elevasi, dinding per lantai, UI tinggi, tangga parametrik | — (boleh paralel dgn C) | tinggi (migrasi perilaku) | tak terlihat langsung, membuka E |
| **E. Split-Level penuh + Mezzanine** (§2.4–2.5) | plafon rata, clamp, undakan otomatis; Floor.kind, slab parsial, "+ Mezzanine" | D | tinggi | tinggi |

Urutan yang disarankan: **A → B → C → D → E** (A+B bisa serentak; D bisa dimulai
saat C berjalan). Tiap fase: unit + e2e + gambar kerja (section/elevation ikut
diuji), commit per fitur, kontrak testid/aria dipertahankan seperti biasa.

## 5. Register risiko

| Risiko | Mitigasi |
|---|---|
| Golden test 3D pecah massal saat Fondasi Vertikal | normalisasi data 3.2→2.95 saat load (visual identik); tabel elevasi dites sendiri |
| e2e roof-zone/critical-flows saat courtyard mengubah emisi atap | jalur legacy (tanpa `openToSky`/`skylights`) dijaga byte-identical |
| RAB berubah angka (courtyard/skylight mengurangi luas atap) | test kuantitas baru + catatan changelog — perubahan yang memang benar |
| AI assistant menghasilkan fitur baru sebelum enginenya siap | skema zod aksi diperluas per fase, bukan di depan |
| Ekspor GLB belum membawa cladding (temuan audit) | isu terpisah, dicatat — bukan blocker |
| `w-edge` roomId sintetis membingungkan konsumen `layout.rooms.find` | guard eksplisit di WallInspectorCard + helper `isSyntheticWallOwner` |

## 6. Lampiran — rujukan audit

Temuan lengkap per file:line tersimpan dalam tiga inventaris audit (vertikal/
section; courtyard+skylight; fasad) yang dirangkum di §0–§2. Kendala keras yang
dirujuk dengan kode (HC-*, K*, #n) mengikuti penomoran inventaris masing-masing.

## Gelombang Fasad Scandi-Tropis (2026-08-13)

Filosofi produk (pernyataan user): Baruma men-generate fasad VARIATIF yang
detail & akurat secara arsitektur — BUKAN render realistis (realisme kelak via
integrasi AI image/video). Target device menengah tablet/iPad → semua geometri
prosedural low-poly, tanpa tekstur berat.

Fitur yang mendarat (dari 3 prototipe referensi user):
- **Gable asimetris** — `RoofZone.ridgeOffsetM` / `RoofSpec.ridgeOffsetM`
  (geser bubungan; 3D + ridge 2D + elevation/section; UI kartu Atap; agent
  setRoof/updateRoofZone).
- **Sopi-sopi** — `gableEnds` per ujung bubungan: `"wall"` (ikut warna
  dinding) atau `"glass"` (kaca gable mengikuti kemiringan, transparan ala
  roof_glass). Prim baru `wall_gable` (buildGableEndGeometry, sadar
  ridgeOffset & overhang).
- **Bukaan railing balkon** — pendaratan `exterior_stair` memotong railing
  otomatis (pola span+cut; `exteriorStairLandingCuts`).
- **Bingkai menonjol** — `Opening.frameDepthM` (0–0,8 m): 4 box bingkai
  keluar muka dinding, warna kusen.
- **Template komposer baru** — `scandi_tropis` (tangga eksterior + kanopi
  gelap + pilar batu + planter; preset putih-kayu) & `modern_staggered`
  (kanopi besar + kolom aksen + panel kayu; preset wood-slat putih).

Batasan sadar-diri: sopi-sopi belum ikut cladding fasad per-dinding (warna
dinding preset); luas atap RAB tak dibedakan utk gable asimetris (selisih
orde-2); kaca gable belum dikredit audit cahaya (follow-up).

## Studio Komponen (2026-08-15)

Fondasi pola kustom kisi/roster/jeruji/pergola (`ComponentPatternSpec` +
`patternBarOffsets`, `src/lib/three/component-pattern.ts`, b1b3094) mendarat
lebih dulu dan sudah bisa dipatch AI-assist lewat `updateFacadeElement`/
`updateExteriorElement` (field `pattern`) — gelombang ini menambah UI-nya:
panel **Studio Komponen** + **preset bernama** tersimpan, bukan mekanisme
generasi pola baru.

### Konsep

- **Satu resolver, dua konsumen** — elemen fasad (`louver_band`/
  `slat_horizontal`/`roster_screen`) dan elemen eksterior (`pergola`, serta
  segmen `fence`/`sliding_gate`/`swing_gate`/`pedestrian_gate` — bukan
  `boundary_wall`, selalu solid) sama-sama membaca `pattern` lewat resolver
  yang sama, jadi Studio, agent, dan geometri 3D tak pernah menyimpang.
- **Studio = editor lokal + commit eksplisit** — field pola diedit di state
  lokal panel (bukan langsung menulis ke entity per keystroke seperti field
  inline di kartu inspector); preview SVG update seketika, tapi entity baru
  berubah saat tombol **"Terapkan ke elemen"** ditekan — satu entri undo per
  penerapan, bukan satu per field yang disentuh.
- **Preset = snapshot `pattern` bernama** — `ComponentPreset {id, name,
  family, pattern, finish?, createdAt}` (`src/types/exterior.ts`). `family`
  (`"kisi"|"roster"|"pagar"|"gerbang"|"pergola"`) murni label kategorisasi
  daftar "Preset Saya", TIDAK membatasi elemen tujuan — preset apa pun bisa
  diterapkan ke elemen apa pun yang mendukung `pattern`.
- **Preview SVG murni, tanpa three.js** — `componentPatternPreviewRects`
  (`src/components/studio/component-pattern-preview.ts`) fungsi PURE yang
  memanggil `patternBarOffsets`/`resolve*` yang sama dengan jalur 3D, lalu
  mengembalikan array `{x,y,w,h}` untuk `<rect>` SVG di viewBox
  `widthM×heightM` target — dites tanpa DOM, dan tak menambah bobot three.js
  ke bundle Studio (batas anti-berat, lihat memori `baruma-bundle-baseline`).

### Titik akses & alur

- Tombol **"Buka Studio Komponen"** di kartu Pola kustom (wall-inspector.tsx,
  elemen fasad) dan kartu Pola jeruji/Pola kisi pergola (exterior-inspector.tsx,
  fence/gate/pergola) — memanggil `requestStudio({kind, id})`.
- `useComponentStudioStore` (zustand, pola PERSIS `AssetPickerHost`) menyimpan
  target sebagai union `{kind:"facade-element",id}|{kind:"exterior-element",id}`
  yang di-capture SAAT REQUEST — ganti seleksi selagi Sheet terbuka tidak bisa
  menempelkan pola ke entity yang salah (race tertutup by construction).
  `ComponentStudioHost` dipasang sekali di layout editor, bersebelahan dengan
  `AssetPickerHost` (2D editor page + preview 3D).
- Sheet: (a) form pitch/lebar/kedalaman/orientasi/rhythm/bingkai, (b) preview
  SVG, (c) daftar "Preset Saya" (Terapkan memuat pola preset ke form; Simpan
  sebagai preset menyimpan pola form SAAT INI sebagai entri baru; Hapus), (d)
  "Terapkan ke elemen" mengirim `pattern` final ke store.

### Skema `ComponentPreset` & DataSource

```ts
type ComponentPreset = {
  id: string
  name: string
  family: "kisi" | "roster" | "pagar" | "gerbang" | "pergola"
  pattern: ComponentPatternSpec
  finish?: string
  createdAt: string
}
```

`listComponentPresets` / `saveComponentPreset` / `deleteComponentPreset` ada
di `DataSource` (`src/lib/data/source.ts`); implementasi mock in-memory di
`src/lib/mock/index.ts` (`db.componentPresets`); `httpSource` (real backend)
untuk sekarang melempar error 501 eksplisit — belum ada tabel/route
`component_presets` di API nyata, migration db belum dibuat di gelombang ini.

### Contoh preset seed

| Nama | family | pattern |
|---|---|---|
| Kisi Kubisme 18 bilah | kisi | `{orientation:"v", pitchM:0.083, barWidthM:0.05, barDepthM:0.12}` |
| Jeruji Rapat Tropis | pagar | `{orientation:"v", pitchM:0.12, barWidthM:0.04, barDepthM:0.04}` |
| Pergola Anyam 40cm | pergola | `{orientation:"cross", pitchM:0.4, barWidthM:0.08, barDepthM:0.08, frame:true}` |
| Roster Grid Klasik | roster | `{orientation:"grid", pitchM:0.25, barWidthM:0.08, barDepthM:0.15, frame:true}` |

Batasan sadar-diri: preset tersimpan per-sesi mock (in-memory, hilang saat
reload di luar konteks tes) sampai migrasi backend nyata dibuat; pergola
memakai envelope `widthM×depthM` (bidang datar footprint) untuk preview,
BUKAN `widthM×heightM` (heightM = elevasi bidang kisi dari tanah) — beda dari
elemen fasad/pagar/gerbang yang memakai bidang vertikal `widthM×heightM`.
