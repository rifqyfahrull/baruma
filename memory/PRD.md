# Baruma — PRD / Working Memory

## What Baruma is
Fullstack SaaS (Next.js 16 App Router + React 19 + TS, Postgres via `pg`) that
turns a simple brief into a measurable house concept: brief → layout
alternatives → 2D plan editor → 3D preview → RAB/BOQ → contractor pack. Market:
Indonesia (IDR, PBG/IMB legal context). Data layer switches mock ⇄ HTTP.

Honest positioning: "concept-to-estimate cepat + jalur validasi profesional",
NOT permit-ready drawings (PBG/IMB need SKA-stamped engineer/architect docs).

## Stack (kept per user)
Next 16.2.9, React 19.2.4, Tailwind 4 + shadcn, Zod 4, Vitest 4/Playwright.
Auth = custom JWT (jose HS256 + argon2) + Supabase SSO (unified in requireUser).
Billing = Stripe (single provider). AI = OpenAI SDK via OPENAI_BASE_URL
(narrative enrichment only; cost/area/readiness deterministic). Storage = S3/R2
(aws4fetch). Exports: PDF/Excel real; DXF/IFC gated as unsupported (no CAD lib).

## Session log

### 2026-06 — Analysis validation + fast/safe hardening
- **Validated user's "Deep Audit" against real code.** Verdict: 3 findings
  valid (DXF/IFC fake ✓, bleeding-edge stack ✓, RAB ratio-based ✓); 2
  overstated (RLS gap — Supabase is auth-only, no client table access; credits
  dual-source — kept atomic via BEGIN/COMMIT); 1 outdated (treemap "no
  adjacency/circulation/doors/grid" is false — those modules exist & are
  tested; treemap is only the mock seed). Auth finding correct for docs, wrong
  for "security hole" (dual path is deliberate unified design). Webhook
  signature + idempotency, env-gitignore, Stripe provider = ALREADY done.
- **Doc cleanup (done):** README rewritten to real code (JWT+Supabase SSO not
  NextAuth; Stripe not Mayar; real env-var names). Removed committed logs
  (dev-server.log, wall-dump-out.txt, headed-watch.console.log) + gitignored.
  Fixed 2 mislabeling code comments (subscriptions.ts, seed.ts); kept accurate
  historical "replaces Mayar" references.
- **Ownership audit (done, PASS):** all `/api/v1/*` routes verified — see
  `docs/security-ownership-audit.md`. Project routes enforce requireUser +
  getOwnedProject (SQL owner_id); admin routes requireAdmin; public routes hold
  no tenant data. No gaps found.

## Backlog (prioritized)

### 2026-06 (cont. 3) — Generator activated + city IKK + AHSP calibration (ALL VERIFIED via real vitest + tsc)
- **Env now online**: pnpm 10.15.0 (Node 20; pnpm 11 needs Node 22, pnpm 9 rejects the
  allowBuilds workspace file). `pnpm install` OK, full vitest + `tsc --noEmit` runnable.
- **Generator ACTIVATED (Task 1, VERIFIED):** adjacency ordering wired into `packFloor`
  via a **never-regress** wrapper — `generateLayout` builds with `"adjacency"`, and if
  `analyzeRoomConnectivity().isolated.length > 0` falls back to `"program"` order (inner
  `buildLayout(project, brief, strategy)`). Clusters rooms when safe, never strands.
  Verified: layout.test.ts 15 + layout-ordering 4 + 101 dependent tests green.
- **City-level IKK (Task 2, VERIFIED):** `IKK_CITY_2024` override resolved BEFORE province
  in `resolveRegion`, seeded with documented high-cost Papua-highland kabupaten (Puncak,
  Intan Jaya, Puncak Jaya, Pegunungan Bintang, Nduga) + Kep. Mentawai — flagged `approx`
  (2025 basis, low confidence, ±28% band) pending the exact BPS 2024 kab/kota table.
  Extend the map to grow coverage. regional-pricing.test.ts 11 green.
- **AHSP calibration + effective dates (Task 3, VERIFIED):** `PRICE_BOOK_META`
  (v2024.1, effective 2024-07-01, AHSP SE Dirjen Bina Konstruksi 68/SE/Dk/2024) stamped
  into every RAB's assumptions; reconciliation table `docs/rab-price-book.md` (beton
  baseline = "terpasang" incl rebar+formwork, clarified vs AHSP beton-polos ~1.15jt/m³).
- Note: user provided a Postgres DATABASE_URL; these tasks are pure logic + unit tests so
  it was not needed/persisted. Use it in the app `.env` for runtime/e2e.



### 2026-06 (cont.) — RAB per-region + generator adjacency helper
- **RAB per-region (DONE, logic-verified offline):** new `src/lib/rab/regional-pricing.ts`
  — BPS IKK 2024 (38 provinsi, acuan Banjarmasin=100), resolver with province
  aliases + major-city→province inference + uncertainty bands. Anchored to DKI
  Jakarta (factor 1.0 = baseline prices). Wired into `generateRAB`
  (`src/lib/mock/rab.ts`): reads `project.city/province`, applies one auditable
  factor to every BOQ line via `toItem`, converts the 3 ratio finishing lines
  (lantai/plafon/cat) to explicit m²×unit-price, sets low/high band from IKK
  uncertainty, and cites provenance in `assumptions`. Test-safe vs existing
  `rab.test.ts` (sampleProject has no region → factor 1.0 → exact-IDR assertions
  intact; reconciliation/inequality hold). Tests: `regional-pricing.test.ts`.
  NOT yet run through TS/vitest (env offline, no node_modules) — validated via
  standalone node mirror; user should run `pnpm test src/lib/rab`.
- **Generator adjacency (FOUNDATIONAL, wiring deferred):** `orderUnitsByAdjacency`
  helper added + exported in `src/lib/mock/layout.ts` (+ `layout-ordering.test.ts`),
  node-mirror validated. NOT wired into `packFloor` — reordering affects the
  connectivity-guarded floors in `layout.test.ts` and I can't run that suite
  offline. To enable: swap `units`→`orderUnitsByAdjacency(units)` on the two
  marked lines in packFloor's treemap branch, then `pnpm test src/lib/mock/layout.test.ts`.


- **P1 — RAB accuracy:** per-region unit-price DB (AHSP/HSPK) + real BOQ per
  item, replacing ratio allocation (`alternatives/generate` base×perM2×factor).
  Mark uncertainty margins. (deferred; user wants trusted-source dataset built)
- **P1 — Layout generator:** upgrade seed from `squarifiedTreemap`
  (`src/lib/mock/layout.ts`) to constraint-based, wiring the existing
  adjacency/circulation/door/grid modules into generation. (deferred)
- **P2 — RLS:** add owner-based Row-Level Security if DB is Supabase-exposed.
- **P2 — MCP service token** for the public `mcp/tools` endpoint.
- **P2 — DXF/IFC:** invest in a real CAD/BIM writer OR keep clearly
  experimental/dropped from headline deliverables.

## Notes for future sessions
- Runtime testing against real Postgres needs `DATABASE_URL` (user chose
  backend+Postgres for demo — credentials still pending).
- Env vars: BARUMA_JWT_SECRET, DATABASE_URL, STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET, OPENAI_API_KEY/BASE_URL/MODEL, NEXT_PUBLIC_SUPABASE_*,
  NEXT_PUBLIC_SSO_ORIGIN, STORAGE_*, ADMIN_EMAILS, NEXT_PUBLIC_DATA_SOURCE.
