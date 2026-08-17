import { Lightbulb, PiggyBank } from "lucide-react"

import type { BOQItem, CostCategory, FinishingLevel, Project } from "@/types"
import { FINISHING_LEVELS } from "@/lib/constants"
import { formatIDRCompact } from "@/lib/format"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function CostSavingSuggestions({
  items,
  midIDR,
  project,
  finishing,
}: {
  items: BOQItem[]
  midIDR: number
  project: Project
  finishing: FinishingLevel
}) {
  const sumCat = (c: CostCategory) =>
    items.filter((i) => i.category === c).reduce((s, i) => s + i.totalIDR, 0)
  const coreSum = items
    .filter((i) => i.category !== "kolam" && i.category !== "rooftop")
    .reduce((s, i) => s + i.totalIDR, 0)

  const suggestions: { title: string; saving: number; note?: string }[] = []

  if (finishing !== "standar") {
    const cur = FINISHING_LEVELS[finishing].perM2IDR
    const std = FINISHING_LEVELS.standar.perM2IDR
    suggestions.push({
      title: `Turunkan finishing ke ${FINISHING_LEVELS.standar.label}`,
      saving: coreSum * (1 - std / cur),
    })
  }
  const pool = sumCat("kolam")
  if (pool > 0) suggestions.push({ title: "Tunda pembangunan kolam", saving: pool })
  const rooftop = sumCat("rooftop")
  if (rooftop > 0) suggestions.push({ title: "Tanpa rooftop untuk tahap awal", saving: rooftop })
  if (project.floors >= 3)
    suggestions.push({
      title: "Kurangi 1 lantai",
      saving: midIDR / project.floors,
      note: "Perkiraan kasar, mengubah program ruang.",
    })

  const positive = suggestions.filter((s) => s.saving > 0).sort((a, b) => b.saving - a.saving)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="size-4 text-warning" />
          Cara menghemat
        </CardTitle>
      </CardHeader>
      <CardContent>
        {positive.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Layout sudah cukup efisien. Tidak ada saran penghematan besar.
          </p>
        ) : (
          <ul className="space-y-2">
            {positive.map((s, i) => (
              <li
                key={i}
                className="flex items-start justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{s.title}</p>
                  {s.note && (
                    <p className="text-xs text-muted-foreground">{s.note}</p>
                  )}
                </div>
                <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-success">
                  <PiggyBank className="size-4" />~{formatIDRCompact(s.saving)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
