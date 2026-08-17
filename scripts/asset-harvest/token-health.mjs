/**
 * Cek kesehatan tiap token faucet: 1 request minimal → status live/dead.
 * Menulis tokens-live.txt (subset yang masih 200) untuk dipakai stage berikutnya.
 * Jalankan: node scripts/asset-harvest/token-health.mjs
 */
import { writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvLocal, loadTokens } from "./_shared.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
loadEnvLocal(repoRoot)
const baseUrl = process.env.FAUCET_BASE_URL || "https://freetokenfaucet.com/v1"
const model = process.env.FAUCET_MODEL || "deepseek-v4-flash"
const TOKENS = loadTokens(repoRoot)

async function probe(tok) {
  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(20000),
    })
    return { status: r.status }
  } catch (e) {
    return { status: 0, err: String(e.name || e.message).slice(0, 20) }
  }
}

const results = await Promise.all(TOKENS.map(async (t, i) => {
  const { status, err } = await probe(t)
  const live = status === 200
  console.log(`  #${i + 1} ${t.slice(0, 11)}… → ${status}${err ? " " + err : ""}${live ? " LIVE" : ""}`)
  return { t, live }
}))

const live = results.filter((r) => r.live).map((r) => r.t)
writeFileSync(path.join(repoRoot, "scripts/asset-harvest/tokens-live.txt"), live.join("\n") + "\n")
console.log(`\n[health] ${live.length}/${TOKENS.length} token LIVE → tokens-live.txt`)
