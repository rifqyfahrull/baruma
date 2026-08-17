import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  DeleteButton,
  DirectionPicker,
  Field,
  LockToggle,
  NumField,
  SegmentedControl,
  Stat,
  ToggleRow,
} from "./fields";
import { InspectorSection } from "./section";

afterEach(cleanup);

describe("inspector kit — Field/Stat", () => {
  it("Field renders one unified label scale (11px medium)", () => {
    render(
      <Field label="Lebar" htmlFor="w">
        <input id="w" />
      </Field>,
    );
    const label = screen.getByText("Lebar");
    expect(label.className).toContain("text-[11px]");
    expect(label.className).toContain("font-medium");
  });

  it("Stat shows label + value", () => {
    render(<Stat label="Luas" value="12 m²" />);
    expect(screen.getByText("Luas")).toBeTruthy();
    expect(screen.getByText("12 m²")).toBeTruthy();
  });
});

describe("inspector kit — NumField commit contract", () => {
  it("commits on blur and Enter, not per keystroke", () => {
    const onCommit = vi.fn();
    render(<NumField label="Lebar (m)" value={2} onCommit={onCommit} />);
    const input = screen.getByLabelText("Lebar (m)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3.5" } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(3.5);
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(4);
  });

  it("reverts invalid text instead of committing NaN", () => {
    const onCommit = vi.fn();
    render(<NumField label="Lebar (m)" value={2} onCommit={onCommit} />);
    const input = screen.getByLabelText("Lebar (m)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("2");
  });

  it("resyncs the text when value changes externally (undo/AI/3D)", () => {
    const { rerender } = render(<NumField label="Lebar (m)" value={2} onCommit={() => {}} />);
    rerender(<NumField label="Lebar (m)" value={5} onCommit={() => {}} />);
    expect((screen.getByLabelText("Lebar (m)") as HTMLInputElement).value).toBe("5");
  });
});

describe("inspector kit — toggles", () => {
  it("ToggleRow flips via the switch, exposes aria-label", () => {
    const onChange = vi.fn();
    render(<ToggleRow label="Perlu ventilasi" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Perlu ventilasi"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("LockToggle is a preconfigured 'Kunci posisi' row", () => {
    render(<LockToggle checked onChange={() => {}} />);
    expect(screen.getByLabelText("Kunci posisi")).toBeTruthy();
  });
});

describe("inspector kit — SegmentedControl / DirectionPicker", () => {
  const OPTS = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
  ] as const;

  it("marks the active option aria-pressed and fires onChange", () => {
    const onChange = vi.fn();
    render(<SegmentedControl value="a" onChange={onChange} options={OPTS} ariaLabel="Pilihan" />);
    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });
    expect(alpha.getAttribute("aria-pressed")).toBe("true");
    expect(beta.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(beta);
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("DirectionPicker exposes the four compass options with arrow glyphs", () => {
    const onChange = vi.fn();
    render(<DirectionPicker value="n" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Utara ↑" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Timur →" }));
    expect(onChange).toHaveBeenCalledWith("e");
  });
});

describe("inspector kit — DeleteButton / InspectorSection", () => {
  it("DeleteButton renders the standardized label", () => {
    const onDelete = vi.fn();
    render(<DeleteButton entityLabel="bukaan" onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus bukaan" }));
    expect(onDelete).toHaveBeenCalled();
  });

  it("InspectorSection collapses and expands", () => {
    render(
      <InspectorSection title="Dimensi" defaultOpen={false}>
        <p>isi</p>
      </InspectorSection>,
    );
    expect(screen.queryByText("isi")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Dimensi/ }));
    expect(screen.getByText("isi")).toBeTruthy();
  });
});
