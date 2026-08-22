# Plan Implementasi — Integrasi AI Image Renderer

**Tanggal:** 22 Agustus 2026 · **Branch basis:** `emergent` · **Status:** draf untuk dieksekusi

Dokumen pendamping: `docs/riset-ai-renderer-2026-08.html` (riset provider, harga, arsitektur) — plan ini mengeksekusi rekomendasi riset itu ke dalam pola kode Baruma yang nyata.

---

## 0. Ringkasan keputusan (sudah final dari riset)

| Aspek | Keputusan |
|---|---|
| Mode Cepat (draft) | Google Nano Banana 2 (`gemini-3.1-flash-image`), ~$0.067/gambar, 2–5 dtk |
| Mode Presisi (HD) | FLUX.1 Depth via fal.ai (`queue.fal.run`), ~$0.03–0.05, pakai depth buffer eksak dari three.js |
| Video | **Di luar scope v1** (fase lanjutan; Kling via fal.ai) |
| Antrian | Tanpa worker/Redis — queue di sisi provider + row Postgres + webhook + polling klien + rekonsiliasi lazy |
| Harga kredit | Draft = 1 kredit, HD = 2 kredit, Paket Foto Realistik (4 sudut) = 6 kredit |
| Gating plan | Draft tersedia di Free (watermark, resolusi draft); HD/tanpa-watermark/paket = Pro+ |
| Prompt | Compiler deterministik dari scene graph; user pilih preset suasana, tidak menulis prompt; seed terkunci per proyek |

**Prinsip integrasi:** tidak ada primitive baru. Setiap komponen meniru pola yang sudah terbukti di repo:

| Kebutuhan | Pola yang ditiru |
|---|---|
| Job async + status | `asset_ingestion_jobs` (`db/migrations/0005_assets.sql:40`) + `createIngestionJob/getIngestionJob/updateIngestionJob` (`src/lib/server/repo/assets.ts:152–217`) |
| Reservasi kredit + refund | `spendCreditsOnce`/`refundCreditsOnce` (`src/lib/server/repo/credits.ts:106,186`) + refund dalam `after()` (`alternatives/generate/route.ts:154–169`) |
| Webhook masuk | `src/app/api/webhooks/payment/route.ts` (verifikasi signature = satu-satunya gate; selain itu telan ke 200; idempoten via atomic UPDATE) |
| Polling klien | `useIngestionJob` — TanStack Query `refetchInterval` self-terminating (`src/lib/api/hooks.ts:433–446`) |
| Abstraksi provider | `src/lib/billing/providers/{index,types,stripe}.ts` + kontrak "tidak pernah throw, kembalikan null" dari `openai-client.ts` |
| Simpan hasil | `src/lib/server/storage.ts` (aws4fetch, bucket privat) + proxy `assets/file/[...key]` |
| Capture 3D | `ScreenshotBridge` (`house-scene.tsx:32–47`) + `PHOTO_SHOTS` (`src/lib/three/photo-package.ts`) + orkestrasi settle `photo-package.tsx:49–97` |
| Kill switch & rollout | `src/lib/features.ts` (`FEATURE_<FLAG>` + `_ROLLOUT` + `stableRolloutBucket`) via endpoint `capabilities` |

> **Catatan Next.js 16**: sebelum menulis kode tiap fase, baca `node_modules/next/dist/docs/` untuk topik terkait — khususnya `01-app/03-api-reference/04-functions/after.md`, `route-handlers`, `maxDuration`. Konvensi repo: `ctx.params` adalah Promise yang harus di-`await`; middleware bernama `src/proxy.ts` dan **tidak** meng-cover `/api` (tiap route wajib otorisasi sendiri).

---

## Fase 1 — Skema DB + repo (fondasi server)

**Migration `db/migrations/0038_ai_renders.sql`** (lanjutkan penomoran; jalankan `pnpm migrate`):

