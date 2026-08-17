# Perbaikan Kecepatan, Keandalan & Keterbacaan Agent Denah — Design

**Tanggal:** 2026-07-26
**Status:** Disetujui (brainstorming) — siap ke writing-plans
**Repo:** Baruma (utama) + tampil.dev/agent-lab (provisioning config, kecil)
**Depends on:** integrasi agent-lab yang sudah live (`2026-07-21-agent-lab-integration-design.md`)

## 0. Masalah & bukti

Keluhan pengguna: agent Baruma (mode Denah) lambat, sering gagal karena validasi
tumpang-tindih, arsitektur multi-panggilan-LLM kurang optimal, dan pesan gagal
tidak informatif. Ditelusuri sampai ke kode — empat akar masalah konkret:

1. **Loop retry sekuensial 3x dengan prompt penuh.** `runFloorplanLoop`
   (`src/app/api/v1/projects/[id]/editor/assistant/route.ts:419-488`) memanggil
   `chatJSON` sampai `MAX_ATTEMPTS = 3` kali secara SEKUENSIAL. Tiap panggilan
   mengirim ULANG system prompt penuh (~150 baris katalog aksi + scene JSON +
   knowledge notes) dari `buildFloorplanMessages`
   (`src/lib/server/editor-assistant.ts:97-215`) — bukan cuma delta perbaikan.
2. **`thinking: enabled` dipakai di luar konteksnya.** Config agent-lab
   `baruma-assistant` (lihat `docs/superpowers/specs/2026-07-21-agent-lab-integration-design.md`
   §6) sengaja mengaktifkan DeepSeek reasoning mode untuk kualitas jawaban Q&A
   prosa. Tapi `src/lib/server/llm.ts` memakai SATU `AGENT_SLUG =
   "baruma-assistant"` untuk `chatText` (prosa) **maupun** `chatJSON`/
   `chatWithTools` (generate aksi JSON denah/interior) — jadi tiap panggilan
   generate-aksi ikut menanggung overhead reasoning tersembunyi yang bersaing
   dengan `max_tokens: 4096` melawan output JSON aktual, dikalikan sampai 3x
   oleh masalah #1.
3. **Solver deterministik yang sudah ada tidak dipakai di loop ini.**
   `src/lib/audit/reflow.ts` (`reflowFixes`) sudah menyelesaikan kelas masalah
   "ruang kurang ukuran, susutkan tetangga, besarkan ruang itu" secara
   algoritmik — menghormati standar SNI, ruang terkunci, dan obstacle sanitasi.
   Tapi loop koreksi `runFloorplanLoop` murni minta LLM menebak ulang koordinat
   x/y/width/depth dalam teks bebas (`buildRevisionMessage`,
   `editor-assistant.ts:1159-1167`) — solver yang sudah ada tidak pernah
   dipanggil di jalur ini.
4. **Pesan gagal akhir membocorkan detail internal.** Pesan fallback di
   `runFloorplanLoop` (baris 480-487) menyusun teks dari
   `findFloorplanViolations` (`editor-assistant.ts:1085-1156`) yang formatnya
   `"Nama" (x:.., y:.., WxH m) & "Nama2" (...) tumpang-tindih` — koordinat
   mentah ini dikirim APA ADANYA ke pengguna (persis seperti screenshot
   laporan), padahal format itu dirancang untuk feedback ke LLM, bukan untuk
   dibaca homeowner.
5. **Jalur tool-calling opsional tidak diverifikasi.** `runFloorplanToolLoop`
   (opt-in via `process.env.LLM_TOOLS === "1"`) ada di kedua route tapi
   `docs/ARCHITECTURE.md:303` mencatat "AI LLM_TOOLS opt-in belum sepenuhnya
   diverifikasi" — kemungkinan besar tak pernah aktif di produksi, jadi
   produksi SELALU jatuh ke jalur lambat #1.
6. **UI diam total selama proses.** Wrapper SSE di kedua route hanya mengirim
   `{"type":"ping"}` tiap 5 detik lalu satu `{"type":"result"}` di akhir — tidak
   ada progres bertahap, jadi 3x percobaan yang lambat terasa seperti layar
   beku bagi pengguna.

