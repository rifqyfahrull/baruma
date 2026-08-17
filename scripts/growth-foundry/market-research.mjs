import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { faucetChat, loadEnvLocal, loadTokens } from "../asset-harvest/_shared.mjs"

const repoRoot = process.cwd()
loadEnvLocal(repoRoot)

const OUT_DIR = path.join(repoRoot, "docs", "growth-foundry")
mkdirSync(OUT_DIR, { recursive: true })

const cfg = {
  baseUrl: process.env.FAUCET_BASE_URL || "https://freetokenfaucet.com/v1",
  model: process.env.FAUCET_MODEL || "deepseek-v4-flash",
  apiKey: process.env.FAUCET_API_KEY || "round-robin-token",
}

const tokens = loadTokens(repoRoot)
let tokenIndex = 0
const usage = { calls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0 }

const sources = [
  {
    label: "Reddit r/indonesia - Tips dan rekomendasi arsitek dan biaya desain rumah",
    url: "https://www.reddit.com/r/indonesia/comments/yp8ek4/tips_dan_rekomendasi_arsitek_dan_biaya_design/",
    notes: [
      "Diskusi menyinggung biaya arsitek, nilai pendampingan dari desain sampai konstruksi, dan pentingnya AHSP/RAB.",
      "Sinyal proxy: orang awam sulit menilai apakah fee desain wajar dan apa saja yang seharusnya termasuk.",
    ],
  },
  {
    label: "Arsitag - Marketplace jasa desain & bangun Indonesia",
    url: "https://www.arsitag.com/",
    notes: [
      "Positioning sebagai marketplace jasa desain, interior, dan kontraktor.",
      "Menampilkan proyek berjalan, bid penyedia jasa, testimonial, dan trust signal platform.",
    ],
  },
  {
    label: "Arsitag - daftar jasa arsitek Indonesia",
    url: "https://www.arsitag.com/list-professional/jasa-arsitek/semua-lokasi",
    notes: [
      "Mengklaim jaringan profesional dan portofolio terverifikasi.",
      "Opportunity Baruma: bantu user sebelum memilih profesional, bukan hanya direktori profesional.",
    ],
  },
  {
    label: "Sejasa - Interior Designer",
    url: "https://www.sejasa.com/layanan/interior-designer",
    notes: [
      "Memberi kisaran biaya jasa desain interior Rp200.000-Rp400.000/m2 tergantung kompleksitas.",
      "Sinyal: pasar mencari estimasi biaya dan pembanding sebelum menghubungi vendor.",
    ],
  },
  {
    label: "Emporio Architect - persiapan kebutuhan ruang",
    url: "https://www.emporioarchitect.com/blog/siap-merencanakan-desain-rumah-begini-cara-mempersiapkan-data-kebutuhan-ruang-untuk-desain-rumah",
    notes: [
      "Menekankan input kebutuhan seperti kendaraan, kamar tidur, WIC, kamar mandi, dan kebutuhan penghuni.",
      "Opportunity Baruma: design brief interaktif untuk mengubah kebutuhan keluarga menjadi program ruang.",
    ],
  },
  {
    label: "Jurnal Permukiman - kebutuhan luas minimal rumah sederhana",
    url: "https://jurnalpermukiman.pu.go.id/index.php/JP/article/viewFile/62/pdf_1",
    notes: [
      "Merujuk SNI 03-1733-2004: asumsi keluarga 4 orang, luas minimal rumah sederhana 36m2 atau 9m2/jiwa.",
      "Opportunity Baruma: jadikan standar minimum sebagai guardrail, bukan klaim final desain.",
    ],
  },
  {
    label: "Delution - kesalahan saat membangun rumah",
    url: "https://delution.co.id/blog/kesalahan-saat-membangun-rumah/",
    notes: [
      "Menekankan contingency 10-20% agar budget tidak berantakan saat hal tak terduga muncul.",
      "Sinyal: overbudget adalah anxiety inti dan bisa dicegah lewat perencanaan awal.",
    ],
  },
  {
    label: "detik Properti - kesalahan yang bikin biaya bangun rumah membengkak",
    url: "https://www.detik.com/properti/arsitektur/d-8257869/awas-boros-ini-kesalahan-yang-bikin-biaya-bangun-rumah-membengkak",
    notes: [
      "Menyorot tidak pakai jasa ahli dan sulit membedakan kebutuhan vs keinginan.",
      "Opportunity Baruma: scope/prioritization assistant sebelum uang konstruksi keluar.",
    ],
  },
  {
    label: "Planner 5D official pricing",
    url: "https://planner5d.com/pricing",
    notes: [
      "Premium mulai $4.99/bulan dengan AI Design Generator dan upload floor plan.",
      "Pola kompetitor: freemium, visual-first, AI sebagai pembuat desain otomatis.",
    ],
  },
  {
    label: "Floorplanner official pricing",
    url: "https://floorplanner.com/pricing",
    notes: [
      "Free casual use, credit system untuk export/upgrades, proyek gratis terbatas.",
      "Pola kompetitor: monetisasi export/render/3D tour; kuat untuk layout visual, lemah untuk konteks biaya lokal.",
    ],
  },
  {
    label: "RoomSketcher official",
    url: "https://www.roomsketcher.com/",
    notes: [
      "Menyediakan 2D/3D floor plans, Live 3D walkthrough, measurement, customization, branding.",
      "Pola kompetitor: professional-looking floor plan dan walkthrough; bukan pendamping bangun rumah lokal end-to-end.",
    ],
  },
  {
    label: "SketchUp official subscriptions",
    url: "https://help.sketchup.com/en/sketchup-subscriptions",
    notes: [
      "Tool 3D kuat untuk workflow profesional/hobbyist serius.",
      "Opportunity Baruma: user awam tidak ingin belajar modeling, mereka ingin keputusan rumah yang lebih aman.",
    ],
  },
  {
    label: "ReimagineHome official",
    url: "https://www.reimaginehome.ai/",
    notes: [
      "AI interior/virtual staging dengan budget range dan real products.",
      "Pola kompetitor: visual inspiration dan product sourcing; lebih interior/furnishing daripada pre-construction planning.",
    ],
  },
]

