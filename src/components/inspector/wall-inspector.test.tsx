import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useEditorStore } from "@/stores/editor-store";
import { useAssetPickerStore } from "@/components/assets/asset-picker-host";
import { makeLayout, sampleSite } from "@/test-utils/fixtures";
import { EntityInspector } from "./registry";

describe("WallInspectorCard — inspector terpadu dinding/fasad", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, []);
    useEditorStore.getState().select({ kind: "wall", roomId: "r1", side: "n" });
    useAssetPickerStore.setState({ request: null });
  });
  afterEach(cleanup);

  it("merender kartu identik di surface 2d dan 3d; button[title] pertama = swatch (kontrak e2e)", () => {
    for (const surface of ["2d", "3d"] as const) {
      const { unmount } = render(<EntityInspector surface={surface} />);
      const root = screen.getByTestId("facade-quick-editor");
      expect(screen.getByTestId("facade-inner-section"), surface).toBeTruthy();
      expect(screen.getByTestId("facade-louver-section"), surface).toBeTruthy();
      // Kontrak preview-3d-optim.spec.ts: descendant button[title] PERTAMA
      // harus swatch cladding, bukan tombol lain.
      const firstTitled = root.querySelector("button[title]");
      expect(firstTitled?.getAttribute("aria-pressed"), surface).not.toBeNull();
      unmount();
    }
  });

  it("klik swatch menulis facade[wallId]; 'Polos' menghapusnya", () => {
    render(<EntityInspector surface="3d" />);
    const root = screen.getByTestId("facade-quick-editor");
    const swatch = root.querySelector("button[title]") as HTMLButtonElement;
    fireEvent.click(swatch);
    const layout = useEditorStore.getState().layout!;
    expect(layout.facade?.["r1:n"]).toBeTruthy();

    fireEvent.click(screen.getAllByText("Polos — ikut material ruang")[0]);
    expect(useEditorStore.getState().layout!.facade?.["r1:n"] ?? null).toBeNull();
  });

  it("tambah kisi membuat facadeElement di dinding ini; pilih model menangkap id SAAT KLIK", () => {
    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByTestId("facade-add-louver_band"));
    const fe = useEditorStore
      .getState()
      .layout!.facadeElements!.find((el) => el.wallId === "r1:n");
    expect(fe).toBeTruthy();

    fireEvent.click(screen.getByTestId("facade-pick-model"));
    expect(useAssetPickerStore.getState().request).toEqual({
      type: "facade-element",
      id: fe!.id,
    });
  });

  it("tombol tutup membersihkan seleksi", () => {
    render(<EntityInspector surface="3d" />);
    fireEvent.click(screen.getByLabelText("Tutup editor fasad"));
    expect(useEditorStore.getState().selected).toBeNull();
  });

  it("BUG 1: 'Nat beton / reveal line' — checkbox 'Tenggelam di muka dinding' tercentang setelah klik quick-add", () => {
    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByTestId("facade-add-reveal-line"));
    const fe = useEditorStore
      .getState()
      .layout!.facadeElements!.find((el) => el.wallId === "r1:n")!;
    expect(fe.pattern?.inset).toBe(true);

    // "Pola kustom" mulai TERBUKA (pattern sudah ada saat mount) — checkbox
    // langsung terlihat tanpa perlu klik trigger collapsible dulu.
    // ToggleRow dibangun di atas Radix Switch (role button), bukan
    // <input type="checkbox"> — state tercentang dibaca lewat aria-checked.
    const checkbox = screen.getByLabelText(
      "Tenggelam di muka dinding (nat beton/reveal)",
    );
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
  });

  it("BUG 2: ikon hapus kisi menghapus elemen fasad; unik per elemen saat >1 kisi di dinding yang sama", () => {
    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByTestId("facade-add-louver_band"));
    fireEvent.click(screen.getByTestId("facade-add-reveal-line"));
    const [fe1, fe2] = useEditorStore
      .getState()
      .layout!.facadeElements!.filter((el) => el.wallId === "r1:n");
    expect(fe1).toBeTruthy();
    expect(fe2).toBeTruthy();

    // data-testid per elemen (bukan aria-label bersama, ambigu saat dinding
    // punya >1 kisi — itulah akar bug: automasi/screen reader tak bisa
    // membedakan tombol hapus yang mana).
    fireEvent.click(screen.getByTestId(`facade-remove-${fe1.id}`));
    const remaining = useEditorStore
      .getState()
      .layout!.facadeElements!.filter((el) => el.wallId === "r1:n");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(fe2.id);

    fireEvent.click(screen.getByTestId(`facade-remove-${fe2.id}`));
    expect(
      useEditorStore
        .getState()
        .layout!.facadeElements?.filter((el) => el.wallId === "r1:n") ?? [],
    ).toHaveLength(0);
  });

  it("BUG 3: kartu elemen menampilkan label preset aktif, bukan selalu 'Louver (sirip vertikal)'", () => {
    render(<EntityInspector surface="2d" />);
    fireEvent.click(screen.getByTestId("facade-add-louver_band"));
    fireEvent.click(screen.getByTestId("facade-add-fluted-panel"));
    fireEvent.click(screen.getByTestId("facade-add-reveal-line"));
    const [plain, fluted, reveal] = useEditorStore
      .getState()
      .layout!.facadeElements!.filter((el) => el.wallId === "r1:n");

    expect(screen.getByTestId(`facade-element-label-${plain.id}`).textContent).toBe(
      "Louver (sirip vertikal)",
    );
    expect(screen.getByTestId(`facade-element-label-${fluted.id}`).textContent).toBe(
      "Panel sirip (fluted)",
    );
    expect(screen.getByTestId(`facade-element-label-${reveal.id}`).textContent).toBe(
      "Nat beton / reveal line",
    );
  });
});

