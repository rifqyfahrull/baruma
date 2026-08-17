import { requireUser } from "@/lib/server/auth-server";
import { getOwnedProject } from "@/lib/server/repo/projects";
import { spendCredits, refundCredits } from "@/lib/server/repo/credits";
import { ok, err, errCode, handleError } from "@/lib/server/response";
import { rateLimitGuard } from "@/lib/server/rate-limit";
import { type ChatMsg, chatJSON, llmEnabled } from "@/lib/server/llm";
import { sceneKnowledgeNote } from "@/lib/server/repo/design-knowledge";
import { appMechanicsNote } from "@/lib/server/repo/app-knowledge";
import { answerKnowledgeQuestion } from "@/lib/server/knowledge-answer";
import { answerFeatureQuestion } from "@/lib/assistant/feature-catalog";
import {
  buildContextFromMessages,
  buildMessages,
  buildRevisionMessage,
  findFloorplanActionFeedback,
  humanizeViolations,
  reconcileFloorplanOverlaps,
  sanitizeActions,
} from "@/lib/server/editor-assistant";
import { repairConnectivity } from "@/lib/server/connectivity-repair";
import { planFloorplanTurn } from "@/lib/server/floorplan-planner";
import { appendMessage, listMessages } from "@/lib/server/repo/assistant";
import { handleFloorplanInstruction } from "@/lib/assistant/deterministic";
import { buildInitialFloorplan, isExplicitResetIntent } from "@/lib/server/initial-floorplan";
import { getLayoutPayload } from "@/lib/server/repo/layouts";
import { getBriefPayload } from "@/lib/server/repo/briefs";
import { auditDesign } from "@/lib/audit/design-audit";
import { formatAuditReply, isDesignAuditIntent } from "@/lib/audit/audit-intent";
import {
  describeAction,
  editorAssistantRequestSchema,
  parseScene,
  type AssistantAction,
  type AssistantTurn,
  type FloorplanAction,
  type FloorplanScene,
} from "@/lib/assistant/actions";

// What the user sees when the LLM returned a low-confidence / empty-action
// response. The first sentence gives a concrete next step ("sebutkan lantai
// tujuan & tipe ruang" or "pecah jadi satu perintah") so the user can
// recover without re-typing their whole request; the example mirrors the
// phrasing the assistant DOES handle deterministically (see
// `matchMoveRoomToFloor` in `lib/assistant/deterministic.ts`).
export const EDITOR_AGENT_FALLBACK =
  "Asisten AI belum berhasil memproses perintah ini. Coba pecah jadi satu langkah sederhana — " +
  "mis. 'pindahkan kamar mandi dari lantai 1 ke lantai 2' atau 'kamar mandi di lantai 1 posisinya kurang pas, " +
  "tolong digeser'. Perintah yang lebih spesifik (lantai + tipe ruang) biasanya bisa saya kerjakan langsung.";
export const maxDuration = 120;
const NO_INITIAL_FLOORPLAN = { matched: false as const, reply: "", actions: [] as FloorplanAction[] };
export const EDITOR_AGENT_FALLBACK_NO_LLM =
  "Asisten AI belum diaktifkan di lingkungan ini. Hubungi admin untuk mengatur kunci LLM.";

