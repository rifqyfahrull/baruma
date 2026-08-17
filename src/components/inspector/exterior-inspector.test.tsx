import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { makeBoxElement, makeFrameElement, makeSegmentElement } from "@/lib/exterior/factories";
import { useEditorStore } from "@/stores/editor-store";
import { usePreviewStore } from "@/stores/preview-store";
import { useAssetPickerStore } from "@/components/assets/asset-picker-host";
import { makeLayout, sampleSite } from "@/test-utils/fixtures";
import type { DesignLayout } from "@/types";
import { EntityInspector } from "./registry";

Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.hasPointerCapture ??= function hasPointerCapture() {
  return false;
};

const layoutWithExterior = (): DesignLayout => ({
  ...makeLayout(),
  exteriorElements: [
    {
      ...makeFrameElement(2, 1, {
        id: "portal-custom-glb",
        label: "Portal beton custom",
      }),
      model: { modelUrl: "/models/portal.glb" },
    },
    makeSegmentElement("fence", { x: 0, y: 0 }, { x: 3, y: 0 }, { id: "pagar-1" }),
  ],
});

beforeEach(() => {
  useEditorStore.getState().loadLayout(layoutWithExterior(), sampleSite, []);
  useAssetPickerStore.setState({ request: null });
});
afterEach(cleanup);

describe("ExteriorInspectorCard — inspector terpadu (dulu read-only di 3D)", () => {
  it("mempertahankan kontrak header e2e: label + badge Native/Custom GLB + tombol tutup", () => {
    useEditorStore.getState().select({ kind: "exterior", id: "portal-custom-glb" });
    render(<EntityInspector surface="3d" />);
    const card = screen.getByTestId("exterior-quick-editor");
    expect(card.textContent).toContain("Elemen eksterior terpilih");
    expect(card.textContent).toContain("Portal beton custom");
    expect(card.textContent).toContain("Custom GLB");

    fireEvent.click(screen.getByRole("button", { name: "Tutup editor elemen eksterior" }));
    expect(useEditorStore.getState().selected).toBeNull();
  });

  it("kini FULL EDIT di kedua surface — field editor 2D hadir di 3D juga", () => {
    useEditorStore.getState().select({ kind: "exterior", id: "pagar-1" });
    for (const surface of ["2d", "3d"] as const) {
      const { unmount } = render(<EntityInspector surface={surface} />);
      // Field inti editor lama (2D-only sebelum unifikasi):
      expect(screen.getByLabelText("Lantai dasar elemen"), surface).toBeTruthy();
      expect(screen.getByTestId("exterior-costing-policy"), surface).toBeTruthy();
      // Badge Native utk elemen tanpa GLB.
      expect(screen.getByTestId("exterior-quick-editor").textContent).toContain("Native");
      unmount();
    }
  });

  it("edit label menulis ke layout (mutasi nyata, bukan read-only)", () => {
    useEditorStore.getState().select({ kind: "exterior", id: "pagar-1" });
    render(<EntityInspector surface="3d" />);
    const label = screen.getByLabelText("Label elemen") as HTMLInputElement;
    fireEvent.change(label, { target: { value: "Pagar depan" } });
    fireEvent.blur(label);
    expect(
      useEditorStore.getState().layout!.exteriorElements!.find((e) => e.id === "pagar-1")!.label,
    ).toBe("Pagar depan");
  });

  it("Ganti model 3D menangkap id + kategori preset saat klik (race tertutup)", () => {
    usePreviewStore.setState({ interactionMode: "edit" });
    useEditorStore.getState().select({ kind: "exterior", id: "pagar-1" });
    render(<EntityInspector surface="3d" />);
    fireEvent.click(screen.getByTestId("exterior-custom-model"));
    expect(useAssetPickerStore.getState().request).toEqual({
      type: "exterior",
      id: "pagar-1",
      initialCategory: "fence",
    });
  });
});

describe("ExteriorInspector — material katalog", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(
      {
        ...makeLayout(),
        exteriorElements: [
          makeBoxElement("facade_panel", 2, 2, { id: "ext-mat-1" }),
        ],
      },
      sampleSite,
      [],
    );
    useEditorStore.getState().select({ kind: "exterior", id: "ext-mat-1" });
  });
  afterEach(cleanup);

  it("klik swatch menulis material.materialId (merge, tidak menimpa field lain)", () => {
    render(<EntityInspector surface="2d" />);
    const section = screen.getByTestId("exterior-material-section");
    fireEvent.click(section.querySelector("button[title]") as HTMLButtonElement);
    const el = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((e) => e.id === "ext-mat-1")!;
    expect(el.material?.materialId).toBeTruthy();
  });

  it("Reset material menghapus materialId", () => {
    render(<EntityInspector surface="3d" />);
    const section = screen.getByTestId("exterior-material-section");
    fireEvent.click(section.querySelector("button[title]") as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: /Reset material/ }));
    const el = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((e) => e.id === "ext-mat-1")!;
    expect(el.material?.materialId).toBeUndefined();
  });
});

