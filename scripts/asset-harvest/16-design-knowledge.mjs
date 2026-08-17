/**
 * Tahap 16 — Design Reasoning mini-run (±100-150rb token): penalaran desain
 * kualitatif per topik, diisi LLM di atas DAFTAR TOPIK KURASI TANGAN di bawah.
 * Ini bagian "kecil tapi strategis" dari strategi token: agent Baruma jadi bisa
 * MENJELASKAN (kenapa/kapan-jangan/alternatif) seperti konsultan — tanpa
 * memanggil LLM saat runtime.
 *
 * Pagar yang dipegang: kualitatif murni. Prompt secara eksplisit MELARANG
 * angka harga/SNI/kuantitas — bidang itu milik mesin RAB parametrik & dokumen
 * resmi, bukan tebakan LLM.
 *
 * Output: tabel design_knowledge (id = <type>:<slug>). Resumable.
 * Jalankan: node scripts/asset-harvest/16-design-knowledge.mjs [--limit=N]
 */
import pg from "pg"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { faucetConfig, faucetChat, loadEnvLocal, loadTokens, OUT_DIR } from "./_shared.mjs"

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
  "..",
)
loadEnvLocal(repoRoot)

const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || Infinity
const TOKENS = loadTokens(repoRoot)
const CONCURRENCY = Number(process.env.HARVEST_LLM_CONCURRENCY || TOKENS.length)
const USAGE = path.join(OUT_DIR, "design-knowledge-usage.json")

/* ── DAFTAR TOPIK — dikurasi tangan (deterministik), bukan generate LLM ── */

const FURNITURE_TOPICS = [
  "Kitchen island", "Kitchen set bentuk L", "Kitchen set lurus (single line)", "Kitchen set bentuk U",
  "Pantry / mini bar", "Kabinet atas dapur", "Kabinet bawah dapur",
  "Wardrobe built-in", "Wardrobe lepas (freestanding)", "Walk-in closet", "Ranjang dengan laci penyimpanan",
  "Nakas (nightstand)", "Meja rias", "Ranjang tingkat (bunk bed)",
  "Sofa L (sectional)", "Sofa 2-3 dudukan", "Coffee table", "TV cabinet gantung (floating)",
  "TV cabinet duduk", "Rak dinding terbuka", "Buffet / sideboard", "Meja makan 4 kursi", "Meja makan 6-8 kursi",
  "Meja kerja / workspace", "Rak buku tinggi",
  "Gerbang sliding", "Gerbang swing (ayun)", "Pintu pedestrian terpisah", "Pagar roster / krawangan",
  "Pagar besi hollow", "Pagar tembok kombinasi besi", "Kanopi carport", "Pergola kayu",
  "Tangga lurus", "Tangga bentuk L", "Tangga bentuk U", "Railing kaca", "Railing besi minimalis",
  "Kolam renang plunge kecil", "Taman kering (dry garden)", "Vertical garden",
  "Kitchen sink double bowl vs single bowl", "Cooker hood (penghisap asap)", "Wastafel kamar mandi meja (countertop)",
  "Shower area dengan partisi kaca", "Bathtub freestanding", "Kloset duduk one-piece",
]

const MATERIAL_TOPICS = [
  "Plywood (multipleks)", "MDF", "Particle board", "Blockboard", "Solid wood jati", "Solid wood sungkai",
  "HPL", "Duco (cat semprot)", "Veneer kayu", "Melamine", "PVC sheet",
  "Quartz (meja dapur)", "Granit alam", "Marmer", "Homogeneous tile", "Keramik", "Terrazzo",
  "Vinyl flooring", "SPC flooring", "Parket kayu", "Polished concrete (aci ekspos)",
  "Batu andesit", "Batu palimanan", "Batu koral sikat", "Roster beton", "GRC board", "Kalsiboard",
  "Besi hollow", "Baja ringan", "Aluminium (kusen)", "UPVC (kusen)", "Kaca tempered", "Kaca laminated",
  "WPC (wood plastic composite)", "Rotan sintetis", "Kayu ulin (outdoor)", "Bata ekspos", "Bata ringan (hebel)",
]

const STYLE_TOPICS = [
  "Japandi", "Skandinavian", "Industrial", "Minimalis modern", "Modern tropis",
  "Mid-century modern", "Klasik kontemporer", "Rustic", "Bohemian", "Modern luxury",
]

