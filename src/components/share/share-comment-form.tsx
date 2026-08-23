"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, Send } from "lucide-react"
import { toast } from "sonner"

import type { Comment } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

/**
 * Public comment box on `/s/[token]` — no auth, so the visitor types their
 * own name (persisted with the comment as `author`, unlike the owner-side
 * review page where every comment reads "Kamu"). Posts to
 * `POST /api/v1/share/[token]/comments` (rate-limited 5/min/IP server-side)
 * then `router.refresh()`s the (server-rendered) page to show it — this page
 * has no client cache to optimistically update.
 */
export function ShareCommentForm({ token, comments }: { token: string; comments: Comment[] }) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [body, setBody] = React.useState("")
  const [pending, setPending] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !body.trim() || pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/v1/share/${token}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), body: body.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? "Gagal mengirim komentar")
      }
      setBody("")
      toast.success("Komentar terkirim.")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim komentar.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4">
      {comments.length > 0 && (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{c.author}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(c.createdAt).toLocaleDateString("id-ID", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-2" aria-label="Tulis komentar">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nama kamu"
          maxLength={60}
          required
          aria-label="Nama"
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Tulis komentar atau masukan…"
          maxLength={2000}
          rows={3}
          required
          aria-label="Komentar"
        />
        <Button type="submit" size="sm" disabled={pending || !name.trim() || !body.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Kirim komentar
        </Button>
      </form>
    </div>
  )
}
