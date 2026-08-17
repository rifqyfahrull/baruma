# Mayar Billing + Admin Backoffice — langganan manual-renew, enforcement penuh, pricing DB-driven

**Date:** 2026-07-05
**Status:** Design (menunggu approval user)
**Goal:** Pembayaran nyata via Mayar (langganan Pro/Studio manual-renew), menu admin backoffice (plans + transaksi + user), fitur plan benar-benar di-enforce di server, dan pricing list landing/billing digerakkan dari DB `plans` (satu sumber kebenaran yang bisa diatur admin).

## Keputusan user (locked, 2026-07-05)

1. **Model bayar:** langganan **manual-renew** — user bayar 1 periode via invoice/payment-link Mayar (VA/QRIS/e-wallet), aktivasi via webhook, menjelang habis diperlihatkan banner + tombol perpanjang. Tanpa tokenisasi/auto-debit.
2. **Admin gating:** kolom `profiles.role` (`user`|`admin`) + bootstrap `ADMIN_EMAILS` (env, server-only).
3. **Scope admin:** **plans + transaksi + user** (CRUD plan, monitor pembayaran, kelola user/role/kredit).
4. **Enforcement:** **penuh** — kredit AI, kuota proyek, upload GLB di-gate di server; export PDF di-gate client (lihat §Enforcement, kelemahan didokumentasikan).

## Kondisi kini (dipetakan 2026-07-05)

- Landing pricing `src/app/(marketing)/pricing/page.tsx` render **hardcoded** `PRICING_PLANS` (`src/lib/pricing.ts`, harga berupa string display); `/app/billing` idem + upgrade → `POST /api/checkout` yang **stub 501**. Webhook stub `src/app/api/webhooks/payment/route.ts` (verifySignature ala Xendit, TODO idempotency).
- DB sudah punya `plans` (seed 3 baris, `features` = array string), `subscriptions` (CHECK provider `midtrans|xendit|stripe` — **belum ada `mayar`**), `payment_events` (PK event-id), `credits_ledger` — **semuanya tanpa kode** (schema-only). Kredit **tidak pernah dipotong** di mana pun; `credits_ledger` tak tersentuh.
- Auth dua jalur: Auth.js session (`session.user.plan`, callbacks di `src/auth.config.ts`) untuk halaman; `/api/v1/*` pakai Bearer JWT `requireUser()` (`src/lib/server/auth-server.ts`, 58 call / 25 route). `/api/v1/me` memetakan `ProfileRow→User`.
- Titik gating alami: create project (`api/v1/projects/route.ts POST`), generate alternatif, 2 assistant (editor+brief), GLB (`assets/upload-url` + `ingestion-jobs`). **Export PDF client-only** (`src/lib/exports/*`, tanpa route server).
- Admin & role: greenfield. Nav: `src/lib/nav.ts` + `app-sidebar.tsx`. Migrasi: `db/migrations/0007_*.sql` via `scripts/migrate.mjs` (pola `IF NOT EXISTS` spt `0002_auth.sql`).
- Dev lokal = data source **mock klien** (tanpa `DATABASE_URL`); route `/api/v1` efektif mati lokal → strategi test khusus (lihat §Testing).

## Kontrak Mayar — IKUT PARENT tampil.dev (keputusan user 2026-07-05: Baruma = child, jangan berdiri sendiri)

Integrasi mem-**port pola provider tampil.dev** (`D:\Ngoding\expr\VibeCoding.id\tampil.dev\app\lib\billing\providers\{types,mayar,index}.ts` + `app/api/payment/webhook/route.ts`) — satu akun Mayar bersama utk semua produk VibeCoding:

