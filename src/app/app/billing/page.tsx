"use client"

import * as React from "react"
import { Check, Clock, Download, Loader2, Sparkles, Zap } from "lucide-react"
import { toast } from "sonner"

import { useCurrentUser, usePlans } from "@/lib/api/hooks"
import { useMyTransactions } from "@/lib/api/billing-hooks"
import { buildReceiptPdf, receiptFilename } from "@/lib/billing/receipt-pdf"
import { formatPlanPeriod, formatPlanPrice, planCtaLabel } from "@/lib/pricing"
import { track } from "@/lib/analytics"
import { cn } from "@/lib/utils"
import type { TransactionRow } from "@/types"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/** Show the renewal reminder once the active period is this many days out (or less). */
const RENEWAL_REMINDER_DAYS = 7

export default function BillingPage() {
  const { data: user } = useCurrentUser()
  const { data: plans, isLoading: plansLoading } = usePlans()
  const [loadingPlan, setLoadingPlan] = React.useState<string | null>(null)
  const [now] = React.useState(() => Date.now())

  const currentPlan = user?.plan ?? "free"
  const used = user?.creditsUsed ?? 0
  const total = user?.creditsTotal ?? 10
  const currentPlanRow = plans?.find((p) => p.id === currentPlan)

  // Manual-renew reminder: /api/v1/me already downgrades a lapsed
  // subscription to free server-side (lazy expiry), so by the time the
  // client sees `subscription` it's either null or genuinely still active —
  // the `daysUntilRenewal >= 0` guard below is defensive-only.
  const subscription = user?.subscription ?? null
  const daysUntilRenewal = subscription
    ? Math.ceil(
        (new Date(subscription.currentPeriodEnd).getTime() - now) /
          86_400_000
      )
    : null
  const showRenewalBanner =
    subscription?.status === "active" &&
    daysUntilRenewal !== null &&
    daysUntilRenewal >= 0 &&
    daysUntilRenewal <= RENEWAL_REMINDER_DAYS

  async function upgrade(planId: string) {
    track("upgrade_clicked", { source: "billing", plan: planId })
    setLoadingPlan(planId)
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        redirectUrl?: string
        message?: string
      }
      if (res.ok && data.redirectUrl) {
        window.location.assign(data.redirectUrl)
        return
      }
      toast.info(data.message ?? "Pembayaran belum dikonfigurasi.")
    } catch {
      toast.error("Gagal memulai pembayaran.")
    } finally {
      setLoadingPlan(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Billing & paket"
        description="Kelola langganan dan kredit untuk membuat lebih banyak project & export."
      />

      {showRenewalBanner && (
        <Alert>
          <Clock className="text-warning" />
          <AlertTitle>
            Langganan berakhir dalam {daysUntilRenewal} hari
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Perpanjang sekarang supaya kredit &amp; fitur{" "}
              {currentPlanRow?.name ?? currentPlan} tidak terputus.
            </span>
            <Button
              size="sm"
              disabled={loadingPlan !== null}
              onClick={() => upgrade(currentPlan)}
              aria-label="Perpanjang langganan sekarang"
            >
              {loadingPlan === currentPlan ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              Perpanjang
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Current plan */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Paket aktif</p>
            <p className="flex items-center gap-2 text-2xl font-semibold">
              {plansLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  {currentPlanRow?.name ?? currentPlan}
                  {currentPlan === "free" && (
                    <Badge variant="secondary">
                      {formatPlanPrice(currentPlanRow?.priceIdr ?? 0)}
                    </Badge>
                  )}
                </>
              )}
            </p>
          </div>
          <div className="w-full max-w-xs">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Zap className="size-3.5 text-warning" /> Kredit
              </span>
              <span className="tabular-nums">
                {Math.max(0, total - used)}/{total}
              </span>
            </div>
            <Progress value={(used / total) * 100} className="h-1.5" />
          </div>
        </CardContent>
      </Card>

      {/* Plans */}
      <div className="grid gap-4 lg:grid-cols-3">
        {plansLoading || !plans ? (
          <>
            <PlanCardSkeleton />
            <PlanCardSkeleton />
            <PlanCardSkeleton />
          </>
        ) : (
          plans.map((plan) => {
            const isCurrent = plan.id === currentPlan
            const isUpgrade = plan.priceIdr > 0 && !isCurrent
            return (
              <Card
                key={plan.id}
                className={cn("flex h-full flex-col", plan.featured && "border-primary")}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{plan.name}</h3>
                    {plan.featured && <Badge>Populer</Badge>}
                  </div>
                  <p className="mt-1 text-2xl font-semibold">
                    {formatPlanPrice(plan.priceIdr)}
                    <span className="text-sm font-normal text-muted-foreground">
                      {" "}
                      {formatPlanPeriod(plan)}
                    </span>
                  </p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  <ul className="flex-1 space-y-2 text-sm">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <Button variant="outline" disabled className="w-full">
                      <Check /> Paket aktif
                    </Button>
                  ) : isUpgrade ? (
                    <Button
                      className="w-full"
                      disabled={loadingPlan !== null}
                      onClick={() => upgrade(plan.id)}
                    >
                      {loadingPlan === plan.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Sparkles />
                      )}
                      {planCtaLabel(plan)}
                    </Button>
                  ) : (
                    <Button variant="outline" disabled className="w-full">
                      Paket dasar
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Pembayaran diproses via Mayar. Langganan aktif 1 periode, perpanjang
        manual saat mendekati atau setelah berakhir.
      </p>

      <TransactionsHistory />
    </div>
  )
}

const TRANSACTION_STATUS_VARIANT: Record<
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

function transactionDate(iso: string | null): string {
  if (!iso) return "-"
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

/** Baris yang dianggap "transaksi berbayar selesai" — layak diunduh kuitansinya. */
function isDownloadableReceipt(row: TransactionRow): boolean {
  return row.priceIdr > 0 && (row.status === "active" || row.status === "expired")
}

function TransactionsHistory() {
  const { data: transactions, isLoading } = useMyTransactions()
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null)

  async function downloadReceipt(row: TransactionRow) {
    setDownloadingId(row.id)
    try {
      const blob = await buildReceiptPdf(row)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = receiptFilename(row)
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error("Gagal membuat kuitansi.")
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="font-semibold">Riwayat transaksi</h3>
        <p className="text-sm text-muted-foreground">
          Semua langganan yang pernah Anda buat, terbaru dulu.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plan</TableHead>
              <TableHead>Nominal</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dibuat</TableHead>
              <TableHead>Berakhir</TableHead>
              <TableHead className="text-right">Kuitansi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : !transactions || transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Belum ada transaksi.
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.planName}</TableCell>
                  <TableCell>{formatPlanPrice(row.priceIdr)}</TableCell>
                  <TableCell>
                    <Badge variant={TRANSACTION_STATUS_VARIANT[row.status] ?? "outline"}>
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{transactionDate(row.createdAt)}</TableCell>
                  <TableCell>{transactionDate(row.currentPeriodEnd)}</TableCell>
                  <TableCell className="text-right">
                    {isDownloadableReceipt(row) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={downloadingId === row.id}
                        onClick={() => downloadReceipt(row)}
                        aria-label={`Unduh kuitansi ${row.planName}`}
                      >
                        {downloadingId === row.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Download />
                        )}
                        Unduh
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function PlanCardSkeleton() {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <Skeleton className="h-5 w-20" />
        <Skeleton className="mt-1 h-8 w-28" />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  )
}
