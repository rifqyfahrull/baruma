/**
 * Shared helpers for the billing repos' in-memory fallback mode.
 *
 * When `DATABASE_URL` is absent (local dev / e2e mock-mode / unit tests) the
 * billing repos operate on module-level in-memory stores instead of Postgres.
 * Memory mode is dev/test-only: per-process, non-durable, single-instance.
 */

/** True iff a real database is configured (checked at call time, not import). */
export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

/** Deep-clone a value so callers can never mutate a memory store in place. */
export function clone<T>(value: T): T {
  return structuredClone(value)
}
