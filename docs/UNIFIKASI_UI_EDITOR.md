# Unifikasi UI Editor 2D/3D — Audit & Blueprint

> **Update 2026-08-22 — Fase 1–7 DIEKSEKUSI** di branch `feat/editor-ui-cleanup`
> (rencana kerja: `dynamic-enchanting-alpaca.md`). Blueprint di bawah adalah audit
> ASLI (masih berguna sebagai rujukan `file:baris` historis); status "DRAFT/belum
> dieksekusi" di blockquote berikutnya sudah usang. Ringkasan yang sudah shipped:
> - **Primitif chrome terpadu** (`src/components/chrome/floating-bar.tsx`:
>   `FloatingBar`/`ToolButton`/`Pill`/`ToolbarMore`) — satu spec kontainer floating,
>   satu strategi overflow, dua idiom state aktif (exclusive/soft), menggantikan 4
>   kontainer hand-rolled + 3 idiom aktif berbeda.
> - **Rail 2D & 3D direstrukturisasi** (`editor-toolbar.tsx`, `view-toolbar.tsx`) ke
>   grup berlabel + palette searchable — bukan lagi kolom ikon tanpa label yang
>   meluber di 720p.
> - **`ProjectBar`** (`src/components/project/project-bar.tsx`, h-12) menggantikan
>   `ProjectWorkspaceHeader` + `ProjectTabs` (chrome atas 162px → 48px) + stage nav
>   berkelompok.
> - **Mode Fokus** (`ui-store.fokusMode` + `useFokusMode`) menggantikan
>   `preview-store.cleanMode`, dipicu dari kedua rail + Esc.
> - **Satu model peringatan** — tab "Cek" (badge count) menggantikan 3 permukaan
>   warning (bell popover, DesignAuditCard terpisah, mega-dialog hover in-canvas).
> - **Adopsi `SegmentedControl`** (Fase 7) di `room-inspector.tsx` (railing model
>   void, arah naik tangga, tipe kolam), `roof-inspector.tsx` (sopi-sopi, tipe atap),
>   `light-inspector.tsx` (temperatur warna) — lihat amandemen §3.5 di bawah.
> - **Dead code dihapus** (Fase 7): `ui/toggle-group.tsx`, `ui/toggle.tsx`,
>   `ui/resizable.tsx`, `interior/interior-workspace.tsx` (+ `interior-room-scene.tsx`
>   yang jadi yatim setelahnya) — nol pemakai, terverifikasi via grep sebelum hapus.
> - **Nol `window.confirm`/`window.alert`** tersisa di `src/components` /
>   `src/app` (diganti `useConfirm()`/toast sejak Fase 2–3).
>
> **Keputusan yang diamandemen dari draft asli**: `SegmentedControl` (di
> `inspector/fields.tsx`) TIDAK dibangun di atas shadcn `toggle-group` seperti
> diusulkan §3.5 — ia grid `<button aria-pressed>` native. `toggle-group`/`toggle`
> dihapus (0 pemakai) alih-alih dibungkus. `StyleTilePicker` (swatch berwarna/
> bertekstur — cladding, finish kolam, warna fascia) masih **belum dibangun**;
> ditandai `// TODO: StyleTilePicker (UNIFIKASI §3.5)` di `cladding-grid.tsx`.

> **Status: DRAFT untuk review tim — belum dieksekusi.** Dokumen ini adalah hasil
> audit menyeluruh (Agustus 2026) atas semua permukaan editing di Baruma, plus
> blueprint arsitektur target dan roadmap migrasi 4 fase. Setiap klaim membawa
> rujukan `file:baris` yang bisa dicek langsung. Pelengkap
> [ARCHITECTURE.md](./ARCHITECTURE.md); menuntaskan mandat yang sudah ada di
> [PRD.md](./PRD.md) §10.6/§20, `PRD_REVISED_INTEGRATED_3D_EDITOR_INTERIOR.md`
> §10.1/§13, dan `NEW_REVAMP_PRD.md` §8.2 (lihat §6).

---

