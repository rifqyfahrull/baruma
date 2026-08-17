# Baruma — API Ownership / Authz Audit

_Static audit of every `src/app/api/**/route.ts` — verifying consistent
authentication + resource-ownership enforcement. Date: 2026-06._

## Method
For each route handler we checked: (a) is the caller authenticated
(`requireUser` / `requireAdmin`), and (b) for resource-scoped routes, is the
resource filtered by the caller's ownership at the **query** level (not just
app logic).

## Foundations verified
- `getOwnedProject(id, ownerId)` → `SELECT ... FROM projects WHERE id = $1 AND owner_id = $2`.
- `updateProject(...)` → `UPDATE ... WHERE id = $... AND owner_id = $...`.
- `requireUser()` accepts a Baruma JWT (Bearer) **or** a Supabase SSO session,
  mapping both to a Baruma profile id. `requireAdmin()` re-fetches role from DB
  (session role is UI-only, never trusted for authz).
- `searchAssetsForAgent()` (the only asset query reachable from the public MCP
  endpoint) filters `WHERE ua.is_public = true` → no cross-tenant asset leak.

## Result: PASS — no ownership gaps

| Route group | Auth | Ownership | Verdict |
| --- | --- | --- | --- |
| `projects/[id]/**` (brief, layout, rab, interior, review, alternatives, agent, editor, slots, audit, capabilities) | `requireUser` | `getOwnedProject(id, userId)` (SQL `owner_id`) | ✅ consistent |
| `projects` (list/create) | `requireUser` | scoped to `userId` | ✅ |
| `me`, `checkout` | `requireUser` | self (`userId`) | ✅ |
| `assets/**` (upload-url, my-library, metadata, file, ingestion-jobs) | `requireUser` | scoped to `userId` | ✅ |
| `admin/**` (plans, subscriptions, templates, users, credits, phantom-login) | `requireAdmin` | admin-gated (DB role or SSO-verified allowlist) | ✅ |
| `webhooks/payment` | **signature (HMAC)** not `requireUser` | idempotent by atomic `WHERE status='pending'` | ✅ by design |
| `auth/login`, `auth/register` | public | rate-limited; register blocks admin-email squatting; constant-time verify anti-enumeration | ✅ by design |
| `plans`, `templates`, `templates/[slug]` | public | public catalog, no tenant data | ✅ by design |
| `mcp/manifest`, `mcp/tools` | public | stateless over request `scene`; asset search `is_public=true` only; rate-limited per-IP | ✅ by design (service-token = open product decision) |

## Anomalies investigated (all benign)
- `projects/[id]/agent/[msgId]/route.ts` — one-line `export { PATCH } from
  "../../editor/assistant/[msgId]/route"`; inherits that route's
  `requireUser` + `getOwnedProject` ownership check. No gap.
- `auth/register` — imports `adminEmailAllowlist` (grep false-positive for
  "admin"); handler is public self-signup with squat protection.
- `webhooks/payment` — comment "NOT protected by requireUser" caused a grep
  false-positive; correctly signature-gated.

## Residual hardening recommendations (defense-in-depth, not active gaps)
1. **RLS**: if the Postgres instance is a Supabase project reachable via
   anon/PostgREST key, add owner-based Row-Level Security on all `owner_id` /
   `profile_id` tables. Today all data access is server-side via `pg` with
   ownership filters, so this is belt-and-suspenders, not a live hole.
2. **MCP service token**: `mcp/tools` is intentionally public (per-IP rate
   limit only). If abuse becomes a concern, add a service token — currently an
   accepted open product decision.
