import { data } from "@/lib/data"
import { briefToFormValues } from "@/lib/brief/brief-to-form"
import type { Project } from "@/types"

/**
 * Duplikat project: buat project baru dari brief sumber (nama + " (Salinan)"),
 * lalu salin denah (layout) & interior bila ada. Menyusun panggilan data layer
 * yang sudah ada sehingga jalan di mock maupun HTTP backend — pola sama dengan
 * "Simpan sebagai salinan" pada LayoutConflictBanner.
 *
 * Menggantikan tombol "Duplikat" lama yang hanya menampilkan toast mock tanpa
 * benar-benar menduplikasi.
 */
export async function duplicateProject(projectId: string): Promise<Project> {
  const [project, brief] = await Promise.all([
    data.getProject(projectId),
    data.getBrief(projectId),
  ])
  if (!project || !brief) {
    throw new Error("Project atau brief sumber tidak ditemukan.")
  }

  const created = await data.createProject({
    ...briefToFormValues(brief, project),
    name: `${project.name} (Salinan)`,
  })

  // Salin denah: GET layout project baru dulu (lazy-generate + revision awal),
  // lalu timpa dengan denah sumber memakai identitas layout project baru.
  const sourceLayout = await data.getLayoutDocument(projectId)
  if (sourceLayout) {
    const target = await data.getLayoutDocument(created.project.id)
    if (target) {
      await data.saveLayout(created.project.id, {
        layout: {
          ...sourceLayout.layout,
          id: target.layout.id,
          projectId: target.layout.projectId,
          versionId: target.layout.versionId,
        },
        expectedRevision: target.revision,
      })
    }
  }

  // Salin interior (furniture) bila ada — room id sama karena denah disalin apa
  // adanya, jadi plan interior tetap valid.
  const interior = await data.getInterior(projectId)
  if (interior) {
    await data.saveInterior(created.project.id, interior)
  }

  return created.project
}