## 1. Tujuan & non-tujuan

**Tujuan:**
- Kurangi jumlah round-trip LLM sekuensial untuk kasus overlap dari sampai-3x
  menjadi paling banyak 2x (1 percobaan awal + maksimal 1 revisi), dengan
  perbaikan tumpang-tindih ringan diselesaikan deterministik di antaranya.
- Pisahkan config agent-lab supaya panggilan generate-aksi JSON tidak lagi
  menanggung overhead `thinking` yang ditujukan untuk jalur prosa.
- Perbaikan tumpang-tindih ringan (hasil usulan LLM sendiri saling
  bertabrakan) diselesaikan oleh solver geometris, bukan ditebak ulang oleh LLM.
- Pesan ke pengguna saat gagal total: bahasa natural + nama ruang + chip
  `needs_clarify` yang bisa diketuk — tanpa koordinat mentah.
- Progres bertahap terlihat di UI selama proses berjalan.

**Non-tujuan:**
- Tidak menyentuh mode Interior (sudah single-shot `chatJSON`, tanpa retry
  loop, tanpa konsep overlap geometris yang sama).
- Tidak menyentuh Santrenize atau produk lain yang memakai agent-lab.
- Tidak mengubah semantik spend/refund kredit (tetap: 1x charge per giliran
  pengguna, refund bila `llmFailed`, terlepas dari berapa banyak panggilan
  LLM internal yang terjadi).
- Tidak mengubah kontrak `CompleteRequest`/`AskRequest` agent-lab (provider,
  model, temperature, dll tetap milik config agent, bukan parameter request).

## 2. Scope (file yang tersentuh)

**Baruma:**
- `src/lib/server/editor-assistant.ts` — fungsi baru `reconcileOverlaps` (§4),
  fungsi baru `humanizeViolations` (§7), `buildRevisionMessage` disederhanakan.
- `src/app/api/v1/projects/[id]/editor/assistant/route.ts` — `runFloorplanLoop`
  dan `runFloorplanToolLoop` diganti satu fungsi `runFloorplanAgentPass`;
  wrapper SSE emit event `progress` baru.
- `src/app/api/v1/projects/[id]/agent/route.ts` — pemanggilan disesuaikan ke
  fungsi baru yang sama; wrapper SSE emit `progress`.
- `src/lib/server/llm.ts` — `AGENT_SLUG` dipecah jadi `PROSE_SLUG` +
  `ACTIONS_SLUG`.
- `src/lib/audit/reflow.ts` — tambah fungsi sibling `reconcileOverlappingRooms`
  (dipakai `reconcileOverlaps`), berbagi primitif (`meetsOwnStandard`,
  `shrinkAwayFrom`, `rectsIntersect`) yang sudah ada.
- `src/lib/data/http.ts` — `reqSSE` terima `onProgress` opsional.
- `src/components/assistant/project-agent-panel.tsx` (dan/atau
  `project-agent-shell.tsx`) — tampilkan status progres di bawah bubble
  pending.
- `src/lib/assistant/llm-tools.ts`, `FLOORPLAN_TOOLS` — **dihapus** bersama
  `runFloorplanToolLoop` (lihat §3, keputusan retire).

**tampil.dev/agent-lab (provisioning, bukan kode):**
- 1 agent baru di backoffice `/admin/agent-lab`: slug `baruma-floorplan-actions`
  (§5). Tidak ada perubahan kode Python — `LLMConfig`/`CompleteRequest` yang
  ada sudah cukup fleksibel (list `llm_configs`, field `thinking` per-config).

## 3. Arsitektur: satu pipeline deterministic-first

Bentuk sekarang (di KEDUA route, `editor/assistant` dan `agent`):

```
handleFloorplanInstruction (deterministic)
  ├─ cocok, tanpa feedback → pakai langsung
  └─ cocok tapi ada feedback → buang, lanjut ke LLM
       │
       ├─ jika LLM_TOOLS=1 (tak terverifikasi produksi): runFloorplanToolLoop
       │     (chatWithTools, sampai 4 ronde tool-call, TANPA retry-revisi bila overlap)
       │
       └─ else (jalur produksi nyata): runFloorplanLoop
             for attempt in 0..2:            # sampai 3x SEKUENSIAL
               chatJSON(prompt PENUH)         # slug baruma-assistant, thinking:enabled
               validasi overlap (pure)
               jika overlap → buildRevisionMessage (teks bebas) → attempt berikutnya
             semua gagal → dump koordinat mentah ke user
```

