"use client"

import { useAdminSubscriptions } from "@/lib/api/hooks"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  pending: "secondary",
  past_due: "destructive",
  canceled: "outline",
  incomplete: "outline",
  expired: "destructive",
}

function formatDate(iso: string | null): string {
  if (!iso) return "-"
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

/** Read-only — no mutations (see docs/superpowers/plans/2026-07-05-mayar-billing-admin.md, Task 8). */
export function TransactionsTable() {
  const { data: subs, isLoading } = useAdminSubscriptions()

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>Berakhir</TableHead>
          <TableHead>Dibuat</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell colSpan={6}>
                <Skeleton className="h-6 w-full" />
              </TableCell>
            </TableRow>
          ))
        ) : !subs || subs.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={6}
              className="text-center text-muted-foreground"
            >
              Belum ada transaksi.
            </TableCell>
          </TableRow>
        ) : (
          subs.map((sub) => (
            <TableRow key={sub.id}>
              <TableCell>{sub.email}</TableCell>
              <TableCell>{sub.planName}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[sub.status] ?? "outline"}>
                  {sub.status}
                </Badge>
              </TableCell>
              <TableCell>{sub.provider ?? "-"}</TableCell>
              <TableCell>{formatDate(sub.currentPeriodEnd)}</TableCell>
              <TableCell>{formatDate(sub.createdAt)}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
