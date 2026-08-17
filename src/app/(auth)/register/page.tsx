"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { oauthLoginUrl } from "@/lib/supabase/sso"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { GoogleButton } from "@/components/auth/google-button"
import { Turnstile, TURNSTILE_SITE_KEY } from "@/components/auth/turnstile"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { track, usePageView } from "@/lib/analytics"

function RegisterForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get("next") || params.get("callbackUrl") || "/app/dashboard"
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [captchaToken, setCaptchaToken] = useState("")

  usePageView("signup_started", { source: "register" })

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (password.length < 8) {
      toast.error("Password minimal 8 karakter.")
      return
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      toast.error("Selesaikan verifikasi captcha dulu.")
      return
    }
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        ...(captchaToken ? { captchaToken } : {}),
      },
    })
    if (error) {
      setLoading(false)
      setCaptchaToken("")
      const msg = /already|registered|exists/i.test(error.message)
        ? "Email sudah terdaftar. Coba masuk."
        : "Gagal membuat akun. Coba lagi."
      toast.error(msg)
      return
    }
    // Email confirmation ON in Supabase → no session yet; user must verify.
    if (!data.session) {
      setLoading(false)
      setNeedsConfirm(true)
      return
    }
    track("signup_completed", { source: "register" })
    toast.success("Akun berhasil dibuat.")
    router.push(next)
    router.refresh()
  }

  if (needsConfirm) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Cek email kamu</CardTitle>
          <CardDescription>Satu langkah lagi untuk mengaktifkan akun.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-start gap-3 rounded-xl border border-success/25 bg-success/10 p-4">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
            <p className="text-sm text-foreground">
              Kami mengirim tautan verifikasi ke <span className="font-medium">{email}</span>.
              Klik tautannya, lalu masuk.
            </p>
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Ke halaman masuk</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Buat akun</CardTitle>
        <CardDescription>
          Mulai gratis dan susun konsep rumah pertamamu hari ini.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <GoogleButton
          label="Daftar dengan Google"
          onClick={() => {
            window.location.href = oauthLoginUrl("google", next)
          }}
          disabled={loading}
        />

        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          atau
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nama</Label>
            <Input
              id="name"
              type="text"
              required
              placeholder="Nama lengkap"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              placeholder="nama@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              required
              placeholder="Buat password (min. 8 karakter)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {TURNSTILE_SITE_KEY && (
            <Turnstile
              siteKey={TURNSTILE_SITE_KEY}
              onVerify={setCaptchaToken}
              onExpire={() => setCaptchaToken("")}
              onError={() => setCaptchaToken("")}
            />
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={loading || (!!TURNSTILE_SITE_KEY && !captchaToken)}
          >
            {loading && <Loader2 className="animate-spin" />}
            Buat akun
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Sudah punya akun?{" "}
          <Link href="/login" className="text-primary underline">
            Masuk
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  )
}
