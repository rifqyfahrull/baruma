# Investigasi: Tangga & Kolam Renang vs Kebutuhan Lapangan

**Status:** Gelombang 1–3 SELESAI 2026-07-15 (G1: dokumen & angka; G2: bentuk L/U + kolam bervariasi + RAB terukur; G3: KL-4 overflow+balancing tank, KL-6 keselamatan+beban, KL-7 spa lengkap jet/heater/chlorinator+filter cartridge, TG-6/KL-8 deprekasi tipe Stair/Pool dorman) — lihat plan gelombang masing-masing. Semua 14 WP tuntas.
**Metode:** pemetaan kode menyeluruh (dua sweep independen per fitur, dengan path+line), dibandingkan terhadap standar geometri SNI/praktik tukang & spesifikasi MEP kolam yang lazim di lapangan Indonesia
**Tujuan:** membuat tangga & kolam cukup nyata untuk (a) dipercaya kontraktor dari gambar kerja, (b) dihitung RAB-nya secara jujur, (c) aman secara aturan dasar

---

## Ringkasan eksekutif

Kedua fitur berada pada tingkat kematangan yang berbeda namun berbagi dua penyakit yang sama:

1. **Perhitungan teknik sudah ada tetapi tidak sampai ke dokumen kontraktor.** Sirkulasi kolam (pompa/filter/skimmer/pipa) dihitung serius dan divisualisasikan — tapi hanya di panel editor; sheet gambar kerja tidak memuatnya. Tangga digambar di denah, tetapi potongan & tampak sama sekali kosong — padahal potongan tangga adalah gambar yang paling dicari tukang.
2. **RAB tidak mencerminkan cara lapangan menghitung.** Tangga interior tidak punya line item sama sekali (hanya terhitung sebagai luas lantai); tangga eksterior dihitung `luas footprint × Rp 2,4 jt/m²`; struktur kolam dihitung `m² × rate` kasar, bukan volume beton + waterproofing + finishing terpisah.

Selain itu masing-masing punya gap bentuk/parameter: tangga hanya satu run lurus tanpa bordes dan tanpa kontrol riser/tread; kolam hanya persegi panjang berkedalaman seragam tanpa tangga masuk, tanpa opsi overflow/balancing tank.

Ada juga **dua tipe mati** yang menunggu membingungkan engineer berikutnya: `Stair` (`layout.stairs`) dan `Pool` (`layout.pools`) — keduanya selalu `[]`; tangga nyata = `Room type:"tangga"`, kolam nyata = `Room type:"kolam"`.

---

## Bagian A — Tangga

### A.1 Kondisi implementasi saat ini (hasil pemetaan kode)

Ada **tiga konsep** di kode; hanya dua yang hidup:

| Konsep | Sumber | Status |
|---|---|---|
| `Stair` / `layout.stairs` | `src/types/index.ts:535` | **Mati** — selalu `[]`; hanya dibaca `scene-stats.ts` |
| Tangga interior = `Room type:"tangga"` + `stairDirection` | `types/index.ts:348`, `editor-store.ts:1063` (`addStair`) | Aktif |
| `ExteriorStairElement` (`exterior_stair`) | `types/exterior.ts:89`, factory `factories.ts:179` | Aktif (undakan/trap luar) |

Kemampuan hari ini:

