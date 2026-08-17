import { z } from "zod";

import { executeMcpTool } from "@/lib/mcp/tools";
import { err, handleError, ok } from "@/lib/server/response";
import { rateLimitGuard } from "@/lib/server/rate-limit";

// Server MCP ini SENGAJA publik (lihat manifest/route.ts) — tool-nya stateless
// atas `scene` yang dikirim di body dan search_3d_assets hanya mengembalikan
// katalog is_public=true, jadi tak ada data lintas-tenant. Yang ditutup di sini
// (audit CSO 2026-08-09): body sebelumnya di-cast `any` tanpa validasi. Zod di
// bawah menegakkan bentuk request untuk kedua dialek (JSON-RPC 2.0 + JSON HTTP).
// Rate-limit (audit CSO 2026-08-15, AI-abuse hardening): karena route ini
// publik tanpa auth, dijaga per-IP saja — 60 panggilan / 5 menit / instance
// cukup untuk pemakaian normal (agent memanggil beberapa tool per turn) sambil
// membatasi scraping/abuse otomatis. Service-token tetap keputusan produk,
// belum dipasang. pm2 cluster -i 2 → limiter in-memory ini PER INSTANCE,
// efektif ≈2× (≈120/5min) — lihat docstring rate-limit.ts.

const jsonRpcSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("tools/call"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  params: z.object({
    name: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).optional(),
  }),
});

const simpleSchema = z.object({
  name: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const ipLimited = rateLimitGuard(request, {
      scope: "mcp-tools-ip",
      limit: 60,
      windowMs: 5 * 60_000,
    });
    if (ipLimited) return ipLimited;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return err(400, "Invalid JSON body");
    }

    // JSON-RPC 2.0 (MCP standard)
    const rpc = jsonRpcSchema.safeParse(raw);
    if (rpc.success) {
      const { name, arguments: toolArgs } = rpc.data.params;
      try {
        const result = await executeMcpTool(name, toolArgs ?? {});
        return ok({
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: JSON.stringify(result) }] },
          id: rpc.data.id ?? null,
        });
      } catch (e) {
        return ok({
          jsonrpc: "2.0",
          error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
          id: rpc.data.id ?? null,
        });
      }
    }

    // Simple HTTP JSON API
    const simple = simpleSchema.safeParse(raw);
    if (!simple.success) {
      return err(400, "Invalid MCP request body");
    }
    const toolName = simple.data.name ?? simple.data.tool;
    const toolArgs = simple.data.args ?? simple.data.arguments ?? {};
    if (!toolName) {
      return err(400, "Missing 'name' or 'tool' in request body");
    }

    const result = await executeMcpTool(toolName, toolArgs);
    return ok({ success: true, result });
  } catch (e) {
    return handleError(e);
  }
}