describe("WallInspectorCard — dinding sintetis w-edge (fasad lantai)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, []);
    useEditorStore.getState().select({ kind: "wall", roomId: "edge-floor-1", side: "s" });
  });
  afterEach(cleanup);

  it("kartu: cladding + kisi/roster tampil (host resolve via edge-wall geometry); lampu & aksen 1-klik tetap disembunyikan (butuh Room nyata)", () => {
    render(<EntityInspector surface="3d" />);
    const rootEl = screen.getByTestId("facade-quick-editor");
    expect(rootEl.textContent).toContain("Fasad lantai — Lantai 1");
    expect(screen.getByTestId("facade-inner-section")).toBeTruthy();
    expect(screen.getByTestId("facade-louver-section")).toBeTruthy();
    expect(screen.getByTestId("facade-add-fluted-panel")).toBeTruthy();
    expect(screen.getByTestId("facade-add-reveal-line")).toBeTruthy();
    expect(screen.queryByText(/Tambah lampu dinding/)).toBeNull();
  });

  it("klik swatch menulis facade[edge-floor-1:s]", () => {
    render(<EntityInspector surface="2d" />);
    const rootEl = screen.getByTestId("facade-quick-editor");
    fireEvent.click(rootEl.querySelector("button[title]") as HTMLButtonElement);
    expect(useEditorStore.getState().layout!.facade?.["edge-floor-1:s"]).toBeTruthy();
  });
});

describe("WallInspectorCard — band cladding vertikal (split-facade)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, []);
    useEditorStore.getState().select({ kind: "wall", roomId: "r1", side: "s" });
  });
  afterEach(cleanup);

  it("+ Band menulis key band; kontrak swatch pertama tetap grid luar", () => {
    render(<EntityInspector surface="2d" />);
    const rootEl = screen.getByTestId("facade-quick-editor");
    // Kontrak e2e: button[title] pertama = swatch grid luar (bukan band).
    const firstTitled = rootEl.querySelector("button[title]");
    expect(firstTitled?.getAttribute("aria-pressed")).not.toBeNull();

    fireEvent.click(screen.getByTestId("facade-band-add"));
    const facade = useEditorStore.getState().layout!.facade!;
    expect(facade["r1:s@0.00-1.00"]).toBe("beton_ekspos");
  });

  it("edit rentang band me-rewrite atomik (base dipertahankan); hapus band membersihkan key", () => {
    useEditorStore.getState().setWallCladding("r1:s", "bata_ekspos");
    useEditorStore
      .getState()
      .setWallCladdingBands("r1", "s", "bata_ekspos", [
        { sillM: 0, headM: 1, claddingId: "granit_hitam" },
      ]);
    render(<EntityInspector surface="3d" />);

    const sampai = screen.getByLabelText("Sampai (m)");
    fireEvent.change(sampai, { target: { value: "1.4" } });
    fireEvent.blur(sampai);

    const facade = useEditorStore.getState().layout!.facade!;
    expect(facade["r1:s"]).toBe("bata_ekspos");
    expect(facade["r1:s@0.00-1.40"]).toBe("granit_hitam");
    expect(facade["r1:s@0.00-1.00"]).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Hapus band" }));
    const after = useEditorStore.getState().layout!.facade!;
    expect(Object.keys(after).filter((k) => k.includes("@"))).toHaveLength(0);
    expect(after["r1:s"]).toBe("bata_ekspos");
  });
});
