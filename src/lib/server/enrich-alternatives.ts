/**
 * Enrich deterministic design alternatives with LLM-generated narrative
 * (name/description/keyFeatures/pros/cons). The computed,
 * money-sensitive fields (estimatedCost, areaM2, readiness, type, score,
 * floors, risks) are NEVER touched — the LLM only improves the wording.
 * Falls back to the deterministic narrative if the LLM is unavailable/invalid.
 */
import type { Alternative, Brief } from "@/types";
import { chatJSON, PROSE_SLUG } from "./llm";

interface EnrichItem {
  type?: string;
  name?: string;
  description?: string;
  keyFeatures?: unknown;
  pros?: unknown;
  cons?: unknown;
}

const strList = (v: unknown, max: number): string[] | null =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, max) : null;

export async function enrichAlternatives(
  alts: Alternative[],
  brief: Brief,
): Promise<Alternative[]> {
  if (alts.length === 0) return alts;

  const prompt = [
    "Kamu arsitek profesional. Perkaya narasi alternatif desain rumah berikut dalam Bahasa Indonesia,",
    "spesifik ke brief (gaya, lahan, prioritas, ruang). JANGAN mengubah angka biaya/luas.",
    `Brief: ${JSON.stringify({
      summary: brief.summary,
      site: brief.site,
      building: brief.building,
      priorities: brief.priorities,
      spaceProgram: brief.spaceProgram,
    })}`,
    `Alternatif (pertahankan urutan & "type"): ${JSON.stringify(alts.map((a) => ({ type: a.type, name: a.name })))}`,
    'Balas HANYA JSON: {"items":[{"type":"<type sama>","name":"...","description":"1-2 kalimat spesifik","keyFeatures":["3-4 fitur"],"pros":["2-3"],"cons":["1-2"]}]}.',
    "items wajib selaras urutan & type di atas.",
  ].join("\n");

  // Runs in the background (Next after()). This call explicitly overrides
  // chatJSON's default ACTIONS_SLUG (tuned for floorplan/interior action
  // JSON — low temperature, thinking disabled) back to PROSE_SLUG, since
  // this generates narrative prose, not action JSON. Generation policy and
  // provider timeout for that slug are centrally controlled by the
  // baruma-assistant Agent Lab config.
  const out = await chatJSON<{ items?: EnrichItem[] }>(
    [{ role: "user", content: prompt }],
    { slug: PROSE_SLUG },
  );

  if (!out?.items?.length) return alts; // fallback: keep deterministic narrative

  return alts.map((a, i) => {
    const e = out.items!.find((x) => x.type === a.type) ?? out.items![i];
    if (!e) return a;
    const kf = strList(e.keyFeatures, 5);
    const pros = strList(e.pros, 4);
    const cons = strList(e.cons, 4);
    return {
      ...a, // keep ALL computed fields (cost/area/readiness/type/score/floors/risks)
      name: typeof e.name === "string" && e.name.trim() ? e.name.trim() : a.name,
      description:
        typeof e.description === "string" && e.description.trim() ? e.description.trim() : a.description,
      keyFeatures: kf && kf.length ? kf : a.keyFeatures,
      pros: pros && pros.length ? pros : a.pros,
      cons: cons && cons.length ? cons : a.cons,
    };
  });
}