const baseContext = `
Baruma adalah SaaS web untuk membantu individu perorangan merencanakan rumah pribadi:
brief -> alternatif layout -> editor denah 2D -> preview 3D -> RAB/BOQ -> contractor pack.
Stage: pre-customer, belum punya customer nyata. Target utama: pemilik tanah atau calon pemilik rumah di Indonesia yang ingin membangun rumah pribadi, bukan developer besar.

Jangan mengklaim ada customer Baruma. Labeli insight sebagai:
- data-backed: bila langsung didukung sumber di bawah,
- proxy insight: bila bersumber dari pola publik/kompetitor/forum,
- hypothesis: bila inferensi strategis yang perlu divalidasi.

Sumber ringkas:
${JSON.stringify(sources, null, 2)}
`

const tasks = [
  {
    file: "01-pain-point-taxonomy.md",
    title: "Pain-Point Taxonomy",
    prompt: `Buat taxonomy pain-point sedalam mungkin untuk individu yang ingin membangun rumah pribadi di Indonesia.
Struktur wajib:
1. Executive summary
2. Pain-point map per lifecycle: niat, tanah/legal, budget, kebutuhan ruang, desain, vendor, konstruksi, handover, tinggal
3. Untuk tiap pain-point: severity, frequency hypothesis, trigger, current workaround, emotional language, Baruma feature opportunity, validation question
4. Bedakan pain fungsional, emosional, sosial, finansial, legal, dan trust
5. Top 15 pain-point yang paling layak jadi wedge awal Baruma
Gunakan bahasa Indonesia, tajam, jangan generik.`,
  },
  {
    file: "02-segment-matrix.md",
    title: "Segment Matrix",
    prompt: `Buat segmentasi detail untuk target individu perorangan yang ingin bangun rumah pribadi.
Struktur wajib:
1. 12-18 segment dengan konteks spesifik
2. Jobs-to-be-done
3. anxieties
4. buying trigger
5. willingness-to-pay hypothesis
6. channel untuk menemukan mereka
7. lead magnet paling cocok
8. offer Baruma paling cocok
9. why now
10. segment yang harus dihindari dulu
Prioritaskan wedge yang bisa divalidasi dalam 30 hari.`,
  },
  {
    file: "03-competitor-map.md",
    title: "Competitor Map",
    prompt: `Buat peta kompetitor Baruma lokal dan global.
Kategori wajib:
- jasa arsitek online Indonesia
- marketplace jasa desain/bangun/renovasi
- interior/furniture integrated service
- floor planner / home design software
- AI interior / AI home visualization
- 3D modeling professional tools
- Pinterest/Instagram/YouTube status quo
- tukang/mandor/kontraktor informal
Untuk tiap kategori: contoh representatif, main offer, strength, weakness for individual homeowner, pricing/monetization pattern, trust signal, Baruma opportunity, directness as competitor.
Jangan buat fakta harga yang tidak ada di sumber; jika inferensi, beri label hypothesis.`,
  },
  {
    file: "04-positioning-wedges.md",
    title: "Positioning Wedges",
    prompt: `Buat 10 kandidat positioning/wedge awal untuk Baruma.
Untuk tiap wedge:
- name
- target segment
- acute pain
- promise
- mechanism
- why status quo fails
- competitor it displaces
- first product surface
- landing headline in Indonesian
- proof needed
- overpromise risk
- 30-day validation test
Setelah itu ranking top 3. Hindari positioning yang terlalu luas seperti "AI desain rumah".`,
  },
  {
    file: "05-discovery-interview-kit.md",
    title: "Discovery Interview Kit",
    prompt: `Buat customer discovery kit untuk 30 interview pertama Baruma.
Struktur:
1. Screening criteria
2. Recruiting script WhatsApp/DM
3. 45-minute interview flow
4. Questions by theme: trigger, status quo, budget, desain, vendor, legal, trust, payment willingness
5. Anti-leading questions
6. Red flags bahwa interview bukan target
7. Coding rubric untuk menilai jawaban
8. Decision rule setelah 30 interview
Target interview: individu yang sedang/akan bangun rumah pribadi, belum customer Baruma.`,
  },
  {
    file: "06-seo-and-lead-magnet-map.md",
    title: "SEO and Lead Magnet Map",
    prompt: `Buat SEO dan lead magnet map untuk menemukan orang yang ingin bangun rumah pribadi.
Struktur:
1. Keyword clusters by intent: ukuran lahan, budget, jumlah kamar, rumah tumbuh, legal/PBG, RAB, kontraktor, material, desain
2. Untuk tiap cluster: search intent, user anxiety, content/tool opportunity, CTA, data to collect
3. 25 lead magnet ideas ranked by research value and conversion potential
4. 10 fake-door landing page experiments
5. What not to publish: konten AI tipis, klaim berbahaya, klaim legal/struktur yang overpromise.`,
  },
  {
    file: "07-offer-and-pricing-hypotheses.md",
    title: "Offer and Pricing Hypotheses",
    prompt: `Buat offer architecture untuk Baruma pre-customer.
Struktur:
1. Free tools untuk akuisisi dan riset
2. Low-ticket offers
3. Mid-ticket assisted planning offers
4. Professional/vendor handoff offers
5. Untuk tiap offer: audience, activation event, deliverables, excluded responsibilities, pricing hypothesis IDR, trust proof needed, refund/risk reversal, operational risk
6. Pilih 3 offer pertama yang paling realistis diuji.`,
  },
  {
    file: "08-sales-objection-library.md",
    title: "Sales Objection Library",
    prompt: `Buat library objection untuk calon pengguna Baruma yang ingin bangun rumah pribadi.
Struktur:
1. 40 objections grouped by category: price, trust, AI skepticism, arsitek/kontraktor, legal, privacy, family, timing
2. Untuk tiap objection: what they really mean, bad answer to avoid, better answer, product proof needed
3. WhatsApp response examples in Indonesian, concise and non-pushy
4. Landing page FAQ implications.`,
  },
]

