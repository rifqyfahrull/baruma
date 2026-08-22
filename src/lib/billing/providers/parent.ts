/**
 * Parent-billing provider — Baruma's ONLY billing provider.
 *
 * Baruma never touches Mayar. Instead it delegates the whole payment to its
 * parent app (tampil.dev), which owns the shared Mayar merchant account and is
 * the financial/subscription manager for every VibeCoding.ID child:
 *
 *     Baruma  →  tampil.dev (parent)  →  Mayar
 *
 * - `createCheckout()` POSTs to the parent's child-billing endpoint
 *   (`POST {PARENT_BILLING_URL}/api/billing/child/checkout`), authenticated by
 *   a shared secret header. Baruma sends its own plan price (it is the source
 *   of truth for its admin-editable plans) and a Baruma-generated order id; the
 *   parent creates the Mayar invoice and returns the checkout URL.
 * - `parseWebhook()` verifies the parent's relay POST (the parent fans a
 *   normalized event out to `POST /api/webhooks/payment` after Mayar notifies
 *   it) against the same shared secret. The wire body is already normalized by
 *   the parent, so there is no Mayar-specific field-guessing here.
 *
 * Config (all read at call time, never cached, so tests can toggle env):
 *   PARENT_BILLING_URL    — base URL of the parent, e.g. https://tampil.dev
 *                           (co-located deploy may use http://127.0.0.1:3001)
 *   PARENT_BILLING_SECRET — shared secret; must equal the parent's
 *                           CHILD_BILLING_SECRET. Used BOTH to authenticate
 *                           Baruma→parent checkout calls and to verify
 *                           parent→Baruma webhook relays.
 *   PARENT_BILLING_APP    — this child's app id at the parent (default "baruma")
 *
 * See docs/superpowers/specs/2026-08-22-parent-billing-orchestration-design.md.
 */
import { timingSafeEqual } from "crypto"
import type {
  BillingProvider,
  CreateCheckoutInput,
  CreateCheckoutResult,
  ParseWebhookInput,
  ParsedWebhookResult,
  PaymentOutcome,
} from "@/lib/billing/providers/types"

const DEFAULT_APP_ID = "baruma"
const OUTCOMES: ReadonlySet<string> = new Set([
  "paid",
  "failed",
  "expired",
  "cancelled",
  "ignored",
])

function getEnv(name: string): string | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function getHeaderValue(
  headers: Headers | undefined,
  key: string
): string | undefined {
  if (!headers) return undefined
  const value = headers.get(key)
  return value === null ? undefined : value
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim()
  if (typeof value === "number") return String(value)
  return undefined
}

