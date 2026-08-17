"use client"

import * as React from "react"
import { Check, Loader2, Send } from "lucide-react"

import type { Review } from "@/types"
import { REVIEW_ROLES } from "@/lib/constants"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

export function CommentThread({
  review,
  onAdd,
  onToggle,
  adding,
}: {
  review: Review
  onAdd: (body: string) => void
  onToggle: (id: string) => void
  adding?: boolean
}) {
  const [text, setText] = React.useState("")

  const submit = () => {
    const t = text.trim()
    if (!t) return
    onAdd(t)
    setText("")
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {review.comments.map((c) => (
          <li key={c.id} className="flex gap-3">
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary/10 text-xs text-primary">
                {initials(c.author)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 rounded-lg border p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{c.author}</span>
                {c.role && (
                  <Badge variant="secondary" className="text-[0.65rem]">
                    {REVIEW_ROLES[c.role]}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatRelative(c.createdAt)}
                </span>
                <button
                  type="button"
                  onClick={() => onToggle(c.id)}
                  className={cn(
                    "ml-auto inline-flex items-center gap-1 text-xs",
                    c.resolved ? "text-success" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Check className="size-3" />
                  {c.resolved ? "Teratasi" : "Tandai teratasi"}
                </button>
              </div>
              <p className={cn("text-sm", c.resolved && "text-muted-foreground line-through")}>
                {c.body}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tulis catatan atau pertanyaan…"
          rows={2}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={submit} disabled={adding || !text.trim()}>
            {adding ? <Loader2 className="animate-spin" /> : <Send />}
            Kirim
          </Button>
        </div>
      </div>
    </div>
  )
}
