/**
 * Singleton pg.Pool for the central baruma database.
 * Server-only — never import from client components.
 * Connectivity: baruma droplet reaches central via tailnet (100.99.142.119).
 */
import { Pool } from "pg"
import type { QueryResult, QueryResultRow, PoolClient } from "pg"

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set")
    }
    pool = new Pool({
      connectionString,
      ssl: false,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // Putus query yang menggantung agar tidak menahan koneksi pool (kelelahan
      // koneksi saat query lambat lintas tailnet). 15 s cukup longgar utk query
      // terberat, jauh di bawah risiko pool-exhaustion.
      statement_timeout: 15_000,
      query_timeout: 15_000,
    })
    pool.on("error", (err) => {
      console.error("[db] Unexpected pool error:", err.message)
    })
  }
  return pool
}

export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<QueryResult<R>> {
  return getPool().query<R>(text, values)
}

export async function getClient(): Promise<PoolClient> {
  return getPool().connect()
}
