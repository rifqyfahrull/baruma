// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";

import { useEditorStore } from "@/stores/editor-store";
import {
  makeBoxElement,
  makeFrameElement,
  makeRoofZone,
  makeSegmentElement,
  makeStairElement,
  makeSurfaceElement,
} from "@/lib/exterior/factories";
import { segmentLength } from "@/lib/exterior/geometry";
import type { DesignLayout, ExteriorElement } from "@/types";

const layout = (): DesignLayout => ({
  id: "l",
  projectId: "p",
  versionId: "v",
  floors: [
    { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3 },
    { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3 },
  ],
  rooms: [
    {
      id: "r1",
      floorId: "floor-1",
      name: "R",
      type: "ruang_tamu",
      x: 0,
      y: 0,
      width: 3,
      depth: 3,
      areaM2: 9,
    },
  ],
  walls: [],
  openings: [],
  stairs: [],
  pools: [],
  validation: { passed: true, issues: [] },
});

const site = { widthM: 10, depthM: 12 };

describe("editor-store exterior elements", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(layout(), site, []);
  });

  it("addExteriorElement appends a segment and records one undo entry", () => {
    const before = useEditorStore.getState().past.length;
    const fence = makeSegmentElement(
      "fence",
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { label: "Front fence" },
    );
    useEditorStore.getState().addExteriorElement(fence);
    const st = useEditorStore.getState();
    expect(st.layout!.exteriorElements).toHaveLength(1);
    expect(st.layout!.exteriorElements![0].id).toBe(fence.id);
    expect(st.past.length).toBe(before + 1);
    expect(st.dirty).toBe(true);
  });

  it("updateExteriorElement patches a field and records one undo entry", () => {
    const fence = makeSegmentElement("fence", { x: 0, y: 0 }, { x: 5, y: 0 });
    useEditorStore.getState().addExteriorElement(fence);
    const before = useEditorStore.getState().past.length;
    useEditorStore.getState().updateExteriorElement(fence.id, { heightM: 3 });
    const el = useEditorStore.getState().layout!.exteriorElements![0];
    expect(el.heightM).toBe(3);
    expect(useEditorStore.getState().past.length).toBe(before + 1);
  });

  it("updateExteriorElement rotationDeg recomputes end around start, keeping length (W: pagar panjang+rotasi)", () => {
    const fence = makeSegmentElement("fence", { x: 2, y: 2 }, { x: 6, y: 2 }); // length 4, angle 0°
    useEditorStore.getState().addExteriorElement(fence);
    useEditorStore.getState().updateExteriorElement(fence.id, { rotationDeg: 90 });
    const el = useEditorStore.getState().layout!.exteriorElements![0] as ExteriorElement & {
      start: { x: number; y: number };
      end: { x: number; y: number };
    };
    // start tetap (pivot); end berputar 90° di sekeliling start, panjang 4
    // dipertahankan — matches Prim.rotationY = -atan2(dy,dx) convention
    // dipakai exterior-primitives.ts (rotasi Y "benar").
    expect(el.start).toEqual({ x: 2, y: 2 });
    expect(el.end.x).toBeCloseTo(2, 6);
    expect(el.end.y).toBeCloseTo(6, 6);
    const angle = Math.atan2(el.end.y - el.start.y, el.end.x - el.start.x);
    expect(angle).toBeCloseTo((90 * Math.PI) / 180, 6);
  });

  it("updateExteriorElement rotationDeg is a no-op when patch also sends an explicit end", () => {
    const fence = makeSegmentElement("fence", { x: 0, y: 0 }, { x: 4, y: 0 });
    useEditorStore.getState().addExteriorElement(fence);
    useEditorStore.getState().updateExteriorElement(fence.id, {
      rotationDeg: 90,
      end: { x: 4, y: 0 },
    });
    const el = useEditorStore.getState().layout!.exteriorElements![0] as ExteriorElement & {
      end: { x: number; y: number };
    };
    // Patch caller yang SUDAH menyertakan end eksplisit menang — tak
    // ditimpa oleh recompute rotationDeg.
    expect(el.end).toEqual({ x: 4, y: 0 });
  });

  it("BUG 1 regresi: seleksi + panel entity bertahan lewat beberapa commit field berturut-turut (Tinggi -> Panjang -> Rotasi), tanpa menyentuh data lain (mis. atap)", () => {
    const fence = makeSegmentElement("fence", { x: 0, y: 0 }, { x: 3, y: 0 });
    useEditorStore.getState().addExteriorElement(fence);
    useEditorStore.getState().select({ kind: "exterior", id: fence.id });

    const roofBefore = useEditorStore.getState().layout!.roof;

    // Tinggi
    useEditorStore.getState().updateExteriorElement(fence.id, { heightM: 2.6 });
    expect(useEditorStore.getState().selected).toEqual({ kind: "exterior", id: fence.id });

    // Panjang (dikonversi ke `end` baru, arah dipertahankan)
    useEditorStore.getState().updateExteriorElement(fence.id, { end: { x: 5, y: 0 } });
    expect(useEditorStore.getState().selected).toEqual({ kind: "exterior", id: fence.id });

    // Rotasi
    useEditorStore.getState().updateExteriorElement(fence.id, { rotationDeg: 45 });
    expect(useEditorStore.getState().selected).toEqual({ kind: "exterior", id: fence.id });

    // selectedObjectId (mirror legacy) juga tetap konsisten sepanjang urutan.
    expect(useEditorStore.getState().selectedObjectId).toBe(fence.id);

    // Data global (atap) TIDAK ikut berubah oleh ketiga commit di atas.
    expect(useEditorStore.getState().layout!.roof).toEqual(roofBefore);

    const el = useEditorStore.getState().layout!.exteriorElements![0];
    expect(el.heightM).toBe(2.6);
  });

  it("removeExteriorElement deletes by id and records one undo entry", () => {
    const fence = makeSegmentElement("fence", { x: 0, y: 0 }, { x: 5, y: 0 });
    useEditorStore.getState().addExteriorElement(fence);
    const before = useEditorStore.getState().past.length;
    useEditorStore.getState().removeExteriorElement(fence.id);
    expect(useEditorStore.getState().layout!.exteriorElements).toBeUndefined();
    expect(useEditorStore.getState().past.length).toBe(before + 1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().layout!.exteriorElements).toHaveLength(1);
  });

  it("duplicateExteriorElement creates a translated copy with a new id", () => {
    const fence = makeSegmentElement("fence", { x: 0, y: 0 }, { x: 5, y: 0 });
    useEditorStore.getState().addExteriorElement(fence);
    useEditorStore.getState().duplicateExteriorElement(fence.id);
    const elements = useEditorStore.getState().layout!.exteriorElements!;
    expect(elements).toHaveLength(2);
    const copy = elements.find((e: { id: string }) => e.id !== fence.id)!;
    expect(copy.id).not.toBe(fence.id);
    expect(copy.kind).toBe("fence");
    expect("start" in copy && copy.start.x).toBe(0.5);
  });

  it("setExteriorElementLocked toggles the locked flag", () => {
    const fence = makeSegmentElement("fence", { x: 0, y: 0 }, { x: 5, y: 0 });
    useEditorStore.getState().addExteriorElement(fence);
    useEditorStore.getState().setExteriorElementLocked(fence.id, true);
    expect(useEditorStore.getState().layout!.exteriorElements![0].locked).toBe(
      true,
    );
  });

  it("setExteriorElementHidden toggles the hidden flag", () => {
    const fence = makeSegmentElement("fence", { x: 0, y: 0 }, { x: 5, y: 0 });
    useEditorStore.getState().addExteriorElement(fence);
    useEditorStore.getState().setExteriorElementHidden(fence.id, true);
    expect(useEditorStore.getState().layout!.exteriorElements![0].hidden).toBe(
      true,
    );
  });

  it("deleteObject removes an exterior element when selected", () => {
    const fence = makeSegmentElement("fence", { x: 0, y: 0 }, { x: 5, y: 0 });
    useEditorStore.getState().addExteriorElement(fence);
    useEditorStore.getState().selectObject(fence.id);
    useEditorStore.getState().deleteSelected();
    expect(useEditorStore.getState().layout!.exteriorElements).toBeUndefined();
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
  });

  it("dragExteriorResize moves one polygon vertex without rebuilding the element", () => {
    const driveway = makeSurfaceElement("driveway", [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 1, y: 2 },
    ], { id: "drive-poly" });
    useEditorStore.getState().addExteriorElement(driveway);

    useEditorStore.getState().beginDrag();
    useEditorStore.getState().dragExteriorResize("drive-poly", "v1", 4.25, 0.75);
    useEditorStore.getState().endDrag();

    const el = useEditorStore.getState().layout!.exteriorElements![0];
    expect("points" in el && el.points[1]).toEqual({ x: 4.25, y: 0.75 });
    expect(el.id).toBe("drive-poly");
  });

  it("dragExteriorResize resizes an exterior stair footprint by direction", () => {
    const stair = makeStairElement(1, 2, {
      id: "stair-ext",
      direction: "e",
      lengthM: 1.8,
      widthM: 1.2,
    });
    useEditorStore.getState().addExteriorElement(stair);

    useEditorStore.getState().beginDrag();
    useEditorStore.getState().dragExteriorResize("stair-ext", "se", 3.5, 4);
    useEditorStore.getState().endDrag();

    const el = useEditorStore.getState().layout!.exteriorElements![0];
    expect(el).toMatchObject({
      id: "stair-ext",
      kind: "exterior_stair",
      x: 1,
      y: 2,
      lengthM: 2.5,
      widthM: 2,
    });
  });

  it("dragExteriorTo moves a box element's anchor x/y (Bug 1 — drag reposition)", () => {
    const column = makeBoxElement("column", 2, 3, { id: "col-1" });
    useEditorStore.getState().addExteriorElement(column);

    useEditorStore.getState().beginDrag();
    useEditorStore.getState().dragExteriorTo("col-1", { x: 5, y: 6 });
    useEditorStore.getState().endDrag();

    const el = useEditorStore.getState().layout!.exteriorElements![0];
    expect(el).toMatchObject({ id: "col-1", x: 5, y: 6, widthM: column.widthM, depthM: column.depthM });
  });

  it("dragExteriorTo moves a segment's start+end together, preserving length & rotation (Bug 1)", () => {
    const fence = makeSegmentElement("fence", { x: 2, y: 2 }, { x: 6, y: 2 }); // length 4, angle 0
    useEditorStore.getState().addExteriorElement(fence);
    const before = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((e) => e.id === fence.id) as ExteriorElement & {
      start: { x: number; y: number };
      end: { x: number; y: number };
    };
    const beforeLength = segmentLength(before.start, before.end);
    const beforeAngle = Math.atan2(
      before.end.y - before.start.y,
      before.end.x - before.start.x,
    );

    // Body drag translates BOTH endpoints by the same delta (dx=3, dy=1) —
    // mirrors plan-canvas.tsx's "exteriorMove" handler for segments.
    useEditorStore.getState().beginDrag();
    useEditorStore.getState().dragExteriorTo(fence.id, {
      start: { x: before.start.x + 3, y: before.start.y + 1 },
      end: { x: before.end.x + 3, y: before.end.y + 1 },
    });
    useEditorStore.getState().endDrag();

    const after = useEditorStore
      .getState()
      .layout!.exteriorElements![0] as ExteriorElement & {
      start: { x: number; y: number };
      end: { x: number; y: number };
    };
    expect(after.start).toEqual({ x: 5, y: 3 });
    expect(after.end).toEqual({ x: 9, y: 3 });
    expect(segmentLength(after.start, after.end)).toBeCloseTo(beforeLength, 6);
    const afterAngle = Math.atan2(
      after.end.y - after.start.y,
      after.end.x - after.start.x,
    );
    expect(afterAngle).toBeCloseTo(beforeAngle, 6);
  });

  it("dragExteriorTo is a no-op on a locked element — layout stays byte-identical", () => {
    const column = makeBoxElement("column", 2, 3, { id: "col-locked" });
    useEditorStore.getState().addExteriorElement(column);
    useEditorStore.getState().setExteriorElementLocked("col-locked", true);
    const before = JSON.stringify(useEditorStore.getState().layout);

    useEditorStore.getState().beginDrag();
    useEditorStore.getState().dragExteriorTo("col-locked", { x: 9, y: 9 });
    useEditorStore.getState().endDrag();

    const after = JSON.stringify(useEditorStore.getState().layout);
    expect(after).toBe(before);
  });

  it("removeFloor removes only exterior elements owned by that floor", () => {
    const groundFence = makeSegmentElement(
      "fence",
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { floorId: "floor-1" },
    );
    const upperPortal = makeFrameElement(2, 2, { floorId: "floor-2" });
    const siteWall = makeSegmentElement(
      "boundary_wall",
      { x: 0, y: 0 },
      { x: 0, y: 5 },
      { floorId: undefined },
    );
    const s = useEditorStore.getState();
    s.addExteriorElement(groundFence);
    s.addExteriorElement(upperPortal);
    s.addExteriorElement(siteWall);

    s.removeFloor("floor-1");
    const remaining = useEditorStore.getState().layout!.exteriorElements!;
    expect(
      remaining.some((e: ExteriorElement) => e.id === groundFence.id),
    ).toBe(false);
    expect(
      remaining.some((e: ExteriorElement) => e.id === upperPortal.id),
    ).toBe(true);
    expect(remaining.some((e: ExteriorElement) => e.id === siteWall.id)).toBe(
      true,
    );
  });

  it("add/update/delete roof zones with undo-aware mutations", () => {
    const zone = makeRoofZone("pelana", 4, 5, {
      floorId: "floor-2",
      widthM: 6,
      depthM: 4,
      materialId: "metal",
    });
    const s = useEditorStore.getState();
    const before = s.past.length;

    s.addRoofZone(zone);
    expect(useEditorStore.getState().layout!.roofZones).toHaveLength(1);
    expect(useEditorStore.getState().selectedObjectId).toBe(zone.id);
    expect(useEditorStore.getState().past.length).toBe(before + 1);

    useEditorStore.getState().updateRoofZone(zone.id, {
      type: "miring",
      lowSide: "e",
      slopeDeg: 10,
    });
    expect(useEditorStore.getState().layout!.roofZones![0]).toMatchObject({
      type: "miring",
      lowSide: "e",
      slopeDeg: 10,
    });

    useEditorStore.getState().selectObject(zone.id);
    useEditorStore.getState().deleteSelected();
    expect(useEditorStore.getState().layout!.roofZones).toBeUndefined();
  });

  it("convertLegacyRoofToZone materializes the global roof footprint once", () => {
    const l = layout();
    l.roof = {
      type: "miring",
      slopeDeg: 12,
      overhangM: 0.4,
      material: "metal",
      lowSide: "e",
    };
    useEditorStore.getState().loadLayout(l, site, []);

    const before = useEditorStore.getState().past.length;
    useEditorStore.getState().convertLegacyRoofToZone();
    const st = useEditorStore.getState();
    const zone = st.layout!.roofZones![0];

    expect(st.layout!.roofZones).toHaveLength(1);
    expect(zone).toMatchObject({
      type: "miring",
      x: 1.5,
      y: 1.5,
      widthM: 3,
      depthM: 3,
      slopeDeg: 12,
      overhangM: 0.4,
      materialId: "metal",
      lowSide: "e",
    });
    expect(st.selectedObjectId).toBe(zone.id);
    expect(st.past.length).toBe(before + 1);

    useEditorStore.getState().convertLegacyRoofToZone();
    expect(useEditorStore.getState().layout!.roofZones).toHaveLength(1);
  });

  it("splitRoofZone creates two adjacent zones in one undo entry", () => {
    const zone = makeRoofZone("limasan", 4, 5, {
      widthM: 6,
      depthM: 4,
      materialId: "aspal",
    });
    const s = useEditorStore.getState();
    s.addRoofZone(zone);
    const before = useEditorStore.getState().past.length;

    s.splitRoofZone(zone.id, "x");
    const st = useEditorStore.getState();
    const zones = st.layout!.roofZones!;

    expect(zones).toHaveLength(2);
    expect(zones.map((z) => z.id)).not.toContain(zone.id);
    expect(zones.every((z) => z.type === "limasan")).toBe(true);
    expect(zones.every((z) => z.materialId === "aspal")).toBe(true);
    expect(zones.map((z) => z.widthM).sort()).toEqual([3, 3]);
    expect(zones.map((z) => z.depthM)).toEqual([4, 4]);
    expect(zones.map((z) => z.x).sort()).toEqual([2.5, 5.5]);
    expect(st.selectedObjectId).toBe(zones[0].id);
    expect(st.past.length).toBe(before + 1);

    s.undo();
    expect(useEditorStore.getState().layout!.roofZones).toHaveLength(1);
    expect(useEditorStore.getState().layout!.roofZones![0].id).toBe(zone.id);
  });

  it("removeFloor removes roof zones owned by that floor", () => {
    const s = useEditorStore.getState();
    const ground = makeRoofZone("datar", 2, 2, { floorId: "floor-1" });
    const upper = makeRoofZone("limasan", 4, 4, { floorId: "floor-2" });
    const siteZone = makeRoofZone("pelana", 7, 7);
    s.addRoofZone(ground);
    s.addRoofZone(upper);
    s.addRoofZone(siteZone);

    s.removeFloor("floor-1");
    const remaining = useEditorStore.getState().layout!.roofZones!;
    expect(remaining.some((z) => z.id === ground.id)).toBe(false);
    expect(remaining.some((z) => z.id === upper.id)).toBe(true);
    expect(remaining.some((z) => z.id === siteZone.id)).toBe(true);
  });

  it("dragRoofZoneTo and dragRoofZoneResize record one undo entry per gesture", () => {
    const zone = makeRoofZone("pelana", 4, 5, { widthM: 6, depthM: 4 });
    const s = useEditorStore.getState();
    s.addRoofZone(zone);
    const before = useEditorStore.getState().past.length;

    s.beginDrag();
    s.dragRoofZoneTo(zone.id, 6, 7);
    s.dragRoofZoneTo(zone.id, 7, 8);
    s.dragRoofZoneResize(zone.id, "e", 12, 8);
    s.endDrag();

    const updated = useEditorStore.getState().layout!.roofZones![0];
    expect(updated.x).toBe(8);
    expect(updated.y).toBe(8);
    expect(updated.widthM).toBeGreaterThan(6);
    expect(useEditorStore.getState().past.length).toBe(before + 1);
  });

  it("undo reverts an addExteriorElement mutation", () => {
    const fence = makeSegmentElement("fence", { x: 0, y: 0 }, { x: 5, y: 0 });
    useEditorStore.getState().addExteriorElement(fence);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().layout!.exteriorElements).toBeUndefined();
  });

  it("redo re-applies a reverted addExteriorElement mutation", () => {
    const fence = makeSegmentElement("fence", { x: 0, y: 0 }, { x: 5, y: 0 });
    useEditorStore.getState().addExteriorElement(fence);
    useEditorStore.getState().undo();
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().layout!.exteriorElements).toHaveLength(1);
  });

  it("supports mixed exterior element kinds", () => {
    const segment = makeSegmentElement("fence", { x: 0, y: 0 }, { x: 4, y: 0 });
    const box = makeBoxElement("column", 1, 1);
    const frame = makeFrameElement(2, 2);
    const stair = makeStairElement(3, 3);
    const surface = makeSurfaceElement("driveway", [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: 0, y: 2 },
    ]);
    useEditorStore.getState().addExteriorElement(segment);
    expect(useEditorStore.getState().layout!.exteriorElements?.length).toBe(1);
    useEditorStore.getState().addExteriorElement(box);
    expect(useEditorStore.getState().layout!.exteriorElements?.length).toBe(2);
    useEditorStore.getState().addExteriorElement(frame);
    expect(useEditorStore.getState().layout!.exteriorElements?.length).toBe(3);
    useEditorStore.getState().addExteriorElement(stair);
    expect(useEditorStore.getState().layout!.exteriorElements?.length).toBe(4);
    useEditorStore.getState().addExteriorElement(surface);
    expect(useEditorStore.getState().layout!.exteriorElements?.length).toBe(5);
    const kinds = useEditorStore
      .getState()
      .layout!.exteriorElements!.map((e: ExteriorElement) => e.kind);
    expect(kinds).toContain("fence");
    expect(kinds).toContain("column");
    expect(kinds).toContain("portal_frame");
    expect(kinds).toContain("exterior_stair");
    expect(kinds).toContain("driveway");
  });
});
