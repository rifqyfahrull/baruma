"use client"

import * as React from "react"
import { AlertTriangle } from "lucide-react"

import { useAdminPayments } from "@/lib/api/billing-hooks"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Rekonsiliasi pembayaran (WS-B): payment_events terbaru + subscriptions
 * "pending" macet, dengan derajat mismatch supaya kasus "bayar tapi tak
 * aktif" terlihat oleh admin. Read-only, sama pola dengan transactions-table.tsx.
 */
export function PaymentsTable() {
  const { data: rows, isLoading } = useAdminPayments()
  const [onlyMismatch, setOnlyMismatch] = React.useState(false)

  const filtered = React.useMemo(() => {
    if (!rows) return rows
    return onlyMismatch ? rows.filter((r) => r.mismatch) : rows
  }, [rows, onlyMismatch])

  const mismatchCount = rows?.filter((r) => r.mismatch).length ?? 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {mismatchCount > 0
            ? `${mismatchCount} kemungkinan tidak sinkron ditemukan.`
            : "Tidak ada indikasi tidak sinkron."}
        </p>
        <Button
          type="button"
          variant={onlyMismatch ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyMismatch((v) => !v)}
        >
          <AlertTriangle />
          {onlyMismatch ? "Tampilkan semua" : "Hanya tidak sinkron"}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Waktu</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Status langganan</TableHead>
            <TableHead>No. pesanan</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={7}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            ))
          ) : !filtered || filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                {onlyMismatch
                  ? "Tidak ada baris tidak sinkron."
                  : "Belum ada payment event."}
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((row) => (
              <TableRow key={row.id} className={row.mismatch ? "bg-destructive/5" : undefined}>
                <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                <TableCell>{row.email ?? "-"}</TableCell>
                <TableCell>{row.planName ?? "-"}</TableCell>
                <TableCell>{row.eventType ?? "-"}</TableCell>
                <TableCell>{row.subscriptionStatus ?? "-"}</TableCell>
                <TableCell className="font-mono text-xs">
                  {row.providerOrderId ?? "-"}
                </TableCell>
                <TableCell>
                  {row.mismatch ? (
                    <Badge variant="destructive">
                      <AlertTriangle className="size-3" /> Tidak sinkron
                    </Badge>
                  ) : (
                    <Badge variant="secondary">OK</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
