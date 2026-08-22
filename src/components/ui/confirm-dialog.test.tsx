import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ConfirmDialogProvider, useConfirm } from "./confirm-dialog";

afterEach(() => cleanup());

function Harness({
  onResult,
  destructive,
}: {
  onResult: (v: boolean) => void;
  destructive?: boolean;
}) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await confirm({
          title: "Hapus lantai?",
          description: "Ruang di dalamnya ikut terhapus.",
          destructive,
        });
        onResult(ok);
      }}
    >
      Trigger
    </button>
  );
}

function renderHarness(opts: { destructive?: boolean } = {}) {
  const results: boolean[] = [];
  render(
    <ConfirmDialogProvider>
      <Harness onResult={(v) => results.push(v)} destructive={opts.destructive} />
    </ConfirmDialogProvider>,
  );
  return results;
}

describe("ConfirmDialogProvider / useConfirm", () => {
  it("resolves true when the confirm action is clicked", async () => {
    const results = renderHarness();
    fireEvent.click(screen.getByText("Trigger"));

    expect(await screen.findByText("Hapus lantai?")).toBeTruthy();
    fireEvent.click(screen.getByText("Lanjutkan"));

    await waitFor(() => expect(results).toEqual([true]));
  });

  it("resolves false when Batal is clicked", async () => {
    const results = renderHarness();
    fireEvent.click(screen.getByText("Trigger"));

    await screen.findByText("Hapus lantai?");
    fireEvent.click(screen.getByText("Batal"));

    await waitFor(() => expect(results).toEqual([false]));
  });

  it("resolves false on Escape", async () => {
    const results = renderHarness();
    fireEvent.click(screen.getByText("Trigger"));

    await screen.findByText("Hapus lantai?");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(results).toEqual([false]));
  });

  it("uses custom confirm/cancel labels", async () => {
    render(
      <ConfirmDialogProvider>
        <ConfirmWithCustomLabels />
      </ConfirmDialogProvider>,
    );
    fireEvent.click(screen.getByText("Trigger"));
    expect(await screen.findByText("Ya, hapus")).toBeTruthy();
    expect(screen.getByText("Jangan")).toBeTruthy();
  });

  it("applies the destructive button variant when destructive is true", async () => {
    renderHarness({ destructive: true });
    fireEvent.click(screen.getByText("Trigger"));
    const action = await screen.findByText("Lanjutkan");
    expect(action.getAttribute("data-variant")).toBe("destructive");
  });

  it("does not apply the destructive variant by default", async () => {
    renderHarness();
    fireEvent.click(screen.getByText("Trigger"));
    const action = await screen.findByText("Lanjutkan");
    expect(action.getAttribute("data-variant")).toBe("default");
  });

  it("throws when useConfirm is used outside the provider", () => {
    function Bare() {
      useConfirm();
      return null;
    }
    // Suppress React's expected error boundary console noise for this case.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow(/ConfirmDialogProvider/);
    spy.mockRestore();
  });
});

function ConfirmWithCustomLabels() {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={() =>
        confirm({
          title: "Hapus?",
          confirmLabel: "Ya, hapus",
          cancelLabel: "Jangan",
        })
      }
    >
      Trigger
    </button>
  );
}