async function runTask(task) {
  const token = tokens[tokenIndex++ % tokens.length]
  const messages = [
    {
      role: "system",
      content: "You are a rigorous Indonesian startup market researcher. Produce practical, evidence-labeled strategy docs. No hype, no fake customer quotes.",
    },
    {
      role: "user",
      content: `${baseContext}\n\nTask: ${task.prompt}`,
    },
  ]
  const { text, usage: u } = await faucetChat(cfg, messages, {
    token,
    maxTokens: Number(process.env.GROWTH_MAX_TOKENS || 2800),
    temperature: 0.35,
    tries: Number(process.env.GROWTH_TRIES || 8),
    thinking: cfg.model.includes("deepseek") ? "disabled" : undefined,
  })
  usage.calls += 1
  usage.totalTokens += u.total_tokens ?? 0
  usage.promptTokens += u.prompt_tokens ?? 0
  usage.completionTokens += u.completion_tokens ?? 0
  const out = `# ${task.title}\n\nGenerated: ${new Date().toISOString()}\nModel: ${cfg.model}\nEvidence mode: Baruma has no customers yet; findings are data-backed, proxy insight, or hypothesis.\n\n${text.trim()}\n`
  writeFileSync(path.join(OUT_DIR, task.file), out)
  console.log(`[growth] wrote ${task.file} tokens=${u.total_tokens ?? 0}`)
}

async function main() {
  console.log(`[growth] model=${cfg.model} token_count=${tokens.length}`)
  const selected = process.env.GROWTH_TASK
    ? tasks.filter((task) => task.file.startsWith(process.env.GROWTH_TASK) || task.title.toLowerCase().includes(process.env.GROWTH_TASK.toLowerCase()))
    : tasks
  const suffix = process.env.GROWTH_OUTPUT_SUFFIX || ""
  for (const task of selected) {
    const outputTask = suffix
      ? { ...task, file: task.file.replace(/\.md$/, `${suffix}.md`) }
      : task
    await runTask(outputTask)
  }
  writeFileSync(path.join(OUT_DIR, "usage.json"), JSON.stringify({ ...usage, model: cfg.model, generatedAt: new Date().toISOString() }, null, 2))
  console.log(`[growth] done calls=${usage.calls} totalTokens=${usage.totalTokens}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
