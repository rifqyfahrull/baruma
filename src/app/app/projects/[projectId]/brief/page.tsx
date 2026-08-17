"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  Download,
  FileText,
  Info,
  ShieldAlert,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/shared/empty-state"
import { BriefAssistant } from "@/components/project/brief-assistant"
import { printBrief } from "@/lib/brief/print-brief"
import { useBrief, useGenerateAlternatives, useProject } from "@/lib/api/hooks"
import { COPY, PRIORITIES, ROOM_TYPES } from "@/lib/constants"
import { formatArea, formatNumber } from "@/lib/format"
import type { Orientation, RiskWarning, Severity, SizePreference } from "@/types"

const ORIENTATION_LABEL: Record<Orientation, string> = {
  north: "Utara",
  east: "Timur",
  south: "Selatan",
  west: "Barat",
  unknown: "Belum ditentukan",
}

const SIZE_LABEL: Record<SizePreference, string> = {
  small: "Kecil",
  standard: "Standar",
  large: "Luas",
}

function RiskIcon({ level }: { level: Severity }) {
  if (level === "danger") {
    return <ShieldAlert className="size-4 text-destructive" aria-hidden />
  }
  if (level === "warning") {
    return <AlertTriangle className="size-4 text-warning" aria-hidden />
  }
  return <Info className="size-4 text-info" aria-hidden />
}

function riskRowClass(level: Severity): string {
  if (level === "danger") return "border-destructive/25 bg-destructive/5"
  if (level === "warning") return "border-warning/25 bg-warning/10"
  return "border-info/25 bg-info/10"
}

function DefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  )
}

function BriefSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="space-y-4">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </div>
  )
}

