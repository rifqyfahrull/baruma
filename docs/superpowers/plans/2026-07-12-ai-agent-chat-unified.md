# Unified AI Agent Chat — Implementation Plan

**Date:** 2026-07-12  
**Status:** Implemented locally  
**Goal:** satu percakapan AI yang persisten per proyek, tersedia di seluruh workspace, dan dapat menangani Brief, Denah, serta Interior melalui satu UI dan satu orchestrator server tanpa mengganti action engine yang sudah aman.

**Implementation result:** backend dan frontend sudah dipindahkan ke alur unified: migration 0016, kontrak message paired-turn/idempotency, canonical `/agent` endpoint, routing Brief/Denah/Interior, spend/refund kredit idempoten, data hooks/mock unified, `ProjectAgentShell` global, atomic apply, dan migrasi entry point Brief/Editor/Preview/Interior.

**Verified gates:** `rtk tsc`, `rtk vitest run` (1632 pass), `rtk proxy pnpm exec next build`, dan critical Playwright flow (21 pass) hijau. Full `rtk playwright test` dijalankan ulang tetapi menggantung lebih dari 10 menit tanpa failure output dan harus dihentikan; coverage E2E baru/terdampak tetap dijalankan lewat critical flow dan unified-agent spec.

## 1. Outcome yang diinginkan

User melihat satu **AI Agent** di semua halaman proyek. Riwayat tidak hilang saat reload atau pindah tab. User tidak perlu memahami perbedaan “Asisten Brief”, “Asisten Denah”, dan “Asisten Interior”; sistem memilih kapabilitas yang tepat berdasarkan halaman aktif, isi perintah, dan konteks proyek.

Perubahan geometri/furnitur tetap memakai pola aman yang sudah ada:

1. AI hanya mengusulkan action terstruktur.
2. Server melakukan parsing, sanitasi, simulasi, dan validasi.
3. User menekan **Terapkan**.
4. Action dijalankan melalui Zustand store yang undo-aware.
5. Autosave menyimpan hasil ke backend.

## 2. Kondisi sekarang

### Yang sudah bisa dipakai ulang

- `assistant_messages` sudah menjadi satu thread berdasarkan `project_id` untuk mode `floorplan` dan `interior`.
- `EditorAssistantPanel` sudah merender pesan persisten, proposal action, status applied/dismissed, serta memakai shared TanStack Query key.
- `editor-assistant` route sudah memiliki auth, ownership check, credit/refund, audit deterministik, handler deterministik, LLM fallback, sanitizer, dan self-correction loop.
- `applyFloorplanActions` dan `applyInteriorActions` sudah menerapkan action lewat store yang mendukung undo/redo.
- Brief assistant sudah grounded pada `Brief` dan hasil audit, tetapi riwayatnya masih `useState` di browser.

### Fragmentasi yang harus dihapus

1. `BriefAssistant` memakai endpoint dan state lokal sendiri; percakapannya hilang saat navigasi.
2. `EditorAssistantPanel` masih membutuhkan `mode` dari halaman, sehingga user secara konsep berinteraksi dengan agent berbeda.
3. `InteriorInspector` masih memiliki kartu “Mock assistant” yang langsung memutasi store dan tidak masuk thread.
4. Panel AI dirender beberapa kali di page-level; tidak ada satu host yang bertahan selama navigasi antarhalaman proyek.
5. Scene hanya dapat dibuat dari store client yang sedang terhidrasi. Agent global tidak aman jika membuka action dari halaman lain atau store masih memuat proyek sebelumnya.

## 3. Keputusan arsitektur

### 3.1 Satu thread, beberapa kapabilitas

Tetap gunakan **satu thread per `projectId`**. Setiap turn menyimpan:

- `surface`: halaman asal, misalnya `brief`, `editor`, `preview-3d`, `rab`, atau `drawings`.
- `mode`: kapabilitas yang dipilih orchestrator: `brief`, `floorplan`, atau `interior`.
- `turn_id`: memasangkan pesan user dan jawaban agent.
- `client_request_id`: mencegah double-submit membuat dua turn atau membelanjakan kredit dua kali.
- `request_state`: lifecycle request user (`pending | completed | failed`) agar reload dapat membedakan turn yang masih berjalan dari turn yang terputus.

