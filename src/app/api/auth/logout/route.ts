import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

function cookieDomain(): string | undefined {
  return process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN || undefined
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut()
  } catch {
    // Sesi mungkin sudah invalid / expired, lanjutkan penghapusan cookie
  }

  const response = NextResponse.json({ success: true })

  // Hapus semua varian cookie sesi Supabase (baik host-scoped maupun domain .tampil.dev)
  for (const cookie of request.cookies.getAll()) {
    if (!cookie.name.startsWith("sb-")) continue
    response.headers.append("Set-Cookie", `${cookie.name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`)
    const domain = cookieDomain()
    if (domain) {
      response.headers.append(
        "Set-Cookie",
        `${cookie.name}=; Max-Age=0; Path=/; Domain=${domain}; HttpOnly; SameSite=Lax`
      )
    }
  }

  return response
}
