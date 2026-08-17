import { describe, expect, it } from "vitest";

import { ROOFTOP_RAIL_ID } from "@/lib/three/build-model";
import type { DesignLayout, Room } from "@/types";
import {
  ENTITY_LABELS,
  entityKey,
  floorIdOf,
  hostRoomIdOf,
  isRooftopRail,
  refFromLegacyId,
  refResolves,
  ROOFTOP_RAIL_REF_ID,
  sameEntity,
  wallRefId,
  type EntityKind,
  type EntityRef,
} from "./entity-ref";

const room = (over: Partial<Room>): Room =>
  ({ id: "r", floorId: "f1", name: "R", type: "ruang_tamu", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, ...over }) as Room;

const layout: DesignLayout = {
  id: "l", projectId: "p", versionId: "v",
  floors: [
    { id: "f1", level: 1, name: "Lantai 1", heightM: 3 },
    { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
  ],
  rooms: [room({ id: "kamar" }), room({ id: "balkon", type: "balkon" })],
  walls: [],
  openings: [
    { id: "op1", floorId: "f1", wallId: "kamar:n", type: "door", widthM: 0.9, heightM: 2.1, positionM: 1 },
  ],
  stairs: [], pools: [],
  electrical: [{ id: "el1", roomId: "kamar", type: "stopkontak", x: 1, y: 1 }],
  water: [{ id: "wa1", roomId: "kamar", type: "kran", x: 1, y: 1 }],
  sanitation: {
    septicTank: { id: "sep1", x: 1, y: 1, widthM: 1, lengthM: 2, depthM: 1.5 },
    controlBoxes: [{ id: "cb1", x: 2, y: 2, widthM: 0.4, lengthM: 0.4, depthM: 0.4 }],
  },
  exteriorElements: [
    { id: "ext1", kind: "fence", start: { x: 0, y: 0 }, end: { x: 3, y: 0 }, heightM: 1.5, floorId: "f1" } as never,
  ],
  roofZones: [{ id: "rz1", type: "pelana", x: 0, y: 0, widthM: 5, depthM: 5, slopeDeg: 20, overhangM: 0.5, floorId: "f1" }],
  exteriorLamps: [{ id: "lamp1", kind: "wall", x: 1, y: 0, mountH: 2, floorId: "f1" } as never],
  validation: { passed: true, issues: [] },
} as DesignLayout;

describe("entity-ref — identity & keys", () => {
  it("sentinel dak sinkron dengan build-model", () => {
    expect(ROOFTOP_RAIL_REF_ID).toBe(ROOFTOP_RAIL_ID);
  });

  it("entityKey stabil & unik per bentuk", () => {
    expect(entityKey({ kind: "roof" })).toBe("roof");
    expect(entityKey({ kind: "wall", roomId: "a", side: "n" })).toBe("wall:a:n");
    expect(entityKey({ kind: "furniture", roomId: "a", id: "f1" })).toBe("furniture:a:f1");
    expect(entityKey({ kind: "opening", id: "op1" })).toBe("opening:op1");
  });

  it("sameEntity membandingkan by value, null aman", () => {
    expect(sameEntity({ kind: "wall", roomId: "a", side: "n" }, { kind: "wall", roomId: "a", side: "n" })).toBe(true);
    expect(sameEntity({ kind: "room", id: "x" }, { kind: "opening", id: "x" })).toBe(false);
    expect(sameEntity(null, null)).toBe(true);
    expect(sameEntity(null, { kind: "roof" })).toBe(false);
  });

  it("wallRefId menghasilkan bentuk string map facade", () => {
    expect(wallRefId({ kind: "wall", roomId: "kamar", side: "e" })).toBe("kamar:e");
  });

  it("isRooftopRail hanya untuk sentinel", () => {
    expect(isRooftopRail({ kind: "railing", roomId: ROOFTOP_RAIL_REF_ID })).toBe(true);
    expect(isRooftopRail({ kind: "railing", roomId: "balkon" })).toBe(false);
    expect(isRooftopRail({ kind: "room", id: ROOFTOP_RAIL_REF_ID })).toBe(false);
  });

  it("ENTITY_LABELS lengkap untuk semua kind", () => {
    const kinds: EntityKind[] = [
      "room", "opening", "wall", "roof", "roofZone", "lamp", "railing",
      "exterior", "electrical", "water", "sanitation", "furniture", "light",
    ];
    for (const k of kinds) expect(ENTITY_LABELS[k]).toBeTruthy();
  });
});

describe("entity-ref — refFromLegacyId (paritas scan 7-koleksi lama)", () => {
  it.each([
    ["kamar", "room"],
    ["op1", "opening"],
    ["el1", "electrical"],
    ["wa1", "water"],
    ["sep1", "sanitation"],
    ["cb1", "sanitation"],
    ["ext1", "exterior"],
    ["rz1", "roofZone"],
    ["lamp1", "lamp"],
  ] as const)("%s -> kind %s", (id, kind) => {
    expect(refFromLegacyId(layout, id)?.kind).toBe(kind);
  });

  it("id tak dikenal / null -> null", () => {
    expect(refFromLegacyId(layout, "nope")).toBeNull();
    expect(refFromLegacyId(layout, null)).toBeNull();
  });
});

describe("entity-ref — hostRoomIdOf & floorIdOf", () => {
  it("opening -> ruang host via wallId", () => {
    expect(hostRoomIdOf({ kind: "opening", id: "op1" }, layout)).toBe("kamar");
  });
  it("wall/railing/furniture -> roomId; dak -> null", () => {
    expect(hostRoomIdOf({ kind: "wall", roomId: "kamar", side: "n" }, layout)).toBe("kamar");
    expect(hostRoomIdOf({ kind: "railing", roomId: "balkon" }, layout)).toBe("balkon");
    expect(hostRoomIdOf({ kind: "railing", roomId: ROOFTOP_RAIL_REF_ID }, layout)).toBeNull();
    expect(hostRoomIdOf({ kind: "furniture", roomId: "kamar", id: "f" }, layout)).toBe("kamar");
  });
  it("titik listrik/air -> ruangnya", () => {
    expect(hostRoomIdOf({ kind: "electrical", id: "el1" }, layout)).toBe("kamar");
    expect(hostRoomIdOf({ kind: "water", id: "wa1" }, layout)).toBe("kamar");
  });

  it("floorIdOf: entity ber-ruang ikut lantai ruangnya; sentinel dak -> floor-rooftop; global roof & sanitasi -> null", () => {
    expect(floorIdOf({ kind: "room", id: "kamar" }, layout)).toBe("f1");
    expect(floorIdOf({ kind: "opening", id: "op1" }, layout)).toBe("f1");
    expect(floorIdOf({ kind: "electrical", id: "el1" }, layout)).toBe("f1");
    expect(floorIdOf({ kind: "railing", roomId: ROOFTOP_RAIL_REF_ID }, layout)).toBe("floor-rooftop");
    expect(floorIdOf({ kind: "roof" }, layout)).toBeNull();
    expect(floorIdOf({ kind: "sanitation", id: "sep1" }, layout)).toBeNull();
    expect(floorIdOf({ kind: "roofZone", id: "rz1" }, layout)).toBe("f1");
    expect(floorIdOf({ kind: "lamp", id: "lamp1" }, layout)).toBe("f1");
  });
});

describe("entity-ref — refResolves (validateSelection)", () => {
  it("resolve utk entity yang ada, gagal utk yang hilang", () => {
    const refs: EntityRef[] = [
      { kind: "room", id: "kamar" },
      { kind: "opening", id: "op1" },
      { kind: "sanitation", id: "cb1" },
      { kind: "roof" },
      { kind: "wall", roomId: "kamar", side: "s" },
    ];
    for (const r of refs) expect(refResolves(r, layout)).toBe(true);
    expect(refResolves({ kind: "room", id: "gone" }, layout)).toBe(false);
    expect(refResolves({ kind: "opening", id: "gone" }, layout)).toBe(false);
    expect(refResolves({ kind: "wall", roomId: "gone", side: "n" }, layout)).toBe(false);
    expect(refResolves(null, layout)).toBe(false);
  });
});