```sql
CREATE TABLE IF NOT EXISTS render_jobs (
  id                  text PRIMARY KEY,            -- 'rnd-' || nanoid(12)
  owner_id            text NOT NULL REFERENCES profiles(id),
  project_id          text NOT NULL REFERENCES projects(id),
  status              text NOT NULL DEFAULT 'queued',  -- queued|submitted|processing|succeeded|failed
  mode                text NOT NULL,               -- 'cepat' | 'presisi'
  preset              text NOT NULL,               -- 'tropis-siang' | 'tropis-senja' | ...
  shot_id             text NOT NULL,               -- dari PHOTO_SHOTS ('iso-siang', dst.)
  seed                integer NOT NULL,
  credits_spent       integer NOT NULL,
  provider            text NOT NULL,               -- 'gemini' | 'fal' | 'mock'
  provider_request_id text,                        -- request id fal (untuk rekonsiliasi)
  params_hash         text NOT NULL,               -- hash(scene+kamera+preset+seed+mode) → cache
  input_keys          jsonb NOT NULL,              -- key S3 beauty/depth
  output_key          text,
  watermarked         boolean NOT NULL DEFAULT false,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS render_jobs_project_idx ON render_jobs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS render_jobs_owner_idx   ON render_jobs (owner_id);
-- cache lookup: render sukses dgn params sama → gratis
CREATE INDEX IF NOT EXISTS render_jobs_cache_idx   ON render_jobs (params_hash) WHERE status = 'succeeded';
-- trigger updated_at: pakai set_updated_at() yang sudah ada (lihat 0005_assets.sql)

-- Idempotensi kredit: index parsial 0016 hardcode reason agent —
-- reason baru WAJIB index parsialnya sendiri:
CREATE UNIQUE INDEX IF NOT EXISTS credits_ledger_ai_render_once
  ON credits_ledger (profile_id, reason, ref)
  WHERE reason IN ('ai_render','ai_render_refund') AND ref IS NOT NULL;
```

**Repo `src/lib/server/repo/renders.ts`** — tiru persis gaya `assets.ts` (interface `RenderJobRow` snake_case → mapper camelCase → `query()` dengan kolom eksplisit):

- `createRenderJob(id, ownerId, opts)` — INSERT + RETURNING.
- `getRenderJob(id, ownerId)` — **selalu owner-scoped** (anti-IDOR; 404 bukan 403).
- `updateRenderJob(id, patch)` — dynamic SET builder (gaya `projects.ts:114`); dukung guard `WHERE status = ANY($..)` untuk transisi atomik (idempotensi webhook, meniru webhook payment).
- `listRenderJobs(projectId, ownerId, limit)` — untuk galeri.
- `findCachedRender(ownerId, paramsHash)` — hit → tidak render ulang, tidak potong kredit.

`credits.ts`: perluas union reason di `spendCreditsOnce`/`refundCreditsOnce` agar menerima `'ai_render'`/`'ai_render_refund'` (saat ini di-hardcode ke reason agent).

**Acceptance:** migrate jalan bersih di DB kosong & DB terisi; unit test repo mengikuti pola test repo yang ada; `spendCreditsOnce('ai_render', ref)` idempoten (panggil 2× → 1 potongan).

---

## Fase 2 — Capture pass klien (beauty + depth)

Semua berjalan **hanya saat tombol ditekan** — `frameloop="demand"` dan aturan bundel (jangan menambah beban route awal) tetap terjaga.

**`src/lib/three/render-capture.ts`** (helper murni, dapat diunit-test tanpa DOM):
- `linearizeDepth(raw, near, far)` — kamera repo pakai `near:0.3, far:300`; hasil dibalik gaya MiDaS (dekat = terang) sesuai ekspektasi FLUX Depth.
- `depthToPngDataUrl(pixels, w, h)` — encode grayscale via canvas 2D.
- `renderParamsHash(input)` — hash stabil (FNV-1a sudah dipakai di `features.ts`) atas `{layoutRevision, kamera, preset, seed, mode}` → `params_hash`.

