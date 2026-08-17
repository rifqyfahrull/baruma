"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { Ghost, LogOut } from "lucide-react"
import { toast } from "sonner"

import {
  clearPhantomSession,
  getPhantomProfile,
  getPhantomToken,
  readPhantomSessionFromHash,
  setPhantomSession,
  type PhantomProfile,
} from "@/lib/auth/phantom-session"
import { Button } from "@/components/ui/button"

export function PhantomSessionBootstrap() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const [profile, setProfile] = React.useState<PhantomProfile | null>(null)

  React.useEffect(() => {
    const incoming = readPhantomSessionFromHash()
    if (incoming) {
      setPhantomSession(incoming.token, incoming.profile)
      queryClient.clear()
      setTimeout(() => setProfile(incoming.profile), 0)
      toast.success(
        incoming.profile
          ? `Phantom login aktif sebagai ${incoming.profile.name}.`
          : "Phantom login aktif."
      )
      router.refresh()
      return
    }

    if (getPhantomToken()) {
      const timer = setTimeout(() => setProfile(getPhantomProfile()), 0)
      return () => clearTimeout(timer)
    }
  }, [queryClient, router])

  React.useEffect(() => {
    if (getPhantomToken() && pathname.startsWith("/app/admin")) {
      router.replace("/app/dashboard")
    }
  }, [pathname, router])

  React.useEffect(() => {
    function sync() {
      setProfile(getPhantomToken() ? getPhantomProfile() : null)
    }
    window.addEventListener("baruma:phantom-session-changed", sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener("baruma:phantom-session-changed", sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  if (!getPhantomToken()) return null

  function stopPhantom() {
    clearPhantomSession()
    queryClient.clear()
    toast.success("Phantom login dihentikan di tab ini.")
    router.refresh()
  }

  return (
    <div className="fixed inset-x-0 bottom-3 z-50 flex justify-center px-3">
      <div className="flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-md border border-warning/40 bg-background px-3 py-2 text-xs shadow-lg">
        <Ghost className="size-4 shrink-0 text-warning" />
        <span className="truncate">
          Phantom sebagai{" "}
          <span className="font-medium">
            {profile ? `${profile.name} (${profile.email})` : "user"}
          </span>
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={stopPhantom}
        >
          <LogOut className="size-3.5" />
          Stop
        </Button>
      </div>
    </div>
  )
}
