import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
  act,
} from "@testing-library/react";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import {
  PlanCanvas,
  moveOpeningAlongWall,
  resizeOpeningAlongWall,
} from "@/components/editor/plan-canvas";
import { useEditorStore, ROOF_LAYER_ID } from "@/stores/editor-store";
import { useEditorPanelUiStore } from "@/stores/editor-panel-ui-store";
import type { DesignLayout } from "@/types";

// Radix Tooltip (marker warning, Fase 6) butuh ResizeObserver saat kontennya
// benar-benar terbuka — tak ada di jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;
import {
  makeBoxElement,
  makeRoofZone,
  makeSegmentElement,
} from "@/lib/exterior/factories";

/** An 8×8 single-storey layout plus an (empty) rooftop floor. */
function rooftopLayout(): DesignLayout {
  return {
    id: "layout-rt",
    projectId: "proj-test",
    versionId: "v1",
    floors: [
      { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
      { id: "floor-rooftop", level: 2, name: "Rooftop", heightM: 0.3 },
    ],
    rooms: [
      {
        id: "r1",
        floorId: "floor-1",
        name: "Ruang",
        type: "ruang_tamu",
        x: 0,
        y: 0,
        width: 8,
        depth: 8,
        areaM2: 64,
      },
    ],
    walls: [],
    openings: [],
    stairs: [],
    pools: [],
    validation: { passed: true, issues: [] },
  };
}

function warningLayout(): DesignLayout {
  return {
    ...rooftopLayout(),
    rooms: [
      {
        ...rooftopLayout().rooms[0],
        requiresVentilation: true,
      },
    ],
  };
}

function openingLayout(): DesignLayout {
  return {
    ...rooftopLayout(),
    rooms: [
      {
        id: "r1",
        floorId: "floor-1",
        name: "Ruang",
        type: "ruang_tamu",
        x: 0,
        y: 0,
        width: 4,
        depth: 4,
        areaM2: 16,
      },
    ],
    openings: [
      {
        id: "op-1",
        floorId: "floor-1",
        wallId: "r1:n",
        type: "window",
        positionM: 1,
        widthM: 1,
        heightM: 1.2,
      },
    ],
  };
}

function exteriorLayout(): DesignLayout {
  return {
    ...rooftopLayout(),
    exteriorElements: [
      makeSegmentElement(
        "boundary_wall",
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { id: "ext-seg-1" },
      ),
      makeBoxElement("column", 2, 2, {
        id: "ext-box-1",
        floorId: "floor-2",
        widthM: 0.5,
        depthM: 0.5,
      }),
      makeBoxElement("planter", 3, 3, {
        id: "ext-hidden-1",
        hidden: true,
      }),
    ],
  };
}

function roofZoneLayout(): DesignLayout {
  return {
    ...rooftopLayout(),
    roofZones: [
      makeRoofZone("datar", 3, 3, {
        id: "roofz-a",
        floorId: "floor-1",
        widthM: 4,
        depthM: 4,
      }),
      makeRoofZone("limasan", 4, 3, {
        id: "roofz-b",
        floorId: "floor-1",
        widthM: 4,
        depthM: 4,
      }),
    ],
  };
}

afterEach(() => {
  cleanup();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("PlanCanvas — rooftop deck overlay", () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
  });

  it("renders the deck overlay + 4 handles on the rooftop floor when a deck rect is set", () => {
    useEditorStore
      .getState()
      .setRooftopArea({ x: 2, y: 2, width: 4, depth: 4 });
    useEditorStore.getState().setSelectedFloor("floor-rooftop");

    render(<PlanCanvas />);

    expect(screen.getByTestId("rooftop-deck-overlay")).toBeTruthy();
    expect(screen.getAllByTestId("rooftop-deck-handle")).toHaveLength(4);
  });

  it("does NOT render the overlay when the active floor is not the rooftop", () => {
    useEditorStore
      .getState()
      .setRooftopArea({ x: 2, y: 2, width: 4, depth: 4 });
    useEditorStore.getState().setSelectedFloor("floor-1");

    render(<PlanCanvas />);

    expect(screen.queryByTestId("rooftop-deck-overlay")).toBeNull();
  });

  it("does NOT render the overlay on the rooftop floor with no deck rect (full deck)", () => {
    useEditorStore.getState().setSelectedFloor("floor-rooftop");

    render(<PlanCanvas />);

    expect(screen.queryByTestId("rooftop-deck-overlay")).toBeNull();
  });

  it("deck body rect is non-interactive (pointer-events:none) so objects underneath stay clickable; the border/handles are separate interactive elements", () => {
    useEditorStore
      .getState()
      .setRooftopArea({ x: 2, y: 2, width: 4, depth: 4 });
    useEditorStore.getState().setSelectedFloor("floor-rooftop");

    render(<PlanCanvas />);

    // The filled body must not steal pointer events from rooms/openings/markers.
    const body = screen.getByTestId("rooftop-deck-overlay");
    expect(body.style.pointerEvents).toBe("none");

    // The move affordance is a SEPARATE stroke-only border element (not the body).
    const border = screen.getByTestId("rooftop-deck-border");
    expect(border).not.toBe(body);
    expect(border.style.pointerEvents).toBe("stroke");

    // Resize handles are their own interactive elements too.
    expect(screen.getAllByTestId("rooftop-deck-handle")).toHaveLength(4);
  });
});

