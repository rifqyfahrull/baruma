# Integrasi Baruma → agent-lab (F1) — Design

**Tanggal:** 2026-07-21
**Status:** Disetujui (brainstorming) — siap ke writing-plans
**Repo:** Baruma (branch `feat/agent-lab-integration`)
**Depends on:** agent-lab F1 live di `https://agentlab.tampil.dev` (Pattern B / `retrieval:none` + `context_blocks`)
**Lintas-repo:** butuh enhancement kecil di **agent-lab** (tampil.dev) — lihat §3a. Wajib demi bar "tidak lebih bodoh dari agent baruma sekarang".

## 0. Bar kualitas WAJIB: tidak boleh lebih bodoh

Baruma = produk unggulan. Integrasi ini **tidak boleh menurunkan kualitas**
jalur advisory yang ada. Fakta terverifikasi tentang jalur `chatText` baruma
sekarang (yang jadi baseline yang harus DISAMAI atau DILAMPAUI):

- Model: `deepseek-v4-flash` (`LLM_ASSISTANT_MODEL`), `temperature: 0.4`.
- **DeepSeek thinking mode `enabled`** by default (reasoning chain-of-thought)
  untuk Q&A advisory open-ended — ini fitur kualitas nyata.
- Safety: jika thinking menghabiskan `max_tokens` → `content` kosong → **retry
  otomatis sekali dengan thinking off** (lihat `lib/server/llm.ts` `chatText`).

agent-lab F1 `llm_chat` saat ini mengirim `{model, messages, temperature,
max_tokens}` TANPA `thinking` — jadi route naif akan (a) kehilangan reasoning
thinking-mode = **lebih bodoh**, dan (b) jika thinking ditambah tanpa retry,
**mereintroduksi bug empty-content** yang sudah baruma selesaikan. Karena itu
§3a (enhancement agent-lab) + §10 (parity test) bersifat **WAJIB**, bukan opsional.

## 1. Konteks & Tujuan

agent-lab (di tampil.dev) adalah runtime agent AI terpusat, dikonsumsi produk
anakan lewat 1 endpoint HTTP `POST /v1/agents/{slug}/ask`. Tujuan integrasi ini:
mengalihkan jalur **Q&A prose** Baruma dari pemanggilan LLM langsung
(`lib/server/llm.ts` → DeepSeek) ke agent-lab, sehingga:

- Konfigurasi agent (model, system prompt, behavior) terpusat & bisa diubah dari
  backoffice tanpa deploy ulang Baruma.
- Kredensial LLM tidak lagi wajib ada di env Baruma untuk jalur ini (dipegang
  agent-lab).
- Baruma menjadi contoh konsumen **Pattern B** (context-grounded, tanpa vector
  retrieval): Baruma menghitung konteks deterministik sendiri (audit standar,
  design knowledge, saran aset) dan mengirimnya sebagai `context_blocks`.

**Non-tujuan:** menyentuh jalur ekstraksi terstruktur (`chatJSON`) atau
tool-calling (`chatWithTools`) — lihat §8.

## 2. Scope

**Masuk (2 call-site `chatText` — murni prose):**

| File | Baris | Fungsi sekarang |
|---|---|---|
| `src/app/api/v1/projects/[id]/brief/assistant/route.ts` | `chatText` @ ~90 | Q&A advisory brief |
| `src/app/api/v1/projects/[id]/agent/route.ts` | `chatText` @ ~192 | Balasan prose mode "brief chat" agent |

Keduanya berpola identik: `buildAssistantMessages(...)` → `chatText(messages, {temperature:0.4})`
→ `answer: string | null` → `answer ?? FALLBACK`, dengan credit reserve/refund.

**Keluar (tetap native, TIDAK diubah):**

- `src/lib/server/enrich-alternatives.ts` (`chatJSON`) — output schema
  `{items:[{type,name,description,keyFeatures,pros,cons}]}` terkunci urutan
  `type`. Ini **JSON terstruktur, bukan prose**; agent-lab F1 mengembalikan
  prose (+sitasi), bukan JSON arbitrer. Tetap pakai `chatJSON` sampai agent-lab
  mendukung structured output (F2+).
