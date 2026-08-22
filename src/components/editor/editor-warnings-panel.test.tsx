import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

import { useEditorStore } from "@/stores/editor-store";
import { useEditorPanelUiStore } from "@/stores/editor-panel-ui-store";
import { useWarningPrefs } from "@/hooks/use-warning-prefs";
import { EditorWarningsList } from "./editor-warnings-panel";
import { makeLayout, sampleSite } from "@/test-utils/fixtures";
import type { DesignLayout } from "@/types";

// Radix DropdownMenu (Popper) butuh ResizeObserver saat kontennya benar-benar
// terbuka — tak ada di jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

// `loadLayout` menjalankan ulang engine validasi (lib/validation.ts) — issue
// yang di-hardcode langsung di `validation.issues` akan DITIMPA. Untuk
// memicu issue SUNGGUHAN (paritas `warningLayout()` di plan-canvas.test.tsx):
// tandai kedua ruang `requiresVentilation` tanpa bukaan → engine menghasilkan
// issue level "warning", id deterministik `vent:${room.id}`.
function layoutWithIssues(): DesignLayout {
  const base = makeLayout();
  return {
    ...base,
    rooms: base.rooms.map((r) => ({ ...r, requiresVentilation: true })),
  };
}

const PROJECT_ID = "proj-test";

function resetLocalStorage() {
  window.localStorage.clear();
}

describe("useWarningPrefs", () => {
  beforeEach(() => {
    resetLocalStorage();
    useEditorStore.getState().loadLayout(layoutWithIssues(), sampleSite, []);
  });
  afterEach(cleanup);

  it("computes issues + unread from the live layout (semua belum dibaca awalnya)", () => {
    const { result } = renderHook(() => useWarningPrefs(PROJECT_ID));
    expect(result.current.issues).toHaveLength(2);
    expect(result.current.unread).toBe(2);
  });

  it("updateIssuePrefs menandai dibaca → unread berkurang, dan persist ke localStorage", () => {
    const { result } = renderHook(() => useWarningPrefs(PROJECT_ID));
    act(() => {
      result.current.updateIssuePrefs("vent:r1", { read: true });
    });
    expect(result.current.unread).toBe(1);
    const stored = JSON.parse(
      window.localStorage.getItem(`editor:warnings:${PROJECT_ID}`) ?? "{}"
    );
    expect(stored["vent:r1"].read).toBe(true);
  });
});

describe("EditorWarningsList", () => {
  beforeEach(() => {
    resetLocalStorage();
    useEditorStore.getState().loadLayout(layoutWithIssues(), sampleSite, []);
    useEditorPanelUiStore.getState().reset();
  });
  afterEach(cleanup);

  function Harness({ onAddToAiContext = vi.fn() }: { onAddToAiContext?: (t: string) => void }) {
    const { layout, issues, prefs, updateIssuePrefs } = useWarningPrefs(PROJECT_ID);
    return (
      <EditorWarningsList
        layout={layout}
        issues={issues}
        prefs={prefs}
        updateIssuePrefs={updateIssuePrefs}
        onAddToAiContext={onAddToAiContext}
      />
    );
  }

  it("merender total + tiap baris peringatan", () => {
    render(<Harness />);
    expect(screen.getByText("2 total")).toBeTruthy();
    expect(
      screen.getByText("Ruang tamu belum punya jendela/pintu untuk ventilasi.")
    ).toBeTruthy();
    expect(screen.getByText("Dapur belum punya jendela/pintu untuk ventilasi.")).toBeTruthy();
  });

  it("empty state saat tidak ada peringatan", () => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, []);
    render(<Harness />);
    expect(screen.getByText("Tidak ada peringatan. Layout terlihat aman.")).toBeTruthy();
  });

  it("klik pesan peringatan memilih objek (dan ganti lantai bila beda)", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByText("Ruang tamu belum punya jendela/pintu untuk ventilasi.")
    );
    expect(useEditorStore.getState().selectedObjectId).toBe("r1");
  });

  it("Take note → isi catatan → Simpan catatan menampilkan catatannya", async () => {
    render(<Harness />);
    // Radix DropdownMenuTrigger membuka menu di `pointerdown` (bukan `click`)
    // — fireEvent.click murni tak memicu Popper Content ter-mount di jsdom.
    const menus = screen.getAllByRole("button", { name: "Aksi peringatan" });
    fireEvent.pointerDown(menus[0], { button: 0, pointerId: 1 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Take note" }));
    const textarea = await screen.findByLabelText("Catatan peringatan");
    fireEvent.change(textarea, { target: { value: "Cek bersama engineer." } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan catatan" }));
    expect(await screen.findByText("Cek bersama engineer.")).toBeTruthy();
  });

  it("Show detail membuka dialog 'Detail Peringatan'", async () => {
    render(<Harness />);
    // Radix DropdownMenuTrigger membuka menu di `pointerdown` (bukan `click`)
    // — fireEvent.click murni tak memicu Popper Content ter-mount di jsdom.
    const menus = screen.getAllByRole("button", { name: "Aksi peringatan" });
    fireEvent.pointerDown(menus[0], { button: 0, pointerId: 1 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Show detail" }));
    expect(await screen.findByRole("dialog", { name: "Detail Peringatan" })).toBeTruthy();
  });

  it("Add to AI context memanggil callback dengan teks konteks", async () => {
    const onAddToAiContext = vi.fn();
    render(<Harness onAddToAiContext={onAddToAiContext} />);
    // Radix DropdownMenuTrigger membuka menu di `pointerdown` (bukan `click`)
    // — fireEvent.click murni tak memicu Popper Content ter-mount di jsdom.
    const menus = screen.getAllByRole("button", { name: "Aksi peringatan" });
    fireEvent.pointerDown(menus[0], { button: 0, pointerId: 1 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add to AI context" }));
    expect(onAddToAiContext).toHaveBeenCalledTimes(1);
    expect(onAddToAiContext.mock.calls[0][0]).toContain("Peringatan:");
  });

  it("focusWarning(objectId) di store men-scroll+highlight baris terkait", () => {
    render(<Harness />);
    act(() => {
      useEditorPanelUiStore.getState().focusWarning("r2");
    });
    const row = document.getElementById("warning-row-vent:r2");
    expect(row?.className).toContain("ring-2");
  });
});
