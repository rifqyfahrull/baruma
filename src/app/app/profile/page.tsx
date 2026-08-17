"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { useCurrentUser, useUpdateProfileName } from "@/lib/api/hooks"
import {
  createSupabaseBrowserClient,
  supabaseBrowserConfigured,
} from "@/lib/supabase/client"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function ProfilePage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Profil"
        description="Kelola nama tampilan dan password akunmu."
      />
      <ProfileNameCard />
      <ProfilePasswordCard />
    </div>
  )
}

function ProfileNameCard() {
  const { data: user, isLoading } = useCurrentUser()
  const [name, setName] = React.useState("")
  // Adjust state during render (React's documented alternative to an
  // effect) when the loaded/saved name differs from what we last synced —
  // pre-fills the input once data.getCurrentUser() resolves, and re-syncs
  // after a successful save, without clobbering in-progress typing.
  const [syncedName, setSyncedName] = React.useState<string | undefined>(
    undefined
  )
  const updateName = useUpdateProfileName()

  if (user && user.name !== syncedName) {
    setSyncedName(user.name)
    setName(user.name)
  }

  const trimmed = name.trim()
  const invalid = trimmed.length < 2
  const unchanged = user ? trimmed === user.name.trim() : true

  function handleSave() {
    if (invalid || unchanged || updateName.isPending) return
    updateName.mutate(trimmed, {
      onSuccess: () => {
        toast.success("Nama diperbarui.")
      },
      onError: () => {
        toast.error("Gagal memperbarui nama.")
      },
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nama tampilan</CardTitle>
        <CardDescription>
          Nama ini muncul di menu akun dan dokumen project.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="profile-name">Nama</Label>
        {isLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleSave()
              }
            }}
            maxLength={120}
          />
        )}
        {!isLoading && invalid && (
          <p className="text-xs text-destructive">Nama minimal 2 karakter.</p>
        )}
      </CardContent>
      <CardFooter>
        <Button
          onClick={handleSave}
          disabled={invalid || unchanged || updateName.isPending || isLoading}
        >
          {updateName.isPending && <Loader2 className="animate-spin" />}
          Simpan
        </Button>
      </CardFooter>
    </Card>
  )
}

function ProfilePasswordCard() {
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [loading, setLoading] = React.useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (password.length < 8) {
      toast.error("Password minimal 8 karakter.")
      return
    }
    if (password !== confirm) {
      toast.error("Konfirmasi password tidak cocok.")
      return
    }
    if (!supabaseBrowserConfigured()) {
      toast.error("Ganti password tidak tersedia di mode ini.")
      return
    }
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      toast.error("Gagal memperbarui password.")
      return
    }
    toast.success("Password diperbarui.")
    setPassword("")
    setConfirm("")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Ganti password akun. Kamu tetap login di perangkat ini setelahnya.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="change-password-form"
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="new-password">Password baru</Label>
            <PasswordInput
              id="new-password"
              required
              placeholder="Min. 8 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Ulangi password</Label>
            <PasswordInput
              id="confirm-password"
              required
              placeholder="Ketik ulang password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </form>
      </CardContent>
      <CardFooter>
        <Button type="submit" form="change-password-form" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          Simpan password
        </Button>
      </CardFooter>
    </Card>
  )
}
