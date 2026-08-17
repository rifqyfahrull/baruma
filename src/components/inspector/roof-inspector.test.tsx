import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useEditorStore } from "@/stores/editor-store";
import { makeLayout, sampleSite } from "@/test-utils/fixtures";
import { makeRoofZone } from "@/lib/exterior/factories";
import { EntityInspector } from "./registry";

// Radix Slider butuh ResizeObserver — tak ada di jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

describe("RoofInspectorCard — kind roof (atap global)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, []);
    useEditorStore.getState().select({ kind: "roof" });
  });
  afterEach(cleanup);

  it("merender kartu identik di surface 2d dan 3d (testid + kontrol inti)", () => {
    for (const surface of ["2d", "3d"] as const) {
      const { unmount } = render(<EntityInspector surface={surface} />);
      expect(screen.getByTestId("roof-quick-editor"), surface).toBeTruthy();
      expect(screen.getByRole("group", { name: "Tipe atap" }), surface).toBeTruthy();
      expect(screen.getByLabelText("Material atap"), surface).toBeTruthy();
      expect(screen.getByLabelText("Lis fascia"), surface).toBeTruthy();
      expect(screen.getByLabelText("Rooftop (dak beton)"), surface).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Jadikan zona atap editable" }),
        surface,
      ).toBeTruthy();
      unmount();
    }
  });

  it("mengubah tipe atap menulis ke layout.roof", () => {
    render(<EntityInspector surface="3d" />);
    const group = screen.getByRole("group", { name: "Tipe atap" });
    fireEvent.click(
      Array.from(group.querySelectorAll("button")).find(
        (b) => b.getAttribute("aria-pressed") === "false",
      )!,
    );
    expect(useEditorStore.getState().layout!.roof?.type).toBeTruthy();
  });

  it("toggle rooftop me-RE-SELECT {kind:'roof'} (setRooftop mengosongkan seleksi)", () => {
    render(<EntityInspector surface="3d" />);
    fireEvent.click(screen.getByLabelText("Rooftop (dak beton)"));

    const st = useEditorStore.getState();
    expect(st.layout!.floors.some((f) => f.id === "floor-rooftop")).toBe(true);
    expect(st.selected).toEqual({ kind: "roof" });
    // Kartu tetap terbuka (tidak menutup diri).
    expect(screen.getByTestId("roof-quick-editor")).toBeTruthy();
  });

  it("tombol tutup membersihkan seleksi", () => {
    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByLabelText("Tutup editor atap"));
    expect(useEditorStore.getState().selected).toBeNull();
  });
});

describe("RoofInspectorCard — kind roofZone", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(
      {
        ...makeLayout(),
        roofZones: [
          makeRoofZone("pelana", 4, 4, { id: "rz-1", widthM: 6, depthM: 4 }),
        ],
      },
      sampleSite,
      [],
    );
    useEditorStore.getState().select({ kind: "roofZone", id: "rz-1" });
  });
  afterEach(cleanup);

  it("merender heading 'Zona atap' + kontrol split identik di kedua surface", () => {
    for (const surface of ["2d", "3d"] as const) {
      const { unmount } = render(<EntityInspector surface={surface} />);
      expect(
        screen.getByRole("heading", { name: "Zona atap" }),
        surface,
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Kiri / kanan" }), surface).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Depan / belakang" }),
        surface,
      ).toBeTruthy();
      expect(screen.getByLabelText("Sembunyikan zona"), surface).toBeTruthy();
      unmount();
    }
  });

  it("Hapus zona atap men-delete zona via deleteRef", () => {
    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus zona atap" }));
    expect(useEditorStore.getState().layout!.roofZones ?? []).toHaveLength(0);
    expect(useEditorStore.getState().selected).toBeNull();
  });
});

describe("RoofInspectorCard — akses dak", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(
      {
        ...makeLayout(),
        floors: [
          { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
          { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.2 },
          { id: "floor-rooftop", level: 3, name: "Rooftop", heightM: 0.3 },
        ],
      },
      sampleSite,
      [],
    );
    useEditorStore.getState().select({ kind: "roof" });
  });
  afterEach(cleanup);

  it("dak tanpa akses → section akses tampil dgn dua opsi arsitek", () => {
    render(<EntityInspector surface="3d" />);
    expect(screen.getByTestId("rooftop-access-section")).toBeTruthy();
    expect(screen.getByTestId("rooftop-access-add-stair")).toBeTruthy();
    expect(screen.getByTestId("rooftop-access-add-ladder")).toBeTruthy();
  });

  it("+ Tangga ke dak menaruh room tangga di lantai teratas", () => {
    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByTestId("rooftop-access-add-stair"));
    const stair = useEditorStore
      .getState()
      .layout!.rooms.find((r) => r.type === "tangga");
    expect(stair?.floorId).toBe("floor-2");
  });

  it("+ Tangga monyet menulis rooftopAccess dan membuka picker sisi", () => {
    render(<EntityInspector surface="3d" />);
    fireEvent.click(screen.getByTestId("rooftop-access-add-ladder"));
    expect(useEditorStore.getState().layout!.rooftopAccess).toEqual({
      kind: "tangga_monyet",
      side: "s",
    });
    expect(screen.getByRole("group", { name: "Sisi tangga monyet" })).toBeTruthy();
  });
});

describe("RoofInspectorCard — posisi tangga monyet", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(
      {
        ...makeLayout(),
        floors: [
          { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
          { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
        ],
      },
      sampleSite,
      [],
    );
    useEditorStore.getState().setRooftopAccessLadder("s");
    useEditorStore.getState().select({ kind: "roof" });
  });
  afterEach(cleanup);

  it("NumField posisi menulis posM (ter-clamp) via setRooftopAccessLadder", () => {
    render(<EntityInspector surface="2d" />);
    const input = screen.getByLabelText(/Posisi di sisi/);
    fireEvent.change(input, { target: { value: "2.4" } });
    fireEvent.blur(input);
    expect(useEditorStore.getState().layout!.rooftopAccess?.posM).toBe(2.4);
  });
});