describe("PlanCanvas — cantilever indicator (CB3)", () => {
  function twoFloorLayout(): DesignLayout {
    return {
      ...rooftopLayout(),
      floors: [
        { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
        { id: "floor-2", level: 2, name: "Lantai 2", heightM: 3.2 },
      ],
      rooms: [
        {
          id: "r1",
          floorId: "floor-1",
          name: "Ruang",
          type: "ruang_tamu",
          x: 0,
          y: 0,
          width: 8,
          depth: 8,
          areaM2: 64,
        },
        {
          id: "r2",
          floorId: "floor-2",
          name: "Ruang 2",
          type: "ruang_tamu",
          x: 0,
          y: 0,
          width: 8,
          depth: 8,
          areaM2: 64,
        },
      ],
    };
  }

  beforeEach(() => {
    useEditorStore
      .getState()
      .loadLayout(twoFloorLayout(), { widthM: 10, depthM: 10 }, []);
  });

  it("menggambar indikator saat lantai aktif ber-offset", () => {
    act(() => {
      useEditorStore.getState().setSelectedFloor("floor-2");
      useEditorStore
        .getState()
        .updateFloor("floor-2", { offsetM: { dx: 1.2, dy: 0 } });
    });
    render(<PlanCanvas />);
    expect(screen.getByTestId("cantilever-indicator")).toBeTruthy();
  });

  it("tidak menggambar indikator saat lantai aktif tanpa offset", () => {
    act(() => useEditorStore.getState().setSelectedFloor("floor-2"));
    render(<PlanCanvas />);
    expect(screen.queryByTestId("cantilever-indicator")).toBeNull();
  });
});

describe("PlanCanvas — warning marker (Fase 6: hover tooltip, click → tab Cek)", () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .loadLayout(warningLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorPanelUiStore.getState().reset();
  });

  it("hover shows only a short tooltip (no mega-dialog)", async () => {
    render(<PlanCanvas />);

    const marker = screen.getByRole("button", {
      name: /Detail peringatan untuk Ruang/,
    });
    fireEvent.focus(marker);

    const tooltip = await screen.findByText(
      "Ruang belum punya jendela/pintu untuk ventilasi.",
      { selector: "[data-slot=tooltip-content]" },
    );
    expect(tooltip).toBeTruthy();
    // Mega-dialog lama (foreignObject 300×260) sudah dihapus.
    expect(screen.queryByTestId("warning-detail-r1")).toBeNull();
  });

  it("click memilih ruang DAN memicu tab Cek (focusWarning) di panel kanan", () => {
    render(<PlanCanvas />);

    const marker = screen.getByRole("button", {
      name: /Detail peringatan untuk Ruang/,
    });
    fireEvent.click(marker);

    expect(useEditorStore.getState().selectedObjectId).toBe("r1");
    const panelUi = useEditorPanelUiStore.getState();
    expect(panelUi.sidePanel).toBe("cek");
    expect(panelUi.focusObjectId).toBe("r1");
    expect(panelUi.focusNonce).toBe(1);

    // Klik marker yang sama lagi tetap menaikkan nonce (re-scroll/highlight).
    fireEvent.click(marker);
    expect(useEditorPanelUiStore.getState().focusNonce).toBe(2);
  });
});

