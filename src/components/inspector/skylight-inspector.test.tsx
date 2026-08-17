import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useEditorStore, ROOF_LAYER_ID } from "@/stores/editor-store";
import { makeLayout, sampleSite } from "@/test-utils/fixtures";
import { EntityInspector } from "./registry";

// Radix Slider (kartu Atap) butuh ResizeObserver — tak ada di jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

describe("SkylightInspectorCard — kartu skylight terpadu", () => {
  beforeEach(() => {
    // makeLayout: atap datar legacy (roof absen = datar) → host tersedia.
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, []);
  });
  afterEach(cleanup);

  it("addSkylight menaruh skylight ter-clamp di bidang host, memilihnya, dan pindah ke layer Atap", () => {
    const id = useEditorStore.getState().addSkylight();
    const st = useEditorStore.getState();
    expect(id).toBeTruthy();
    const sk = st.layout!.skylights![0];
    expect(sk.kind).toBe("fixed");
    expect(st.selected).toEqual({ kind: "skylight", id });
    expect(st.selectedFloorId).toBe(ROOF_LAYER_ID);
  });

  it("kartu merender field identik di 2d/3d; ganti jenis & ukuran menulis store (re-clamp)", () => {
    useEditorStore.getState().addSkylight();
    for (const surface of ["2d", "3d"] as const) {
      const { unmount } = render(<EntityInspector surface={surface} />);
      expect(screen.getByTestId("skylight-inspector"), surface).toBeTruthy();
      expect(screen.getByLabelText("Lebar (m)"), surface).toBeTruthy();
      expect(screen.getByRole("group", { name: "Jenis skylight" }), surface).toBeTruthy();
      unmount();
    }

    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByRole("button", { name: "Bisa dibuka" }));
    expect(useEditorStore.getState().layout!.skylights![0].kind).toBe("operable");

    const w = screen.getByLabelText("Lebar (m)");
    fireEvent.change(w, { target: { value: "99" } });
    fireEvent.blur(w);
    // Footprint makeLayout lebar 6.5 → ter-clamp ke host.
    expect(useEditorStore.getState().layout!.skylights![0].widthM).toBeLessThanOrEqual(6.5);
  });

  it("Hapus skylight via deleteRef + seleksi bersih", () => {
    useEditorStore.getState().addSkylight();
    render(<EntityInspector surface="3d" />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus skylight" }));
    expect(useEditorStore.getState().layout!.skylights).toBeUndefined();
    expect(useEditorStore.getState().selected).toBeNull();
  });

  it("dragSkylightTo nge-snap ke tepi ruang di bawahnya", () => {
    useEditorStore.getState().addSkylight();
    const id = useEditorStore.getState().layout!.skylights![0].id;
    const st = useEditorStore.getState();
    st.beginDrag();
    // r1 kanan = 3.5; target tepi kiri 3.58 dgn tol 0.1 → snap 3.5.
    st.dragSkylightTo(id, 3.58, 2, 0.1);
    st.endDrag();
    expect(useEditorStore.getState().layout!.skylights![0].x).toBeCloseTo(3.5, 2);
  });
});
