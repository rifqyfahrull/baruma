/**
 * DB migration runner — applied by CI/CD on every deploy (see
 * .github/workflows/deploy.yml) and runnable locally via `pnpm migrate`.
 *
 * Plain SQL files in db/migrations/ are applied in filename order, each inside
 * its own transaction, and recorded in a `schema_migrations` tracking table so
 * each file runs at most once.
 *
 * Adopting an already-provisioned DB: the tracking table doesn't exist yet, so
 * the first run re-encounters migrations whose objects are already present. A
 * migration that fails purely because its objects already exist (duplicate_*
 * SQLSTATEs) is treated as already-applied and just recorded (baselined). Any
 * other error aborts the run with a non-zero exit so a broken deploy never
 * proceeds with a half-migrated schema.
 *
 * Requires DATABASE_URL in the environment.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations")

// SQLSTATEs that mean "this object already exists" → the migration was applied
// before the tracking table existed; baseline it rather than fail.
const ALREADY_EXISTS = new Set([
  "42P07", // duplicate_table
  "42P06", // duplicate_schema
  "42710", // duplicate_object (trigger, constraint, etc.)
  "42701", // duplicate_column
  "42723", // duplicate_function
  "42P16", // invalid_table_definition (e.g. multiple primary keys on re-add)
])

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("[migrate] DATABASE_URL is not set")
    process.exit(1)
  }

  const client = new pg.Client({ connectionString, ssl: false })
  await client.connect()

  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )
    `)

    const { rows } = await client.query("select filename from schema_migrations")
    const done = new Set(rows.map((r) => r.filename))

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()

    let applied = 0
    let baselined = 0

    for (const filename of files) {
      if (done.has(filename)) continue
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8")
      try {
        await client.query("begin")
        await client.query(sql)
        await client.query("insert into schema_migrations (filename) values ($1)", [filename])
        await client.query("commit")
        console.log(`[migrate] applied ${filename}`)
        applied++
      } catch (e) {
        await client.query("rollback")
        if (e && ALREADY_EXISTS.has(e.code)) {
          await client.query("insert into schema_migrations (filename) values ($1)", [filename])
          console.log(`[migrate] baselined ${filename} (objects already exist)`)
          baselined++
        } else {
          console.error(`[migrate] FAILED on ${filename}: ${e?.code ?? ""} ${e?.message ?? e}`)
          throw e
        }
      }
    }

    console.log(
      `[migrate] done — ${applied} applied, ${baselined} baselined, ${done.size} already tracked`
    )
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error("[migrate] error:", e?.message ?? e)
  process.exit(1)
})
