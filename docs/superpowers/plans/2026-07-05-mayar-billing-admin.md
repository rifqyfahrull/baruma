# Mayar Billing + Admin Backoffice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Langganan Mayar manual-renew end-to-end (checkout→webhook→aktivasi→expiry lazy), enforcement plan penuh di server, pricing landing/billing digerakkan DB `plans`, dan admin backoffice (plans/transaksi/users) ber-role.

**Architecture:** Migrasi `0007` + repo server baru (plans/subscriptions/credits, in-memory fallback tanpa `DATABASE_URL`) jadi fondasi; `/api/checkout` & `/api/webhooks/payment` (stub yang sudah ada) diimplementasikan utk provider `mayar` dgn verifikasi re-fetch; gate helper (`requirePlanFeature`/`spendCredits`) disisipkan pada 6 route `requireUser` yang sudah dipetakan; `/app/admin` guard role server-side.

## Global Constraints

- Spec: [2026-07-05-mayar-billing-admin-design.md](../specs/2026-07-05-mayar-billing-admin-design.md) — keputusan user: manual-renew · role di profiles (+`ADMIN_EMAILS` bootstrap) · admin plans+transaksi+users · enforcement penuh (export PDF = client-gate, terdokumentasi).
- **IKUT PARENT tampil.dev (keputusan user)**: PORT provider abstraction dari `D:\Ngoding\expr\VibeCoding.id\tampil.dev\app\lib\billing\providers\{types.ts,mayar.ts,index.ts}` + pola webhook `app/app/api/payment/webhook/route.ts` + test `app/__tests__/lib/billing/providers/mayar.test.ts` — BACA file-file itu sebelum T4/T5. Env identik parent: `MAYAR_API_BASE_URL` (default `https://api.mayar.id`), `MAYAR_API_KEY`, `MAYAR_WEBHOOK_TOKEN` (+opsional `MAYAR_CREATE_INVOICE_PATH`, `MAYAR_CUSTOMER_MOBILE_FALLBACK`) — SUDAH di GitHub Secrets. Path create `hl/v1/invoice/create` + kandidat fallback; verifikasi webhook = token `timingSafeEqual` (header `x-mayar-webhook-token`/`x-webhook-token`/`Authorization: Bearer`), TANPA re-fetch, TANPA dialog phone (mobile = profile.phone ?? fallback). AKUN MAYAR BERSAMA lintas produk: webhook menerima event produk lain → provider_ref tak dikenal WAJIB no-op `{ok:true}`; orderId Baruma prefix `brm-`; `extraData.app="Baruma"`. Catch-all handler → 200 (anti retry-storm). Wire 3+2 env ke `deploy.yml` di T4.
- Entitlements JSONB: `{creditsPerPeriod:number, maxProjects:number, exportPdf:boolean, glbUpload:boolean}` — kunci TETAP ini di semua task.
- Error gating ber-`code`: `insufficient_credits` (402), `plan_limit_projects` (403), `plan_feature_locked` (403) — klien menampilkan toast upsell + link `/app/billing`.
- Semua tabel billing SUDAH ada (`0001_init.sql`); migrasi baru HANYA `0007_billing_admin.sql` (pola `IF NOT EXISTS`/`DO $$` spt `0002_auth.sql`); CHECK `subscriptions.provider` += `mayar`.
- Repo server baru WAJIB punya fallback in-memory saat `DATABASE_URL` absen (dev lokal/e2e mock-mode), seed = nilai migrasi. Jangan menyentuh perilaku data-source mock klien yang ada kecuali yang disebut task.
- Landing pricing HARUS piksel-setara pasca migrasi (seed konten = `PRICING_PLANS` kini) — KECUALI satu keputusan disengaja (review T2, dicatat di ledger): `formatPlanPrice(0)` = **"Gratis"**, bukan literal lama "Rp 0" (copy lebih baik utk marketing; bukan regresi). `/pricing` WAJIB `export const dynamic = "force-dynamic"` (selaras `/api/v1/plans`) — tanpa itu, edit harga admin T8 tak muncul live (halaman bisa ke-freeze static prerender). UI Indonesia; aria-label semua input/tombol baru; tanpa dep baru (fetch native utk Mayar).
- WAJIB dijaga: e2e existing tak dilemahkan; demo/mock user jadi plan `studio` (T7) supaya fitur showcase & e2e existing tetap hijau.
- Pelajaran: gate `npx next build` langsung; dev server bersih + login demo ulang pasca restart; jangan konkurenkan review vitest dgn gate; trailer implementer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## Task 1: Migrasi 0007 + repo billing (+memory fallback)

