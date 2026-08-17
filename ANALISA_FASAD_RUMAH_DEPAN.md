# Analisa Fasad Rumah (Tampak Depan) — Berpikir sebagai Arsitek

> **Sumber:** 14 gambar referensi di `/home/fakhrul/Downloads/home-designs`
> **Tujuan:** Membedah bahasa desain fasad depan rumah, lalu memetakan **fitur apa yang dibutuhkan editor Baruma** untuk benar-benar mewujudkan desain-desain itu — bukan sekadar mendekati.
> **Tanggal:** 2026-08-09

---

## 0. Addendum implementasi (2026-08-09, setelah baca kode mendalam)

Setelah membaca kode lebih dalam, **dua "gap" di doc awal ternyata SUDAH ADA** dan klaimnya dikoreksi di sini:

- **Mode malam + lampu eksterior** → ✅ sudah ada penuh (`usePreviewStore.nightMode`, toggle di `view-toolbar.tsx`, scene malam di `house-scene.tsx`, lampu `wall/bollard/canopy`). Bukan gap.
- **Roster/breeze-block** → sebagian sudah ada: opening tipe `roster`/`krawangan` + facade element `roster_screen` (dirender di `build-model.ts`). Yang kurang hanya **warna terakota**.

**Yang DITUTUP di iterasi ini (low-risk, ada test):**
1. **Finish roster terakota** — `FacadeElementFinish` + `LOUVER_FINISH_COLORS` (`#b5623c`) + label UI di `wall-inspector.tsx`. Template `brick_gable_roster` kini memakai roster terakota (ref #10/#11).
2. **Green wall / taman vertikal** — cladding `taman_vertikal` di `facade-claddings.ts` (otomatis muncul di picker cladding per-dinding, gambar kerja elevasi, & preview 3D). Ditambah preset 1-klik **"Tropis Hijau"** + template area-depan **"Tropis Green Wall"** (ref #13).

**Yang SENGAJA DITUNDA (butuh perubahan struktural, di-scope terpisah):**
- **Cantilever massing (offset per-lantai)** — `Floor` belum punya offset horizontal; menutupnya berarti mengubah schema + geometri `build-model` (1988 baris) + editor + validasi. Terlalu berisiko untuk bolt-on; layak jadi pekerjaan tersendiri. Sementara, kesan menjorok diberikan lewat elemen **canopy** menjorok di template.
- **Jendela bulat / porthole** — opening di-render sebagai lubang **persegi** (`subtractRectHoles`/`openingSegment`); porthole butuh geometri lingkaran → perubahan medium-risk di modul geometri inti, di-scope terpisah.

Selebihnya (sirip sebagai screen di depan bukaan, planter box) sudah tersedia via `louver_band`/`slat_horizontal`/`roster_screen` + kind `planter`/`plant`/`tree`.

---

## 1. Ringkasan bahasa desain

Keempat-belas referensi ini konsisten pada satu keluarga gaya: **tropical modern minimalis Indonesia** (sebagian ber-aksen Japandi). Bila diringkas jadi "DNA" yang berulang:

- **Massa geometris tegas** — kotak/balok bersih, sebagian dengan lantai atas *cantilever* (menjorok) menaungi carport/teras di bawahnya.
- **Palet material 4 warna** yang nyaris selalu sama: **putih/krem plester + kayu hangat + abu gelap/charcoal + aksen alam** (batu alam, bata ekspos, atau roster terakota).
- **Atap variatif** tapi terbatas: datar berparapet, pelana simetris curam, dan **miring satu-bidang (skillion)** yang paling sering muncul.
- **Bukaan besar** kaca lantai-ke-plafon berbingkai hitam, sering di sudut, plus jendela bulat/porthole sebagai aksen.
- **"Kulit kedua" (secondary skin)** dari sirip kayu/metal vertikal dan roster untuk filter matahari + privasi — ini ciri paling khas iklim tropis.
- **Hijau yang menyatu ke arsitektur** — bukan taman tempel, tapi *planter* balkon menjuntai, green wall, tanaman rambat di pagar, roof garden.
- **Ruang depan multifungsi**: carport terbuka berkanopi / garasi tertutup, jalur paving + rumput jepang, pagar-gerbang sebagai bagian komposisi fasad.

Implikasi untuk produk: fasad depan **bukan cuma "dinding + jendela + atap"**. Ia adalah komposisi berlapis — massa, kulit material, secondary skin, bukaan, elemen ruang luar, lansekap, dan pencahayaan — yang semuanya harus bisa diedit.

---

## 2. Pembacaan per-referensi (mata arsitek)

| # | File | Massa & Atap | Material dominan | Elemen kunci yang harus bisa direproduksi |
|---|------|--------------|------------------|-------------------------------------------|
| 1 | `Pasted image.png` | 2 lantai, **atap datar parapet** | Kayu horizontal + putih + batu | Garasi sektional, balkon *railing kaca*, lantai atas menjorok, **wall sconce up/down light**, jalur paving+rumput |
| 2 | `(2).png` | 2 lantai, atap datar, kanopi hitam menjorok | Plester putih + **sirip vertikal hitam** | Secondary skin sirip di balkon, **gerbang besi dekoratif**, pagar masif batu, teras kaca geser |
| 3 | `(3).png` | 2 lantai, **atap miring/skillion** curam | Charcoal + krem | Kaca segitiga penuh mengikuti kemiringan atap, carport terbuka, sirip vertikal samping pintu |
| 4 | `(4).png` | 2–3 lantai, **atap miring** genteng | Putih + batu alam + kayu | **Roof garden / planter balkon menjuntai**, jendela bulat, **plat nomor "55"**, gerbang sliding, pagar+hedge |
| 5 | `(5).png` | 2 lantai, atap pelana asimetris + **dak atap metal** | Putih + kayu | Massa berputar/L, **cantilever di atas carport**, teras atap kayu, tanaman rambat menutup fasad |
| 6 | `(6).png` | 2 lantai ramping, **atap miring** overhang lebar | Plester putih + fascia kayu | Kaca sudut besar, tangga masuk + railing, lahan sempit memanjang |
| 7 | `(7).png` | 2 lantai kubus, **atap datar** | Beton + kayu vertikal + **bata ekspos** | Kaca sudut frameless hitam, soffit kayu, kolom bata tekstur, cantilever kanopi entry |
| 8 | `(8).png` | 1 lantai (tiny), **atap miring** lebar | Kayu + charcoal | Kaca geser besar, clerestory atas pintu, teras kayu panggung, downlight soffit |
| 9 | `(9).png` | 2 lantai, **atap miring/kupu** + fascia kayu | Krem + charcoal | Balkon railing horizontal metal, garasi + carport, jalur paver+rumput, wall lantern |
| 10 | `(10).png` | 2 lantai, **atap pelana** genteng curam | Krem + kayu + batu | **Kanopi baja+polikarbonat** carport, sirip vertikal kayu, roster grid, planter menjuntai |
| 11 | `(11).png` | 2 lantai, **atap pelana** curam | Beton + **roster terakota** + kayu + bata | Roster/breeze-block dua bidang, jendela bulat porthole, panel kayu ukir, boks surat, tanaman menjuntai |
| 12 | `(12).png` | 1 lantai, **atap pelana** kayu-fascia | Putih + abu + kayu | Rumah tapak sederhana, kaca+tirai, carport motor, pot tanaman, downlight teras |
| 13 | `(13).png` | 2 lantai (maket), atap miring | Abu + putih + kayu | **Green wall vertikal besar**, pagar bilah putih + tanaman rambat pot, balkon panel kayu |
| 14 | `(14).png` | 2 lantai, atap datar | Putih + kayu + **sirip metal hitam** | Cantilever lantai atas, kaca geser lebar, **plunge pool** + jalur batu, tanaman rambat pemisah |

**Pola kuat yang berulang:** cantilever (5×), secondary skin sirip vertikal (6×), atap miring/skillion (6×), atap pelana (4×), roster (2×), jendela bulat (2×), planter/green terintegrasi (7×), carport/kanopi (8×), pagar-gerbang sebagai komposisi (5×).

---

## 3. Dekomposisi arsitektural → taksonomi elemen

Sebagai arsitek, saya pecah fasad depan menjadi **8 lapis** yang masing-masing harus bisa dikontrol independen:

1. **Massa & lantai** — jumlah lantai, tinggi plafon per lantai, footprint, **offset cantilever** (lantai atas menjorok), setback teras.
2. **Atap** — bentuk (datar/pelana/limasan/miring), kemiringan, overhang, arah bubungan, **fascia/lis**, dak atap, roof garden.
3. **Kulit material dinding** — cladding per bidang (per dinding, bahkan per *band* tinggi), split-facade (bawah batu / atas kayu / plester).
4. **Secondary skin** — sirip vertikal/horizontal (kayu/metal), **roster / breeze-block**, sebagai layer di depan dinding/bukaan.
5. **Bukaan** — jendela & pintu: persegi, kaca lantai-plafon, sudut, **bulat/porthole**, clerestory, kaca mengikuti kemiringan atap (gable glazing), bingkai hitam.
6. **Elemen ruang luar depan** — carport/garasi, **kanopi entry**, balkon + railing (kaca/metal horizontal/baluster), teras panggung, tangga masuk.
7. **Lansekap & hijau** — lawn, planter box, **planter menjuntai/cascading**, **green wall vertikal**, tanaman rambat di pagar, roof garden, pohon, rumput-jepang antar-paver, **plunge pool**.
8. **Batas & detail tapak** — pagar (masif/bilah/hedge), **gerbang (sliding/swing/dekoratif)**, paving driveway, plat nomor, boks surat, **pencahayaan fasad** (wall sconce up/down, downlight soffit, spike light taman, step light).

---

## 4. Peta fitur untuk Baruma (dengan status)

Legenda status: ✅ **sudah ada** · 🟡 **parsial/perlu diperluas** · 🔴 **belum ada**

Baruma sudah punya fondasi kuat: 4 tipe atap (`datar/pelana/limasan/miring`), katalog cladding (batu alam, andesit, marmer, granit, beton ekspos, 3 kayu, bata ekspos/putih), **facade bands** (split per dinding + per band tinggi), **facade presets & accent generator** (sirip vertikal / band horizontal), carport, kolam, balkon, railing, lampu, skylight, roof zones, fascia/lis. Analisis di bawah membangun di atas itu.

### Lapis 1 — Massa & lantai
| Fitur | Status | Catatan |
|---|---|---|
| Multi-lantai + tinggi plafon per lantai | ✅ | Sudah ada di editor. |
| **Offset cantilever lantai atas** (menjorok di atas carport/teras) | 🔴 | Muncul di 5 referensi. Butuh parameter offset per-lantai relatif footprint bawah, dengan soffit ternaung otomatis. Prioritas tinggi. |
| Setback/recess teras & massa bertingkat (takik) | 🟡 | Bisa disiasati lewat ruang, tapi belum jadi kontrol massa eksplisit. |

### Lapis 2 — Atap
| Fitur | Status | Catatan |
|---|---|---|
| Bentuk atap datar/pelana/limasan/miring + kemiringan + overhang | ✅ | Menutup semua bentuk di referensi. |
| **Fascia/lis tepi atap** (band gelap/kayu) | ✅ | `RoofFascia` sudah ada — persis aksen di banyak gambar. |
| Dak atap + rooftop | ✅ | |
| Overhang lebar + **soffit lining kayu** (bawah atap dilapisi kayu) | 🟡 | Overhang ada; material soffit belum tentu bisa di-set kayu. |
| **Roof garden / planter di atap** | 🔴 | Referensi #4. Butuh objek planter di bidang atap. |
| Atap metal seam / genteng sebagai pilihan visual material | 🟡 | Perluas material atap (genteng, metal standing-seam). |

### Lapis 3 — Kulit material dinding
| Fitur | Status | Catatan |
|---|---|---|
| Cladding per dinding + **split-facade per band tinggi** | ✅ | `facade-bands` + `facade-claddings` — inti sudah kuat. |
| Katalog: batu alam, kayu, bata ekspos, beton, marmer, granit | ✅ | Menutup mayoritas material. |
| **Batu alam sebagai wainscot/base** (band bawah) | ✅ | Didukung via band sill/head. |
| **Plester dua warna** (putih + charcoal/abu) sebagai material dasar | 🟡 | Pastikan ada preset warna plester gelap, bukan hanya cladding foto. |

### Lapis 4 — Secondary skin (paling khas tropis)
| Fitur | Status | Catatan |
|---|---|---|
| **Sirip vertikal** (kayu/metal) sebagai aksen | ✅ | Accent generator "sirip vertikal" sudah ada. |
| Band horizontal | ✅ | Accent generator sudah ada. |
| **Sirip sebagai screen/kisi di depan jendela & balkon** (bukan cuma di dinding solid) | 🟡 | Referensi #2/#10/#11: sirip menutupi bukaan sebagai filter. Perlu bisa dipasang sebagai layer di depan opening. |
| **Roster / breeze-block / buka-batu (terakota, beton, kubus)** | 🔴 | Referensi #10/#11 sangat menonjol. Ini ciri tropis khas dan **belum ada** di katalog. Prioritas tinggi: tambah tipe cladding "roster" dengan pola (grid/segi) + tembus cahaya. |
| Kontrol kerapatan/arah/ketebalan sirip | 🟡 | Perluas parameter accent generator. |

### Lapis 5 — Bukaan
| Fitur | Status | Catatan |
|---|---|---|
| Jendela & pintu persegi, kaca besar, bingkai hitam | ✅ | Opening inspector sudah ada. |
| Pintu/kaca geser (sliding) lebar | 🟡 | Pastikan tipe sliding-door + panel lebar tersedia. |
| **Jendela bulat / porthole** | 🔴 | Referensi #4/#11. Opening saat ini kemungkinan rect-only. Perlu bentuk lingkaran. |
| **Gable glazing** (kaca mengikuti segitiga/kemiringan atap) | 🔴 | Referensi #3. Bukaan pada bidang miring gable. |
| **Kaca sudut (corner window frameless)** | 🟡 | Referensi #6/#7. Butuh bukaan yang membungkus sudut dua dinding. |
| Clerestory (jendela pita atas) | 🟡 | Bisa via band tinggi opening; pastikan mudah. |

### Lapis 6 — Elemen ruang luar depan
| Fitur | Status | Catatan |
|---|---|---|
| Carport / garasi (pintu sektional) | ✅ / 🟡 | Carport ada; pastikan ada **pintu garasi sektional** sebagai objek. |
| **Kanopi entry / carport** (baja + polikarbonat, kantilever) | 🟡 | Ada `kind: canopy`. Perlu diperkaya jadi objek kanopi dengan tiang + atap tembus cahaya (ref #10). |
| Balkon + railing (kaca / metal horizontal / baluster) | ✅ | Railing inspector sudah ada. |
| **Teras panggung (raised deck kayu) + tangga masuk** | 🟡 | Ref #6/#8. Perlu elemen deck + anak tangga entry. |

### Lapis 7 — Lansekap & hijau (pembeda besar)
| Fitur | Status | Catatan |
|---|---|---|
| Taman / lawn sebagai area | ✅ | `taman` ada. |
| Kolam / **plunge pool** | ✅ / 🟡 | `kolam` ada; ref #14 plunge pool kecil di samping — pastikan skala kecil didukung. |
| **Planter box + tanaman menjuntai/cascading** (balkon, roster) | 🔴 | Muncul di 7 referensi. Objek planter + aset tanaman menjuntai. Prioritas tinggi untuk "rasa" tropis. |
| **Green wall / taman vertikal** | 🔴 | Ref #13. Sebagai material/panel dinding hijau. |
| Tanaman rambat di pagar / dinding | 🔴 | Ref #5/#13. |
| **Paving driveway + rumput-jepang antar-paver** | 🔴 | Pola lantai luar (paver grid + strip rumput) — muncul di banyak ref. Perlu material/pola ground plane depan. |
| Pohon, semak, pot, rumput hias (pampas) sebagai aset | 🟡 | Perlu pustaka aset lansekap yang memadai (katalog GLB). |

### Lapis 8 — Batas tapak & detail
| Fitur | Status | Catatan |
|---|---|---|
| **Pagar depan** (masif plester / bilah / hedge) | 🔴/🟡 | Bagian komposisi fasad di 5 ref. Perlu objek pagar dengan gaya. |
| **Gerbang** (sliding / swing / besi dekoratif) | 🔴 | Ref #2/#4. Objek gerbang + animasi/gaya. |
| **Pencahayaan fasad**: wall sconce up/down, downlight soffit, spike light, step light | 🟡 | Ada sistem lampu; perlu **tipe lampu eksterior** khusus + efek cahaya malam (ref #1/#3/#9 semua "mode malam"). |
| **Mode render malam / golden hour** (glow jendela + lampu) | 🔴 | Semua render referensi pakai pencahayaan dramatis. Preset lighting scene menaikkan kualitas persepsi drastis. |
| Detail kecil: **plat nomor rumah, boks surat** | 🔴 | Ref #4/#6/#11. Aksesori aset kecil. |

---

## 5. Analisa gap & prioritas (roadmap)

Diurut dari **dampak-persepsi tertinggi per usaha** — mana yang paling bikin hasil "terlihat seperti referensi".

### P0 — Wajib untuk mencapai "rasa" referensi (dampak tertinggi)
1. **Roster / breeze-block** sebagai tipe cladding tembus cahaya (grid/segi/terakota-beton). *Ciri tropis paling absen.*
2. **Cantilever lantai atas** (offset per-lantai) + soffit ternaung. *Muncul 5×, mengubah siluet massa.*
3. **Planter menjuntai + green wall + tanaman rambat** sebagai objek/panel. *Pembeda "hidup" vs "kotak mati".*
4. **Mode pencahayaan malam + lampu eksterior** (up/down sconce, soffit downlight). *Semua referensi memakainya; murah, dampak besar.*
5. **Sirip sebagai screen di depan bukaan** (bukan hanya dinding solid). *Menyempurnakan secondary skin yang sudah ada.*

### P1 — Melengkapi kosakata fasad
6. **Jendela bulat/porthole** + **gable glazing** (kaca di bidang miring) + **kaca sudut**.
7. **Kanopi entry/carport** proper (tiang + atap polikarbonat) & **pintu garasi sektional**.
8. **Pagar + gerbang** (masif/bilah/hedge; sliding/swing/dekoratif) sebagai elemen komposisi.
9. **Paving driveway + rumput-jepang** (pola ground plane depan).

### P2 — Poles & realisme
10. Soffit/overhang berlapis kayu; material atap genteng/metal seam.
11. Teras panggung (deck) + tangga masuk; roof garden.
12. Aksesori: plat nomor, boks surat; pustaka aset lansekap yang lebih kaya (pohon tropis, pampas, monstera).
13. Preset **"gaya fasad 1-klik"** yang menggabungkan lapis-lapis di atas jadi tampilan utuh (mis. "Tropis-Japandi", "Modern-Skillion", "Minimalis-Bata-Roster") — memperluas facade presets yang sudah ada.

---

## 6. Pustaka material & warna yang perlu dipastikan ada

Palet yang berulang di 14 referensi — jadikan preset resmi:

- **Netral dasar:** putih hangat (`#F4F1EA`), krem (`#E8E1D4`), abu charcoal (`#3A3D42`), hitam matte (bingkai/sirip).
- **Kayu hangat:** rosewood/jati (sudah ada `kayu_cladding/alder/terang`).
- **Alam:** batu alam gelap & andesit (ada), **bata ekspos merah** (ada) & **bata putih** (ada), **roster terakota** (belum), **roster beton** (belum).
- **Aksen hijau** dari tanaman (bukan cat) — lewat aset lansekap.

Kombinasi split-facade yang paling sering: **base batu/bata + body plester putih + aksen panel kayu vertikal + bingkai/sirip hitam**. Ini bisa langsung jadi 1 preset.

---

## 7. Catatan teknis 3D (untuk implementasi)

- **Roster** paling baik sebagai *material dengan alpha map berpola* (murah) atau *instanced geometry* modul kecil (realistis tapi berat) — mengingat baseline bundle/berat yang dijaga, mulai dari alpha-mapped plane dulu.
- **Cantilever** = offset footprint per lantai; geometri `build-model` harus menutup soffit bawah bagian yang menjorok (mirip logika parapet/dak yang sudah ada untuk lubang tangga).
- **Planter menjuntai / green wall** = aset GLB + titik tempel di tepi balkon/dinding; manfaatkan pipeline furniture/asset yang sudah ada (slot + attach-asset).
- **Sirip di depan bukaan** = layer accent yang membaca posisi opening, bukan hanya bidang dinding.
- **Mode malam** = preset lighting scene (emissive pada kaca + lampu eksterior) di viewer 3D — tidak mengubah geometri, murah, dampak persepsi besar.
- **Jendela bulat & gable glazing** = perluasan tipe/bentuk `Opening` (lingkaran; dan opening pada bidang atap miring).

---

## 8. Kesimpulan

Baruma sudah memegang **60–70%** kosakata yang dibutuhkan untuk desain-desain ini: bentuk atap lengkap, split-facade material, sirip/aksen, carport, balkon, railing, kolam. Yang membuat hasil belum "terlihat seperti referensi" adalah **lapisan tropis dan lansekap**: roster, cantilever, hijau terintegrasi (planter menjuntai/green wall), dan **pencahayaan malam**. Empat hal itu (P0) memberi lompatan persepsi terbesar dengan usaha paling terarah.

Rekomendasi langkah berikut: mulai dari **roster + mode pencahayaan malam** (dampak tinggi, risiko rendah), lalu **cantilever** (mengubah siluet massa), lalu **paket hijau** (planter/green wall/rambat). Ketiganya bisa dibungkus jadi perluasan **facade preset 1-klik** yang sudah ada, sehingga user awam dapat hasil setara referensi tanpa menyusun 8 lapis satu per satu.
