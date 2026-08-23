/**
 * Domain tools exposed by Baruma to Agent-Lab via Model Context Protocol (MCP).
 *
 * Agent-Lab runs central agent loops (Claude Agent SDK / Multi-Agent Orchestrator)
 * and invokes these domain tools remotely on Baruma.
 */
import { validateLayout } from "@/lib/validation";
import { findFreeRect } from "@/lib/geometry";
import { searchAssetsForAgent } from "@/lib/server/repo/asset-search";
import { generateRAB } from "@/lib/mock/rab";
import { type FloorplanScene, type FloorplanAction } from "@/lib/assistant/actions";
import { sanitizeActions, findFloorplanActionFeedback } from "@/lib/server/editor-assistant";
import type { DesignLayout, Project, Brief } from "@/types";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const BARUMA_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "validate_layout",
    description: "Validates a floorplan layout snapshot against geometry, SNI standards, daylight, and sanitation rules.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "object", description: "FloorplanScene snapshot object containing rooms, floors, openings, sanitation" },
      },
      required: ["scene"],
    },
  },
  {
    name: "find_free_space",
    description: "Searches for free un-allocated rectangular space on a floor for placing a new room or corridor.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "object", description: "FloorplanScene snapshot" },
        floorId: { type: "string", description: "Target floor ID" },
        desiredWidth: { type: "number", description: "Desired width in meters" },
        desiredDepth: { type: "number", description: "Desired depth in meters" },
      },
      required: ["scene", "floorId", "desiredWidth", "desiredDepth"],
    },
  },
  {
    name: "search_3d_assets",
    description: "Searches Baruma 3D furniture asset library for matching 3D models.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or room type (e.g. 'sofa modern', 'meja makan')" },
      },
      required: ["query"],
    },
  },
  {
    name: "calculate_rab",
    description: "Calculates estimated RAB cost breakdown for the given design layout.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "object", description: "FloorplanScene snapshot" },
      },
      required: ["scene"],
    },
  },
  {
    name: "simulate_actions",
    description: "Simulates proposed layout actions and returns validation feedback / conflict checks.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "object", description: "FloorplanScene snapshot" },
        actions: { type: "array", items: { type: "object" }, description: "Array of FloorplanAction objects" },
        instruction: { type: "string", description: "Original user instruction" },
      },
      required: ["scene", "actions", "instruction"],
    },
  },
];

// FloorplanScene (denah AI, buffer live-editing) dan DesignLayout (bentuk
// tersimpan penuh) berbagi bidang rooms/openings/floors tapi bukan tipe yang
// identik — konversi di sini SENGAJA lewat `unknown` (bukan mengetik ulang
// DesignLayout penuh dari scene) karena tool MCP ini hanya butuh subset yang
// dibaca validateLayout/generateRAB, bukan setiap bidang opsional DesignLayout.
function sceneToLooseLayout(scene: FloorplanScene): DesignLayout {
  return {
    id: "mcp-layout",
    projectId: "mcp-project",
    versionId: "v1",
    rooms: scene.rooms,
    openings: scene.openings ?? [],
    floors: scene.floors ?? [],
  } as unknown as DesignLayout;
}

export async function executeMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "validate_layout": {
      const scene = args.scene as FloorplanScene;
      if (!scene || !Array.isArray(scene.rooms)) {
        throw new Error("Invalid scene object provided");
      }
      const site = scene.site ?? { widthM: 20, depthM: 20 };
      const layout = sceneToLooseLayout(scene);
      const res = validateLayout(layout, site);
      return { valid: res.issues.length === 0, issues: res.issues };
    }

    case "find_free_space": {
      const scene = args.scene as FloorplanScene;
      const floorId = String(args.floorId);
      const width = Number(args.desiredWidth);
      const depth = Number(args.desiredDepth);

      const floorRooms = (scene.rooms ?? []).filter((r) => r.floorId === floorId);
      const site = scene.site ?? { widthM: 20, depthM: 20 };

      const rect = findFreeRect({ width, depth }, floorRooms, site);
      return rect ? { found: true, rect } : { found: false, message: "No free space available for desired dimensions" };
    }

    case "search_3d_assets": {
      const query = String(args.query ?? "");
      const assets = await searchAssetsForAgent(query);
      return { count: assets.length, assets };
    }

    case "calculate_rab": {
      const scene = args.scene as FloorplanScene;
      const site = scene.site ?? { widthM: 20, depthM: 20 };
      const layout = sceneToLooseLayout(scene);
      // Sama seperti sceneToLooseLayout: MCP tool ini hanya perlu bidang yang
      // dibaca generateRAB (site/floors count, finishingLevel), bukan
      // Project/Brief lengkap — konversi lewat `unknown` dengan sengaja.
      const mockProject = {
        id: "mcp-project",
        site: { ...site, areaM2: site.widthM * site.depthM },
        floors: (scene.floors?.length ?? 1),
      } as unknown as Project;
      const mockBrief = {
        building: { finishingLevel: "menengah" },
      } as unknown as Brief;
      const rab = generateRAB(mockProject, mockBrief, layout);
      return { summary: rab.summary, totalItems: rab.items.length };
    }

    case "simulate_actions": {
      const scene = args.scene as FloorplanScene;
      const rawActions = Array.isArray(args.actions) ? args.actions : [];
      const instruction = String(args.instruction ?? "");

      const actions = sanitizeActions("floorplan", rawActions, scene) as FloorplanAction[];
      const violations = findFloorplanActionFeedback(scene, actions, instruction);

      return {
        valid: violations.length === 0,
        sanitizedActions: actions,
        violations,
      };
    }

    default:
      throw new Error(`Unknown MCP Tool: ${name}`);
  }
}
