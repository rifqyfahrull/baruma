import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
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
    console.error("Could not read .env.local:", e.message);
  }
}

loadEnvLocal();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is missing!");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: dbUrl });

async function seedKoridorKnowledge() {
  console.log("Seeding koridor & circulation knowledge into PostgreSQL...");

  // 1. Insert into design_knowledge
  const designRecord = {
    id: "room:koridor-dan-sirkulasi-aksesibilitas",
    topic_type: "room",
    topic: "Koridor dan Sirkulasi Aksesibilitas Penghuni",
    knowledge: {
      concept: "Koridor dan selasar adalah jalur sirkulasi horizontal interior (lebar 0.9–1.2m) yang menghubungkan ruang publik/semi-publik depan (Carport, Ruang Tamu) ke ruang privat/servis belakang (Kamar Tidur, Laundry, Dapur) tanpa memaksa penghuni berjalan lewat luar rumah.",
      accessibility_principles: [
        "Lebar koridor minimal 0.9m untuk 1 orang, ideal 1.2m untuk 2 orang berpapasan atau membawa barang.",
        "Setiap kamar tidur WAJIB memiliki akses interior langsung menuju ruang keluarga/ruang tamu dan kamar mandi tanpa harus keluar melewati carport/taman.",
        "Sirkulasi lineal (lurus dari depan ke belakang) sangat cocok untuk lahan memanjang."
      ],
      integration_with_existing_design: [
        "Jika menambah koridor pada denah yang sudah padat, koridor dibuat dengan mengecilkan atau menggeser ruang servis (Laundry, Dapur, Taman Depan) bukan mengorbankan fungsi utama.",
        "Selaras dengan brief: mempertahankan jumlah kamar dan fungsionalitas utama sambil memprioritaskan kemudahan akses penghuni."
      ],
      why_used: ["Menjamin privasi dan kenyamanan sirkulasi penghuni antar ruang", "Menghubungkan area depan dan belakang rumah secara internal"],
      pros: ["Sirkulasi rumah tertata rapi", "Akses privat dari kamar belakang tidak terputus"],
      recommended_for: ["Denah lahan memanjang/sempit", "Rumah dengan kamar tidur di posisi paling belakang"]
    }
  };

  await pool.query(
    `INSERT INTO design_knowledge (id, topic_type, topic, knowledge)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic, knowledge = EXCLUDED.knowledge`,
    [designRecord.id, designRecord.topic_type, designRecord.topic, JSON.stringify(designRecord.knowledge)]
  );

  console.log("✅ Inserted room:koridor-dan-sirkulasi-aksesibilitas into design_knowledge");

  // 2. Insert into app_knowledge
  const appRecord = {
    id: "mechanic:koridor-aksesibilitas",
    kind: "mechanic",
    name: "Koridor & Sirkulasi Aksesibilitas",
    keywords: "koridor selasar akses depan belakang sirkulasi terhubung jalan lorong",
    knowledge: {
      action: "addRoom",
      roomType: "koridor",
      rule: "Menambah koridor (addRoom koridor/void) memerlukan penyesuaian width/depth pada semua ruang yang berada di jalur sumbu X/Y koridor agar bebas tumpang tindih. Kecilkan ruang servis (laundry/dapur/taman) untuk memberi ruang koridor."
    }
  };

  await pool.query(
    `INSERT INTO app_knowledge (id, kind, name, keywords, knowledge)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, keywords = EXCLUDED.keywords, knowledge = EXCLUDED.knowledge`,
    [appRecord.id, appRecord.kind, appRecord.name, appRecord.keywords, JSON.stringify(appRecord.knowledge)]
  );

  console.log("✅ Inserted mechanic:koridor-aksesibilitas into app_knowledge");

  await pool.end();
}

seedKoridorKnowledge().catch(console.error);
