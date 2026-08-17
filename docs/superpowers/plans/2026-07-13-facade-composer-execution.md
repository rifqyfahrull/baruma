# Facade Composer Execution Plan

**Status:** implemented and verified  
**Tanggal:** 2026-07-13  
**Target:** customer awam dapat menyusun tampak depan rumah modern seperti dua
referensi sertifikasi dengan elemen semantik yang tetap editable, tersimpan,
tergambar, dapat dihitung, dan dapat dikendalikan AI.

## 1. Outcome yang dikunci

Facade Composer bukan mesh editor dan bukan state desain baru. Ia adalah alur
customer-facing di atas `DesignLayout` yang sudah ada:

```text
Template / editor 2D / preview 3D / AI proposal
                       |
                       v
              editor-store actions
              commit + undo/redo
                       |
                       v
                 DesignLayout
          +------------+------------+
          |            |            |
          v            v            v
      Preview 3D   Gambar Kerja    RAB/BOQ
```

Keputusan domain:

- `FacadeElement` tetap dipakai untuk kisi, roster, secondary skin, dan custom
  GLB yang menempel pada satu dinding host.
- `ExteriorElement` dipakai untuk portal, panel vertikal, kolom/balok aksen,
  kanopi, planter, pagar, gate, driveway, walkway, tangga luar, dan asset tapak.
- Custom GLB hanya mengganti visual envelope. Geometry semantic, warning,
  drawing representation, dan costing policy tidak hilang.
- Semua mutation UI dan AI harus melewati method store yang sama. Tidak ada
  mutation array langsung dan tidak ada endpoint AI khusus facade.

## 2. Baseline aktual pada 2026-07-13

Sudah tersedia dan wajib dipakai ulang:

- layout schema v2, revision guard, serialized autosave, dan HTTP 409 conflict;
- union type, factory, geometry, validation, quantity, dan store action untuk
  seluruh `ExteriorElement` v1;
- layer editor 2D, placement, selection, handles, inspector, lock/hide,
  duplicate, delete, serta undo/redo;
- cladding per dinding, `FacadeElement` louver/slat/roster, facade preset lama,
  dan custom GLB pada elemen hosted-wall;
- unified assistant action pipeline, scene snapshot, sanitizer, dan apply
  melalui store untuk floorplan/interior/facade hosted-wall.

Gap terverifikasi:

1. `exteriorElements` belum diturunkan menjadi primitive pada `build-model.ts`,
   sehingga objek yang dibuat di editor 2D belum muncul pada Preview 3D.
2. Quantity exterior masih terisolasi dan belum masuk `generateRAB`/`BOQItem`.
3. Gambar Kerja belum memproyeksikan exterior semantic elements secara utuh.
4. Unified AI belum memiliki action add/update/remove `ExteriorElement`.
5. Belum ada template frontage customer-facing yang membangun komposisi native
   secara transactional.
6. Belum ada workflow tampak depan yang mengelompokkan operasi facade tanpa
   memaksa customer memahami jenis internal.

## 3. Scope eksekusi

### M1 - Exterior primitive parity

Tambahkan pure derivation `exteriorElementPrimitives(layout, context)` pada
modul exterior Three.js baru. Output memakai contract `Prim`, stable ID, owner
floor/site, material reference, selection ID, dan model reference.

Representasi minimum:

- segment: tembok batas, pagar, sliding/swing/pedestrian gate;
- box: solid wall, facade panel, column, beam, slab, canopy, planter;
- frame: portal sebagai tiga member dari satu semantic object;
- stair: anak tangga dari rise/run yang sama dengan quantity helper;
- surface: driveway/walkway/terrace/garden sebagai surface primitive;
- asset: envelope fallback dan GLB bila URL valid.

Failure contract:

- hidden element tidak menghasilkan primitive;
- invalid/non-finite geometry tidak merusak scene;
- missing/broken GLB menampilkan envelope fallback;
- click pada primitive memilih `ExteriorElement.id`, bukan room palsu;
- site-owned element tetap tampil pada semua filter lantai yang relevan.

### M2 - Gambar Kerja dan RAB parity

Gambar Kerja:

- proyeksikan segment/box/frame/stair/surface pada denah dan elevasi;
- gunakan stable `refId` agar objek drawing dapat ditelusuri ke layout;
- custom model digambar sebagai envelope berlabel verifikasi, bukan mesh;
- renderer screen dan export membaca contract drawing yang sama.

RAB:

- integrasikan `exteriorElementQuantities` ke `generateRAB`;
- tambahkan `sourceElementIds?: string[]` pada `BOQItem`;
- gabungkan line hanya bila item, unit, material/rate, dan inclusion policy sama;
- custom asset tanpa rate tetap excluded dan menghasilkan assumption/warning;
- total dan category summary tetap berasal dari line item hasil akhir.

### M3 - Unified AI exterior parity

Tambahkan action:

- `addExteriorElement` dengan discriminated payload per geometry kind;
- `updateExteriorElement` dengan patch whitelist sesuai kind existing;
- `removeExteriorElement` dengan stable ID;
- `applyFacadeTemplate` untuk template native yang dikenal server/client.

Sanitizer wajib memeriksa:

- kind legal, angka finite, dimensi positif, floor ownership, dan site bounds;
- polygon 3-16 titik untuk AI, tidak self-intersecting;
- update tidak boleh mengganti `id` atau discriminator secara ilegal;
- asset model harus memakai reference yang sudah tersedia pada scene/library;
- batch action invalid dilepas secara deterministik tanpa merusak action valid.

Apply memakai `addExteriorElement`, `updateExteriorElement`, dan
`removeExteriorElement` pada store sehingga semua perubahan undoable dan ikut
autosave/revision guard.