describe("ExteriorInspector — Posisi X/Y (Bug 1: elemen tak bisa direposisi)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(layoutWithExterior(), sampleSite, []);
  });
  afterEach(cleanup);

  it("menampilkan dan mengubah Posisi X/Y elemen box (anchor x/y)", () => {
    useEditorStore.getState().select({ kind: "exterior", id: "portal-custom-glb" });
    render(<EntityInspector surface="2d" />);

    const x = screen.getByLabelText("Posisi X (m)") as HTMLInputElement;
    const y = screen.getByLabelText("Posisi Y (m)") as HTMLInputElement;
    expect(x.value).toBe("2");
    expect(y.value).toBe("1");

    // `ExteriorInspector` dulu remount (key ikut geometri) tiap kali SATU
    // field commit — komit X akan menghancurkan field Y yang sedang/baru
    // difokus (root cause bug seleksi eksterior hilang di tengah pengisian
    // field). Sekarang subtree ini stabil (`useSyncedText`, bukan remount):
    // node DOM yang sama dipakai ulang lintas commit — buktikan di sini.
    fireEvent.change(x, { target: { value: "5.5" } });
    fireEvent.blur(x);
    expect(screen.getByLabelText("Posisi Y (m)")).toBe(y);
    fireEvent.change(y, { target: { value: "7.25" } });
    fireEvent.blur(y);

    const el = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((e) => e.id === "portal-custom-glb")!;
    expect(el).toMatchObject({ x: 5.5, y: 7.25 });
  });

  it("menampilkan dan mengubah Posisi X/Y elemen segmen (start) — start & end bergeser bersama, panjang tetap", () => {
    useEditorStore.getState().select({ kind: "exterior", id: "pagar-1" });
    render(<EntityInspector surface="2d" />);

    const x = screen.getByLabelText("Posisi X (m)") as HTMLInputElement;
    const y = screen.getByLabelText("Posisi Y (m)") as HTMLInputElement;
    expect(x.value).toBe("0");
    expect(y.value).toBe("0");

    fireEvent.change(x, { target: { value: "2" } });
    fireEvent.blur(x);

    const el = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((e) => e.id === "pagar-1") as {
      start: { x: number; y: number };
      end: { x: number; y: number };
    };
    // pagar-1 dibuat start (0,0) end (3,0) — geser start.x ke 2 (+2) harus
    // ikut menggeser end.x sebesar delta yang sama (5), bukan cuma start.
    expect(el.start).toEqual({ x: 2, y: 0 });
    expect(el.end).toEqual({ x: 5, y: 0 });
  });

  it("field Posisi tidak diedit saat elemen terkunci", () => {
    useEditorStore.getState().select({ kind: "exterior", id: "portal-custom-glb" });
    useEditorStore.getState().setExteriorElementLocked("portal-custom-glb", true);
    render(<EntityInspector surface="2d" />);

    const x = screen.getByLabelText("Posisi X (m)") as HTMLInputElement;
    expect(x.disabled).toBe(true);
  });
});

describe("ExteriorInspector — BUG 1: field commit berturut-turut tak boleh menghilangkan seleksi", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(layoutWithExterior(), sampleSite, []);
    useEditorStore.getState().select({ kind: "exterior", id: "pagar-1" });
  });
  afterEach(cleanup);

  it("hanya SATU field 'Rotasi (°)' hidup utk elemen segmen (tak ada editor rotasi duplikat/ganda)", () => {
    render(<EntityInspector surface="2d" />);
    expect(screen.getAllByLabelText("Rotasi (°)")).toHaveLength(1);
  });

  it("node DOM & seleksi bertahan lintas commit Tinggi -> Panjang -> Rotasi (tak remount, tak nyasar)", () => {
    render(<EntityInspector surface="2d" />);

    const heightLabel = screen.getByText("Tinggi (m)");
    const height = heightLabel.parentElement!.querySelector("input") as HTMLInputElement;
    const length = screen.getByLabelText("Panjang (m)") as HTMLInputElement;
    const rotation = screen.getByLabelText("Rotasi (°)") as HTMLInputElement;

    // Commit Tinggi — field-field lain (belum disentuh user) HARUS tetap
    // node DOM yang sama persis sesudahnya (dulu: seluruh subtree remount,
    // menghancurkan fokus field yang sedang/baru dituju berikutnya).
    fireEvent.change(height, { target: { value: "2.6" } });
    fireEvent.blur(height);
    expect(useEditorStore.getState().selected).toEqual({ kind: "exterior", id: "pagar-1" });
    expect(screen.getByLabelText("Panjang (m)")).toBe(length);
    expect(screen.getByLabelText("Rotasi (°)")).toBe(rotation);

    // Commit Panjang
    fireEvent.change(length, { target: { value: "5" } });
    fireEvent.blur(length);
    expect(useEditorStore.getState().selected).toEqual({ kind: "exterior", id: "pagar-1" });
    expect(screen.getByLabelText("Rotasi (°)")).toBe(rotation);

    // Commit Rotasi
    fireEvent.change(rotation, { target: { value: "45" } });
    fireEvent.blur(rotation);
    expect(useEditorStore.getState().selected).toEqual({ kind: "exterior", id: "pagar-1" });

    const el = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((e) => e.id === "pagar-1")!;
    expect(el.heightM).toBe(2.6);

    // Panel yang tampil MASIH kartu elemen eksterior — bukan diam-diam
    // berpindah ke panel lain (roof/summary).
    expect(screen.getByTestId("exterior-quick-editor")).toBeTruthy();
  });
});
