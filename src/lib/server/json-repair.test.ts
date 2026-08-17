import { describe, it, expect } from "vitest";
import { repairAndExtractJson } from "./json-repair";

describe("repairAndExtractJson", () => {
  it("parses valid JSON without modification", () => {
    const valid = '{"reply": "Halo", "actions": []}';
    expect(repairAndExtractJson(valid)).toEqual({ reply: "Halo", actions: [] });
  });

  it("repairs truncated actions array and patch object", () => {
    const truncated = '{"reply": "Membuat koridor", "actions": [{"type": "updateRoom", "roomId": "room-1", "patch": {"x": 1.4, "de';
    const result = repairAndExtractJson(truncated);
    expect(result).toHaveProperty("reply", "Membuat koridor");
  });

  it("repairs truncated needs_clarify structure", () => {
    const truncated = '{"reply": "Apakah anda setuju?", "needs_clarify": [{"question": "Ruang mana?", "suggestions": ["Kamar 1", "Dapur"';
    const result = repairAndExtractJson(truncated);
    expect(result).toHaveProperty("reply", "Apakah anda setuju?");
  });

  it("falls back to regex reply extraction when repair is impossible", () => {
    const broken = '{"reply": "Ini balasan AI yang sangat panjang", "corrupted_garbage_syntax';
    const result = repairAndExtractJson(broken);
    expect(result).toHaveProperty("reply", "Ini balasan AI yang sangat panjang");
  });
});
