"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import {
  createSupabaseBrowserClient,
  supabaseBrowserConfigured,
} from "@/lib/supabase/client"
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

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get("next") || params.get("callbackUrl") || "/app/dashboard"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [captchaToken, setCaptchaToken] = useState("")

  async function login(creds: { email: string; password: string }) {
    // Supabase-less dev/e2e (mock mode): middleware leaves /app open, so just
    // navigate — there's no real session to establish. Prod always has the keys.
    if (!supabaseBrowserConfigured()) {
      toast.success("Berhasil masuk.")
      router.push(next)
      router.refresh()
      return
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      toast.error("Selesaikan verifikasi captcha dulu.")
      return
    }
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithPassword({
      ...creds,
      options: captchaToken ? { captchaToken } : undefined,
    })
    if (error) {
      setLoading(false)
      setCaptchaToken("")
      toast.error("Email atau password salah.")
      return
    }
    toast.success("Berhasil masuk.")
    router.push(next)
    router.refresh()
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    void login({ email, password })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Masuk</CardTitle>
        <CardDescription>
          Lanjutkan ke workspace untuk meneruskan project rumahmu.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <GoogleButton
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
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-sm text-primary hover:underline"
              >
                Lupa password?
              </Link>
            </div>
            <PasswordInput
              id="password"
              required
              placeholder="Masukkan password"
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
            Masuk
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() =>
              void login({ email: "demo@baruma.id", password: "demo-baruma-2026" })
            }
            disabled={loading}
          >
            Lanjut sebagai demo
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Belum punya akun?{" "}
          <Link href="/register" className="text-primary underline">
            Daftar
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
