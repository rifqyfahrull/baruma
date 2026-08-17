import { z } from "zod"

/** Body PATCH /me — ganti nama tampilan (profile page). */
export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nama minimal 2 karakter")
    .max(120, "Nama maksimal 120 karakter"),
})
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
