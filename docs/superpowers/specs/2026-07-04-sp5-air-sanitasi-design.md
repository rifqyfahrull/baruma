# SP5 — Air Bersih/Kotor + Septic Tank + Sumur Resapan + Bak Kontrol

**Date:** 2026-07-04
**Status:** Design (awaiting review)
**Covers:** checklist poin **11 (Instalasi Air Bersih & Pembuangan)**, **12 (Detail Sumur Resapan & Septic Tank)**, **13 (Desain Bak Kontrol Air Limbah)**. Bagian dari [master roadmap](2026-07-03-master-roadmap-dokumen-kerja.md); mengikuti pola entity-module yang terbukti di SP4 (listrik).

## Context

- **Nol scaffolding air/sanitasi** kini selain 2 baris RAB flat ("Instalasi air bersih & kotor" volume `builtArea`; "Sanitair" volume `bathrooms`) dan `layout.pools` (dorman, selalu `[]`). Kategori RAB `plumbing` sudah ada.
- **Titik air belum ada** sebagai entitas; **objek lahan (septic/resapan/bak-kontrol) belum ada**; **jumlah penghuni tak ada field** → harus diturunkan dari jumlah kamar tidur.
- **Keputusan user (terkunci):** (1) titik air diedit di **editor 2D seperti listrik** (marker+tool+drag+inspector+auto-generate per tipe ruang); (2) objek sanitasi **bisa digeser di lahan** dengan **ukuran dari perhitungan SNI**; (3) **diagram riser disertakan** (1 sheet seluruh rumah).

## Keputusan desain

1. **Entitas `WaterPoint` di `DesignLayout` (JSONB, absolut meter, mirror `ElectricalPoint`).**
   ```ts
   type WaterPointType =
     | "kloset" | "wastafel" | "shower" | "kran" | "kran_taman"
     | "floor_drain" | "sink_dapur" | "kran_wudhu"
   type WaterSystem = "bersih" | "kotor" | "limbah"  // supply / grey / black
   type WaterPoint = { id: string; roomId: string; type: WaterPointType; x: number; y: number; note?: string }
   // DesignLayout.water?: WaterPoint[]
   ```
   Tiap tipe punya sistem tetap (kloset→limbah, wastafel/shower/floor_drain/sink→kotor, kran/kran_taman/kran_wudhu→bersih) — dipakai untuk warna/gaya jalur pipa & schedule. Absen = tanpa titik air (perilaku kini). Absolut meter (koordinat editor). Defensive read di semua konsumen (PUT layout tanpa zod — pelajaran SP4).

2. **Objek sanitasi lahan `DesignLayout.sanitation?` (bag baru, level-lahan, bukan `pools`).**
   ```ts
   type SanitationObject = { id: string; x: number; y: number; widthM: number; lengthM: number; depthM: number; capacity?: number }
   // sanitation?: { septicTank?: SanitationObject; soakwell?: SanitationObject; controlBoxes?: SanitationObject[] }
   ```
   Posisi absolut di lahan (Site.widthM×depthM), **bisa digeser** di editor (marker level-lahan baru — tak ada precedent, wire fresh). Dimensi **dihitung dari SNI** (auto-size), posisi default halaman belakang (y mendekati depth lahan). `controlBoxes` array (bak kontrol di titik belok/pertemuan jalur air kotor).

