"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckCircle2, Loader2 } from "lucide-react"

import { recoverUrl } from "@/lib/supabase/sso"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    // Recovery is brokered through tampil.dev (PKCE + allowlisted redirect):
    // it sends the email whose link returns to our /reset-password with a
    // recovery session already set via the shared `.tampil.dev` cookie. We show
    // the confirmation immediately (no email-enumeration signal) then redirect.
    setSent(true)
    window.location.href = recoverUrl(email, "/reset-password")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Reset password</CardTitle>
        <CardDescription>
          {sent
            ? "Tautan reset sedang dikirim."
            : "Masukkan email kamu, kami kirimkan tautan untuk mengatur ulang password."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="space-y-6">
            <div className="flex items-start gap-3 rounded-xl border border-success/25 bg-success/10 p-4">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
              <p className="text-sm text-foreground">
                Jika <span className="font-medium">{email}</span> terdaftar, kami mengirim
                tautan reset ke email itu. Cek kotak masuk (dan folder spam).
              </p>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Kembali ke halaman masuk</Link>
            </Button>
          </div>
        ) : (
          <>
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
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="animate-spin" />}
                Kirim tautan reset
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Ingat passwordmu?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Masuk
              </Link>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
