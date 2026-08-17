// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./llm", () => ({ chatJSON: vi.fn(), PROSE_SLUG: "baruma-assistant" }));
import { chatJSON, PROSE_SLUG } from "./llm";
import { enrichAlternatives } from "./enrich-alternatives";
import type { Alternative, Brief } from "@/types";

const mockChat = chatJSON as unknown as ReturnType<typeof vi.fn>;

const baseAlt = (over: Partial<Alternative> = {}): Alternative => ({
  id: "alt-x",
  projectId: "p1",
  name: "Base",
  type: "hemat_biaya",
  score: 79,
  thumbnail: "vertical",
  description: "base desc",
  keyFeatures: ["bf"],
  pros: ["bp"],
  cons: ["bc"],
  estimatedCost: { minIDR: 1_000_000, maxIDR: 2_000_000 },
  readiness: "concept_ready",
  risks: [],
  areaM2: 100,
  roomCount: 3,
  floors: 1,
  ...over,
});

const brief = {
  projectId: "p1",
  summary: "rumah tropis",
  site: { widthM: 8, depthM: 15, areaM2: 120 },
  building: { floors: 1, rooftop: false, budget: { minIDR: 1, maxIDR: 2 }, finishingLevel: "standar" },
  priorities: [],
  spaceProgram: [],
  assumptions: [],
  constraints: [],
  risks: [],
} as unknown as Brief;

beforeEach(() => vi.clearAllMocks());

describe("enrichAlternatives", () => {
  it("merges LLM narrative by type and keeps ALL computed fields", async () => {
    mockChat.mockResolvedValue({
      items: [{ type: "hemat_biaya", name: "Hemat Cerdas", description: "AI desc", keyFeatures: ["f1", "f2"], pros: ["p1"], cons: ["c1"] }],
    });
    const [r] = await enrichAlternatives([baseAlt()], brief);
    expect(r.name).toBe("Hemat Cerdas");
    expect(r.description).toBe("AI desc");
    expect(r.keyFeatures).toEqual(["f1", "f2"]);
    expect(r.pros).toEqual(["p1"]);
    expect(r.cons).toEqual(["c1"]);
    // computed/money fields untouched
    expect(r.estimatedCost).toEqual({ minIDR: 1_000_000, maxIDR: 2_000_000 });
    expect(r.areaM2).toBe(100);
    expect(r.type).toBe("hemat_biaya");
    expect(r.score).toBe(79);
    expect(r.readiness).toBe("concept_ready");
  });

  it("falls back to the deterministic narrative when the LLM returns null", async () => {
    mockChat.mockResolvedValue(null);
    const [r] = await enrichAlternatives([baseAlt()], brief);
    expect(r.name).toBe("Base");
    expect(r.description).toBe("base desc");
    expect(r.keyFeatures).toEqual(["bf"]);
  });

  it("ignores malformed LLM fields (keeps base)", async () => {
    mockChat.mockResolvedValue({ items: [{ type: "hemat_biaya", name: "  ", keyFeatures: "nope", pros: [123, null] }] });
    const [r] = await enrichAlternatives([baseAlt()], brief);
    expect(r.name).toBe("Base"); // empty/whitespace name ignored
    expect(r.keyFeatures).toEqual(["bf"]); // non-array ignored
    expect(r.pros).toEqual(["bp"]); // non-string items filtered → empty → base kept
  });

  it("returns the input unchanged for an empty list", async () => {
    expect(await enrichAlternatives([], brief)).toEqual([]);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("explicitly requests the prose slug instead of inheriting chatJSON's default actions slug", async () => {
    mockChat.mockResolvedValue(null);
    await enrichAlternatives([baseAlt()], brief);
    expect(mockChat).toHaveBeenCalledTimes(1);
    const [, opts] = mockChat.mock.calls[0];
    expect(opts).toEqual({ slug: PROSE_SLUG });
  });
});
