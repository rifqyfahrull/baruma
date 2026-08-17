"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { projectNav } from "@/lib/nav"
import { usePreviewStore } from "@/stores/preview-store"
import { cn } from "@/lib/utils"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname()
  const items = projectNav(projectId)
  const cleanMode = usePreviewStore((s) => s.cleanMode)

  // Mode bersih (preview 3D): tab bar ikut disembunyikan bersama header.
  if (cleanMode) return null

  return (
    <ScrollArea className="w-full border-b">
      <nav className="flex items-center gap-1 px-2 sm:px-4">
        {items.map((item) => {
          const active = pathname === item.href
          const base =
            "relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors"

          if (item.disabled) {
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      base,
                      "cursor-not-allowed text-muted-foreground/60"
                    )}
                  >
                    <item.icon className="size-4" />
                    {item.title}
                    <span className="rounded bg-muted px-1 py-0.5 text-[0.6rem] font-medium text-muted-foreground">
                      {item.badge}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Tersedia di milestone berikutnya</TooltipContent>
              </Tooltip>
            )
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                base,
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className="size-4" />
              {item.title}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </Link>
          )
        })}
      </nav>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  )
}