`status` tetap khusus lifecycle proposal action (`proposed | applied | dismissed`) agar migrasi tidak mencampur status request dan status tool call.

### 3.2 Satu UI di project layout

Tambahkan Client Component `ProjectAgentShell` ke `src/app/app/projects/[projectId]/layout.tsx`. Layout tetap Server Component; hanya shell interaktifnya yang client-side. Ini sesuai konvensi Next.js 16 untuk shared UI di layout tanpa memindahkan seluruh layout menjadi Client Component.

Shell menyediakan:

- tombol **AI Agent** di header dan launcher mobile;
- satu Sheet/panel kanan yang bertahan saat pindah halaman anak;
- thread, composer, context chip (`Auto`, `Brief`, `Denah`, `Interior`), proposal action, dan error/retry state;
- draft injection dari audit card atau fitur “Tanya AI” melalui store UI kecil, bukan prop drilling antarhalaman.

Panel AI lama di Editor/Preview menjadi trigger untuk membuka shell global, lalu dihapus setelah parity terverifikasi. Kartu mock di Interior Inspector dihapus.

### 3.3 Orchestrator, bukan satu prompt raksasa

Jangan gabungkan seluruh schema Brief + 35 action Denah + action Interior ke satu prompt besar. Tambahkan orchestrator tipis yang memilih pipeline yang sudah ada:

```text
ProjectAgentShell
  │ POST {surface, requestedMode, instruction, liveScene?, clientRequestId}
  ▼
project-agent route
  ├── auth + ownership + idempotency
  ├── load project context (brief/layout/interior)
  ├── route intent
  │     ├── brief      → advisory Q&A + audit grounding
  │     ├── floorplan  → deterministic handler / tools / self-correction
  │     └── interior   → interior action prompt + sanitizer
  ├── credit gate hanya bila benar-benar memanggil LLM
  └── append paired messages ke unified thread
```

Routing order:

1. Context chip eksplisit dari user menang.
2. Audit/standards intent memakai jalur deterministik dan gratis.
3. Keyword action yang confidence-nya tinggi memilih Denah atau Interior.
4. Jika ambigu, gunakan surface aktif sebagai default.
5. Jika tetap ambigu, agent bertanya klarifikasi tanpa menghasilkan action; jangan menebak domain.

### 3.4 Live scene dengan fallback persisted

Ekstrak builder scene menjadi fungsi murni:

- `floorplanSceneFromLayout(layout, site, selection?)`
- `interiorSceneFromSaved(layout, savedInterior, selection?)`

Wrapper client yang sekarang (`buildFloorplanScene`, `buildInteriorScene`) tetap ada dan memanggil builder murni dengan state live. Server memakai builder yang sama terhadap payload database.

Prioritas context:

```text
live scene valid untuk projectId + versionId aktif
  └── jika tidak ada/invalid → persisted layout/interior dari DB
       └── jika belum tersedia → Q&A saja atau minta user membuat data dahulu
```

Proposal yang dibuat saat store target belum terhidrasi tidak langsung dapat diterapkan. UI menampilkan **Buka Denah untuk menerapkan** atau **Buka Interior untuk menerapkan**. Setelah navigasi dan hydration selesai, proposal yang sama baru mengaktifkan tombol Terapkan.

## 4. Perubahan data

### Task 1 — Migration 0016 dan kontrak message

**Files:**

- `db/migrations/0016_unified_agent_chat.sql`
- `src/lib/assistant/actions.ts`
- `src/lib/server/repo/assistant.ts`
- `src/lib/server/repo/assistant.test.ts`

**Perubahan:**

1. Tambahkan `surface text`, `turn_id text`, `client_request_id text`, `request_state text`, dan `processing_started_at timestamptz` nullable untuk kompatibilitas row lama.
2. Backfill row lama: `surface = mode`; `turn_id = id` bila tidak dapat dipasangkan secara aman.
3. Tambahkan index `(project_id, created_at, id)` dan partial unique index `(project_id, client_request_id)` untuk pesan user yang mempunyai request id.
4. Tambahkan partial unique index pada credit ledger untuk kombinasi `(profile_id, reason, ref)` milik spend/refund Project Agent. `ref` untuk flow ini wajib berisi `clientRequestId`, bukan hanya `projectId`.
5. Perluas `AssistantMode` menjadi `brief | floorplan | interior`; tambahkan `AssistantSurface` terpisah.
6. Repo menyediakan `claimTurn`, `completeTurn`, `failTurn`, dan `findTurnByRequestId`; jangan menyebar query idempotency/lease ke route.

