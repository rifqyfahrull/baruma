"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function ResetPasswordForm() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState<boolean | null>(null)

  // The tampil.dev broker set a recovery session via the shared `.tampil.dev`
  // cookie before forwarding here. Confirm we actually have one — otherwise the
  // user opened this page directly and there's nothing to update.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => setReady(!!data.user))
  }, [])

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
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      toast.error("Gagal memperbarui password. Minta tautan baru lalu coba lagi.")
      return
    }
    toast.success("Password diperbarui.")
    router.push("/app/dashboard")
    router.refresh()
  }

  if (ready === false) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Tautan tidak valid</CardTitle>
          <CardDescription>
            Sesi reset tidak ditemukan atau sudah kedaluwarsa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/forgot-password">Minta tautan reset baru</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Buat password baru</CardTitle>
        <CardDescription>Masukkan password baru untuk akunmu.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password baru</Label>
            <PasswordInput
              id="password"
              required
              placeholder="Min. 8 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Ulangi password</Label>
            <PasswordInput
              id="confirm"
              required
              placeholder="Ketik ulang password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading || ready === null}>
            {(loading || ready === null) && <Loader2 className="animate-spin" />}
            Simpan password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