- `src/app/api/v1/projects/[id]/agent/route.ts` `chatJSON` @ ~290 (ekstraksi
  action floorplan) — tetap native.
- `chatWithTools` (agentic tool loop) — tetap native (tool-calling di Non-Goals
  agent-lab F1).
- **Santrenize** — ditunda; adaptive RAG-nya (understand→retrieve→LLM-rerank→
  CRAG gate→escalation→selfcheck→confidence) lebih canggih dari agent-lab F1,
  migrasi = downgrade. Lihat §9.

## 3a. Prasyarat: enhancement agent-lab (repo tampil.dev) — WAJIB

Sebelum baruma dialihkan, agent-lab harus mencapai parity thinking-mode. Perubahan
kecil di repo tampil.dev (`agent-lab/`), diuji + deploy ulang lebih dulu:

1. **`app/models.py` `LLMConfig`**: tambah field opsional
   `thinking: Literal["enabled","disabled"] | None = None`. Validator:
   `thinking` hanya boleh untuk provider yang berbasis DeepSeek (provider
   `deepseek`, atau `custom` yang `base_url`-nya mengandung `deepseek.com`);
   selain itu → 422 (jangan diam-diam abaikan, biar config salah ketahuan).
2. **`app/upstreams.py` `llm_chat`**: terima parameter `thinking: str | None`.
   Bila terisi, tambahkan `{"thinking": {"type": thinking}}` ke payload
   (format DeepSeek). **Retry-on-empty-content**: bila respons 2xx tapi
   `content` kosong (thinking menghabiskan budget — `finish_reason:"length"`),
   ulang SEKALI dengan `thinking:"disabled"`. Ini meniru safety `chatText`
   baruma; tanpa ini thinking-mode bisa mengembalikan jawaban kosong.
   Retry 5xx/timeout yang sudah ada tetap.
3. **`app/pipeline.py`**: teruskan `llm_cfg.thinking` ke `upstreams.llm_chat`.
4. **Tests** (real-DB harness + respx): thinking diteruskan bila diset; empty
   content + thinking → retry dengan thinking off lalu sukses; provider non-deepseek
   + thinking → 422 di layer model.
5. **Deploy ulang** agent-lab ke tampil-platform (rsync + restart) sebelum
   provisioning agent baruma-assistant memakai `thinking:"enabled"`.

Tanpa §3a, baruma-assistant tidak bisa mencapai parity dan bar §0 gagal.

## 3. Arsitektur

Tambah 1 modul server-only: `src/lib/server/agent-lab.ts`. Modul ini
**meniru kontrak resilience `llm.ts`**: mengembalikan `null` pada SEMUA
kegagalan (config kosong, HTTP non-2xx, timeout, JSON rusak, `mode ≠ "answer"`),
supaya cabang fallback deterministik + refund credit yang sudah ada di kedua
route **tetap berlaku tanpa perubahan perilaku**.

```
Baruma route ──► agent-lab.ts (askAgentLab) ──HTTPS──► agentlab.tampil.dev
                      │  null pada gagal                 POST /v1/agents/{slug}/ask
                      ▼                                   X-API-Key: <AGENT_LAB_KEY>
              fallback deterministik + refund
              (kode existing, tak berubah)
```

## 4. Kontrak `agent-lab.ts`

```
export interface AgentLabContext { title: string; content: string }

export function agentLabEnabled(): boolean
  // true bila AGENT_LAB_KEY terisi (mirror llmEnabled()).

export async function askAgentLab(
  slug: string,
  args: { userId: string; text: string; contextBlocks?: AgentLabContext[] },
): Promise<string | null>
```

Perilaku `askAgentLab`:

- Baca `AGENT_LAB_URL` (default `https://agentlab.tampil.dev`) + `AGENT_LAB_KEY`.
  Jika key kosong → `null` (caller fallback), tidak melempar.
