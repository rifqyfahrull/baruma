import type { Brief, DesignLayout, Project } from "@/types"

export const sampleSite = { widthM: 8, depthM: 8 }

export const sampleProject: Project = {
  id: "proj-test",
  name: "Rumah Test",
  status: "editing",
  readiness: "engineer_review_required",
  projectType: "new",
  thumbnail: "courtyard",
  site: { widthM: 8, depthM: 8, areaM2: 64 },
  floors: 2,
  rooftop: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

export const sampleBrief: Brief = {
  projectId: "proj-test",
  summary: "Rumah test untuk unit test.",
  site: { widthM: 8, depthM: 8, areaM2: 64 },
  building: {
    floors: 2,
    rooftop: true,
    budget: { minIDR: 500_000_000, maxIDR: 900_000_000 },
    finishingLevel: "menengah",
  },
  priorities: ["terasa_lega"],
  spaceProgram: [
    { id: "sp1", roomType: "ruang_tamu", name: "Ruang tamu", required: true, quantity: 1, preferredFloor: 1 },
    { id: "sp2", roomType: "kamar_tidur", name: "Kamar tidur", required: true, quantity: 2, preferredFloor: 2 },
    { id: "sp3", roomType: "kamar_mandi", name: "Kamar mandi", required: true, quantity: 1, preferredFloor: 2 },
  ],
  assumptions: [],
  constraints: [],
  risks: [],
}

/** A small, valid 1-floor / 2-room layout inside an 8×8 site. */
export function makeLayout(): DesignLayout {
  return {
    id: "layout-test",
    projectId: "proj-test",
    versionId: "v1",
    floors: [{ id: "floor-1", level: 1, name: "Lantai 1", heightM: 3.2 }],
    rooms: [
      { id: "r1", floorId: "floor-1", name: "Ruang tamu", type: "ruang_tamu", x: 0.5, y: 0.5, width: 3, depth: 3, areaM2: 9 },
      { id: "r2", floorId: "floor-1", name: "Dapur", type: "dapur", x: 4, y: 0.5, width: 3, depth: 3, areaM2: 9 },
    ],
    walls: [],
    openings: [],
    stairs: [],
    pools: [],
    validation: { passed: true, issues: [] },
  }
}
