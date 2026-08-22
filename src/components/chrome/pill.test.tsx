import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { Pill } from "./pill";

afterEach(() => cleanup());

describe("Pill", () => {
  it("sets aria-pressed=true and the exclusive active class when pressed & exclusive", () => {
    render(
      <Pill pressed exclusive label="Lantai 1" onClick={() => {}}>
        Lantai 1
      </Pill>,
    );
    const el = screen.getByRole("button", { name: "Lantai 1" });
    expect(el.getAttribute("aria-pressed")).toBe("true");
    expect(el.className).toContain("bg-primary");
    expect(el.className).toContain("text-primary-foreground");
  });

  it("sets aria-pressed=true and the soft active class when pressed & not exclusive", () => {
    render(
      <Pill pressed label="Atap" onClick={() => {}}>
        Atap
      </Pill>,
    );
    const el = screen.getByRole("button", { name: "Atap" });
    expect(el.getAttribute("aria-pressed")).toBe("true");
    expect(el.className).toContain("bg-primary/10");
  });

  it("sets aria-pressed=false when not pressed", () => {
    render(
      <Pill pressed={false} label="Lantai 2" onClick={() => {}}>
        Lantai 2
      </Pill>,
    );
    const el = screen.getByRole("button", { name: "Lantai 2" });
    expect(el.getAttribute("aria-pressed")).toBe("false");
    expect(el.className).not.toContain("bg-primary/10");
  });

  it("renders a trailing icon after the label", () => {
    render(
      <Pill pressed data-testid="floor-pill" onClick={() => {}} trailingIcon={<svg data-testid="eye-icon" />}>
        Lantai 1
      </Pill>,
    );
    const el = screen.getByTestId("floor-pill");
    expect(screen.getByTestId("eye-icon")).toBeTruthy();
    // Trailing icon comes after the label text node in DOM order.
    const html = el.innerHTML;
    expect(html.indexOf("Lantai 1")).toBeLessThan(html.indexOf('data-testid="eye-icon"'));
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(
      <Pill pressed={false} onClick={onClick} data-testid="p">
        X
      </Pill>,
    );
    fireEvent.click(screen.getByTestId("p"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