Bentuk baru — satu fungsi `runFloorplanAgentPass`, retire jalur tool-calling:

```
handleFloorplanInstruction (deterministic, TAK BERUBAH)
  ├─ cocok, tanpa feedback → pakai langsung
  └─ cocok tapi ada feedback → buang, lanjut ke pass di bawah

runFloorplanAgentPass(scene, instruction, ...):
  emit progress("Meminta usulan denah ke AI…")
  actions = chatJSON(prompt PENUH)            # slug baruma-floorplan-actions, thinking:disabled
  if actions kosong → return apa adanya (needs_clarify/reply, tak ada aksi)

  violations = findFloorplanActionFeedback(actions)   # PURE, TAK BERUBAH
  if violations kosong → return actions

  emit progress("Menyesuaikan tata letak agar tidak tumpang-tindih…")
  {fixedActions, stillBlocked} = reconcileOverlaps(scene, actions, violations)  # §4, PURE, deterministik
  revalidated = findFloorplanActionFeedback(fixedActions)
  if revalidated kosong → return fixedActions   # SELESAI tanpa LLM ke-2

  emit progress("Meminta AI merevisi sekali lagi…")
  actions2 = chatJSON(prompt + buildRevisionMessage(revalidated))  # HANYA 1x revisi, bukan 3x
  violations2 = findFloorplanActionFeedback(actions2)
  if violations2 kosong → return actions2

  # coba reconcile sekali lagi atas hasil revisi ke-2 (murah, tanpa LLM)
  {fixedActions2, stillBlocked2} = reconcileOverlaps(scene, actions2, violations2)
  if findFloorplanActionFeedback(fixedActions2) kosong → return fixedActions2

  emit progress("Belum berhasil menata otomatis")
  return humanizeViolations(stillBlocked2)   # §7 — clarify chips, BUKAN dump koordinat
```

Worst case pipeline LAMA: sampai 6 panggilan provider (3x attempt sekuensial ×
sampai 2x karena retry-on-empty-content saat `thinking` menghabiskan budget —
lihat §3a spec integrasi agent-lab). Worst case pipeline BARU: **2 panggilan
provider pasti** — `thinking` sudah `disabled` untuk slug aksi (§5), jadi
retry-on-empty-content itu sendiri tidak pernah terpicu; sisanya cuma 1
percobaan awal + maksimal 1 revisi, dengan solver deterministik murah (tanpa
network) di antaranya. `runFloorplanToolLoop`, `FLOORPLAN_TOOLS`,
`dispatchFloorplanTool`, dan env var `LLM_TOOLS` **dihapus** — jalur ini
diniatkan untuk hal yang sekarang ditangani lebih baik oleh reconciler
deterministik + revisi tunggal.

## 4. `reconcileOverlaps` — reconciler tumpang-tindih deterministik

Sibling dari `reflowFixes` (`lib/audit/reflow.ts`), bukan pengganti — beda
kasus: `reflowFixes` menangani "1 ruang di bawah standar, harus MEMBESAR";
fungsi baru ini menangani "2 ruang hasil usulan LLM SALING bertabrakan, harus
dipisah". Berbagi primitif yang sudah ada: `rectsIntersect`, `meetsOwnStandard`,
`shrinkAwayFrom`, `round2`.

```ts
// src/lib/audit/reflow.ts
export type OverlapReconcileResult = {
  actions: FloorplanAction[]        // updateRoom patches tambahan (bisa kosong)
  resolvedPairs: [string, string][] // pasangan roomId yang berhasil dipisah
  stillBlocked: [string, string][]  // pasangan yang TIDAK bisa diselesaikan aman
}

export function reconcileOverlappingRooms(
  scene: FloorplanScene,
  proposedRooms: FloorplanRoom[],   // hasil simulateFloorplanActions(actions, scene)
): OverlapReconcileResult
```

