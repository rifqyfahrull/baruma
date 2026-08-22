import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ToolbarMore } from "./toolbar-more";
import { ToolButton } from "./tool-button";

// jsdom tidak mengimplementasikan ResizeObserver — Radix Popper (dipakai
// PopoverContent) butuh ini saat popover benar-benar terbuka.
let originalResizeObserver: typeof ResizeObserver | undefined;
beforeEach(() => {
  originalResizeObserver = window.ResizeObserver;
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  window.ResizeObserver = originalResizeObserver as typeof ResizeObserver;
  cleanup();
});

describe("ToolbarMore", () => {
  it("uses the default label 'Kontrol lainnya' when none is given", () => {
    render(
      <TooltipProvider>
        <ToolbarMore>
          <div>secondary</div>
        </ToolbarMore>
      </TooltipProvider>,
    );
    expect(screen.getByLabelText("Kontrol lainnya")).toBeTruthy();
  });

  it("exposes the testid on the trigger button", () => {
    render(
      <TooltipProvider>
        <ToolbarMore data-testid="editor-toolbar-more">
          <div>secondary</div>
        </ToolbarMore>
      </TooltipProvider>,
    );
    expect(screen.getByTestId("editor-toolbar-more")).toBeTruthy();
  });

  it("keeps children hidden until opened, then makes them reachable", () => {
    render(
      <TooltipProvider>
        <ToolbarMore label="Kontrol lainnya">
          <ToolButton label="Zoom in" onClick={() => {}}>
            <span>+</span>
          </ToolButton>
        </ToolbarMore>
      </TooltipProvider>,
    );

    expect(screen.queryByLabelText("Zoom in")).toBeNull();
    fireEvent.click(screen.getByLabelText("Kontrol lainnya"));
    expect(screen.getByLabelText("Zoom in")).toBeTruthy();
  });

  it("renders children as a plain popover (not a menu with menuitem semantics)", () => {
    render(
      <TooltipProvider>
        <ToolbarMore>
          <div data-testid="secondary-body">
            <button type="button">Aksi</button>
          </div>
        </ToolbarMore>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByLabelText("Kontrol lainnya"));
    const body = screen.getByTestId("secondary-body");
    // Popover content is NOT role="menu" — its children keep normal button
    // semantics instead of role="menuitem".
    expect(body.closest('[role="menu"]')).toBeNull();
  });
});
