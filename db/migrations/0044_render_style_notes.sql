-- 0044: AI Render × Chat — Style Notes (spec 2026-08-29). Kolom audit
-- `style_notes` untuk render_jobs — teks tersanitasi ("catatan gaya" user,
-- lihat src/lib/server/ai-render/style-notes.ts) yang dikomposisikan ke
-- prompt server-side sebagai klausa terapit (bukan prompt bebas). Kolom
-- opsional (nullable, tanpa DEFAULT) — jalur eksisting yang tak mengisinya
-- tetap NULL. Idempoten.
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS style_notes text;
