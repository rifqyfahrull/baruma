/**
 * Riwayat transaksi user (WS-B): subscriptions milik user yang sedang login,
 * di-join nama plan, terbaru dulu. Dipakai oleh section "Riwayat transaksi"
 * di /app/billing (lihat src/lib/api/billing-hooks.ts + src/app/app/billing/
 * page.tsx).
 */
import { requireUser } from "@/lib/server/auth-server"
import { listSubscriptionsForProfile } from "@/lib/server/repo/subscriptions"
import { ok, handleError } from "@/lib/server/response"
import type { TransactionRow } from "@/types"

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const subs = await listSubscriptionsForProfile(userId)
    const transactions: TransactionRow[] = subs.map((s) => ({
      id: s.id,
      planName: s.planName,
      priceIdr: s.priceIdr,
      status: s.status,
      createdAt: s.createdAt,
      currentPeriodEnd: s.currentPeriodEnd,
      providerOrderId: s.providerRef,
    }))
    return ok(transactions)
  } catch (e) {
    return handleError(e)
  }
}
