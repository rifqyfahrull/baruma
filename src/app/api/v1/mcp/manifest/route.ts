import { ok } from "@/lib/server/response";
import { BARUMA_MCP_TOOLS } from "@/lib/mcp/tools";

export async function GET(): Promise<Response> {
  return ok({
    name: "baruma-mcp-server",
    version: "1.0.0",
    protocolVersion: "2024-11-05",
    description: "Baruma Architecture & Layout Domain MCP Tool Server",
    tools: BARUMA_MCP_TOOLS,
  });
}
