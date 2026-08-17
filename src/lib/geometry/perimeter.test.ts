import { describe, expect, it } from "vitest";
import type { Room } from "@/types";
import {
  computeAllBuildingPerimeters,
  computeBuildingPerimeterFromRooms,
  totalBuildingPerimeter,
} from "./perimeter";

function room(overrides: Partial<Room> & Pick<Room, "id" | "type" | "x" | "y" | "width" | "depth">): Room {
  return {
    floorId: "floor-1",
    name: overrides.id,
    areaM2: overrides.width * overrides.depth,
    ...overrides,
  } as Room;
}

describe("computeBuildingPerimeterFromRooms", () => {
  it("computes union perimeter for indoor rooms only", () => {
    const rooms: Room[] = [
      room({ id: "A", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 3 }),
    ];
    const { perimeter } = computeBuildingPerimeterFromRooms(rooms, "floor-1");
    expect(perimeter).toBe(14); // 2*(4+3)
  });

  it("excludes open/outdoor room types (carport, taman, kolam, balkon, rooftop_lounge, void)", () => {
    const rooms: Room[] = [
      room({ id: "A", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 3 }),
      room({ id: "B", type: "carport", x: 4, y: 0, width: 3, depth: 3 }),
    ];
    const { perimeter } = computeBuildingPerimeterFromRooms(rooms, "floor-1");
    expect(perimeter).toBe(14); // carport does not extend the union
  });

  it("ignores rooms on other floors", () => {
    const rooms: Room[] = [
      room({ id: "A", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 3, floorId: "floor-1" }),
      room({ id: "B", type: "ruang_tamu", x: 0, y: 0, width: 10, depth: 10, floorId: "floor-2" }),
    ];
    const { perimeter } = computeBuildingPerimeterFromRooms(rooms, "floor-1");
    expect(perimeter).toBe(14);
  });

  it("returns 0 perimeter and empty polygon when only outdoor rooms are present", () => {
    const rooms: Room[] = [room({ id: "A", type: "taman", x: 0, y: 0, width: 4, depth: 3 })];
    const { perimeter, polygon } = computeBuildingPerimeterFromRooms(rooms, "floor-1");
    expect(perimeter).toBe(0);
    expect(polygon).toEqual([]);
  });
});

describe("computeAllBuildingPerimeters / totalBuildingPerimeter", () => {
  it("sums per-floor perimeters across the whole layout", () => {
    const layout = {
      rooms: [
        room({ id: "A", type: "ruang_tamu", x: 0, y: 0, width: 4, depth: 3, floorId: "floor-1" }),
        room({ id: "B", type: "kamar_tidur", x: 0, y: 0, width: 3, depth: 3, floorId: "floor-2" }),
      ],
    } as any;
    const perimeters = computeAllBuildingPerimeters(layout);
    expect(perimeters.get("floor-1")?.perimeter).toBe(14);
    expect(perimeters.get("floor-2")?.perimeter).toBe(12);
    expect(totalBuildingPerimeter(layout)).toBe(26);
  });
});
