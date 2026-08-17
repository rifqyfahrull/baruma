/**
 * KAMUS FITUR BARUMA — sumber-tunggal peta fitur/tool yang dikenali asisten
 * in-app. Menjembatani celah: banyak kapabilitas editor (skylight, courtyard,
 * mezzanine, kantilever, band split-facade, aksen fasad, dsb.) TIDAK punya
 * action agent dan selama ini tak terdaftar — asisten tak tahu fitur itu ada.
 *
 * Dua fungsi:
 *  - discovery: `featureCatalogPromptBlock()` menyuntik ringkasan ke system
 *    prompt asisten (editor-assistant) → asisten sadar fitur yang ADA, dan
 *    untuk fitur `ui_only` MENGARAHKAN user ke UI alih-alih mengarang action.
 *  - intent: `matchFeatures(query)` mencocokkan frasa Bahasa Indonesia →
 *    fitur relevan (skoring keyword), untuk routing/ jawaban "bisa gak…?".
 *
 * `trigger.kind === "agent"` → `action` WAJIB salah satu action type nyata di
 * `actions.ts` (dijaga oleh feature-catalog.test.ts). `"ui"` → fitur hanya via
 * UI (asisten memandu, tak mengeksekusi).
 */

export type FeatureCategory =
  | "ruang"
  | "bukaan"
  | "fasad"
  | "atap"
  | "vertikal"
  | "eksterior"
  | "struktur"
  | "mep"
  | "interior"
  | "editor"

export type FeatureTrigger =
  | { kind: "agent"; action: string; note?: string }
  | { kind: "ui"; where: string; how?: string }

export type FeatureEntry = {
  id: string
  name: string
  category: FeatureCategory
  description: string
  /** Kata kunci Bahasa Indonesia + sinonim + istilah teknis (untuk intent-match). */
  keywords: string[]
  /** Contoh kalimat pengguna yang menandakan fitur ini. */
  examplePhrases: string[]
  triggers: FeatureTrigger[]
}

/** Apakah asisten bisa mengeksekusi fitur ini via action (bukan hanya memandu). */
export function isAgentExecutable(f: FeatureEntry): boolean {
  return f.triggers.some((t) => t.kind === "agent")
}

