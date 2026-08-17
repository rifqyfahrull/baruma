import { LandingPage } from "@/components/landing/landing-page"
import { listTemplates } from "@/lib/server/repo/templates"

// Admin bisa mengubah/menonaktifkan template kapan saja — ISR 5 menit
// (bukan force-dynamic) supaya request publik tidak selalu hit DB; mutasi
// admin (POST/PATCH/DELETE templates) memanggil revalidatePath agar
// perubahan tampil instan tanpa menunggu jendela revalidate ini.
export const revalidate = 300

export default async function HomePage() {
  const templates = await listTemplates(true).catch(() => [])
  return <LandingPage templates={templates} />
}
