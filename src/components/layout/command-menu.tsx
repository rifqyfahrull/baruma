"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  FolderKanban,
  HelpCircle,
  LayoutDashboard,
  Moon,
  Plus,
  Sun,
} from "lucide-react"
import { useTheme } from "next-themes"

import { useUIStore } from "@/stores/ui-store"
import { useProjects } from "@/lib/api/hooks"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"

export function CommandMenu() {
  const router = useRouter()
  const { setTheme, resolvedTheme } = useTheme()
  const open = useUIStore((s) => s.commandOpen)
  const setOpen = useUIStore((s) => s.setCommandOpen)
  const { data: projects } = useProjects()

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!useUIStore.getState().commandOpen)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [setOpen])

  const go = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Cari halaman, project, atau jalankan aksi cepat"
    >
      <CommandInput placeholder="Ketik perintah atau cari project…" />
      <CommandList>
        <CommandEmpty>Tidak ada hasil.</CommandEmpty>
        <CommandGroup heading="Navigasi">
          <CommandItem onSelect={() => go("/app/dashboard")}>
            <LayoutDashboard />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => go("/app/projects")}>
            <FolderKanban />
            Semua Project
          </CommandItem>
          <CommandItem onSelect={() => go("/app/projects/new")}>
            <Plus />
            Buat Project Baru
          </CommandItem>
          <CommandItem onSelect={() => go("/app/help")}>
            <HelpCircle />
            Bantuan
          </CommandItem>
        </CommandGroup>

        {projects && projects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Project">
              {projects.slice(0, 6).map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  onSelect={() => go(`/app/projects/${p.id}/brief`)}
                >
                  <FolderKanban />
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Tampilan">
          <CommandItem
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
              setOpen(false)
            }}
          >
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
            Ganti tema {resolvedTheme === "dark" ? "terang" : "gelap"}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
