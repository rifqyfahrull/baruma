# Baruma Real Backend on Central DB — Design

**Date:** 2026-06-21 · **Status:** Approved (owner chose "full backend to central"). Production-ready, e2e.

## Goal

Make Baruma genuinely DB-backed: replace the in-memory mock + demo auth with a real backend that implements the `DataSource` contract (`docs/API.md`) and real credential auth, all persisted in the central `baruma` Postgres (`tampil-db-01`, role `baruma_app`).

## Architecture

The backend runs **inside Baruma's Next.js app** as route handlers under **`/api/v1/*`** (avoids colliding with the existing `/api/auth/[...nextauth]`, `/api/checkout`, `/api/webhooks/payment`). One deployable; no separate service.

```
Browser → TanStack Query → src/lib/data (httpSource) → fetch {NEXT_PUBLIC_API_URL}/...  (= /api/v1)
NextAuth Credentials.authorize → POST {API_URL}/auth/login  (= /api/v1/auth/login)
  /api/v1/* route handlers → pg Pool → central baruma (100.99.142.119, baruma_app)
```

- `NEXT_PUBLIC_API_URL=https://baruma.tampil.dev/api/v1`, `API_URL=https://baruma.tampil.dev/api/v1`, `NEXT_PUBLIC_DATA_SOURCE=http`.
- `DATABASE_URL=postgres://baruma_app:<pw>@100.99.142.119:5432/baruma?sslmode=disable` (server-only).
- Connectivity: the baruma droplet must reach central over **tailnet** (it currently has NO tailscale — install + join, like santrenize; central is tailnet-only). [Prereq, see Plan Task 1.]

## Auth model (own credentials + JWT — no Supabase)

The canonical schema is Supabase-style (`profiles.id` = external auth sub, no password). There's no Supabase/GoTrue on central, so we self-host credentials (same approach as kasqurban de-Supabase):
- Migration `db/migrations/0002_auth.sql`: `ALTER TABLE profiles ADD COLUMN password_hash text;`
- `POST /api/v1/auth/register` `{email,password,name}` → create `profiles` row (id = `gen_random_uuid()::text`, plan `free`, credits 10), `password_hash` = **argon2** hash. Returns `{user, accessToken}`.
- `POST /api/v1/auth/login` `{email,password}` → verify argon2 → issue **JWT HS256** (`sub`=profiles.id, exp), secret `BARUMA_JWT_SECRET`. Returns `{ user:{id,name,email,plan}, accessToken }` (matches `docs/API.md` + `src/auth.ts`).
- All `/api/v1/*` data routes: read `Authorization: Bearer <jwt>` → verify → `userId`; reject 401 otherwise. **Remove the demo fallback** in `src/auth.ts` once `API_URL` is set (production = real auth only).

## Endpoint → storage mapping (all under `/api/v1`, Bearer-authed)

| Endpoint | Storage / logic |
| --- | --- |
| `GET /me` | `profiles` row for `userId` → `User` |
| `GET /projects` | `projects WHERE owner_id=userId` |
| `GET /projects/:id` | `projects` (owner-checked) or 404 |
| `POST /projects` (`CreateProjectInput`) | insert `projects` (+ `site` jsonb) + generate+insert `briefs.payload` (reuse `src/lib/mock` brief builder) → `{project, brief}` |
| `GET/PATCH /projects/:id/brief` | `briefs.payload` jsonb get / merge-patch |
| `POST /projects/:id/alternatives/generate` | reuse mock alternatives generator → upsert rows in `alternatives` |
| `GET /projects/:id/alternatives` | `alternatives` rows → `Alternative[]` |
| `POST /projects/:id/alternatives/:altId/select` | set `projects.current_version_id`/status → `Project` |
| `GET /projects/:id/rab?finishing=` | reuse `src/lib/mock/rab.ts` (compute from project/layout) |
| `GET/PUT /projects/:id/layout` | `design_layouts.payload` jsonb get / upsert |
| `GET /projects/:id/review` | assemble from `review_comments` + `review_checklist` + `resolved_warnings` (+ reuse `src/lib/mock/review.ts` for generated warnings) |
| `POST /projects/:id/review/comments` `{body}` | insert `review_comments` → return assembled `Review` |
| `PATCH …/comments/:cid/toggle` | flip `review_comments.resolved` |
| `PATCH …/review/checklist` `{role,status}` | upsert `review_checklist` |
| `PATCH …/review/warnings/:wid/toggle` | upsert/delete `resolved_warnings` |

Ownership: every project-scoped route verifies `projects.owner_id = userId` (403/404 otherwise). The mock generator modules (`src/lib/mock/{layout,rab,review,seed,index}.ts`) are pure → import server-side to keep generated artifacts identical to the demo.

## Files
- `db/migrations/0002_auth.sql`
- `src/lib/server/db.ts` (pg Pool to central, server-only), `src/lib/server/auth-server.ts` (argon2 + JWT sign/verify + `requireUser(req)`), `src/lib/server/repo/*.ts` (typed queries per entity).
- `src/app/api/v1/auth/{login,register}/route.ts`, `src/app/api/v1/me/route.ts`, `src/app/api/v1/projects/route.ts`, `src/app/api/v1/projects/[id]/route.ts`, `…/brief/route.ts`, `…/alternatives/route.ts`, `…/alternatives/generate/route.ts`, `…/alternatives/[altId]/select/route.ts`, `…/rab/route.ts`, `…/layout/route.ts`, `…/review/route.ts`, `…/review/comments/route.ts`, `…/review/comments/[cid]/toggle/route.ts`, `…/review/checklist/route.ts`, `…/review/warnings/[wid]/toggle/route.ts`.
- Modify `src/auth.ts` (drop demo fallback when `API_URL` set).

## Deps
`pg`, `@types/pg`, `argon2`, `jsonwebtoken` + `@types/jsonwebtoken` (or `jose` for edge-safety — use `jose` since middleware is edge; but route handlers are node, so `jsonwebtoken` is fine for issue/verify in routes; auth.config stays edge-safe — it doesn't verify tokens, only checks `auth?.user`).

## Testing
- Unit: argon2 hash/verify roundtrip; JWT sign/verify + reject tampered/expired; `requireUser` rejects missing/invalid Bearer. Repo query builders (mocked pg). Route tests (mock pg + auth): login wrong-password 401, register dup-email 409, a data route 401 without token + 200 with, ownership 404 for other users' project.
- e2e (live, after deploy): register a user → login → `GET /me` 200 → create a project → it persists in central (`SELECT FROM projects`) → reload returns it → a write reflects in central. Verify the app's UI flow works against central (not mock).

## Deploy / cutover
1. Install tailscale + swap on baruma-prod; join tailnet (central is tailnet-only).
2. Apply `0002_auth.sql` to central baruma.
3. scp updated source → droplet, `pnpm install` (pg/argon2/jose), rebuild.
4. Set droplet `.env.local`: `DATABASE_URL`, `BARUMA_JWT_SECRET`, `API_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_DATA_SOURCE=http` (drop the mock). pm2 restart.
5. e2e as above.

## Out of scope (v1)
Payment provider wiring (checkout/webhook stay scaffold), OAuth providers, AI-real generation (generators stay deterministic mock logic), realtime.
