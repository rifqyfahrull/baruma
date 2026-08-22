import { ProjectBar } from "@/components/project/project-bar"
import { LayoutConflictBanner } from "@/components/project/layout-conflict-banner"
import { ProjectAgentShell } from "@/components/assistant/project-agent-shell"

export default async function ProjectWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Banner konflik autosave HARUS tetap terlihat di semua state (termasuk
          mode fokus, di mana ProjectBar sendiri mengecil jadi pill) — lihat
          komentar di layout-conflict-banner.tsx: kehilangan data tidak boleh
          tersembunyi di mode apa pun. */}
      <LayoutConflictBanner projectId={projectId} />
      <ProjectBar projectId={projectId} />
      <div className="flex-1">{children}</div>
      <ProjectAgentShell projectId={projectId} />
    </div>
  )
}
