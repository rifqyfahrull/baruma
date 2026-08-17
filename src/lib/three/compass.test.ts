import { describe, it, expect } from "vitest"

import { cameraAzimuthDeg } from "./compass"

describe("cameraAzimuthDeg", () => {
  it("kamera di selatan (+z) menghadap origin → utara lurus di depan → 0°", () => {
    expect(cameraAzimuthDeg(0, 10)).toBe(0)
  })

  it("kamera di timur (+x) → utara tampak di kanan layar → +90° (CW)", () => {
    expect(cameraAzimuthDeg(10, 0)).toBe(90)
  })

  it("kamera di barat (−x) → utara tampak di kiri layar → −90°", () => {
    expect(cameraAzimuthDeg(-10, 0)).toBe(-90)
  })

  it("pose kamera default preview (x=z>0, tenggara) → 45°", () => {
    expect(cameraAzimuthDeg(8.5, 8.5)).toBeCloseTo(45)
  })

  it("degenerate (kamera tepat di atas target) → 0, tidak NaN", () => {
    expect(cameraAzimuthDeg(0, 0)).toBe(0)
  })
})
