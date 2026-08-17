// Headed "watch me work" browser for Baruma, using the Playwright Chromium
// that already ships with the repo (no gstack needed).
//
// Run:
//   node scripts/headed-watch.mjs
//
// It starts a VISIBLE Chromium, waits for `next dev` on PORT, drives a few
// routes so you can watch every navigation/click live, then stays open until
// you close the window.
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const LOG = new URL("./headed-watch.log", import.meta.url);

const routes = ["/", "/login", "/app"];

function log(line) {
  const ts = new Date().toISOString();
  const out = `[${ts}] ${line}`;
  console.log(out);
  try {
    fs.appendFileSync(LOG, out + "\n");
  } catch {}
}

async function waitForServer(url, tries = 60, gap = 1000) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        log(`server up after ${i} tries (status ${res.status})`);
        return true;
      }
    } catch {
      // not up yet
    }
    if (i % 5 === 0) log(`waiting for dev server... (${i}/${tries})`);
    await sleep(gap);
  }
  return false;
}

const ok = await waitForServer(BASE, 90, 1000);
if (!ok) {
  log(`GAVE UP: dev server did not respond at ${BASE}. Start it with: pnpm exec next dev --port ${PORT}`);
  process.exit(1);
}

log("launching headed Chromium...");
const browser = await chromium.launch({
  headless: false,
  args: ["--window-size=1280,800"],
});
const context = await browser.newContext({
  ...devices["Desktop Chrome"],
  viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();

page.on("console", (msg) => log(`  console.${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => log(`  pageerror: ${err.message}`));

for (const route of routes) {
  try {
    const url = BASE + route;
    log(`goto ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    const title = await page.title();
    const domCount = await page.evaluate(() => document.querySelectorAll("*").length);
    log(`  loaded. title="${title}" dom-nodes=${domCount}`);
    // show a real click so you can watch interaction
    const link = page.locator("a").first();
    if (await link.count()) {
      const href = await link.getAttribute("href").catch(() => null);
      log(`  first link -> ${href ?? "(no href)"}`);
      await link.click({ timeout: 5000, noWaitAfter: true }).catch((e) =>
        log(`  click skipped: ${e.message}`)
      );
      await page.waitForTimeout(800);
    }
  } catch (err) {
    log(`  ERROR on ${route}: ${err.message}`);
  }
}
log("DONE driving routes. Browser will stay open until you close the window.");

// keep the window alive so you can watch / poke around, until it's closed
await new Promise((resolve) => {
  browser.on("disconnected", resolve);
  log("watching... close the Chromium window to end the session.");
});

log("browser closed. session ended.");
await context.close().catch(() => {});
await browser.close().catch(() => {});
