import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useEditorStore } from "@/stores/editor-store";
import { useAssetPickerStore } from "@/components/assets/asset-picker-host";
import { makeLayout, sampleSite } from "@/test-utils/fixtures";
import type { DesignLayout } from "@/types";
import { EntityInspector } from "./registry";

const layoutWithOpening = (): DesignLayout => ({
  ...makeLayout(),
  openings: [
    {
      id: "op-1",
      floorId: "floor-1",
      wallId: "r1:n",
      type: "window",
      kind: "sliding_window",
      purpose: "ventilation",
      operation: "sliding",
      frameMaterial: "aluminium",
      privacyLevel: "medium",
      shading: "overhang",
      positionM: 0.8,
      widthM: 1.2,
      heightM: 1.2,
      sillHeightM: 0.8,
      headHeightM: 2,
    },
  ],
});

// Field yang WAJIB identik di kedua surface (kontrak §3.4 unifikasi):
const EXPECTED_FIELDS = [
  "Tipe bukaan",
  "Lebar (m)",
  "Tinggi (m)",
  "Posisi di dinding (m)",
  "Ambang bawah (m)",
  "Ambang atas (m)",
  "Cara buka",
  "Material frame",
  "Warna kusen custom",
  "Privasi",
  "Shading",
  "Catatan bukaan",
];

describe("OpeningInspectorCard — inspector terpadu", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(layoutWithOpening(), sampleSite, []);
    useEditorStore.getState().select({ kind: "opening", id: "op-1" });
    useAssetPickerStore.setState({ request: null });
  });
  afterEach(cleanup);

  it("merender field yang PERSIS sama di surface 2d dan 3d (superset merge)", () => {
    for (const surface of ["2d", "3d"] as const) {
      const { unmount } = render(<EntityInspector surface={surface} />);
      for (const label of EXPECTED_FIELDS) {
        expect(screen.getByLabelText(label), `${label} @ ${surface}`).toBeTruthy();
      }
      expect(screen.getByTestId("opening-quick-editor")).toBeTruthy();
      expect(screen.getByTestId("opening-pick-model")).toBeTruthy();
      // Jendela → kartu gorden ikut tampil.
      expect(screen.getByTestId("opening-pick-curtain")).toBeTruthy();
      unmount();
    }
  });

  it("commit angka via blur menulis ke editor-store (satu jalur utk kedua surface)", () => {
    render(<EntityInspector surface="3d" />);
    const width = screen.getByLabelText("Lebar (m)");
    fireEvent.change(width, { target: { value: "1.8" } });
    fireEvent.blur(width);
    expect(useEditorStore.getState().layout!.openings[0].widthM).toBe(1.8);
  });

  it("pilih model menangkap ID BUKAAN SAAT KLIK ke AssetTarget (race commit-time tertutup)", () => {
    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByTestId("opening-pick-model"));
    expect(useAssetPickerStore.getState().request).toEqual({
      type: "opening-model",
      openingId: "op-1",
    });
    fireEvent.click(screen.getByTestId("opening-pick-curtain"));
    expect(useAssetPickerStore.getState().request).toEqual({
      type: "opening-curtain",
      openingId: "op-1",
    });
  });

  it("Hapus bukaan memakai deleteRef typed + seleksi bersih (epilogue)", () => {
    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus bukaan" }));
    const s = useEditorStore.getState();
    expect(s.layout!.openings).toHaveLength(0);
    expect(s.selected).toBeNull();
  });

  it("tombol tutup membersihkan seleksi terpadu", () => {
    render(<EntityInspector surface="3d" />);
    fireEvent.click(screen.getByLabelText("Tutup editor bukaan"));
    expect(useEditorStore.getState().selected).toBeNull();
  });

  it("kind belum termigrasi -> EntityInspector null (kartu lama tetap menangani)", () => {
    useEditorStore.getState().select({ kind: "electrical", id: "el-x" });
    const { container } = render(<EntityInspector surface="3d" />);
    expect(container.innerHTML).toBe("");
  });
});