describe("PlanCanvas — opening resize handles", () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .loadLayout(openingLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().selectObject("op-1");
  });

  it("renders endpoint handles for the selected opening", () => {
    render(<PlanCanvas />);

    const handles = screen.getAllByTestId("opening-resize-handle");
    expect(handles).toHaveLength(2);
    expect(handles.map((h) => h.getAttribute("data-endpoint")).sort()).toEqual([
      "end",
      "start",
    ]);
  });

  it("resizes an opening by dragging its end handle", async () => {
    render(<PlanCanvas />);

    const endHandle = screen
      .getAllByTestId("opening-resize-handle")
      .find((h) => h.getAttribute("data-endpoint") === "end")!;
    const svg = endHandle.closest("svg")!;

    fireEvent.pointerDown(endHandle, {
      pointerId: 1,
      clientX: 120,
      clientY: 0,
    });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 200, clientY: 0 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 200, clientY: 0 });

    const opening = useEditorStore.getState().layout?.openings[0];
    expect(opening?.positionM).toBe(1.5);
    expect(opening?.widthM).toBe(2);
  });

  it("moves an opening along its wall by dragging the opening line", async () => {
    render(<PlanCanvas />);

    const openingLine = document.querySelector(
      "line.stroke-primary",
    ) as SVGLineElement;
    const svg = openingLine.closest("svg")!;

    fireEvent.pointerDown(openingLine, {
      pointerId: 1,
      clientX: 120,
      clientY: 0,
    });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 200, clientY: 0 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 200, clientY: 0 });

    const opening = useEditorStore.getState().layout?.openings[0];
    expect(opening?.positionM).toBe(2);
    expect(opening?.widthM).toBe(1);
  });

  it("clamps opening resize to the host wall", () => {
    const room = openingLayout().rooms[0];
    const resized = resizeOpeningAlongWall(
      room,
      "n",
      { positionM: 1, widthM: 1 },
      "start",
      -10,
    );

    expect(resized).toEqual({ positionM: 0.75, widthM: 1.5 });
  });

  it("clamps opening move to the host wall", () => {
    const room = openingLayout().rooms[0];

    expect(moveOpeningAlongWall(room, "n", { widthM: 1 }, -10)).toEqual({
      positionM: 0.5,
      widthM: 1,
    });
    expect(moveOpeningAlongWall(room, "n", { widthM: 1 }, 99)).toEqual({
      positionM: 3.5,
      widthM: 1,
    });
  });
});

