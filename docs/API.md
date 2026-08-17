# Baruma API contract

The frontend talks to an external backend through the `DataSource` interface
(`src/lib/data/source.ts`). Set `NEXT_PUBLIC_API_URL` (+ `NEXT_PUBLIC_DATA_SOURCE=http`)
to switch from the in-memory mock to this API. TypeScript request/response shapes
live in `src/types` and `src/lib/schemas/project.ts`.

## Auth

- Login is handled by Auth.js (Credentials provider). When `API_URL` is set, the
  provider POSTs to **`POST {API_URL}/auth/login`** `{ email, password }` and
  expects `{ user: { id, name, email, plan }, accessToken }`.
- All data requests below send `Authorization: Bearer <accessToken>` and
  `Content-Type: application/json`. The backend derives the user from the token.
- `404` → the client treats the resource as `null`. Non-2xx (other) → error.

## Endpoints

| Method | Path | Body | Response | Maps to |
| --- | --- | --- | --- | --- |
| GET | `/me` | — | `User` | `getCurrentUser` |
| GET | `/plans` | — | `{ plans: PlanRow[] }` (active, sorted; **public, no auth**) | `getPlans` |
| GET | `/projects` | — | `Project[]` | `listProjects` |
| GET | `/projects/:id` | — | `Project \| 404` | `getProject` |
| POST | `/projects` | `CreateProjectInput` | `{ project, brief }` | `createProject` |
| GET | `/projects/:id/brief` | — | `Brief \| 404` | `getBrief` |
| PATCH | `/projects/:id/brief` | `Partial<Brief>` | `Brief` | `updateBrief` |
| POST | `/projects/:id/alternatives/generate` | — | `Alternative[]` | `generateAlternatives` |
| GET | `/projects/:id/alternatives` | — | `Alternative[]` | `getAlternatives` |
| POST | `/projects/:id/alternatives/:altId/select` | — | `Project` | `selectAlternative` |
| GET | `/projects/:id/rab?finishing=` | — | `RAB \| 404` | `getRAB` |
| GET | `/projects/:id/layout` | — | `DesignLayout \| 404` | `getLayout` |
| PUT | `/projects/:id/layout` | `DesignLayout` | `DesignLayout` | `saveLayout` |
| GET | `/projects/:id/review` | — | `Review \| 404` | `getReview` |
| POST | `/projects/:id/review/comments` | `{ body }` | `Review` | `addComment` |
| PATCH | `/projects/:id/review/comments/:cid/toggle` | — | `Review` | `toggleCommentResolved` |
| PATCH | `/projects/:id/review/checklist` | `{ role, status }` | `Review` | `setChecklistStatus` |
| PATCH | `/projects/:id/review/warnings/:wid/toggle` | — | `Review` | `toggleWarningResolved` |

### Unified AI Agent

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/projects/:id/agent` | — | `{ messages: AssistantMessage[] }` — satu thread proyek untuk Brief, Denah, dan Interior |
| POST | `/projects/:id/agent` | `{ surface, requestedMode, instruction, liveScene?, clientRequestId }` | `{ message, routedMode }` |
| PATCH | `/projects/:id/agent/:msgId` | `{ status: "applied" | "dismissed" }` | `{ ok: true }` |

`requestedMode` dapat berupa `auto | brief | floorplan | interior`. Pada mode `auto`, server merutekan intent secara deterministik lalu memakai surface aktif sebagai fallback. `liveScene` hanya diterima bila mode dan `versionId` cocok dengan layout proyek; jika tidak, server membangun scene dari payload database.

`clientRequestId` wajib unik per proyek. Turn claim, credit spend, dan refund bersifat idempoten, sehingga double-click, retry, atau dua tab tidak menagih dua kali. Semua action tetap berupa proposal yang disanitasi dan harus diterapkan user. Endpoint lama `/brief/assistant` dan `/editor/assistant` dipertahankan sementara sebagai compatibility surface; client baru hanya memakai `/agent`.

The backend may generate `brief`, `alternatives`, `layout`, `rab`, and `review`
from the project (the mock does so in `src/lib/mock/{layout,rab,review}.ts`).

## Payment (Mayar)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/checkout` | (Next route) creates a Mayar invoice for the requested plan → returns `{ redirectUrl }`. Requires `MAYAR_API_KEY`; 503 `payment_not_configured` if absent. |
| POST | `/api/webhooks/payment` | (Next route) Mayar webhook: verifies `MAYAR_WEBHOOK_TOKEN` (timingSafeEqual), activates the matching pending subscription + grants period credits, idempotent per order+outcome. Unrecognized `provider_ref` no-ops 200 (shared merchant account with tampil.dev). |
| GET | `/api/v1/plans` | Public — active plans, DB-driven (drives `/pricing` + `/app/billing`). |
| GET/PUT | `/api/v1/admin/plans` | Admin-only (`requireAdmin`) — full plan CRUD (price/entitlements/features). |
| GET | `/api/v1/admin/subscriptions` | Admin-only — read-only subscriptions listing. |
| GET/PATCH | `/api/v1/admin/users` | Admin-only — list profiles; change role/plan (self-demotion + last-admin guarded). |
| POST | `/api/v1/admin/users/credits` | Admin-only — adjust a user's credit total with a reason (ledger-tagged `admin_adjust`). |
| POST | `/api/v1/admin/users/phantom-login` | Admin-only — create a short-lived phantom-login URL for a target profile. The returned JWT is placed in the URL fragment and stored by the opened tab in `sessionStorage`, so it is scoped to that tab instead of the shared Supabase cookie. |

See `src/lib/billing/providers/mayar.ts` for the provider implementation
(ported from the sibling tampil.dev app — shared Mayar merchant account) and
`db/migrations/0001_init.sql` + `0007_billing_admin.sql` for the canonical
database schema (`plans`, `subscriptions`, `credits_ledger`, `payment_events`,
`profiles.role`/`.phone`).
