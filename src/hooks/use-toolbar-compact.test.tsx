import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

const narrowRef = { current: false };
const overflowRef = { current: false };

vi.mock("@/hooks/use-narrow-viewport", () => ({
  useNarrowViewport: () => narrowRef.current,
}));
vi.mock("@/hooks/use-toolbar-overflow", () => ({
  useToolbarOverflow: (
    _ref: React.RefObject<HTMLElement | null>,
    forceCompact: boolean,
  ) => {
    // Mirrors the real hook's early-return contract: skipped (false) while
    // forceCompact is already true, otherwise reports the mocked value.
    return forceCompact ? false : overflowRef.current;
  },
}));

import { useToolbarCompact } from "./use-toolbar-compact";

function Probe() {
  const ref = React.useRef<HTMLDivElement>(null);
  const compact = useToolbarCompact(ref);
  return (
    <div ref={ref} data-testid="probe">
      {compact ? "compact" : "expanded"}
    </div>
  );
}

afterEach(() => {
  cleanup();
  narrowRef.current = false;
  overflowRef.current = false;
});

describe("useToolbarCompact", () => {
  it("is expanded when neither delegate hook reports compact", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("expanded");
  });

  it("is compact when useNarrowViewport reports narrow", () => {
    narrowRef.current = true;
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("compact");
  });

  it("is compact when useToolbarOverflow reports height overflow", () => {
    overflowRef.current = true;
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("compact");
  });

  it("is compact when both delegate hooks report compact", () => {
    narrowRef.current = true;
    overflowRef.current = true;
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("compact");
  });
});
