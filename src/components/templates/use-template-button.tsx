"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { ApiError } from "@/lib/data/http"
import { useCreateProjectFromTemplate } from "@/lib/api/hooks"
import { track } from "@/lib/analytics"
import { Button } from "@/components/ui/button"

/**
 * "Gunakan template ini" CTA — public template gallery/detail (WS-D §1).
 * Logged-out visitors (real backend: `createProjectFromTemplate` 401s) get
 * redirected to `/login?next=/templates/{slug}` (the login page already
 * honors `?next`, see src/app/(auth)/login/page.tsx) so they land right back
 * here after signing in.
 */
export function UseTemplateButton({
  slug,
  size = "lg",
  variant = "default",
  className,
}: {
  slug: string
  size?: "sm" | "lg"
  variant?: "default" | "outline"
  className?: string
}) {
  const router = useRouter()
  const create = useCreateProjectFromTemplate()

  async function handleClick() {
    track("template_use_clicked", { slug })
    try {
      const { projectId } = await create.mutateAsync(slug)
      router.push(`/app/projects/${projectId}/editor`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/templates/${slug}`)}`)
        return
      }
      toast.error("Gagal membuat project dari template ini. Coba lagi sebentar.")
    }
  }

  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      onClick={handleClick}
      disabled={create.isPending}
      data-testid="use-template-button"
    >
      {create.isPending ? <Loader2 className="animate-spin" /> : null}
      Gunakan template ini
      {!create.isPending && <ArrowRight className="ml-1.5 size-4" />}
    </Button>
  )
}
