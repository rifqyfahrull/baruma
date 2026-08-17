"use client"

import * as React from "react"

import type { BOQItem, Confidence, CostCategory } from "@/types"
import { COST_CATEGORIES } from "@/lib/constants"
import { formatIDR, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const CONF_LABEL: Record<Confidence, { label: string; cls: string }> = {
  low: { label: "Rendah", cls: "text-warning-foreground" },
  medium: { label: "Sedang", cls: "text-muted-foreground" },
  high: { label: "Tinggi", cls: "text-success" },
}

export function BOQTable({ items }: { items: BOQItem[] }) {
  const [cat, setCat] = React.useState<CostCategory | "all">("all")

  const cats = React.useMemo(() => {
    const set = new Set<CostCategory>()
    items.forEach((i) => set.add(i.category))
    return [...set]
  }, [items])

  const filtered = cat === "all" ? items : items.filter((i) => i.category === cat)
  const total = filtered.reduce((s, i) => s + i.totalIDR, 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={cat === "all"} onClick={() => setCat("all")}>
          Semua
        </FilterChip>
        {cats.map((c) => (
          <FilterChip key={c} active={cat === c} onClick={() => setCat(c)}>
            {COST_CATEGORIES[c]}
          </FilterChip>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kategori</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Volume</TableHead>
              <TableHead>Satuan</TableHead>
              <TableHead className="text-right">Harga satuan</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Keyakinan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((it) => (
              <TableRow key={it.id}>
                <TableCell>
                  <Badge variant="secondary" className="font-normal">
                    {COST_CATEGORIES[it.category]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="font-medium">{it.item}</span>
                  {it.notes && (
                    <span className="block text-xs text-muted-foreground">
                      {it.notes}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(it.volume)}
                </TableCell>
                <TableCell className="text-muted-foreground">{it.unit}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatIDR(it.unitPriceIDR)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatIDR(it.totalIDR)}
                </TableCell>
                <TableCell>
                  <span className={cn("text-xs", CONF_LABEL[it.confidence].cls)}>
                    {CONF_LABEL[it.confidence].label}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t bg-muted/40 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">
            {filtered.length} item{cat !== "all" ? ` · ${COST_CATEGORIES[cat]}` : ""}
          </span>
          <span className="font-semibold tabular-nums">{formatIDR(total)}</span>
        </div>
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
      )}
    >
      {children}
    </button>
  )
}