/** Constant-time secret comparison (length-guarded so timingSafeEqual never throws). */
function secretMatches(received: string | undefined, expected: string): boolean {
  if (!received || received.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

export function getParentBillingConfig(): {
  url: string
  secret: string
  app: string
} | null {
  const url = getEnv("PARENT_BILLING_URL")
  const secret = getEnv("PARENT_BILLING_SECRET")
  if (!url || !secret) return null
  return { url, secret, app: getEnv("PARENT_BILLING_APP") ?? DEFAULT_APP_ID }
}

/** True when the parent-billing bridge is configured (checkout can run). */
export function isParentBillingConfigured(): boolean {
  return getParentBillingConfig() !== null
}

async function createCheckout(
  input: CreateCheckoutInput
): Promise<CreateCheckoutResult> {
  const config = getParentBillingConfig()
  if (!config) {
    throw new Error("PARENT_BILLING_URL / PARENT_BILLING_SECRET is not configured")
  }

  // Baruma owns the order-id namespace so the id it stores as the pending
  // subscription's provider_ref is exactly what the parent relays back on the
  // webhook — no dependence on whatever id Mayar happens to echo.
  const orderId = `brm-${input.userId.slice(0, 8)}-${Date.now()}`

  const endpoint = new URL("/api/billing/child/checkout", config.url).toString()
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-child-app": config.app,
        "x-child-key": config.secret,
      },
      body: JSON.stringify({
        app: config.app,
        orderId,
        userId: input.userId,
        email: input.email,
        fullName: input.fullName,
        mobile: input.mobile,
        plan: input.plan,
        planName: input.planName,
        amountIdr: input.amountIdr,
        period: input.period,
        redirectUrl: input.redirectUrl,
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    throw new Error(`Parent billing request failed: ${(e as Error).message}`)
  }

  const rawBody = await response.text()
  const parsed = rawBody
    ? (() => {
        try {
          return JSON.parse(rawBody) as Record<string, unknown>
        } catch {
          return { raw: rawBody } as Record<string, unknown>
        }
      })()
    : {}

  if (!response.ok) {
    const msg =
      normalizeString((parsed as { error?: unknown }).error) ??
      normalizeString((parsed as { message?: unknown }).message) ??
      rawBody.slice(0, 300)
    throw new Error(
      `Parent billing checkout failed (${response.status}): ${msg || "no body"}`
    )
  }

  const data =
    typeof parsed.data === "object" && parsed.data !== null
      ? (parsed.data as Record<string, unknown>)
      : parsed

  const checkoutUrl =
    normalizeString(data.checkoutUrl) ??
    normalizeString(data.checkout_url) ??
    normalizeString(data.redirectUrl) ??
    normalizeString(data.redirect_url) ??
    normalizeString(data.url)

  if (!checkoutUrl) {
    throw new Error(
      `Parent billing checkout response missing checkoutUrl: ${JSON.stringify(parsed).slice(0, 300)}`
    )
  }

  return {
    provider: "parent",
    // Echo Baruma's own order id — this is what the pending subscription is
    // keyed by and what the parent will relay back on the webhook.
    providerOrderId: normalizeString(data.orderId) ?? orderId,
    amountIdr: input.amountIdr,
    checkoutToken: normalizeString(data.checkoutToken),
    checkoutUrl,
  }
}

function parseWebhook(input: ParseWebhookInput): ParsedWebhookResult {
  const config = getParentBillingConfig()
  if (!config) {
    return {
      isValid: false,
      errorMessage:
        "PARENT_BILLING_SECRET not configured — parent webhook relay rejected",
    }
  }

  const received =
    getHeaderValue(input.headers, "x-parent-signature") ??
    getHeaderValue(input.headers, "x-child-key") ??
    getHeaderValue(input.headers, "authorization")?.replace(/^Bearer\s+/i, "")

  if (!secretMatches(received, config.secret)) {
    return { isValid: false, errorMessage: "Invalid parent billing signature" }
  }

  const root = (input.payload ?? {}) as Record<string, unknown>
  const body =
    typeof root.event === "object" && root.event !== null
      ? (root.event as Record<string, unknown>)
      : root

  const providerOrderId =
    normalizeString(body.orderId) ??
    normalizeString(body.providerOrderId) ??
    normalizeString(body.provider_order_id) ??
    normalizeString(body.external_id)

  if (!providerOrderId) {
    return { isValid: false, errorMessage: "Parent relay missing orderId" }
  }

  const outcomeRaw =
    normalizeString(body.outcome)?.toLowerCase() ?? "ignored"
  const outcome: PaymentOutcome = (
    OUTCOMES.has(outcomeRaw) ? outcomeRaw : "ignored"
  ) as PaymentOutcome

  const amountRaw = normalizeString(body.amountIdr) ?? normalizeString(body.amount)
  const amount = amountRaw ? Number.parseFloat(amountRaw) : undefined

  return {
    isValid: true,
    event: {
      provider: "parent",
      providerOrderId,
      providerTransactionId:
        normalizeString(body.providerTransactionId) ??
        normalizeString(body.provider_transaction_id),
      amountIdr:
        amount !== undefined && !Number.isNaN(amount)
          ? Math.trunc(amount)
          : undefined,
      transactionStatusRaw:
        normalizeString(body.transactionStatusRaw) ?? outcomeRaw,
      outcome,
    },
  }
}

export const parentBillingProvider: BillingProvider = {
  name: "parent",
  createCheckout,
  parseWebhook,
}
