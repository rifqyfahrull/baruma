"use client"

import { Search } from "lucide-react"

import { useUIStore } from "@/stores/ui-store"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/shared/theme-toggle"

export function AppTopbar() {
  const setCommandOpen = useUIStore((s) => s.setCommandOpen)

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-5" />

      <Button
        variant="outline"
        onClick={() => setCommandOpen(true)}
        className="text-muted-foreground h-8 w-full max-w-64 justify-start gap-2 px-2.5 font-normal"
      >
        <Search className="size-4" />
        <span className="truncate">Cari project…</span>
        <kbd className="ml-auto hidden items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[0.65rem] text-muted-foreground sm:inline-flex">
          ⌘K
        </kbd>
      </Button>

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
      </div>
    </header>
  )
}