**Perluasan `ScreenshotBridge`** (`src/components/preview-3d/house-scene.tsx:32`): daftarkan closure kedua `captureRenderInputs()` ke preview-store yang:
1. render beauty pass normal → `toDataURL("image/png")` (wajib render ulang sesaat sebelum baca karena `preserveDrawingBuffer:false`);
2. set `scene.overrideMaterial = MeshDepthMaterial`, render ke `WebGLRenderTarget`, `readRenderTargetPixels`, linearisasi, encode; `finally` kembalikan `overrideMaterial = null`.

Grep menunjukkan belum ada pemakaian `WebGLRenderTarget`/`readRenderTargetPixels` di `src/` — ini area baru; uji manual di device tablet target (lihat `baruma-uji-visual-lokal`).

Orkestrasi multi-bidikan meniru `photo-package.tsx:49–97`: set `nightMode`/`realistic` per `PhotoShot`, `requestView`, settle `2×rAF + 400ms`, capture, restore state di `finally`.

**Acceptance:** dari proyek contoh, `captureRenderInputs()` menghasilkan pasangan PNG beauty+depth yang benar secara visual (depth halus, tanpa banding parah) di Chrome desktop & tablet.

---

## Fase 3 — Prompt compiler + preset (server, deterministik)

**`src/lib/server/ai-render/prompt.ts`**:
- `RENDER_PRESETS`: v1 = `tropis-siang`, `tropis-senja`, `skandinavia-siang`, `malam` — tiap preset = fragmen prompt tetap (pencahayaan, mood, lensa) yang dikurasi manual.
- `compilePrompt(sceneMeta, preset)` — deterministik dari metadata scene (daftar material grammar fasad, jenis atap, lanskap) + fragmen preset. **User tidak pernah menulis prompt bebas** (konsistensi + menghindari abuse prompt-injection ke provider).
- `projectSeed(projectId)` — derivasi integer stabil dari id proyek → gambar konsisten antar-render satu proyek.

**Acceptance:** unit test snapshot — input sama → prompt & seed byte-identik; tiap preset punya test.

---

## Fase 4 — Abstraksi provider `src/lib/server/ai-render/`

Struktur meniru `src/lib/billing/providers/`:

```
src/lib/server/ai-render/
  types.ts     — kontrak RenderProvider
  gemini.ts    — Mode Cepat (Nano Banana 2)
  fal.ts       — Mode Presisi (FLUX Depth, queue.fal.run)
  mock.ts      — untuk dev/E2E (kembalikan PNG placeholder)
  index.ts     — getRenderProvider(mode) + aiRenderEnabled()
```

Kontrak (`types.ts`) — dua bentuk karena karakter provider berbeda:

```ts
type SubmitResult = { kind: "async"; providerRequestId: string } // fal: masuk queue
                  | { kind: "done"; imageBytes: Uint8Array }     // gemini: sinkron 2–5 dtk
                  | null                                          // gagal — JANGAN throw (kontrak openai-client)
interface RenderProvider {
  submit(input: { prompt: string; seed: number; beautyUrl: string; depthUrl?: string; webhookUrl?: string }): Promise<SubmitResult>
  checkStatus?(providerRequestId: string): Promise<"processing" | { imageUrl: string } | "failed" | null> // fal saja — utk rekonsiliasi
}
```

- **Env** (ikuti idiom repo — baca `process.env` langsung + helper boolean, tanpa lib validasi): `GEMINI_API_KEY`, `FAL_KEY`, `AI_RENDER_PROVIDER` (override `mock` utk dev/E2E), `AI_RENDER_WEBHOOK_SECRET`. `aiRenderEnabled()` → route balas 503 bila belum dikonfigurasi (pola `upload-url/route.ts:29`).
- **fal.ai** butuh URL input yang bisa diakses: pakai `createSignedGetUrl()` atas key input di bucket privat (masa berlaku default cukup untuk antrean; jangan buat bucket publik).
- Timeout & retry: ikuti `openai-client.ts` (timeout tegas, tanpa retry berlebih; kegagalan → `null` → refund).

