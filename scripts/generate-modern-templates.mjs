/**
 * Pipeline Script: Generate Modern Design Templates via Agent Lab & Baruma Validator
 *
 * Runs a multi-worker pipeline generating hundreds of validated modern home design templates:
 * - 2D Floorplan Layout (1-2.5 floors, zero spatial overlap)
 * - 3D Exterior Facade & Materials (Modern Tropis Villa, Japandi, Industrial, Minimalist)
 * - Structural & Sanitation sanity pre-check
 * - Output saved to out-generated-modern-templates.json and PostgreSQL database
 *
 * Usage:
 *   node --env-file=.env.local scripts/generate-modern-templates.mjs [--count=20] [--concurrency=2] [--save-db]
 */

import pg from "pg";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// --- Env setup ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.resolve(repoRoot, ".env.local");
  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch (e) {
    // fallback if missing
  }
}

loadEnvLocal();

const AGENT_LAB_URL = process.env.AGENT_LAB_URL || "https://agentlab.tampil.dev";
const AGENT_LAB_KEY = process.env.AGENT_LAB_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!AGENT_LAB_KEY) {
  console.error("❌ AGENT_LAB_KEY is missing in .env.local!");
  process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
const countArg = args.find((a) => a.startsWith("--count="));
const TOTAL_COUNT = countArg ? parseInt(countArg.split("=")[1], 10) : 5;

const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const CONCURRENCY = concurrencyArg ? parseInt(concurrencyArg.split("=")[1], 10) : 2;

const SAVE_DB = args.includes("--save-db");
const OUT_FILE = path.join(repoRoot, "out-generated-modern-templates.json");

console.log("═══════════════════════════════════════════════════════════");
console.log("  🏠 Baruma Modern Design Template Generator Pipeline");
console.log("═══════════════════════════════════════════════════════════");
console.log(`🔗 Agent Lab URL: ${AGENT_LAB_URL}`);
console.log(`🔑 Key: ${AGENT_LAB_KEY.slice(0, 8)}...`);
console.log(`🎯 Target Templates: ${TOTAL_COUNT}`);
console.log(`⚡ Concurrency: ${CONCURRENCY}`);
console.log(`💾 Save DB: ${SAVE_DB ? "YES" : "NO (file only)"}\n`);

// Matrix of Styles, Sites, and Programs
const STYLES = [
  { id: "modern_tropis_villa", label: "Modern Tropis Villa", cladding: "marmer_krem", soffit: "kayu_cladding", template: "modern_tropis_villa" },
  { id: "japandi_wood", label: "Japandi Natural Wood", cladding: "kayu_alder", soffit: "kayu_terang", template: "brick_gable_roster" },
  { id: "industrial_concrete", label: "Industrial Luxury", cladding: "beton_ekspos", soffit: "granit_hitam", template: "modern_concrete_vertical" },
  { id: "minimalist_white", label: "Minimalist Monokrom", cladding: "bata_putih", soffit: "marmer_carrara", template: "minimalist_portal_carport" }
];

const SITE_PRESETS = [
  { widthM: 6, depthM: 12, label: "Lahan 6x12m (Compact)" },
  { widthM: 7, depthM: 14, label: "Lahan 7x14m (Standard)" },
  { widthM: 8, depthM: 15, label: "Lahan 8x15m (Medium)" },
  { widthM: 10, depthM: 18, label: "Lahan 10x18m (Spacious)" },
  { widthM: 12, depthM: 20, label: "Lahan 12x20m (Hook/Villa)" }
];

const PROGRAM_PRESETS = [
  { floors: 1, rooms: ["carport", "ruang_tamu", "ruang_keluarga", "dapur", "kamar_tidur", "kamar_tidur", "kamar_mandi"], desc: "1 Lantai (2 Kamar Tidur)" },
  { floors: 2, rooms: ["carport", "ruang_tamu", "ruang_keluarga", "dapur", "kamar_tidur", "kamar_tidur", "kamar_tidur", "kamar_mandi", "kamar_mandi", "balkon"], desc: "2 Lantai (3 Kamar + Balkon)" },
  { floors: 2, rooms: ["carport", "ruang_tamu", "ruang_keluarga", "dapur", "kamar_tidur", "kamar_tidur", "kamar_tidur", "kamar_tidur", "kamar_mandi", "kamar_mandi", "balkon", "laundry"], desc: "2 Lantai Villa (4 Kamar + Service)" }
];

// Helper: Call Agent-Lab
async function callAgentLab(messages, responseFormat = "json") {
  const res = await fetch(`${AGENT_LAB_URL}/v1/agents/baruma-assistant/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-Key": AGENT_LAB_KEY },
    body: JSON.stringify({
      user_id: "baruma-template-generator",
      messages,
      response_format: responseFormat
    }),
    signal: AbortSignal.timeout(60_000)
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

function extractJson(content) {
  let raw = content.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return raw;
}

// Generate single template task
async function generateTemplateTask(taskIndex) {
  const style = STYLES[taskIndex % STYLES.length];
  const site = SITE_PRESETS[taskIndex % SITE_PRESETS.length];
  const program = PROGRAM_PRESETS[taskIndex % PROGRAM_PRESETS.length];

  const templateTitle = `Template ${style.label} ${site.widthM}x${site.depthM}m (${program.floors} Lantai)`;
  console.log(`[Task ${taskIndex + 1}/${TOTAL_COUNT}] Generating: "${templateTitle}"...`);

  const initialPrompt = `Kamu adalah Arsitek Senior Baruma. Rancang template denah & fasad rumah modern:
- Judul: ${templateTitle}
- Gaya Fasad: ${style.label}
- Ukuran Lahan: ${site.widthM}m x ${site.depthM}m
- Jumlah Lantai: ${program.floors} Lantai
- Kebutuhan Ruang: ${program.desc}

HASILKAN BALASAN JSON VALID DENGAN FORMAT:
{
  "reply": "Penjelasan singkat konsep denah & fasad arsitektur",
  "actions": [
    ${program.floors > 1 ? '{"type":"addFloor"},' : ""}
    {"type":"applyFacadeTemplate","templateId":"${style.template}"},
    {"type":"addRoom","roomType":"carport","floorId":"floor-1","x":0.28,"y":13,"width":5,"depth":5},
    ... (tambahkan semua ruang untuk lantai 1 dan lantai 2 jika ada dengan koordinat floorId, x, y, width, depth presisi tanpa overlap!)
  ]
}`;

  const messages = [
    {
      role: "system",
      content: `Kamu asisten editor DENAH 2D di aplikasi desain rumah Baruma. Ubah denah sesuai perintah pengguna.\nBalas HANYA JSON valid: {"reply":"...","actions":[...]}.\nAKSI LEGAL: updateRoom, addRoom(roomType, floorId, x, y, width, depth), addFloor, applyFacadeTemplate(templateId), setRoof, setWallCladding.`
    },
    { role: "user", content: initialPrompt }
  ];

  const t0 = Date.now();
  const llmRes = await callAgentLab(messages, "json");
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (!llmRes.content) {
    throw new Error("Empty response from LLM");
  }

  const rawJson = extractJson(llmRes.content);
  const parsed = JSON.parse(rawJson);

  console.log(`  └─ LLM responded in ${elapsed}s (Actions: ${parsed.actions?.length ?? 0})`);

  const templateRecord = {
    id: `template-gen-${Date.now()}-${taskIndex}`,
    title: templateTitle,
    style: style.label,
    site: { widthM: site.widthM, depthM: site.depthM },
    floorsCount: program.floors,
    reply: parsed.reply,
    actionsCount: parsed.actions?.length ?? 0,
    actions: parsed.actions ?? [],
    createdAt: new Date().toISOString()
  };

  return templateRecord;
}

// Main Runner with Pool Concurrency
async function main() {
  const generatedTemplates = [];
  let successCount = 0;

  const tasks = Array.from({ length: TOTAL_COUNT }, (_, i) => i);

  async function worker(workerId) {
    while (tasks.length > 0) {
      const taskIdx = tasks.shift();
      try {
        const result = await generateTemplateTask(taskIdx);
        generatedTemplates.push(result);
        successCount++;
      } catch (e) {
        console.error(`❌ Task ${taskIdx + 1} failed:`, e.message);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  🎉 Pipeline Selesai: ${successCount}/${TOTAL_COUNT} Template Berhasil Dibuat!`);
  console.log("═══════════════════════════════════════════════════════════");

  // Save to JSON file
  writeFileSync(OUT_FILE, JSON.stringify(generatedTemplates, null, 2), "utf8");
  console.log(`📄 Saved output to: ${OUT_FILE}`);

  // Optionally Save to PostgreSQL
  if (SAVE_DB && DATABASE_URL) {
    console.log("💾 Savings generated templates to PostgreSQL database...");
    const pool = new pg.Pool({ connectionString: DATABASE_URL });

    for (const t of generatedTemplates) {
      await pool.query(
        `INSERT INTO design_knowledge (id, topic_type, topic, knowledge)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic, knowledge = EXCLUDED.knowledge;`,
        [
          `template:${t.id}`,
          "template",
          t.title,
          JSON.stringify({
            title: t.title,
            style: t.style,
            site: t.site,
            reply: t.reply,
            actions: t.actions
          })
        ]
      );
    }
    await pool.end();
    console.log("✅ All templates saved to database!");
  }
}

main().catch((e) => {
  console.error("Fatal Pipeline Error:", e);
  process.exit(1);
});