export const FEATURE_CATALOG: FeatureEntry[] = [
  // ── RUANG ────────────────────────────────────────────────────────────────
  {
    id: "add-room",
    name: "Tambah ruang",
    category: "ruang",
    description: "Menambah ruang baru (kamar, dapur, taman, carport, koridor, dll) ke lantai.",
    keywords: ["tambah ruang", "buat kamar", "tambah kamar", "ruang baru", "bikin ruangan", "add room"],
    examplePhrases: ["tambahkan kamar tidur di lantai 2", "buatkan dapur"],
    triggers: [{ kind: "agent", action: "addRoom" }],
  },
  {
    id: "add-room-in-gap",
    name: "Tambah ruang pas celah (klik-kanan / Ctrl+klik)",
    category: "editor",
    description: "Klik-kanan area kosong atau Ctrl+klik di denah 2D → dialog membuat ruang yang PAS mengisi celah (mis. koridor tipis antar kamar).",
    keywords: ["celah", "sela", "ruang kosong", "koridor sempit", "isi celah", "klik kanan tambah ruang", "ctrl klik"],
    examplePhrases: ["susah bikin koridor di celah sempit ini", "bagaimana isi ruang kosong antar kamar"],
    triggers: [{ kind: "ui", where: "Denah 2D", how: "Klik-kanan area kosong → 'Tambah ruang di sini', atau Ctrl/⌘+klik." }],
  },
  {
    id: "duplicate-room",
    name: "Duplikat ruang",
    category: "ruang",
    description: "Menggandakan ruang terpilih (tergeser sedikit).",
    keywords: ["duplikat", "gandakan", "copy ruang", "salin ruang", "duplicate"],
    examplePhrases: ["duplikat kamar ini"],
    triggers: [{ kind: "ui", where: "Klik-kanan ruang → Duplikat" }],
  },
  {
    id: "open-to-sky",
    name: "Ruang terbuka ke langit (courtyard)",
    category: "atap",
    description: "Menjadikan taman/void/kolam terbuka ke langit — melubangi atap/slab di atasnya (inner court / void cahaya). Area terbukanya bisa diatur.",
    keywords: ["courtyard", "inner court", "terbuka ke langit", "void", "taman dalam", "lubang atap", "sumur cahaya", "light well", "atrium"],
    examplePhrases: ["buat taman dalam terbuka ke langit", "bikin void di tengah rumah"],
    triggers: [
      { kind: "ui", where: "Kartu ruang (taman/void/kolam) → toggle 'Terbuka ke langit'; area diatur di layer Atap." },
      { kind: "ui", where: "Atap miring → aksi 'Konversi ke courtyard zones'" },
    ],
  },

  // ── BUKAAN ───────────────────────────────────────────────────────────────
  {
    id: "add-opening",
    name: "Tambah pintu / jendela",
    category: "bukaan",
    description: "Menambah pintu atau jendela pada sisi dinding sebuah ruang.",
    keywords: ["pintu", "jendela", "bukaan", "tambah pintu", "tambah jendela", "door", "window"],
    examplePhrases: ["tambah jendela di sisi selatan ruang tamu", "pasang pintu ke kamar"],
    triggers: [{ kind: "agent", action: "addOpening" }],
  },
  {
    id: "porthole",
    name: "Jendela bulat (porthole)",
    category: "bukaan",
    description: "Jendela bundar dekoratif — bukaan kind 'porthole'.",
    keywords: ["porthole", "jendela bulat", "jendela bundar", "lubang bulat", "round window"],
    examplePhrases: ["kasih jendela bulat di fasad", "tambah porthole"],
    triggers: [{ kind: "agent", action: "addOpening", note: "kind: \"porthole\"" }],
  },
  {
    id: "manage-opening",
    name: "Ubah / hapus pintu & jendela",
    category: "bukaan",
    description: "Mengubah (geser, ubah ukuran/tinggi, ganti jenis/kind, warna kusen, panel GLB) atau menghapus pintu/jendela yang sudah terpasang.",
    keywords: ["ubah pintu", "hapus pintu", "ubah jendela", "hapus jendela", "geser pintu", "perbesar jendela", "ganti jenis pintu", "warna kusen"],
    examplePhrases: ["geser pintu kamar sedikit ke kanan", "ubah jendela kamar mandi jadi lebih tinggi", "hapus pintu ke dapur"],
    triggers: [
      { kind: "agent", action: "updateOpening" },
      { kind: "agent", action: "deleteOpening" },
    ],
  },
  {
    id: "soil-bearing",
    name: "Daya dukung tanah (σ)",
    category: "struktur",
    description: "Mengatur daya dukung tanah (kPa) yang dipakai perhitungan struktur pondasi/kolom (RAB & evaluasi).",
    keywords: ["daya dukung tanah", "soil bearing", "kpa", "pondasi", "struktur tanah", "sigma tanah", "kapasitas tanah"],
    examplePhrases: ["set daya dukung tanah 180 kPa", "tanahnya lunak, atur soil bearing lebih rendah"],
    triggers: [{ kind: "agent", action: "setSoilBearing" }],
  },
  {
    id: "roster",
    name: "Roster / krawangan (breeze-block)",
    category: "fasad",
    description: "Kisi roster/krawangan sebagai layar fasad (sirkulasi udara + cahaya).",
    keywords: ["roster", "krawangan", "breeze block", "loster", "kisi", "ventilasi bata", "terakota"],
    examplePhrases: ["pasang roster terakota di lantai 2", "tambah krawangan"],
    triggers: [{ kind: "agent", action: "addFacadeElement", note: "kind: \"roster_screen\"" }],
  },
  {
    id: "skylight",
    name: "Skylight (jendela atap)",
    category: "atap",
    description: "Bukaan kaca di bidang atap datar untuk cahaya zenithal — mis. koridor tengah, kamar mandi dalam, tangga.",
    keywords: ["skylight", "jendela atap", "cahaya atap", "kaca atap", "genteng kaca", "roof window", "zenithal"],
    examplePhrases: ["tambah skylight di atas tangga", "kasih jendela atap buat kamar mandi dalam"],
    triggers: [{ kind: "ui", where: "Layer Atap 2D → '+ Skylight', atau kartu Atap. (Belum ada aksi agent.)" }],
  },

  // ── FASAD ────────────────────────────────────────────────────────────────
  {
    id: "wall-cladding",
    name: "Ganti cladding dinding",
    category: "fasad",
    description: "Mengganti material muka luar (atau dalam) satu dinding.",
    keywords: ["cladding", "material dinding", "lapisan dinding", "batu alam", "kayu", "beton ekspos", "finishing dinding"],
    examplePhrases: ["ganti dinding depan jadi batu alam", "kasih cladding kayu di fasad"],
    triggers: [{ kind: "agent", action: "setWallCladding" }],
  },
  {
    id: "split-facade-bands",
    name: "Band cladding vertikal (split-facade)",
    category: "fasad",
    description: "Memecah satu dinding jadi beberapa material bertumpuk per rentang tinggi (mis. podium batu 0–1 m + plester di atasnya).",
    keywords: ["split facade", "band", "dua tona", "podium batu", "material bertumpuk", "banded", "dwiwarna dinding"],
    examplePhrases: ["bikin fasad dua-tona batu di bawah plester di atas", "split facade per rentang tinggi"],
    triggers: [{ kind: "ui", where: "Kartu Dinding → 'Band vertikal (per rentang tinggi)'. (Belum ada aksi agent.)" }],
  },
  {
    id: "facade-preset",
    name: "Gaya Fasad 1-klik (preset)",
    category: "fasad",
    description: "Menerapkan komposisi fasad modern siap-pakai ke SELURUH muka (cladding + kisi), sadar-lantai. 9 preset: dua-tona, minimalis putih, tropis kayu, batu mewah, villa, skillion charcoal, wood-slat, japandi sirip, green wall.",
    keywords: ["preset fasad", "gaya fasad", "tema fasad", "fasad 1 klik", "komposisi fasad", "japandi", "skillion", "green wall", "villa"],
    examplePhrases: ["terapkan gaya fasad japandi", "bikin fasad modern sekali klik"],
    triggers: [
      { kind: "ui", where: "Panel 3D → kartu 'Gaya Fasad — 1 klik'" },
      { kind: "agent", action: "applyFacadeTemplate", note: "8 template komposer (mirip preset; sertakan elemen eksterior)" },
    ],
  },
  {
    id: "louver-slat",
    name: "Louver / slat fasad",
    category: "fasad",
    description: "Kisi sirip vertikal (louver) atau slat horizontal sebagai aksen fasad.",
    keywords: ["louver", "sirip", "slat", "bilah", "sirip vertikal", "slat horizontal", "sunscreen"],
    examplePhrases: ["pasang sirip kayu vertikal di depan", "tambah louver"],
    triggers: [{ kind: "agent", action: "addFacadeElement", note: "kind: louver_band | slat_horizontal" }],
  },
  {
    id: "fluted-panel",
    name: "Panel sirip (fluted) 1-klik",
    category: "fasad",
    description: "Preset 1-klik: louver_band sirip vertikal rapat (pitch 7cm) menutupi SELURUH bidang dinding terpilih — panel kayu bergaris khas fasad modern.",
    keywords: ["panel sirip", "fluted", "flute", "panel kayu", "bergaris", "sirip rapat", "kayu vertikal rapat", "wood fluted panel"],
    examplePhrases: ["pasang panel sirip kayu di seluruh dinding ini", "buat fasad fluted"],
    triggers: [{ kind: "ui", where: "Kartu Dinding → Kisi/roster fasad → tombol 'Panel sirip (fluted)'." }],
  },
  {
    id: "reveal-line-nat-beton",
    name: "Nat beton / reveal line 1-klik",
    category: "fasad",
    description:
      "Preset 1-klik: garis nat/reveal tipis TENGGELAM di muka dinding (bukan bilah menonjol keluar seperti louver biasa) — signature fasad kubis modern, menutupi SELURUH bidang dinding terpilih. Pakai `pattern.inset:true` yang membalik arah standoff bilah ke dalam ketebalan dinding (kedalaman dibatasi aman, tak tembus sisi dalam).",
    keywords: ["nat beton", "reveal line", "garis beton", "alur", "nat", "groove", "sunken line", "garis tenggelam", "kubis", "kubisme", "concrete joint"],
    examplePhrases: ["pasang nat beton di dinding ini", "buat garis reveal tenggelam di fasad", "tambah alur nat pada dinding depan"],
    triggers: [{ kind: "ui", where: "Kartu Dinding → Kisi/roster fasad → tombol 'Nat beton / reveal line'." }],
  },
  {
    id: "wall-accent",
    name: "Aksen fasad 1-klik (generator sirip/band)",
    category: "fasad",
    description: "Menghasilkan deret sirip vertikal atau band horizontal sebagai elemen eksterior ber-tag pada satu dinding (atur jarak & tinggi).",
    keywords: ["aksen fasad", "generator sirip", "deret sirip", "band horizontal", "rooster sirip", "aksen dinding"],
    examplePhrases: ["kasih aksen sirip vertikal di dinding ini"],
    triggers: [{ kind: "ui", where: "Kartu Dinding → 'Aksen fasad 1-klik', atau klik-kanan dinding. (Belum ada aksi agent.)" }],
  },
  {
    id: "facade-composer-template",
    name: "Template komposer fasad (dengan eksterior)",
    category: "fasad",
    description: "Menerapkan template fasad lengkap termasuk elemen eksterior (portal, kanopi, gate, driveway, planter). 8 template.",
    keywords: ["template fasad", "template tampak depan", "portal", "kanopi", "gerbang", "carport template"],
    examplePhrases: ["pakai template brick gable roster", "terapkan template modern concrete"],
    triggers: [{ kind: "agent", action: "applyFacadeTemplate" }],
  },

  // ── ATAP ─────────────────────────────────────────────────────────────────
  {
    id: "set-roof",
    name: "Ubah tipe / material atap",
    category: "atap",
    description: "Mengubah bentuk atap global (datar, pelana, limasan, miring/skillion), kemiringan, overhang, material, fascia.",
    keywords: ["atap", "genteng", "pelana", "limasan", "miring", "skillion", "datar", "kemiringan atap", "overhang", "fascia", "roof"],
    examplePhrases: ["ubah atap jadi pelana", "bikin atap miring skillion", "atap datar dak beton"],
    triggers: [
      { kind: "agent", action: "setRoof" },
      { kind: "ui", where: "Klik-kanan atap di 3D → pilih tipe atap" },
    ],
  },
  {
    id: "roof-zone",
    name: "Zona atap eksplisit (multi-bidang)",
    category: "atap",
    description: "Menambah zona atap per bagian (mis. pelana di massa utama + datar di carport) di layer Atap.",
    keywords: ["zona atap", "bidang atap", "atap campuran", "atap per bagian", "roof zone", "multi atap"],
    examplePhrases: ["atap pelana di rumah induk tapi datar di carport"],
    triggers: [{ kind: "agent", action: "addRoofZone" }],
  },
  {
    id: "gable-asimetris",
    name: "Gable asimetris (geser bubungan)",
    category: "atap",
    description: "Menggeser bubungan atap pelana dari tengah (ridgeOffsetM) — dua kemiringan berbeda, look modern-barn/scandi.",
    keywords: ["gable asimetris", "bubungan geser", "ridge offset", "atap miring sebelah", "pelana asimetris", "atap tidak simetris"],
    examplePhrases: ["geser bubungan atapnya biar asimetris", "bikin gable yang miring sebelah"],
    triggers: [
      { kind: "agent", action: "setRoof", note: "patch.ridgeOffsetM (pelana)" },
      { kind: "agent", action: "updateRoofZone", note: "patch.ridgeOffsetM" },
    ],
  },
  {
    id: "sopi-sopi",
    name: "Sopi-sopi (gable-end dinding/kaca)",
    category: "atap",
    description: "Mengisi segitiga ujung bubungan pelana dengan dinding atau KACA (kaca gable mengikuti kemiringan atap — signature scandi).",
    keywords: ["sopi sopi", "sopi-sopi", "gable end", "kaca gable", "kaca segitiga", "dinding segitiga atap", "gable glass", "ampig"],
    examplePhrases: ["isi ujung atap pelana dengan kaca", "tutup segitiga di bawah atap"],
    triggers: [
      { kind: "agent", action: "setRoof", note: "patch.gableEnds {sisi:\"wall\"|\"glass\"}" },
      { kind: "agent", action: "updateRoofZone", note: "patch.gableEnds" },
    ],
  },
  {
    id: "bingkai-menonjol",
    name: "Bingkai bukaan menonjol (extruded frame)",
    category: "bukaan",
    description: "Bingkai kusen dalam yang menonjol keluar dari muka dinding (0–0,8 m) mengelilingi jendela/pintu — aksen fasad modern.",
    keywords: ["bingkai menonjol", "extruded frame", "kusen tebal", "frame jendela keluar", "bingkai jendela dalam", "pop out frame"],
    examplePhrases: ["kasih bingkai menonjol di jendela depan", "bikin frame jendela keluar 60 cm"],
    triggers: [{ kind: "agent", action: "updateOpening", note: "patch.frameDepthM (0-0.8)" }],
  },
  {
    id: "bukaan-lengkung",
    name: "Bukaan lengkung — arch & kapsul",
    category: "bukaan",
    description: "Siluet melengkung untuk jendela/pintu bergaya mediterania/organik: 'arch' (setengah lingkaran di atas) atau 'capsule'/pill (setengah lingkaran di kedua ujung). Lubang dinding tetap persegi; aproksimasi lengkung low-poly (corner-fill bertingkat).",
    keywords: ["lengkung", "arch", "arsitektur mediterania", "mediterania", "kapsul", "pill", "pintu lengkung", "jendela lengkung", "setengah lingkaran", "arkade"],
    examplePhrases: ["bikin jendela ini melengkung di atas", "ganti pintu depan jadi bentuk arch mediterania", "bukaan kapsul untuk fasad organik"],
    triggers: [{ kind: "agent", action: "updateOpening", note: "patch.archShape (\"arch\"|\"capsule\")" }],
  },
  {
    id: "bukaan-trapesium",
    name: "Bukaan trapesium — tepi atas miring mengikuti atap",
    category: "bukaan",
    description: "Tepi atas jendela/kaca fasad dibuat MIRING mengikuti kemiringan atap/gable (trapesium, bukan persegi) — khas fasad tropis dgn bidang kaca besar di bawah sopi-sopi. Lubang dinding tetap persegi; sudut sisi rendah ditutup step-fill low-poly (idiom sama dgn arch/kapsul).",
    keywords: ["trapesium", "miring", "kaca miring", "ikut atap", "gable", "sopi-sopi kaca", "tepi atas miring", "jendela mengikuti atap", "kaca segitiga atap"],
    examplePhrases: ["bikin jendela ini tepi atasnya miring ikut atap", "kaca fasad depan ikuti kemiringan gable", "buat bukaan trapesium di bawah sopi-sopi"],
    triggers: [{ kind: "agent", action: "updateOpening", note: "patch.topSlopeM (m, ±3; beda tinggi tepi atas sisi along+/−)" }],
  },
  {
    id: "bingkai-gable",
    name: "Bingkai gable (outline pelana asimetris di fasad)",
    category: "eksterior",
    description:
      "Elemen eksterior gable_frame: outline pelana putih/berwarna berdiri di bidang fasad — kaki kiri/kanan boleh beda tinggi (eaveLeftM/eaveRightM), apex digeser (apexOffsetM), dasar bisa dinaikkan ke lantai balkon (zM). Signature fasad Skandinavia; isi dalamnya dikomposisikan dgn panel (facade_panel) + kaca (curtain_wall + sopi-sopi).",
    keywords: ["bingkai gable", "gable frame", "frame pelana", "outline atap", "gable putih", "bingkai segitiga fasad", "list gable"],
    examplePhrases: ["tambah bingkai gable putih di muka depan lantai 2", "bikin frame pelana asimetris seperti rumah skandinavia"],
    triggers: [
      { kind: "agent", action: "addExteriorElement", note: "kind gable_frame — widthM/heightM(apex)/eaveLeftM/eaveRightM/apexOffsetM/memberSizeM/zM" },
      { kind: "ui", where: "2D Editor → Kontrol lainnya → Tambah elemen eksterior → Bingkai gable", how: "Klik posisi di denah; field eave kiri/kanan, geser apex, elevasi dasar ada di kartu inspector." },
    ],
  },
  {
    id: "pergola",
    name: "Pergola (kisi silang 2 arah)",
    category: "eksterior",
    description:
      "Elemen eksterior pergola: kisi silang 2 arah horizontal (footprint widthM×depthM, elevasi bidang kisi heightM dari tanah) + 4 kolom penyangga sudut opsional. Pola kisi (pitch/lebar/kedalaman balok/orientasi/rhythm/bingkai) diatur lewat `pattern` — sama kontraknya dgn pola kustom kisi/roster fasad.",
    keywords: ["pergola", "kisi silang", "kanopi kisi", "trellis", "gazebo kisi", "peneduh kisi kayu", "pergola kayu", "pergola besi"],
    examplePhrases: ["tambah pergola kayu di teras belakang", "bikin kisi peneduh silang di atas carport"],
    triggers: [
      { kind: "agent", action: "addExteriorElement", note: "kind pergola — widthM/depthM/heightM/pattern?/posts?" },
      { kind: "ui", where: "2D Editor → Kontrol lainnya → Tambah elemen eksterior → Pergola", how: "Klik posisi di denah; field pola kisi & kolom ada di kartu inspector." },
    ],
  },
  {
    id: "pola-kustom-kisi",
    name: "Pola kustom kisi/roster (pitch/rhythm/bingkai)",
    category: "fasad",
    description:
      "Elemen fasad louver_band/slat_horizontal/roster_screen, pergola eksterior, DAN pagar/gerbang (fence/sliding_gate/swing_gate/pedestrian_gate — bukan boundary_wall, selalu solid) bisa diberi `pattern` (ComponentPatternSpec) yang menggantikan pitch/lebar/kedalaman bilah bawaan: orientation (v/h/grid/cross, khusus box), pitchM (0,05-1,5 m), barWidthM (0,02-0,5 m)/barDepthM (0,01-0,6 m), rhythm (pengelompokan spasi, mis [3,1] = 3 bilah rapat lalu 1 gap), frame (bingkai keliling, khusus box), inset (khusus elemen fasad — bilah TENGGELAM di muka dinding, bukan menonjol keluar; lihat 'Nat beton / reveal line'). Absen = perilaku bawaan kind.",
    keywords: ["pola kisi", "rhythm kisi", "pitch louver", "custom pattern kisi", "spasi bilah", "grid kisi", "bingkai kisi", "jeruji pagar", "jeruji gerbang"],
    examplePhrases: ["rapatkan pitch kisi jadi 15 cm", "buat pola kisi berkelompok 3 rapat 1 renggang", "kisi silang dua arah di panel roster", "rapatkan jeruji gerbang"],
    triggers: [
      { kind: "agent", action: "updateFacadeElement", note: "patch.pattern" },
      { kind: "agent", action: "addExteriorElement", note: "kind pergola, element.pattern" },
      { kind: "agent", action: "updateExteriorElement", note: "patch.pattern (elemen kind pergola/fence/*_gate)" },
    ],
  },
  {
    id: "studio-komponen",
    name: "Studio Komponen (panel pola + preset tersimpan)",
    category: "editor",
    description:
      "Panel 'Studio Komponen' (tombol 'Buka Studio Komponen' di kartu inspector elemen fasad kisi/roster dan pagar/gerbang/pergola) untuk mengatur pitch/lebar/kedalaman/orientasi/rhythm/bingkai secara visual dengan preview SVG 2D, lalu menyimpannya sebagai preset bernama (mis. 'Kisi Kubisme 18 bilah') yang bisa diterapkan lagi ke elemen lain kapan pun. Field `pattern` yang diatur di sini SAMA PERSIS dengan yang dipatch asisten lewat updateFacadeElement/updateExteriorElement — Studio murni UI + penyimpanan preset, bukan mekanisme baru.",
    keywords: ["studio komponen", "preset pola", "simpan pola", "preset kisi", "preset roster", "preset pagar", "preset pergola", "pratinjau pola"],
    examplePhrases: ["simpan pola kisi ini sebagai preset", "ada template pola kisi yang bisa dipakai ulang?", "buka studio komponen"],
    triggers: [
      { kind: "ui", where: "Kartu inspector elemen fasad/pagar/gerbang/pergola → 'Buka Studio Komponen'", how: "Atur field pola + lihat preview SVG, 'Terapkan ke elemen' untuk commit, atau simpan/pilih preset di daftar 'Preset Saya'." },
    ],
  },
  {
    id: "pagar-panjang-rotasi",
    name: "Pagar/tembok batas — panjang & rotasi presisi",
    category: "eksterior",
    description:
      "Segmen pagar/tembok/gerbang (boundary_wall/fence/sliding_gate/swing_gate/pedestrian_gate) diatur lewat start/end; kartu inspector punya field Panjang (m, menjaga arah saat ini) dan Rotasi (°, 0=horizontal — menghitung ulang end di sekeliling start dengan panjang tetap), jadi pagar keliling lahan bisa dibentuk tanpa menyeret endpoint satu-satu.",
    keywords: ["pagar keliling", "rotasi pagar", "panjang pagar", "tembok batas", "arah pagar", "sudut pagar"],
    examplePhrases: ["putar pagar ini 45 derajat", "panjangkan tembok batas jadi 8 meter", "buat pagar keliling lahan"],
    triggers: [
      { kind: "agent", action: "updateExteriorElement", note: "patch.rotationDeg (segmen) — server hitung ulang end" },
      { kind: "ui", where: "2D Editor → pilih segmen pagar/tembok/gerbang → kartu inspector", how: "Field 'Panjang (m)' dan 'Rotasi (°)' di kartu; endpoint start/end juga bisa diseret di denah." },
    ],
  },
  {
    id: "railing-tangga-eksterior",
    name: "Tangga eksterior ke balkon (railing terpotong otomatis)",
    category: "eksterior",
    description: "Tangga eksterior yang mendarat di tepi balkon otomatis memotong railing balkon di pendaratannya (lengthM ±5 m utk rise 3 m agar tread nyaman).",
    keywords: ["tangga eksterior", "tangga luar", "tangga ke balkon", "tangga samping", "pendaratan tangga", "outdoor stair"],
    examplePhrases: ["tambah tangga luar ke balkon lantai 2"],
    triggers: [{ kind: "agent", action: "addExteriorElement", note: "kind exterior_stair; railing balkon terpotong otomatis" }],
  },
  {
    id: "balkon-tepi-lengkung",
    name: "Balkon dengan tepi depan melengkung (bowed)",
    category: "eksterior",
    description:
      "Ruang balkon punya field `edgeBowM` (m, 0–1,5) — kedalaman tonjolan busur di tengah SISI paling menjorok keluar bangunan. Pelat lantai balkon di tepi itu dibentuk dari beberapa strip (kipas) yang menonjol berbeda-beda, railing mengikutinya sebagai rangkaian segmen pendek beranjak sudut (polyline aproksimasi busur, low-poly). Sisi samping & belakang balkon tetap lurus. 0/absen = lurus persis seperti sebelumnya.",
    keywords: ["balkon melengkung", "lengkung", "bowed", "busur", "balkon bulat", "tepi bulat", "railing melengkung", "balkon lengkung"],
    examplePhrases: ["buat tepi depan balkon ini melengkung", "lengkungkan balkon lantai 2 0.6 meter", "balkon bertepi bulat"],
    triggers: [
      { kind: "agent", action: "updateRoom", note: "patch.edgeBowM (0–1,5 m); hanya berlaku pada sisi terbuka paling menjorok keluar bangunan" },
      { kind: "ui", where: "2D/3D Editor → pilih balkon atau mesh railingnya → kartu Railing", how: "Field 'Lengkung tepi (m)' muncul khusus ruang tipe balkon." },
    ],
  },
  {
    id: "rooftop-deck",
    name: "Rooftop / dak beton",
    category: "atap",
    description: "Mengaktifkan lantai rooftop (dak beton bisa diakses) + area deck, railing, dan akses (tangga monyet / ship ladder).",
    keywords: ["rooftop", "dak", "dak beton", "teras atap", "roof deck", "tangga monyet", "akses atap"],
    examplePhrases: ["aktifkan rooftop", "buat dak beton yang bisa dinaiki"],
    triggers: [
      { kind: "agent", action: "setRooftop" },
      { kind: "ui", where: "Layer Atap → atur area deck, railing, akses tangga" },
    ],
  },

  // ── VERTIKAL ─────────────────────────────────────────────────────────────
  {
    id: "add-floor",
    name: "Tambah / hapus lantai",
    category: "vertikal",
    description: "Menambah atau menghapus lantai reguler.",
    keywords: ["tambah lantai", "lantai baru", "naik tingkat", "hapus lantai", "add floor", "tingkat"],
    examplePhrases: ["tambahkan lantai 2", "jadikan 3 lantai"],
    triggers: [{ kind: "agent", action: "addFloor" }],
  },
  {
    id: "floor-height",
    name: "Tinggi lantai (floor-to-floor)",
    category: "vertikal",
    description: "Mengatur tinggi lantai (2,4–4,5 m).",
    keywords: ["tinggi lantai", "tinggi plafon", "floor to floor", "plafon tinggi", "tinggi ruangan"],
    examplePhrases: ["bikin plafon lebih tinggi jadi 3,5 m"],
    triggers: [{ kind: "ui", where: "Kartu Ringkasan lantai → 'Tinggi lantai (m)'. (Belum ada aksi agent.)" }],
  },
  {
    id: "mezzanine",
    name: "Mezzanine (lantai antara)",
    category: "vertikal",
    description: "Menambah lantai mezzanine (loteng antara) di atas ruang lantai reguler — ruang 40% + tangga + railing tepi otomatis.",
    keywords: ["mezzanine", "mezanin", "loteng", "lantai antara", "void mezzanine", "loft"],
    examplePhrases: ["tambah mezzanine di atas ruang keluarga", "bikin loft"],
    triggers: [{ kind: "ui", where: "FloorSwitcher → '+ mezzanine'. (Belum ada aksi agent.)" }],
  },
  {
    id: "cantilever",
    name: "Kantilever (massa lantai menjorok)",
    category: "vertikal",
    description: "Menggeser massa lantai atas menjorok horizontal (kantilever, maks ±1,5 m per sumbu) untuk kesan massa menjorok/berundak khas fasad modern.",
    keywords: ["kantilever", "cantilever", "menjorok", "lantai maju", "overstek massa", "overhang lantai", "geser lantai", "massa berundak", "overhang"],
    examplePhrases: ["bikin lantai 2 menjorok ke depan", "geser massa lantai atas 1 meter"],
    triggers: [
      { kind: "agent", action: "updateFloor", note: "patch.offsetM {dx,dy} — clamp ±1,5 m/sumbu, rooftop ditolak" },
      { kind: "ui", where: "Kartu lantai → geser offset." },
    ],
  },
  {
    id: "split-level",
    name: "Split-level (beda ketinggian ruang)",
    category: "vertikal",
    description: "Mengatur beda ketinggian antar-ruang dalam satu lantai (levelOffsetM) untuk kesan split-level.",
    keywords: ["split level", "split-level", "beda ketinggian", "turun naik lantai", "undakan lantai", "level offset"],
    examplePhrases: ["bikin ruang keluarga turun setengah lantai"],
    triggers: [{ kind: "agent", action: "updateRoom", note: "patch.levelOffsetM" }],
  },

  // ── EKSTERIOR ────────────────────────────────────────────────────────────
  {
    id: "exterior-element",
    name: "Elemen eksterior (pagar, gerbang, kanopi, planter…)",
    category: "eksterior",
    description: "Menambah elemen eksterior: pagar, gerbang, kanopi, portal, kolom, driveway, walkway, planter, pohon, kendaraan, dll.",
    keywords: ["pagar", "gerbang", "gate", "kanopi", "carport", "driveway", "walkway", "planter", "pohon", "taman depan", "boundary"],
    examplePhrases: ["tambah pagar depan dan gerbang", "kasih kanopi carport"],
    triggers: [{ kind: "agent", action: "addExteriorElement" }],
  },
  {
    id: "chimney",
    name: "Cerobong (chimney)",
    category: "eksterior",
    description:
      "Elemen eksterior cerobong: box parametrik (widthM×depthM×heightM, default 0,6×0,6×1,6 m) dengan cap/topi penutup menonjol di puncak — sama pola pemakaian dengan kolom aksen.",
    keywords: ["cerobong", "chimney", "asap", "perapian", "fireplace", "cerobong asap"],
    examplePhrases: ["tambah cerobong di atap dapur", "bikin cerobong perapian di sisi rumah"],
    triggers: [
      { kind: "agent", action: "addExteriorElement", note: "kind chimney — x/y/widthM/depthM/heightM/rotationDeg" },
      { kind: "agent", action: "updateExteriorElement", note: "elemen kind chimney" },
      { kind: "ui", where: "2D Editor → Kontrol lainnya → Tambah elemen eksterior → Cerobong", how: "Tap posisi di denah untuk memasang." },
    ],
  },
  {
    id: "exterior-lamp",
    name: "Lampu eksterior (dinding/taman)",
    category: "eksterior",
    description: "Menambah lampu dinding eksterior, mengubah warna/intensitas/daya/tinggi pasang, atau menghapusnya (termasuk lampu penempatan otomatis).",
    keywords: ["lampu eksterior", "lampu dinding luar", "lampu taman", "lampu fasad", "wall lamp", "lampu teras", "sconce"],
    examplePhrases: ["pasang lampu dinding di teras depan", "buat lampu fasad lebih terang"],
    triggers: [
      { kind: "agent", action: "addWallLamp" },
      { kind: "agent", action: "updateLamp" },
      { kind: "agent", action: "removeLamp" },
    ],
  },
  {
    id: "exterior-template",
    name: "Template site plan / halaman",
    category: "eksterior",
    description: "Menerapkan komposisi halaman/site plan siap pakai.",
    keywords: ["site plan", "template halaman", "tata halaman", "landscape depan"],
    examplePhrases: ["tata halaman depannya"],
    triggers: [{ kind: "ui", where: "Toolbar editor → 'Tambah elemen eksterior' / template" }],
  },

  // ── MEP ──────────────────────────────────────────────────────────────────
  {
    id: "electrical",
    name: "Titik listrik (stopkontak, saklar, panel)",
    category: "mep",
    description: "Menambah/auto-generate titik listrik: stopkontak, saklar, panel, data.",
    keywords: ["listrik", "stopkontak", "saklar", "colokan", "panel listrik", "titik lampu", "elektrikal", "mep listrik"],
    examplePhrases: ["pasang stopkontak di tiap kamar", "auto generate titik listrik"],
    triggers: [
      { kind: "agent", action: "autoGenerateElectrical" },
      { kind: "agent", action: "addElectricalPoint" },
    ],
  },
  {
    id: "water",
    name: "Titik air (kran, kloset, floor drain)",
    category: "mep",
    description: "Menambah/auto-generate titik air bersih/kotor: kran, kloset, floor drain, dll.",
    keywords: ["air", "kran", "keran", "kloset", "wc", "floor drain", "pipa", "plumbing", "sanitasi air"],
    examplePhrases: ["auto generate titik air", "pasang kran di dapur"],
    triggers: [
      { kind: "agent", action: "autoGenerateWater" },
      { kind: "agent", action: "addWaterPoint" },
    ],
  },
  {
    id: "sanitation",
    name: "Septic tank & sumur resapan",
    category: "mep",
    description: "Ukuran & posisi septic tank / sumur resapan (soakwell).",
    keywords: ["septic tank", "septictank", "sumur resapan", "soakwell", "resapan", "ipal"],
    examplePhrases: ["hitung ukuran septic tank", "taruh sumur resapan"],
    triggers: [{ kind: "agent", action: "autoSizeSanitation" }],
  },

  // ── INTERIOR ─────────────────────────────────────────────────────────────
  {
    id: "furniture",
    name: "Furnitur interior",
    category: "interior",
    description: "Menambah/memindah/memutar/menghapus furnitur di ruang interior.",
    keywords: ["furnitur", "perabot", "sofa", "kasur", "meja", "kursi", "lemari", "isi ruangan"],
    examplePhrases: ["tambahkan sofa dan meja di ruang tamu", "isi kamar dengan perabot"],
    triggers: [{ kind: "agent", action: "addFurniture" }],
  },
  {
    id: "interior-light",
    name: "Lampu interior",
    category: "interior",
    description: "Menambah/atur lampu interior (downlight, dll) + temperatur warna.",
    keywords: ["lampu", "downlight", "pencahayaan", "lighting", "lampu plafon", "titik lampu interior"],
    examplePhrases: ["pasang downlight di ruang keluarga"],
    triggers: [{ kind: "agent", action: "addLight" }],
  },
  {
    id: "interior-style",
    name: "Gaya interior",
    category: "interior",
    description: "Mengubah gaya interior ruang (mis. modern tropis, japandi).",
    keywords: ["gaya interior", "tema interior", "style ruangan", "nuansa", "modern tropis", "japandi interior"],
    examplePhrases: ["ganti gaya interior jadi japandi"],
    triggers: [{ kind: "agent", action: "setStyle" }],
  },

  // ── EDITOR (UX) ──────────────────────────────────────────────────────────
  {
    id: "context-menu",
    name: "Menu klik-kanan kontekstual",
    category: "editor",
    description: "Klik-kanan komponen (2D & 3D) menampilkan aksi yang relevan untuk komponen itu; klik-kanan area kosong 2D → tambah ruang.",
    keywords: ["klik kanan", "menu konteks", "context menu", "right click", "menu cepat"],
    examplePhrases: ["gimana cara akses aksi cepat sebuah dinding"],
    triggers: [{ kind: "ui", where: "Klik-kanan komponen di editor 2D/3D" }],
  },
  {
    id: "glass-realistic",
    name: "Kaca realistis (transmisi)",
    category: "editor",
    description:
      "Opsi kualitas render 3D opsional (default OFF): kaca bukaan/curtain wall/railing kaca memakai meshPhysicalMaterial transmisif (tembus pandang & membias cahaya) alih-alih PBR datar biasa — lebih hidup tapi lebih berat di GPU, jadi sebaiknya tetap nonaktif di perangkat lemah/tablet.",
    keywords: ["kaca realistis", "transmisi", "tembus pandang", "refraksi", "kaca transparan", "glass transmission", "kaca membias"],
    examplePhrases: ["kenapa kacanya keliatan datar", "ada opsi kaca yang lebih transparan gak?"],
    triggers: [{ kind: "ui", where: "Toolbar 3D → ikon mata 'Opsi tampilan' → toggle 'Kaca realistis (lebih berat)'." }],
  },
]

