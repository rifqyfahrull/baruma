import { describe, expect, it } from "vitest"

import {
  cityLatitude,
  compassLabel,
  DEFAULT_LATITUDE,
  formatHour,
  solarDeclinationDeg,
  solarPosition,
  solarSceneAngles,
} from "./solar"

describe("cityLatitude", () => {
  it("mengenali kota Indonesia (cocok-sebagian, case-insensitive)", () => {
    expect(cityLatitude("Surabaya")).toBeCloseTo(-7.26, 2)
    expect(cityLatitude("Kota SIDOARJO")).toBeCloseTo(-7.45, 2)
    expect(cityLatitude("Medan, Sumut")).toBeCloseTo(3.6, 2)
  })
  it("default Jakarta-ish utk kota tak dikenal / kosong", () => {
    expect(cityLatitude("Antah Berantah")).toBe(DEFAULT_LATITUDE)
    expect(cityLatitude(undefined)).toBe(DEFAULT_LATITUDE)
    expect(cityLatitude(null)).toBe(DEFAULT_LATITUDE)
  })
})

describe("solarDeclinationDeg", () => {
  it("dekat 0 di sekitar ekuinoks (Maret/September), ekstrem di solstis", () => {
    expect(Math.abs(solarDeclinationDeg(2))).toBeLessThan(3) // Maret
    expect(Math.abs(solarDeclinationDeg(8))).toBeLessThan(5) // September
    expect(solarDeclinationDeg(5)).toBeGreaterThan(20) // Juni (utara)
    expect(solarDeclinationDeg(11)).toBeLessThan(-20) // Desember (selatan)
  })
})

describe("solarPosition — kasus fisik", () => {
  // Catatan: memakai tanggal 15; 15 Mar belum ekuinoks persis (deklinasi
  // ≈ −2.4°) sehingga ada offset fisik nyata ~2.8° dari kasus ideal.
  it("ekuator, sekitar ekuinoks (Maret), pagi 06:00 → terbit dekat TIMUR pada horizon", () => {
    const s = solarPosition(0, 2, 6)
    expect(Math.abs(s.elevationDeg)).toBeLessThan(1)
    expect(Math.abs(s.azimuthCompassDeg - 90)).toBeLessThan(5) // ~timur
  })

  it("ekuator, sekitar ekuinoks, siang 12:00 → hampir zenit", () => {
    const s = solarPosition(0, 2, 12)
    expect(s.elevationDeg).toBeGreaterThan(85)
  })

  it("lintang utara +40, sekitar ekuinoks siang → matahari di SELATAN, elevasi ~48°", () => {
    const s = solarPosition(40, 2, 12)
    expect(s.elevationDeg).toBeGreaterThan(45)
    expect(s.elevationDeg).toBeLessThan(51)
    expect(Math.abs(s.azimuthCompassDeg - 180)).toBeLessThan(5) // selatan
  })

  it("Jawa (lintang selatan), ekuinoks siang → matahari condong ke UTARA", () => {
    const s = solarPosition(-7, 2, 12)
    expect(s.azimuthCompassDeg).toBeCloseTo(0, 0) // utara (atau 360)
    expect(s.elevationDeg).toBeGreaterThan(80)
  })

  it("sore (H>0) menempatkan matahari di separuh BARAT", () => {
    const s = solarPosition(-7, 2, 15) // jam 3 sore
    expect(s.azimuthCompassDeg).toBeGreaterThan(180) // barat-an
    expect(s.azimuthCompassDeg).toBeLessThan(360)
  })
})

describe("solarSceneAngles — pemetaan azimut kompas → scene", () => {
  // Konvensi scene: 0°=+z(selatan), 90°=+x(timur), 180°=−z(utara), 270°=−x(barat).
  it("matahari di timur (kompas ~90) → azimut scene ~90 (+x timur)", () => {
    // ekuator sekitar ekuinoks pagi → kompas ~90
    const a = solarSceneAngles(0, 2, 6)
    expect(Math.abs(a.azimuthDeg - 90)).toBeLessThan(5)
  })
  it("matahari di selatan (kompas ~180) → azimut scene ~0 (+z selatan)", () => {
    const a = solarSceneAngles(40, 2, 12)
    const d = Math.min(a.azimuthDeg, 360 - a.azimuthDeg) // jarak melingkar ke 0
    expect(d).toBeLessThan(5)
  })
  it("matahari di utara (kompas 0) → azimut scene 180 (−z utara)", () => {
    const a = solarSceneAngles(-7, 2, 12)
    // kompas ~0/360 → scene 180
    expect(Math.abs(((a.azimuthDeg - 180) % 360))).toBeLessThan(1.5)
  })
})

describe("label & format", () => {
  it("compassLabel memetakan 8 arah", () => {
    expect(compassLabel(0)).toBe("Utara")
    expect(compassLabel(90)).toBe("Timur")
    expect(compassLabel(180)).toBe("Selatan")
    expect(compassLabel(270)).toBe("Barat")
    expect(compassLabel(45)).toBe("Timur Laut")
  })
  it("formatHour desimal → HH:MM", () => {
    expect(formatHour(7.5)).toBe("07:30")
    expect(formatHour(12)).toBe("12:00")
    expect(formatHour(17.25)).toBe("17:15")
  })
})