`claimTurn` harus atomik: request pertama membuat row `pending`; request paralel menerima `already_processing`; retry dengan request id yang sama hanya boleh mengambil alih lease yang sudah melewati timeout. Ini mencegah dua LLM call berjalan bersamaan.

**Tests:** mapping legacy row, paired turn, duplicate request id, concurrent claim, stale lease reclaim, chronological ordering, status action tidak mengubah turn lain, ownership tetap dilakukan di route.

## 5. Refactor context dan pipeline server

### Task 2 — Pure scene builders

**Files:**

- `src/lib/assistant/scene.ts` (baru)
- `src/lib/assistant/apply.ts`
- `src/lib/assistant/scene.test.ts` (baru)

**Perubahan:** pindahkan serialisasi layout/interior dari Zustand ke fungsi murni. `apply.ts` hanya menjadi adapter store + executor action.

**Tests:** malformed JSONB, layout tanpa site, semua lantai ikut, opening invalid dibuang, electrical/water/sanitation defensif, interior tanpa room match, stale project/version ditolak client adapter.

### Task 3 — Extract reusable agent runners

**Files:**

- `src/lib/server/project-agent.ts` (baru)
- `src/lib/server/brief-assistant.ts`
- `src/lib/server/editor-assistant.ts`
- `src/lib/server/repo/credits.ts`
- test kolokasi masing-masing

**Perubahan:**

- Ekstrak `runBriefTurn`, `runFloorplanTurn`, dan `runInteriorTurn` dari route handlers.
- Runner menerima context tervalidasi dan mengembalikan `{ reply, actions, labels, usedLlm, failed }` tanpa menulis DB atau membelanjakan kredit.
- Tambahkan `routeAgentIntent()` sebagai fungsi deterministik dan eksplisit.
- Tambahkan `spendCreditsOnce`/`refundCreditsOnce` berbasis `clientRequestId`; balance update dan ledger insert tetap satu transaksi.
- History builder membaca seluruh thread, tetapi memberi anotasi mode dan hanya memasukkan ringkasan action yang benar-benar `applied`.
- Batasi context berdasarkan jumlah turn dan ukuran karakter, bukan hanya jumlah row, agar prompt tidak membengkak karena action label panjang.

**Tests:** routing eksplisit, keyword Denah/Interior, surface fallback, ambiguity clarification, mixed-mode history, applied vs dismissed action, context truncation, prompt-injection-like request tidak dapat mengubah schema/tool policy.

### Task 4 — Canonical unified endpoint

**Files:**

- `src/app/api/v1/projects/[id]/agent/route.ts` (baru)
- `src/app/api/v1/projects/[id]/agent/[msgId]/route.ts` (baru atau delegasi helper bersama)
- existing brief/editor assistant routes sebagai compatibility wrapper selama rollout
- route tests

**Request:**

```ts
{
  surface: AssistantSurface
  requestedMode?: "auto" | AssistantMode
  instruction: string
  liveScene?: { mode: "floorplan" | "interior"; versionId: string; payload: unknown }
  clientRequestId: string
}
```

**Urutan transaksi logis:**

1. Auth + project ownership.
2. Parse Zod body dan validasi live scene terhadap project/version.
3. Claim turn secara atomik. Return hasil lama bila completed, return pending bila lease masih aktif, atau resume bila lease stale.
4. Load brief/layout/interior yang dibutuhkan saja setelah routing awal.
5. Jalankan deterministic free path bila cocok.
6. Reserve satu kredit secara idempoten tepat sebelum LLM call; refund sekali untuk throw, timeout, null, atau proposal gagal quality gate.
7. Simpan user + assistant message dengan `turn_id` yang sama.
8. Return assistant message dan metadata routing yang aman ditampilkan.

