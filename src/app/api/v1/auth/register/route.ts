import { z } from "zod"
import { nanoid } from "nanoid"
import { after } from "next/server"
import { adminEmailAllowlist, hashPassword } from "@/lib/server/auth-server"
import { createProfile, getProfileByEmail } from "@/lib/server/repo/profiles"
import { signToken } from "@/lib/server/auth-server"
import { ok, err, handleError } from "@/lib/server/response"
import { rateLimitGuard } from "@/lib/server/rate-limit"
import { sendEmail } from "@/lib/server/email"
import { welcomeEmail } from "@/lib/server/email-templates"

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password minimal 8 karakter"),
  name: z.string().min(1),
})

export async function POST(request: Request): Promise<Response> {
  try {
    // Rate-limit pembuatan akun: 5 / jam per IP (audit #6).
    const limited = rateLimitGuard(request, {
      scope: "register-ip",
      limit: 5,
      windowMs: 60 * 60_000,
    })
    if (limited) return limited

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Invalid request")
    }
    const { email, password, name } = parsed.data

    // Reject registration on an ADMIN_EMAILS-listed address before touching the
    // DB. requireAdmin() no longer trusts a bare email match for accounts
    // without an SSO link, but this still stops an attacker from squatting on
    // an admin's email as a local-password account (which resolveBarumaProfile
    // could later link to that admin's real SSO identity). The error is
    // identical to the "already registered" case so this isn't an oracle for
    // discovering which emails are admin emails.
    const existing = await getProfileByEmail(email)
    if (existing || adminEmailAllowlist().includes(email.toLowerCase())) {
      return err(409, "Email already registered")
    }

    const passwordHash = await hashPassword(password)
    const id = `usr-${nanoid(10)}`
    const profile = await createProfile({ id, email, name, passwordHash })
    const accessToken = await signToken(profile.id)

    // Email selamat datang di BACKGROUND (after response) — sendEmail sendiri
    // tidak pernah throw (no-op ke false saat RESEND_API_KEY/EMAIL_FROM
    // kosong), tapi tetap dijalankan lewat after() supaya kegagalan/latensi
    // provider email TIDAK PERNAH menunda atau menggagalkan registrasi.
    after(async () => {
      await sendEmail({
        to: profile.email,
        subject: "Selamat datang di Baruma",
        html: welcomeEmail(profile.name),
      })
    })

    return ok({
      user: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        plan: profile.plan,
      },
      accessToken,
    })
  } catch (e) {
    return handleError(e)
  }
}
