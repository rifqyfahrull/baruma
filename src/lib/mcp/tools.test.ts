import { describe, it, expect } from "vitest";
import { BARUMA_MCP_TOOLS, executeMcpTool } from "./tools";

describe("Baruma MCP Tools", () => {
  it("exports valid MCP tool definitions with schemas", () => {
    expect(BARUMA_MCP_TOOLS.length).toBeGreaterThan(0);
    const names = BARUMA_MCP_TOOLS.map((t) => t.name);
    expect(names).toContain("validate_layout");
    expect(names).toContain("find_free_space");
    expect(names).toContain("search_3d_assets");
    expect(names).toContain("calculate_rab");
    expect(names).toContain("simulate_actions");
  });

  it("executes validate_layout tool successfully", async () => {
    const mockScene = {
      rooms: [
        { id: "r1", name: "Ruang Tamu", type: "ruang_tamu", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 },
      ],
      openings: [],
      site: { widthM: 10, depthM: 10 },
    };
    const res = await executeMcpTool("validate_layout", { scene: mockScene });
    expect(res).toHaveProperty("valid");
    expect(res).toHaveProperty("issues");
  });

  it("executes find_free_space tool successfully", async () => {
    const mockScene = {
      rooms: [
        { id: "r1", name: "Ruang Tamu", type: "ruang_tamu", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16 },
      ],
      site: { widthM: 10, depthM: 10 },
    };
    const res = await executeMcpTool("find_free_space", {
      scene: mockScene,
      floorId: "f1",
      desiredWidth: 2,
      desiredDepth: 2,
    });
    expect(res.found).toBe(true);
    expect(res.rect).toBeDefined();
  });

  it("throws on unknown MCP tool name", async () => {
    await expect(executeMcpTool("unknown_tool", {})).rejects.toThrow("Unknown MCP Tool: unknown_tool");
  });
});