- **Interior**: dibuat via tombol `addStair()` (butuh ≥2 lantai), berupa Room 2,5×2,5 m di pojok footprint lantai dasar. Kustomisasi user: posisi/ukuran (drag Room) + arah naik (4 arah). Riser/tread **dihitung otomatis**: `steps = max(3, round((WALL_H+SLAB_T)/0.18))`. 3D: tumpukan balok solid per anak + handrail 0,9 m dua sisi + tiang tiap 4 anak (`build-model.ts:584-643`). Lubang slab lantai atas otomatis mengikuti posisi tangga (`build-model.ts:439-459`) — ini bagus dan jarang dimiliki tool sekelasnya.
- **Eksterior**: click-to-place, resize direction-aware, inspector punya Panjang/Riser/Arah (lebar hanya via drag). 3D: balok bertingkat tanpa railing. Validasi riser 0,12–0,20 m dan tread 0,25–0,35 m (`exterior/validation.ts:214-258`).
- **Denah**: garis anak + panah & label "NAIK" (`layout-sheet.ts:174-218`). **Potongan & tampak: kosong total** (grep nol di `section.ts`/`elevation.ts`).
- **RAB**: interior **tidak dihitung**; eksterior = `widthM×lengthM × Rp 2.400.000/m²` (`rates.ts:31`, `quantities.ts:221-234`).
- **AI**: bisa membuat/patch `exterior_stair`; interior hanya patch `stairDirection`.

### A.2 Kebutuhan lapangan (standar & praktik)

Aturan geometri yang dipakai arsitek/tukang di Indonesia (SNI 03-1728 / pedoman PU + praktik umum):

| Parameter | Nilai lapangan | Kondisi Baruma |
|---|---|---|
| Optrede (riser) | 15–19 cm, ideal 17–18 | otomatis 18 — kebetulan pas, tapi tak bisa diatur & tak divalidasi |
| Antrede (tread) | 25–30 cm | turunan `runLen/steps` — bisa keluar rentang tanpa peringatan |
| Rumus kenyamanan | **2R + T = 60–65 cm** | tidak dicek di mana pun |
| Lebar tangga rumah | min 80 cm; nyaman 90–120 | tidak dicek (interior); eksterior tak ada field lebar di inspector |
| Bordes | wajib praktis bila anak > 12; tinggi lantai 3,2 m+ ≈ 18 anak | **tidak ada konsep bordes sama sekali** |
| Headroom | min 2,0–2,1 m di sepanjang run | tidak dicek |
| Railing | 90 cm, jarak baluster ≤ 10–12 cm (keselamatan anak) | 3D interior ada handrail; tidak ada di eksterior; tak ada aturan baluster |
| Bentuk | lurus, **L**, **U/dogleg** (mayoritas rumah 2 lantai di lahan sempit memakai L/U!), putar | **hanya lurus** |

Cara lapangan menghitung biaya tangga beton (yang seharusnya tercermin di RAB):

- **Struktur**: volume beton pelat miring + anak (m³) + pembesian (kg) + bekisting (m²) — praktisnya ±Rp 4–6 jt/m³ terpasang, atau pendekatan per anak tangga.
- **Finishing**: granit/homogenous tile ±Rp 400–600 rb/m² (injakan+tanjakan), step nosing anti slip per meter.
- **Railing**: per meter lari — hollow ±Rp 750 rb–1,2 jt/m, kaca tempered ±Rp 1,5–2,5 jt/m.

Gambar kerja yang diminta kontraktor:

- Denah dengan **penomoran anak tangga (1..N)** + arah naik (Baruma: baru panah NAIK, tanpa nomor).
- **Potongan tangga**: profil riser/tread, tebal pelat, elevasi bordes — *ini gambar terpenting dan saat ini nol*.
- Detail railing.

### A.3 Gap utama tangga (diurutkan dampak lapangan)

1. **Potongan/section tidak menggambar tangga** — kontraktor tidak bisa membangun dari paket gambar sekarang.
2. **Tidak ada bordes & bentuk L/U** — untuk rumah lahan sempit (mayoritas use case Baruma), tangga lurus 2,5 m sering tidak muat/tidak realistis; tinggi lantai >3 m menghasilkan run terlalu panjang.
3. **RAB interior nol** — tangga beton 2 lantai bernilai Rp 15–30 jt luput dari estimasi; RAB eksterior pakai luas, bukan volume+finishing+railing.
4. **Riser/tread tak bisa diatur & tak divalidasi (interior)** — dan ada **tiga konstanta riser berbeda** di tiga tempat (0,175 di `exterior/geometry.ts:388`; 0,18 di `build-model.ts` & `layout-sheet.ts`; rentang 0,12–0,20 di `exterior/validation.ts`).
5. Eksterior: tanpa railing 3D, `widthM` tak ada di inspector.
6. Tipe `Stair` mati membingungkan (schema, scene-stats).

