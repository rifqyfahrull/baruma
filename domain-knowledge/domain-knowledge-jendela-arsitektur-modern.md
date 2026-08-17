# Domain Knowledge: Jendela — Ukuran, Penempatan & Aturan Desain Arsitektur Modern

> Basis pengetahuan untuk sistem generatif desain rumah. Fokus: aturan teknis (cahaya, ventilasi), standar dimensi per ruang, dan pertimbangan iklim tropis Indonesia.

---

## 1. Aturan Fundamental: Rasio Bukaan terhadap Luas Lantai

Ini adalah aturan paling penting dan sering jadi acuan hitung otomatis:

| Parameter | Standar Minimum | Standar Ideal | Sumber |
|---|---|---|---|
| **Luas jendela (cahaya alami)** | 1/10 (10%) dari luas lantai ruang | 1/6 – 1/8 (12,5–16%) dari luas lantai | SNI 03-2396-2001, Kepmen Kimpraswil 403/KPTS/M/2002, Kementerian PUPR |
| **Luas jendela (versi lebih longgar, dipakai sebagian arsitek)** | 1/20 dari luas lantai (Neufert Architect's Data) | – | Neufert |
| **Luas ventilasi tetap (permanen)** | Minimal 5% dari luas lantai | – | Pedoman Teknis Penilaian Rumah Sehat 2007 |
| **Luas ventilasi insidentil (bisa dibuka-tutup)** | Minimal 5% dari luas lantai | Maksimal 20% dari luas lantai | Kementerian PUPR |
| **Total kombinasi cahaya + ventilasi (rule of thumb lapangan)** | 10–15% dari luas lantai | 15–20% (menghadap timur) | Kotaku PU.go.id, praktik arsitek |

**Cara pakai untuk generator otomatis:**
```
luas_jendela_minimal (m²) = 0.10 × luas_lantai_ruang (m²)
luas_jendela_ideal (m²)   = 0.15 × luas_lantai_ruang (m²)
```
Contoh: kamar tidur 3×4 m (12 m²) → jendela ideal ≈ 1,2–1,8 m² total (bisa dibagi 1–2 daun jendela).

**Tingkat pencahayaan (lux) yang harus dicapai — SNI 03-6197-2000 / SNI 03-6575-2001:**

| Ruang | Lux Minimum |
|---|---|
| Teras | 60 lux |
| Ruang tamu, ruang makan, ruang kerja, kamar tidur | 120–125 lux |
| Kamar mandi, dapur | hingga 250 lux |

---

## 2. Ketinggian Ambang Bawah Jendela (Sill Height) per Fungsi

| Ruang | Tinggi Ambang Bawah dari Lantai | Alasan |
|---|---|---|
| Ruang tamu / ruang keluarga | 80–100 cm | Standar duduk-pandang, tidak menghalangi furnitur (sofa) |
| Kamar tidur | 80–100 cm; hindari sejajar tepat dengan posisi kepala di tempat tidur | Privasi + menghindari silau matahari pagi langsung ke wajah |
| Dapur | ≥ 120 cm (di atas meja kerja/kitchen counter) | Menyesuaikan tinggi meja kerja dapur standar ±85–90 cm + backsplash |
| Kamar mandi / servis | ≥ 180 cm, model jungkit (awning) atau jalusi (nako) | Privasi maksimal tapi tetap dapat ventilasi & cahaya |
| Jendela lantai-ke-plafon (floor-to-ceiling) | 0 cm (menyentuh lantai) | Tren modern untuk koneksi visual maksimal ke taman/luar, biasa dipakai di ruang tamu/ruang keluarga |

---

## 3. Tabel Ukuran Standar per Ruang (Konteks Rumah Indonesia)

| Ruang | Lebar (cm) | Tinggi (cm) | Jenis Bukaan Umum | Catatan |
|---|---|---|---|---|
| Ruang tamu / ruang keluarga | 60–80 per daun (bisa diulang 2–4×), atau lebar dinding penuh untuk gaya modern | 150–210 | Casement (swing), fixed + jalusi bawah, atau floor-to-ceiling sliding | Bukaan besar tapi tetap pertimbangkan gorden/shading untuk cegah silau & panas berlebih |
| Kamar tidur | 50–70 per daun, bisa diulang 1–2× | 100–120 | Casement swing keluar, atau jendela nako | Jangan tepat menghadap area kepala kasur |
| Dapur | 60–100 | 60–80, dipasang tinggi (>120 cm dari lantai) | Jendela jungkit/awning kecil di atas countertop, atau jendela nako | Prioritas ventilasi asap masakan, bukan pemandangan |
| Kamar mandi/toilet | 40–50 | 40–50 | Nako/jalusi, dipasang tinggi (≥180 cm dari lantai) | Privasi mutlak; hindari kaca bening tanpa frosting |
| Ruang makan | 80–120 | 150–180 | Casement atau sliding besar ke arah taman/teras belakang | Sering digabung dengan pintu geser kaca sebagai satu bidang bukaan besar |
| Void tangga / koridor | Kaca minimal 0,1 m² (koridor rumah tinggal), 0,75 m² (area tangga) | – | Fixed glass, skylight | SNI 03-2396-2001 — wajib menerima cahaya siang hari |

---

## 4. Orientasi Matahari & Iklim Tropis

- **Jendela menghadap Timur**: mendapat cahaya pagi paling optimal dan lembut — arah paling disarankan untuk kamar tidur dan ruang makan (Ditjen Cipta Karya Kementerian PUPR merekomendasikan luas bukaan 10–20% dari luas lantai bila jendela menghadap timur).
- **Jendela menghadap Barat**: menerima panas sore paling menyengat — perlu **overhang/tritisan lebar**, secondary skin, atau kaca low-E/reflektif; hindari bukaan besar tanpa peneduh di sisi ini (kesalahan desain paling umum menurut arsitek).
- **Ventilasi silang (cross ventilation)**: setiap ruang idealnya punya minimal 2 bukaan berlawanan/menyudut agar udara bisa mengalir, bukan hanya 1 jendela di satu sisi dinding.
- **Rumah di area urban padat (row house/rapat antarbangunan)**: bila jendela samping tidak memungkinkan karena berhimpitan, gunakan **skylight** atau jendela di sisi depan/belakang sebagai kompensasi cahaya.

---

## 5. Aturan Penempatan & Proporsi (Estetika Fasad)

- Jendela besar dan proporsional adalah tren utama fasad modern 2025–2026 — memaksimalkan cahaya alami sekaligus koneksi visual ke luar, dengan kusen berprofil ramping/minimalis.
- Hindari ukuran jendela yang tidak proporsional terhadap skala dinding (terlalu kecil terlihat "berlubang", terlalu besar tanpa peneduh menimbulkan overheating) — ini kesalahan desain paling sering ditemukan arsitek pada proyek fasad.
- Untuk gaya **soft modernism** (tren 2026), jendela dengan sudut melengkung pada bagian atas dipakai sebagai elemen karakter fasad, dikombinasikan dengan garis vertikal untuk kesan bangunan lebih tinggi/lega — cocok untuk lahan sempit.
- Batasi jenis/model jendela dalam satu fasad ke 1–2 tipe utama agar tidak terlihat "ramai" — konsisten dengan prinsip fasad minimalis modern (maks 2–3 jenis material/elemen visual per fasad).

---

## 6. Checklist Validasi Jendela (untuk sistem generatif)

- [ ] Luas jendela per ruang ≥ 10% luas lantai ruang tersebut (idealnya 12,5–15%).
- [ ] Luas ventilasi (tetap + insidentil) ≥ 5% luas lantai, ideal hingga 20% untuk ruang basah/dapur.
- [ ] Kamar mandi/toilet: jendela dipasang tinggi (≥ 180 cm) dan menggunakan kaca buram/nako — tidak ada kaca bening menghadap area yang bisa dilihat dari luar.
- [ ] Kamar tidur: jendela tidak diposisikan tepat di atas/menghadap langsung ke area kepala tempat tidur.
- [ ] Sisi bangunan menghadap barat tanpa peneduh (overhang/kanopi) tidak diberi bukaan kaca besar tanpa mitigasi panas.
- [ ] Setiap ruang huni utama (kamar tidur, ruang tamu, ruang keluarga, dapur) punya minimal 1 jalur cross-ventilation.
- [ ] Proporsi jendela terhadap bidang dinding fasad seimbang secara visual (tidak terlalu kecil/besar dibanding skala keseluruhan bangunan).

---

## 7. Referensi

- SNI 03-2396-2001 (Tata Cara Perancangan Sistem Pencahayaan Alami pada Bangunan Gedung)
- SNI 03-6197-2000, SNI 03-6575-2001 (standar tingkat pencahayaan/lux)
- Kepmen Kimpraswil No. 403/KPTS/M/2002 (Pedoman Teknis Pembangunan Rumah Sederhana Sehat)
- Neufert, *Architect's Data*, 3rd Edition
- Kotaku PU.go.id — Ditjen Cipta Karya Kementerian PUPR
- Kompas Properti, Dekoruma, Arsitur Studio, Arsigriya Arsitek, Aluve — kompilasi standar & tren 2024–2026
- Brighton.co.id, Fimela, Liputan6, PropNex Plus — tren fasad & jendela 2025–2026