3. **Basis penghuni & perhitungan SNI (pendekatan, dengan disclaimer wajib).**
   - **Penghuni:** `occupants = max(4, jumlahKamarTidur × 2)` (kamar tidur dari `layout.rooms` type `kamar_tidur`). Konstanta terdokumentasi.
   - **Septic tank** (pendekatan SNI 2398:2017): debit `Q = occupants × 150 L/orang/hari`; volume efektif `V = Q × (t_retensi 3 hari)/1000 + occupants × lumpur(30 L/org/thn) × periode(3 thn)/1000` m³; kedalaman air 1,5 m + ruang bebas 0,3 m; luas = V/1,5; L:W = 2:1 → `lengthM=√(2·luas)`, `widthM=length/2`; `depthM=1,8`. `capacity=V`.
   - **Sumur resapan** (pendekatan SNI 8456:2017 / SNI 03-2453): dari luas atap (limpasan) `A_atap` (rumus SP3) + intensitas hujan rencana; volume resap `V_r = A_atap × 0,05 m` (koef simplifikasi limpasan-tampung); diameter 0,8–1,4 m (dari V_r & kedalaman 1,5–3 m); jumlah sumur = ceil(V_r / V_per_sumur). v1: 1 sumur diukur untuk V_r penuh (diameter dari V_r, dibatasi 0,8–1,4 m; kedalaman menyesuaikan).
   - **Bak kontrol:** ukuran standar `0,4×0,4 m`, kedalaman = kedalaman invert pipa di titik itu (default 0,5 m, +0,2 m per 10 m jarak dari fixture terjauh, dibatasi 1,2 m). Jumlah = titik belok jalur air kotor (heuristik: 1 per ruang basah + 1 di dekat septic). 
   - **Disclaimer tetap** di tiap sheet perhitungan (sama pola SP6 struktur): *"Perhitungan pendekatan berbasis SNI yang disederhanakan — wajib diverifikasi ahli plumbing/sanitasi berlisensi sebelum konstruksi."*
   - **Pipa** (SNI 8153:2015): air bersih ½″(kran)/¾″(utama); air kotor 2″(floor drain/wastafel)/3″; kotoran (kloset) 4″; vent 2″. Diameter per sistem terdokumentasi.

4. **Auto-generate titik air per tipe ruang, editable penuh.** `WATER_DEFAULTS: Record<RoomType, {...}>`: `kamar_mandi` {kloset, wastafel, shower, floor_drain}; `dapur` {sink_dapur, floor_drain}; `laundry` {kran, floor_drain}; `taman` {kran_taman}; `musholla` {kran_wudhu}; sisanya `{}`. Penempatan sepanjang dinding (offset 0,3 m), pola SP4. Tombol Auto-generate + tempat manual. `autoSizeSanitation(layout, occupants)` menghitung & menaruh 3 objek bila belum ada.

5. **Sheet (baru di Gambar Kerja + PDF):**
   - **Rencana Air — <lantai>** (P-01…) per lantai: denah + simbol fixture (per tipe) + **jalur pipa skematik** (garis dari tiap fixture ke stack terdekat — air bersih & air kotor dibedakan gaya garis) + legenda + **tabel fixture schedule** (tipe, jumlah, sistem, Ø pipa).
   - **Diagram Riser** (P-R) — 1 sheet seluruh rumah: tumpukan vertikal per lantai, stack air bersih (naik) + air kotor/kotoran (turun) + vent, fixture per lantai tersambung, label diameter & lantai.
   - **Detail Septic Tank** (S-01), **Detail Sumur Resapan** (S-02), **Detail Bak Kontrol** (S-03): potongan parametrik berdimensi (dari sizing SNI), susunan (septic: 2 ruang + pipa inlet/outlet + tutup; resapan: pasangan bata berongga + ijuk/kerikil + pipa; bak kontrol: bak + tutup + invert), label ukuran + kapasitas + catatan SNI + disclaimer.

6. **RAB diperhalus** (kategori `plumbing`, mirror listrik SP4): baris "Instalasi titik air" volume = jumlah `layout.water` nyata (fallback estimasi bila 0, pelajaran SP4); "Sanitair" tetap per-fixture; **baris baru** "Septic tank (SNI)" (volume = kapasitas m³ atau 1 unit, harga dari ukuran), "Sumur resapan" (1 unit), "Bak kontrol" (jumlah unit). Summary = Σ items.

7. **AI parity penuh** (aturan repo): aksi floorplan air (`addWaterPoint`/`moveWaterPoint`/`updateWaterPoint`/`removeWaterPoint`/`autoGenerateWater`) + sanitasi (`moveSanitationObject`/`autoSizeSanitation`) — rantai `setRoof`/electrical: schema+`satisfies`+describe+sanitize(validasi id/room, clamp ke lahan/ruang, enum)+prompt+dispatch+scene grounding (`water[]`, `sanitation`).

## Deliverables