### A.4 Rekomendasi tangga (work packages)

| WP | Isi | Prioritas | Perkiraan |
|---|---|---|---|
| **TG-1 Geometri & validasi SNI** | Field opsional `stairRiserM`/`stairTreadM` (auto bila kosong) di Room tangga; validasi terpusat: riser 15–19, tread 25–30, 2R+T 60–65, lebar ≥80 cm, headroom ≥2,0 m (cek terhadap lubang slab); satukan konstanta ke `src/lib/stairs/geometry.ts` (satu sumber untuk build-model, layout-sheet, exterior, validasi) | **P1** | 1–1,5 hari |
| **TG-2 Bordes & bentuk L/U** | Model run-segmen: `stairSegments?: [{run, direction}]` dengan bordes otomatis di sambungan; UI: pilihan bentuk Lurus/L/U di inspector; 3D & denah & lubang slab mengikuti; AI action | **P1** | 3–4 hari |
| **TG-3 Potongan & penomoran** | `section.ts`: profil tangga (garis riser/tread + pelat) bila bidang potong melewati Room tangga; `layout-sheet.ts`: penomoran anak 1..N + break line standar | **P1** | 1–2 hari |
| **TG-4 RAB tangga** | Interior: line item volume beton (pelat miring ±12 cm + anak) per m³, finishing per m² (injakan+tanjakan), railing per m — `sourceElementIds` room tangga; eksterior: ganti basis m² → volume + finish, tambah railing opsional | **P1** | 1 hari |
| **TG-5 Railing eksterior + lebar di inspector** | Paritas dengan interior (handrail mengikuti kemiringan); field Lebar di `StairFields` | P2 | 0,5 hari |
| **TG-6 Bersih-bersih tipe `Stair` mati** | Hapus dari types/schema/scene-stats atau tandai deprecated eksplisit | P3 | 0,5 hari |

---

## Bagian B — Kolam Renang

### B.1 Kondisi implementasi saat ini (hasil pemetaan kode)

Kolam = `Room type:"kolam"` + `poolKind`/`poolDepthM`/`poolFinish` (`types/index.ts:357-362`); tipe `Pool`/`layout.pools` **dorman selalu `[]`**.

Yang sudah kuat (di atas rata-rata tool sejenis):

- **4 tipe kolam** (renang/plunge/anak/spa) dengan rentang kedalaman masing-masing (`pool.ts:21-26`); 4 finish; placement pintar (halaman → dak rooftop sebagai plunge → pojok footprint) (`editor-store.ts:1012-1061`).
- **Hidraulik dihitung sungguhan** (`pool-circulation.ts:53-95`): volume → turnover per tipe (renang 6 j, plunge 5, anak 4, spa 1) → debit → pompa (kelipatan 0,5 HP, ±15 m³/j per HP) → filter pasir bertingkat diameter → skimmer 1/25 m², inlet 1/15 m², main drain ganda >40 m² (anti-entrapment) → ukuran pipa hisap/balik → estimasi meter pipa.
- **Kelistrikan** (`pool-electrical.ts`): kW pompa, MCB (×1,25 dibulatkan ke ukuran standar), lampu 12 V + trafo bertingkat, bonding ekipotensial keliling; masuk beban PLN & tagihan (pompa 8 j/hari).
- **RAB kolam ter-itemisasi 7 baris** (struktur+WP, pompa, filter, pipa+fitting, panel, lampu+trafo, bonding) — semua confidence low, catatan "Perlu review struktur".
- **Readiness**: ada kolam ⇒ checklist engineer struktur "pending" (benar secara proses).

