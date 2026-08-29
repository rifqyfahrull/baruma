// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"

import { usePreviewStore } from "@/stores/preview-store"
import { useEditorStore } from "@/stores/editor-store"
import { initSelectionBridge } from "@/components/preview-3d/selection-bridge"
import { makeLayout, sampleSite } from "@/test-utils/fixtures"

// Captured at import, before any test mutates the singleton store — these are
// the genuine creation defaults (zustand's set replaces the state object, so
// this reference keeps the original values).
const initial = usePreviewStore.getState()

describe("preview store — sun & realistic", () => {
  beforeEach(() => {
    usePreviewStore.setState({
      sunAzimuthDeg: 135,
      sunElevationDeg: 45,
      realistic: true,
    })
  })

  it("has the documented sun & realistic defaults", () => {
    expect(initial.sunAzimuthDeg).toBe(135)
    expect(initial.sunElevationDeg).toBe(45)
    expect(initial.realistic).toBe(true)
    expect(initial.renderMode).toBe("presentation")
  })

  it("setSunAzimuth updates the azimuth", () => {
    usePreviewStore.getState().setSunAzimuth(200)
    expect(usePreviewStore.getState().sunAzimuthDeg).toBe(200)
  })

  it("setSunElevation updates the elevation", () => {
    usePreviewStore.getState().setSunElevation(12)
    expect(usePreviewStore.getState().sunElevationDeg).toBe(12)
  })

  it("setRealistic sets the flag explicitly", () => {
    usePreviewStore.getState().setRealistic(false)
    expect(usePreviewStore.getState().realistic).toBe(false)
    usePreviewStore.getState().setRealistic(true)
    expect(usePreviewStore.getState().realistic).toBe(true)
  })

  it("toggleRealistic flips the flag both ways", () => {
    expect(usePreviewStore.getState().realistic).toBe(true)
    usePreviewStore.getState().toggleRealistic()
    expect(usePreviewStore.getState().realistic).toBe(false)
    usePreviewStore.getState().toggleRealistic()
    expect(usePreviewStore.getState().realistic).toBe(true)
  })
})

describe("preview store — kaca realistis (transmisi, opsional & default OFF)", () => {
  it("default OFF (fitur berat, tak boleh jadi perilaku baru semua orang)", () => {
    expect(initial.glassRealistic).toBe(false)
  })

  it("setGlassRealistic mengubah flag secara eksplisit", () => {
    usePreviewStore.getState().setGlassRealistic(true)
    expect(usePreviewStore.getState().glassRealistic).toBe(true)
    usePreviewStore.getState().setGlassRealistic(false)
    expect(usePreviewStore.getState().glassRealistic).toBe(false)
  })
})

describe("preview store — render mode presets", () => {
  beforeEach(() => {
    usePreviewStore.setState({
      renderMode: "presentation",
      realistic: true,
      nightMode: true,
      sunStudy: { enabled: true, month: 1, hour: 9 },
      sunAzimuthDeg: 270,
      sunElevationDeg: 10,
      showRoof: false,
      showLabels: false,
      showInteriorLabels: false,
      showFurniture: false,
      showVegetation: false,
      viewPreset: "front",
      viewNonce: 0,
    })
  })

  it("edit preset prioritizes responsive editing and visible labels", () => {
    usePreviewStore.getState().applyRenderModePreset("edit")
    const s = usePreviewStore.getState()
    expect(s.renderMode).toBe("edit")
    expect(s.realistic).toBe(false)
    expect(s.nightMode).toBe(false)
    expect(s.sunStudy.enabled).toBe(false)
    expect(s.sunAzimuthDeg).toBe(135)
    expect(s.sunElevationDeg).toBe(45)
    expect(s.showRoof).toBe(true)
    expect(s.showFurniture).toBe(true)
    expect(s.showVegetation).toBe(true)
    expect(s.showLabels).toBe(true)
    expect(s.showInteriorLabels).toBe(true)
    expect(s.viewPreset).toBe("front")
    expect(s.viewNonce).toBe(0)
  })

  it("presentation preset is deterministic for screenshots", () => {
    usePreviewStore.getState().applyRenderModePreset("presentation")
    const s = usePreviewStore.getState()
    expect(s.renderMode).toBe("presentation")
    expect(s.realistic).toBe(true)
    expect(s.nightMode).toBe(false)
    expect(s.sunStudy.enabled).toBe(false)
    expect(s.sunAzimuthDeg).toBe(135)
    expect(s.sunElevationDeg).toBe(45)
    expect(s.showRoof).toBe(true)
    expect(s.showFurniture).toBe(true)
    expect(s.showVegetation).toBe(true)
    expect(s.showLabels).toBe(false)
    expect(s.showInteriorLabels).toBe(false)
    expect(s.viewPreset).toBe("iso")
    expect(s.viewNonce).toBe(1)
  })
})

