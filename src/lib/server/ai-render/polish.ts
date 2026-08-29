/**
 * Lapisan LLM opsional (spec 2026-08-23 §Hybrid): memoles deskripsi scene
 * deterministik jadi paragraf arsitektural yang lebih luwes. KONTRAK
 * NEVER-THROW: selalu resolve string|null — null = pakai deskripsi
 * deterministik apa adanya. Flag AI_RENDER_POLISH=1 (default off). Hasil
 * di-cache per factsHash (render_polish_cache) supaya render ulang layout
 * sama tidak membayar LLM lagi & params_hash tetap bermakna.
 * CATATAN 2 REPO: file INI satu-satunya titik divergensi — repo utama pakai
 * chatText (Agent Lab); Emergent memakai openai-client. Jaga tetap kecil.
 */
import { chatText } from "@/lib/server/llm"
import { getPolishCache, setPolishCache } from "@/lib/server/repo/render-polish-cache"
import { describeRoomFacts, describeSceneFacts } from "./prompt"
import type { SceneFacts } from "./analyze"
import type { RoomFacts } from "./analyze-room"

const POLISH_TIMEOUT_MS = 5000

export function polishEnabled(): boolean {
  return process.env.AI_RENDER_POLISH === "1"
}

/** `RoomFacts` (Fase B) selalu punya `roomId`; `SceneFacts` (Fase A) tidak —
 *  dipakai untuk memilih deskripsi deterministik yang benar tanpa parameter
 *  tambahan di signature publik (caller cukup lempar facts apa adanya). */
function isRoomFacts(facts: SceneFacts | RoomFacts): facts is RoomFacts {
  return "roomId" in facts
}

/** FNV-1a 32-bit atas JSON facts — idiom sama projectSeed/renderParamsHash.
 *  Tipe dilebarkan ke `SceneFacts | RoomFacts` (Fase B) — implementasi tak
 *  berubah (JSON.stringify agnostik terhadap bentuk objek). */
export function factsHash(facts: SceneFacts | RoomFacts): string {
  const key = JSON.stringify(facts)
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export async function polishScene(facts: SceneFacts | RoomFacts): Promise<string | null> {
  if (!polishEnabled()) return null
  try {
    const hash = factsHash(facts)
    const cached = await getPolishCache(hash)
    if (cached) return cached
    const base = isRoomFacts(facts) ? describeRoomFacts(facts) : describeSceneFacts(facts)
    // Timer di-clear saat chatText menang race — proses pm2 long-lived tidak
    // terganggu timer nganggur, tapi tetap rapi di bawah beban konkuren.
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      chatText([
        {
          role: "system",
          content:
            "You rewrite structured architectural scene facts into ONE fluent English " +
            "paragraph for a photorealistic image prompt. Keep EVERY fact (sides, counts, " +
            "materials, dimensions) exactly as given; never invent or drop elements; no " +
            "camera/style/lighting words; max 90 words; output the paragraph only.",
        },
        { role: "user", content: base },
      ]),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), POLISH_TIMEOUT_MS)
      }),
    ]).finally(() => clearTimeout(timeoutId))
    const text = typeof result === "string" ? result.trim() : ""
    if (!text) return null
    await setPolishCache(hash, text)
    return text
  } catch (e) {
    console.error("[ai-render/polish]", e instanceof Error ? e.message : e)
    return null
  }
}
