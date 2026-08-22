import { z } from "zod"

/**
 * Admin backoffice (Task 8) request validation — shared by the
 * `/api/v1/admin/*` route handlers (see docs/superpowers/plans/
 * 2026-07-05-mayar-billing-admin.md, Task 8).
 */

export const entitlementsSchema = z.object({
  creditsPerPeriod: z.number().int().min(0, "Tidak boleh negatif"),
  maxProjects: z.number().int().min(0, "Tidak boleh negatif"),
  exportPdf: z.boolean(),
  glbUpload: z.boolean(),
  aiRenderHd: z.boolean(),
})

/** Full PlanRow — validated on PUT /api/v1/admin/plans (create or update). */
export const planRowSchema = z.object({
  id: z.string().min(1, "ID plan wajib diisi"),
  name: z.string().min(1, "Nama plan wajib diisi"),
  priceIdr: z.number().min(0, "Harga tidak boleh negatif"),
  period: z.enum(["month", "year"]),
  tagline: z.string().nullable(),
  featured: z.boolean(),
  sortOrder: z.number(),
  active: z.boolean(),
  features: z.array(z.string()),
  limits: z.array(z.string()),
  entitlements: entitlementsSchema,
})

/**
 * PATCH /api/v1/admin/users — role and/or plan, at least one required.
 * `plan` is restricted to the fixed Plan union (not an arbitrary string):
 * several UI spots (e.g. src/components/layout/user-menu.tsx's
 * `PLANS[user.plan]` lookup) index a `Record<Plan, ...>` keyed by exactly
 * these 3 values, so assigning a user to a custom admin-created plan id
 * would crash that lookup — out of scope for Task 8 to fix everywhere.
 */
export const patchUserSchema = z
  .object({
    profileId: z.string().min(1),
    role: z.enum(["user", "admin"]).optional(),
    plan: z.enum(["free", "pro", "studio"]).optional(),
  })
  .refine((v) => v.role !== undefined || v.plan !== undefined, {
    message: "Isi role atau plan (minimal salah satu)",
  })

/** POST /api/v1/admin/users/credits — admin credit adjustment (± with a reason). */
export const adjustCreditsSchema = z.object({
  profileId: z.string().min(1),
  deltaTotal: z.number(),
  reason: z.string().min(1, "Alasan wajib diisi"),
})

/** POST /api/v1/admin/users/phantom-login — create a tab-scoped impersonation URL. */
export const phantomLoginSchema = z.object({
  profileId: z.string().min(1),
})
