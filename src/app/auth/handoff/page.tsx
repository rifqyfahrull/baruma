'use client'

/**
 * Cross-domain SSO handoff landing page. tampil.dev's /auth/callback redirects
 * here (see docs/superpowers/plans/2026-08-22-cross-domain-sso-handoff.md,
 * tampil.dev repo) after minting a one-time Supabase magic-link token for a
 * user who just completed Google login through the tampil.dev broker. This
 * page verifies that token with Baruma's OWN Supabase client, which creates a
 * session scoped to THIS app's own origin (NEXT_PUBLIC_AUTH_COOKIE_DOMAIN is
 * unset here, so the client already scopes cookies host-only — see
 * src/lib/supabase/client.ts).
 *
 * Only reachable via a valid, single-use token_hash minted by tampil.dev —
 * this page does not accept or trust any other identity claim in the URL.
 *
 *   /auth/handoff?token_hash=<...>&type=magiclink&final=<encoded-path>
 */
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export default function AuthHandoffPage() {
  return (
    <Suspense fallback={<Loading />}>
      <HandoffHandler />
    </Suspense>
  )
}

function Loading() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Menyelesaikan login...</p>
      </div>
    </div>
  )
}

function HandoffHandler() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const tokenHash = params?.get('token_hash')
    const type = params?.get('type')
    const final = params?.get('final') || '/home'

    if (!tokenHash || type !== 'magiclink') {
      setError('Tautan login tidak valid. Silakan ulangi dari halaman login.')
      return
    }

    const supabase = createSupabaseBrowserClient()
    supabase.auth
      .verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
      .then(({ error: verifyError }) => {
        if (verifyError) {
          setError('Login gagal diverifikasi. Silakan ulangi dari halaman login.')
          return
        }
        router.replace(final)
      })
      .catch(() => {
        setError('Koneksi gagal. Silakan ulangi dari halaman login.')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <div className="text-center px-6">
          <p className="text-red-400 text-sm max-w-sm">{error}</p>
          <button
            onClick={() => router.replace('/login')}
            className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm"
          >
            Ke halaman login
          </button>
        </div>
      </div>
    )
  }

  return <Loading />
}