**Files:** Create `db/migrations/0007_billing_admin.sql`, `src/lib/server/repo/plans.ts` (+test), `src/lib/server/repo/subscriptions.ts` (+test), `src/lib/server/repo/credits.ts` (+test), `src/lib/server/repo/memory-fallback.ts` (util bersama kecil); Modify `src/lib/server/repo/profiles.ts` (+role/phone di `ProfileRow`, SELECT×2, INSERT), `src/types/index.ts` (`User` + `role?`, `phone?`; tipe `PlanRow`/`Entitlements`).
**Produces:** `getPlans(activeOnly)`, `getPlan(id)`, `upsertPlan(row)`, `setPlanActive(id,bool)`; `createPendingSubscription/activateByProviderRef/expireDue(profileId)`, `listSubscriptions(admin)`; `spendCredits(profileId,n,reason,refId)` (atomik, ledger), `grantPeriodCredits(profileId,total,reason)`, `adjustCredits(admin)`; semua berfungsi dgn DB maupun memory.
Migrasi: profiles `role`('user'|'admin' check)+`phone`; plans `tagline/featured/sort_order/active/limits/entitlements` + UPDATE seed 3 plan menyamai `src/lib/pricing.ts` kini (features/limits/tagline/featured) + entitlements (free `{10,1,false,false}`, pro `{100,10,true,true}`, studio `{500,50,true,true}`); subscriptions CHECK += `mayar`. Test: repo memory CRUD + spendCredits atomik/insufficient + seed konsisten. Commit `feat(billing): migrasi 0007 + repo plans/subscriptions/credits`.

## Task 2: Plans DB-driven — API publik + landing + billing

**Files:** Create `src/app/api/v1/plans/route.ts` (GET publik: active, sort, tanpa auth); Modify `src/app/(marketing)/pricing/page.tsx` (server component baca `getPlans` repo langsung), `src/app/app/billing/page.tsx` + `src/lib/data/*` (mock+http `getPlans`) + hook `usePlans`, `src/lib/pricing.ts` (sisakan formatter `formatPlanPrice(priceIdr,period)`; hapus daftar hardcoded), `src/lib/constants/index.ts` (`PLANS` label→derive/retire).
**Consumes:** repo T1. Landing piksel-setara (badge Populer=featured, urutan=sort_order, limits render ikon X). Billing cards dari `usePlans`. Test: RTL render pricing dari data uji (nama/harga "Rp 149rb" via formatter/fitur/limits/badge), billing cards; route GET 200 shape. Commit `feat(pricing): landing & billing digerakkan DB plans`.

## Task 3: Role di auth + `/me` diperluas + requireAdmin

**Files:** Modify `src/auth.ts` (authorize demo/login bawa role), `src/auth.config.ts` (jwt/session copy `role`), `src/app/api/v1/me/route.ts` (balikan `role`, `phone`, `entitlements` plan aktif via repo, `subscription {status,currentPeriodEnd}`), `src/lib/server/auth-server.ts` (+`requireAdmin(request)` = requireUser + profil `role==='admin'` ATAU email ∈ `ADMIN_EMAILS` env), `src/types/index.ts` (User fields opsional).
Login eksternal (`API_URL/auth/login`) tak dikontrol → role di sesi opsional; sumber kebenaran admin = `requireAdmin` (DB per-request). Test: requireAdmin (role admin / env allowlist / bukan → 403), me shape. Commit `feat(auth): role + entitlements di sesi & /me`.

## Task 4: Port provider Mayar parent + checkout