### B.2 Kebutuhan lapangan (praktik konstruksi & MEP kolam Indonesia)

| Aspek | Praktik lapangan | Kondisi Baruma |
|---|---|---|
| Sistem sirkulasi | **Skimmer** (ekonomis) ATAU **overflow + balancing tank** (standar kolam premium/rumah menengah-atas di Indonesia; balancing tank ±5–10% volume) | hanya skimmer; tidak ada konsep overflow/balancing tank |
| Kedalaman | bervariasi: dangkal 1,0–1,2 m → dalam 1,5–2,0 m dengan dasar miring; zona anak bertanggul | satu kedalaman seragam |
| Akses masuk | tangga masuk (entry steps) cor atau tangga stainless + handrail — **selalu ada di kolam nyata** | tidak ada sama sekali di geometri |
| Struktur | beton bertulang ±K-300, dinding/lantai 20–25 cm, waterproofing integral + coating; dihitung per m³ + m² WP | RAB `m² × (6,5 jt × 0,6)` kasar |
| Kolam di dak | beban ±1 t/m² per meter kedalaman ⇒ analisis struktur khusus, zona kolam + ruang mesin | plunge di dak diizinkan tanpa warning beban spesifik |
| Ruang mesin | pit/ruang pompa-filter dekat kolam, drainase backwash ke saluran | 1 titik "equipment" di denah pipa UI; tidak ada ruang mesin/backwash |
| Keselamatan | pagar pengaman anak (barrier ≥1,1 m) bila ada balita; permukaan keliling anti slip; jarak ke batas lahan | tidak ada validasi; hanya teks bonding di UI |
| Dokumen | denah pipa + skedul MEP + **detail potongan kolam** masuk paket gambar kontraktor | denah pipa hanya di panel editor; sheet gambar kerja nol kolam |
| Ekstra umum | heater (spa), chlorinator garam, jet/blower spa, cover | tidak ada (spa tanpa jet) |

### B.3 Gap utama kolam (diurutkan dampak lapangan)

1. **Perhitungan MEP tidak diterbitkan ke gambar kerja** — `plumbing-plan.ts` & sheet lain nol kolam; kontraktor tidak menerima denah pipa/skedul yang sudah susah payah dihitung. Ini gap termurah dengan nilai terbesar.
2. **Tidak ada potongan/detail kolam** (struktur, waterproofing, coping, kedalaman) di paket gambar.
3. **Tidak ada entry steps & kedalaman gradasi** — dua hal pertama yang ditanya pemilik rumah dan tukang.
4. **Tidak ada opsi overflow + balancing tank** — untuk pasar menengah-atas, skimmer-only terasa "kurang kolam beneran".
5. **RAB struktur kasar per m²** — lapangan menghitung m³ beton + m² waterproofing + m² finishing mosaic + m lari coping.
6. **Kolam di dak tanpa warning beban khusus**; tidak ada validasi keselamatan (pagar anak, jarak batas).
7. Spa tanpa jet/blower/heater; filter selalu pasir; tipe `Pool` dorman.

### B.4 Rekomendasi kolam (work packages)

