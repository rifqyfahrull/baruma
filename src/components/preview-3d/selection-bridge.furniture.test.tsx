import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import { initSelectionBridge } from "./selection-bridge";
import { useEditorStore } from "@/stores/editor-store";
import { useInteriorStore } from "@/stores/interior-store";
import { usePreviewStore } from "@/stores/preview-store";
import { generateInteriorPlan } from "@/lib/interior/plan";
import { EntityInspector } from "@/components/inspector/registry";
import { makeLayout, sampleSite } from "@/test-utils/fixtures";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EntityInspector surface="3d" />
    </QueryClientProvider>,
  );
}

function seedInterior() {
  const layout = makeLayout();
  useEditorStore.getState().loadLayout(layout, sampleSite, []);
  useInteriorStore.getState().load({ projectId: "p", layout, style: "modern_tropical", initialRoomId: "r1" });
  const plan = useInteriorStore.getState().plan!;
  const room = plan.rooms.find((r) => r.furniture.length > 0) ?? plan.rooms[0];
  return { roomId: room.roomId, item: room.furniture[0] };
}

describe("Furniture fold-in — jembatan seleksi interior↔editor + kartu registry", () => {
  let dispose: () => void;
  beforeEach(() => {
    void generateInteriorPlan;
    dispose = initSelectionBridge();
    usePreviewStore.setState({ interactionMode: "edit" });
  });
  afterEach(() => {
    dispose?.();
    cleanup();
    useEditorStore.getState().clearSelection();
    useInteriorStore.getState().selectFurniture(null);
  });

  it("selectFurniture di interior-store memunculkan editor-store.selected kind furniture", () => {
    const { roomId, item } = seedInterior();
    useInteriorStore.getState().selectFurniture(item.id);
    // Bridge sinkron sinkron (subscribe sinkron di zustand).
    expect(useEditorStore.getState().selected).toEqual({
      kind: "furniture",
      roomId,
      id: item.id,
    });
  });

  it("EntityInspector merender kartu furnitur terpadu (testid furniture-quick-editor)", () => {
    const { item } = seedInterior();
    useInteriorStore.getState().selectFurniture(item.id);
    renderCard();
    expect(screen.getByTestId("furniture-quick-editor")).toBeTruthy();
    // Aksi lama tetap (kontrak testid): tempel dinding + harga.
    expect(screen.getByTestId("furniture-snap-wall")).toBeTruthy();
    expect(screen.getByTestId("furniture-price-input")).toBeTruthy();
    expect(screen.getByTestId("slot-upload-model")).toBeTruthy();
  });

  it("tombol Hapus memanggil interior-store; seleksi editor ikut bersih via bridge", () => {
    const { roomId, item } = seedInterior();
    useInteriorStore.getState().selectFurniture(item.id);
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Hapus furniture/ }));
    const room = useInteriorStore.getState().plan!.rooms.find((r) => r.roomId === roomId)!;
    expect(room.furniture.some((f) => f.id === item.id)).toBe(false);
    expect(useEditorStore.getState().selected).toBeNull();
  });

  it("memilih entity NON-furnitur melepas seleksi furnitur interior (highlight padam)", () => {
    const { item } = seedInterior();
    useInteriorStore.getState().selectFurniture(item.id);
    useEditorStore.getState().select({ kind: "room", id: "r1" });
    expect(useInteriorStore.getState().selectedFurnitureId).toBeNull();
  });

  it("tombol X (Tutup) membersihkan seleksi", () => {
    const { item } = seedInterior();
    useInteriorStore.getState().selectFurniture(item.id);
    renderCard();
    fireEvent.click(screen.getByLabelText("Tutup editor furnitur"));
    expect(useEditorStore.getState().selected).toBeNull();
    expect(useInteriorStore.getState().selectedFurnitureId).toBeNull();
  });
});
