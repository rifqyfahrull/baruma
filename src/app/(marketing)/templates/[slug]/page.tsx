import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { getTemplateBySlug } from "@/lib/server/repo/templates"
import { TemplateViewer } from "@/components/templates/template-viewer"

// Admin bisa mengubah/menonaktifkan template kapan saja — ISR 5 menit
// (bukan force-dynamic); mutasi admin memanggil
// revalidatePath("/templates/"+slug) (lama & baru bila slug berubah) agar
// perubahan tampil instan tanpa menunggu jendela revalidate ini.
export const revalidate = 300

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const template = await getTemplateBySlug(slug, { activeOnly: true }).catch(() => null)
  if (!template) return { title: "Template tidak ditemukan" }
  return {
    title: template.name,
    description: template.description ?? `Contoh desain rumah ${template.name} dari Baruma.`,
  }
}

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const template = await getTemplateBySlug(slug, { activeOnly: true }).catch(() => null)
  if (!template) notFound()

  return <TemplateViewer template={template} />
}
