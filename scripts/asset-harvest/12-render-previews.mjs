/**
 * Tahap 12 — render preview WebP tiap aset (PRD §17) pakai renderer app yang
 * sama (three.js headless via Playwright/Chromium). Satu page dipakai ulang;
 * tiap model: load GLB (dari server lokal) → frame kamera 3/4 → render →
 * canvas.toDataURL('image/webp'). Resumable (skip file webp yang sudah ada).
 *
 * Server lokal menyajikan: three ESM, jsm addons, draco, render-page.html, dan
 * GLB mentah dari raw/. Tak perlu sharp (WebP dari canvas browser).
 *
 * Output: out/previews/<uid>.webp
 * Jalankan: node scripts/asset-harvest/12-render-previews.mjs [--limit=N]
 */
import http from "node:http"
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import path from "node:path"
import { chromium } from "@playwright/test"
import { ensureDirs, OUT_DIR, RAW_DIR } from "./_shared.mjs"

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"),
  "..",
  "..",
)
const PREVIEW_DIR = path.join(OUT_DIR, "previews")
const CATALOG = path.join(OUT_DIR, "catalog.jsonl")
const DOWNLOADED = path.join(OUT_DIR, "downloaded.jsonl")
const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || Infinity

const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".html": "text/html",
  ".glb": "model/gltf-binary",
}

function startServer(uidToFile) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || "").split("?")[0])
    let file = null
    if (url === "/render-page.html") file = path.join(repoRoot, "scripts/asset-harvest/preview/render-page.html")
    // three 0.184 memecah build: three.module.js meng-import three.core.js —
    // sajikan seluruh three/build/*.js.
    else if (/^\/three[\w.-]*\.js$/.test(url)) file = path.join(repoRoot, "node_modules/three/build", url.slice(1))
    else if (url.startsWith("/jsm/")) file = path.join(repoRoot, "node_modules/three/examples/jsm", url.slice(5))
    else if (url.startsWith("/draco/")) file = path.join(repoRoot, "public/draco", url.slice(7))
    else if (url.startsWith("/glb/")) file = uidToFile.get(url.slice(5).replace(/\.glb$/, ""))
    if (!file || !existsSync(file)) {
      res.writeHead(404)
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)))
}

async function main() {
  ensureDirs()
  mkdirSync(PREVIEW_DIR, { recursive: true })
  const dl = new Map(
    readFileSync(DOWNLOADED, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.uid, path.join(RAW_DIR, r.file)]),
  )
  // Hanya aset di catalog (accepted/live).
  const catalog = readFileSync(CATALOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  const todo = catalog
    .filter((c) => dl.has(c.id))
    .filter((c) => {
      const out = path.join(PREVIEW_DIR, `${c.id}.webp`)
      return !(existsSync(out) && statSync(out).size > 0)
    })
    .slice(0, Number.isFinite(limit) ? limit : undefined)
  console.log(`[preview] ${todo.length} to render (catalog ${catalog.length})`)
  if (todo.length === 0) return

  const server = await startServer(dl)
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`

  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  })
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } })
  await page.goto(`${base}/render-page.html`, { waitUntil: "load" })
  await page.waitForFunction("window.__ready === true", { timeout: 30000 })

  let ok = 0
  let fail = 0
  for (const c of todo) {
    try {
      const dataUrl = await page.evaluate(
        async ({ url }) => {
          const p = window.renderModel(url)
          const to = new Promise((_, rej) => setTimeout(() => rej(new Error("render timeout")), 25000))
          return await Promise.race([p, to])
        },
        { url: `${base}/glb/${c.id}.glb` },
      )
      const b64 = dataUrl.split(",")[1]
      writeFileSync(path.join(PREVIEW_DIR, `${c.id}.webp`), Buffer.from(b64, "base64"))
      ok++
    } catch (e) {
      fail++
      if (fail % 20 === 0) console.error(`[preview] fail #${fail}: ${c.id} ${String(e.message).slice(0, 60)}`)
      // Re-load page kalau konteks WebGL hilang (model berat bisa crash context).
      if (String(e.message).includes("context") || String(e.message).includes("crash")) {
        try {
          await page.goto(`${base}/render-page.html`, { waitUntil: "load" })
          await page.waitForFunction("window.__ready === true", { timeout: 30000 })
        } catch {
          /* ignore */
        }
      }
    }
    if ((ok + fail) % 200 === 0) console.log(`[preview] ${ok + fail}/${todo.length} ok=${ok} fail=${fail}`)
  }
  await browser.close()
  server.close()
  console.log(`[preview] done ok=${ok} fail=${fail}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