describe("preview store — fokus ruang & visibilitas lantai", () => {
  it("requestFocusRoom selects the room and bumps the nonce", () => {
    const before = usePreviewStore.getState().focusNonce
    usePreviewStore.getState().requestFocusRoom("room-1")
    const s = usePreviewStore.getState()
    expect(s.selectedRoomId).toBe("room-1")
    expect(s.focusRoomId).toBe("room-1")
    expect(s.focusNonce).toBe(before + 1)
  })

  it("requestInteriorView selects the room and bumps the interior nonce (Fase B — render AI interior per ruang)", () => {
    const before = usePreviewStore.getState().interiorViewNonce
    usePreviewStore.getState().requestInteriorView("room-1")
    const s = usePreviewStore.getState()
    expect(s.selectedRoomId).toBe("room-1")
    expect(s.interiorViewRoomId).toBe("room-1")
    expect(s.interiorViewNonce).toBe(before + 1)
  })

  it("setFloorVisible sets visibility per floor id explicitly", () => {
    usePreviewStore.getState().initFloors(["f1", "f2"])
    usePreviewStore.getState().setFloorVisible("f2", false)
    expect(usePreviewStore.getState().visibleFloors).toEqual({ f1: true, f2: false })
    usePreviewStore.getState().setFloorVisible("f2", true)
    expect(usePreviewStore.getState().visibleFloors.f2).toBe(true)
  })
})

describe("preview store — aiRenderPrefill (chat → dialog Render AI)", () => {
  beforeEach(() => {
    usePreviewStore.setState({ aiRenderPrefill: null })
  })

  it("defaults to null (belum ada permintaan dari chat)", () => {
    expect(usePreviewStore.getState().aiRenderPrefill).toBeNull()
  })

  it("requestAiRenderPrefill mengisi payload & memulai nonce di 1", () => {
    usePreviewStore.getState().requestAiRenderPrefill({
      target: "interior",
      roomId: "room-1",
      presetId: "tropis-siang",
      styleNotes: "suasana hangat",
    })
    const s = usePreviewStore.getState()
    expect(s.aiRenderPrefill).toEqual({
      target: "interior",
      roomId: "room-1",
      presetId: "tropis-siang",
      styleNotes: "suasana hangat",
      nonce: 1,
    })
  })

  it("bump nonce di setiap panggilan berikutnya (mirror requestInteriorView)", () => {
    usePreviewStore.getState().requestAiRenderPrefill({ target: "exterior" })
    const first = usePreviewStore.getState().aiRenderPrefill!.nonce
    usePreviewStore.getState().requestAiRenderPrefill({ target: "exterior" })
    const second = usePreviewStore.getState().aiRenderPrefill!.nonce
    expect(second).toBe(first + 1)
  })

  it("field opsional (roomId/presetId/styleNotes) boleh absen", () => {
    usePreviewStore.getState().requestAiRenderPrefill({ target: "exterior" })
    const s = usePreviewStore.getState()
    expect(s.aiRenderPrefill?.target).toBe("exterior")
    expect(s.aiRenderPrefill?.roomId).toBeUndefined()
    expect(s.aiRenderPrefill?.presetId).toBeUndefined()
    expect(s.aiRenderPrefill?.styleNotes).toBeUndefined()
  })
})

describe("preview store — captureFrame (screenshot bridge)", () => {
  it("defaults to null (canvas belum mount)", () => {
    expect(initial.captureFrame).toBeNull()
  })

  it("setCaptureFrame registers the capture function as-is (not invoked)", () => {
    let calls = 0
    const fn = () => {
      calls += 1
      return "data:image/png;base64,abc"
    }
    usePreviewStore.getState().setCaptureFrame(fn)
    expect(usePreviewStore.getState().captureFrame).toBe(fn)
    // zustand set() must store the function itself, not treat it as an updater.
    expect(calls).toBe(0)
    expect(usePreviewStore.getState().captureFrame?.()).toBe("data:image/png;base64,abc")
    expect(calls).toBe(1)
  })

  it("setCaptureFrame(null) resets on unmount", () => {
    usePreviewStore.getState().setCaptureFrame(() => "data:,")
    usePreviewStore.getState().setCaptureFrame(null)
    expect(usePreviewStore.getState().captureFrame).toBeNull()
  })
})

describe("preview store — mode malam", () => {
  it("defaults to day and toggles both ways", () => {
    usePreviewStore.setState({ nightMode: false })
    expect(initial.nightMode).toBe(false)
    usePreviewStore.getState().toggleNightMode()
    expect(usePreviewStore.getState().nightMode).toBe(true)
    usePreviewStore.getState().setNightMode(false)
    expect(usePreviewStore.getState().nightMode).toBe(false)
  })
})