const CATEGORY_LABEL: Record<FeatureCategory, string> = {
  ruang: "Ruang",
  bukaan: "Bukaan",
  fasad: "Fasad",
  atap: "Atap",
  vertikal: "Vertikal",
  eksterior: "Eksterior",
  struktur: "Struktur",
  mep: "MEP (listrik/air/sanitasi)",
  interior: "Interior",
  editor: "Editor (UX)",
}

/**
 * Blok ringkas untuk system prompt asisten. Menegaskan fitur `ui_only` yang
 * TIDAK boleh dikarang jadi action — asisten mengarahkan user ke UI-nya.
 */
export function featureCatalogPromptBlock(): string {
  const uiOnly = FEATURE_CATALOG.filter((f) => !isAgentExecutable(f))
  const lines: string[] = []
  lines.push(
    "PETA FITUR BARUMA (kenali maksud user → fitur yang tepat). Untuk fitur ber-tanda [UI] kamu BELUM bisa mengeksekusi lewat action — JANGAN mengarang action; jawab dengan menjelaskan fitur & arahkan langkah UI-nya. Fitur lain punya action agent yang bisa kamu pakai.",
  )
  for (const cat of Object.keys(CATEGORY_LABEL) as FeatureCategory[]) {
    const items = FEATURE_CATALOG.filter((f) => f.category === cat)
    if (!items.length) continue
    const rendered = items
      .map((f) => {
        const tag = isAgentExecutable(f) ? "" : " [UI]"
        const where = isAgentExecutable(f)
          ? ""
          : ` (${f.triggers.find((t) => t.kind === "ui")?.["where"] ?? ""})`
        return `${f.name}${tag}${where}`
      })
      .join("; ")
    lines.push(`• ${CATEGORY_LABEL[cat]}: ${rendered}`)
  }
  void uiOnly
  return lines.join("\n") + "\n\n"
}

