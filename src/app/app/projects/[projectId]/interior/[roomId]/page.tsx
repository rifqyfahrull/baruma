import { redirect } from "next/navigation"

export default async function RoomInteriorPage({
  params,
}: {
  params: Promise<{ projectId: string; roomId: string }>
}) {
  const { projectId, roomId } = await params
  redirect(`/app/projects/${projectId}/preview-3d?room=${encodeURIComponent(roomId)}`)
}
