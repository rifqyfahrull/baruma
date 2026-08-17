import { describe, expect, it } from "vitest"

import { routeAgentIntent } from "./project-agent"

const decide = (instruction: string, surface: "brief" | "editor" | "preview-3d" = "brief") =>
  routeAgentIntent({ instruction, surface, requestedMode: "auto" })

describe("routeAgentIntent", () => {
  it("honors an explicit capability", () => {
    expect(routeAgentIntent({ instruction: "buat lebih lega", surface: "brief", requestedMode: "interior" }))
      .toEqual({ kind: "route", mode: "interior", reason: "explicit" })
  })

  it("routes all established capability families", () => {
    expect(decide("tambahkan jendela di kamar utama")).toMatchObject({ mode: "floorplan" })
    expect(decide("tambahkan sofa dan meja ke interior")).toMatchObject({ mode: "interior" })
    expect(decide("apakah budget dan kebutuhan ruang ini realistis?")).toMatchObject({ mode: "brief" })
  })

  it("uses the active surface for neutral and tied instructions when no previousMode", () => {
    expect(decide("tolong bantu saya", "editor")).toMatchObject({ mode: "floorplan" })
    expect(decide("buat ruang dan interior lebih lega", "preview-3d")).toMatchObject({ mode: "interior" })
  })

  it("routes follow-up repair requests and respects previous conversation mode", () => {
    expect(routeAgentIntent({ instruction: "tolong perbaiki", surface: "preview-3d", requestedMode: "auto" }, "floorplan"))
      .toMatchObject({ mode: "floorplan" })
    expect(decide("tolong perbaiki rute ke kamar 2")).toMatchObject({ mode: "floorplan" })
  })
})