**Acceptance:** `mock.ts` dipakai test route; kontrak "null saat gagal" ter-test (mis. fetch reject → null, bukan throw).

---

## Fase 5 — API routes + siklus hidup job

### 5a. `POST /api/v1/projects/[id]/renders` — buat job

Urutan (gabungan pola `ingestion-jobs` + `alternatives/generate`):
1. `requireUser` → `getOwnedProject` (404 bila bukan milik) → `rateLimitGuard` (mis. 10/menit/user) → zod body: `{mode, preset, shotId, clientRequestId, inputKeys}`.
2. Feature flag `ai_render_v1` aktif? Plan gate: `mode === 'presisi'` → `requirePlanFeature(userId, "aiRenderHd")` (Fase 7).
3. **Cache**: `findCachedRender(params_hash)` hit → 200 dengan job lama, tanpa potong kredit.
4. **Kredit**: `spendCreditsOnce(userId, biaya, 'ai_render', clientRequestId)` — biaya dari konstanta `RENDER_CREDIT_COST = { cepat: 1, presisi: 2 }`. `insufficient` → `errCode(402, "insufficient_credits", ...)` (toast upgrade `plan-error.ts` bekerja gratis).
5. INSERT row `queued` → submit provider:
   - **fal (presisi)**: `submit()` dengan `webhookUrl`; sukses → status `submitted` + `provider_request_id`; `null` → `failed` + `refundCreditsOnce` + 502.
   - **gemini (cepat)**: balas 201 dulu, kerjakan di **`after()`** (pola `alternatives/generate`): panggil provider → unggah hasil ke S3 → `succeeded`; gagal → `failed` + `refundCreditsOnce`. Set `export const maxDuration = 120`.
6. Respons `ok({ jobId, status }, 201)`.

Input di-upload klien **sebelum** POST via signed PUT (pola `upload-url`): endpoint kecil `POST .../renders/upload-url` mengembalikan signed URL untuk key `renders/<userId>/<projectId>/<ts>-<safeName>.png`.

### 5b. `GET .../renders` & `GET .../renders/[renderId]`

- List utk galeri; detail utk polling → `{id, status, mode, preset, outputUrl(assetPublicUrl), errorMessage}`.
- **Rekonsiliasi lazy di GET detail** (repo eksplisit "tanpa cron"): bila `submitted/processing` dan `updated_at` > 3 menit → panggil `provider.checkStatus()`; selesai → finalize (unduh → S3 → `succeeded`); gagal/hilang → `failed` + refund. Job gemini yang mati karena restart pm2 (risiko residual yang sama dgn `alternatives/generate`) juga tertangkap di sini: `queued/processing` tanpa `provider_request_id` dan basi > 5 menit → `failed` + refund otomatis.

### 5c. `POST /api/webhooks/ai-render` — webhook fal

Salin struktur `webhooks/payment/route.ts` apa adanya:
- Verifikasi tanda tangan webhook fal (ED25519/JWKS sesuai dok fal; minimal fallback: secret di path/query dibandingkan `timingSafeEqual`) → gagal = 401. **Satu-satunya gate.**
- Selain itu telan semua ke 200 (hindari retry storm).
- Idempoten via atomic `UPDATE render_jobs SET status='succeeded', ... WHERE id=$1 AND status IN ('submitted','processing') RETURNING id` — kalah race dgn rekonsiliasi → no-op.
- Sukses: unduh hasil dari URL fal → PUT ke S3 (`renders/...`-key) → simpan `output_key`. Gagal dari provider: `failed` + `refundCreditsOnce`.

### 5d. Storage proxy

