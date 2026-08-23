import type { Metadata } from "next"
import Link from "next/link"
import { Layers, MapPin, Ruler } from "lucide-react"

import { listTemplates } from "@/lib/server/repo/templates"
import { LayoutThumbnail } from "@/components/shared/layout-thumbnail"
import { HOUSE_STYLES } from "@/lib/constants"
import { formatArea } from "@/lib/format"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { UseTemplateButton } from "@/components/templates/use-template-button"

export const metadata: Metadata = {
  title: "Galeri Template",
  description:
    "Jelajahi contoh desain rumah siap pakai dari Baruma — lihat denah 2D, model 3D, dan brief lengkapnya tanpa perlu masuk akun.",
}

// Admin bisa menambah/mengubah template kapan saja — ISR 5 menit (bukan
// force-dynamic); mutasi admin (POST/PATCH/DELETE templates) memanggil
// revalidatePath("/templates") agar perubahan tampil instan.
export const revalidate = 300

export default async function TemplatesPage() {
  const templates = await listTemplates(true).catch(() => [])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <header className="max-w-2xl">
        <h1 className="font-serif-display text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Galeri template desain rumah
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Lihat denah 2D, model 3D, dan brief lengkap dari contoh desain
          Baruma — tanpa perlu masuk akun.
        </p>
      </header>

      {templates.length === 0 ? (
        <div className="mt-14 rounded-2xl border border-dashed p-12 text-center">
          <p className="text-lg font-medium text-foreground">Belum ada template</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Template akan tampil di sini setelah kurasi tim kami selesai.
          </p>
        </div>
      ) : (
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Card
              key={t.id}
              data-testid={`template-card-${t.slug}`}
              className="group gap-0 overflow-hidden pt-0 transition-shadow hover:shadow-md"
            >
              <Link href={`/templates/${t.slug}`} className="block">
                <LayoutThumbnail
                  variant={t.thumbnail}
                  label={`Denah ${t.name}`}
                  className="aspect-[16/10] border-b"
                />
                <CardContent className="space-y-2.5 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="truncate font-semibold leading-snug group-hover:text-primary">
                      {t.name}
                    </h2>
                    {t.style && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {HOUSE_STYLES[t.style]}
                      </span>
                    )}
                  </div>

                  {(t.city || t.province) && (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {[t.city, t.province].filter(Boolean).join(", ")}
                      </span>
                    </p>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Ruler className="size-3.5" />
                      {formatArea(t.site.areaM2)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Layers className="size-3.5" />
                      {t.floors} lantai{t.rooftop ? " + rooftop" : ""}
                    </span>
                  </div>

                  {t.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{t.description}</p>
                  )}
                </CardContent>
              </Link>
              <CardFooter className="px-4 pb-4">
                <UseTemplateButton slug={t.slug} size="sm" variant="outline" className="w-full" />
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