| Bagian | Artefak (pure/where) | Isi |
|---|---|---|
| Entitas | `WaterPoint`/`SanitationObject` + `layout.water?`/`sanitation?` (types) | Titik air per ruang + 3 objek lahan |
| Pure builders | `src/lib/water/{water,plan,sanitation}.ts` | Glyph/pipa/loads; auto-gen per ruang; sizing SNI septic/resapan/bak |
| Sheet | `drawings/{plumbing-plan,riser-diagram,sanitation-detail}.ts` | Rencana Air per lantai + riser + 3 detail parametrik |
| Sheet-list | `sheet-list.ts` `kind:"plumbing"|"riser"|"sanitation-detail"`; P-/S- | Halaman + PDF |
| Editor | plan-canvas (marker air + objek lahan), inspector, toolbar | Tempat/edit/geser/auto-gen/auto-size |
| AI | actions/editor-assistant/apply | 7 aksi + sanitize + prompt |
| RAB | mock/rab.ts | Titik air nyata + septic/resapan/bak-kontrol |
| Konstanta | constants + water module | WATER_POINT_TYPES/WATER_DEFAULTS/pipa/koef SNI |

## Testing

- **Pure:** `autoGenerateWater` (fixture per tipe ruang, in-bounds, idempoten); sizing SNI (`sizeSepticTank(occupants)`, `sizeSoakwell(roofArea)`, `sizeControlBox(...)` — dimensi eksak utk kasus contoh, mis. 8 penghuni → septic V & L×W eksak); `buildPlumbingPlan`/`buildRiserDiagram`/`buildSanitationDetail` (simbol per tipe, jalur pipa, dimensi detail, disclaimer ada); occupants dari kamar tidur; defensive read.
- **Store/AI:** CRUD undo air + move sanitation; sanitize clamp (ruang/lahan), enum, id validation; describe.
- **RAB:** titik air nyata + baris septic/resapan/bak eksak; summary = Σ items.
- **E2E:** sheet Rencana Air (simbol + /Ø|pipa/), Diagram Riser (/Riser|vent/), Detail Septic (/Septic|SNI/); tempatkan titik air + auto-size sanitasi → marker muncul. Existing tak dilemahkan.
- **Gate penuh:** tsc · vitest · build · **Playwright FULL**.

## Non-goals v1

Perhitungan hidraulika presisi (fixture units/kerugian gesek — pakai Ø standar per sistem); pompa/tandon/booster detail; jaringan PDAM/meteran; grease trap detail; drainase kota; kalkulasi resapan berbasis uji perkolasi tanah nyata (pakai koef simplifikasi + disclaimer); riser 3D (skematik 2D).

## Sequencing (≈10 task)

T1 `WaterPoint`/`SanitationObject` types + `layout.water`/`sanitation` + store CRUD undo (air + sanitation move) → T2 `water.ts` (glyph/pipa/WATER_DEFAULTS) + `autoGenerateWater` (pure) → T3 `sanitation.ts` sizing SNI (septic/resapan/bak + occupants) (pure) → T4 `plumbing-plan.ts` (denah + pipa + schedule) → T5 `riser-diagram.ts` + `sanitation-detail.ts` (3 detail) → T6 sheet-list P-/P-R/S- + integrasi halaman/PDF → T7 editor: marker air + objek lahan (geser) + inspector + tool + auto-size → T8 AI parity (7 aksi) → T9 RAB perhalus → T10 e2e + gate penuh + review akhir.

## Self-review

**Coverage:** poin 11 (T2/T4/T7), 12 (T3/T5 septic+resapan), 13 (T3/T5 bak kontrol), semua ke RAB (T9) + AI (T8). **Placeholder:** tidak ada — tipe, WATER_DEFAULTS, koef SNI (150 L/org, retensi 3 hari, occupants=kt×2 min4, Ø pipa), simbol, urutan sheet dipatok. **Konsistensi:** `WaterPoint`/`SanitationObject` T1 ↔ semua; sizing T3 ↔ detail T5 ↔ RAB T9; sheet-list T6 ↔ e2e T10. **Risiko:** objek lahan = marker level-lahan net-new (tak ada precedent pool) → T7 sendiri; a11y aria-label wajib (pelajaran SP4); defensive read (PUT tanpa zod). **Disclaimer SNI wajib** di tiap sheet perhitungan (konsisten arah "perhitungan sungguhan + verifikasi ahli").