`src/app/api/v1/assets/file/[...key]/route.ts`: tambah prefix `renders/<user>/<project>/…` ke `ASSET_FILE_KEY_RE` (line 27), cabang `image/png|webp` di `assetContentType()` (line 31), dan izinkan MIME `image/png` + batas ukuran lebih kecil (≤ 20 MB) di jalur PUT. GET output render tetap owner-scoped.

**Acceptance:** siklus penuh dgn provider `mock`: POST → kredit terpotong 1× → job `succeeded` → PNG bisa diakses via proxy; simulasi gagal → refund 1× (idempoten); double-POST `clientRequestId` sama → 1 potongan; webhook signature salah → 401 tanpa efek.

---

## Fase 6 — Watermark & pasca-proses (server)

- Tambah dependensi **`sharp`** (satu-satunya dep native baru; verifikasi build di droplet DO/pm2 & CI).
- `src/lib/server/ai-render/postprocess.ts`: compose watermark "dibuat dengan Baruma + URL" (PNG aset repo) di sudut → hanya bila plan user = free (`watermarked=true` di row); konversi output ke WebP q~85 (hemat storage & bandwidth tablet).
- Watermark **wajib server-side** (client-side bisa di-bypass devtools — pelajaran dari gate ekspor yang diakui "bypassable" di `export-card.tsx`; untuk fitur berbayar ini tidak boleh terulang).

**Acceptance:** user free → file tersimpan sudah ber-watermark; Pro → bersih; snapshot test compose.

---

## Fase 7 — Entitlements, plan, harga

Satu perubahan tipe menjalar ke 4 tempat (temuan eksplorasi):
1. `src/types/index.ts:94` — `Entitlements` + `aiRenderHd: boolean`.
2. `src/lib/server/entitlements.ts` — union `requirePlanFeature` + `FALLBACK_ENTITLEMENTS.aiRenderHd = false`.
3. `src/lib/server/repo/plan-defaults.ts` — free: `false`; pro & studio: `true`.
4. `src/components/admin/plan-form.tsx` — checkbox admin.

Konstanta harga di satu tempat: `src/lib/server/ai-render/pricing.ts` → `RENDER_CREDIT_COST = { cepat: 1, presisi: 2, paketFoto: 6 }` — diekspor juga ke klien (nilai statis, aman) supaya tombol menampilkan biaya sebelum render.

Plan yang sudah ada (Free 10 / Pro 100 / Studio 500 kredit) **tidak berubah** — render menumpang pool kredit existing (analisa pricing 2026-08-22: worst case tetap margin positif).

---

## Fase 8 — UI klien

- **Hook** `src/lib/api/hooks.ts`: `useCreateRender()`, `useRenderJob(projectId, renderId)` — `refetchInterval` self-terminating persis `useIngestionJob` (berhenti di `succeeded|failed`, selain itu 2000 ms), `useProjectRenders(projectId)`.
- **`src/components/preview-3d/ai-render-dialog.tsx`**: pilih mode (Cepat/Presisi — Presisi terkunci di free, tampil disabled+upsell pola `export-card.tsx`, bukan disembunyikan), pilih preset suasana (thumbnail), pilih bidikan (reuse `PHOTO_SHOTS`), **biaya kredit tampil di tombol** ("Render — 1 kredit"), progress + hasil.
- Alur: capture input → PUT signed URL → POST job → poll → tampilkan hasil (`assetPublicUrl`), aksi unduh/bagikan.
- **Galeri render** per proyek (tab/panel di halaman preview atau exports) dari `useProjectRenders`.
- Kegagalan 402/403 → `handlePlanError` (sudah menangani `insufficient_credits` & `plan_feature_locked` → toast + tombol Upgrade).
- Indikator kredit sidebar (`credits-indicator.tsx`) sudah otomatis ter-update via invalidasi `useCurrentUser`.
- Entry point: tombol "Render AI ✨" di `view-toolbar.tsx` bersebelahan dgn Paket Foto.