### M4 - Facade templates dan customer workflow

Template v1:

- `modern_concrete_vertical`;
- `brick_gable_roster`;
- `minimalist_portal_carport`.

Template adalah pure function yang menghasilkan semantic operation, bukan GLB
gabungan. Apply dilakukan sebagai satu transaction/history entry dan tidak
menghapus room, opening, furniture, atau facade existing di luar scope template.

Facade workflow pada editor:

1. Customer memilih gaya atau mulai kosong.
2. Sistem menampilkan preview daftar elemen yang akan ditambahkan.
3. Customer apply satu klik.
4. Elemen langsung dapat dipilih, diresize, digeser, diganti material/model,
   di-undo, dan diubah melalui AI.
5. Audit menampilkan invalid geometry dan RAB exclusion sebelum export.

`Tampak Depan` v1 memakai front-orientation project/site untuk memusatkan
workflow dan filter selection. Ia tidak membuat coordinate system kedua.
Editing tetap menulis geometry site-plane yang sama agar 2D, 3D, drawing, dan
RAB tidak drift.

### M5 - Verification dan rollout

Unit/integration:

- primitive mapping untuk setiap kind, hidden/invalid, floor/site elevation;
- portal member count dan stable IDs;
- GLB success/error fallback;
- drawing projection untuk empat sisi;
- RAB hand calculation, traceability, excluded custom asset;
- action schema/sanitizer/apply success dan seluruh invalid branch;
- template determinism, collision-free IDs, one-step undo, unrelated data
  preservation.

Regression gates:

- existing facade/cladding/custom GLB tests tetap hijau;
- existing unified assistant capability parity tetap hijau;
- legacy layout tanpa `exteriorElements` menghasilkan model/drawing/RAB identik;
- full lint, TypeScript, Vitest, dan Next build lulus.

Certification:

- Scene A: portal putih, lima panel beton, canopy/soffit, boundary wall, dua
  gate, driveway, walkway, planter, dan tangga luar;
- Scene B: portal carport, roster/slat hosted-wall, gate, planting bed, serta
  aksen material;
- save/reload, undo/redo, Preview 3D, elevation, dan RAB harus konsisten.

## 4. Urutan implementasi dan dependency

| Task | Modul utama | Depends on | Exit gate |
|---|---|---|---|
| FC-01 primitive derivation | `lib/exterior`, `lib/three` | baseline | every kind mapped |
| FC-02 3D render/selection/GLB | `preview-3d` | FC-01 | fallback + click pass |
| FC-03 drawing projection | `lib/drawings` | FC-01 | plan/elevation parity |
| FC-04 RAB integration | `lib/exterior`, `lib/mock/rab` | baseline quantities | hand calc reconcile |
| FC-05 AI action parity | `lib/assistant`, `lib/server` | store baseline | schema/sanitize/apply pass |
| FC-06 native templates | `lib/facade`, editor UI | FC-01/FC-05 | one-step apply/undo |
| FC-07 certification | fixtures/tests/docs | FC-01..06 | full quality gates |

Implementasi berjalan sequential pada integration hotspot. Pure primitive,
drawing, quantity, dan template modules dibuat terpisah agar tidak menambah
logic baru langsung ke file besar.

## 5. Performance budget

- derivation 500 exterior elements: p95 < 50 ms pada unit benchmark;
- tidak ada O(n2) pair scan baru pada render path;
- repeated fence/slat boleh procedural v1, tetapi harus dikelompokkan dan
  tidak membuat state React per bilah;
- custom GLB di-clone/cache melalui loader existing, tidak di-fetch manual;
- layout payload tidak menyimpan mesh/base64;
- editor drag tidak menjalankan drawing/RAB generation.

## 6. NOT in scope

- free-form mesh/vertex modelling dan boolean geometry;
- rekonstruksi ukuran otomatis dari satu foto;
- roof-zone editor penuh (tetap work package terpisah karena contract roof
  lintas renderer belum selesai);
- photoreal cloud renderer;
- klaim keamanan struktur portal/beam/canopy custom;
- pricing palsu dari bounding box GLB.

## 7. Definition of done

Facade Composer dianggap selesai hanya bila satu komposisi template:

- tersimpan di `DesignLayout` v2 dan aman terhadap revision conflict;
- dapat di-undo/redo sebagai satu intent;
- dapat diedit kembali melalui UI dan AI;
- terlihat pada editor 2D dan Preview 3D;
- muncul pada Gambar Kerja yang relevan;
- mempunyai quantity/costing status yang dapat ditelusuri;
- tidak mengubah kemampuan room, opening, interior, roof legacy, cladding,
  facade hosted-wall, atau custom GLB existing;
- lulus seluruh quality gate pada M5.

## 8. Execution record

Selesai pada 2026-07-13:

- [x] FC-01 pure exterior primitive derivation untuk seluruh kind;
- [x] FC-02 Preview 3D, selection, material, custom GLB fit, dan fallback;
- [x] FC-03 denah/elevasi dengan stable semantic `refId`;
- [x] FC-04 RAB rate catalog, quantity integration, exclusion, dan
  `sourceElementIds` sampai export;
- [x] FC-05 unified AI add/update/remove exterior + facade template, sanitizer,
  dan capability parity;
- [x] FC-06 tiga native facade templates pada toolbar, satu transaction undo;
- [x] FC-07 lint, TypeScript, 1.722 Vitest tests, dan production build.

Catatan batas: zoned roof editor dan rekonstruksi otomatis dari foto tetap
work package terpisah sesuai bagian NOT in scope. Facade Composer v1 sudah
menutup frontage/additive facade, tetapi Scene B masih memerlukan roof-zone
milestone agar pelana lokal dan atap datar per massa sepenuhnya native.
