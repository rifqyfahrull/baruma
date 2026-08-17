# Domain Knowledge: Regulasi Tapak & Strategi Desain Lahan Sempit — Arsitektur Modern Indonesia

> Basis pengetahuan fondasional untuk sistem generatif desain rumah. File ini menentukan **batas hukum & fisik** apa yang boleh di-generate di suatu kavling sebelum komponen lain (fasad, atap, pintu, jendela, tangga, ruangan) diproses — sangat kritikal untuk konteks Indonesia di mana mayoritas kavling perkotaan berukuran sempit (lebar 4–8 m) dan berimpitan langsung dengan tetangga.

---

## 1. Istilah & Regulasi Dasar Tapak

| Istilah | Kepanjangan | Definisi | Nilai Umum |
|---|---|---|---|
| **GSB** | Garis Sempadan Bangunan | Batas terluar bangunan terhadap tepi jalan/rencana jalan/sungai/rel/pantai — tidak boleh dilanggar | Perumahan umumnya **3–5 m** dari tepi jalan; bervariasi per Perda kelas jalan. Bisa **0 m** pada jalan sangat sempit (mis. gang < 3 m, sesuai Pergub DKI Jakarta) |
| **GSJ** | Garis Sempadan Jalan | Lahan cadangan untuk pelebaran jalan di masa depan; area ini bisa "diambil" pemerintah suatu saat | Ditentukan per lokasi, umumnya lebih kecil dari GSB |
| **KDB** | Koefisien Dasar Bangunan | Persentase maksimal luas lahan yang boleh tertutup bangunan (dihitung dari luas lantai dasar beratap, tidak termasuk paving/carport terbuka) | Umumnya **40–60%** untuk perumahan; sisanya wajib jadi ruang terbuka/resapan air |
| **KLB** | Koefisien Lantai Bangunan | Rasio luas total lantai bangunan (semua lantai dijumlah) terhadap luas lahan — menentukan jumlah lantai maksimal | Contoh: KLB 2 pada lahan 100 m² → total luas lantai maksimal 200 m² (bisa 2 lantai @100 m², atau proporsi lain) |
| **GJBS** | Garis Jarak Bebas Samping | Jarak bebas minimum sisi samping bangunan ke batas lahan | Rumah rapat/0-lot-line: **0 m** (dinding menempel batas lahan) diperbolehkan di banyak Perda, dengan syarat teknis khusus (lihat §2) |
| **GBJB** | Garis Bebas Jarak Belakang | Jarak bebas minimum sisi belakang bangunan ke batas lahan | Pada rumah rapat tanpa jarak bebas samping: **minimal setengah dari GSB depan** |
| **Jarak bebas bangunan tinggi** (bukan rumah tinggal) | – | Untuk gedung bertingkat: minimum 4 m di lantai dasar, +0,5 m tiap tambahan lantai, maksimal 12,5 m | **Tidak berlaku untuk rumah tinggal** — dikecualikan secara eksplisit dalam regulasi |

### Cara pakai untuk generator (formula dasar):
```
Luas lantai dasar maksimal = KDB (%) × Luas lahan
Total luas lantai maksimal (semua lantai) = KLB × Luas lahan
Jumlah lantai indikatif = KLB / KDB (perlu dibulatkan & divalidasi terhadap batas tinggi)
Area tapak yang boleh dibangun (depan) = Luas lahan − (GSB × lebar lahan) − prasarana kota lain
```

---

## 2. Aturan Khusus Rumah Rapat / Kavling Sempit Tanpa Jarak Bebas Samping (0-Lot-Line)

Ini adalah kondisi paling umum di kavling perkotaan sempit Indonesia — dinding rumah menempel langsung ke batas lahan tetangga di satu atau kedua sisi.

- **Diperbolehkan secara regulasi** pada banyak Perda, tetapi dengan syarat teknis wajib:
  - **Tidak boleh ada bukaan dalam bentuk apapun** (jendela, ventilasi, pintu) pada dinding yang menempel/berbatasan langsung dengan lahan tetangga — ini bukan preferensi estetika, tapi syarat hukum di banyak daerah.
  - Fondasi/struktur bangunan terluar harus berjarak minimal **10 cm ke arah dalam** dari garis batas lahan (tidak boleh tepat di garis batas).
  - Jika sebelumnya dinding menyatu/berbagi dengan bangunan tetangga (dinding kembar/party wall) dan pemilik ingin renovasi, **wajib membuat dinding pembatas baru di sisi dalam** milik sendiri sebelum membongkar bagian yang menyatu.
