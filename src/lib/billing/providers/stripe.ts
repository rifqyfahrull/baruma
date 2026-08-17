/**
 * Stripe billing provider (branch `emergent`) — replaces the Mayar invoice
 * flow the rest of the codebase used before. Same `BillingProvider` contract
 * (see ./types.ts), so `checkout`/`webhooks/payment` routes don't need to
 * know which provider is wired in.
 *
 * Flow: one-off Stripe Checkout Session per plan purchase (mode "payment",
 * not a Stripe Subscription) — Baruma already models "1 period" billing
 * itself via the `subscriptions` table + webhook-driven renewal, so a
 * lighter one-time Checkout Session is enough and keeps the webhook mapping
 * simple (`checkout.session.completed` → paid).
 *
 * IDR is one of Stripe's zero-decimal currencies, so `unit_amount` is the
 * plan's rupiah price as-is (no ×100 cents conversion).
 */
import Stripe from "stripe"
import { getPlan } from "@/lib/server/repo/plans"
import type {
  BillingProvider,
  CreateCheckoutInput,
  CreateCheckoutResult,
  ParseWebhookInput,
  ParsedWebhookResult,
  PaymentOutcome,
} from "@/lib/billing/providers/types"

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

let cachedClient: Stripe | null = null
function getStripeClient(secretKey: string): Stripe {
  if (!cachedClient) cachedClient = new Stripe(secretKey)
  return cachedClient
}

async function createCheckout(
  input: CreateCheckoutInput
): Promise<CreateCheckoutResult> {
  const secretKey = getEnv("STRIPE_SECRET_KEY")
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured")
  }

  const appUrl = getEnv("NEXT_PUBLIC_APP_URL") ?? getEnv("APP_URL")
  if (!appUrl) {
    throw new Error("APP_URL or NEXT_PUBLIC_APP_URL is not configured")
  }

  const plan = await getPlan(input.plan)
  if (!plan) {
    throw new Error(`Unknown plan: ${input.plan}`)
  }

  const appName = getEnv("APP_NAME") ?? "Baruma"
  const amountIdr = plan.priceIdr
  const generatedOrderId = `brm-${input.userId.slice(0, 8)}-${Date.now()}`
  const billingUrl = new URL("/app/billing", appUrl).toString()

  const stripe = getStripeClient(secretKey)
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: generatedOrderId,
    customer_email: input.email,
    success_url: `${billingUrl}?checkout=success`,
    cancel_url: `${billingUrl}?checkout=cancel`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "idr",
          unit_amount: amountIdr,
          product_data: {
            name: `${appName} ${input.plan.toUpperCase()} — 1 Bulan`,
          },
        },
      },
    ],
    metadata: {
      app: appName,
      plan: input.plan,
      user_id: input.userId,
      external_order_id: generatedOrderId,
    },
  })

  if (!session.url) {
    throw new Error(
      `Stripe checkout session missing URL: ${JSON.stringify(session)}`
    )
  }

  return {
    provider: "stripe",
    providerOrderId: generatedOrderId,
    amountIdr,
    checkoutToken: session.id,
    checkoutUrl: session.url,
  }
}

function mapStripeOutcome(
  eventType: string,
  obj: Record<string, unknown>
): PaymentOutcome {
  if (
    eventType === "checkout.session.completed" ||
    eventType === "checkout.session.async_payment_succeeded"
  ) {
    // `checkout.session.completed` fires immediately for card payments;
    // async methods (e.g. bank transfers) fire `completed` with
    // payment_status "unpaid" first, then `async_payment_succeeded` once
    // the transfer actually clears — Stripe's own recommendation is to
    // gate fulfillment on both events, keyed on payment_status.
    return obj.payment_status === "paid" ? "paid" : "ignored"
  }
  if (eventType === "checkout.session.expired") return "expired"
  if (
    eventType === "checkout.session.async_payment_failed" ||
    eventType === "payment_intent.payment_failed"
  )
    return "failed"
  if (eventType === "charge.refunded") return "cancelled"
  return "ignored"
}

/**
 * Verifies the Stripe signature (`stripe-signature` header, HMAC over the
 * exact raw body) via the SDK — real cryptographic verification, unlike
 * Mayar's static shared-token compare. Only a bad/missing signature yields
 * `isValid: false`; any Stripe event type Baruma doesn't act on still comes
 * back `isValid: true` with `outcome: "ignored"` (falls through to a no-op
 * in the webhook route) so an unexpected-but-legitimate event never trips
 * the 401 path.
 */
function parseWebhook(input: ParseWebhookInput): ParsedWebhookResult {
  const webhookSecret = getEnv("STRIPE_WEBHOOK_SECRET")
  const secretKey = getEnv("STRIPE_SECRET_KEY")
  if (!webhookSecret || !secretKey) {
    return {
      isValid: false,
      errorMessage:
        "STRIPE_WEBHOOK_SECRET/STRIPE_SECRET_KEY not configured — webhook rejected",
    }
  }

  const signature = getHeaderValue(input.headers, "stripe-signature")
  if (!signature || input.rawBody === undefined) {
    return {
      isValid: false,
      errorMessage: "Missing Stripe signature or raw body",
    }
  }

  let event: Stripe.Event
  try {
    event = getStripeClient(secretKey).webhooks.constructEvent(
      input.rawBody,
      signature,
      webhookSecret
    )
  } catch (e) {
    return {
      isValid: false,
      errorMessage: `Invalid Stripe signature: ${(e as Error).message}`,
    }
  }

  const obj = event.data.object as unknown as Record<string, unknown>
  const providerOrderId =
    typeof obj.client_reference_id === "string"
      ? obj.client_reference_id
      : event.id
  const providerTransactionId =
    typeof obj.payment_intent === "string"
      ? obj.payment_intent
      : typeof obj.id === "string"
        ? obj.id
        : undefined
  const amountIdr =
    typeof obj.amount_total === "number" ? obj.amount_total : undefined

  return {
    isValid: true,
    event: {
      provider: "stripe",
      providerOrderId,
      providerTransactionId,
      amountIdr,
      transactionStatusRaw: event.type,
      outcome: mapStripeOutcome(event.type, obj),
    },
  }
}

export const stripeBillingProvider: BillingProvider = {
  name: "stripe",
  createCheckout,
  parseWebhook,
}