describe("PlanCanvas — klik 'Tambah jendela' pada tool window (BUG C)", () => {
  /** Dinding n (1,3 m) nyaris penuh oleh 1 jendela 1,2 m — tak ada celah lagi
   *  utk jendela default (1,2 m) di posisi manapun sepanjang dinding itu. */
  function nearFullWallLayout(): DesignLayout {
    return {
      ...rooftopLayout(),
      rooms: [
        {
          id: "r1",
          floorId: "floor-1",
          name: "Ruang",
          type: "ruang_tamu",
          x: 0,
          y: 0,
          width: 1.3,
          depth: 4,
          areaM2: 5.2,
        },
      ],
      openings: [
        {
          id: "op-1",
          floorId: "floor-1",
          wallId: "r1:n",
          type: "window",
          positionM: 0.6,
          widthM: 1.2,
          heightM: 1.2,
        },
      ],
    };
  }

  function clickRoomNearNorthWall(pxPerMeter = 80) {
    const g = screen.getByText("Ruang").closest("g")!;
    fireEvent.pointerDown(g, {
      pointerId: 1,
      clientX: 0.5 * pxPerMeter,
      clientY: 0.1 * pxPerMeter, // dekat tepi utara (y=0)
    });
  }

  it("dinding sudah nyaris penuh: klik ke-2 TIDAK menambah opening & menampilkan toast error (bukan diam-diam gagal)", () => {
    useEditorStore
      .getState()
      .loadLayout(nearFullWallLayout(), { widthM: 10, depthM: 10 }, []);
    act(() => useEditorStore.getState().setTool("window"));
    render(<PlanCanvas />);

    clickRoomNearNorthWall();

    expect(useEditorStore.getState().layout!.openings).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("dinding kosong: klik menambah opening baru tanpa toast error", () => {
    useEditorStore
      .getState()
      .loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
    act(() => useEditorStore.getState().setTool("window"));
    render(<PlanCanvas />);

    clickRoomNearNorthWall();

    expect(useEditorStore.getState().layout!.openings).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("PlanCanvas — exterior elements", () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .loadLayout(exteriorLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setShowHiddenExteriorElements(false);
  });

  it("renders site-level exterior elements on every floor", () => {
    useEditorStore.getState().setSelectedFloor("floor-1");
    render(<PlanCanvas />);

    const elements = screen.getAllByTestId("exterior-element");
    expect(elements).toHaveLength(1);
    expect(elements[0].getAttribute("data-kind")).toBe("boundary_wall");
  });

  it("renders floor-owned exterior elements only on their floor", () => {
    useEditorStore.getState().setSelectedFloor("floor-2");
    render(<PlanCanvas />);

    const kinds = screen
      .getAllByTestId("exterior-element")
      .map((el) => el.getAttribute("data-kind"));
    expect(kinds).toContain("boundary_wall");
    expect(kinds).toContain("column");
    expect(kinds).not.toContain("planter");
  });

  it("selects an exterior element when clicked", () => {
    useEditorStore.getState().setSelectedFloor("floor-2");
    render(<PlanCanvas />);

    const box = screen
      .getAllByTestId("exterior-element")
      .find((el) => el.getAttribute("data-kind") === "column")!;
    fireEvent.pointerDown(box);

    expect(useEditorStore.getState().selectedObjectId).toBe("ext-box-1");
  });

  it("renders selection handles for the selected exterior element", () => {
    useEditorStore.getState().setSelectedFloor("floor-2");
    act(() => {
      useEditorStore.getState().selectObject("ext-box-1");
    });
    render(<PlanCanvas />);

    expect(screen.getAllByTestId("exterior-handle")).toHaveLength(4);
  });

  it("drags an exterior box element's body to a new position with the select tool (Bug 1)", async () => {
    useEditorStore.getState().setSelectedFloor("floor-2");
    const { container } = render(<PlanCanvas />);
    const svg = container.querySelector("svg")!;
    const box = screen
      .getAllByTestId("exterior-element")
      .find((el) => el.getAttribute("data-kind") === "column")!;

    // ext-box-1 anchor is (2,2) world m → (160,160) px at pxPerMeter=80, pan {0,0}.
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 160, clientY: 160 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 240, clientY: 200 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 240, clientY: 200 });

    const el = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((e) => e.id === "ext-box-1")!;
    expect(el).toMatchObject({ x: 3, y: 2.5 });
  });

  it("drags an exterior box element's body while the tool is still 'exterior' — post-placement state that caused Bug 1 (elements couldn't be repositioned)", async () => {
    useEditorStore.getState().setSelectedFloor("floor-2");
    // Simulates the real-world sequence: user just placed an element (tool
    // stays "exterior" for repeat placement, same as electrical/water), then
    // tries to drag the element they (or an earlier tap) already placed.
    useEditorStore.getState().setTool("exterior");
    useEditorStore.getState().setPendingPlacement({ tool: "exterior", variant: "column" });
    const { container } = render(<PlanCanvas />);
    const svg = container.querySelector("svg")!;
    const box = screen
      .getAllByTestId("exterior-element")
      .find((el) => el.getAttribute("data-kind") === "column")!;

    fireEvent.pointerDown(box, { pointerId: 1, clientX: 160, clientY: 160 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 240, clientY: 240 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 240, clientY: 240 });

    const el = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((e) => e.id === "ext-box-1")!;
    expect(el).toMatchObject({ x: 3, y: 3 });
  });

  it("drags an exterior segment's body, translating start+end together (length/rotation preserved)", async () => {
    useEditorStore.getState().setSelectedFloor("floor-1");
    const { container } = render(<PlanCanvas />);
    const svg = container.querySelector("svg")!;
    const seg = screen
      .getAllByTestId("exterior-element")
      .find((el) => el.getAttribute("data-kind") === "boundary_wall")!;

    // ext-seg-1: start (0,0) end (4,0) world m.
    fireEvent.pointerDown(seg, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 80, clientY: 40 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 80, clientY: 40 });

    const el = useEditorStore
      .getState()
      .layout!.exteriorElements!.find((e) => e.id === "ext-seg-1") as {
      start: { x: number; y: number };
      end: { x: number; y: number };
    };
    expect(el.start).toEqual({ x: 1, y: 0.5 });
    expect(el.end).toEqual({ x: 5, y: 0.5 });
  });

  it("reveals and selects hidden exterior elements when the recovery toggle is on", () => {
    useEditorStore.getState().setSelectedFloor("floor-1");
    const { rerender } = render(<PlanCanvas />);

    const initialKinds = screen
      .getAllByTestId("exterior-element")
      .map((el) => el.getAttribute("data-kind"));
    expect(initialKinds).toContain("boundary_wall");
    expect(initialKinds).not.toContain("planter");

    act(() => {
      useEditorStore.getState().setShowHiddenExteriorElements(true);
    });
    rerender(<PlanCanvas />);

    const hidden = screen
      .getAllByTestId("exterior-element")
      .find((el) => el.getAttribute("data-kind") === "planter")!;
    expect(hidden).toBeTruthy();
    fireEvent.pointerDown(hidden);
    expect(useEditorStore.getState().selectedObjectId).toBe("ext-hidden-1");
  });

  it("BUG 2: a very thin diagonal segment (0.05m) can still be re-selected and deleted via its wider hit-test line", () => {
    useEditorStore.getState().loadLayout(
      {
        ...exteriorLayout(),
        exteriorElements: [
          ...(exteriorLayout().exteriorElements ?? []),
          makeSegmentElement(
            "fence",
            { x: 6, y: 6 },
            { x: 8, y: 7.4 },
            { id: "ext-thin-1", thicknessM: 0.05 },
          ),
        ],
      },
      { widthM: 10, depthM: 10 },
      [],
    );
    useEditorStore.getState().setSelectedFloor("floor-1");
    render(<PlanCanvas />);

    // The visible line stays thin, but a separate, wider (min ~8px)
    // transparent hit-test line is what actually receives the click —
    // otherwise this element would become permanently unselectable/
    // undeletable garbage in the project.
    const hitLines = screen.getAllByTestId("exterior-element-hit");
    expect(hitLines.length).toBeGreaterThan(0);
    fireEvent.pointerDown(hitLines[hitLines.length - 1]);
    expect(useEditorStore.getState().selectedObjectId).toBe("ext-thin-1");

    useEditorStore.getState().deleteSelected();
    expect(
      useEditorStore
        .getState()
        .layout!.exteriorElements!.some((el) => el.id === "ext-thin-1"),
    ).toBe(false);
  });

  it("places additive box/frame exterior elements from the exterior tool", () => {
    useEditorStore
      .getState()
      .loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setTool("exterior");
    useEditorStore.getState().setPendingPlacement({ tool: "exterior", variant: "portal_frame" });
    const { container, unmount } = render(<PlanCanvas />);
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 180, clientY: 180 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 180, clientY: 180 });

    const portal = useEditorStore
      .getState()
      .layout?.exteriorElements?.find((element) => element.kind === "portal_frame");
    expect(portal).toBeTruthy();
    expect(useEditorStore.getState().selectedObjectId).toBe(portal?.id);

    unmount();
    useEditorStore
      .getState()
      .loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setTool("exterior");
    useEditorStore.getState().setPendingPlacement({ tool: "exterior", variant: "facade_panel" });
    const second = render(<PlanCanvas />);
    const secondSvg = second.container.querySelector("svg")!;

    fireEvent.pointerDown(secondSvg, { pointerId: 2, clientX: 220, clientY: 220 });
    fireEvent.pointerUp(secondSvg, { pointerId: 2, clientX: 220, clientY: 220 });

    const panel = useEditorStore
      .getState()
      .layout?.exteriorElements?.find((element) => element.kind === "facade_panel");
    expect(panel).toBeTruthy();
    expect(useEditorStore.getState().selectedObjectId).toBe(panel?.id);
  });

  it("places a fence with a non-zero default length on a single tap (no drag)", () => {
    useEditorStore
      .getState()
      .loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setTool("exterior");
    useEditorStore.getState().setPendingPlacement({ tool: "exterior", variant: "fence" });
    const { container } = render(<PlanCanvas />);
    const svg = container.querySelector("svg")!;

    // A tap: pointerDown then pointerUp at the SAME coordinates (no pointerMove in between).
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 100, clientY: 100 });

    const fence = useEditorStore
      .getState()
      .layout?.exteriorElements?.find((element) => element.kind === "fence");
    expect(fence).toBeTruthy();
    expect(fence).toHaveProperty("start");
    expect(fence).toHaveProperty("end");
    const segment = fence as { start: { x: number; y: number }; end: { x: number; y: number } };
    const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    expect(length).toBeCloseTo(3, 5); // fence default length
  });

  it("places a pedestrian_gate with its own (shorter) default length on tap", () => {
    useEditorStore
      .getState()
      .loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setTool("exterior");
    useEditorStore.getState().setPendingPlacement({ tool: "exterior", variant: "pedestrian_gate" });
    const { container } = render(<PlanCanvas />);
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 100, clientY: 100 });

    const gate = useEditorStore
      .getState()
      .layout?.exteriorElements?.find((element) => element.kind === "pedestrian_gate");
    expect(gate).toBeTruthy();
    const segment = gate as { start: { x: number; y: number }; end: { x: number; y: number } };
    const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    expect(length).toBeCloseTo(1.2, 5);
  });

  it("clamps the default-length endpoint to the site's east edge when tapping near it", () => {
    useEditorStore
      .getState()
      .loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setTool("exterior");
    useEditorStore.getState().setPendingPlacement({ tool: "exterior", variant: "fence" });
    const { container } = render(<PlanCanvas />);
    const svg = container.querySelector("svg")!;

    // jsdom never fits the view (getBoundingClientRect is unmocked, zero-width),
    // so this runs at the store's default zoom=1/pan={0,0}. Tap at clientX:900 →
    // wx=11.25m, already PAST the 10m site edge — this must not invert the segment.
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 900, clientY: 100 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 900, clientY: 100 });

    const fence = useEditorStore
      .getState()
      .layout?.exteriorElements?.find((element) => element.kind === "fence");
    expect(fence).toBeTruthy();
    const segment = fence as { start: { x: number }; end: { x: number } };
    // Segment must stay fully in-bounds and never invert, even when the tap
    // itself lands past the site edge.
    expect(segment.start.x).toBeGreaterThanOrEqual(0);
    expect(segment.end.x).toBeLessThanOrEqual(10 + 1e-9);
    expect(segment.end.x).toBeGreaterThanOrEqual(segment.start.x);
    // Full default length (3m) is preserved by shifting the segment left to fit.
    expect(segment.end.x - segment.start.x).toBeCloseTo(3, 5);
  });

  it("restores the default length if a jittery micro-move collapses the segment during tap", async () => {
    useEditorStore
      .getState()
      .loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setTool("exterior");
    useEditorStore.getState().setPendingPlacement({ tool: "exterior", variant: "fence" });
    const { container } = render(<PlanCanvas />);
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100 });
    // Simulate finger drift of ~1px during the tap — should NOT collapse the segment.
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 101, clientY: 100 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 101, clientY: 100 });

    const fence = useEditorStore
      .getState()
      .layout?.exteriorElements?.find((element) => element.kind === "fence");
    expect(fence).toBeTruthy();
    const segment = fence as { start: { x: number; y: number }; end: { x: number; y: number } };
    const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    expect(length).toBeCloseTo(3, 1); // fence default length, restored — not collapsed to ~0.01m of drift
  });

  it("cancels pending exterior placement with Escape", () => {
    useEditorStore
      .getState()
      .loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setTool("exterior");
    useEditorStore.getState().setPendingPlacement({ tool: "exterior", variant: "sliding_gate" });
    render(<PlanCanvas />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(useEditorStore.getState().activeTool).toBe("select");
    expect(useEditorStore.getState().pendingPlacement).toBeNull();
  });
});