- POST `${base}/v1/agents/${slug}/ask` dengan header `X-API-Key`,
  body `{ user_id, text, context_blocks }`, `AbortSignal.timeout(60_000)`.
- Batas Pattern B (validasi agent-lab): ≤8 blok, total `len(title)+len(content)`
  ≤ 24000 char. `agent-lab.ts` memangkas/menggabung defensif SEBELUM kirim
  supaya tak pernah kena 422 karena overflow (blok dipangkas, bukan gagal).
- Parse respons `{ mode, answer, citations, conversation_id, used_context }`:
  - `mode === "answer"` → kembalikan `answer` (string).
  - `mode` `clarify`/`refuse` → **kembalikan `null`** (Baruma memperlakukan ini
    sebagai "LLM tak memberi jawaban langsung" → fallback graceful yang sama
    seperti `chatText` null hari ini). Rasional: perilaku user-facing Baruma
    saat ini biner (ada jawaban / fallback); tak ada UI untuk alur clarify.
    (Catatan: bisa dievaluasi lagi di F2 kalau Baruma mau memanfaatkan clarify.)
  - HTTP non-2xx / timeout / JSON rusak → `null`.
- **Tidak pernah melempar** (semua dibungkus try/catch internal), meniru
  `runChatCompletion` di `llm.ts`.
- Tidak me-log PII: hanya status, slug, latency (bukan isi prompt/jawaban).

## 5. Migrasi call-site (mapping)

Prinsip: **ganti pemanggilan LLM, jangan ubah kerangka route** (auth, credit
gate, refund, bentuk respons `ok({ answer })`). System prompt yang sekarang
di-embed `buildAssistantMessages` **pindah ke config agent di backoffice**;
"notes" yang tadinya disuntikkan ke prompt menjadi `context_blocks`.

### 5a. `brief/assistant/route.ts`

Sekarang:
```
const messages = buildAssistantMessages(brief, question, history, standardsNote)
answer = await chatText(messages, { temperature: 0.4 })
```
Menjadi:
```
const contextBlocks = buildAssistantContextBlocks({ brief, history, standardsNote })
answer = await askAgentLab(SLUG_BRIEF_ASSISTANT, { userId, text: question, contextBlocks })
```
Cabang `answer === null` → refund + `FALLBACK` **tetap persis**. Cabang
`catch (e)` → refund → throw **tetap persis**.

### 5b. `agent/route.ts` (mode "brief chat", ~line 189-194)

Sekarang:
```
const messages = buildAssistantMessages(brief, input.instruction, history,
  standardsNote, designKnowledgeNote, assetSuggestionsNote)
const answer = await chatText(messages, { temperature: 0.4 })
llmFailed = answer === null
reply = answer ?? BRIEF_FALLBACK
```
Menjadi:
```
const contextBlocks = buildAssistantContextBlocks({ brief, history,
  standardsNote, designKnowledgeNote, assetSuggestionsNote })
const answer = await askAgentLab(SLUG_BRIEF_ASSISTANT, {
  userId, text: input.instruction, contextBlocks })
llmFailed = answer === null
reply = answer ?? BRIEF_FALLBACK
```
Mode lain di route ini (`floorplan`, deterministic handlers, `chatJSON` actions)
**tak disentuh**.

### 5c. Helper `buildAssistantContextBlocks`

Fungsi murni baru (di `src/lib/server/brief-assistant.ts` atau modul context
tersendiri) yang mengubah note-note opsional + ringkasan brief + history menjadi
array `AgentLabContext`:

- Blok "Brief" — ringkasan brief (summary/site/building/priorities/spaceProgram),
  format ringkas.
- Blok "Standar (audit)" — `standardsNote` bila ada.
- Blok "Design Knowledge" — `designKnowledgeNote` bila ada (khusus 5b).
- Blok "Saran Aset" — `assetSuggestionsNote` bila ada (khusus 5b).
- Blok "Percakapan sebelumnya" — `history` (≤20 turn) diringkas jadi teks; ini
  menjaga route tetap **stateless** (tak perlu plumbing `conversation_id`
  agent-lab di F1). Kelola history di sisi Baruma seperti sekarang.

