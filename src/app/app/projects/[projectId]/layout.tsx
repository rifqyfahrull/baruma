import { ProjectWorkspaceHeader } from "@/components/project/project-workspace-header"
import { ProjectTabs } from "@/components/project/project-tabs"
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
      <ProjectWorkspaceHeader projectId={projectId} />
      <ProjectTabs projectId={projectId} />
      <div className="flex-1">{children}</div>
      <ProjectAgentShell projectId={projectId} />
    </div>
  )
}
