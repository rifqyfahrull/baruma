"use client"

import * as React from "react"
import { Plus, Trash2 } from "lucide-react"

import type { BOQItem, CostCategory } from "@/types"
import { COST_CATEGORIES } from "@/lib/constants"
import { formatIDR } from "@/lib/format"
import { round1k } from "@/lib/rab/summarize"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const DEFAULT_CATEGORY: CostCategory = "struktur"

interface EditableBOQTableProps {
  items: BOQItem[]
  onChange: (items: BOQItem[]) => void
}

export function EditableBOQTable({ items, onChange }: EditableBOQTableProps) {
  function update(index: number, patch: Partial<BOQItem>) {
    const next = items.map((it, i) => (i === index ? { ...it, ...patch } : it))
    onChange(next)
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index))
  }

  function addRow() {
    const newItem: BOQItem = {
      id: `custom-${Math.random().toString(36).slice(2, 10)}`,
      category: DEFAULT_CATEGORY,
      item: "",
      volume: 1,
      unit: "ls",
      unitPriceIDR: 0,
      totalIDR: 0,
      confidence: "medium",
    }
    onChange([...items, newItem])
  }

  return (
    <div className="space-y-3">
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
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it, i) => {
              const liveTotal = round1k((isNaN(it.volume) ? 0 : it.volume) * (isNaN(it.unitPriceIDR) ? 0 : it.unitPriceIDR))
              return (
                <TableRow key={it.id}>
                  <TableCell>
                    <select
                      value={it.category}
                      onChange={(e) =>
                        update(i, { category: e.target.value as CostCategory })
                      }
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {(Object.keys(COST_CATEGORIES) as CostCategory[]).map((c) => (
                        <option key={c} value={c}>
                          {COST_CATEGORIES[c]}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={it.item}
                      onChange={(e) => update(i, { item: e.target.value })}
                      placeholder="Nama item"
                      className="h-8 min-w-[140px]"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={0}
                      value={it.volume}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        update(i, { volume: isNaN(v) ? 0 : v })
                      }}
                      className="h-8 w-24 text-right tabular-nums"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={it.unit}
                      onChange={(e) => update(i, { unit: e.target.value })}
                      className="h-8 w-16"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={0}
                      value={it.unitPriceIDR}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        update(i, { unitPriceIDR: isNaN(v) ? 0 : v })
                      }}
                      className="h-8 w-32 text-right tabular-nums"
                    />
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatIDR(liveTotal)}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(i)}
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">Hapus baris</span>
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <div className="border-t px-4 py-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRow}
            className="gap-1.5"
          >
            <Plus className="size-4" />
            Tambah baris
          </Button>
        </div>
      </div>
    </div>
  )
}
