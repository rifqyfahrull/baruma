import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import {
  ExteriorElementShape,
  ExteriorSelectionHandles,
} from "./exterior-canvas";
import {
  makeBoxElement,
  makeSegmentElement,
  makeStairElement,
  makeSurfaceElement,
} from "@/lib/exterior/factories";

const toX = (m: number) => m * 50;
const toY = (m: number) => m * 50;
const pxPerMeter = 50;

afterEach(cleanup);

describe("ExteriorElementShape", () => {
  it("renders a segment element as a line", () => {
    const el = makeSegmentElement(
      "boundary_wall",
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    );
    render(
      <svg>
        <ExteriorElementShape
          element={el}
          selected={false}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onPointerDown={() => {}}
        />
      </svg>,
    );

    const line = screen.getByTestId("exterior-element");
    expect(line).toBeTruthy();
    expect(line.getAttribute("data-kind")).toBe("boundary_wall");
  });

  it("BUG 2: garis hit-test tetap minimum ~8px lebar meski elemen sangat tipis (0,05 m, diagonal)", () => {
    const el = makeSegmentElement(
      "fence",
      { x: 0, y: 0 },
      { x: 4, y: 3 },
      { thicknessM: 0.05 },
    );
    render(
      <svg>
        <ExteriorElementShape
          element={el}
          selected={false}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onPointerDown={() => {}}
        />
      </svg>,
    );

    const group = screen.getByTestId("exterior-element");
    const lines = group.querySelectorAll("line");
    expect(lines).toHaveLength(2);

    // Garis visual tetap tipis, byte-identik dengan tampilan sebelumnya
    // (thicknessM 0,05 × pxPerMeter 50 = 2,5px).
    const visual = lines[0];
    expect(Number(visual.getAttribute("stroke-width"))).toBeCloseTo(2.5, 5);

    // Garis hit-test (kedua, transparan) TIDAK ikut menipis — tetap
    // menjaga lebar klik minimum, terlepas dari ketebalan asli elemen.
    const hit = screen.getByTestId("exterior-element-hit");
    expect(Number(hit.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(8);
    expect(hit.getAttribute("stroke-opacity")).toBe("0");
  });

  it("BUG 2: klik pada garis hit-test (bukan garis visual) tetap memicu onPointerDown — elemen tipis bisa dipilih ulang", () => {
    const el = makeSegmentElement(
      "fence",
      { x: 0, y: 0 },
      { x: 4, y: 3 },
      { thicknessM: 0.05 },
    );
    let clicked = false;
    render(
      <svg>
        <ExteriorElementShape
          element={el}
          selected={false}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onPointerDown={() => {
            clicked = true;
          }}
        />
      </svg>,
    );

    fireEvent.pointerDown(screen.getByTestId("exterior-element-hit"));
    expect(clicked).toBe(true);
  });

  it("renders a box element as a rect", () => {
    const el = makeBoxElement("column", 2, 2);
    render(
      <svg>
        <ExteriorElementShape
          element={el}
          selected={false}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onPointerDown={() => {}}
        />
      </svg>,
    );

    const rect = screen.getByTestId("exterior-element");
    expect(rect.tagName).toBe("rect");
    expect(rect.getAttribute("data-kind")).toBe("column");
  });

  it("renders a surface polygon as a path", () => {
    const el = makeSurfaceElement("driveway", [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
    ]);
    render(
      <svg>
        <ExteriorElementShape
          element={el}
          selected={false}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onPointerDown={() => {}}
        />
      </svg>,
    );

    const path = screen.getByTestId("exterior-element");
    expect(path.tagName).toBe("path");
    expect(path.getAttribute("data-kind")).toBe("driveway");
  });

  it("renders an exterior stair footprint", () => {
    const el = makeStairElement(1, 2, { direction: "e", lengthM: 1.8, widthM: 1.2 });
    render(
      <svg>
        <ExteriorElementShape
          element={el}
          selected={false}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onPointerDown={() => {}}
        />
      </svg>,
    );

    const group = screen.getByTestId("exterior-element");
    expect(group.getAttribute("data-kind")).toBe("exterior_stair");
    expect(group.querySelectorAll("line").length).toBeGreaterThan(1);
  });

  it("fires onPointerDown when clicked", () => {
    const el = makeBoxElement("column", 2, 2);
    let clicked = false;
    render(
      <svg>
        <ExteriorElementShape
          element={el}
          selected={false}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onPointerDown={() => {
            clicked = true;
          }}
        />
      </svg>,
    );

    fireEvent.pointerDown(screen.getByTestId("exterior-element"));
    expect(clicked).toBe(true);
  });
});

describe("ExteriorSelectionHandles", () => {
  it("renders endpoint handles for a segment", () => {
    const el = makeSegmentElement(
      "boundary_wall",
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    );
    render(
      <svg>
        <ExteriorSelectionHandles
          element={el}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onHandleDown={() => {}}
        />
      </svg>,
    );

    expect(screen.getAllByTestId("exterior-handle")).toHaveLength(2);
  });

  it("renders corner handles for a box", () => {
    const el = makeBoxElement("column", 2, 2);
    render(
      <svg>
        <ExteriorSelectionHandles
          element={el}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onHandleDown={() => {}}
        />
      </svg>,
    );

    expect(screen.getAllByTestId("exterior-handle")).toHaveLength(4);
  });

  it("renders vertex handles for a surface polygon", () => {
    const el = makeSurfaceElement("driveway", [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
    ]);
    render(
      <svg>
        <ExteriorSelectionHandles
          element={el}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onHandleDown={() => {}}
        />
      </svg>,
    );

    expect(screen.getAllByTestId("exterior-handle")).toHaveLength(3);
  });

  it("renders finite corner handles for an exterior stair", () => {
    const el = makeStairElement(1, 2, { direction: "e", lengthM: 1.8, widthM: 1.2 });
    render(
      <svg>
        <ExteriorSelectionHandles
          element={el}
          toX={toX}
          toY={toY}
          pxPerMeter={pxPerMeter}
          onHandleDown={() => {}}
        />
      </svg>,
    );

    const handles = screen.getAllByTestId("exterior-handle");
    expect(handles).toHaveLength(4);
    expect(handles.every((handle) => Number.isFinite(Number(handle.getAttribute("x"))))).toBe(true);
    expect(handles.every((handle) => Number.isFinite(Number(handle.getAttribute("y"))))).toBe(true);
  });
});
