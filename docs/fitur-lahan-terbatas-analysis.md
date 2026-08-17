# Analisa Fitur — Niche Desain Rumah Lahan Terbatas

> Riset & analisa: 2026-08-15. Metode: pemetaan kode Baruma (Explore) + riset domain regulasi/teknik lahan sempit Indonesia + analisa kompetitor & pola UX/AI. Angka regulasi & biaya diverifikasi ke sumber 2026. Ini dokumen ANALISA/ROADMAP, bukan spec implementasi.

## Temuan inti (posisi pasar)

**Baruma sudah jauh lebih matang dari mayoritas kompetitor untuk niche ini, dan memegang celah pasar yang belum diisi siapa pun.**

Tidak ada satu pun kompetitor — global maupun lokal — yang menggabungkan **validasi zonasi lokal (KDB/KLB/GSB) + RAB otomatis + AI assistant awam-friendly** dalam satu alur:
- **Tool visual global** (Planner 5D, Homestyler, Coohom, RoomSketcher, Cedreo, HomeByMe): cantik & mudah, tapi **buta regulasi lokal** dan tanpa RAB.
- **Tool generative zoning-aware** (TestFit $10k/thn, Autodesk Forma $125/bln, Maket.ai $30–150/bln, ArchiStar): canggih tapi **harga & kompleksitas profesional**, US/EU/AU-centric, bukan rumah tunggal awam.
- **Lokal Indonesia**: Arsitag/Gravel = marketplace **manusia** (arsitek/tukang hitung KDB manual, bukan software). **Denahku.com** paling mirip Baruma (AI text→denah + RAB + 3D, Rp39rb/bln) **tapi tidak ada validasi zonasi** — celah terbuka.

Baruma sudah punya `design-audit.ts` (KDB/KLB/GSB), `reflow.ts`/`auto-fix.ts`/`fix-all.ts` ("geser tetangga otomatis" agar patuh regulasi — **tidak ada padanannya di kompetitor manapun untuk segmen awam**), `solar.ts` (studi matahari setara/lebih baik dari tool consumer), dan `domain-knowledge-regulasi-tapak-lahan-sempit.md` yang sudah memuat spec regulasi lahan sempit lengkap sebagai teks. **Strategi menang = eksekusi/tajamkan aset ini, bukan bangun dari nol.**

## Yang SUDAH ADA (jangan diusulkan ulang)

| Area | Status | Bukti |
|---|---|---|
| Audit KDB / KLB / GSB depan | ✅ | `standards.ts` (`MAX_KDB=0.6`, `MAX_KLB=1.8`, `GSB_ROAD_FRACTION=0.5`), `design-audit.ts:auditRegulatory` |
| Multi-lantai, mezzanine, split-level, void, kantilever, rooftop (partial) | ✅ | `Floor.kind`, `Room.levelOffsetM`, `openToSky`, `Floor.offsetM`, `rooftopArea` |
| Skylight + kredit cahaya dari void/courtyard | ✅ | `skylights[]`, `design-audit.ts` (court `openToSky` crediting) |
| Studi matahari / orientasi | ✅ | `solar.ts` (posisi matahari nyata per kota ID), popover Pencahayaan |
| Reflow solver "geser tetangga" + auto-fix + fix-all | ✅ | `reflow.ts`, `design-strategies.ts`, `auto-fix.ts` |
| Audit ruang sempit (SNI), sirkulasi, konektivitas, ventilasi (jendela) | ✅ | `auditRooms`, `auditCirculation`, `auditRoomAccess`, `validation.ts` |
| Carport, tangga (L/U), RAB per-m² | ✅ | `ROOM_STANDARDS.carport`, `stairShape`, `CostSummary.perM2IDR` |
| AI assistant NL (courtyard/skylight/mezzanine) | ✅ | `editor-assistant.ts`, `agent-lab.ts`, `feature-catalog.ts` |

## Gap teranalisa (yang lemah / belum ada)