describe("PlanCanvas — roof zones", () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .loadLayout(roofZoneLayout(), { widthM: 10, depthM: 10 }, []);
    // Zona atap kini hanya dirender di layer denah Atap (roof plan tersendiri).
    useEditorStore.getState().setSelectedFloor(ROOF_LAYER_ID);
  });

  it("tab lantai bersih dari zona; layer Atap merender ghost + zona (roof plan)", () => {
    useEditorStore.getState().setSelectedFloor("floor-1");
    const { unmount } = render(<PlanCanvas />);
    expect(screen.queryAllByTestId("roof-zone")).toHaveLength(0);
    expect(screen.queryByTestId("atap-ghost-layer")).toBeNull();
    unmount();

    useEditorStore.getState().setSelectedFloor(ROOF_LAYER_ID);
    render(<PlanCanvas />);
    expect(screen.getAllByTestId("roof-zone")).toHaveLength(2);
    expect(screen.getByTestId("atap-ghost-layer")).toBeTruthy();
  });

  it("notasi roof plan: pelana dapat bubungan + 2 panah air; datar polos", () => {
    useEditorStore.getState().setSelectedFloor(ROOF_LAYER_ID);
    useEditorStore.getState().updateRoofZone("roofz-b", { type: "pelana" });
    render(<PlanCanvas />);

    const zones = screen.getAllByTestId("roof-zone");
    const pelana = zones.find((z) => z.getAttribute("data-type") === "pelana")!;
    expect(pelana.querySelector('[data-testid="roof-zone-ridge"]')).toBeTruthy();
    expect(pelana.querySelectorAll('[data-testid="roof-zone-arrow"]')).toHaveLength(2);
    const datar = zones.find((z) => z.getAttribute("data-type") === "datar")!;
    expect(datar.querySelector('[data-testid="roof-zone-ridge"]')).toBeNull();
  });

  it("marker tangga monyet tampil di layer Atap dan bisa jadi target drag", () => {
    useEditorStore.getState().setRooftopArea(undefined);
    useEditorStore.getState().setRooftop(true);
    useEditorStore.getState().setRooftopAccessLadder("s", 2);
    useEditorStore.getState().setSelectedFloor(ROOF_LAYER_ID);
    render(<PlanCanvas />);
    expect(screen.getByTestId("atap-ladder-marker")).toBeTruthy();
  });

  it("skylight tampil di layer Atap saja; klik memilih ref skylight", () => {
    useEditorStore.getState().addSkylight();
    // addSkylight auto-pindah ke layer Atap — kembalikan dulu ke lantai.
    useEditorStore.getState().setSelectedFloor("floor-1");
    const { unmount } = render(<PlanCanvas />);
    expect(screen.queryAllByTestId("skylight-rect")).toHaveLength(0);
    unmount();

    useEditorStore.getState().setSelectedFloor(ROOF_LAYER_ID);
    render(<PlanCanvas />);
    const rect = screen.getByTestId("skylight-rect");
    fireEvent.pointerDown(rect);
    expect(useEditorStore.getState().selected?.kind).toBe("skylight");
  });

  it("courtyard (openToSky): rect + 4 handle tampil di layer Atap; klik memilih ruangnya", () => {
    const layout = useEditorStore.getState().layout!;
    layout.rooms.push({
      id: "taman-1",
      floorId: "floor-1",
      name: "Taman",
      type: "taman",
      x: 2,
      y: 2,
      width: 3,
      depth: 2,
      areaM2: 6,
      openToSky: true,
    });
    useEditorStore.getState().loadLayout(layout, { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setSelectedFloor(ROOF_LAYER_ID);
    render(<PlanCanvas />);

    const hole = screen.getByTestId("courtyard-hole");
    expect(screen.getAllByTestId("courtyard-hole-handle")).toHaveLength(4);
    fireEvent.pointerDown(hole.querySelector("rect")!);
    expect(useEditorStore.getState().selected).toEqual({ kind: "room", id: "taman-1" });
  });

  it("renders roof zones and marks both zones involved in an overlap issue", () => {
    render(<PlanCanvas />);

    const zones = screen.getAllByTestId("roof-zone");
    expect(zones).toHaveLength(2);
    expect(zones.map((z) => z.getAttribute("data-type")).sort()).toEqual([
      "datar",
      "limasan",
    ]);
    expect(zones.every((z) => z.getAttribute("data-has-issue") === "true")).toBe(
      true,
    );
  });

  it("renders resize handles for the selected roof zone", () => {
    act(() => {
      useEditorStore.getState().selectObject("roofz-a");
    });
    render(<PlanCanvas />);

    expect(screen.getAllByTestId("roof-zone-handle")).toHaveLength(8);
  });

  it("hides all roof zones when the global showRoofZones toggle is off", () => {
    useEditorStore.getState().setShowRoofZones(false);
    render(<PlanCanvas />);
    expect(screen.queryByTestId("roof-zone")).toBeNull();
  });

  it("hides a per-zone hidden roof zone unless reveal is on, and dims it when revealed", () => {
    useEditorStore.getState().setShowRoofZones(true); // reset dari test global-toggle
    useEditorStore.getState().setRoofZoneHidden("roofz-a", true);
    render(<PlanCanvas />);
    // roofz-a tersembunyi tidak dirender; roofz-b tetap.
    expect(screen.getAllByTestId("roof-zone")).toHaveLength(1);

    cleanup();
    useEditorStore.getState().setShowHiddenRoofZones(true);
    render(<PlanCanvas />);
    const zones = screen.getAllByTestId("roof-zone");
    expect(zones).toHaveLength(2);
    const hidden = zones.find((z) => z.getAttribute("data-hidden") === "true");
    expect(hidden).toBeTruthy();
    expect(hidden!.getAttribute("class")).toContain("opacity-30");
  });

  it("places a stair room on canvas click when tool is 'stair'", () => {
    useEditorStore.getState().loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setTool("stair");
    const { container } = render(<PlanCanvas />);
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 200, clientY: 200 });

    const rooms = useEditorStore.getState().layout!.rooms;
    const stair = rooms.find((r) => r.type === "tangga");
    expect(stair).toBeTruthy();
    expect(stair!.width).toBeGreaterThan(0);
    expect(stair!.depth).toBeGreaterThan(0);
    expect(useEditorStore.getState().selectedObjectId).toBe(stair!.id);
  });

  it("stair placement returns null (no-op) on single-floor layout", () => {
    useEditorStore.getState().loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
    // rooftopLayout has 2 floors, so this test needs a single-floor layout
    useEditorStore.setState({
      layout: {
        ...rooftopLayout(),
        floors: [{ id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 }],
      },
    });
    useEditorStore.getState().setTool("stair");
    const roomsBefore = useEditorStore.getState().layout!.rooms.length;
    const { container } = render(<PlanCanvas />);
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 200, clientY: 200 });

    expect(useEditorStore.getState().layout!.rooms.length).toBe(roomsBefore);
  });

  it("shows cross-floor stair openings when showCrossFloorRooms is true", () => {
    const layout = rooftopLayout();
    // Add a stair room to floor-1
    layout.rooms.push({
      id: "stair-cross-test",
      floorId: "floor-1",
      name: "Tangga",
      type: "tangga",
      x: 2,
      y: 2,
      width: 1.5,
      depth: 1.2,
      areaM2: 1.8,
    });
    useEditorStore.getState().loadLayout(layout, { widthM: 10, depthM: 10 }, []);
    // Set current floor to floor-rooftop, so floor-1 stairs appear as cross-floor reference
    useEditorStore.getState().setSelectedFloor("floor-rooftop");
    useEditorStore.getState().setShowCrossFloorRooms(true);
    const { container } = render(<PlanCanvas />);

    const crossFloorRects = container.querySelectorAll('[data-testid^="cross-floor-"]');
    expect(crossFloorRects.length).toBeGreaterThan(0);
  });

  it("hides cross-floor stair openings when showCrossFloorRooms is false", () => {
    const layout = rooftopLayout();
    layout.rooms.push({
      id: "stair-hidden-test",
      floorId: "floor-1",
      name: "Tangga",
      type: "tangga",
      x: 2,
      y: 2,
      width: 1.5,
      depth: 1.2,
      areaM2: 1.8,
    });
    useEditorStore.getState().loadLayout(layout, { widthM: 10, depthM: 10 }, []);
    useEditorStore.getState().setSelectedFloor("floor-rooftop");
    useEditorStore.getState().setShowCrossFloorRooms(false);
    const { container } = render(<PlanCanvas />);

    const crossFloorRects = container.querySelectorAll('[data-testid^="cross-floor-"]');
    expect(crossFloorRects.length).toBe(0);
  });
});

