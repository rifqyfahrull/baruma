import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { useUnifiedUndo } from "./use-unified-undo";
import { useEditorStore } from "@/stores/editor-store";
import { useInteriorStore } from "@/stores/interior-store";

function Probe() {
  const { undo, redo, canUndo, canRedo } = useUnifiedUndo();
  return (
    <div>
      <button onClick={undo}>undo</button>
      <button onClick={redo}>redo</button>
      <span data-testid="flags">
        {canUndo ? "u" : "-"}{canRedo ? "r" : "-"}
      </span>
    </div>
  );
}

const editorUndo = vi.fn();
const editorRedo = vi.fn();
const interiorUndo = vi.fn();
const interiorRedo = vi.fn();

function setEditor(over: { past?: unknown[]; future?: unknown[]; selected?: { kind: string } | null }) {
  useEditorStore.setState({
    past: (over.past ?? []) as never,
    future: (over.future ?? []) as never,
    selected: (over.selected ?? null) as never,
    undo: editorUndo,
    redo: editorRedo,
  });
}

function setInterior(over: {
  history?: unknown[];
  future?: unknown[];
  selectedFurnitureId?: string | null;
  selectedLightId?: string | null;
}) {
  useInteriorStore.setState({
    history: (over.history ?? []) as never,
    future: (over.future ?? []) as never,
    selectedFurnitureId: over.selectedFurnitureId ?? null,
    selectedLightId: over.selectedLightId ?? null,
    undo: interiorUndo,
    redo: interiorRedo,
  });
}

afterEach(() => {
  cleanup();
  editorUndo.mockClear();
  editorRedo.mockClear();
  interiorUndo.mockClear();
  interiorRedo.mockClear();
  setEditor({});
  setInterior({});
});

describe("useUnifiedUndo — parity with the routing heuristic in preview-controls.tsx", () => {
  it("non-interior context: routes to editor-store when it has history", () => {
    setEditor({ past: [{}] });
    setInterior({ history: [{}] });
    render(<Probe />);
    fireEvent.click(screen.getByText("undo"));
    expect(editorUndo).toHaveBeenCalledTimes(1);
    expect(interiorUndo).not.toHaveBeenCalled();
  });

  it("non-interior context: falls back to interior-store when editor-store is empty", () => {
    setEditor({ past: [] });
    setInterior({ history: [{}] });
    render(<Probe />);
    fireEvent.click(screen.getByText("undo"));
    expect(interiorUndo).toHaveBeenCalledTimes(1);
    expect(editorUndo).not.toHaveBeenCalled();
  });

  it("interior context via selected.kind=furniture: routes to interior-store when it has history", () => {
    setEditor({ past: [{}], selected: { kind: "furniture" } });
    setInterior({ history: [{}] });
    render(<Probe />);
    fireEvent.click(screen.getByText("undo"));
    expect(interiorUndo).toHaveBeenCalledTimes(1);
    expect(editorUndo).not.toHaveBeenCalled();
  });

  it("interior context via selected.kind=light: routes to interior-store", () => {
    setEditor({ selected: { kind: "light" } });
    setInterior({ history: [{}] });
    render(<Probe />);
    fireEvent.click(screen.getByText("undo"));
    expect(interiorUndo).toHaveBeenCalledTimes(1);
  });

  it("interior context via interior selectedFurnitureId (even without editor selection): routes to interior", () => {
    setEditor({ past: [{}] });
    setInterior({ history: [{}], selectedFurnitureId: "f1" });
    render(<Probe />);
    fireEvent.click(screen.getByText("undo"));
    expect(interiorUndo).toHaveBeenCalledTimes(1);
    expect(editorUndo).not.toHaveBeenCalled();
  });

  it("interior context via interior selectedLightId: routes to interior", () => {
    setInterior({ history: [{}], selectedLightId: "l1" });
    render(<Probe />);
    fireEvent.click(screen.getByText("undo"));
    expect(interiorUndo).toHaveBeenCalledTimes(1);
  });

  it("interior context but interior history is empty: falls back to editor-store", () => {
    setEditor({ past: [{}], selected: { kind: "furniture" } });
    setInterior({ history: [] });
    render(<Probe />);
    fireEvent.click(screen.getByText("undo"));
    expect(editorUndo).toHaveBeenCalledTimes(1);
    expect(interiorUndo).not.toHaveBeenCalled();
  });

  it("interior context with both stores empty: still calls interior undo (safe no-op fallback)", () => {
    setEditor({ selected: { kind: "furniture" } });
    setInterior({});
    render(<Probe />);
    fireEvent.click(screen.getByText("undo"));
    expect(interiorUndo).toHaveBeenCalledTimes(1);
    expect(editorUndo).not.toHaveBeenCalled();
  });

  it("redo mirrors the same routing using future/redo", () => {
    setEditor({ future: [{}], selected: { kind: "furniture" } });
    setInterior({ future: [] });
    render(<Probe />);
    fireEvent.click(screen.getByText("redo"));
    expect(editorRedo).toHaveBeenCalledTimes(1);
    expect(interiorRedo).not.toHaveBeenCalled();
  });

  it("canUndo is true when either store has history in interior context", () => {
    setEditor({ past: [{}], selected: { kind: "furniture" } });
    setInterior({ history: [] });
    render(<Probe />);
    expect(screen.getByTestId("flags").textContent).toBe("u-");
  });

  it("canUndo/canRedo are false when both stores are empty", () => {
    render(<Probe />);
    expect(screen.getByTestId("flags").textContent).toBe("--");
  });

  it("canUndo/canRedo are true when both stores have history", () => {
    setEditor({ past: [{}], future: [{}] });
    setInterior({ history: [{}], future: [{}] });
    render(<Probe />);
    expect(screen.getByTestId("flags").textContent).toBe("ur");
  });
});