**Regulasi:**
- **KDH (Koefisien Dasar Hijau)** belum ada — bersaing langsung dengan KDB di lahan sempit (sisa lahan dibagi bangun vs wajib hijau/resapan); terhubung ke pain point banjir/resapan.
- **0-lot-line tak diberlakukan** — `Site.sidesAttached` ada tapi tak memicu **larangan bukaan pada dinding batas** (pelanggaran hukum, bukan preferensi). Tak ada cek jarak fondasi/sempadan samping-belakang.
- **GSB per-kota** — default nasional (½ lebar jalan) sudah ada tapi salah untuk Jakarta (tabel bertingkat Pergub 31/2022: jalan 12–26 m → GSB 8 m, dst). Ambang hardcoded nasional meski `site.city` tersedia.
- **Batas ketinggian & tinggi plafon minimum (2,4–2,5 m)** + **syarat mezzanine (total tinggi 4,4–5 m)** belum ada konstanta.

**Analisa desain:**
- **Cross-ventilation / stack-effect** — tak ada mesin cek bukaan dua-sisi/aliran udara; hanya rasio jendela per ruang. **Belum diisi kompetitor manapun** → kandidat diferensiator.
- **Aturan cahaya denah memanjang** — "wajib void/skylight bila lebar ≤8 m diapit" & "ruang ≤6–8 m dari sumber cahaya" ada di domain-knowledge, **belum jadi hard rule** di audit. Menjawab keluhan #1 awam (rumah gelap/pengap).
- **Understair storage & ruang multifungsi** — belum ada.
- **Validasi dimensi tangga** (lebar 90–120 cm, riser 15–19 cm, tread 26–30 cm, bordes >10 anak) — perlu diverifikasi; jika belum, ini keselamatan konkret yang mudah dilanggar di rumah sempit.

**Model lahan & biaya:**
- **Lahan non-persegi** (L-shape / hook / tusuk sate) tak bisa dimodelkan (`Site` rect-only; semua solver hardcoded `widthM×depthM`). Kontur/kemiringan tanah juga belum ada.
- **RAB struktur per-lantai** diasumsikan ~linear per m²; realitanya fondasi/kolom/dak naik non-linear saat naik lantai (~30–35% biaya = struktur). Tak ada metrik efisiensi lahan.

**UX / AI (table stakes yang mulai tertinggal):**
- **Text-to-layout** ("rumah 2 lantai, 3 kamar, lahan 6×12" → opsi denah) sudah jadi standar (Denahku/Coohom/Maket.ai) — Baruma punya audit untuk validasi tapi entry generatifnya belum sekuat itu.
- **Soft-guardrail visual** saat drag (overlay zona terlarang GSB/KDB real-time) — deteksi backend sudah ada, tinggal UX front-end.

## Rekomendasi terprioritas

### Tier 1 — Quick wins (perluas engine audit yang sudah ada; effort rendah, dampak tinggi)
Semua menambah rule/konstanta ke `standards.ts` + `design-audit.ts` yang sudah grounded:
1. **KDH** — konstanta + rule (luas hijau/resapan vs lahan); tampilkan di kartu audit. Menjawab banjir/resapan.
2. **Larangan bukaan 0-lot-line** — pakai `sidesAttached` + posisi dinding untuk flag jendela/ventilasi di dinding batas. **Dampak legal tinggi** untuk awam yang tak tahu.
3. **Hard rule "wajib void/skylight/courtyard bila lebar ≤8 m & diapit"** — kodekan checklist domain-knowledge §5. Menjawab keluhan #1 (rumah gelap).
4. **Tinggi plafon minimum + syarat tinggi mezzanine** — konstanta baru + validasi.
5. **Override manual KDB/KLB/GSB/KDH per proyek** — input opsional "angka Perda lokasimu", default nasional sebagai fallback. **Menaikkan akurasi Jakarta tanpa hardcode per-kota yang tak scalable.**
6. **Validasi dimensi tangga** (verifikasi dulu; lengkapi bila belum).

