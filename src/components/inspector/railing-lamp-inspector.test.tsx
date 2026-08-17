import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useEditorStore } from "@/stores/editor-store";
import { useAssetPickerStore } from "@/components/assets/asset-picker-host";
import { ROOFTOP_RAIL_ID } from "@/lib/three/build-model";
import { makeLayout, sampleSite } from "@/test-utils/fixtures";
import type { DesignLayout } from "@/types";
import { EntityInspector } from "./registry";
import { RailingRoomContextCard } from "./railing-inspector";

// Radix Slider (kartu lampu) butuh ResizeObserver — tak ada di jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

const seeded = (): DesignLayout => ({
  ...makeLayout(),
  floors: [
    { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
    { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
  ],
  rooms: [
    ...makeLayout().rooms,
    { id: "balkon-1", floorId: "floor-1", name: "Balkon", type: "balkon", x: 6, y: 0, width: 2, depth: 3, areaM2: 6 },
    { id: "lounge-1", floorId: "floor-rooftop", name: "Rooftop lounge", type: "rooftop_lounge", x: 0, y: 0, width: 3, depth: 3, areaM2: 9 },
  ],
  exteriorLamps: [
    { id: "lamp-1", kind: "wall", x: 1, y: 0, mountH: 2.2, floorId: "floor-1" } as never,
  ],
});

beforeEach(() => {
  useEditorStore.getState().loadLayout(seeded(), sampleSite, []);
  useAssetPickerStore.setState({ request: null });
});
afterEach(cleanup);

describe("RailingInspectorCard — registry (kind railing)", () => {
  it("balkon: ganti gaya menulis Room.railingStyle + melepas model kustom", () => {
    useEditorStore.getState().select({ kind: "railing", roomId: "balkon-1" });
    render(<EntityInspector surface="3d" />);
    expect(screen.getByTestId("railing-quick-editor")).toBeTruthy();
    expect(screen.getByText("Railing — Balkon")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Besi/ }));
    const room = useEditorStore.getState().layout!.rooms.find((r) => r.id === "balkon-1")!;
    expect(room.railingStyle).toBe("besi");
    expect(room.railingModelUrl).toBeNull();
  });

  it("dak rooftop (sentinel): ganti gaya menulis layout.rooftopRailingStyle", () => {
    useEditorStore.getState().select({ kind: "railing", roomId: ROOFTOP_RAIL_ID });
    render(<EntityInspector surface="3d" />);
    expect(screen.getByText("Railing — Dak Rooftop")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Kayu/ }));
    expect(useEditorStore.getState().layout!.rooftopRailingStyle).toBe("kayu");
  });

  it("pilih model menangkap target SAAT KLIK (balkon vs dak dibedakan)", () => {
    useEditorStore.getState().select({ kind: "railing", roomId: "balkon-1" });
    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByTestId("railing-pick-model"));
    expect(useAssetPickerStore.getState().request).toEqual({ type: "railing", roomId: "balkon-1" });
    cleanup();
    useEditorStore.getState().select({ kind: "railing", roomId: ROOFTOP_RAIL_ID });
    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByTestId("railing-pick-model"));
    expect(useAssetPickerStore.getState().request).toEqual({ type: "rooftop-railing" });
  });
});

describe("RailingRoomContextCard — jalur implisit 3D", () => {
  it("ruang balkon terpilih → kartu railing tampil; ruang biasa → tidak", () => {
    useEditorStore.getState().select({ kind: "room", id: "balkon-1" });
    const { unmount } = render(<RailingRoomContextCard surface="3d" />);
    expect(screen.getByTestId("railing-quick-editor")).toBeTruthy();
    unmount();
    useEditorStore.getState().select({ kind: "room", id: "r1" });
    const { container } = render(<RailingRoomContextCard surface="3d" />);
    expect(container.innerHTML).toBe("");
  });

  it("ruang di floor-rooftop → kartu railing DAK", () => {
    useEditorStore.getState().select({ kind: "room", id: "lounge-1" });
    render(<RailingRoomContextCard surface="3d" />);
    expect(screen.getByText("Railing — Dak Rooftop")).toBeTruthy();
  });
});

describe("LampInspectorCard — registry (kind lamp)", () => {
  it("render identik 2d/3d utk field data; hint mode-malam hanya di 3d", () => {
    useEditorStore.getState().select({ kind: "lamp", id: "lamp-1" });
    for (const surface of ["2d", "3d"] as const) {
      const { unmount } = render(<EntityInspector surface={surface} />);
      expect(screen.getByTestId("lamp-quick-editor")).toBeTruthy();
      expect(screen.getByLabelText("Warna cahaya lampu")).toBeTruthy();
      expect(screen.getByLabelText("Daya (Watt)")).toBeTruthy();
      expect(screen.getByLabelText("Tinggi pasang (m)")).toBeTruthy(); // kind wall
      const nightHint = screen.queryByText(/mode malam/);
      if (surface === "3d") expect(nightHint).toBeTruthy();
      else expect(nightHint).toBeNull();
      unmount();
    }
  });

  it("Hapus lampu via deleteRef + pilih model menangkap id lampu", () => {
    useEditorStore.getState().select({ kind: "lamp", id: "lamp-1" });
    render(<EntityInspector surface="3d" />);
    fireEvent.click(screen.getByTestId("lamp-pick-model"));
    expect(useAssetPickerStore.getState().request).toEqual({ type: "lamp", id: "lamp-1" });
    fireEvent.click(screen.getByRole("button", { name: "Hapus lampu" }));
    expect(useEditorStore.getState().layout!.exteriorLamps ?? []).toHaveLength(0);
    expect(useEditorStore.getState().selected).toBeNull();
  });
});