- **Provider abstraction** (port ke `src/lib/billing/providers/`): `BillingProvider {name, createCheckout, parseWebhook}`; `PaymentOutcome = paid|failed|expired|cancelled|ignored`; `NormalizedWebhookEvent {providerOrderId, providerTransactionId?, amountIdr?, transactionStatusRaw, outcome}`.
- **createCheckout** (pola parent, adaptasi Baruma): `POST {MAYAR_API_BASE_URL}/hl/v1/invoice/create` (+ kandidat path fallback spt parent; `MAYAR_CREATE_INVOICE_PATH` opsional), Bearer `MAYAR_API_KEY`; body `{name, email, mobile: profile.phone ?? MAYAR_CUSTOMER_MOBILE_FALLBACK ?? "081234567890", redirectUrl: {APP_URL}/app/billing, description: "Baruma <PLAN> — 1 Bulan", expiredAt: +24 jam, items:[{quantity:1, rate: plans.price_idr, description}], extraData: {app:"Baruma", plan, user_id, external_order_id}}`; orderId `brm-<uid8>-<ts>`; ekstraksi respons defensif (checkoutUrl/orderId multi-alias) spt parent. **TANPA dialog phone** (ikut parent — fallback mobile).
- **parseWebhook** (pola parent, verbatim): verifikasi `MAYAR_WEBHOOK_TOKEN` via header `x-mayar-webhook-token`/`x-webhook-token`/`Authorization: Bearer` dgn `timingSafeEqual` → invalid = 401 tanpa proses; outcome mapping (`payment.received`→paid, `testing`→ignored, status paid/settlement/success→paid dst). **TANPA re-fetch** (ikut parent; token = verifikasi).
- **Webhook handler** (pola parent di route Baruma `POST /api/webhooks/payment` — URL SUDAH didaftarkan user): parse → 401 invalid; cari subscription by `provider_ref` → **tak dikenal = `{ok:true}` no-op** (akun Mayar bersama: event produk lain WAJIB di-ignore diam-diam); idempoten (hanya proses status `pending`; `payment_events` catat raw payload, `signature_ok`=token valid); `paid` → aktivasi (period end = +30 hari utk period `month` / +365 utk `year`) + `profiles.plan` + grant kredit; `failed|expired|cancelled` → tandai subscription; catch-all → **200** (cegah retry storm, spt parent).
- Env: `MAYAR_API_BASE_URL`, `MAYAR_API_KEY`, `MAYAR_WEBHOOK_TOKEN` (**sudah di GitHub Secrets**, nama = persis env parent), opsional `MAYAR_CREATE_INVOICE_PATH`, `MAYAR_CUSTOMER_MOBILE_FALLBACK`; + `ADMIN_EMAILS` (bootstrap admin — belum di-set). Wire ke `deploy.yml`.

## Model data (migrasi `0007_billing_admin.sql`, pola IF NOT EXISTS)

- `profiles`: + `role text not null default 'user'` (check `user|admin`), + `phone text` (Mayar wajib `mobile`).
- `plans`: + `tagline text`, + `featured boolean default false`, + `sort_order int default 0`, + `active boolean default true`, + `limits jsonb default '[]'` (daftar string "batasan" utk kartu pricing), + `entitlements jsonb default '{}'` — bentuk:
  ```json
  { "creditsPerPeriod": 10, "maxProjects": 1, "exportPdf": false, "glbUpload": false }
  ```
  Seed UPDATE menyamakan isi dgn `PRICING_PLANS` sekarang (tagline/featured/urutan/limits + entitlements: free {10,1,false,false}, pro {100,10,true,true}, studio {500,50,true,true} — angka final bisa diubah admin).
- `subscriptions`: perluas CHECK provider += `mayar` (drop+add constraint).
- `payment_events` & `credits_ledger`: dipakai apa adanya.

## Arsitektur

1. **Repo server baru** `src/lib/server/repo/plans.ts`, `subscriptions.ts`, `credits.ts` (+ perluasan `profiles.ts`: role/phone di SELECT/INSERT). **Fallback in-memory saat `DATABASE_URL` absen** (seed = nilai migrasi) supaya dev lokal/e2e jalan — pola eksplisit, satu util bersama.
2. **Plans jadi satu sumber:** `GET /api/v1/plans` (publik, `active` saja, sort) + landing pricing jadi server component yang membaca repo langsung; `/app/billing` & mock client dapat `getPlans` via data-source. `src/lib/pricing.ts` & `PLANS` di constants direduksi jadi tipe/format harga (tak ada lagi daftar hardcoded).
3. **Role di sesi & API:** `jwt()`/`session()` callbacks bawa `role`; `/api/v1/me` kembalikan `role`, `phone`, `entitlements` plan aktif + `subscription {status, currentPeriodEnd}`; helper `requireAdmin(request)` = `requireUser` + profil role `admin` **atau** email ∈ `ADMIN_EMAILS`.
4. **Checkout:** `/api/checkout` (session-guarded, sudah ada) → validasi plan aktif ≠ free → `provider.createCheckout()` (port parent; mobile fallback, TANPA dialog phone) → insert `subscriptions` `{status:'pending', provider:'mayar', provider_ref: providerOrderId}` → balikan `redirectUrl = checkoutUrl`. `MAYAR_API_KEY` absen → 503 pesan rapi (UX toast existing).
5. **Webhook & aktivasi:** route `/api/webhooks/payment` pola parent (lihat §Kontrak Mayar): token-verify → match `provider_ref` (tak dikenal → no-op 200, akun bersama) → idempoten pending-only + `payment_events` → `paid`: `subscriptions.status='active'` + `current_period_end` (+30/+365 hari), `profiles.plan = plan_id`, grant kredit (`credits_total = entitlements.creditsPerPeriod`, `credits_used = 0`, ledger `period_grant`); `failed|expired|cancelled`: tandai status; catch-all 200.
6. **Expiry lazy (manual-renew):** helper dipanggil di `/api/v1/me`: bila `current_period_end < now()` → `status='expired'`, `profiles.plan='free'` + grant kredit free + ledger `downgrade`. Billing menampilkan banner "berakhir dalam X hari" + tombol perpanjang (checkout yang sama). Tanpa cron/email v1.
7. **Enforcement (server = sumber kebenaran):**
   - Helper `requirePlanFeature(userId, 'glbUpload')` & `spendCredits(userId, n, reason, refId)` (UPDATE atomik `credits_used+n<=credits_total`; gagal → 402 `insufficient_credits`; sukses → ledger entry).
   - Kuota proyek: POST projects — hitung proyek user vs `maxProjects` → 403 `plan_limit_projects`.
   - Kredit: generate alternatif (1), assistant editor (1), assistant brief (1) — dipotong SETELAH sukses memanggil LLM? Tidak — dipotong SEBELUM (reservasi sederhana); kegagalan LLM → refund entry. 
   - GLB: `upload-url` + `ingestion-jobs` → `glbUpload`.
   - **Export PDF: gate client-only** (tak ada route server; menambah render server di luar scope) — tombol export disabled + dialog upsell bila `!entitlements.exportPdf`; kelemahan (bypass via devtools) didokumentasikan & diterima v1.
   - Klien: error 402/403 ber-`code` → toast upsell + link `/app/billing`.
   - **Demo/mock user di-set plan `studio`** (showcase penuh; e2e existing tetap hijau).
