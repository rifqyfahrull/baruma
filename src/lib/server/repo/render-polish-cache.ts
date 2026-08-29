/**
 * Cache hasil LLM polish per hash(SceneFacts) — lihat spec 2026-08-23.
 * Satu hasil dipakai lintas job selama layout & pose kelas sama. INSERT
 * ON CONFLICT DO NOTHING: race dua job dgn facts sama aman (yang kalah
 * memakai baris pemenang).
 */
import { query } from "@/lib/server/db"

export async function getPolishCache(factsHash: string): Promise<string | null> {
  const res = await query<{ description: string }>(
    `SELECT description FROM render_polish_cache WHERE facts_hash = $1`,
    [factsHash]
  )
  return res.rows[0]?.description ?? null
}

export async function setPolishCache(factsHash: string, description: string): Promise<void> {
  await query(
    `INSERT INTO render_polish_cache (facts_hash, description)
     VALUES ($1, $2) ON CONFLICT (facts_hash) DO NOTHING`,
    [factsHash, description]
  )
}
