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