**Acceptance:** happy path di tablet (target device): dari preview 3D → dialog → hasil dalam <15 dtk (cepat); free user melihat watermark & lock Presisi; kredit di sidebar berkurang benar.

---

## Fase 9 — Feature flag, testing, rollout

**Flag**: `ai_render_v1` di `src/lib/features.ts` (env `FEATURE_AI_RENDER_V1` + `_ROLLOUT`), dipancarkan via `GET /api/v1/projects/[id]/capabilities`, dibaca `use-project-capabilities.ts`. Semantik repo dipertahankan: flag menyembunyikan **UI pembuatan** saja; galeri render lama tetap tampil bila flag dimatikan (rollback tak menyembunyikan data). Kill switch = `FEATURE_AI_RENDER_V1=false`.

**Testing:**
- Unit: prompt compiler (snapshot), linearisasi depth, `renderParamsHash`, pricing, repo renders, postprocess watermark.
- Route test (pola test route existing): siklus mock lengkap termasuk idempotensi kredit, webhook 401, rekonsiliasi basi → refund.
- E2E Playwright: `AI_RENDER_PROVIDER=mock` → alur dialog penuh tanpa API eksternal. (Ingat jebakan dev: jangan `next build` saat `next dev` jalan; mock DB in-memory hilang saat HMR.)

**Rollout bertahap:**
1. Deploy dgn `_ROLLOUT=0` (hanya admin — endpoint capabilities sudah dukung `isAdmin`).
2. Uji internal dgn API key produksi, verifikasi HPP aktual per render vs proyeksi (Rp550–1.100 draft).
3. 25% → pantau error rate, p95 durasi, rasio refund → 100%.
4. Metrik yang dicatat sejak hari pertama (cukup dari `render_jobs` + `credits_ledger`): render/user, rasio gagal, rasio cache-hit, re-render rate (proksi ketidakpuasan), konversi free→pro sebelum/sesudah.

---

## Urutan pengerjaan & estimasi

Dependensi: F1 → (F3, F4, F7) → F5 → F6 → F8 → F9. F2 (capture klien) paralel dgn F1–F5, join di F8.

| Fase | Isi | Estimasi |
|---|---|---|
| 1 | Migration + repo + reason kredit | 0,5–1 hari |
| 2 | Capture beauty+depth klien | 1–2 hari (area WebGL baru) |
| 3 | Prompt compiler + preset | 0,5 hari |
| 4 | Provider gemini/fal/mock | 1–1,5 hari |
| 5 | Routes + webhook + rekonsiliasi + storage proxy | 1,5–2 hari |
| 6 | Watermark sharp + WebP | 0,5–1 hari |
| 7 | Entitlements + pricing | 0,5 hari |
| 8 | Dialog UI + galeri + hooks | 1,5–2 hari |
| 9 | Flag + test + rollout | 1 hari |
| **Total** | | **±8–11 hari kerja** |

## Risiko utama & mitigasi

| Risiko | Mitigasi |
|---|---|
| Restart pm2 memutus `after()` gemini → job menggantung | Rekonsiliasi lazy di GET: basi >5 mnt tanpa `provider_request_id` → `failed` + refund otomatis (F5b) |
| Signed GET URL input kedaluwarsa saat antrean fal panjang | Masa berlaku URL ≥ 1 jam; bila fal menolak, tandai gagal + refund |
| `sharp` gagal build di droplet | Verifikasi di CI deploy sebelum merge; fallback: tanpa konversi WebP (watermark tetap wajib) |
| Biaya API membengkak | Kredit dipotong **sebelum** panggil provider; rate limit; cache `params_hash`; kill switch flag |
| Kualitas depth buruk → hasil FLUX jelek | Frustum sudah rapat (0.3–300); uji visual F2 sebelum lanjut; fallback mode cepat (tanpa depth) selalu tersedia |
| Ekspektasi realisme berlebih | Label tetap di UI hasil: "visualisasi konsep, bukan gambar kerja" |
