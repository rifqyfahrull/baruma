-- 0043: AI Render Scene Intelligence (Fase A) — pose kamera per job + kolom
-- target/room_id (dipakai Fase B interior; ditambahkan sekarang supaya satu
-- migrasi, lihat spec 2026-08-23) + cache hasil LLM polish per hash facts
-- (satu hasil dipakai lintas job selama layout tidak berubah). Idempoten.
--
-- Catatan penomoran: brief task menyebut file ini "0040_ai_render_scene_intel.sql",
-- namun 0040 sudah dipakai (0040_share_links.sql, sudah live). Dinomori 0043
-- (lanjutan sekuensial setelah 0042_render_jobs_seed_bigint.sql) supaya urutan
-- filename tetap sama dgn urutan kronologis penerapan migrasi.
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS target text NOT NULL DEFAULT 'exterior';
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS room_id text;
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS camera_pose jsonb;

CREATE TABLE IF NOT EXISTS render_polish_cache (
  facts_hash text PRIMARY KEY,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