Semua blok tunduk batas §4 (≤8 blok / ≤24000 char, dipangkas defensif).

## 6. Provisioning agent-lab (bukan demo throwaway)

- Buat 1 agent **`baruma-assistant`** di backoffice `/admin/agent-lab`:
  - `retrieval_config`: `{"type":"none"}` (Pattern B).
  - `llm_config` (PARITY dgn advisory baruma sekarang, §0):
    `{"provider":"deepseek","model":"deepseek-v4-flash","temperature":0.4,`
    `"max_tokens":4096,"thinking":"enabled"}`. `thinking:"enabled"` butuh §3a
    sudah live. (Opsi upgrade trivial: ganti model ke `deepseek-v4-pro` = lebih
    pintar, cukup edit config di backoffice — tapi baseline = parity flash.)
  - `system_prompt`: dipindah dari `buildAssistantMessages` **verbatim** (persona
    asisten desain interior Baruma + protokol jawab-dari-konteks). Jangan
    disederhanakan — reproduksi persis biar tak menurunkan kualitas.
  - `behavior_config`: `max_history_turns` 0 (history dikirim Baruma via context
    block, bukan via conversation store agent-lab).
- Terbitkan **1 API key produk `baruma`** scoped ke `["baruma-assistant"]`,
  simpan plaintext ke env prod Baruma (`AGENT_LAB_KEY`) + `.env.local` dev.
- Satu agent dipakai kedua call-site (YAGNI) — bisa dipecah jadi 2 persona nanti
  bila perlu.

## 7. Konfigurasi / Env

Tambah ke `.env.example` + env prod Baruma:
```
AGENT_LAB_URL=https://agentlab.tampil.dev
AGENT_LAB_KEY=alk_...          # dari modal reveal backoffice, scoped baruma-assistant
```
`LLM_*` lama **tetap ada** (dipakai `enrich-alternatives` + `chatJSON`/tools).

## 8. Error handling & resilience (WAJIB dijaga)

- Nol regresi user-facing: bila agent-lab mati/lambat/klarifikasi →
  `askAgentLab` → `null` → route memakai `FALLBACK`/`BRIEF_FALLBACK` +
  **refund credit** persis seperti perilaku `chatText` null hari ini.
- Timeout 60s (sinkron; route ini interaktif). Enrichment yang 90s tetap native.
- Tidak melempar dari `agent-lab.ts` → route `catch` hanya menangani error
  non-LLM (auth/DB), sama seperti sekarang.

## 9. Santrenize (ditunda — catatan readiness)

Tidak ada perubahan kode di santrenize round ini. RAG adaptif santrenize
(`apps/api/internal/rag/`) dipertahankan. Integrasi agent-lab untuk santrenize
menunggu: (a) use-case Q&A baru yang tak bersaing dgn RAG utama, ATAU (b) agent-lab
F2 yang sudah punya rerank.strategy=llm + understand/reformulate + eskalasi +
field `confidence` (lihat spec agent-lab §Pola C). Catatan ini cukup didokumentasikan;
tidak ada deliverable kode santrenize di plan.

## 10. Testing

- **Unit `agent-lab.ts`** (vitest + mock fetch): sukses `mode:answer` → string;
  `mode:clarify`/`refuse` → null; HTTP 5xx → null; timeout/abort → null; JSON
  rusak → null; key kosong → null tanpa fetch; context_blocks overflow → dipangkas
  ≤ batas sebelum kirim (assert body terkirim).
- **Route `brief/assistant`** — adaptasi test yang ada (`route.test.ts`): mock
  `askAgentLab` (ganti mock `chatText`): sukses → jawaban agent-lab; null →
  200 dgn `FALLBACK` + **refund dipanggil**; throw non-LLM → `handleError`.
