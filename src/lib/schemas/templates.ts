import { z } from "zod"

/**
 * "Templates" feature (admin backoffice) request validation — shared by the
 * `/api/v1/admin/templates/*` route handlers.
 */

const slugRegex = /^[a-z0-9-]+$/

/** POST /api/v1/admin/templates — snapshot a project into a new template. */
export const createTemplateSchema = z.object({
  projectId: z.string().min(1, "projectId wajib diisi"),
  slug: z
    .string()
    .regex(slugRegex, "Slug hanya boleh huruf kecil, angka, dan tanda hubung"),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  sortOrder: z.number().int().optional(),
})
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>

/**
 * PATCH /api/v1/admin/templates/[id] — meta edits and/or a resync from the
 * source project. At least one field must be present.
 */
export const updateTemplateSchema = z
  .object({
    name: z.string().min(1).optional(),
    slug: z
      .string()
      .regex(slugRegex, "Slug hanya boleh huruf kecil, angka, dan tanda hubung")
      .optional(),
    description: z.string().nullable().optional(),
    sortOrder: z.number().int().optional(),
    active: z.boolean().optional(),
    resync: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.slug !== undefined ||
      v.description !== undefined ||
      v.sortOrder !== undefined ||
      v.active !== undefined ||
      v.resync !== undefined,
    { message: "Isi minimal satu field" }
  )
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>