## 1. Ringkasan eksekutif

Satu komponen bangunan di Baruma hari ini bisa diedit dari **banyak UI berbeda yang
tidak saling konsisten** — bukaan pintu/jendela punya dua editor yang keduanya tidak
lengkap; atap punya lima; dinding justru **tidak bisa diedit sama sekali dari 2D**
padahal di situlah dinding digambar. Tidak ada "UI identity" per komponen: widget,
label, perilaku commit, tombol hapus, dan shortcut berbeda-beda tergantung dari
permukaan mana user kebetulan masuk.

Angka hasil audit:

| Metrik | Nilai |
|---|---|
| Permukaan editing atas satu `DesignLayout` yang sama | **±24** |
| Field seleksi, tersebar di | **12 field / 3 store**, 3 filosofi berbeda |
| Undo stack | **2**, salah satunya salah sambung (lihat §3.1) |
| Primitif inspector yang di-share antar permukaan | **0** |
| Definisi lokal `Field` / `ToggleRow` / `Stat` yang duplikat | 3× / 2× / 2× |
| Button-grid tulis-tangan (padahal `toggle-group` shadcn tersedia) | 9 (pemakaian toggle-group: 0) |
| Kamus label utk 22 jenis elemen eksterior | **2**, dengan string berbeda |
| Baris kode UI inspector/canvas tanpa kosakata bersama | ±10.200 |

Yang **sudah benar** dan tidak perlu diubah: lapisan **data** sudah terpadu — panel
3D menulis langsung ke `editor-store` (satu `DesignLayout`, satu autosave); dan
chrome panel (`FloatingPanel`/`PanelTab`, `src/components/layout/floating-panel.tsx`)
sudah shared dan dipakai 3 dari 4 halaman. Masalahnya murni di lapisan **seleksi**
dan **inspector** — dan karena itu bisa diperbaiki bertahap tanpa menyentuh
server/schema/DB sama sekali.

---

## 2. Inventaris: berapa UI untuk satu komponen?

| Komponen | # UI | Permukaannya (file:baris) |
|---|---|---|
| **Dinding** | 3 — **0 di 2D** | 3D `FacadeQuickEditor` (`preview-controls.tsx:1505`) + `FacadeLouverSection` (`:1700`); tombol "Template tampak depan" di toolbar 2D (`editor-toolbar.tsx:476` — buta: mengubah seluruh fasad tanpa bisa memilih dinding); aksi AI (`assistant/actions.ts:401-416`). Di kanvas 2D dinding **tidak punya layer, tidak bisa diklik**; `layout.walls[]` (types/index.ts) = dead data yang tidak pernah dibaca |
| **Lantai** | 4 | `FloorSwitcher` (floor-switcher.tsx); Select "Lantai" di `RoomInspector`; toggle rooftop justru di 3D `RoofQuickEditor` (`preview-controls.tsx:3051`); finish lantai per ruang di interior. Kata "lantai" dipakai utk 3 konsep beda (tingkat / slab / finish) |
| **Ruang** | 4 | `RoomInspector` (editor-inspector.tsx:425); drag/resize kanvas; 3D `RailingQuickEditor`+`PoolQuickEditor`; AI |
| **Bukaan** | 4 | `OpeningInspector` 2D (`editor-inspector.tsx:833`) vs `OpeningQuickEditor` 3D (`preview-controls.tsx:1108`) — **keduanya tidak superset**: hanya-2D = positionM/headHeightM/operation/privacy/notes; hanya-3D = frameColor/modelUrl/curtainModelUrl. Kartu 3D-nya sendiri menulis "Edit detail lain di 2D Editor" (`:1414`) |
| **Tangga** | 5 | Tool toolbar; blok tangga `RoomInspector` (:698-821); `StairFields` exterior (:2434 — entity berbeda); 3D `StairQuickAdd` (:2316); AI. Dua API pembuatan berbeda: `addStair()` (3D) vs `addStairAt(x,y)` (kanvas) |
| **Atap** | 5 | `RoofInspector` global (:1133) vs `RoofZoneInspector` per-zona (:1290, **tak terjangkau dari 3D**) vs 3D `RoofQuickEditor` (:2801 — slider vs input-teks utk field yang sama); `rooftopArea` bisa ditulis dari 3 jalur; `rooftopRailingStyle` diedit dari **dua kartu 3D yang bisa tampil bersamaan** (`RailingQuickEditor:2015` + `RoofQuickEditor:3157`) |
| **Titik listrik** | 3 | `ElectricalInspector`; tool + dropdown tipe di toolbar; `ElectricalSection` di Summary (state yang sama, dua picker: `editor-toolbar.tsx:253` vs `editor-inspector.tsx:1774`) |
| **Air / sanitasi** | 4 | `WaterInspector` (klon byte-per-byte dari ElectricalInspector); `SanitationInspector` (read-only); tool toolbar; `WaterSanitationSection` |
| **Elemen eksterior** | 4 | `ExteriorInspector` + 5 sub-form; drag kanvas; toolbar (22 jenis); 3D `ExteriorSelectionQuickEditor` (**read-only, dead-end** kecuali satu tombol ganti-GLB yang terdampar di luar kartunya, `preview-controls.tsx:449`) |
| **Kolam** | 1 — **0 di 2D** | Hanya 3D `PoolQuickEditor` (:2449) |
| **Railing** | 2 | Blok `RoomInspector` 2D vs `RailingQuickEditor` 3D — widget & label beda utk 4 nilai yang sama |

