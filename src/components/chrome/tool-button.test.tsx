import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToolButton } from "./tool-button";
import { FloatingBar } from "./floating-bar";

// jsdom tidak mengimplementasikan ResizeObserver — Radix Popper (dipakai
// TooltipContent/PopoverContent) butuh ini saat konten benar-benar terbuka.
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

function withTooltip(children: React.ReactNode) {
  return <TooltipProvider delayDuration={0}>{children}</TooltipProvider>;
}

describe("ToolButton", () => {
  it("sets aria-label from label and renders it as the tooltip text", async () => {
    render(
      withTooltip(
        <ToolButton label="Undo" onClick={() => {}}>
          <span>icon</span>
        </ToolButton>,
      ),
    );
    const btn = screen.getByLabelText("Undo");
    expect(btn).toBeTruthy();
    fireEvent.focus(btn);
    expect(await screen.findByText("Undo", { selector: "[data-slot=tooltip-content]" })).toBeTruthy();
  });

  it("appends the shortcut suffix to the tooltip text", async () => {
    render(
      withTooltip(
        <ToolButton label="Undo" shortcut=" (Ctrl+Z)" onClick={() => {}}>
          <span>icon</span>
        </ToolButton>,
      ),
    );
    fireEvent.focus(screen.getByLabelText("Undo"));
    expect(await screen.findByText("Undo (Ctrl+Z)", { selector: "[data-slot=tooltip-content]" })).toBeTruthy();
  });

  it("leaves aria-pressed unset when pressed is not provided", () => {
    render(withTooltip(<ToolButton label="Pilih" onClick={() => {}}><span>i</span></ToolButton>));
    expect(screen.getByLabelText("Pilih").hasAttribute("aria-pressed")).toBe(false);
  });

  it("sets aria-pressed + exclusive active class when pressed & exclusive", () => {
    render(
      withTooltip(
        <ToolButton label="Pilih" pressed exclusive onClick={() => {}}>
          <span>i</span>
        </ToolButton>,
      ),
    );
    const btn = screen.getByLabelText("Pilih");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.className).toContain("bg-primary");
    expect(btn.className).toContain("text-primary-foreground");
  });

  it("sets aria-pressed + soft active class when pressed & not exclusive", () => {
    render(
      withTooltip(
        <ToolButton label="Snap" pressed onClick={() => {}}>
          <span>i</span>
        </ToolButton>,
      ),
    );
    const btn = screen.getByLabelText("Snap");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.className).toContain("bg-primary/10");
  });

  it("sets aria-pressed=false without the active class when pressed is explicitly false", () => {
    render(
      withTooltip(
        <ToolButton label="Snap" pressed={false} onClick={() => {}}>
          <span>i</span>
        </ToolButton>,
      ),
    );
    const btn = screen.getByLabelText("Snap");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.className).not.toContain("bg-primary/10");
  });

  it("uses the tooltip side from the enclosing FloatingBar orientation", async () => {
    render(
      withTooltip(
        <FloatingBar orientation="horizontal">
          <ToolButton label="Fokus" onClick={() => {}}>
            <span>i</span>
          </ToolButton>
        </FloatingBar>,
      ),
    );
    fireEvent.focus(screen.getByLabelText("Fokus"));
    const content = await screen.findByText("Fokus", { selector: "[data-slot=tooltip-content]" });
    expect(content.getAttribute("data-side")).toBe("bottom");
  });

  it("composes correctly under PopoverTrigger asChild — clicking it opens the popover", () => {
    const onClick = vi.fn();
    render(
      withTooltip(
        <Popover>
          <PopoverTrigger asChild>
            <ToolButton label="Kontrol lainnya" onClick={onClick}>
              <span>more</span>
            </ToolButton>
          </PopoverTrigger>
          <PopoverContent>
            <div data-testid="popover-body">Isi popover</div>
          </PopoverContent>
        </Popover>,
      ),
    );

    expect(screen.queryByTestId("popover-body")).toBeNull();
    fireEvent.click(screen.getByLabelText("Kontrol lainnya"));
    expect(screen.getByTestId("popover-body")).toBeTruthy();
    // The trigger keeps its own aria-label — Radix's asChild props merge does
    // not clobber the child's own props for non event-handler/style/class keys.
    expect(screen.getByLabelText("Kontrol lainnya").getAttribute("aria-expanded")).toBe("true");
  });
});
