/**
 * Tahap 10 — apply migration SQL langsung ke DB (keputusan user: db:exec).
 * SQL terlalu besar untuk arg CLI (~7MB), jadi dibaca dari file & dijalankan
 * via pg dalam SATU transaksi (atomic; on-conflict-do-nothing = aman diulang).
 *
 * Jalankan: node scripts/asset-harvest/10-apply.mjs --file=<path.sql>
 */
import pg from "pg"
import { readFileSync } from "node:fs"
import path from "node:path"
import { loadEnvLocal } from "./_shared.mjs"

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
  "..",
)
loadEnvLocal(repoRoot)

const fileArg = (process.argv.find((a) => a.startsWith("--file=")) || "").split("=")[1]
if (!fileArg) {
  console.error("usage: node 10-apply.mjs --file=<path.sql>")
  process.exit(1)
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL not set")
  const sql = readFileSync(fileArg, "utf8")
  const client = new pg.Client({ connectionString: url, ssl: false })
  await client.connect()
  const before = await client.query("select count(*) from user_assets where is_public = true")
  console.log(`[apply] public user_assets sebelum: ${before.rows[0].count}`)
  try {
    await client.query("begin")
    await client.query(sql)
    await client.query("commit")
    console.log("[apply] committed")
  } catch (e) {
    await client.query("rollback").catch(() => {})
    console.error("[apply] FAILED, rolled back:", e.message)
    await client.end()
    process.exit(1)
  }
  const after = await client.query("select count(*) from user_assets where is_public = true")
  const byCat = await client.query(
    "select category, count(*) from user_assets where source_name = $1 group by category order by count(*) desc",
    ["Objaverse (Sketchfab CC)"],
  )
  console.log(`[apply] public user_assets sesudah: ${after.rows[0].count} (+${after.rows[0].count - before.rows[0].count})`)
  console.log("[apply] objaverse per kategori:")
  for (const r of byCat.rows) console.log(`  ${String(r.count).padStart(5)}  ${r.category}`)
  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