export default function BriefPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()
  const { data: brief, isLoading } = useBrief(projectId)
  const { data: project } = useProject(projectId)
  const generate = useGenerateAlternatives(projectId)

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
        <BriefSkeleton />
      </div>
    )
  }

  if (!brief) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
        <EmptyState
          icon={FileText}
          title="Brief belum tersedia"
          description="Brief untuk proyek ini belum dibuat. Coba mulai dari pembuatan proyek baru terlebih dahulu."
          action={
            <Button asChild variant="outline">
              <Link href="/app">Kembali ke daftar proyek</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const site = brief.site
  const hasStructuralRisk = brief.risks.some(
    (r: RiskWarning) => r.category === "structural"
  )

  async function handleGenerate() {
    try {
      await generate.mutateAsync()
      toast.success("Alternatif berhasil disusun.")
      router.push(`/app/projects/${projectId}/alternatives`)
    } catch {
      toast.error("Gagal menyusun alternatif. Coba lagi sebentar.")
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* MAIN */}
        <div className="space-y-6">
          {/* Ringkasan */}
          <Card>
            <CardHeader>
              <CardTitle>Ringkasan</CardTitle>
              <CardDescription>
                Ringkasan singkat dari kebutuhan kamu untuk proyek ini.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-foreground">
                {brief.summary}
              </p>
            </CardContent>
          </Card>

          {/* Data tanah */}
          <Card>
            <CardHeader>
              <CardTitle>Data tanah</CardTitle>
              <CardDescription>
                Ukuran dan kondisi lahan yang dipakai sebagai dasar desain.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DefRow label="Lebar" value={`${formatNumber(site.widthM)} m`} />
                <DefRow
                  label="Panjang"
                  value={`${formatNumber(site.depthM)} m`}
                />
                <DefRow label="Luas" value={formatArea(site.areaM2)} />
                <DefRow
                  label="Orientasi depan"
                  value={
                    site.frontOrientation
                      ? ORIENTATION_LABEL[site.frontOrientation]
                      : "Belum ditentukan"
                  }
                />
                <DefRow
                  label="Sisi menempel"
                  value={
                    site.sidesAttached != null
                      ? `${formatNumber(site.sidesAttached)} sisi`
                      : "-"
                  }
                />
                <DefRow
                  label="Lebar jalan depan"
                  value={
                    site.frontRoadWidthM != null
                      ? `${formatNumber(site.frontRoadWidthM)} m`
                      : "-"
                  }
                />
              </dl>
              {site.notes && (
                <>
                  <Separator className="my-4" />
                  <p className="text-sm text-muted-foreground">{site.notes}</p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Prioritas */}
          <Card>
            <CardHeader>
              <CardTitle>Prioritas</CardTitle>
              <CardDescription>
                Hal-hal yang paling penting buat kamu di rumah ini.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {brief.priorities.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada prioritas yang dipilih.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {brief.priorities.map((p) => (
                    <Badge key={p} variant="secondary">
                      {PRIORITIES[p]}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Program ruang */}
          <Card>
            <CardHeader>
              <CardTitle>Program ruang</CardTitle>
              <CardDescription>
                Daftar ruangan yang ingin dimasukkan ke dalam desain.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ruang</TableHead>
                    <TableHead>Jumlah</TableHead>
                    <TableHead>Lantai</TableHead>
                    <TableHead>Ukuran</TableHead>
                    <TableHead>Catatan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {brief.spaceProgram.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">
                            {ROOM_TYPES[item.roomType].label}
                          </span>
                          {item.required ? (
                            <Badge variant="outline" className="text-success">
                              Wajib
                            </Badge>
                          ) : (
                            <Badge variant="outline">Opsional</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{formatNumber(item.quantity)}</TableCell>
                      <TableCell>{item.preferredFloor ?? "-"}</TableCell>
                      <TableCell>
                        {item.sizePreference
                          ? SIZE_LABEL[item.sizePreference]
                          : "Standar"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.notes ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Asumsi */}
          <Card>
            <CardHeader>
              <CardTitle>Asumsi</CardTitle>
              <CardDescription>
                Hal-hal yang kami anggap benar saat menyusun konsep ini.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {brief.assumptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada asumsi yang dicatat.
                </p>
              ) : (
                <ul className="space-y-2">
                  {brief.assumptions.map((a, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-sm text-foreground"
                    >
                      <span
                        className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground"
                        aria-hidden
                      />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Batasan */}
          <Card>
            <CardHeader>
              <CardTitle>Batasan</CardTitle>
              <CardDescription>
                Hal-hal yang membatasi pilihan desain di proyek ini.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {brief.constraints.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada batasan yang dicatat.
                </p>
              ) : (
                <ul className="space-y-2">
                  {brief.constraints.map((c, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-sm text-foreground"
                    >
                      <span
                        className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground"
                        aria-hidden
                      />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Catatan risiko */}
          <Card>
            <CardHeader>
              <CardTitle>Catatan risiko</CardTitle>
              <CardDescription>
                Hal-hal yang perlu kamu perhatikan sebelum lanjut.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {hasStructuralRisk && (
                <div className="flex gap-3 rounded-lg border border-warning/25 bg-warning/10 p-3">
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0 text-warning"
                    aria-hidden
                  />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-foreground">
                      Perlu tinjauan struktur
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {COPY.structuralWarning}
                    </p>
                  </div>
                </div>
              )}
              {brief.risks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Tidak ada catatan risiko khusus untuk saat ini.
                </p>
              ) : (
                brief.risks.map((risk) => (
                  <div
                    key={risk.id}
                    className={`flex gap-3 rounded-lg border p-3 ${riskRowClass(
                      risk.level
                    )}`}
                  >
                    <span className="mt-0.5 shrink-0">
                      <RiskIcon level={risk.level} />
                    </span>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">
                        {risk.title}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {risk.message}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {/* CTA */}
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" aria-hidden />
                Lanjut ke alternatif
              </CardTitle>
              <CardDescription>
                Brief sudah siap. Saatnya melihat beberapa pilihan desain yang
                disusun dari kebutuhan kamu.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                onClick={handleGenerate}
                disabled={generate.isPending}
              >
                {generate.isPending ? (
                  "Menyusun alternatif..."
                ) : (
                  <>
                    Generate Alternatif
                    <ArrowRight className="size-4" aria-hidden />
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* AI Assistant */}
          <BriefAssistant projectId={projectId} />

          {/* Aksi */}
          <Card>
            <CardHeader>
              <CardTitle>Aksi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => router.push(`/app/projects/${projectId}/brief/edit`)}
              >
                <FileText className="size-4" aria-hidden />
                Edit brief
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => printBrief(brief, project ?? undefined)}
              >
                <Download className="size-4" aria-hidden />
                Export brief PDF
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
