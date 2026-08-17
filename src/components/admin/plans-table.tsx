"use client"

import * as React from "react"
import { Pencil } from "lucide-react"
import { toast } from "sonner"

import { useAdminPlans, useUpdatePlan } from "@/lib/api/hooks"
import { formatPlanPrice } from "@/lib/pricing"
import type { PlanRow } from "@/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PlanForm } from "./plan-form"

export function PlansTable() {
  const { data: plans, isLoading } = useAdminPlans()
  const updatePlan = useUpdatePlan()
  const [editing, setEditing] = React.useState<PlanRow | null>(null)

  function toggle(plan: PlanRow, field: "active" | "featured") {
    updatePlan.mutate(
      { ...plan, [field]: !plan[field] },
      { onError: () => toast.error("Gagal mengubah plan.") }
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Perubahan di sini langsung menggerakkan halaman /pricing dan
        /app/billing.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nama</TableHead>
            <TableHead>Harga</TableHead>
            <TableHead>Periode</TableHead>
            <TableHead>Urutan</TableHead>
            <TableHead>Unggulan</TableHead>
            <TableHead>Aktif</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
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
          ) : !plans || plans.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center text-muted-foreground"
              >
                Belum ada plan.
              </TableCell>
            </TableRow>
          ) : (
            plans.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {plan.name}
                    {plan.featured && <Badge>Populer</Badge>}
                  </span>
                </TableCell>
                <TableCell>{formatPlanPrice(plan.priceIdr)}</TableCell>
                <TableCell>
                  {plan.period === "year" ? "Tahun" : "Bulan"}
                </TableCell>
                <TableCell>{plan.sortOrder}</TableCell>
                <TableCell>
                  <Switch
                    checked={plan.featured}
                    onCheckedChange={() => toggle(plan, "featured")}
                    aria-label={`Tandai ${plan.name} sebagai unggulan`}
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={plan.active}
                    onCheckedChange={() => toggle(plan, "active")}
                    aria-label={`Aktifkan plan ${plan.name}`}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Edit plan ${plan.name}`}
                    onClick={() => setEditing(plan)}
                  >
                    <Pencil /> Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <PlanForm
        plan={editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  )
}
