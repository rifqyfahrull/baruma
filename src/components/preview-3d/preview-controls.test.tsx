import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useEditorStore } from "@/stores/editor-store";
import { useInteriorStore } from "@/stores/interior-store";
import { usePreviewStore } from "@/stores/preview-store";
import { makeLayout, sampleProject, sampleSite } from "@/test-utils/fixtures";
import { PreviewControlsBody } from "./preview-controls";

// Radix Popper (DropdownMenu/Dialog) butuh ResizeObserver saat kontennya
// benar-benar terbuka — tak ada di jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

function renderBody() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const layout = useEditorStore.getState().layout!;
  return render(
    <QueryClientProvider client={qc}>
      <PreviewControlsBody layout={layout} project={sampleProject} />
    </QueryClientProvider>,
  );
}

/** Buka DropdownMenu via pointerdown — Radix membuka di pointerdown, bukan click. */
function openAddMenu() {
  fireEvent.pointerDown(screen.getByTestId("preview-add-menu"), {
    button: 0,
    pointerId: 1,
  });
}

function seedTwoFloorLayoutWithRoom() {
  const base = makeLayout();
  const layout = {
    ...base,
    floors: [
      ...base.floors,
      { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.2 },
    ],
  };
  useEditorStore.getState().loadLayout(layout, sampleSite, []);
  useInteriorStore.getState().load({
    projectId: "proj-test",
    layout,
    style: "modern_tropical",
    initialRoomId: "r1",
  });
  usePreviewStore.setState({ selectedRoomId: "r1" });
  return layout;
}

describe("PreviewControlsBody — Fase 6 (+Tambah menu, section kolaps)", () => {
  beforeEach(() => {
    seedTwoFloorLayoutWithRoom();
  });
  afterEach(() => {
    cleanup();
    useEditorStore.getState().clearSelection();
    usePreviewStore.setState({ selectedRoomId: null });
  });

  it("merender EntityInspector paling atas + section kolaps Gaya Fasad/Interior Editor/Material", () => {
    renderBody();
    expect(screen.getByRole("button", { name: /Gaya Fasad/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Interior Editor/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Material$/ })).toBeTruthy();
  });

  it("tab stub 'Asisten Interior' tidak ada lagi — baris ✦ Tanya AI ada di dalam section Interior", () => {
    renderBody();
    expect(screen.queryByText("Asisten Interior")).toBeNull();
    // Section Interior kolaps default — buka dulu.
    fireEvent.click(screen.getByRole("button", { name: /Interior Editor/ }));
    expect(screen.getByRole("button", { name: /Tanya AI soal interior/ })).toBeTruthy();
  });

  it("+ Tambah: menu berisi Kolam renang, Tangga, Model 3D kustom", () => {
    renderBody();
    openAddMenu();
    expect(screen.getByTestId("pool-add")).toBeTruthy();
    expect(screen.getByTestId("stair-add")).toBeTruthy();
    expect(screen.getByTestId("room-custom-model")).toBeTruthy();
  });

  it("Tangga enabled saat ≥2 lantai; Model 3D kustom enabled saat ruang interior terpilih", () => {
    renderBody();
    openAddMenu();
    expect(screen.getByTestId("stair-add").getAttribute("data-disabled")).toBeNull();
    expect(screen.getByTestId("room-custom-model").getAttribute("data-disabled")).toBeNull();
  });

  it("klik 'Kolam renang' memanggil addPool dan memilih ruang barunya", () => {
    renderBody();
    openAddMenu();
    fireEvent.click(screen.getByTestId("pool-add"));
    const rooms = useEditorStore.getState().layout!.rooms;
    const pool = rooms.find((r) => r.type === "kolam");
    expect(pool).toBeTruthy();
    expect(usePreviewStore.getState().selectedRoomId).toBe(pool!.id);
  });

  it("klik 'Model 3D kustom' membuka modal pilihan sumber", () => {
    renderBody();
    openAddMenu();
    fireEvent.click(screen.getByTestId("room-custom-model"));
    expect(screen.getByRole("heading", { name: "Model 3D kustom" })).toBeTruthy();
    expect(screen.getByTestId("room-upload-model")).toBeTruthy();
  });
});

describe("PreviewControlsBody — Tangga disabled tanpa lantai ke-2", () => {
  beforeEach(() => {
    const layout = makeLayout();
    useEditorStore.getState().loadLayout(layout, sampleSite, []);
    useInteriorStore.getState().load({
      projectId: "proj-test",
      layout,
      style: "modern_tropical",
      initialRoomId: "r1",
    });
  });
  afterEach(() => {
    cleanup();
    useEditorStore.getState().clearSelection();
  });

  it("item Tangga disabled (data-disabled) saat cuma 1 lantai", () => {
    renderBody();
    openAddMenu();
    expect(screen.getByTestId("stair-add").getAttribute("data-disabled")).toBe("");
  });
});