describe("PlanCanvas — hit-target dinding (seleksi wall 2D)", () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .loadLayout(rooftopLayout(), { widthM: 10, depthM: 10 }, []);
  });

  it("renders 4 wall hit lines per walled room on the select tool", () => {
    render(<PlanCanvas />);
    for (const side of ["n", "s", "w", "e"]) {
      expect(screen.getByTestId(`wall-hit-r1-${side}`)).toBeTruthy();
    }
  });

  it("clicking a wall hit line selects the wall EntityRef", () => {
    render(<PlanCanvas />);
    fireEvent.pointerDown(screen.getByTestId("wall-hit-r1-w"));

    const sel = useEditorStore.getState().selected;
    expect(sel).toEqual({ kind: "wall", roomId: "r1", side: "w" });
  });

  it("does NOT render wall hit lines when a placement tool is active", () => {
    act(() => {
      useEditorStore.getState().setTool("door");
    });
    render(<PlanCanvas />);
    expect(screen.queryByTestId("wall-hit-r1-n")).toBeNull();
  });

  it("open-type rooms (taman dll.) get no wall hit lines", () => {
    const layout = rooftopLayout();
    layout.rooms.push({
      id: "r-taman",
      floorId: "floor-1",
      name: "Taman",
      type: "taman",
      x: 8,
      y: 0,
      width: 2,
      depth: 2,
      areaM2: 4,
    });
    useEditorStore.getState().loadLayout(layout, { widthM: 12, depthM: 10 }, []);
    render(<PlanCanvas />);
    expect(screen.queryByTestId("wall-hit-r-taman-n")).toBeNull();
    expect(screen.getByTestId("wall-hit-r1-n")).toBeTruthy();
  });
});

