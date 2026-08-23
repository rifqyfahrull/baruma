# Parent-billing orchestration — Baruma → tampil.dev → Mayar

**Status:** implemented 2026-08-22 · **Supersedes the direct-Mayar path of** `2026-07-05-mayar-billing-admin-design.md`

## Problem / decision

Baruma is a **child** of the tampil.dev parent app. Previously Baruma talked to
Mayar directly using a copy of the parent's provider (shared merchant account).
The parent should instead be the single **financial/subscription manager** for
every VibeCoding.ID child. So the money path becomes:

```
Baruma (child)  →  tampil.dev (parent)  →  Mayar
```

**Baruma no longer holds any Mayar credential.** It never calls Mayar.

## Contract

### 1. Checkout (Baruma → parent)

- Browser `POST /api/checkout {planId}` (unchanged, Supabase-cookie auth).
- Baruma resolves the plan from its own admin-editable `plans` table (it stays
  the source of truth for its prices) and calls the parent via
  `parentBillingProvider.createCheckout()`:
  - `POST {PARENT_BILLING_URL}/api/billing/child/checkout`
  - Headers: `x-child-app: baruma`, `x-child-key: <PARENT_BILLING_SECRET>`
  - Body: `{ app, orderId, userId, email, fullName, mobile, plan, planName,
    amountIdr, period, redirectUrl, webhookUrl }`
  - **Baruma generates the order id** (`brm-<uid8>-<ts>`) so the pending
    subscription's `provider_ref` is exactly what the parent relays back.
  - **`webhookUrl` is self-reported, not parent-side config** (added
    2026-08-22, same day as the initial build): Baruma computes it from its
    own `NEXT_PUBLIC_APP_URL`/`APP_URL`, same as `redirectUrl`. The parent
    persists it verbatim on the `child_invoices` row and uses THAT value when
    relaying — never a static per-app lookup. The original design used a
    `CHILD_<APP>_WEBHOOK_URL` env var on the parent; that was wrong — it
    required updating and redeploying the PARENT every time Baruma's own
    domain changed, and already caused one real incident (a parent deploy
    that ran before `PARENT_BILLING_SECRET` existed baked in an empty value,
    surfacing as "Pembayaran belum aktif." until a redeploy). Validated
    server-side (`isSafeChildWebhookUrl`: must be `https://` — or
    `http://127.0.0.1` for a co-located dev child — and path must be exactly
    `/api/webhooks/payment`) so accepting an arbitrary caller-supplied URL
    doesn't become an SSRF vector for the parent's own `fetch()`.
- Parent creates the Mayar invoice (its shared merchant account), records a
  `child_invoices` ledger row tagged by app, returns `{ data: { checkoutUrl,
  orderId } }`.
- Baruma records a `pending` subscription with `provider = 'parent'`,
  `provider_ref = orderId`, and redirects the browser to `checkoutUrl`.

### 2. Settlement (Mayar → parent → Baruma)

- Mayar posts to the parent's existing `POST /api/payment/webhook` (Mayar-token
  verified).
- The parent webhook, **before** its own topup/invoice logic, calls
  `handleChildWebhook()`: if the order is in `child_invoices` (matched by the
  provider order id or the child order id), it updates the ledger and **relays**
  a normalized event to the child — and returns, so the parent never touches its
  own `users.plan` for a child purchase.
- Relay: `POST {child.webhookUrl}` with header `x-parent-signature:
  <CHILD_BILLING_SECRET>` and body `{ event: { app, orderId, outcome, amountIdr,
  providerTransactionId, transactionStatusRaw } }`.
- Baruma `POST /api/webhooks/payment` verifies the signature via
  `parentBillingProvider.parseWebhook()` and runs its existing atomic
  activate/expire/grant logic (unchanged, provider-agnostic).

### 3. Auth

One shared secret both directions, constant-time compared:

| Child (Baruma)          | Parent (tampil.dev)     |
| ----------------------- | ----------------------- |
| `PARENT_BILLING_SECRET` | `CHILD_BILLING_SECRET`  |

Must be equal. `PARENT_BILLING_URL` must be the parent's **public** origin
(`https://tampil.dev`) — the parent's origin gate rejects a loopback Host.
`proxy.ts` skips only the Supabase-session gate for `/api/billing/child/*`
(the endpoint validates `x-child-key` itself, mirroring `x-agent-key` routes).

## Idempotency / robustness

- Child order id is the canonical reference end-to-end; the child's existing
  atomic `UPDATE ... WHERE status = 'pending' / 'active'` guards make repeated
  relays safe. The parent therefore relays on **every** paid delivery (Mayar
  retries) rather than gating on a status flip.
- Parent webhook detection tolerates Mayar echoing either the provider-assigned
  id or the child's own order id (looks up both columns).
- Unknown order at the parent → falls through to the parent's own handling.
- Unknown ref at the child → safe silent 200 no-op.
- `ignored` (Mayar "testing" ping) is recognized as a child order but not
  relayed.

## Data

- **Child** `subscriptions.provider` CHECK widened to include `'parent'`
  (`db/migrations/0038_parent_billing_provider.sql`).
- **Parent** new `child_invoices` ledger (`app`, `child_user_id`,
  `child_order_id`, `plan`, `amount_idr`, `provider_order_id`, `webhook_url`,
  `status`, …), RLS-locked, service-role only (`035_child_billing.sql`,
  `webhook_url` added in `036_child_invoices_webhook_url.sql`). Kept separate
  from the parent's own `invoices`/`subscriptions` so a child purchase never
  mutates `users.plan`.

## Non-goals (unchanged)

Auto-debit/tokenization, proration, refunds, email reminders, multi-currency,
coupons. Manual-renew, one period per payment, lazy expiry on read.

## Go-live prerequisites (config only — code is a safe no-op until set)

1. Parent: set `CHILD_BILLING_SECRET`. Run migrations `035_child_billing.sql`
   + `036_child_invoices_webhook_url.sql`. No per-child webhook config needed
   — each child self-reports its own webhook URL per checkout request.
2. Child: set `PARENT_BILLING_URL=https://tampil.dev`, `PARENT_BILLING_SECRET`
   (== parent's `CHILD_BILLING_SECRET`), `PARENT_BILLING_APP=baruma`,
   `NEXT_PUBLIC_APP_URL` (used to build both `redirectUrl` and `webhookUrl` —
   checkout now fails closed with `payment_not_configured` if this is unset,
   since there's no safe fallback for webhookUrl the way there is for
   redirectUrl). Run migration `0038`.
3. Until both secrets are set: child checkout returns `503
   payment_not_configured`; parent child-endpoint returns `401`. Nothing breaks.
4. **Real incident, 2026-08-22:** a Baruma deploy ran BEFORE
   `PARENT_BILLING_SECRET` was set on GitHub, baking an empty value into that
   deploy's `.env.local` — checkout kept showing "Pembayaran belum aktif."
   until a fresh deploy re-read the (by-then-populated) secret. Whenever a
   billing-related secret is added/changed on either app, trigger a redeploy
   of that same app afterward — don't assume "the secret exists" means "the
   running process has it."
