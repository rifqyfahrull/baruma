"use client"

/**
 * Billing-specific TanStack Query hooks (WS-B) — kept in a NEW file so it
 * never touches src/lib/api/hooks.ts (owned by a parallel workstream).
 * Follows hooks.ts's style (plain useQuery, queryKey local to this file)
 * but talks to its two routes directly via `fetch` rather than through
 * src/lib/data/http.ts's `DataSource` abstraction — these are net-new
 * endpoints with no mock-source counterpart yet, so a small self-contained
 * fetch avoids widening that shared contract for two read-only lists.
 */
import { useQuery } from "@tanstack/react-query"

import { getPhantomToken } from "@/lib/auth/phantom-session"
import type { AdminPaymentRow, TransactionRow } from "@/types"

const BASE = process.env.NEXT_PUBLIC_API_URL ?? ""

async function getJson<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {}
  const phantomToken = getPhantomToken()
  if (phantomToken) headers.authorization = `Bearer ${phantomToken}`

  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    credentials: "same-origin",
    headers,
  })
  if (!res.ok) {
    throw new Error(`API GET ${path} → ${res.status}`)
  }
  return (await res.json()) as T
}

/** Local query keys — small enough not to warrant editing the shared keys.ts. */
const billingQueryKeys = {
  transactions: ["me", "transactions"] as const,
  adminPayments: ["admin", "payments"] as const,
}

/** Riwayat transaksi user (billing page). */
export function useMyTransactions() {
  return useQuery({
    queryKey: billingQueryKeys.transactions,
    queryFn: () => getJson<TransactionRow[]>("/me/transactions"),
  })
}

/** Admin rekonsiliasi pembayaran (payment_events + subscriptions, dengan mismatch). */
export function useAdminPayments() {
  return useQuery({
    queryKey: billingQueryKeys.adminPayments,
    queryFn: () => getJson<AdminPaymentRow[]>("/admin/payments"),
  })
}
