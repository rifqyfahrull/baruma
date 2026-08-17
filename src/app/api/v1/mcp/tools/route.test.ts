import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "../manifest/route";
import { POST } from "./route";
import { __resetRateLimitStore } from "@/lib/server/rate-limit";

describe("MCP Server API Routes", () => {
  beforeEach(() => __resetRateLimitStore());

  it("GET /api/v1/mcp/manifest returns tool catalog", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("baruma-mcp-server");
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools.length).toBeGreaterThan(0);
  });

  it("POST /api/v1/mcp/tools executes tool call via JSON-RPC 2.0", async () => {
    const req = new Request("http://localhost/api/v1/mcp/tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "validate_layout",
          arguments: {
            scene: {
              rooms: [{ id: "r1", name: "Ruang Tamu", type: "ruang_tamu", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 }],
              openings: [],
              site: { widthM: 10, depthM: 10 },
            },
          },
        },
        id: "test-1",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe("test-1");
    expect(data.result).toBeDefined();
    expect(data.result.content[0].text).toContain("valid");
  });

  it("POST /api/v1/mcp/tools 429s once the per-IP quota (60/5min) is exhausted", async () => {
    // Distinct IP so this test's own bucket can't be polluted by (or pollute)
    // the calls made in the tests above.
    const mkReq = () =>
      new Request("http://localhost/api/v1/mcp/tools", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({
          name: "validate_layout",
          args: { scene: { rooms: [], openings: [], site: { widthM: 10, depthM: 10 } } },
        }),
      });

    let last: Response | null = null;
    for (let i = 0; i < 61; i++) {
      last = await POST(mkReq());
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).toBeTruthy();
  });
});