const ROOM_TOPICS = [
  "Ruang tamu", "Ruang keluarga", "Kamar tidur utama", "Kamar tidur anak", "Dapur",
  "Ruang makan", "Kamar mandi", "Carport", "Teras depan", "Balkon", "Area laundry", "Musholla dalam rumah",
  // Gelombang 2 — ruang yang sering ditanya tapi belum terkaver (riset tahap 21).
  "Gudang", "Ruang kerja di rumah", "Dapur kotor", "Kamar mandi tamu", "Kamar asisten rumah tangga",
  "Ruang cuci jemur", "Foyer / ruang transisi masuk", "Void ruang keluarga", "Taman belakang",
  "Rooftop / dak atas", "Ruang serbaguna", "Ruang bermain anak", "Koridor dan sirkulasi aksesibilitas penghuni",
]

/* ── Gelombang 2: domain teknis (riset cakupan menunjukkan 0-50% ter-grounding
      padahal fiturnya ADA di app: roof zones, exterior, listrik, air) ── */

const PROBLEM_TOPICS = [
  "Rumah terasa panas di siang hari", "Dinding lembap dan berjamur", "Dak beton bocor",
  "Atap genteng bocor / rembes", "Rumah bising dari jalan raya", "Halaman banjir saat hujan deras",
  "Kamar mandi bau", "Saluran air mampet", "Dinding retak rambut", "Dinding retak struktural",
  "Rumah terasa sempit padahal luas", "Ruangan gelap / kurang cahaya alami",
  "Rumah pengap / sirkulasi udara buruk", "Cat dinding mengelupas", "Rayap pada kayu",
  "Lantai keramik popping / terangkat", "Air sumur keruh atau berbau", "Listrik sering turun (MCB jeglek)",
  "Plafon melendut atau bernoda air", "Kusen kayu memuai dan macet", "Bau got masuk ke rumah",
  "Nyamuk banyak di dalam rumah", "Debu jalanan masuk terus", "Silau matahari sore ke ruang keluarga",
]

const SYSTEM_TOPICS = [
  "Titik lampu dan penempatannya", "Jenis lampu (downlight, spot, gantung)", "Saklar dan stop kontak",
  "Instalasi listrik rumah dan MCB", "Daya listrik PLN untuk rumah tinggal", "Grounding / pembumian listrik",
  "Pompa air rumah tangga", "Toren / tandon air", "Sumur bor vs PDAM",
  "Water heater listrik vs gas vs solar", "Instalasi pipa air bersih", "Instalasi pipa air kotor",
  "Septic tank dan resapan", "Sumur resapan air hujan", "Talang air hujan",
  "Drainase halaman", "Grease trap dapur", "Ventilasi silang (cross ventilation)",
  "Exhaust fan kamar mandi", "AC split vs cassette", "Penempatan outdoor unit AC",
  "Kanopi dan overstek sebagai peneduh", "Skylight / pencahayaan atap", "Roof insulation (insulasi atap)",
  "Panel surya rumah tinggal", "Pencahayaan taman / eksterior", "Instalasi internet & jalur kabel data",
]

const STRUCTURE_TOPICS = [
  "Pondasi batu kali", "Pondasi footplat", "Pondasi bore pile", "Kolom praktis",
  "Kolom struktural", "Balok dan sloof", "Plat lantai beton", "Dinding bata vs hebel",
  "Rangka atap baja ringan", "Rangka atap kayu", "Atap pelana", "Atap limasan",
  "Atap datar / dak beton", "Atap skillion (miring sebelah)", "Genteng tanah liat",
  "Genteng beton", "Genteng metal", "Atap bitumen / aspal",
  "Waterproofing dak beton", "Waterproofing kamar mandi", "Plesteran dan acian",
  "Struktur rumah 2 lantai", "Struktur untuk rooftop / dak yang dipakai", "Dilatasi bangunan",
  "Tangga beton vs tangga besi",
]

/* ── Gelombang 3: PROSES — dari riset pasar user (docs/growth-foundry/
      baruma-market-voice-synthesis.md). Tiga pain-point teratas calon
      pengguna jatuh di sini: ketidakpastian budget, "bingung mulai dari
      mana" (urutan), dan trust gap dgn kontraktor. Pagar tetap: kualitatif,
      tanpa harga pasti, tanpa aturan daerah; PBG hanya sbg urutan langkah. ── */