**Files:** BACA dulu parent: `D:\Ngoding\expr\VibeCoding.id\tampil.dev\app\lib\billing\providers\{types.ts,mayar.ts,index.ts}` + testnya. Create `src/lib/billing/providers/types.ts` (port verbatim, tipe `BillingPlan` = id plan Baruma string), `src/lib/billing/providers/mayar.ts` (port; adaptasi: harga dari `getPlan(planId).priceIdr` [BUKAN konstanta parent], `mobile = profile.phone ?? env MAYAR_CUSTOMER_MOBILE_FALLBACK ?? "081234567890"`, `redirectUrl = {NEXT_PUBLIC_APP_URL}/app/billing`, description/extraData `app:"Baruma"`, orderId `brm-<uid8>-<ts>`), `src/lib/billing/providers/index.ts` (registry `getBillingProvider()`), +test (port kasus parent: token invalid/valid, outcome mapping paid/testing/failed, ekstraksi respons multi-alias, create sukses/fetch-mock); Modify `.github/workflows/deploy.yml` (+env `MAYAR_API_BASE_URL/MAYAR_API_KEY/MAYAR_WEBHOOK_TOKEN`), `src/app/api/checkout/route.ts` (implement: plan valid+aktif+≠free → `provider.createCheckout({userId, email, fullName, plan})` → `createPendingSubscription({profileId, planId, provider:'mayar', providerRef: providerOrderId})` → `{redirectUrl: checkoutUrl}`; `MAYAR_API_KEY` absen → 503 `payment_not_configured`). TANPA dialog phone.
Test (fetch di-mock): sukses → pending row + redirectUrl; tanpa key → 503; rate = price_idr plan. Commit `feat(billing): port provider Mayar parent + checkout`.

## Task 5: Webhook pola parent + expiry lazy

**Files:** BACA dulu parent `app/app/api/payment/webhook/route.ts`. Modify `src/app/api/webhooks/payment/route.ts` (pola parent di atas repo Baruma T1): `provider.parseWebhook({payload, headers})` → invalid 401; `getSubscriptionByProviderRef(providerOrderId)` → **tak ada → `{ok:true}`** (akun bersama, event produk lain); insert `payment_events` (id event/orderId+status, `signature_ok:true`, payload raw; duplikat → 200 keluar); hanya proses subscription status `pending`; outcome `paid` → `activateSubscription({providerRef, currentPeriodEnd: +30 hari (period month) / +365 (year)})` + `setProfilePlan` + `grantPeriodCredits(entitlements.creditsPerPeriod,'period_grant')` + tandai processed; `failed|expired|cancelled` → `expireSubscription`/status; SELURUH handler try/catch → 200 (anti retry-storm, log error). Modify `/api/v1/me` (lazy `expireDue`: subscription active + `current_period_end < now()` → expired + plan free + grant kredit free + ledger `downgrade`), `src/app/app/billing/page.tsx` (banner "Langganan berakhir dalam X hari"/"telah berakhir" + tombol perpanjang → checkout sama).
Test: webhook token salah → 401; orderId tak dikenal → 200 tanpa efek; idempoten (2× event = 1 aktivasi, 1 grant); aktivasi set plan+kredit+ledger+period; outcome failed → status; expireDue → downgrade sekali. Commit `feat(billing): webhook Mayar pola parent + expiry lazy`.

## Task 6: Enforcement server (kredit + kuota + GLB) + upsell klien

**Files:** Create `src/lib/server/entitlements.ts` (+test: `getEntitlements(profileId)` [plan→entitlements, fallback free], `requirePlanFeature(profileId,key)` → throw 403 `plan_feature_locked`); Modify route: `api/v1/projects/route.ts` POST (hitung proyek vs `maxProjects` → 403 `plan_limit_projects`), `api/v1/projects/[id]/alternatives/generate/route.ts` + `.../editor/assistant/route.ts` + `.../brief/assistant/route.ts` (`spendCredits(1, reason, projectId)` SEBELUM panggil LLM; gagal LLM → refund entry `refund`), `api/v1/assets/upload-url/route.ts` + `api/v1/assets/ingestion-jobs/route.ts` (`requirePlanFeature('glbUpload')`); Modify klien pemanggil (hooks/panel terkait) menangani `code` 402/403 → toast upsell + link `/app/billing` (satu util `handlePlanError`).
Catatan: dev lokal mock tidak memanggil route ini — unit test server jadi jaring utama. Test per gate (limit tercapai/OK, insufficient, refund, feature locked). Commit `feat(billing): enforcement kredit/kuota/GLB`.

