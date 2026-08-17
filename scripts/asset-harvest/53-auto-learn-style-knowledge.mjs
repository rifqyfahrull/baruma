import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./_shared.mjs";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
  "..",
);
loadEnvLocal(repoRoot);

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is missing!");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: dbUrl });

/**
 * Auto-Learn Knowledge Ingestion Engine:
 * Takes architectural style specifications & design guidelines, parses them,
 * and automatically ingests them into PostgreSQL design_knowledge & app_knowledge tables.
 */
export async function autoLearnStyleKnowledge(styleConfig) {
  const { id, topic, topicType = "style", concept, principles, claddingPairings, lighting, templateId, keywords } = styleConfig;

  console.log(`\n🧠 Auto-Learning Knowledge: "${topic}" (${id})...`);

  // 1. Upsert into design_knowledge table
  const designKnowledge = {
    concept,
    principles,
    claddingPairings,
    lighting,
    recommended_for: ["Rumah 2 lantai mewah", "Lahan memanjang atau hook", "Iklim tropis kelembapan tinggi"],
    pros: ["Tampak mewah dan hangat", "Pencahayaan alami melimpah", "Nilai estetika & resale value tinggi"],
    common_mistakes: [
      "Menggunakan kaca besar tanpa overstek/peneduh sehingga ruangan panas",
      "Memakai batu alam tanpa lapisan coating waterproof"
    ]
  };

  await pool.query(
    `INSERT INTO design_knowledge (id, topic_type, topic, knowledge)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic, knowledge = EXCLUDED.knowledge;`,
    [id, topicType, topic, JSON.stringify(designKnowledge)]
  );
  console.log(`✅ Ingested into design_knowledge: ${id}`);

  // 2. Upsert into app_knowledge table for mechanic retrieval
  if (templateId) {
    const appKnowledge = {
      action: "applyFacadeTemplate",
      templateId,
      rule: `Gunakan template ${templateId} untuk menerapkan fasad ${topic} secara instan.`
    };
    await pool.query(
      `INSERT INTO app_knowledge (id, kind, name, keywords, knowledge)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, keywords = EXCLUDED.keywords, knowledge = EXCLUDED.knowledge;`,
      [`template:${templateId}`, "mechanic", `Template Fasad: ${topic}`, keywords || topic.toLowerCase(), JSON.stringify(appKnowledge)]
    );
    console.log(`✅ Ingested into app_knowledge: template:${templateId}`);
  }
}

// Pre-packaged Modern Tropis Villa Knowledge configuration
const MODERN_TROPIS_VILLA_KNOWLEDGE = {
  id: "style:modern-tropis-villa-luxury",
  topic_type: "style",
  topic: "Modern Tropis Villa Luxury (Emporio Style)",
  concept: "Gaya Modern Tropis Villa menggabungkan kemewahan marmer krem/travertine, overstek plafon berpanel kayu WPC hangat, bukaan kaca penuh (floor-to-ceiling), serta balkon lantai 2 ber-railing kaca tempered untuk hunian tropis yang megah dan sejuk.",
  principles: [
    "Overstek kanopi dan lisplang lebar (0.6 - 1.0m) pelindung dari hujan tropis dan terik matahari",
    "Bukaan jendela dan pintu kaca geser tinggi untuk pencahayaan dan ventilasi silang alami",
    "Penggunaan balkon lantai 2 ber-railing kaca transparan untuk kesan lega dan menyatu dengan alam",
    "Aksen louvers/kisi-kisi kayu vertikal sebagai peneduh privasi ruangan lantai 2"
  ],
  claddingPairings: {
    hero: "marmer_krem",
    accent: "kayu_cladding",
    base: "marmer_krem",
    louverFinish: "kayu"
  },
  lighting: [
    "Warm white 3000K downlights di plafon overstek kanopi",
    "Hidden LED strip lighting di bawah lisplang/fasad"
  ],
  templateId: "modern_tropis_villa",
  keywords: "modern tropis villa travertine emporio marmer krem wpc kayu railing kaca louver fasad"
};

async function main() {
  try {
    await autoLearnStyleKnowledge(MODERN_TROPIS_VILLA_KNOWLEDGE);
    console.log("\n🎉 Auto-Learn execution finished successfully!");
  } catch (e) {
    console.error("Auto-Learn execution error:", e.message);
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("53-auto-learn-style-knowledge.mjs")) {
  main();
}