const PROCESS_TOPICS = [
  // Pain #2: urutan / "bingung mulai dari mana"
  "Urutan tahapan membangun rumah dari nol",
  "Desain dulu atau hitung RAB dulu",
  "Perlu arsitek, kontraktor, atau cukup tukang",
  "Kapan PBG diurus dalam urutan membangun",
  "Membangun rumah bertahap (rumah tumbuh)",
  "Menyusun brief kebutuhan sebelum bertemu arsitek",
  // Pain #1: ketidakpastian budget (kualitatif — tanpa angka)
  "Biaya tersembunyi yang sering terlewat saat bangun rumah",
  "Apa yang dipangkas dulu bila budget kurang",
  "Skenario budget hemat vs target vs aman",
  "Dampak perubahan desain di tengah pembangunan (change order)",
  "Menerjemahkan referensi Pinterest jadi kebutuhan ruang",
  "Versi impian vs versi masuk budget",
  // Pain #3: trust gap kontraktor
  "Cara memilih kontraktor yang benar",
  "Checklist membandingkan proposal kontraktor",
  "Termin pembayaran kontraktor yang aman",
  "Tanda bahaya (red flag) proposal kontraktor",
  "Mengawasi pembangunan dari jarak jauh",
  "Serah terima rumah dan garansi pekerjaan",
]

const EXTERIOR_TOPICS = [
  "Secondary skin fasad", "Cladding kayu / WPC untuk fasad", "Cladding batu alam",
  "Louver aluminium", "Kisi-kisi kayu (sirip vertikal)", "Roster sebagai elemen fasad",
  "Cat eksterior (weathershield)", "Kanopi carport rangka besi", "Kanopi kaca",
  "Pagar depan dan keamanan", "Dinding pembatas (boundary wall)", "Carport terbuka vs tertutup",
  "Fasad rumah lebar sempit (tipe kavling kecil)", "Pencahayaan fasad malam hari",
  "Teras dan overstek sebagai peneduh", "Railing balkon", "Paving dan carport flooring",
]

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
}

const TOPICS = [
  ...FURNITURE_TOPICS.map((t) => ({ type: "furniture", topic: t })),
  ...MATERIAL_TOPICS.map((t) => ({ type: "material", topic: t })),
  ...STYLE_TOPICS.map((t) => ({ type: "style", topic: t })),
  ...ROOM_TOPICS.map((t) => ({ type: "room", topic: t })),
  ...PROBLEM_TOPICS.map((t) => ({ type: "problem", topic: t })),
  ...SYSTEM_TOPICS.map((t) => ({ type: "system", topic: t })),
  ...STRUCTURE_TOPICS.map((t) => ({ type: "structure", topic: t })),
  ...EXTERIOR_TOPICS.map((t) => ({ type: "exterior", topic: t })),
  ...PROCESS_TOPICS.map((t) => ({ type: "process", topic: t })),
].map((t) => ({ ...t, id: `${t.type}:${slug(t.topic)}` }))

/* ── Prompt per tipe ── */

const COMMON_RULES = `Balas STRICT JSON saja, bahasa Indonesia, ringkas-padat per poin.
DILARANG menyertakan: harga/angka rupiah, angka standar SNI, kuantitas material. Itu domain sistem lain.
Konteks: rumah tinggal Indonesia (iklim tropis, lembap, kebiasaan lokal).`

