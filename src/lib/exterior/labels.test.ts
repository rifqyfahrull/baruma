import { describe, it, expect } from "vitest";

import { facadeElementPresetLabel, FACADE_ELEMENT_KIND_LABELS } from "./labels";
import type { FacadeElement } from "@/types";

/**
 * BUG 3: ketiga preset ("Louver" bawaan, "Panel sirip (fluted)", "Nat beton
 * / reveal line") memakai `kind: "louver_band"` yang SAMA — kartu inspector
 * dulu selalu menampilkan label kind mentah ("Louver (sirip vertikal)")
 * walau elemen dipasang lewat preset lain. Fungsi ini mendeteksi preset dari
 * `pattern`, bukan dari `kind`.
 */
function makeFe(overrides: Partial<FacadeElement> = {}): FacadeElement {
  return {
    id: "fe1",
    wallId: "r1:n",
    floorId: "floor-1",
    kind: "louver_band",
    positionM: 1.5,
    widthM: 3,
    sillHeightM: 0.3,
    heightM: 2.2,
    finish: "kayu",
    ...overrides,
  };
}

describe("facadeElementPresetLabel", () => {
  it("kind bawaan tanpa pattern → label kind polos", () => {
    expect(facadeElementPresetLabel(makeFe())).toBe(FACADE_ELEMENT_KIND_LABELS.louver_band);
    expect(
      facadeElementPresetLabel(makeFe({ kind: "slat_horizontal" })),
    ).toBe(FACADE_ELEMENT_KIND_LABELS.slat_horizontal);
    expect(
      facadeElementPresetLabel(makeFe({ kind: "roster_screen" })),
    ).toBe(FACADE_ELEMENT_KIND_LABELS.roster_screen);
  });

  it("pattern.inset === true → 'Nat beton / reveal line', TERLEPAS dari orientation/pitch lain", () => {
    expect(
      facadeElementPresetLabel(
        makeFe({
          pattern: { orientation: "grid", pitchM: 0.9, barWidthM: 0.02, barDepthM: 0.012, inset: true },
        }),
      ),
    ).toBe("Nat beton / reveal line");
  });

  it("orientation v + pitch rapat (<=0.1) + sillHeightM 0 → 'Panel sirip (fluted)'", () => {
    expect(
      facadeElementPresetLabel(
        makeFe({
          sillHeightM: 0,
          pattern: { orientation: "v", pitchM: 0.07, barWidthM: 0.025, barDepthM: 0.02 },
        }),
      ),
    ).toBe("Panel sirip (fluted)");
  });

  it("orientation v tapi pitch LEBAR (bukan fluted) → fallback label kind", () => {
    expect(
      facadeElementPresetLabel(
        makeFe({
          sillHeightM: 0,
          pattern: { orientation: "v", pitchM: 0.25, barWidthM: 0.08, barDepthM: 0.15 },
        }),
      ),
    ).toBe(FACADE_ELEMENT_KIND_LABELS.louver_band);
  });

  it("orientation v + pitch rapat tapi sillHeightM > 0 (bukan penuh dinding) → fallback label kind", () => {
    expect(
      facadeElementPresetLabel(
        makeFe({
          sillHeightM: 0.3,
          pattern: { orientation: "v", pitchM: 0.07, barWidthM: 0.025, barDepthM: 0.02 },
        }),
      ),
    ).toBe(FACADE_ELEMENT_KIND_LABELS.louver_band);
  });

  it("inset menang atas fluted bila keduanya somehow terpenuhi", () => {
    expect(
      facadeElementPresetLabel(
        makeFe({
          sillHeightM: 0,
          pattern: { orientation: "v", pitchM: 0.07, barWidthM: 0.025, barDepthM: 0.02, inset: true },
        }),
      ),
    ).toBe("Nat beton / reveal line");
  });
});