## Task 7: Gate export PDF (client) + demo plan studio

**Files:** Modify `src/app/app/projects/[projectId]/exports/page.tsx` (+ tombol export: bila `!user.entitlements.exportPdf` → disabled + `DialogUpsell` [alasan, link billing, aria]), `src/lib/mock/seed.ts` (demo user plan `studio` + creditsTotal sesuai; mock `me` bawa entitlements studio), mock data source (`getPlans` seed = 3 plan default). Komentar kode: gate client-only utk export = kelemahan yang diterima v1 (tak ada route server).
Test: RTL exports page kedua state; e2e existing exports tetap hijau (demo=studio). Commit `feat(billing): gate export PDF client + demo studio`.

## Task 8: Admin backoffice (/app/admin)

**Files:** Create `src/app/app/admin/layout.tsx` (guard server: session role admin ATAU email∈ADMIN_EMAILS → selain itu redirect `/app/dashboard`), `src/app/app/admin/page.tsx` (tab Plans/Transaksi/Users), komponen `src/components/admin/{plans-table,plan-form,transactions-table,users-table}.tsx`, route `src/app/api/v1/admin/plans/route.ts` (GET/PUT/POST), `.../admin/subscriptions/route.ts` (GET join profil+plan + payment_events terakhir), `.../admin/users/route.ts` (GET list, PATCH role/plan, POST adjust kredit ber-alasan → ledger `admin_adjust`) — semua `requireAdmin`; Modify `src/lib/nav.ts` + `src/components/layout/app-sidebar.tsx` (item "Admin" kondisional role dari sesi).
Plan form: semua kolom (nama, harga IDR number, periode, tagline, featured, sort, active, features[] & limits[] editor baris, 4 field entitlements) — aria-label lengkap. Test: RTL plan-form validasi & submit payload; route admin 403 non-admin (unit). Commit `feat(admin): backoffice plans/transaksi/users`.

## Task 9: E2E + gate penuh + review akhir

**Files:** Modify `e2e/` (+`billing-admin.spec.ts`): (1) landing `/pricing` render 3 plan dari sumber DB-driven (nama+harga+badge Populer); (2) `/app/billing` menampilkan plan aktif & kartu; (3) admin mock-mode: demo email ∈ `ADMIN_EMAILS` dev default → buka `/app/admin`, ubah harga plan Pro via form → kembali ke `/pricing` (SPA) → harga baru tampil; (4) non-admin tak melihat menu Admin. Existing e2e tak dilemahkan.
Gate penuh: `rtk tsc` · `npx vitest run` · `npx next build` (langsung) · `pnpm exec playwright test` FULL → hijau. Review akhir whole-branch (opus) → merge main + push. Dokumentasikan langkah user: isi `MAYAR_API_KEY`/`MAYAR_ENV`/`ADMIN_EMAILS` via `set-secrets.mjs` + `deploy.yml` env + daftar webhook di dashboard Mayar. Commit `test(e2e): billing + admin`.

---

## Self-Review

**Coverage:** spec§model-data→T1, §plans-satu-sumber→T2, §role→T3, §checkout→T4, §webhook/expiry→T5, §enforcement→T6-T7, §admin→T8, §testing→semua+T9. **Placeholder:** tidak ada — endpoint Mayar, bentuk entitlements, kode error, seed entitlements, guard points (6 route) dipatok; satu-satunya yang sengaja dicari implementer = endpoint GET invoice Mayar (docs). **Konsistensi tipe:** `Entitlements`/`PlanRow` didefinisikan T1 dan dipakai nama sama T2-T8; kode error konsisten T4-T6. **Risiko:** T2 kesetaraan visual landing (jaga test render + seed=konten kini); T5 idempotensi (PK event + processed); T6 menyentuh 6 route — per-route test; T8 permukaan admin luas — form ber-aria + guard dobel (layout + route).