Algoritma per pasangan yang overlap (dari `findFloorplanViolations`, per
lantai):
1. Hitung strip irisan (sumbu x atau y, mana yang lebih kecil = "displacement
   termurah" — prinsip yang sama dengan `candidateMoves` di `reflowFixes`).
2. Coba geser/susutkan salah satu ruang menjauh sepanjang strip itu, dengan
   urutan preferensi murni geometris (tanpa NLP/pencocokan instruksi, agar
   fungsi ini tetap pure): ruang dengan slack TERBESAR di atas standar SNI-nya
   sendiri (`meetsOwnStandard` — makin jauh dari ambang minimum, makin aman
   disusutkan) dicoba digeser lebih dulu; ruang yang sudah pas-pasan di
   standarnya diprioritaskan untuk TIDAK disentuh.
3. Tiap kandidat hasil divalidasi `meetsOwnStandard` (standar SNI + minimum
   sisi 1,2 m) — kalau melanggar standar sendiri, batal, coba kandidat
   berikutnya (searah berlawanan, atau ruang lain di pasangan itu).
4. **Batas eksplisit — jangan diam-diam mengubah banyak:** hanya diterapkan
   bila displacement yang dibutuhkan ≤ 30% dari sisi terpendek ruang yang
   digeser (mis. ruang 3m tidak digeser >0,9m tanpa sepengetahuan user). Di
   luar itu → masuk `stillBlocked`, biar jalur revisi LLM/clarify yang
   menangani, bukan solver diam-diam membuat perubahan besar tak terduga.
5. Ruang terkunci (`locked`) dan strip yang beririsan objek sanitasi tidak
   pernah disentuh — sama seperti aturan `reflowFixes`.

Murni, sinkron, tidak menyentuh DB/LLM — mudah di-unit-test dengan skenario
dari screenshot (Kamar Mandi 1 vs Workspace vs Laundry).

## 5. Split slug agent-lab: `baruma-assistant` vs `baruma-floorplan-actions`

Provisioning baru (backoffice `/admin/agent-lab`, tidak ada perubahan kode
Python — `LLMConfig.thinking` dan `CompleteRequest` yang ada sudah cukup):

| Slug | Dipakai oleh | thinking | temperature | Tujuan |
|---|---|---|---|---|
| `baruma-assistant` (ada) | `chatText` (prosa Q&A brief/knowledge) | `enabled` | 0.4 | kualitas jawaban naratif |
| `baruma-floorplan-actions` (baru) | `chatJSON` (generate aksi denah & interior) | `disabled` | 0.2 | ikuti aturan/geometri presisi, bukan kreatif |

`src/lib/server/llm.ts` sebelum:
```ts
const AGENT_SLUG = "baruma-assistant"
// dipakai chatJSON, chatWithTools, chatText
```
Sesudah:
```ts
const PROSE_SLUG = "baruma-assistant"      // chatText
const ACTIONS_SLUG = "baruma-floorplan-actions"  // chatJSON
```
`chatWithTools` dihapus bersama retire-nya `runFloorplanToolLoop` (§3) — tidak
perlu slug ketiga.

`system_prompt` agent baru = **sama persis** dengan yang di-generate
`buildFloorplanMessages`/`buildInteriorMessages` hari ini akan tetap dikirim
per-request oleh Baruma (bukan dipindah ke config agent-lab, karena isinya
dinamis — scene JSON, knowledge notes, dsb., beda tiap request). Field
`system_prompt` di agent-lab untuk slug ini cukup diisi placeholder minimal
("Kamu asisten teknis Baruma; ikuti instruksi dari pesan system yang dikirim
per-request."), karena `run_complete`/`CompleteRequest` di agent-lab memang
menerima messages penuh dari caller (lihat `pipeline.py` `run_complete` —
tidak menggabungkan `agent_row["system_prompt"]` untuk endpoint `/complete`,
beda dengan `/ask`).

## 6. Progres bertahap via SSE (additive, non-breaking)

Server (kedua route) tambah 1 tipe event baru di stream yang sudah ada:
```
data: {"type":"progress","stage":"llm|reconcile|revise|done","message":"Menata ulang otomatis…"}
```
dikirim di titik yang ditandai `emit progress(...)` pada §3, sebelum event
`result` final.

Client `reqSSE` (`src/lib/data/http.ts:86-149`) sudah mem-parse `data:` baris
generik dan mengabaikan `type` yang tak dikenali (dulu `ping` diam-diam
diabaikan) — jadi ini aman ditambah tanpa breaking apa pun yang sudah
memanggilnya. Tambahkan parameter opsional:
```ts
async function reqSSE<T>(method, path, body?, onProgress?: (msg: string) => void): Promise<T>
```
`sendProjectAgentMessage`/`sendAssistantMessage` (`http.ts:180-184`) meneruskan
`onProgress` dari argumen opsional baru di `DataSource` interface. Panel
(`project-agent-panel.tsx`) simpan progress text terakhir di state lokal,
tampilkan sebagai baris kecil abu-abu di bawah bubble "sedang mengetik".

## 7. `humanizeViolations` — pesan gagal yang manusiawi

```ts
// src/lib/server/editor-assistant.ts
export function humanizeViolations(
  stillBlockedPairs: [string, string][],  // dari reconcileOverlaps, roomId pairs
  roomById: Map<string, FloorplanRoom>,
): { reply: string; needsClarify: [{ question: string; suggestions: string[] }] }
```
- Ambil nama ruang (bukan id) dari tiap pasangan `stillBlockedPairs` — TIDAK
  ada koordinat x/y/width/depth di output.
- `reply` contoh: *"Kamar Mandi 1 masih tumpang tindih dengan Workspace dan
  Laundry setelah saya coba rapikan otomatis."* (bukan dump
  `(x:4.85, y:9.17, 2.87×2.55m)`).
- `needsClarify` berisi chip nama ruang yang terlibat sebagai `suggestions`
  (pola yang SAMA dengan `clarificationReply` di `project-agent.ts:94-110`,
  dan yang sudah dirender `project-agent-panel.tsx:400-405` via
  `parseClarificationSteps`) — pengguna tinggal ketuk nama ruang, bukan
  mengetik ulang secara bebas.
- String feedback INTERNAL untuk LLM (`findFloorplanViolations`,
  `buildRevisionMessage`) **tidak berubah** — tetap mengandung koordinat,
  karena itu memang dikonsumsi model, bukan manusia. Hanya lapisan
  user-facing `reply` yang melalui transformasi ini.

## 8. Error handling & resilience (invarian yang wajib dijaga)

- Spend/refund kredit: TETAP 1x charge per giliran pengguna
  (`spendCredits`/`spendCreditsOnce`), refund bila `llmFailed`, terlepas dari
  berapa banyak sub-panggilan LLM internal (1 atau 2) terjadi di
  `runFloorplanAgentPass`. Tidak ada perubahan pada titik reserve/refund yang
  ada di kedua route.
- Bila `AGENT_LAB_KEY` kosong atau slug baru belum terprovisi → `chatJSON`
  kembali `null` seperti sekarang (kontrak resilience `completeAgentLab`,
  `agent-lab.ts:172-261`, tak berubah) → fallback `EDITOR_AGENT_FALLBACK`
  yang sudah ada.
- `reconcileOverlaps` dan `humanizeViolations` PURE & sinkron — tidak
  menambah titik kegagalan jaringan baru; kalaupun ada bug, hasilnya paling
  buruk `stillBlocked` penuh (perilaku setara hari ini), bukan crash.
- SSE `progress` event: kegagalan mengirim salah satu event progress tidak
  boleh menggagalkan permintaan — bungkus `controller.enqueue` untuk progress
  di try/catch terpisah dari alur utama (pola yang sama dengan `sendPing`
  yang sudah ada).

## 9. Testing

- **Unit `reconcileOverlappingRooms`** (`reflow.test.ts` atau baru): skenario
  screenshot (Kamar Mandi 1 vs Workspace vs Laundry) → verifikasi hasil bebas
  overlap DAN tetap comply standar; skenario displacement >30% → masuk
  `stillBlocked`, bukan dipaksa; ruang terkunci/sanitasi tak tersentuh.
- **Unit `humanizeViolations`**: input pasangan roomId → reply tanpa
  substring koordinat (`x:`, `y:`), `needsClarify.suggestions` berisi nama
  ruang yang benar.
- **Route test** (`route.test.ts` di kedua endpoint): mock `chatJSON` return
  actions yang overlap → assert `chatJSON` dipanggil **maksimal 2x** (spy
  count), assert reconciler dipanggil sebelum revisi ke-2; hapus test yang
  mengasumsikan `MAX_ATTEMPTS = 3`/jalur `LLM_TOOLS`.
- **`llm.test.ts`**: assert `chatJSON` POST ke
  `.../baruma-floorplan-actions/complete`; assert `chatText` POST ke
  `.../baruma-assistant/complete` (URL berbeda per slug).
- **SSE**: test `reqSSE` baru dengan mock stream berisi frame `progress` →
  `onProgress` terpanggil dengan message yang benar, `finalResult` tetap
  dari frame `result` (tak terganggu oleh frame progress di antaranya).
- **Manual/E2E**: reproduksi skenario persis dari screenshot laporan
  (rumah 1 lantai, 1 kamar mandi) di dev server terautentikasi → ukur latency
  sebelum/sesudah, verifikasi hasil akhir tidak overlap ATAU pesan clarify
  yang manusiawi (bukan dump koordinat).
- Semua lewat `vitest run`; tidak boleh menurunkan coverage cabang
  refund/fallback yang sudah ada.

## 10. Rollout & risiko

- Additive di sisi Baruma (fungsi baru + penggantian internal
  `runFloorplanLoop`/`runFloorplanToolLoop`) — API request/response bentuknya
  tidak berubah (masih `{message}` via SSE), jadi tidak ada migrasi klien lain.
- Slug agent-lab baru harus diprovisi & API key `AGENT_LAB_KEY` yang sama
  bisa dipakai (satu API key produk bisa di-scope ke multiple slug) —
  cek scoping saat provisioning, tambah `baruma-floorplan-actions` ke scope
  key yang ada di `/admin/agent-lab` bila perlu.
  Kill-switch: bila slug baru gagal (mis. belum terprovisi), `chatJSON`
  kembali `null` seperti mode "agent lab down" biasa — TIDAK ada regresi,
  hanya fallback ke `EDITOR_AGENT_FALLBACK`.
- Retire `LLM_TOOLS`/`runFloorplanToolLoop`/`FLOORPLAN_TOOLS`: karena
  dikonfirmasi tak terverifikasi di produksi (`ARCHITECTURE.md:303`), risiko
  regresi rendah — tapi catat di PR description sebagai perubahan yang
  disengaja, bukan taken-for-granted, untuk visibilitas review.
- Rollback: revert PR Baruma (perubahan additive/replace, bukan migrasi data)
  — slug lama `baruma-assistant` tetap ada & tak diubah, jadi rollback total
  tanpa efek samping di sisi agent-lab.

## Definition of Done

1. `runFloorplanAgentPass` menggantikan `runFloorplanLoop` +
   `runFloorplanToolLoop` di kedua route; `LLM_TOOLS`/`FLOORPLAN_TOOLS`/
   `dispatchFloorplanTool` dihapus.
2. `reconcileOverlappingRooms` (di `reflow.ts`) dibuat, unit-tested, dipanggil
   sebelum revisi LLM ke-2.
3. Slug `baruma-floorplan-actions` terprovisi di agent-lab (thinking
   disabled); `llm.ts` memakai `PROSE_SLUG`/`ACTIONS_SLUG` terpisah.
4. `humanizeViolations` dipakai untuk SEMUA pesan gagal user-facing terkait
   overlap; tidak ada lagi substring koordinat mentah di `reply` yang dikirim
   ke pengguna.
5. Event SSE `progress` dikirim dari kedua route; `reqSSE` + panel UI
   menampilkannya.
6. Worst-case panggilan `chatJSON` sekuensial untuk kasus overlap turun dari
   3x menjadi maksimal 2x, dibuktikan lewat spy count di test.
7. `vitest run` (Baruma) hijau; cabang refund/fallback yang ada tetap
   ter-cover.
8. Repro manual skenario screenshot: latency terukur turun, dan/atau pesan
   akhir manusiawi (tanpa koordinat) bila memang tak bisa diselesaikan
   otomatis.