function normalizeFollowup(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export function contextualFloorplanInstruction(
  instruction: string,
  history: AssistantTurn[],
): string {
  const norm = normalizeFollowup(instruction);
  const words = norm ? norm.split(" ") : [];
  const isConciseRoomAnswer =
    words.length > 0 &&
    words.length <= 4 &&
    !["perbaiki", "pindah", "pindahkan", "geser", "tambah", "hapus"].some((word) =>
      words.includes(word),
    );
  if (!isConciseRoomAnswer) return instruction;

  const recent = history.slice(-6);
  const assistantAskedForSacrifice = [...recent]
    .reverse()
    .some(
      (turn) =>
        turn.role === "assistant" &&
        normalizeFollowup(turn.content).includes("ruang tetangga") &&
        normalizeFollowup(turn.content).includes("terlalu kecil"),
    );
  if (!assistantAskedForSacrifice) return instruction;

  const priorSmallWarning = [...recent]
    .reverse()
    .find(
      (turn) =>
        turn.role === "user" &&
        normalizeFollowup(turn.content).includes("peringatan") &&
        (normalizeFollowup(turn.content).includes("cukup kecil") ||
          normalizeFollowup(turn.content).includes("terlalu kecil")),
    );

  return (
    (priorSmallWarning?.content ??
      "Aksi yang saya inginkan: bantu perbaiki peringatan ruang yang terlalu kecil dengan perubahan denah yang aman.") +
    `\nRuang tetangga yang boleh dikorbankan/diubah: ${instruction}.`
  );
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { userId } = await requireUser(request);
    const { id } = await ctx.params;
    const project = await getOwnedProject(id, userId);
    if (!project) return err(404, "Project not found");
    return ok({ messages: await listMessages(id) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const reqClone = request.clone()
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const sendPing = setInterval(() => {
        controller.enqueue(encoder.encode('data: {"type":"ping"}\n\n'))
      }, 5000)
      const emitProgress = (message: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "progress", message })}\n\n`))
        } catch {
          /* stream may already be closing; progress is best-effort */
        }
      }

      try {
        const response = await runLogic(reqClone, ctx, emitProgress)
        if (response.status >= 400) {
          const body = await response.json().catch(() => null)
          // SSE has no HTTP-status/header channel to the client, so a 429's
          // Retry-After header is folded into the JSON payload instead —
          // otherwise callers hitting rateLimitGuard above would silently
          // lose the retry hint.
          const retryAfter = response.headers.get("Retry-After")
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: body?.error ?? 'Error',
            status: response.status,
            ...(retryAfter ? { retryAfter: Number(retryAfter) } : {}),
          })}\n\n`))
        } else {
          const body = await response.json()
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', data: body })}\n\n`))
        }
      } catch (e: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e?.message ?? String(e) })}\n\n`))
      } finally {
        clearInterval(sendPing)
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    }
  })
}

async function runLogic(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
  onProgress?: (message: string) => void,
): Promise<Response> {
  try {
    // Pre-auth per-IP guard (audit CSO 2026-08-15, AI-abuse hardening): stops
    // unauthenticated request sprays from burning requireUser/DB work before
    // we even know who's asking. 60/5min/instance is loose on purpose — it
    // only needs to blunt scripted spray, not throttle real traffic.
    const ipLimited = rateLimitGuard(request, {
      scope: "editor-assistant-ip",
      limit: 60,
      windowMs: 5 * 60_000,
    });
    if (ipLimited) return ipLimited;

    const { userId } = await requireUser(request);

    // Per-user rate guard on top of the credit gate: credits cap total spend,
    // not the rate of spend, and this route has NO credit gate at all for
    // deterministic/no-LLM turns. Each LLM turn can chain up to 3 sequential
    // round-trips (chatJSON / planFloorplanTurn, each up to ~115s, this
    // route's own maxDuration is 120s), so a genuinely active user issues at
    // most roughly one instruction every several dozen seconds. 15 requests /
    // 5 minutes (~1 per 20s) stays generous for that usage while bounding
    // abuse cost. Scope is shared with projects/[id]/agent/route.ts so a
    // caller can't double the effective budget by alternating surfaces.
    // NOTE: pm2 cluster runs -i 2, and this limiter is IN-MEMORY PER
    // INSTANCE (see rate-limit.ts docstring) — the effective ceiling across
    // both workers is therefore ≈2× these numbers (≈30/5min), which is the
    // deliberate assumption baked into the limit chosen here.
    const userLimited = rateLimitGuard(request, {
      scope: "editor-assistant",
      limit: 15,
      windowMs: 5 * 60_000,
      keyExtra: userId,
    });
    if (userLimited) return userLimited;

    const { id } = await ctx.params;
    const project = await getOwnedProject(id, userId);
    if (!project) return err(404, "Project not found");

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return err(400, "Invalid JSON body");
    }
    const parsed = editorAssistantRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return err(
        400,
        parsed.error.issues[0]?.message ?? "Invalid request body",
      );
    }

    const { mode, instruction } = parsed.data;
    const scene = parseScene(mode, parsed.data.scene);
    if (!scene) return err(400, "Invalid scene snapshot");

    // Design-standards audit: when the user ASKS whether the design meets
    // standards (rather than requesting an edit), answer with the grounded,
    // deterministic report — no LLM, no credit spend. Uses the persisted
    // layout + brief so regulatory/structural checks have full data (the
    // scene snapshot lacks lot area / road width / readiness).
    if (mode === "floorplan" && isDesignAuditIntent(instruction)) {
      const layout = await getLayoutPayload(id);
      if (layout) {
        const brief = await getBriefPayload(id);
        const audit = auditDesign({ project, layout, brief });
        await appendMessage(id, { mode, role: "user", content: instruction });
        const message = await appendMessage(id, {
          mode,
          role: "assistant",
          content: formatAuditReply(audit),
          actions: null,
          actionLabels: null,
          status: null,
        });
        return ok({ message });
      }
    }

    // Pertanyaan KEMAMPUAN FITUR ("bisa gak bikin skylight?", "ada fitur
    // mezzanine?") dijawab DETERMINISTIK dari kamus fitur (feature-catalog)
    // — tanpa LLM, tanpa kredit, dan tanpa mengarang action untuk fitur yang
    // sebenarnya hanya bisa lewat UI. Dijalankan di awal (sebelum kredit)
    // agar jawabannya gratis; null → lanjut pipeline normal.
    if (mode === "floorplan" || mode === "interior") {
      const featureAnswer = answerFeatureQuestion(instruction);
      if (featureAnswer) {
        await appendMessage(id, { mode, role: "user", content: instruction });
        const message = await appendMessage(id, {
          mode,
          role: "assistant",
          content: featureAnswer,
          actions: null,
          actionLabels: null,
          status: null,
        });
        return ok({ message });
      }
    }

    // Context from prior thread, BEFORE appending the new user turn.
    const history = buildContextFromMessages(await listMessages(id));
    const effectiveInstruction =
      mode === "floorplan"
        ? contextualFloorplanInstruction(instruction, history)
        : instruction;

    let reply = llmEnabled() ? EDITOR_AGENT_FALLBACK : EDITOR_AGENT_FALLBACK_NO_LLM;
    let actions: AssistantAction[] = [];
    let llmFailed = false;
    let deterministicMatched = false;
    let llmInstruction = effectiveInstruction;
    let plannerNote: string | undefined;

    // First: try deterministic handlers for common floorplan instructions.
    // These are fast candidates and do not consume credits, but still pass
    // through the same quality gate as LLM proposals before reaching the UI.
    if (mode === "floorplan") {
      // Kanvas kosong + brief berisi program ruang: susun denah lengkap dengan
      // solver geometri (`generateLayout`), bukan menyuruh LLM mengarang
      // koordinat. LLM berulang kali menghasilkan koridor yang menimpa ruang
      // makan sehingga validator membuang seluruh usulan dan pengguna menerima
      // 0 aksi (regresi proj-modern-tropis-1, 2026-08-02). Dijalankan lebih
      // dulu karena `matchAddRoom` bisa ikut cocok dengan kalimat yang sama.
      // Build denah awal hanya untuk kanvas KOSONG, atau denah terisi yang
      // EKSPLISIT diminta dibangun ulang dari nol ("bangun ulang denah ini",
      // "mulai dari nol"). Tanpa pengecualian reset, rebuild di denah terisi
      // jatuh ke LLM yang tak boleh menghapus massal (guard) — kebuntuan.
      const sceneRoomsCount = (scene as FloorplanScene).rooms?.length ?? 0
      const mayRebuildFromZero =
        sceneRoomsCount === 0 || isExplicitResetIntent(effectiveInstruction)
      const initialBrief = mayRebuildFromZero
        ? await getBriefPayload(id).catch(() => null)
        : null;
      const initial = initialBrief
        ? buildInitialFloorplan(
            effectiveInstruction,
            scene as FloorplanScene,
            project,
            initialBrief,
          )
        : NO_INITIAL_FLOORPLAN;
      if (initial.matched) {
        deterministicMatched = true;
        reply = initial.reply;
        actions = initial.actions;
      }

      const deterministic = deterministicMatched
        ? { matched: false as const, reply: "", actions: [] as FloorplanAction[] }
        : handleFloorplanInstruction(
            effectiveInstruction,
            scene as FloorplanScene,
          );
      if (deterministic.matched) {
        deterministicMatched = true;
        reply = deterministic.reply;
        actions = deterministic.actions;
        const feedback = deterministic.actions.length
          ? findFloorplanActionFeedback(
              scene as FloorplanScene,
              deterministic.actions,
              effectiveInstruction,
            )
          : [];
        if (feedback.length > 0) {
          deterministicMatched = false;
          actions = [];
          reply = llmEnabled() ? EDITOR_AGENT_FALLBACK : EDITOR_AGENT_FALLBACK_NO_LLM;
          llmInstruction =
            effectiveInstruction +
            "\n\nCatatan validator internal: usulan cepat diabaikan karena " +
            feedback.join("; ") +
            ". Cari solusi denah lain yang menyelesaikan masalah tanpa memunculkan peringatan baru.";
        }
      }
    }

    // Second: spend credits and call the LLM for anything not handled deterministically.
    if (!deterministicMatched && reply !== EDITOR_AGENT_FALLBACK_NO_LLM) {
      const spend = await spendCredits(userId, 1, "editor_assistant", id);
      if (spend === "insufficient") {
        return errCode(
          402,
          "insufficient_credits",
          "Kredit AI Anda telah habis. Upgrade plan untuk melanjutkan.",
        );
      }
    }

    // Record the user turn only after we're sure the request will be processed
    // (credit check passed, or deterministic handler matched).
    await appendMessage(id, { mode, role: "user", content: instruction });

    if (!deterministicMatched && reply !== EDITOR_AGENT_FALLBACK_NO_LLM) {
      try {
        // Pertanyaan PENGETAHUAN ("kenapa pakai kitchen island?") di panel
        // editor dijawab lewat jalur Q&A ter-grounding — pipeline edit-JSON
        // pernah gagal utk kasus ini di produksi dan menjatuhkan pengguna ke
        // fallback "pecah jadi langkah edit" yang salah konteks. Jalur ini
        // punya fallback deterministik dari knowledge, jadi tak bergantung LLM.
        const qa = await answerKnowledgeQuestion(instruction);
        if (qa) {
          reply = qa;
        } else if (mode === "floorplan") {
          // Single consolidated pass: 1 LLM call, deterministic reconciliation,
          // at most 1 revision, then humanized failure if still blocked.
          const reqStartTime = Date.now();
          const planNote = await sceneKnowledgeNote(scene, llmInstruction);
          const mechNote = await appMechanicsNote(llmInstruction);
          // BRIEF WAJIB IKUT: tanpa ini `spaceProgram` tidak pernah sampai ke
          // Agent Utama maupun Agent Denah, dan untuk proyek yang denahnya masih
          // kosong keduanya kehilangan satu-satunya daftar ruang yang ada —
          // lalu menagihnya ke pengguna (regresi proj-modern-tropis-1,
          // 2026-08-02). Jalur agent/route.ts sudah mengirimnya sejak awal;
          // jalur editor ini tertinggal.
          // Brief bersifat MELENGKAPI: bila pembacaannya gagal, satu turn edit
          // biasa tetap harus jalan (tanpa ini kegagalan baca brief menelan
          // seluruh respons dan pengguna menerima fallback + refund).
          const editorBrief = await getBriefPayload(id).catch(() => null);
          const res = await runFloorplanAgentPass(
            scene as FloorplanScene,
            llmInstruction,
            history,
            planNote,
            mechNote,
            undefined,
            editorBrief,
            reqStartTime,
            onProgress,
          );
          reply = res.rawContent ?? res.reply;
          actions = res.actions as any;
          llmFailed = !!res.llmFailed;
          plannerNote = res.plannerNote;
        } else {
          const messages = buildMessages(
            mode, scene, instruction, history,
            await sceneKnowledgeNote(scene, instruction),
            await appMechanicsNote(instruction),
          );
          const out = await chatJSON<{ reply?: string; actions?: unknown[]; needs_clarify?: unknown[]; options?: unknown[] }>(messages);
          llmFailed = out === null;
          const rawContent = (out?.needs_clarify || out?.options) ? JSON.stringify(out) : null;
          reply =
            rawContent ??
            (typeof out?.reply === "string" && out.reply.trim()
              ? out.reply.trim()
              : EDITOR_AGENT_FALLBACK);
          actions = sanitizeActions(
            mode,
            out && Array.isArray(out.actions) ? out.actions : [],
            scene,
          );
        }
      } catch (e) {
        await refundCredits(userId, 1, "editor_assistant_refund", id);
        throw e;
      }
      if (llmFailed) {
        await refundCredits(userId, 1, "editor_assistant_refund", id);
      }
    }

    const labels = actions.map((a) => describeAction(a, scene));
    const message = await appendMessage(id, {
      mode,
      role: "assistant",
      content: reply,
      plannerNote,
      actions: actions.length ? actions : null,
      actionLabels: actions.length ? labels : null,
      status: actions.length ? "proposed" : null,
    });
    return ok({ message });
  } catch (e) {
    return handleError(e);
  }
}

import type { Brief } from "@/types";

/**
 * One floorplan agent turn: an initial LLM proposal, a deterministic overlap
 * reconciler (no LLM cost), and — only if that isn't enough — exactly ONE
 * LLM revision followed by the reconciler again. Worst case: 2 sequential
 * chatJSON calls, not 3; small overlaps never need a second model round-trip
 * at all.
 */
export async function runFloorplanAgentPass(
  scene: FloorplanScene,
  instruction: string,
  history: AssistantTurn[],
  knowledgeNote?: string,
  mechanicsNote?: string,
  assetNote?: string,
  brief?: Brief | null,
  reqStartTime?: number,
  onProgress?: (message: string) => void,
): Promise<{ reply: string; actions: FloorplanAction[]; rawContent?: string; llmFailed?: boolean; plannerNote?: string }> {
  // AGENT UTAMA (baruma-assistant): satu panggilan prosa sebelum eksekusi —
  // menyusun rencana yang disuntikkan ke prompt agent eksekusi DAN ditampilkan
  // ke UI sebagai kartu "Agent Utama". Gagal → null → pipeline jalan tanpa
  // rencana (kontrak resilience: tidak pernah menggagalkan turn).
  onProgress?.("Agent Utama (arsitek) menyusun rencana…");
  const plannerNote = await planFloorplanTurn({ instruction, scene, brief }).catch(() => null) ?? undefined;

  const messages: ChatMsg[] = buildMessages(
    "floorplan",
    scene,
    instruction,
    history,
    knowledgeNote,
    mechanicsNote,
    assetNote,
    brief,
    plannerNote,
  );

  onProgress?.("Agent Denah menyusun usulan denah…");
  const out = await chatJSON<{ reply?: string; actions?: unknown[]; needs_clarify?: unknown[]; options?: unknown[] }>(messages);
  if (!out) return { reply: EDITOR_AGENT_FALLBACK, actions: [], llmFailed: true, plannerNote };

  const reply = typeof out.reply === "string" && out.reply.trim() ? out.reply.trim() : EDITOR_AGENT_FALLBACK;
  const acts = sanitizeActions("floorplan", Array.isArray(out.actions) ? out.actions : [], scene) as FloorplanAction[];
  const rawContent = (out.needs_clarify || out.options) ? JSON.stringify(out) : undefined;
  if (acts.length === 0) return { reply, actions: [], rawContent, plannerNote };

  const violations = findFloorplanActionFeedback(scene, acts, instruction);
  if (violations.length === 0) return { reply, actions: acts, rawContent, plannerNote };

  onProgress?.("Menyesuaikan tata letak agar tidak tumpang-tindih…");
  const reconciled = reconcileFloorplanOverlaps(scene, acts, instruction);
  if (reconciled.remainingViolations.length === 0) {
    return { reply, actions: reconciled.actions, rawContent, plannerNote };
  }

  // Ruang yang jadi tak terjangkau bisa diselesaikan DETERMINISTIK — solver
  // generateConnectingDoors tahu tetangga mana yang pantas ditembus. Coba
  // dulu sebelum membebani LLM dengan revisi; hasilnya lebih konsisten.
  onProgress?.("Menyambungkan ruang yang belum bisa diakses dari dalam…");
  const repaired = repairConnectivity(scene, reconciled.actions);
  if (repaired.actions.length > reconciled.actions.length) {
    const afterRepair = findFloorplanActionFeedback(scene, repaired.actions, instruction);
    if (afterRepair.length === 0) {
      return { reply, actions: repaired.actions, rawContent, plannerNote };
    }
  }

  if (reqStartTime && Date.now() - reqStartTime >= 90000) {
    return { reply: humanizeViolations(reconciled.remainingViolations), actions: [], llmFailed: true, plannerNote };
  }

  onProgress?.("Meminta AI merevisi sekali lagi…");
  const revisionMessages: ChatMsg[] = [
    ...messages,
    { role: "assistant", content: JSON.stringify({ reply, actions: acts }) },
    {
      role: "user",
      content: buildRevisionMessage([
        ...reconciled.remainingViolations,
        // Sisa yang tak bisa disambung otomatis = butuh keputusan desain
        // (koridor), bukan tambalan pintu. Sampaikan apa adanya.
        ...repaired.remainingIssues,
      ]),
    },
  ];
  const out2 = await chatJSON<{ reply?: string; actions?: unknown[]; needs_clarify?: unknown[]; options?: unknown[] }>(revisionMessages);
  if (!out2) {
    return { reply: humanizeViolations(reconciled.remainingViolations), actions: [], llmFailed: true, plannerNote };
  }

  const reply2 = typeof out2.reply === "string" && out2.reply.trim() ? out2.reply.trim() : EDITOR_AGENT_FALLBACK;
  const acts2 = sanitizeActions("floorplan", Array.isArray(out2.actions) ? out2.actions : [], scene) as FloorplanAction[];
  const rawContent2 = (out2.needs_clarify || out2.options) ? JSON.stringify(out2) : undefined;
  if (acts2.length === 0) return { reply: reply2, actions: [], rawContent: rawContent2, plannerNote };

  const violations2 = findFloorplanActionFeedback(scene, acts2, instruction);
  if (violations2.length === 0) return { reply: reply2, actions: acts2, rawContent: rawContent2, plannerNote };

  onProgress?.("Menyesuaikan tata letak setelah revisi…");
  const reconciled2 = reconcileFloorplanOverlaps(scene, acts2, instruction);
  if (reconciled2.remainingViolations.length === 0) {
    return { reply: reply2, actions: reconciled2.actions, rawContent: rawContent2, plannerNote };
  }

  // Kesempatan terakhir secara deterministik sebelum menyerah.
  const repaired2 = repairConnectivity(scene, reconciled2.actions);
  if (repaired2.actions.length > reconciled2.actions.length) {
    const afterRepair2 = findFloorplanActionFeedback(scene, repaired2.actions, instruction);
    if (afterRepair2.length === 0) {
      return { reply: reply2, actions: repaired2.actions, rawContent: rawContent2, plannerNote };
    }
  }

  onProgress?.("Belum berhasil menata otomatis");
  return {
    reply: humanizeViolations([...reconciled2.remainingViolations, ...repaired2.remainingIssues]),
    actions: [],
    llmFailed: true,
    plannerNote,
  };
}