Compatibility wrapper tidak boleh memiliki implementasi credit/persistence sendiri. Ia hanya menerjemahkan request lama ke service yang sama, sehingga tidak ada dua sumber logika.

**Tests:** 401, ownership 404, invalid JSON/scene, duplicate dan concurrent request id, stale lease recovery, deterministic no-credit, idempotent spend/refund, insufficient credit tanpa row yatim, LLM refund, persisted-scene fallback, stale live scene, clarification path, action validation, compatibility endpoints.

## 6. Data layer dan state UI

### Task 5 — Satukan DataSource dan hooks

**Files:**

- `src/lib/data/source.ts`
- `src/lib/data/http.ts`
- `src/lib/data/index.ts`
- `src/lib/mock/index.ts`
- `src/lib/api/hooks.ts`
- `src/lib/api/query-keys.ts`

**Perubahan:**

- Ganti `askBriefAssistant` dan `sendAssistantMessage` dengan `sendProjectAgentMessage`.
- Pertahankan `listAssistantMessages` dan `setAssistantMessageStatus`, tetapi arahkan ke canonical `/agent` path.
- Mutation melakukan optimistic insert untuk user turn memakai `clientRequestId`, kemudian mengganti dengan row server; rollback jelas saat gagal.
- Mock memakai router dan shape response yang sama, bukan jawaban Brief dan Editor yang terpisah.
- Pastikan hanya satu request per shell yang pending; server idempotency tetap melindungi multi-tab/double-click.

**Tests:** optimistic success, rollback, duplicate response, shared cache lintas mount, status update, mock parity.

## 7. Unified UI

### Task 6 — ProjectAgentShell dan ProjectAgentPanel

**Files:**

- `src/components/assistant/project-agent-shell.tsx` (baru)
- `src/components/assistant/project-agent-panel.tsx` (refactor/rename dari panel lama)
- `src/stores/project-agent-ui-store.ts` (baru, UI-only)
- `src/stores/editor-store.ts` dan `src/stores/interior-store.ts` untuk atomic batch apply
- `src/app/app/projects/[projectId]/layout.tsx`
- `src/components/project/project-workspace-header.tsx`
- component tests

**Perilaku:**

- Shell dipasang sekali di project layout dan memeriksa `projectId` sebelum memakai scene dari store.
- Surface diturunkan dari pathname; user dapat override lewat context chip.
- Panel tetap terbuka dan input draft tetap ada ketika berpindah child route.
- Setiap message menunjukkan tag kapabilitas, bukan menciptakan thread terpisah.
- Tombol Terapkan aktif hanya bila action mode cocok, target store sudah terhidrasi untuk project/version yang sama, dan message masih `proposed`.
- Apply sukses baru menandai `applied`; bila tidak ada action yang benar-benar diterapkan, status tetap `proposed` dan UI menjelaskan penyebabnya.
- Terapkan proposal sebagai satu batch all-or-nothing. Tambahkan dry-run terhadap state live lalu satu store transaction/commit; satu proposal menghasilkan satu langkah Undo.
- Apply/dismiss menolak double-click dan menampilkan error yang dapat dicoba ulang.
- A11y: focus trap Sheet, aria-live untuk pending/error, keyboard submit, dan fokus kembali ke launcher saat ditutup.

### Task 7 — Hapus entry point lama tanpa kehilangan workflow

**Files:**

- `src/components/project/brief-assistant.tsx`
- `src/app/app/projects/[projectId]/brief/page.tsx`
- `src/app/app/projects/[projectId]/editor/page.tsx`
- `src/components/preview-3d/preview-3d-view.tsx`
- `src/components/preview-3d/preview-controls.tsx`
- `src/components/interior/interior-workspace.tsx`
- `src/components/assistant/design-audit-card.tsx` bila callback draft perlu disatukan

**Perubahan:**

- Brief page memakai tombol/inline CTA yang membuka shell global dengan context `Brief`.
- Tab Asisten Denah/Interior membuka shell yang sama atau dihapus setelah launcher/header terbukti discoverable.
- `DesignAuditCard` mengirim draft ke UI store agent, bukan prop sampai panel lokal.
- Hapus mock interior mutation card. Preset “Buat lebih lega” boleh menjadi suggested prompt, bukan mutasi tersembunyi.
- Bersihkan hook, type, dan endpoint lama hanya setelah e2e compatibility hijau.

