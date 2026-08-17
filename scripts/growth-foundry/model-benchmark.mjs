import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { faucetChat, loadEnvLocal, loadTokens } from "../asset-harvest/_shared.mjs"

const repoRoot = process.cwd()
loadEnvLocal(repoRoot)

const OUT_DIR = path.join(repoRoot, "docs", "growth-foundry", "model-benchmark")
mkdirSync(OUT_DIR, { recursive: true })

const models = (process.env.GROWTH_MODELS || "gpt-5.6-luna,gpt-5.6-terra,deepseek-v4-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean)

const tokens = loadTokens(repoRoot)
let tokenIndex = 0

const compactContext = `
Baruma: SaaS pre-customer untuk individu Indonesia yang ingin membangun rumah pribadi.
Produk: brief -> alternatif layout -> denah 2D -> preview 3D -> RAB/BOQ -> contractor pack.
Target utama: pemilik tanah/calon pemilik rumah pertama, bukan developer.
Konteks riset publik: pain kuat adalah takut overbudget, bingung mulai dari mana,
sulit menerjemahkan inspirasi ke kebutuhan ruang, trust gap ke tukang/kontraktor,
legal/PBG, kualitas struktur yang tidak terlihat, dan sulit membandingkan proposal.
Kompetitor/proxy: Arsitag/Sejasa/Dekoruma/Gravel/Kanggo, Planner 5D/Floorplanner/
RoomSketcher/SketchUp/ReimagineHome, Pinterest/IG/YouTube, tukang/mandor informal.
Label semua insight: data-backed, proxy insight, atau hypothesis. Jangan mengarang
seolah Baruma sudah punya customer.
`

const tasks = [
  ["persona_pasangan_muda_tanah_keluarga", "Buat persona mendalam pasangan muda punya tanah keluarga dan ingin bangun rumah pertama. Sertakan pains, anxieties, status quo, trigger, Baruma wedge, discovery questions."],
  ["persona_karyawan_waktu_terbatas", "Buat persona karyawan middle-income yang sibuk kerja dan tidak bisa mengawasi proyek harian. Fokus trust, kontrol biaya, vendor, dan remote monitoring."],
  ["persona_self_build_hemat", "Buat persona orang yang ingin bangun tanpa kontraktor demi hemat. Fokus risiko koordinasi tukang, material, kualitas, dan cashflow."],
  ["persona_dream_home_planner", "Buat persona yang punya banyak referensi Pinterest/Instagram tapi tidak tahu desain mana realistis untuk budget dan lahan."],
  ["persona_perantau_remote_build", "Buat persona perantau yang membangun rumah di kampung/kota lain. Fokus trust, laporan progres, keluarga lokal, dan quality assurance."],
  ["persona_renovasi_besar", "Buat persona pemilik rumah lama yang ingin renovasi besar atau naik lantai. Fokus struktur eksisting, tinggal sementara, dan risiko biaya."],
  ["pain_budget_bengkak", "Analisis pain-point takut budget membengkak. Buat root causes, emotional language, current workaround, product opportunity, validation test."],
  ["pain_bingung_mulai", "Analisis pain-point bingung mulai dari mana saat mau bangun rumah. Buat lifecycle confusion, first action, product wedge, lead magnet."],
  ["pain_trust_kontraktor", "Analisis trust gap ke tukang/kontraktor. Buat red flags user takuti, proof needed, Baruma trust product, landing copy."],
  ["pain_kebutuhan_ruang", "Analisis kesulitan menentukan kebutuhan ruang keluarga. Buat decision tree, trade-offs, common mistakes, Baruma design brief opportunity."],
  ["pain_pbg_legal", "Analisis legal/PBG sebagai pain untuk rumah pribadi. Jaga agar tidak overclaim. Buat edukasi, checklist, boundaries, referral opportunity."],
  ["pain_proposal_compare", "Analisis kebutuhan membandingkan 2-3 proposal arsitek/kontraktor secara apple-to-apple. Buat scoring rubric dan product surface."],
  ["competitor_floorplanner", "Analisis kategori floor planner/home design software sebagai kompetitor Baruma. Strength, weakness, pricing pattern, why Baruma can differ."],
  ["competitor_ai_interior", "Analisis kategori AI interior/home visualization. Strength, weakness, commodity risk, opportunity Baruma beyond visual wow."],
  ["competitor_marketplace_jasa", "Analisis marketplace jasa desain/bangun/renovasi lokal/global. Strength, weakness, trust gap, opportunity Baruma before marketplace."],
  ["competitor_status_quo", "Analisis status quo: tanya keluarga, YouTube, Pinterest, tukang kenalan, harga per meter. Kenapa ini kompetitor paling kuat?"],
  ["wedge_pre_architect", "Rancang positioning wedge: pre-architect planning assistant. Promise, mechanism, first product, proof, 30-day validation."],
  ["wedge_budget_first", "Rancang positioning wedge: budget-first home planning. Promise, mechanism, first product, proof, overpromise risk."],
  ["wedge_vendor_ready_pack", "Rancang positioning wedge: vendor-ready pack untuk dibawa ke arsitek/kontraktor. Deliverables, pricing hypothesis, validation."],
  ["wedge_proposal_audit", "Rancang positioning wedge: audit proposal/RAB kontraktor sebelum user bayar DP. Deliverables, risk, validation."],
  ["lead_magnet_budget_calculator", "Buat konsep lead magnet kalkulator budget awal bangun rumah. Input, output, data riset yang dikumpulkan, CTA."],
  ["lead_magnet_design_brief", "Buat konsep lead magnet template design brief rumah pribadi. Input, output, segmentation data, CTA."],
  ["lead_magnet_proposal_checklist", "Buat konsep checklist membandingkan proposal kontraktor/arsitek. Input, output, CTA, risk boundaries."],
  ["fake_door_tests", "Buat 10 fake-door test untuk Baruma selama 30 hari. Sertakan headline, target segment, success metric, expected learning."],
  ["interview_questions", "Buat 25 pertanyaan interview non-leading untuk orang yang mau bangun rumah pribadi dalam 12 bulan."],
  ["objection_library", "Buat 25 objection calon user terhadap Baruma dan jawaban WhatsApp yang non-pushy."],
  ["offer_architecture", "Buat 7 offer hypothesis dari free sampai paid assisted planning. Sertakan price IDR hypothesis dan risiko operasional."],
  ["landing_page_messages", "Buat 12 headline landing page untuk target individu ingin bangun rumah pribadi. Hindari klaim menggantikan arsitek."],
]

function promptFor(taskName, taskPrompt) {
  const wordLimit = process.env.GROWTH_WORD_LIMIT || "260"
  return `${compactContext}

Task name: ${taskName}
Task: ${taskPrompt}

Output bahasa Indonesia. Maksimal ${wordLimit} kata. Gunakan struktur:
- Label insight
- Inti temuan
- Detail actionable
- Implikasi untuk Baruma
- Hal yang harus divalidasi`
}

async function callModel(model, taskName, taskPrompt) {
  const token = tokens[tokenIndex++ % tokens.length]
  const cfg = {
    baseUrl: process.env.FAUCET_BASE_URL || "https://freetokenfaucet.com/v1",
    model,
    apiKey: token,
  }
  const started = Date.now()
  const { text, usage } = await faucetChat(
    cfg,
    [
      { role: "system", content: "You are a rigorous Indonesian startup market researcher. Be concrete and skeptical." },
      { role: "user", content: promptFor(taskName, taskPrompt) },
    ],
    {
      token,
      maxTokens: Number(process.env.GROWTH_MAX_TOKENS || 1600),
      temperature: 0.45,
      tries: Number(process.env.GROWTH_TRIES || 3),
      thinking: model.includes("deepseek") ? "disabled" : undefined,
    },
  )
  return {
    model,
    taskName,
    ms: Date.now() - started,
    usage,
    text: text.trim(),
  }
}

async function main() {
  const limit = Number(process.env.GROWTH_TASK_LIMIT || tasks.length)
  const selectedTasks = tasks.slice(0, limit)
  const results = []
  const markdown = []
  console.log(`[bench] models=${models.join(",")} tasks=${selectedTasks.length} tokens=${tokens.length}`)

  for (const model of models) {
    markdown.push(`# Model: ${model}\n`)
    for (const [taskName, taskPrompt] of selectedTasks) {
      try {
        const result = await callModel(model, taskName, taskPrompt)
        results.push(result)
        markdown.push(`## ${taskName}\n\nDuration: ${result.ms}ms\nUsage: ${JSON.stringify(result.usage)}\n\n${result.text}\n`)
        writeFileSync(path.join(OUT_DIR, `${model}.md`), markdown.join("\n"))
        console.log(`[bench] ${model} ${taskName} ok ${result.ms}ms tokens=${result.usage.total_tokens ?? 0}`)
      } catch (err) {
        const failed = { model, taskName, error: err.message }
        results.push(failed)
        markdown.push(`## ${taskName}\n\nFAILED: ${err.message}\n`)
        writeFileSync(path.join(OUT_DIR, `${model}.md`), markdown.join("\n"))
        console.log(`[bench] ${model} ${taskName} fail ${err.message}`)
      }
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    models,
    taskCount: selectedTasks.length,
    calls: results.length,
    totalsByModel: Object.fromEntries(models.map((model) => {
      const rows = results.filter((r) => r.model === model)
      return [model, {
        ok: rows.filter((r) => !r.error).length,
        failed: rows.filter((r) => r.error).length,
        totalTokens: rows.reduce((sum, r) => sum + (r.usage?.total_tokens ?? 0), 0),
        avgMs: Math.round(rows.filter((r) => r.ms).reduce((sum, r) => sum + r.ms, 0) / Math.max(1, rows.filter((r) => r.ms).length)),
      }]
    })),
  }
  writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2))
  writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2))
  console.log(`[bench] done ${JSON.stringify(summary.totalsByModel)}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
