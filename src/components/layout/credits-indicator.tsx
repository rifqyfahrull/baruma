"use client"

import Link from "next/link"
import { Zap } from "lucide-react"

import { useCurrentUser } from "@/lib/api/hooks"
import { track } from "@/lib/analytics"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export function CreditsIndicator() {
  const { data: user, isLoading } = useCurrentUser()

  if (isLoading || !user) {
    return <Skeleton className="h-[68px] w-full rounded-lg" />
  }

  const remaining = Math.max(0, user.creditsTotal - user.creditsUsed)
  const pct = (user.creditsUsed / user.creditsTotal) * 100

  return (
    <div className="rounded-lg border bg-sidebar-accent/40 p-2.5 text-sidebar-foreground">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          <Zap className="size-3.5 text-warning" />
          Kredit
        </span>
        <span className="tabular-nums text-muted-foreground">
          {remaining}/{user.creditsTotal}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />
      <Button asChild size="xs" variant="outline" className="mt-2.5 w-full">
        <Link
          href="/app/billing"
          onClick={() => track("upgrade_clicked", { source: "credits" })}
        >
          Upgrade
        </Link>
      </Button>
    </div>
  )
}
