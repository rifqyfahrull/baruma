/**
 * Admin backoffice (WS-B): rekonsiliasi pembayaran — payment_events terbaru
 * (+ subscriptions stuck "pending" tanpa event "paid" sama sekali) dengan
 * derajat `mismatch` supaya kasus "bayar tapi tak aktif" terlihat. Read-only,
 * sama pola dengan /api/v1/admin/subscriptions.
 */
import { requireAdmin } from "@/lib/server/auth-server"
import { listPaymentReconciliation } from "@/lib/server/repo/payment-events"
import { ok, handleError } from "@/lib/server/response"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin(request)
    const rows = await listPaymentReconciliation()
    return ok(rows)
  } catch (e) {
    return handleError(e)
  }
}
