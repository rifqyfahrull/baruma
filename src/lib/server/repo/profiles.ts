/**
 * Typed queries for the profiles table.
 */
import { query } from "@/lib/server/db"
import type { Plan } from "@/types"

import { hasDb } from "./memory-fallback"

export interface ProfileRow {
  id: string
  email: string
  name: string
  plan: Plan
  role: "user" | "admin"
  phone: string | null
  credits_used: number
  credits_total: number
  created_at: string
  updated_at: string
  /**
   * Optional: only populated by queries that explicitly select it
   * (currently `getProfileById`, used by `requireAdmin` as the "this
   * account is SSO-linked, not just a self-registered row" trust signal —
   * see auth-server.ts). Left optional so the many call sites/tests that
   * build a `ProfileRow` without touching SSO concerns don't need to know
   * about this column.
   */
  supabase_uid?: string | null
}

/** Credential row — only returned by getCredentialByEmail; never mixed into general profile reads. */
export interface CredentialRow {
  id: string
  password_hash: string | null
  email_verified: boolean
}

export async function getProfileById(
  id: string
): Promise<ProfileRow | null> {
  // Selects supabase_uid too (unlike the other profile reads below): this is
  // the row requireAdmin() checks, and it needs to tell an SSO-linked account
  // apart from a self-registered one — see the ADMIN_EMAILS trust rule there.
  const res = await query<ProfileRow>(
    `SELECT id, email, name, plan, role, phone, credits_used, credits_total, created_at, updated_at, supabase_uid
     FROM profiles WHERE id = $1`,
    [id]
  )
  return res.rows[0] ?? null
}

export async function getProfileByEmail(
  email: string
): Promise<ProfileRow | null> {
  const res = await query<ProfileRow>(
    `SELECT id, email, name, plan, role, phone, credits_used, credits_total, created_at, updated_at
     FROM profiles WHERE email = $1`,
    [email]
  )
  return res.rows[0] ?? null
}

/**
 * Fetch only the credential columns needed for login.
 * Keeps password_hash out of the general ProfileRow type.
 */
export async function getCredentialByEmail(
  email: string
): Promise<CredentialRow | null> {
  const res = await query<CredentialRow>(
    `SELECT id, password_hash FROM profiles WHERE email = $1`,
    [email]
  )
  return res.rows[0] ?? null
}

export async function createProfile(opts: {
  id: string
  email: string
  name: string
  passwordHash: string
}): Promise<ProfileRow> {
  const res = await query<ProfileRow>(
    `INSERT INTO profiles (id, email, name, plan, credits_used, credits_total, password_hash, role, phone)
     VALUES ($1, $2, $3, 'free', 0, 10, $4, 'user', NULL)
     RETURNING id, email, name, plan, role, phone, credits_used, credits_total, created_at, updated_at`,
    [opts.id, opts.email, opts.name, opts.passwordHash]
  )
  return res.rows[0]
}

/* ---- Supabase SSO identity mapping ---- */

/** Find the Baruma profile linked to a Supabase auth user. */
export async function getProfileBySupabaseUid(uid: string): Promise<ProfileRow | null> {
  const res = await query<ProfileRow>(
    `SELECT id, email, name, plan, role, phone, credits_used, credits_total, created_at, updated_at
     FROM profiles WHERE supabase_uid = $1`,
    [uid]
  )
  return res.rows[0] ?? null
}

/** Link an existing Baruma profile to a Supabase user (idempotent). Only sets
 *  the link when currently null, so a profile can't be silently re-pointed. */
export async function linkSupabaseUid(profileId: string, uid: string): Promise<void> {
  await query(
    `UPDATE profiles SET supabase_uid = $2, updated_at = now()
     WHERE id = $1 AND supabase_uid IS NULL`,
    [profileId, uid]
  )
}

/** Create a Baruma profile for a Supabase user with no local password (auth
 *  lives entirely in Supabase). */
export async function createSupabaseProfile(opts: {
  id: string
  email: string
  name: string
  supabaseUid: string
}): Promise<ProfileRow> {
  const res = await query<ProfileRow>(
    `INSERT INTO profiles (id, email, name, plan, credits_used, credits_total, password_hash, role, phone, supabase_uid)
     VALUES ($1, $2, $3, 'free', 0, 10, NULL, 'user', NULL, $4)
     RETURNING id, email, name, plan, role, phone, credits_used, credits_total, created_at, updated_at`,
    [opts.id, opts.email, opts.name, opts.supabaseUid]
  )
  return res.rows[0]
}

/**
 * Admin backoffice (Task 8): list every profile, newest first.
 *
 * Every other function in this file is DB-only by design — none of them
 * check `hasDb()`, they all call `query()` unconditionally, because they're
 * only ever reached once a DB-backed profile already exists (login,
 * webhook, requireAdmin). `listProfiles` is different: the admin Users tab
 * can be opened in dev/mock mode (no `DATABASE_URL`), where `query()` would
 * throw "DATABASE_URL is not set". Rather than invent a parallel in-memory
 * multi-profile store (a new pattern this file doesn't otherwise have),
 * this just returns `[]` in that case — an honest empty state instead of a
 * 500, without pretending profiles.ts has memory-fallback CRUD it doesn't.
 */
export async function listProfiles(): Promise<ProfileRow[]> {
  if (!hasDb()) return []
  const res = await query<ProfileRow>(
    `SELECT id, email, name, plan, role, phone, credits_used, credits_total, created_at, updated_at
     FROM profiles ORDER BY created_at DESC`
  )
  return res.rows
}

/**
 * Count of profiles currently holding `role === 'admin'`. Used by the admin
 * backoffice's last-admin guard (PATCH /api/v1/admin/users) so the sole
 * remaining admin can never be demoted to `'user'` — that would leave no
 * `role='admin'` profile in the DB, and (absent an ADMIN_EMAILS bootstrap
 * entry) no way for anyone to reach /app/admin or any /api/v1/admin/* route
 * again. Unconditional `query()` call, no `hasDb()` guard, matching every
 * other function in this file below — only ever reached once a DB-backed
 * admin profile already exists (requireAdmin already passed).
 */
export async function countAdmins(): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT count(*) FROM profiles WHERE role = 'admin'`
  )
  return Number(res.rows[0]?.count ?? 0)
}

/* ── small setters (admin backoffice / billing webhook — DB-backed paths) ─── */

export async function setProfileRole(
  id: string,
  role: "user" | "admin"
): Promise<void> {
  await query(`UPDATE profiles SET role = $2 WHERE id = $1`, [id, role])
}

export async function setProfilePlan(id: string, plan: Plan): Promise<void> {
  await query(`UPDATE profiles SET plan = $2 WHERE id = $1`, [id, plan])
}

export async function setProfilePhone(
  id: string,
  phone: string | null
): Promise<void> {
  await query(`UPDATE profiles SET phone = $2 WHERE id = $1`, [id, phone])
}

export async function setProfileName(id: string, name: string): Promise<void> {
  await query(`UPDATE profiles SET name = $2, updated_at = now() WHERE id = $1`, [
    id,
    name,
  ])
}
