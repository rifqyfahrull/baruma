"use client"

import Link from "next/link"
import { Zap } from "lucide-react"

import { useCurrentUser } from "@/lib/api/hooks"
import { track } from "@/lib/analytics"
import { PLANS } from "@/lib/constants"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Mini-card "kredit & penggunaan" (PRD §10.2 dashboard spec) — kecil dan
 * tidak mencolok dengan sengaja: sidebar (`CreditsIndicator`,
 * src/components/layout/credits-indicator.tsx) sudah menunjukkan sisa kredit
 * di SETIAP halaman app; kartu ini cuma menambah konteks plan + link billing
 * langsung di dashboard, bukan duplikat maksud yang sama.
 */
export function UsageCard() {
  const { data: user, isLoading } = useCurrentUser()

  if (isLoading || !user) {
    return <Skeleton className="h-[72px] w-full rounded-xl" />
  }

  const remaining = Math.max(0, user.creditsTotal - user.creditsUsed)
  const pct = user.creditsTotal > 0 ? (user.creditsUsed / user.creditsTotal) * 100 : 0

  return (
    <Card data-testid="usage-card">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-warning/10 text-warning">
            <Zap className="size-4" />
          </span>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">
                Kredit tersisa: {remaining}/{user.creditsTotal}
              </span>
              <Badge variant="secondary">{PLANS[user.plan].label}</Badge>
            </div>
            <Progress value={pct} className="h-1.5 w-40" />
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link
            href="/app/billing"
            onClick={() => track("upgrade_clicked", { source: "dashboard_usage_card" })}
          >
            Kelola billing
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