- **Route `agent`** — adaptasi test yang ada: mode "brief chat" sukses/null →
  reply/`BRIEF_FALLBACK`, `llmFailed` benar; mode floorplan/chatJSON tak berubah.
- **Helper `buildAssistantContextBlocks`** — unit: memetakan note→blok, urutan,
  pemangkasan batas, history diringkas.
- Semua lewat `vitest run`; tak boleh menurunkan coverage cabang refund/fallback
  yang sudah ada.

### 10a. Parity / "tidak lebih bodoh" — HARD GATE (real, bukan unit)

Baruma unggulan → wajib dibuktikan **nyata**, bukan cuma unit test dengan mock.

1. **agent-lab thinking passthrough terbukti live**: setelah §3a deploy, panggil
   `/v1/agents/baruma-assistant/ask` (thinking enabled) dengan pertanyaan
   advisory yang secara historis memicu reasoning panjang; verifikasi jawaban
   **tidak kosong** dan koheren (retry empty-content bekerja). Bandingkan dgn
   `thinking:"disabled"` untuk memastikan field benar-benar diteruskan.
2. **A/B parity set**: siapkan ≥5 pertanyaan advisory nyata (mis. "apakah desain
   saya sudah sesuai standar?", "kenapa dapur saya sempit?", pertanyaan multi-turn
   dgn history). Jalankan tiap pertanyaan lewat DUA jalur dengan konteks identik:
   (a) `chatText` baruma sekarang (flash + thinking), (b) `askAgentLab` →
   baruma-assistant. Bandingkan: agent-lab **setara atau lebih baik** (grounded
   ke context_blocks, tak halusinasi, tak kosong, tak kehilangan detail standar/
   knowledge/aset yang jalur lama sertakan). Rekam hasil di laporan.
3. **Regression fallback nyata**: kosongkan `AGENT_LAB_KEY` (atau matikan
   sementara) → pastikan route balik ke `FALLBACK`/`BRIEF_FALLBACK` + refund,
   nol 500. Lalu pulihkan.
4. **E2E route hidup**: hit endpoint `brief/assistant` & `agent` Baruma yang
   sudah dialihkan (via dev server terautentikasi atau staging) dengan proyek
   nyata → jawaban muncul, kredit benar (charge saat sukses, refund saat gagal).

Gate ini **wajib lulus** sebelum integrasi dianggap selesai; hasil A/B direkam.

## 11. Rollout & risiko

- Perubahan additive + pengalihan 2 call-site; `LLM_*` lama tetap sebagai jalur
  untuk path non-prose → risiko rendah.
- Kill-switch alami: kosongkan `AGENT_LAB_KEY` → `agentLabEnabled()` false →
  jalur prose otomatis balik ke fallback deterministik (tanpa LLM). Untuk balik
  penuh ke DeepSeek langsung: revert 2 call-site (kecil).
- Deploy Baruma lewat pipeline normalnya (branch → review → merge → deploy).
  Tidak menyentuh droplet agent-lab.

## Definition of Done

1. **(agent-lab, §3a)** `LLMConfig.thinking` + passthrough `llm_chat` +
   retry-on-empty-content dibuat, di-test (real-DB harness + respx), agent-lab
   **deploy ulang** & thinking terbukti live.
2. `agent-lab.ts` + `buildAssistantContextBlocks` dibuat, unit-tested (null-safe
   di semua kegagalan).
3. 2 call-site `chatText` prose dialihkan ke `askAgentLab`; refund/fallback utuh.
4. `enrich-alternatives`, `chatJSON` action, tool-calling **tak berubah**.
5. Agent `baruma-assistant` (flash + temp 0.4 + thinking enabled = parity) + key
   produk terbit; env prod + `.env.example` update.
6. Suite `vitest run` (baruma) + `pytest` (agent-lab) hijau; cabang refund/fallback
   tetap ter-cover.
7. **§10a parity hard gate LULUS** — A/B nyata direkam, agent-lab setara/lebih
   baik dari jalur lama, thinking live, fallback nyata teruji.
8. Santrenize: catatan readiness saja, nol perubahan kode.