function promptFor(t) {
  if (t.type === "furniture") {
    return `Topik furnitur/elemen: "${t.topic}".
${COMMON_RULES}
Bentuk: {"why_used":["3-5 alasan memakai"],"when_not_to_use":["2-4 kondisi sebaiknya TIDAK dipakai"],"alternatives":["2-4 alternatif + kapan alternatif itu lebih cocok"],"placement_tips":["2-4 tips penempatan/ergonomi kualitatif"],"maintenance":["1-3 poin perawatan"]}`
  }
  if (t.type === "material") {
    return `Topik material: "${t.topic}".
${COMMON_RULES}
Bentuk: {"recommended_for":["3-5 penggunaan cocok"],"avoid_for":["2-4 penggunaan yang sebaiknya dihindari"],"pros":["2-4 kelebihan"],"cons":["2-4 kekurangan"],"substitutes":["2-4 material pengganti + alasan singkat (mis. lebih hemat / lebih tahan air)"],"tropical_note":"1 kalimat catatan iklim tropis/lembap Indonesia"}`
  }
  if (t.type === "style") {
    return `Topik gaya desain: "${t.topic}".
${COMMON_RULES}
Bentuk: {"palette":["4-6 warna khas"],"materials":["4-6 material khas"],"lighting":"karakter pencahayaan","furniture_cues":["3-5 ciri furnitur"],"do":["3-4 pedoman"],"dont":["3-4 larangan"],"pairs_well_with":["1-3 style lain yang kompatibel"],"clashes_with":["1-3 style yang bentrok"]}`
  }
  if (t.type === "problem") {
    // Keluhan nyata penghuni. Wajib memisahkan solusi yang bisa dikerjakan
    // sendiri dari yang HARUS ditangani ahli — jangan sampai agent membuat
    // pemilik rumah menganggap enteng masalah struktural/keselamatan.
    return `Topik MASALAH rumah yang dikeluhkan penghuni: "${t.topic}".
${COMMON_RULES}
Bentuk: {"gejala":["2-4 tanda yang terlihat/terasa"],"penyebab_umum":["3-5 penyebab paling sering"],"solusi_pasif":["2-4 solusi desain/pasif tanpa alat mekanis"],"solusi_aktif":["2-4 solusi perbaikan/perangkat"],"pencegahan":["2-3 langkah agar tak terulang"],"kapan_panggil_ahli":["1-3 tanda bahaya yang WAJIB ditangani profesional"],"tropical_note":"1 kalimat konteks iklim tropis Indonesia"}`
  }
  if (t.type === "system") {
    return `Topik SISTEM/UTILITAS bangunan (MEP): "${t.topic}".
${COMMON_RULES}
Bentuk: {"fungsi":"1-2 kalimat untuk apa ini","pilihan_umum":["2-4 opsi/jenis yang lazim + kapan dipilih"],"pertimbangan":["3-5 hal yang menentukan pilihan"],"kesalahan_umum":["2-4 kesalahan yang sering terjadi"],"perawatan":["1-3 poin perawatan"],"kapan_panggil_ahli":["1-3 kondisi yang perlu teknisi/ahli"],"tropical_note":"1 kalimat konteks tropis/lembap"}`
  }
  if (t.type === "structure") {
    // Struktur = keselamatan. Prompt menekankan agent TIDAK boleh memberi
    // kepastian teknis; keputusan struktur selalu diarahkan ke ahli.
    return `Topik STRUKTUR/KONSTRUKSI: "${t.topic}".
${COMMON_RULES}
PENTING: ini menyangkut keselamatan. JANGAN memberi kepastian teknis, dimensi, atau pembesian — arahkan ke perhitungan ahli struktur.
Bentuk: {"fungsi":"1-2 kalimat perannya di bangunan","kapan_dipakai":["2-4 kondisi cocok"],"kapan_tidak_cocok":["2-3 kondisi kurang cocok"],"pros":["2-4 kelebihan"],"cons":["2-4 kekurangan"],"risiko_bila_salah":["2-3 akibat bila dikerjakan asal"],"kapan_panggil_ahli":["1-3 kondisi wajib insinyur struktur"],"tropical_note":"1 kalimat konteks tropis (hujan/lembap/gempa)"}`
  }
  if (t.type === "exterior") {
    return `Topik ELEMEN FASAD/EKSTERIOR: "${t.topic}".
${COMMON_RULES}
Bentuk: {"fungsi":"1-2 kalimat fungsi estetika & teknis","cocok_untuk":["2-4 situasi/gaya yang cocok"],"hindari_bila":["2-3 kondisi sebaiknya dihindari"],"material_umum":["2-4 material yang lazim"],"pros":["2-3 kelebihan"],"cons":["2-3 kekurangan"],"perawatan":["1-3 poin perawatan di iklim tropis"],"tropical_note":"1 kalimat catatan hujan/panas/lumut"}`
  }
  if (t.type === "process") {
    // Dari riset pasar: job-to-be-done pengguna = "hindari kesalahan ratusan
    // juta sebelum komit ke vendor". Pagar ekstra: TANPA harga/persentase
    // pasti, TANPA aturan daerah (PBG hanya sbg urutan langkah + arahan cek
    // dinas setempat), dan WAJIB jujur soal batas (kapan harus profesional).
    return `Topik PROSES membangun rumah (untuk pemilik rumah awam Indonesia): "${t.topic}".
${COMMON_RULES}
TAMBAHAN: jangan menyebut persentase/angka pasti; PBG/perizinan hanya boleh sbg urutan langkah ("cek aturan dinas setempat"), bukan isi aturan.
Bentuk: {"inti":"2-3 kalimat inti jawaban","langkah":["3-6 langkah/urutan praktis"],"jebakan_umum":["3-5 kesalahan yang sering terjadi"],"pertanyaan_untuk_vendor":["2-4 pertanyaan yang sebaiknya diajukan ke arsitek/kontraktor"],"kapan_panggil_ahli":["1-3 kondisi wajib profesional"],"catatan_jujur":"1 kalimat batas ketidakpastian (mis. bervariasi per daerah/vendor)"}`
  }
  return `Topik ruangan: "${t.topic}".
${COMMON_RULES}
Bentuk: {"essential":["furnitur/elemen wajib"],"optional":["furnitur opsional umum"],"layout_principles":["3-5 prinsip tata letak kualitatif"],"common_mistakes":["3-5 kesalahan umum"],"tropical_tips":["1-3 tips iklim tropis (ventilasi/cahaya)"]}`
}

