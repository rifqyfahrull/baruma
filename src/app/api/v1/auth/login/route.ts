import { z } from "zod"
import {
  verifyPassword,
  verifyPasswordConstantTime,
  signToken,
} from "@/lib/server/auth-server"
import {
  getCredentialByEmail,
  getProfileByEmail,
} from "@/lib/server/repo/profiles"
import { ok, err, handleError } from "@/lib/server/response"
import { rateLimitGuard } from "@/lib/server/rate-limit"

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(request: Request): Promise<Response> {
  try {
    // Rate-limit brute-force: 10 percobaan / 5 menit per IP (audit #6).
    const ipLimited = rateLimitGuard(request, {
      scope: "login-ip",
      limit: 10,
      windowMs: 5 * 60_000,
    })
    if (ipLimited) return ipLimited

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return err(400, parsed.error.issues[0]?.message ?? "Invalid request")
    }
    const { email, password } = parsed.data

    // Rate-limit per AKUN (lebih ketat): 5 percobaan / 5 menit per email —
    // membatasi password-spraying dari banyak IP terhadap satu akun.
    const acctLimited = rateLimitGuard(request, {
      scope: "login-acct",
      limit: 5,
      windowMs: 5 * 60_000,
      keyExtra: email.toLowerCase(),
    })
    if (acctLimited) return acctLimited

    const credential = await getCredentialByEmail(email)
    if (!credential || !credential.password_hash) {
      // Run constant-time verification to prevent timing oracle attacks
      await verifyPasswordConstantTime(password)
      return err(401, "Invalid credentials")
    }

    const valid = await verifyPassword(credential.password_hash, password)
    if (!valid) {
      return err(401, "Invalid credentials")
    }

    const profile = await getProfileByEmail(email)
    if (!profile) {
      return err(401, "Invalid credentials")
    }

    const accessToken = await signToken(profile.id)

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