const STOP = new Set([
  "yang", "di", "ke", "dari", "dan", "atau", "untuk", "ini", "itu", "saya",
  "kamu", "bisa", "gak", "gimana", "cara", "buat", "bikin", "tolong", "mau",
  "ada", "apa", "the", "a", "an",
])

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
}

/**
 * Cocokkan frasa Bahasa Indonesia → fitur relevan (skoring keyword sederhana).
 * Mengembalikan fitur ter-skor tertinggi (≥1 kecocokan), maksimal `limit`.
 */
export function matchFeatures(query: string, limit = 5): FeatureEntry[] {
  const q = query.toLowerCase()
  const qTokens = new Set(tokenize(query))
  const scored = FEATURE_CATALOG.map((f) => {
    let score = 0
    for (const kw of f.keywords) {
      const k = kw.toLowerCase()
      // Frasa keyword muncul utuh di query = sinyal kuat.
      if (k.includes(" ") && q.includes(k)) score += 3
      // Token keyword yang beririsan dengan token query.
      for (const t of tokenize(kw)) if (qTokens.has(t)) score += 1
    }
    for (const t of tokenize(f.name)) if (qTokens.has(t)) score += 1
    return { f, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.f)
}

/* ------------------------------------------------------------------ */
/* Pertanyaan fitur: "bisa gak…?" → jawaban deterministik dari katalog  */
/* ------------------------------------------------------------------ */

/** Frasa yang menandakan pertanyaan kemampuan fitur ("bisa gak…?", "apakah
 *  ada fitur…?", "gimana cara…?"). Tanda tanya di akhir kalimat ditangani
 *  terpisah oleh cek `hasQuestionMarker`. */
const FEATURE_QUESTION_RE =
  /^(bisa|bisakah|apakah bisa|bisa gak|bisa nggak|gak bisa)\b|\b(ada (fitur|tool)|fitur apa|gimana cara|bagaimana cara|caranya)\b/i

/** Verba eksekusi — kehadirannya berarti perintah edit, bukan sekadar tanya. */
const FEATURE_EDIT_VERB_RE =
  /\b(di)?(tambah|pasang|buat|bikin|ubah|ganti|hapus|geser|terapkan|set|aktifkan|matikan|turunkan|naikkan)(kan|in)?\b/i

/** True bila kalimat adalah pertanyaan kemampuan fitur, bukan perintah edit. */
export function isFeatureQuestion(instruction: string): boolean {
  const t = instruction.trim()
  if (t.length < 4) return false
  const hasQuestionMarker =
    FEATURE_QUESTION_RE.test(t) || /\?\s*$/.test(t)
  if (!hasQuestionMarker) return false
  // "bisa gak bikin void terbuka ke langit?" — pertanyaan KEMAMPUAN, verba
  // "bikin" tidak menjadikannya perintah.
  const capabilityAsk = /^(bisa|bisakah|apakah bisa|bisa gak|bisa nggak|gak bisa)\b/i.test(t)
  // "gimana cara bikin X?" — pertanyaan how-to, bukan perintah.
  const howTo = /\b(gimana cara|bagaimana cara|caranya)\b/i.test(t)
  if (capabilityAsk || howTo) return true
  // "tambahkan skylight?" diakhiri tanda tanya tapi jelas perintah → bukan tanya.
  return !FEATURE_EDIT_VERB_RE.test(t)
}

/** Apakah setidaknya satu frasa keyword multi-kata muncul UTUH di kalimat
 *  (sinyal skor-3 di matchFeatures) — mencegah pertanyaan pengetahuan murni
 *  ("bagaimana tata letak yang baik?") tertangkap sebagai pertanyaan fitur. */
function hasStrongPhraseMatch(instruction: string, matched: FeatureEntry[]): boolean {
  const q = instruction.toLowerCase()
  return matched.some((f) =>
    f.keywords.some((kw) => {
      const k = kw.toLowerCase()
      return k.includes(" ") && q.includes(k)
    }),
  )
}

/** Apakah pertanyaan diawali ajakan kemampuan ("bisa gak…?"). */
function isCapabilityAsk(instruction: string): boolean {
  return /^(bisa|bisakah|apakah bisa|bisa gak|bisa nggak|gak bisa)\b/i.test(instruction.trim())
}

/**
 * Jawab pertanyaan "bisa gak fitur X?" secara DETERMINISTIK dari katalog
 * (tanpa LLM, tanpa kredit):
 *  - pertanyaan meta ("ada fitur…?", "fitur apa saja?") → jawab dari katalog;
 *  - match frasa kuat (mis. "terbuka ke langit") ke fitur UI-ONLY → jawab +
 *    arahkan UI (LLM akan mengarang action untuk fitur yang tak bisa
 *    dieksekusi — hindari);
 *  - "bisa gak…?" ke fitur yang UI-ONLY → jawab + arahkan UI;
 *  - selain itu (termasuk "bisa tambah kamar?" ke fitur agent-executable)
 *    → null, biarkan pipeline edit/knowledge berjalan normal.
 */
export function answerFeatureQuestion(instruction: string): string | null {
  if (!isFeatureQuestion(instruction)) return null
  const matched = matchFeatures(instruction, 3)
  const metaQuestion = /\b(fitur|tool|tools|kemampuan)\b/i.test(instruction)
  if (metaQuestion && matched.length === 0) {
    // "fitur apa saja yang ada?" — rangkum semua kategori.
    const lines = ["Berikut fitur-fitur yang tersedia di Baruma (kamus fitur):"]
    for (const cat of Object.keys(CATEGORY_LABEL) as FeatureCategory[]) {
      const items = FEATURE_CATALOG.filter((f) => f.category === cat)
      if (!items.length) continue
      lines.push(`- **${CATEGORY_LABEL[cat]}**: ${items.map((f) => f.name).join(", ")}.`)
    }
    lines.push("Ketik salah satu fitur (mis. \"tambah skylight\") dan saya bantu.")
    return lines.join("\n")
  }

  if (matched.length === 0) return null
  const strongPhrase = hasStrongPhraseMatch(instruction, matched)
  const topUiOnly = !isAgentExecutable(matched[0])
  const answerable = metaQuestion || (topUiOnly && (strongPhrase || isCapabilityAsk(instruction)))
  if (!answerable) return null

  const lines: string[] = []
  lines.push("Berdasarkan kamus fitur Baruma, berikut kemampuan yang relevan dengan pertanyaan Anda:")
  for (const f of matched.slice(0, 2)) {
    const triggers = f.triggers
      .map((t) =>
        t.kind === "agent"
          ? `action agent \`${t.action}\`${t.note ? ` (${t.note})` : ""}`
          : `langsung via UI (${t.where})`,
      )
      .join(", ")
    lines.push(
      `- **${f.name}** (${CATEGORY_LABEL[f.category]}, id: \`${f.id}\`): ${f.description} Tersedia: ${triggers}.`,
    )
  }
  if (matched.length > 2) lines.push(`- …dan ${matched.length - 2} kemampuan terkait lainnya.`)
  lines.push(
    "Ketik perintah yang jelas (mis. " +
      matched[0].examplePhrases[0] +
      ") dan saya bantu kerjakan / arahkan langkahnya.",
  )
  return lines.join("\n")
}
