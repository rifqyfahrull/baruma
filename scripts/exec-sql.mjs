/**
 * Execute a PostgreSQL query from a CLI argument.
 *
 * Usage:
 *   node scripts/exec-sql.mjs "select now()"
 *   pnpm db:exec -- "select * from users limit 5"
 *
 * Automatically loads .env.local, then falls back to existing environment.
 */
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

function loadEnvLocal() {
  const envPath = ".env.local";
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key))
      continue;

    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvLocal();

function parseQueryArg(argv) {
  const args = argv
    .slice(2)
    .filter((arg, index) => !(index === 0 && arg === "--"));
  const query = args.join(" ").trim();
  return query;
}

async function main() {
  const query = parseQueryArg(process.argv);
  if (!query) {
    console.error("[db:exec] Missing SQL query argument");
    console.error('Usage: pnpm db:exec -- "select now()"');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[db:exec] DATABASE_URL is not set");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString, ssl: false });
  await client.connect();

  try {
    const result = await client.query(query);

    if (result.rows?.length) {
      console.table(result.rows);
    } else {
      console.log("[db:exec] Query executed successfully");
    }

    console.log(
      `[db:exec] rowCount=${result.rowCount ?? 0}, command=${result.command ?? "UNKNOWN"}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[db:exec] Error:", error?.message ?? error);
  process.exit(1);
});
