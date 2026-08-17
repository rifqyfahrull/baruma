import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { initSelectionBridge } from "./selection-bridge";
import { useEditorStore } from "@/stores/editor-store";
import { useInteriorStore } from "@/stores/interior-store";
import { EntityInspector } from "@/components/inspector/registry";
import { makeLayout, sampleSite } from "@/test-utils/fixtures";

function seedWithLight() {
  const layout = makeLayout();
  useEditorStore.getState().loadLayout(layout, sampleSite, []);
  useInteriorStore.getState().load({ projectId: "p", layout, style: "modern_tropical", initialRoomId: "r1" });
  // Pastikan ada lampu: tambahkan bila plan awal kosong.
  const roomId = useInteriorStore.getState().plan!.rooms[0].roomId;
  if (useInteriorStore.getState().plan!.rooms[0].lighting.length === 0) {
    useInteriorStore.getState().addLight(roomId, "downlight");
  }
  const light = useInteriorStore.getState().plan!.rooms.find((r) => r.roomId === roomId)!.lighting[0];
  return { roomId, lightId: light.id };
}

describe("Light interior card — kind ke-11 registry + jembatan seleksi", () => {
  let dispose: () => void;
  beforeEach(() => {
    dispose = initSelectionBridge();
  });
  afterEach(() => {
    dispose?.();
    cleanup();
    useEditorStore.getState().clearSelection();
    useInteriorStore.getState().selectLight(null);
  });

  it("selectLight interior → editor-store.selected kind light; kartu registry tampil", () => {
    const { roomId, lightId } = seedWithLight();
    useInteriorStore.getState().selectLight(lightId);
    expect(useEditorStore.getState().selected).toEqual({ kind: "light", roomId, id: lightId });

    render(<EntityInspector surface="3d" />);
    expect(screen.getByTestId("light-quick-editor")).toBeTruthy();
    expect(screen.getByLabelText("Tipe lampu")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Temperatur warna" })).toBeTruthy();
  });

  it("ubah temperatur & jumlah menulis ke interior-store", () => {
    const { roomId, lightId } = seedWithLight();
    useInteriorStore.getState().selectLight(lightId);
    render(<EntityInspector surface="3d" />);

    fireEvent.click(screen.getByRole("button", { name: /Sejuk/ }));
    const qty = screen.getByLabelText("Jumlah lampu");
    fireEvent.change(qty, { target: { value: "3" } });

    const light = useInteriorStore.getState().plan!.rooms
      .find((r) => r.roomId === roomId)!.lighting.find((l) => l.id === lightId)!;
    expect(light.colorTemperature).toBe("cool");
    expect(light.qty).toBe(3);
  });

  it("Hapus lampu membersihkan seleksi editor via bridge", () => {
    const { roomId, lightId } = seedWithLight();
    useInteriorStore.getState().selectLight(lightId);
    render(<EntityInspector surface="3d" />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus lampu" }));
    const room = useInteriorStore.getState().plan!.rooms.find((r) => r.roomId === roomId)!;
    expect(room.lighting.some((l) => l.id === lightId)).toBe(false);
    expect(useEditorStore.getState().selected).toBeNull();
  });

  it("memilih furnitur melepas seleksi lampu (mutual-exclusive interior)", () => {
    const { lightId } = seedWithLight();
    useInteriorStore.getState().selectLight(lightId);
    const furn = useInteriorStore.getState().plan!.rooms.flatMap((r) => r.furniture)[0];
    if (furn) {
      useInteriorStore.getState().selectFurniture(furn.id);
      expect(useInteriorStore.getState().selectedLightId).toBeNull();
      expect(useEditorStore.getState().selected?.kind).toBe("furniture");
    }
  });
});