### Tier 2 — Kapabilitas analisa baru (effort sedang)
7. **Cross-ventilation checker sederhana** untuk rumah terapit (bukaan dua-sisi / clerestory + bukaan rendah / void) — visual awam-friendly, manfaatkan infra `solar.ts`. **Celah pasar (belum ada kompetitor).**
8. **Analisa jarak-ke-sumber-cahaya** pada denah memanjang (flag zona tengah/belakang gelap).
9. **RAB struktur per-lantai non-linear** + metrik efisiensi lahan (biaya vs KDB/KLB) — estimasi vertical-development realistis.
10. **Understair storage** sebagai elemen.

### Tier 3 — Diferensiator strategis (effort tinggi, moat)
11. **Text-to-layout tervalidasi-zonasi** — sambungkan generator awal ke audit engine ("Maket.ai untuk rumah Indonesia, freemium"). Menutup gap dengan Denahku sekaligus melampauinya (mereka tanpa zonasi).
12. **Soft-guardrail visual GSB/KDB saat drag** — overlay zona terlarang berwarna real-time (oranye informatif, bukan merah menakutkan). Murni investasi front-end di atas deteksi yang sudah ada.
13. **"Cek Kelayakan Lahanmu"** — feasibility report berbayar (KDB/KLB/GSB/KDH + RAB kasar → PDF), biayanya di-kredit-kan bila lanjut ke desain lengkap. **Funnel + monetisasi terbukti** di industri.
14. **Model lahan non-persegi** (L/hook/tusuk sate) — perubahan engine besar; jadwalkan bila data menunjukkan permintaan. Termasuk asisten kontekstual kavling hook/tusuk sate (saran orientasi pintu/pagar/roster — jawab kekhawatiran budaya tanpa klaim mistik).
15. **Export PBG-ready** sebagai tier premium — belum ada kompetitor ID yang self-serve.

### Monetisasi (validasi lintas sumber — yang orang mau bayar)
Laporan kelayakan lahan sebelum investasi besar (#13), export dokumen resmi siap-ajuan PBG (#15), dan akses konsultasi manusia sebagai jaring pengaman atas output software. Pola kredit (pay-per-generate AI) + PRO Pass bulanan (fitur non-AI: export tanpa watermark, dimensi pro) ala Denahku/Canva cocok untuk pasar awam ID.

## Catatan strategis / hati-hati
- **Jangan hardcode zonasi per-kota** — KDB/KLB/GSB/KDH selalu Perda/RDTR-spesifik & berbeda per sub-zona bahkan dalam satu kota. Pendekatan benar = default nasional konservatif berlabel "advisory, cek Perda" (sudah dilakukan) + override manual per proyek (#5). Tabel per-kota tak scalable.
- **Jaga RAB & audit sebagai rule-engine deterministik**, posisikan AI sebagai *generator ide cepat* (text-to-layout, render). Industri sepakat AI cost-estimation & AI zoning-reading belum andal — "AI cepat + rule-based akurat" adalah sweet spot yang belum dikuasai kompetitor (mereka pilih salah satu ekstrem).
- **Non-goal saat ini**: BIM/LOD 300+ (hype untuk segmen awam), AR LiDAR eksklusif (pakai foto HP bila kelak perlu "gambar lahanmu"), kombinasi programmatic kota×gaya×type sebelum data template cukup.

## Aset fondasi (titik sambung implementasi)
`design-audit.ts` (engine siap ditambah rule), `standards.ts` (tempat ambang/konstanta), `solar.ts` (studi matahari → basis ventilasi), `reflow.ts`+`design-strategies.ts` (solver spasial), `feature-catalog.ts` (jembatan NL AI), dan `domain-knowledge/domain-knowledge-regulasi-tapak-lahan-sempit.md` (spec regulasi lahan sempit sebagai teks — tinggal dieksekusi jadi kode).