describe("preview store — studi matahari", () => {
  beforeEach(() => {
    usePreviewStore.setState({
      sunStudy: { enabled: false, month: 5, hour: 12 },
      realistic: false,
      nightMode: true,
    })
  })

  it("default studi matahari mati (bulan Juni, siang)", () => {
    expect(initial.sunStudy).toEqual({ enabled: false, month: 5, hour: 12 })
  })

  it("mengaktifkan studi menyalakan realistic & mematikan malam", () => {
    usePreviewStore.getState().setSunStudyEnabled(true)
    const s = usePreviewStore.getState()
    expect(s.sunStudy.enabled).toBe(true)
    expect(s.realistic).toBe(true)
    expect(s.nightMode).toBe(false)
  })

  it("mematikan studi tidak memaksa realistic/malam", () => {
    usePreviewStore.setState({ realistic: true, nightMode: false })
    usePreviewStore.getState().setSunStudyEnabled(false)
    const s = usePreviewStore.getState()
    expect(s.sunStudy.enabled).toBe(false)
    expect(s.realistic).toBe(true) // tak diubah
  })

  it("month di-clamp 0..11, hour di-clamp 0..24", () => {
    usePreviewStore.getState().setSunStudyMonth(99)
    expect(usePreviewStore.getState().sunStudy.month).toBe(11)
    usePreviewStore.getState().setSunStudyMonth(-3)
    expect(usePreviewStore.getState().sunStudy.month).toBe(0)
    usePreviewStore.getState().setSunStudyHour(30)
    expect(usePreviewStore.getState().sunStudy.hour).toBe(24)
    usePreviewStore.getState().setSunStudyHour(7.25)
    expect(usePreviewStore.getState().sunStudy.hour).toBe(7.25)
  })
})

describe("preview store — seleksi terpadu (delegate + mirror, unifikasi P1)", () => {
  const resetSelection = () => {
    useEditorStore.getState().clearSelection()
    usePreviewStore.setState({
      selectedRoomId: null,
      selectedOpeningId: null,
      selectedWallId: null,
      roofSelected: false,
      selectedLampId: null,
      selectedRailingRoomId: null,
      selectedExteriorElementId: null,
    })
  }

  beforeEach(() => {
    useEditorStore.getState().loadLayout(makeLayout(), sampleSite, [])
    resetSelection()
  })

  it("REGRESI kartu menumpuk: pilih exterior lalu opening → hanya SATU seleksi hidup", () => {
    usePreviewStore.getState().selectExteriorElement("ext-x")
    usePreviewStore.getState().selectOpening("op-y")
    const s = usePreviewStore.getState()
    expect(s.selectedOpeningId).toBe("op-y")
    expect(s.selectedExteriorElementId).toBeNull() // dulu: keduanya hidup (exclusion asimetris)
    expect(s.selectedWallId).toBeNull()
    expect(s.roofSelected).toBe(false)
    expect(s.selectedRailingRoomId).toBeNull()
  })

  it("setter 3D menulis ke seleksi terpadu editor-store (satu sumber kebenaran)", () => {
    usePreviewStore.getState().selectWall("r1:n")
    expect(useEditorStore.getState().selected).toEqual({ kind: "wall", roomId: "r1", side: "n" })
    usePreviewStore.getState().selectRoof(true)
    expect(useEditorStore.getState().selected).toEqual({ kind: "roof" })
    expect(usePreviewStore.getState().selectedWallId).toBeNull()
    expect(usePreviewStore.getState().roofSelected).toBe(true)
  })

  it("null hanya menutup seleksi ber-kind sama (tutup kartunya sendiri)", () => {
    usePreviewStore.getState().selectOpening("op-1")
    usePreviewStore.getState().selectRoof(false) // roof tak terseleksi — jangan ganggu
    expect(useEditorStore.getState().selected).toEqual({ kind: "opening", id: "op-1" })
    usePreviewStore.getState().selectOpening(null)
    expect(useEditorStore.getState().selected).toBeNull()
  })

  it("konteks ruang bertahan saat memilih entity tanpa ruang induk (atap)", () => {
    usePreviewStore.getState().selectRoom("r1")
    usePreviewStore.getState().selectRoof(true)
    const s = usePreviewStore.getState()
    expect(s.roofSelected).toBe(true)
    expect(s.selectedRoomId).toBe("r1") // kartu ruang 3D tidak hilang
  })

  it("bridge memproyeksikan seleksi yang lahir di LUAR preview (2D/keyboard/AI)", () => {
    const unsub = initSelectionBridge()
    try {
      useEditorStore.getState().select({ kind: "room", id: "r2" })
      expect(usePreviewStore.getState().selectedRoomId).toBe("r2")
      useEditorStore.getState().clearSelection()
      expect(usePreviewStore.getState().selectedRoomId).toBeNull()
      expect(usePreviewStore.getState().roofSelected).toBe(false)
    } finally {
      unsub()
    }
  })
})