| WP | Isi | Prioritas | Perkiraan |
|---|---|---|---|
| **KL-1 Terbitkan MEP ke gambar kerja** | Sheet "Denah Pipa Kolam" (reuse `poolFittings` + `poolCirculation` yang sudah ada → drawing builder pure, paritas UI/PDF) + tabel skedul MEP (pompa/filter/skimmer/inlet/drain/pipa/MCB/trafo/bonding); daftarkan stable sheet ID baru tanpa mengubah nomor sheet lama | **P1** | 1–2 hari |
| **KL-2 Entry steps + kedalaman gradasi** | Field `poolEntrySide` + `poolShallowM`/`poolDeepM` (fallback `poolDepthM`); 3D: undakan masuk 3–4 anak + dasar miring; volume sirkulasi pakai kedalaman rata-rata (formula sudah siap menerima `avgDepthM`) | **P1** | 2 hari |
| **KL-3 Potongan/detail kolam** | Builder `buildPoolDetail`: potongan memanjang (kedalaman, dinding 20 cm, lantai kerja, WP, coping, waterline) + catatan spesifikasi | **P1** | 1–2 hari |
| **KL-4 Sistem overflow & balancing tank** | `poolCirculationType: "skimmer" \| "overflow"`; overflow: gutter keliling di 3D, balancing tank (auto-size 7% volume) di denah pipa & RAB; pompa dihitung dari flow yang sama | P2 | 2–3 hari |
| **KL-5 RAB struktur riil** | Ganti basis: m³ beton (dinding+lantai dari dimensi & kedalaman) + m² waterproofing + m² finishing (mosaic per finish) + m lari coping; MEP tetap ter-itemisasi seperti sekarang | P2 | 1 hari |
| **KL-6 Validasi keselamatan & beban** | Warning kuat kolam di `floor-rooftop`/lantai atas ("beban ±X ton — wajib engineer struktur", angka dari volume); saran pagar pengaman bila brief menyebut anak; jarak ke batas lahan | P2 | 1 hari |
| **KL-7 Spa lengkap + opsi** | Jet/blower utk `spa` (masuk kelistrikan+RAB), heater opsional, chlorinator garam opsional; filter cartridge utk plunge/spa kecil | P3 | 2 hari |
| **KL-8 Bersih-bersih tipe `Pool` dorman** | Hapus/deprecate `Pool` & `layout.pools` (koordinasi dengan schema passthrough) | P3 | 0,5 hari |

---

## C. Urutan pengerjaan yang disarankan

Prinsip: dahulukan **kredibilitas dokumen** (gambar kerja + RAB jujur) sebelum menambah bentuk baru — itu yang membuat hasil desain bisa dibawa ke tukang.

1. **Gelombang 1 (dokumen & angka, ±1 minggu):** KL-1, TG-3, TG-4, KL-3, TG-1 — setelah ini paket gambar+RAB layak dibawa ke kontraktor.
2. **Gelombang 2 (realisme bentuk, ±1 minggu):** TG-2 (bordes/L/U), KL-2 (entry steps+gradasi), KL-5, TG-5.
3. **Gelombang 3 (kelas premium):** KL-4 (overflow), KL-6, KL-7, TG-6, KL-8.

Guardrails (mengikuti pola roadmap eksterior):

- Semua formula baru = pure function dengan unit test hand-calculation; drawing & 3D & RAB memakai helper geometri yang sama (jangan duplikasi formula riser/kedalaman).
- Legacy layout tanpa field baru harus merender identik (field opsional + fallback perilaku sekarang).
- RAB tidak boleh memberi harga pada hal yang belum dimodelkan — pakai pola excluded/assumptions yang sudah ada.
- Konstanta tangga hanya boleh hidup di satu modul (`src/lib/stairs/`), dikonsumsi semua layer.

## D. Referensi kode kunci (untuk eksekutor)

- Tangga: `editor-store.ts:1063` (addStair), `build-model.ts:584-643` (3D+railing), `:439-459` (lubang slab), `layout-sheet.ts:174-218` (denah NAIK), `exterior/validation.ts:214-258`, `exterior/geometry.ts:388-404`, `rates.ts:31`, `quantities.ts:221-234`.
- Kolam: `editor-store.ts:1012-1061` (addPool), `three/pool.ts` (kinds/finish/depth/placement), `pool-circulation.ts:53-125` (hidraulik+fitting), `pool-electrical.ts:44-70`, `preview-controls.tsx:2327-2628` (PoolQuickEditor+denah pipa UI), `mock/rab.ts:507-579` (RAB kolam), `mock/review.ts:71-107` (engineer gate).
- Tipe mati: `types/index.ts:535` (`Stair`), `:549-557` (`Pool`), keduanya selalu `[]`.