function extractJson(text) {
  if (!text) return null
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start < 0 || end < 0) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

function loadUsage() {
  if (existsSync(USAGE)) {
    try {
      return JSON.parse(readFileSync(USAGE, "utf8"))
    } catch {
      /* ignore */
    }
  }
  return { calls: 0, totalTokens: 0, topics: 0 }
}

async function main() {
  const cfg = faucetConfig()
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: CONCURRENCY + 1 })
  await pool.query(readFileSync(path.join(repoRoot, "db/migrations/0025_design_knowledge.sql"), "utf8"))
  // 0026 memperluas CHECK topic_type (problem/system/structure/exterior).
  await pool.query(readFileSync(path.join(repoRoot, "db/migrations/0026_design_knowledge_types.sql"), "utf8"))
  // 0029 menambah topic_type 'process' (revisi dari riset pasar user).
  await pool.query(readFileSync(path.join(repoRoot, "db/migrations/0029_design_knowledge_process.sql"), "utf8"))

  const have = new Set((await pool.query(`select id from design_knowledge`)).rows.map((r) => r.id))
  const todo = TOPICS.filter((t) => !have.has(t.id)).slice(0, Number.isFinite(limit) ? limit : undefined)
  console.log(`[design] ${todo.length} topik (sudah ${have.size}/${TOPICS.length}), conc=${CONCURRENCY}`)

  const usage = loadUsage()
  let processed = 0
  const queue = [...todo]
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async (_, wi) => {
      const token = TOKENS[wi % TOKENS.length]
      while (queue.length) {
        const t = queue.shift()
        if (!t) break
        try {
          const { text, usage: u } = await faucetChat(
            cfg,
            [{ role: "user", content: promptFor(t) }],
            // thinking OFF: tugas schema-bound, CoT hanya membakar budget &
            // mendorong call melewati gateway-timeout ~15s (lih. tahap 15).
            { maxTokens: 2200, temperature: 0.4, tries: 10, token, thinking: "disabled" },
          )
          usage.calls++
          usage.totalTokens += u.total_tokens ?? 0
          const parsed = extractJson(text)
          if (parsed) {
            await pool.query(
              `insert into design_knowledge (id, topic_type, topic, knowledge, updated_at)
               values ($1,$2,$3,$4,now())
               on conflict (id) do update set knowledge = excluded.knowledge, updated_at = now()`,
              [t.id, t.type, t.topic, JSON.stringify(parsed)],
            )
            usage.topics++
          } else {
            console.error(`[design] JSON gagal utk ${t.id}`)
          }
          processed++
          if (processed % 10 === 0) {
            writeFileSync(USAGE, JSON.stringify(usage, null, 2))
            console.log(`[design] ${processed}/${todo.length} | tokens=${usage.totalTokens}`)
          }
        } catch (e) {
          console.error(`[design] topik gagal ${t.id}: ${String(e.message).slice(0, 50)}`)
        }
      }
    }),
  )
  writeFileSync(USAGE, JSON.stringify(usage, null, 2))
  await pool.end()
  console.log(`[design] done topics=${usage.topics}/${TOPICS.length} tokens=${usage.totalTokens}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
