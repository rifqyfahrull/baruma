import { redirect } from "next/navigation"

export default async function InteriorPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ room?: string | string[] | undefined }>
}) {
  const { projectId } = await params
  const { room: rawRoom } = await searchParams
  const room = Array.isArray(rawRoom) ? rawRoom[0] : rawRoom
  const roomQuery = room ? `?room=${encodeURIComponent(room)}` : ""
  redirect(`/app/projects/${projectId}/preview-3d${roomQuery}`)
}