8. **Admin backoffice `/app/admin`** (guard server-side di layout: session role admin, redirect kalau bukan; item nav muncul kondisional):
   - **Plans:** tabel + form edit per plan (nama, harga IDR, periode, tagline, featured, sort, active, features[], limits[], entitlements) — perubahan langsung menggerakkan landing + billing; buat plan baru & nonaktifkan.
   - **Transaksi:** read-only `subscriptions` (join profil+plan; status/periode/provider_ref) + `payment_events` terakhir (event, signature_ok, processed).
   - **Users:** daftar profil (email, plan, kredit, role), aksi: set role, set plan manual, adjust kredit (± dgn alasan → ledger `admin_adjust`).
   - Semua API admin (`/api/v1/admin/*`) via `requireAdmin`.

## Testing

- **Unit (vitest):** repo fallback memory; helper entitlement/spendCredits (atomik, insufficient, refund); provider port (token timingSafeEqual valid/invalid, outcome mapping, ekstraksi respons — port kasus test parent); checkout handler (fetch di-mock: sukses/tanpa-key); webhook (401 token salah, orderId asing → no-op 200, idempoten, paid → aktivasi+grant+ledger, failed → status); expiry lazy; requireAdmin (role vs ADMIN_EMAILS).
- **E2e (mock-mode lokal):** pricing landing render dari plans default (nama/harga/fitur/badge Populer); billing menampilkan plan & kartu dari sumber sama; admin: login demo dipromosikan via memory-fallback? — demo user mock ∈ `ADMIN_EMAILS` dev default agar alur admin (buka /app/admin, edit harga plan → landing berubah) teruji e2e; gating upsell state di UI (tombol export disabled utk plan tanpa exportPdf — pakai plan free buatan test di admin). Alur bayar Mayar TIDAK di-e2e-kan (external); tercakup unit.
- **Gate penuh:** tsc · vitest · build · Playwright FULL.

## Non-goals v1

Auto-debit/recurring token; email reminder; proration/upgrade mid-period (ganti plan = bayar penuh periode baru, langsung ganti); refund flow; multi-currency; pajak; kupon; export PDF server-side; audit-log admin lengkap (cukup ledger kredit).

## Risiko

- Akun Mayar bersama lintas produk → webhook Baruma menerima event produk lain: WAJIB no-op 200 utk provider_ref asing (pola parent); verifikasi token `timingSafeEqual` + idempotency pending-only.
- Dua jalur auth (session vs Bearer) → role dibaca dari DB di `requireAdmin` (selalu segar), session role hanya untuk tampil/redirect UI.
- Konsistensi landing: penggantian hardcoded→DB harus piksel-setara (seed = konten sekarang) — dijaga test render.
- Perubahan `User`/`me` menyentuh banyak konsumen → tipe diperluas opsional (backward-compatible).

## Sequencing (9 task SDD)

T1 migrasi+repo(+memory fallback) → T2 plans API + landing/billing DB-driven → T3 role di auth/me + requireAdmin → T4 Mayar client + checkout + phone → T5 webhook + aktivasi + expiry lazy → T6 enforcement server (kredit/kuota/GLB) + upsell klien → T7 gate export PDF client + demo→studio → T8 admin backoffice (plans/transaksi/users) → T9 e2e + gate penuh + review akhir + merge/push.