- **Jarak bebas belakang** pada kondisi tanpa jarak bebas samping: minimal **setengah dari nilai GSB bagian depan**. Contoh: GSB depan 4 m → jarak bebas belakang minimal 2 m.
- **Implikasi desain langsung**: karena dinding samping tanpa bukaan, seluruh strategi pencahayaan & ventilasi alami rumah kavling sempit **harus dialihkan ke sumbu vertikal (atas) dan sumbu depan-belakang**, bukan mengandalkan jendela samping — lihat §3.

---

## 3. Strategi Pencahayaan & Ventilasi Tanpa Jendela Samping

Karena dinding samping umumnya masif tanpa bukaan (lihat §2), gunakan strategi berikut sebagai default untuk kavling sempit (lebar ≤ 8 m, diapit bangunan tetangga):

### 3.1 Void Vertikal (antar lantai)
- Ruang kosong tanpa pelat lantai yang menghubungkan lantai 1–2 (atau lebih), berfungsi ganda: jalur cahaya turun dari atas + jalur sirkulasi udara panas naik (efek cerobong/stack effect).
- **Ukuran ideal**: 4–9 m² untuk rumah sedang, atau **6–15% dari total luas lantai yang terhubung**.
- Posisi umum: di area tangga (paling efisien, menggabungkan 2 fungsi elemen dalam 1 zona), atau void memanjang di satu sisi rumah (lebar 3–6 m mengikuti kedalaman lahan).
- Void juga meningkatkan persepsi kelapangan ruang (kesan rumah lebih tinggi/megah) meski luas lantai dasar kecil — efek psikologis penting untuk kavling sempit.

### 3.2 Skylight
- Solusi utama untuk ruang tengah rumah yang tidak mendapat cahaya langsung karena diapit bangunan tetangga di kedua sisi.
- Ditempatkan di atas void, area tangga, atau ruang tengah yang paling gelap.
- **Untuk iklim tropis, wajib pakai kaca low-E atau UV filter** — skylight polos tanpa filter akan membuat ruang di bawahnya jadi terlalu panas siang hari (heat gain berlebih adalah risiko utama skylight di iklim tropis).

### 3.3 Koridor Servis Samping (bila lahan memungkinkan)
- Bila lebar lahan masih mengizinkan (misal 6 m ke atas), sisakan **±1 m di salah satu sisi lahan** sebagai koridor eksterior sempit, bukan menempelkan dinding penuh ke kedua batas lahan.
- Fungsi: jalur masuk udara/cahaya tambahan dari samping (meski tanpa jendela permanen, bisa pakai roster/lubang angin di titik tertentu bila diizinkan Perda), jalur servis (pompa air, toren, meteran), dan area resapan biopori.
- Trade-off: mengurangi luas lantai efektif dibanding menempel penuh 0-lot-line — perlu dipertimbangkan terhadap target KDB dan kebutuhan ruang.

### 3.4 Courtyard Mini / Taman Dalam
- Void terbuka tanpa atap (bukan sekadar skylight) di tengah atau belakang denah, dikelilingi ruang-ruang rumah — memberi cahaya, ventilasi, dan elemen hijau tanpa bergantung pada bukaan samping.
- Sangat efektif pada denah memanjang (rumah dengan kedalaman jauh lebih besar dari lebar) untuk memecah "efek lorong" di tengah bangunan.

### 3.5 Zonasi Cahaya pada Denah Memanjang
- Masalah klasik kavling sempit-memanjang: ruang di ujung (biasanya dapur/kamar mandi di belakang) menjadi titik paling gelap & panas karena jauh dari 2 bukaan utama (depan & belakang).
- **Solusi**: bagi denah jadi beberapa zona dengan sumber cahaya sendiri di titik tengah (via void/skylight/courtyard), bukan mengandalkan 1 sumber cahaya di ujung depan saja menembus ke seluruh kedalaman rumah.
- Hindari koridor panjang tertutup tanpa bukaan — koridor adalah ruang tidak produktif yang memakan luas lantai tanpa memberi nilai fungsi; jika terpaksa ada, sisipkan bukaan cahaya (void/skylight kecil) di sepanjang jalurnya.

### 3.6 Trik Persepsi Ruang (pelengkap, bukan pengganti strategi fisik di atas)
- Menaikkan tinggi plafon ruang utama (mis. dari 2,8 m → 3,5 m) tanpa menambah luas lantai terbukti signifikan meningkatkan kesan lega secara psikologis.
- Warna interior cerah/putih (whitewash) memantulkan cahaya lebih baik (albedo tinggi) dibanding warna gelap — relevan terutama untuk rumah di gang sempit dengan cahaya alami terbatas.
- Cermin besar di titik strategis dapat memberi ilusi kedalaman/panjang ruang tambahan.
- Kontinuitas visual lantai (material/warna lantai menerus tanpa banyak sekat) memberi persepsi luas lebih besar daripada penambahan luas fisik itu sendiri.