## 8. Test coverage dan quality gates

### Coverage diagram

```text
USER FLOW                                      CODE PATH
Open project / navigate tabs                   Project layout keeps AgentShell mounted
  ├── open AI Agent                              ├── derive surface from pathname
  ├── send Brief question                        ├── route → brief runner → persisted reply
  ├── navigate to Editor                         ├── same query cache/thread
  ├── request floorplan edit                     ├── live scene → sanitize → proposal
  ├── apply proposal                             ├── dry-run batch → one commit/undo → applied
  ├── request Interior edit from Brief page      ├── persisted scene → proposal → CTA navigate
  ├── reload / multi-tab retry                   ├── request-id dedupe
  └── LLM timeout / no credit                    └── refund/error message/no orphan proposal
```

### Unit tests

- Scene serialization dan stale-project guards.
- Intent router seluruh cabang dan ambiguity.
- History truncation berdasarkan turn + karakter.
- Brief/floorplan/interior runner success, empty action, invalid action, timeout, dan refusal.
- Repo pairing/idempotency/status.
- Mock/HTTP DataSource contract parity.
- Atomic batch apply: semua action valid menghasilkan satu commit/Undo; satu action stale membatalkan seluruh batch.

### Route/integration tests

- Auth/ownership untuk GET/POST/PATCH.
- Credit spend/refund tepat sekali, termasuk duplicate, concurrent request, dan stale lease retry.
- Persisted fallback saat live store tidak ada.
- Live scene menang atas persisted scene hanya bila project/version cocok.
- Row lama migration tetap dapat dibaca.

### Playwright E2E

Tambahkan `e2e/unified-agent-chat.spec.ts`:

1. Kirim dari Brief, pindah ke Editor, pesan tetap terlihat.
2. Kirim action Denah, reload, proposal masih ada, Terapkan dan Undo bekerja.
3. Minta action Interior dari halaman non-Interior, CTA navigasi muncul, apply aktif setelah hydration.
4. Audit intent tidak mengurangi kredit.
5. Double-click/dua tab dengan request id sama hanya menghasilkan satu turn.
6. Mobile launcher, focus behavior, pending/error/retry.

### LLM contract eval

Tidak perlu live-model test di gate CI. Tambahkan fixture-based contract cases untuk:

- pertanyaan advisory yang tidak boleh menghasilkan action;
- permintaan Denah vs Interior yang mirip;
- prompt injection yang meminta melewati sanitizer atau langsung menerapkan perubahan;
- permintaan campuran yang harus diklarifikasi;
- output action invalid yang harus dibuang/refused.

### Gate akhir

```bash
rtk tsc
rtk vitest run
rtk next build
rtk playwright test e2e/unified-agent-chat.spec.ts
```

## 9. Failure modes

| Failure | Handling | Test | User sees |
|---|---|---|---|
| LLM timeout/null | refund, simpan jawaban failure yang recoverable atau tandai turn gagal | route test | pesan retry, bukan spinner abadi |
| Double submit/multi-tab | `client_request_id` idempotency | repo + route + e2e | satu turn saja |
| Store berasal dari proyek lain | project/version guard, fallback DB | unit + e2e | CTA load target, tidak menerapkan ke proyek salah |
| Proposal sudah stale setelah user mengedit | revalidate terhadap live scene sebelum apply | unit + component | minta generate ulang, status tetap proposed |
| Satu action dalam batch sudah stale | dry-run seluruh batch; batalkan semua bila satu gagal | store + component | minta generate ulang, tidak ada perubahan parsial |
| DB message berhasil, LLM gagal | paired `turn_id` dan explicit failed reply/recovery | route test | thread tetap konsisten |
| History terlalu besar | cap turn + character budget + applied summary | unit | respons tetap cepat |
| Legacy endpoint masih dipanggil | compatibility wrapper + telemetry/log lokal | route test | tidak ada perubahan UX |

