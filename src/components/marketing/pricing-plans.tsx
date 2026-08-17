import Link from "next/link"
import { Check, X } from "lucide-react"

import type { PlanRow } from "@/types"
import { formatPlanPeriod, formatPlanPrice, planCtaLabel } from "@/lib/pricing"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * The pricing card grid on the `/pricing` landing page. Extracted from the
 * (async, server-only) page component so it can be exercised directly with
 * RTL — see pricing-plans.test.tsx. Pure presentation: all plan content
 * (name/price/tagline/features/limits) comes from `plans`, the DB-driven
 * source of truth (`GET /api/v1/plans` on the client, direct repo import
 * here on the server).
 */
export function PricingPlans({ plans }: { plans: PlanRow[] }) {
  return (
    <div className="mt-12 grid items-stretch gap-6 lg:grid-cols-3">
      {plans.map((plan) => (
        <Card
          key={plan.id}
          className={cn(
            "h-full",
            plan.featured
              ? "border-panel-border bg-panel"
              : "border-border bg-card"
          )}
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              {plan.featured && <Badge>Populer</Badge>}
            </div>
            <p className="mt-2 text-3xl font-semibold">
              {formatPlanPrice(plan.priceIdr)}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                {formatPlanPeriod(plan)}
              </span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <Button
              asChild
              variant={plan.featured ? "default" : "outline"}
              className="w-full"
            >
              <Link href="/register">{planCtaLabel(plan)}</Link>
            </Button>

            <ul className="space-y-2.5 text-sm">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>{f}</span>
                </li>
              ))}
              {plan.limits.map((l) => (
                <li
                  key={l}
                  className="flex items-start gap-2.5 text-muted-foreground"
                >
                  <X className="mt-0.5 size-4 shrink-0" />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