### 2.1 Duplikasi widget untuk nilai yang sama

- **Picker arah (n/s/w/e), 3 widget berbeda**: grid 4-tombol dgn glyph panah
  (stairDirection, `editor-inspector.tsx:700`), `Select` dropdown (roof `lowSide`
  :1219 & :1434), `Select` dropdown lagi (exterior stair :2483).
- **Picker enum, 4 idiom**: shadcn `Select` (mayoritas), raw `<button>` grid
  (railing :647, arah tangga :700), row `Button size="sm"` (bentuk/belok tangga
  :772/:794), raw `<button role="radio">` (mode dak :1575).
- **Skala tipografi label, 2 macam** untuk elemen semantik yang sama:
  `text-[11px] font-medium` ×26 di preview-controls vs `text-xs` ×67 (`Field`) di
  editor-inspector.
- **Semantik commit angka, 3 macam**: blur-saja (mayoritas), onChange langsung
  (`stairRiserM` :748), blur+Enter (`RooftopDeckInputs` :1701, `OpeningNumField`
  preview-controls:3182).
- **Label hapus, 7 varian** ("Hapus ruang/bukaan/titik/titik/objek sanitasi/elemen/
  zona atap") dengan dua jalur API berbeda (deleteSelected vs remover per-tipe).
- **Kamus label eksterior, 2 buah**: `EDITOR_EXTERIOR_KIND_LABELS` vs
  `PREVIEW_EXTERIOR_KIND_LABELS` (`src/lib/exterior/labels.ts:3` & `:29`) — 22 kind
  yang sama, string Indonesia beda ("Tembok batas" vs "Dinding batas").

### 2.2 Fragmentasi seleksi (akar dari semuanya)

**`editor-store`** (2D): satu `selectedObjectId: string|null` **tanpa kind**
(editor-store.ts:77). Kind dipulihkan saat render lewat scan linear 7 koleksi
(`editor-inspector.tsx:104-110`), lalu di-dispatch lewat **dua ternary 7-tingkat
paralel** (judul :116-130, body :134-159) yang harus dirawat serempak.

**`preview-store`** (3D): **7 field paralel** (`selectedRoomId/OpeningId/WallId`,
`roofSelected` — boolean, bukan id!, `selectedLampId/RailingRoomId/
ExteriorElementId`, preview-store.ts:25-37) dengan mutual-exclusion tulis-tangan
yang **asimetris** (:199-224): `selectRoom` hanya membersihkan 1 saudara,
`selectOpening` tidak membersihkan exterior/railing → **kartu quick-editor bisa
menumpuk** di panel, persis hal yang komentar kodenya sendiri klaim dicegah.

**`interior-store`**: 3 field, dan **seleksi ikut disimpan di undo history**
(interior-store.ts:50-55) — filosofi ketiga yang bertentangan dgn editor-store
(yang justru membersihkan seleksi saat undo).

**Sinkronisasi antar store**: hanya `selectedRoomId` preview↔interior
(preview-3d-view.tsx:193-199). Seleksi editor-store **tidak pernah** disinkronkan ke
manapun — pilih ruang di 2D, buka 3D: seleksi hilang (padahal layout-nya sengaja
dibawa, `preview-3d/page.tsx:42-57`).

### 2.3 Bug fungsional yang ditemukan audit (bisa dipetik cepat)

| Bug | Lokasi | Dampak |
|---|---|---|
| **Ctrl+Z di halaman 3D salah store** | `preview-controls.tsx:164-185` terikat `useInteriorStore` saja, padahal 11 dari 12 quick editor menulis `editor-store` | Undo tampak jalan tapi diam-diam tidak meng-undo cladding/atap/kolam/lampu/bukaan |
| **Tombol Del no-op** utk titik listrik/air/sanitasi | `deleteObject` else-branch mengasumsikan opening (editor-store.ts:663-665 area akhir fungsi) → filter openings = no-op, tapi tetap push entri undo | Toolbar trash aktif tapi tidak menghapus; hanya tombol merah di inspector yang bekerja |
| **Kartu quick-editor menumpuk** | exclusion asimetris preview-store.ts:199-224 | Sampai 4 kartu tampil bersamaan |
| **Race asset-picker** | `onSelect` My Library membaca seleksi via `getState()` **saat commit** (preview-controls.tsx:943 dst.) | Ganti seleksi saat Sheet terbuka → aset menempel ke entity yang salah |
| **Dua listener Escape bersaing** | `editor/page.tsx:122` (deselect) vs `plan-canvas.tsx:1303-1310` (reset tool) | Perilaku Esc tergantung fokus |
| **`EditorTool` punya 8 member mati** | `"wall"`, `"dimension"`, 6 varian `exterior_*` tidak pernah di-set (types/index.ts:775-793) | Tipe menjanjikan tool dinding yang tidak ada |
| **Konfirmasi destruktif pakai `window.confirm`/`alert`** | editor-toolbar.tsx:495/:645, floor-switcher.tsx:62/64/91 | Tidak konsisten dgn dialog app |
| **Inspector 2D tak terjangkau di mobile** | 2D tak punya Drawer (3D punya) | Paritas mobile bolong |

---

## 3. Arsitektur target

Prinsip: **satu komponen = satu identitas seleksi = satu inspector = satu kosakata
widget**, dirender identik di 2D dan 3D. Lapisan data tidak berubah.

### 3.1 `EntityRef` — satu mata uang seleksi

File baru `src/types/entity-ref.ts`:

```ts
export type EntityRef =
  | { kind: "room"; id: string }
  | { kind: "opening"; id: string }
  | { kind: "wall"; roomId: string; side: Side }      // bentuk string via wallRefId() = `${roomId}:${side}`
  | { kind: "roof" }                                   // atap global legacy — singleton, tanpa id
  | { kind: "roofZone"; id: string }
  | { kind: "lamp"; id: string }
  | { kind: "railing"; roomId: string }                // roomId, atau sentinel ROOFTOP_RAIL_ID (dak)
  | { kind: "exterior"; id: string }
  | { kind: "electrical"; id: string }
  | { kind: "water"; id: string }
  | { kind: "sanitation"; id: string }
  | { kind: "furniture"; roomId: string; id: string }  // diadopsi belakangan (fase interior)
  | { kind: "light"; roomId: string; id: string };
```

Helper pendamping (satu file yang sama): `entityKey` (string stabil utk React key),
`sameEntity`, `wallRefId`, `isRooftopRail`, **`refFromLegacyId`** (sentralisasi scan
7-arah yang hari ini ada di editor-inspector — jadi SATU tempat), **`hostRoomIdOf`**
(ruang induk dari sebuah ref — utk konteks ruang di 3D), **`floorIdOf`** (lantai
dari sebuah ref — utk sinkron `selectedFloorId`).

Keputusan pada kasus canggung (sudah divalidasi terhadap kode):
- Wall = structured `{roomId, side}` — tervalidasi saat konstruksi, tak perlu parse
  ulang; bentuk string hanya utk key map `facade`/`facadeInner`.
- Rooftop-rail **dilebur ke kind `railing`** via sentinel `ROOFTOP_RAIL_ID` — seluruh
  pipeline 3D sudah mengunci prim dak ke sentinel berbentuk roomId itu
  (build-model.ts, house-model.tsx); kind terpisah = penanganan ganda tanpa manfaat.
- Atap global = `{kind:"roof"}` singleton (menggantikan `roofSelected: boolean`).
- Furniture/light = composite `{roomId, id}` — persis signature API interior-store
  dan bentuk aksi AI.
- Catatan engineering: ref adalah value object — komponen wajib select primitif
  (`s.selected?.kind === "opening" ? s.selected.id : null`) atau `useShallow`,
  supaya kanvas 3D tidak re-render tiap seleksi berubah.

### 3.2 Satu selection slice — di `editor-store` (bukan store ke-4)

- `selected: EntityRef | null` + `select(ref)` + `clearSelection()`.
- `select(ref)` **ikut men-set `selectedFloorId`** via `floorIdOf` — tanpa ini,
  seleksi dari 3D tak terlihat saat pindah ke 2D (2D floor-scoped).
- **Seleksi TIDAK ikut undo** (filosofi editor-store menang): undo me-restore layout
  snapshot yang bisa membuat ref menggantung, jadi undo → clear selection (perilaku
  yang sudah ada dipertahankan). Interior menyusul mengadopsi filosofi ini saat
  fase fold-in (drop field `selected*` dari `HistoryEntry`).
- Epilogue **`validateSelection`** di `commit()`: null-kan ref yang tak lagi resolve
  — membunuh seluruh kelas dangling-ref di satu tempat, bukan per-mutasi.
- `select()` = plain `set` di luar `commit()` → **tidak menyentuh
  `dirty`/`editSequence`** → autosave & layout-conflict tidak terpengaruh (dipin
  dgn unit test).
- Rollback AI assistant (`apply.ts` full `setState(before, true)`) otomatis ikut
  me-restore slice — aman tanpa kerja tambahan.
- **Bonus struktural**: karena `editor-store` sudah bertahan lintas route (bridge di
  `preview-3d/page.tsx:42-57` hanya me-load ulang saat ganti project), seleksi
  otomatis nyambung 2D↔3D tanpa kode sinkronisasi tambahan.

### 3.3 Migrasi kompat preview-store: delegate + bridge satu-arah

7 setter lama (`selectOpening` dst.) menjadi **delegate** ke
`editorStore.select(...)` (tanpa `set` lokal), dan satu modul `selection-bridge`
(vanilla `subscribe`, di-mount sekali dari Preview3DView) **memproyeksikan**
`selected` balik ke 7 field legacy — satu arah, tak mungkin loop. Handler klik di
house-model.tsx **tidak berubah sama sekali** di fase ini (memanggil nama setter yang
sama). Alasan menolak alternatif: getter zustand tidak reactive lintas store; dan
big-bang rewrite 45 read-site di file 3.214 baris adalah kerja ganda karena
read-site itu justru akan **dihapus** saat quick editor dibongkar di P2.

Dua nuansa penting:
- `selectedRoomId` di-mirror sebagai **konteks ruang turunan**
  (`selected.kind==="room" ? id : hostRoomIdOf(selected)`) — supaya kartu ruang +
  daftar furnitur 3D tidak hilang saat user memilih bukaan/lampu (perilaku hari ini
  yang memang berguna, dipertahankan secara eksplisit, bukan kebetulan).
- Exclusion jadi **struktural** (semua field turunan dari satu ref) → bug kartu
  menumpuk mati dengan sendirinya. Regression test: pilih exterior → pilih opening
  → tepat satu kartu.

### 3.4 Inspector registry: satu inspector per kind, dirender di mana pun

Paket baru `src/components/inspector/`:
- `registry.tsx` — peta `EntityRef["kind"] → InspectorComponent` + komponen
  `<EntityInspector refValue surface>`; dipakai panel kanan 2D **dan** 3D. Ini
  MENGGANTIKAN region kartu-entity-terpilih di kedua panel — bukan seluruh panel
  (panel 3D tetap punya konten non-inspector: preset fasad, quick-add, navigator
  interior; fallback tanpa-seleksi juga sah beda per surface).
- Tiap inspector per-kind = **superset merge** varian 2D + 3D hari ini. Contoh
  Opening: Header (jenis+ruang+ringkas W×H, DeleteButton) → §Jenis & Operasi →
  §Dimensi & Posisi (width/height/positionM/sill/head) → §Gaya
  (frame/warna/privasi) → §Model 3D (GLB daun + gorden via AssetPicker, collapsed)
  → §Catatan (collapsed).
- **Prop `surface: "2d"|"3d"` dgn batasan keras**: hanya boleh menambah *actions*
  (fokus kamera, tombol close, "Lihat di 3D") lewat satu slot `extraActions` —
  TIDAK PERNAH mengubah field, urutan, atau widget. Tanpa aturan ini registry akan
  bercabang lagi jadi varian 2D/3D dalam setahun.

### 3.5 Kit primitif `inspector/fields.tsx`

`Field`, `NumField` (kontrak commit tunggal: blur+Enter; varian slider = update live
lokal + **satu** entri undo saat release — menyelesaikan divergensi slider-vs-teks
di Atap), `ToggleRow`, `SegmentedControl` (**amandemen 2026-08-22**: grid
`<button aria-pressed>` native — BUKAN bungkus shadcn `toggle-group` seperti
diusulkan semula; `toggle-group`/`toggle` dihapus Fase 7 karena 0 pemakai alih-alih
dibungkus — menggantikan grid tulis-tangan), **`DirectionPicker`** (SATU widget n/s/w/e utk
tangga+atap+eksterior), `StyleTilePicker` (railing/cladding/tipe atap),
`Stat`, `InspectorSection` (angkat `AccordionSection` yang selama ini tidak
di-export dari preview-controls:115), `DeleteButton`
(`Hapus ${ENTITY_LABELS[kind]}` + affordance konfirmasi), `LockToggle`,
`HideToggle`. Satu skala label (11px medium — lebih padat, muat di kedua panel),
dikodekan di dalam `Field` supaya pilihan itu tak bisa diulang-ulang. Satu kamus
`ENTITY_LABELS` per kind + merge dua kamus eksterior (pemenang per-string diputuskan
sekali, dengan persetujuan owner — ini copy user-facing).

### 3.6 `AssetPickerHost` di level workspace

Sheet My Library + dialog upload hari ini lokal di panel 3D, di-dispatch lewat
string `customTarget` 9-arah, dan **membaca seleksi saat commit** (race). Ganti
dengan: slice `assetPickerRequest: { target: AssetTarget } | null` di mana
`AssetTarget` = union yang **membawa id entity saat request**
(`{type:"opening-model", openingId} | {type:"railing", roomId} | ...`), plus
komponen `AssetPickerHost` yang di-mount sekali di level workspace project. Tidak
ada dependensi 3D di dalamnya (Sheet portal ke body, panel library cuma butuh
projectId+react-query) → **picker yang sama otomatis bisa dipakai dari halaman 2D**,
dan race-nya tertutup sekalian.

### 3.7 Kontrak interaksi terpadu

- **Esc** = deselect (satu listener); **Del** = hapus entity terpilih apa pun
  (dispatch typed per `ref.kind` — memperbaiki no-op listrik/air/sanitasi; catat di
  changelog karena perilaku berubah dari "tidak terjadi apa-apa" → "terhapus").
- **Ctrl+Z** di kedua halaman → `editorStore.undo()`; fallback ke interior-store
  hanya saat ref furniture/light (status-quo utk kasus itu).
- Satu token warna highlight seleksi (hari ini 3D pakai `SHARED_COLORS.selected`,
  2D pakai class Tailwind lepas).
- **Dinding bisa diklik di 2D** (hit-target segmen tepi ruang di plan-canvas →
  `select({kind:"wall", roomId, side})`) — menunaikan spec `docs/PRD.md` §10.6 yang
  tak pernah dibangun.

---

## 4. Roadmap 4 fase (tiap fase shippable, gate test hijau)

| Fase | Isi | Ukuran | Risiko |
|---|---|---|---|
| **P0** | Kit primitif + `ENTITY_LABELS` + merge kamus eksterior; adopsi di editor-inspector.tsx saja (refactor murni, nol perubahan perilaku) | ±7 file, +600/−400 | Rendah |
| **P1** | `EntityRef` + slice seleksi + bridge + delegate setter + kontrak keyboard. **Quick win yang langsung terasa**: undo 3D benar, Del berfungsi semua objek, kartu menumpuk hilang, seleksi nyambung 2D↔3D | ±10 file, +650 | Medium (permukaan perilaku lebar tapi tiap item kecil) |
| **P2** | Registry + migrasi per-entity (1 entity = 1 PR yang juga MENGHAPUS quick-editor lama + field mirror + update testid e2e). Urutan: **Opening → Lamp** (uji AssetPickerHost di entity kecil) **→ Railing → Exterior → Roof** (paling berisiko — konsolidasi 3 inspector + 3 jalur tulis `rooftopArea`; desain IA "Atap" di atas kertas dulu) **→ Wall/Facade** (satu-satunya yang menambah permukaan interaksi baru: hit-target di plan-canvas) **→ Pool** (pisahkan add-flow tetap di 3D vs edit-flow ke registry) **→ Room → fold-in Furniture** (terakhir; drop seleksi dari HistoryEntry interior di PR yang sama) | ±20 file; preview-controls 3.214→<900, editor-inspector 2.607→<600 | Tinggi di Roof & Wall |
| **P3** | Cleanup: member `EditorTool` mati; 5 `pending*` → satu `pendingPlacement`; stop-**write** `layout.walls` (parser tetap toleran — layout lama harus tetap bisa parse); `window.confirm` → dialog; paritas mobile inspector 2D; hapus interior-workspace.tsx yang orphan (route `/interior` sudah redirect stub) | ±12 file, net −1500 | Rendah (mayoritas penghapusan) |

## 5. Register risiko

| Risiko | Detail | Mitigasi |
|---|---|---|
| e2e testid | Spec e2e meng-assert testid quick-editor (`exterior-quick-editor` di certification-scenes — dijaga komentar eksplisit di preview-controls:441; `facade-quick-editor`, `pool-add`, dll.) | P1 aman by construction (delegate mempertahankan pipeline klik→kartu). P2: wrapper registry membawa testid legacy ATAU spec diupdate di PR yang sama; jalankan spec terdampak lokal per PR (e2e tidak menge-gate deploy) |
| Jalur AI assistant | `apply.ts` membaca `selectedObjectId`+`selectedFloorId` sbg konteks LLM; ±45 varian aksi menamai id secara tidak konsisten (roomId vs openingId vs `id` telanjang vs composite) | P1: sediakan `selectedLegacyId()` turunan utk apply.ts (atau kirim `{kind,id}` — grounding lebih kaya, cek prompt server dulu); helper `refFromAction()` menormalkan penamaan di era P2 |
| Autosave/konflik | Autosave keyed `dirty`/`editSequence` | `select()` di luar `commit()` tak bisa memicunya; dipin unit test |
| Perf 3D | house-model ikut subscribe seleksi editor-store | Disiplin selector primitif / `useShallow`; store-nya sudah di-subscribe utk layout, tak ada coupling store baru |
| Perubahan perilaku Del | Dari no-op → benar-benar menghapus utk 3 jenis titik | Itu memang fix-nya; tulis di changelog |
| Scope floor | Seleksi 3D→2D tak terlihat bila `selectedFloorId` tak ikut diset | `select()` wajib set floor via `floorIdOf` — kriteria terima P1 + test |

## 6. Hubungan dengan PRD yang ada

Dokumen ini **menuntaskan**, bukan mengganti arah:
- `docs/PRD.md` §20: `RightInspector` tercantum sebagai komponen wajib-bangun —
  tidak pernah dibangun; §10.6 menspesifikasikan wall-inspector 2D — tidak pernah
  ada; §16.4 kontrak keyboard — hanya terpasang di 2D.
- `PRD_REVISED_INTEGRATED_3D_EDITOR_INTERIOR.md` §10.1: "Selected room harus sync
  dua arah" — baru bagian room preview↔interior yang jadi; 7 field seleksi lain di
  preview-store adalah akresi tak terdesain sesudah PRD itu; §13: instruksi berdiri
  mengekstrak reusable dari interior-workspace — belum pernah dieksekusi.
- `NEW_REVAMP_PRD.md` §8.2: sudah berisi wireframe inspector objek terpadu (hover →
  outline; klik → inspector kanan + fokus kamera); §13: "perluas panel
  `PreviewControls` yang ada, jangan bangun inspector baru".
- `KITAB_SUCI_BARUMA.md` §15.3 mendokumentasikan case "Wall" di EditorInspector
  yang tidak ada di kode — kitab justru sudah menulis model terpadu yang dituju.

## 7. Lampiran — indeks temuan per kategori

**Seleksi**: editor-store.ts:77 (id type-erased), editor-inspector.tsx:104-110
(scan 7-arah), :116-130 & :134-159 (ternary ganda), preview-store.ts:25-37 (7
field), :199-224 (exclusion asimetris), interior-store.ts:50-55 (seleksi dlm undo),
preview-3d-view.tsx:193-199 (satu-satunya sync), preview-3d/page.tsx:42-57 (bridge
layout lintas halaman).

**Primitif duplikat**: Field — editor-inspector.tsx:2559, preview-controls.tsx:3182
(OpeningNumField), wizard/fields.tsx:63; ToggleRow/ToggleLine —
editor-inspector.tsx:2578 (dgn icon injection string-match "Kunci posisi") vs
view-toolbar.tsx:40; Stat/Metric — editor-inspector.tsx:2600 vs
interior-workspace.tsx:1296; AccordionSection unexported — preview-controls.tsx:115;
9 button-grid tulis-tangan — interior-workspace.tsx:307, view-toolbar.tsx:257,
preview-controls.tsx:555/772/848/1453/2006/2490/2875.

**Bug**: undo 3D — preview-controls.tsx:164-185; Del no-op — editor-store.ts
deleteObject else-branch; kartu menumpuk — preview-store.ts:199-224; race
asset-picker — preview-controls.tsx:938-1065; Esc ganda — editor/page.tsx:122 vs
plan-canvas.tsx:1303; window.confirm — editor-toolbar.tsx:495/645,
floor-switcher.tsx:62/64/91; EditorTool mati — types/index.ts:775-793;
`layout.walls` dead — types/index.ts (tak pernah dibaca di src/).

**Identitas entity**: 15 skema id, 3 strategi generasi (nanoid / content-hash /
template struktural — catatan: id content-hash `op-`/`fe-`/`lamp-w-` tidak stabil
saat entity diedit); 1 parser kanonik `parseOpeningWall`
(lib/geometry/index.ts:144) + 1 duplikat tulis-tangan tanpa validasi
(assistant/actions.ts:793); prefix-match rapuh `startsWith(`${id}:`)` ×4
(editor-store.ts:634/669/673/683, preview-controls.tsx:1134); sentinel
`ROOFTOP_RAIL_ID` disimpan di field ber-nama roomId.