**Keputusan P1:** action batch bersifat all-or-nothing pada level proposal. Simulasikan seluruh batch terhadap live state; jika satu action stale/invalid, jangan apply apa pun dan minta agent membuat proposal baru. Ini menjaga label “Diterapkan” tetap benar dan Undo tetap satu langkah konseptual.

## 10. Rollout

1. Deploy migration 0016 terlebih dahulu; kolom baru nullable sehingga app lama tetap jalan.
2. Deploy backend orchestrator dan compatibility wrappers; UI lama masih aktif.
3. Unified agent aktif sebagai implementation path utama di UI. Feature flag allowlist tidak dipasang karena request eksekusi meminta langsung unified; rollout production tetap bisa menambahkan flag server-side bila dibutuhkan.
4. Jalankan smoke production dengan akun owner: Brief → Editor → Preview 3D → reload → apply.
5. Pantau error/credit metrics setelah deploy migration dan app.
6. Cleanup lanjutan dapat menghapus compatibility endpoint lama setelah traffic legacy nol.

Rollback cukup mematikan feature flag. Data baru tetap kompatibel karena reader lama mengabaikan kolom tambahan dan mode `brief` tidak ditampilkan oleh UI lama bila query difilter secara defensif.

## 11. Urutan implementasi dan parallelization

| Lane | Steps | Dependency |
|---|---|---|
| A — Contract/backend | Task 1 → Task 3 → Task 4 | sequential |
| B — Scene | Task 2 | dapat paralel dengan Task 1 setelah type shape disepakati |
| C — Client data/UI | Task 5 → Task 6 → Task 7 | menunggu contract Task 1 dan endpoint Task 4 |
| D — Verification | unit/integration → E2E → rollout | menunggu A+B+C |

Task 1 dan Task 2 dapat berjalan paralel. Setelah keduanya bergabung, Task 3/4 dan fondasi UI Task 6 dapat dikerjakan paralel dengan koordinasi pada `actions.ts`. Task 7 harus terakhir agar tidak memutus workflow lama sebelum shell baru lolos parity.

## 12. NOT in scope

- Streaming token/SSE; lakukan setelah unified flow stabil.
- Banyak conversation/thread per project.
- Voice input, image input, atau attachment.
- Agent yang langsung menyimpan perubahan tanpa konfirmasi user.
- Mutasi Brief terstruktur; fase ini Brief tetap advisory Q&A.
- RAB/Drawings mutation tools; halaman tersebut boleh memberi konteks dan membuka chat, tetapi belum menghasilkan action domain baru.
- Vector database atau long-term memory lintas proyek.
- Mengganti provider/model LLM.

## 13. Acceptance criteria

- Hanya ada satu UI AI Agent dan satu thread per proyek.
- Thread yang sama terlihat dari Brief, Editor, Preview 3D/Interior, RAB, Drawings, dan Review.
- Riwayat bertahan setelah reload dan navigasi.
- Brief, Denah, dan Interior melewati satu endpoint/orchestrator serta satu aturan credit/refund.
- Audit deterministik tetap gratis.
- Semua perubahan tetap berupa proposal yang perlu konfirmasi dan dapat di-undo.
- Satu proposal diterapkan atomik dan menghasilkan satu langkah Undo.
- Agent tidak pernah menerapkan action ke project/version/store yang salah atau stale.
- Double-submit tidak menggandakan turn atau pemakaian kredit.
- Legacy data `assistant_messages` tetap terbaca.
- `tsc`, seluruh Vitest, Next build, dan E2E unified-agent hijau.

## 14. Implementation checklist

- [x] T1 — Tambahkan migration/contract paired turn dan idempotency.
- [x] T2 — Ekstrak pure scene builders dan pertahankan adapter store.
- [x] T3 — Ekstrak runner reusable yang dipakai route baru dan intent router.
- [x] T4 — Buat canonical `/agent` API dan canonical status endpoint.
- [x] T5 — Satukan DataSource, hooks, cache, dan mock.
- [x] T6 — Pasang satu ProjectAgentShell di project layout.
- [x] T7 — Migrasikan Brief/Editor/Preview/Interior lalu hapus assistant lokal.
- [x] T8 — Lengkapi unit, route, capability parity, E2E terdampak, docs, dan catatan rollout.
