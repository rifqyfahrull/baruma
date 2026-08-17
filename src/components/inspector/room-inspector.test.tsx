import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useEditorStore } from "@/stores/editor-store";
import { makeLayout, sampleSite } from "@/test-utils/fixtures";
import type { DesignLayout } from "@/types";
import { EntityInspector } from "./registry";

// Radix Slider (kedalaman kolam) butuh ResizeObserver — tak ada di jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

const twoFloorLayout = (): DesignLayout => ({
  ...makeLayout(),
  floors: [
    { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
    { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.2 },
  ],
});

describe("RoomInspectorCard — inspector terpadu ruang", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(twoFloorLayout(), sampleSite, []);
    useEditorStore.getState().select({ kind: "room", id: "r1" });
  });
  afterEach(cleanup);

  it("merender field inti identik di surface 2d dan 3d", () => {
    for (const surface of ["2d", "3d"] as const) {
      const { unmount } = render(<EntityInspector surface={surface} />);
      expect(screen.getByTestId("room-inspector"), surface).toBeTruthy();
      expect(screen.getByLabelText("Lantai ruang"), surface).toBeTruthy();
      expect(screen.getByText("Nama"), surface).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Hapus ruang" }),
        surface,
      ).toBeTruthy();
      unmount();
    }
  });

  it("pindah lantai me-re-select ruang di lantai barunya (setSelectedFloor mengosongkan seleksi)", () => {
    // Panggil jalur moveToFloor langsung lewat store (Select radix sulit
    // dibuka di jsdom): urutan updateRoom → setSelectedFloor → selectObject.
    const st = useEditorStore.getState();
    st.updateRoom("r1", { floorId: "floor-2" });
    st.setSelectedFloor("floor-2");
    st.selectObject("r1");

    const after = useEditorStore.getState();
    expect(after.selectedFloorId).toBe("floor-2");
    expect(after.selected).toEqual({ kind: "room", id: "r1" });
  });

  it("Hapus ruang men-delete via deleteRef dan membersihkan seleksi", () => {
    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus ruang" }));
    expect(
      useEditorStore.getState().layout!.rooms.find((r) => r.id === "r1"),
    ).toBeUndefined();
    expect(useEditorStore.getState().selected).toBeNull();
  });
});

describe("RoomInspectorCard — section kolam (migrasi PoolQuickEditor)", () => {
  beforeEach(() => {
    const layout = twoFloorLayout();
    layout.rooms.push({
      id: "pool-1",
      floorId: "floor-1",
      name: "Kolam",
      type: "kolam",
      x: 4,
      y: 4,
      width: 3,
      depth: 2,
      areaM2: 6,
    });
    useEditorStore.getState().loadLayout(layout, sampleSite, []);
    useEditorStore.getState().select({ kind: "room", id: "pool-1" });
  });
  afterEach(cleanup);

  it("ruang kolam merender section pool (testid pool-quick-editor) di kedua surface", () => {
    for (const surface of ["2d", "3d"] as const) {
      const { unmount } = render(<EntityInspector surface={surface} />);
      expect(screen.getByTestId("pool-quick-editor"), surface).toBeTruthy();
      expect(screen.getByLabelText("Kedalaman kolam (meter)"), surface).toBeTruthy();
      unmount();
    }
  });

  it("ganti tipe kolam menulis poolKind + kedalaman default", () => {
    render(<EntityInspector surface="3d" />);
    fireEvent.click(screen.getByRole("button", { name: "Kolam anak" }));
    const pool = useEditorStore
      .getState()
      .layout!.rooms.find((r) => r.id === "pool-1")!;
    expect(pool.poolKind).toBe("anak");
    expect(pool.poolDepthM).toBeGreaterThan(0);
  });

  it("pool-delete menghapus ruang kolam via deleteRef", () => {
    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByTestId("pool-delete"));
    expect(
      useEditorStore.getState().layout!.rooms.find((r) => r.id === "pool-1"),
    ).toBeUndefined();
  });
});

describe("RoomInspectorCard — railing void (dedupe dgn RailingRoomContextCard)", () => {
  afterEach(cleanup);

  const withRoom = (type: "void" | "balkon") => {
    const layout = twoFloorLayout();
    layout.rooms.push({
      id: "rx",
      floorId: "floor-2",
      name: type,
      type,
      x: 4,
      y: 4,
      width: 2,
      depth: 2,
      areaM2: 4,
    });
    useEditorStore.getState().loadLayout(layout, sampleSite, []);
    useEditorStore.getState().select({ kind: "room", id: "rx" });
  };

  it("void → blok Model railing tampil di kartu ruang (default besi)", () => {
    withRoom("void");
    render(<EntityInspector surface="2d" />);
    expect(screen.getByText("Model railing")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Besi" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("balkon → TIDAK ada blok railing di kartu ruang (ditangani RailingRoomContextCard)", () => {
    withRoom("balkon");
    render(<EntityInspector surface="2d" />);
    expect(screen.queryByText("Model railing")).toBeNull();
  });
});
