import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  FloatingBar,
  FloatingBarSeparator,
  useFloatingBarContext,
} from "./floating-bar";

afterEach(() => cleanup());

function ContextProbe() {
  const { orientation, tooltipSide } = useFloatingBarContext();
  return <div data-testid="probe">{orientation}:{tooltipSide}</div>;
}

describe("FloatingBar", () => {
  it("defaults to vertical orientation with tooltip side right", () => {
    render(
      <FloatingBar>
        <ContextProbe />
      </FloatingBar>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("vertical:right");
  });

  it("exposes horizontal orientation with tooltip side bottom", () => {
    render(
      <FloatingBar orientation="horizontal">
        <ContextProbe />
      </FloatingBar>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("horizontal:bottom");
  });

  it("falls back to vertical/right context outside any bar", () => {
    render(<ContextProbe />);
    expect(screen.getByTestId("probe").textContent).toBe("vertical:right");
  });

  it("renders the shared surface + flex-col classes for vertical bars", () => {
    render(
      <FloatingBar data-testid="bar">
        <span>x</span>
      </FloatingBar>,
    );
    const bar = screen.getByTestId("bar");
    expect(bar.className).toContain("flex-col");
    expect(bar.className).toContain("rounded-xl");
  });

  it("renders flex-row for horizontal bars", () => {
    render(
      <FloatingBar orientation="horizontal" data-testid="bar">
        <span>x</span>
      </FloatingBar>,
    );
    expect(screen.getByTestId("bar").className).toContain("flex-row");
  });

  it("gives the separator a horizontal line for a vertical bar", () => {
    render(
      <FloatingBar>
        <FloatingBarSeparator data-testid="sep" />
      </FloatingBar>,
    );
    const sep = screen.getByTestId("sep");
    expect(sep.className).toContain("h-px");
    expect(sep.className).toContain("w-6");
  });

  it("gives the separator a vertical line for a horizontal bar", () => {
    render(
      <FloatingBar orientation="horizontal">
        <FloatingBarSeparator data-testid="sep" />
      </FloatingBar>,
    );
    const sep = screen.getByTestId("sep");
    expect(sep.className).toContain("w-px");
    expect(sep.className).toContain("h-5");
  });
});