---

## 4. Pertimbangan Struktural & Tata Letak Khusus Lahan Sempit

- **Tangga**: pada lahan sempit, hindari tipe tangga L/U yang boros ruang bila tidak diperlukan; pertimbangkan tangga lurus ramping, floating stairs (struktur baja + pijakan kayu terlihat lebih ringan visual), atau spiral hanya sebagai pilihan terakhir (kurang ramah furnitur besar/lansia — lihat file domain-knowledge tangga).
- **Mezzanine sebagai alternatif lantai penuh**: jika anggaran/struktur tidak memungkinkan lantai 2 penuh, lantai perantara (setengah luas ruang di bawahnya, struktur baja/kayu) bisa jadi solusi hemat biaya untuk menambah ruang fungsional (ruang kerja, kamar tambahan) tanpa menambah beban KLB penuh.
- **Carport/parkir**: pada lahan sangat sempit, carport terbuka (bukan garasi tertutup beratap penuh) lebih menguntungkan karena tidak dihitung dalam KDB bila tanpa atap permanen (cek Perda setempat — beberapa daerah tetap menghitung carport beratap kanopi ringan sebagai bagian KDB).
- **Vertical garden**: solusi menghadirkan elemen hijau (yang terpotong akibat KDB tinggi/lahan sempit) tanpa memakan tapak — ditempatkan di fasad, dinding samping courtyard, atau void belakang.

---

## 5. Checklist Validasi Regulasi & Lahan Sempit (untuk sistem generatif)

- [ ] Massa bangunan tidak melampaui GSB (jarak minimum dari tepi jalan, umumnya 3–5 m, cek Perda lokasi spesifik).
- [ ] Luas lantai dasar (tertutup atap) ≤ KDB × luas lahan.
- [ ] Total luas lantai seluruh tingkat ≤ KLB × luas lahan.
- [ ] Bila dinding samping menempel batas lahan (0-lot-line): **tidak ada bukaan apa pun** (jendela/ventilasi/pintu) di dinding tersebut.
- [ ] Fondasi/dinding terluar berjarak ≥ 10 cm ke arah dalam dari garis batas lahan resmi.
- [ ] Jarak bebas belakang ≥ setengah dari nilai GSB depan, bila tidak ada jarak bebas samping.
- [ ] Bila lebar lahan ≤ 8 m dan diapit bangunan tetangga di kedua sisi: sistem WAJIB menyertakan minimal satu elemen void/skylight/courtyard sebagai sumber cahaya-ventilasi pengganti jendela samping.
- [ ] Denah memanjang (kedalaman lahan jauh lebih besar dari lebar): tidak ada satu ruang fungsional utama (kamar tidur, dapur, ruang keluarga) yang berjarak lebih dari ±6–8 m dari sumber cahaya alami terdekat (jendela depan/belakang atau void/skylight) tanpa mitigasi tambahan.
- [ ] Skylight yang di-generate untuk iklim tropis disertai catatan kebutuhan kaca low-E/UV filter.

---

## 6. Referensi

- Kepmen PU No. 441/KPTS/1998 — syarat teknis bangunan gedung (GSB, jarak bebas samping/belakang)
- UU No. 28 Tahun 2002 tentang Bangunan Gedung
- Pergub DKI Jakarta No. 135/2019 & No. 31/2022 — ketentuan GSB (contoh regulasi daerah, nilai bervariasi per lokasi)
- 99.co, Semen Merah Putih, INCA Construction, Eticon Rekayasa Teknik, Linktown — kompilasi definisi & aturan GSB/KDB/KLB (2024–2026)
- Hukumonline — Klinik Hukum, ketentuan jarak bebas bangunan gedung tinggi
- Coohom, Sobat Bangun, Kontraktor Desain Bangun, Migunani Sukses Makmur, Delution, Ranah Rumah, INCA Construction — strategi desain lahan sempit, void, skylight, denah memanjang (2025–2026)

---

*Catatan penting: nilai GSB/KDB/KLB **berbeda-beda per daerah** (diatur Perda/RDTR masing-masing kabupaten/kota) dan bisa berubah sewaktu-waktu. File ini memberi rentang umum & prinsip yang valid secara nasional, tetapi untuk proyek nyata, nilai eksak wajib dikonfirmasi ke Dinas PUPR/tata ruang setempat sebelum finalisasi desain atau pengajuan PBG.*