describe("PlanCanvas — ghost lantai induk mezzanine (E7)", () => {
  /** Lantai 1 (induk, r1 8×8) + lantai mezzanine dengan satu ruang mezz. */
  function mezzanineLayout(): DesignLayout {
    const base = rooftopLayout();
    return {
      ...base,
      floors: [
        { id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 },
        {
          id: "floor-mezz",
          level: 1.5,
          name: "Mezzanine",
          heightM: 2.2,
          kind: "mezzanine",
          baseOffsetM: 1.6,
        },
      ],
      rooms: [
        ...base.rooms,
        {
          id: "r-mezz",
          floorId: "floor-mezz",
          name: "Mezzanine",
          type: "area_kumpul",
          x: 0,
          y: 0,
          width: 8,
          depth: 3.2,
          areaM2: 25.6,
        },
      ],
    };
  }

  beforeEach(() => {
    useEditorStore
      .getState()
      .loadLayout(mezzanineLayout(), { widthM: 10, depthM: 10 }, []);
  });

  it("mezz-ghost-layer tampil saat lantai mezzanine aktif (ghost ruang induk)", () => {
    useEditorStore.getState().setSelectedFloor("floor-mezz");
    render(<PlanCanvas />);
    const ghost = screen.getByTestId("mezz-ghost-layer");
    expect(ghost).toBeTruthy();
    // Outline ruang lantai INDUK ikut tampil sebagai referensi (nama r1).
    expect(within(ghost as HTMLElement).getByText("Ruang")).toBeTruthy();
  });

  it("tidak tampil di lantai biasa maupun layer Atap", () => {
    useEditorStore.getState().setSelectedFloor("floor-1");
    const { unmount } = render(<PlanCanvas />);
    expect(screen.queryByTestId("mezz-ghost-layer")).toBeNull();
    unmount();

    useEditorStore.getState().setSelectedFloor(ROOF_LAYER_ID);
    render(<PlanCanvas />);
    expect(screen.queryByTestId("mezz-ghost-layer")).toBeNull();
  });
});
