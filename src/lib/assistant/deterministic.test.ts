import { describe, it, expect } from "vitest"
import { handleFloorplanInstruction } from "./deterministic"
import type { FloorplanScene } from "./actions"
import { rectsOverlap } from "@/lib/geometry"

function makeScene(): FloorplanScene {
  return {
    site: { widthM: 8, depthM: 8 },
    floors: [
      { id: "f1", name: "Lantai 1", level: 1 },
      { id: "f2", name: "Lantai 2", level: 2 },
    ],
    selectedFloorId: "f1",
    selectedRoomId: null,
    rooms: [
      { id: "r1", name: "Kamar Tidur 1", type: "kamar_tidur", floorId: "f1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
      { id: "r2", name: "Kamar Mandi 1", type: "kamar_mandi", floorId: "f1", x: 3, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
      { id: "r3", name: "Kamar Tidur 2", type: "kamar_tidur", floorId: "f2", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
      { id: "r4", name: "Kamar Mandi 2", type: "kamar_mandi", floorId: "f2", x: 3, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
    ],
    openings: [],
  }
}

describe("handleFloorplanInstruction — move room to floor (spatially verified)", () => {
  it("matches the user's exact request and places the room in verified free space (no overlap)", () => {
    const scene = makeScene()
    const result = handleFloorplanInstruction(
      "pindahkan 1 kamar mandi dari lantai 2 ke lantai 1",
      scene
    )
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions).toHaveLength(1)
    const action = result.actions[0]
    expect(action.type).toBe("updateRoom")
    if (action.type !== "updateRoom") return
    expect(action.roomId).toBe("r4")
    expect(action.patch.floorId).toBe("f1")
    expect(action.patch.x).toBeTypeOf("number")
    expect(action.patch.y).toBeTypeOf("number")

    // The actual regression this locks in: the reported bug was the moved
    // room landing exactly on top of an existing room on the destination
    // floor. Verify the resolved position clears EVERY room already there.
    const movedRect = { x: action.patch.x!, y: action.patch.y!, width: 2, depth: 2 }
    for (const other of scene.rooms.filter((r) => r.floorId === "f1")) {
      expect(rectsOverlap(movedRect, other)).toBe(false)
    }
    // And it must still be a valid, in-bounds action (server-side
    // sanitizeActions would otherwise clamp/drop it before it ever reaches
    // the client).
    expect(movedRect.x).toBeGreaterThanOrEqual(0)
    expect(movedRect.y).toBeGreaterThanOrEqual(0)
    expect(movedRect.x + 2).toBeLessThanOrEqual(scene.site.widthM)
    expect(movedRect.y + 2).toBeLessThanOrEqual(scene.site.depthM)

    expect(result.reply).toContain("Kamar Mandi 2")
    expect(result.reply).toContain("Lantai 2")
    expect(result.reply).toContain("Lantai 1")
    expect(result.reply.toLowerCase()).toContain("tidak bertumpuk")
  })

  it("matches 'pindah wc dari lantai 1 ke lantai 2' and avoids overlap on the destination floor", () => {
    const scene = makeScene()
    const result = handleFloorplanInstruction("pindah wc dari lantai 1 ke lantai 2", scene)
    expect(result.matched).toBe(true)
    if (!result.matched) return
    const action = result.actions[0]
    expect(action.type).toBe("updateRoom")
    if (action.type !== "updateRoom") return
    expect(action.roomId).toBe("r2")
    expect(action.patch.floorId).toBe("f2")

    const movedRect = { x: action.patch.x!, y: action.patch.y!, width: 2, depth: 2 }
    for (const other of scene.rooms.filter((r) => r.floorId === "f2")) {
      expect(rectsOverlap(movedRect, other)).toBe(false)
    }
  })

  it("escalates to the LLM (matched:false) instead of forcing an overlap when the destination floor is genuinely full", () => {
    const scene: FloorplanScene = {
      site: { widthM: 5, depthM: 3 },
      floors: [
        { id: "f1", name: "Lantai 1", level: 1 },
        { id: "f2", name: "Lantai 2", level: 2 },
      ],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        // f1 is a single room covering the ENTIRE floor — no space for
        // anything else without resizing/moving it, which is a design
        // trade-off the deterministic layer must not decide on its own.
        { id: "r1", name: "Ruang Keluarga", type: "ruang_keluarga", floorId: "f1", x: 0, y: 0, width: 5, depth: 3, areaM2: 15, locked: false },
        { id: "r2", name: "Kamar Mandi 2", type: "kamar_mandi", floorId: "f2", x: 0, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
      ],
      openings: [],
    }
    const result = handleFloorplanInstruction(
      "pindahkan kamar mandi dari lantai 2 ke lantai 1",
      scene
    )
    expect(result.matched).toBe(false)
  })

  it("returns a helpful reply when the source floor does not exist", () => {
    const scene = makeScene()
    const result = handleFloorplanInstruction(
      "pindah kamar mandi dari lantai 5 ke lantai 1",
      scene
    )
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions).toHaveLength(0)
    expect(result.reply).toContain("lantai 5")
  })

  it("returns a helpful reply when the requested room type is not on the source floor", () => {
    const scene = makeScene()
    const result = handleFloorplanInstruction(
      "pindah dapur dari lantai 2 ke lantai 1",
      scene
    )
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions).toHaveLength(0)
    expect(result.reply).toContain("Tidak menemukan")
    expect(result.reply).toContain("dapur")
  })

  /**
   * Dulu handler ini menuntut DUA nomor lantai disebut ("dari lantai 2 ke
   * lantai 1"), sehingga kalimat yang sebenarnya dipakai orang — "pindahkan
   * laundry ke lantai 1" — jatuh ke LLM. Padahal lantai asal bukan informasi
   * yang hilang: scene sudah tahu ruang itu ada di mana. Menuntut pengguna
   * mengulanginya adalah kegagalan yang sama dengan menagih daftar ruang yang
   * sudah ada di brief.
   */
  /**
   * Pintu sebuah ruang menyambung ke tetangganya di posisi LAMA. Begitu ruang
   * itu pindah lantai, pintu lama menggantung — ruang lahir terkurung di lantai
   * tujuan, gerbang konektivitas membuang SELURUH usulan, dan pengguna menerima
   * 0 aksi tanpa penjelasan. Cacat yang sama muncul di tiga tempat (tambah
   * ruang, pindah lantai, geser dalam lantai); `reconnectAfterMove` menyatukan
   * penanganannya.
   */
  it("menerbitkan pintu pengganti di lantai tujuan, bukan meninggalkan pintu menggantung", () => {
    const scene = makeScene()
    // Lantai 1 diisi rapat supaya petak bebas satu-satunya BERSENTUHAN dinding
    // dengan ruang yang ada — hanya di situ pintu pengganti bisa dipasang, dan
    // hanya di situ regresi "pintu menggantung" benar-benar bisa terjadi.
    scene.rooms = [
      { id: "r1", name: "Ruang Keluarga", type: "ruang_keluarga", floorId: "f1", x: 0, y: 0, width: 8, depth: 6, areaM2: 48, locked: false },
      { id: "r3", name: "Kamar Tidur 2", type: "kamar_tidur", floorId: "f2", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
      { id: "r4", name: "Kamar Mandi 2", type: "kamar_mandi", floorId: "f2", x: 3, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
    ]
    // Kamar mandi lantai 2 punya pintu ke kamar tidur di lantai itu — pintu
    // inilah yang akan menggantung setelah pindah lantai.
    scene.openings.push({
      id: "d-r3-r4", roomId: "r4", side: "w", type: "door",
      positionM: 1, widthM: 0.8, heightM: 2.1,
    } as never)

    const result = handleFloorplanInstruction(
      "pindahkan kamar mandi dari lantai 2 ke lantai 1",
      scene
    )
    expect(result.matched).toBe(true)
    if (!result.matched) return
    const doors = result.actions.filter(
      (a) => a.type === "addOpening" && a.openingType === "door"
    )
    expect(doors.length, "pindah lantai tanpa pintu pengganti").toBeGreaterThan(0)
    for (const d of doors) {
      if (d.type !== "addOpening") continue
      expect(d.roomId, "pintu pengganti harus milik ruang yang dipindah").toBe("r4")
    }
  })

  it("menyimpulkan lantai asal ketika hanya lantai tujuan yang disebut", () => {
    const scene = makeScene()
    const result = handleFloorplanInstruction(
      "pindahkan kamar mandi ke lantai 1",
      scene
    )
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions).toHaveLength(1)
    const action = result.actions[0]
    expect(action.type).toBe("updateRoom")
    if (action.type !== "updateRoom") return
    // Kamar Mandi 1 SUDAH di lantai 1 — satu-satunya kandidat yang masuk akal
    // adalah Kamar Mandi 2 di lantai 2.
    expect(action.roomId).toBe("r4")
    expect(action.patch.floorId).toBe("f1")
  })

  it("tetap menyerah ke LLM bila kandidatnya benar-benar ambigu", () => {
    const scene = makeScene()
    // Dua kamar mandi di lantai 2: "kamar mandi" mana yang dimaksud?
    scene.rooms.push({
      id: "r5", name: "Kamar Mandi 3", type: "kamar_mandi", floorId: "f2",
      x: 5, y: 0, width: 2, depth: 2, areaM2: 4, locked: false,
    })
    expect(handleFloorplanInstruction("pindahkan kamar mandi ke lantai 1", scene).matched).toBe(false)
  })

  it("tidak cocok bila tak ada ruang bertipe itu di luar lantai tujuan", () => {
    const scene = makeScene()
    // Semua kamar mandi sudah di lantai 1 — tak ada yang perlu dipindah.
    scene.rooms = scene.rooms.filter((r) => r.id !== "r4")
    expect(handleFloorplanInstruction("pindahkan kamar mandi ke lantai 1", scene).matched).toBe(false)
  })

  it("does not match non-move instructions", () => {
    const scene = makeScene()
    expect(handleFloorplanInstruction(" resizing kamar tidur", scene).matched).toBe(false)
  })
})

describe("handleFloorplanInstruction — architectural open-plan intent", () => {
  it("turns a natural language complaint about bathroom blocking kitchen-family flow into layout actions", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: "keluarga",
      rooms: [
        { id: "carport", name: "Carport", type: "carport", floorId: "f1", x: 0.28, y: 0.28, width: 2.88, depth: 3.82, areaM2: 11, locked: false },
        { id: "dapur", name: "Dapur", type: "dapur", floorId: "f1", x: 3.22, y: 0.28, width: 4.5, depth: 1.72, areaM2: 7.74, locked: false },
        { id: "km1", name: "Kamar mandi 1", type: "kamar_mandi", floorId: "f1", x: 4.57, y: 2, width: 3.15, depth: 1.32, areaM2: 4.16, locked: false },
        { id: "keluarga", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 3.22, y: 3.32, width: 4.5, depth: 4.38, areaM2: 19.71, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0.28, y: 4.14, width: 2.88, depth: 3.56, areaM2: 10.25, locked: false },
      ],
      openings: [],
    }

    const result = handleFloorplanInstruction(
      "posisi kamar mandi di lantai 1 sepertinya kurang pas, berada di tengah area yang harusnya clean (dapur & ruang keluarga), yang mana 2 ruangan ini jika disambungkan akan lebih elok",
      scene
    )

    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.reply.toLowerCase()).toContain("komposisi ruang")
    expect(result.actions).toEqual([
      { type: "updateRoom", roomId: "km1", patch: { x: 5.92, width: 1.8, depth: 2.22 } },
      { type: "updateRoom", roomId: "keluarga", patch: { width: 2.7 } },
      { type: "updateRoom", roomId: "dapur", patch: { zoneId: "zone-open-dapur-keluarga" } },
      { type: "updateRoom", roomId: "keluarga", patch: { zoneId: "zone-open-dapur-keluarga" } },
    ])
  })
})

describe("handleFloorplanInstruction — validation warning repair", () => {
  it("turns a small-room warning context into safe layout actions", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: "km1",
      rooms: [
        { id: "carport", name: "Carport", type: "carport", floorId: "f1", x: 0.28, y: 0.28, width: 2.88, depth: 3.82, areaM2: 11, locked: false },
        { id: "dapur", name: "Dapur", type: "dapur", floorId: "f1", x: 3.22, y: 0.28, width: 4.5, depth: 1.72, areaM2: 7.74, locked: false },
        { id: "km1", name: "Kamar mandi 1", type: "kamar_mandi", floorId: "f1", x: 5.92, y: 1.92, width: 1.8, depth: 1.4, areaM2: 2.52, locked: false },
        { id: "keluarga", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 3.22, y: 3.32, width: 4.5, depth: 4.38, areaM2: 19.71, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0.28, y: 4.14, width: 2.88, depth: 3.56, areaM2: 10.25, locked: false },
      ],
      openings: [],
    }

    const result = handleFloorplanInstruction(
      "Aksi yang saya inginkan: bantu perbaiki peringatan ini dengan perubahan denah yang aman. Peringatan: Kamar mandi 1 cukup kecil (2.52 m²). Tingkat: Info. Kategori: Tata ruang. Objek terkait: Kamar mandi 1 (kamar_mandi) di 1.8 x 1.4 m, posisi 5.92, 1.92.",
      scene
    )

    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.reply.toLowerCase()).toContain("perbesar")
    expect(result.actions).toEqual([
      { type: "updateRoom", roomId: "km1", patch: { x: 5.14, width: 2.86 } },
      { type: "updateRoom", roomId: "dapur", patch: { depth: 1.64 } },
    ])
  })

  it("uses the user-named sacrifice room from a follow-up context", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: "km1",
      rooms: [
        { id: "carport", name: "Carport", type: "carport", floorId: "f1", x: 0.28, y: 0.28, width: 2.88, depth: 3.82, areaM2: 11, locked: false },
        { id: "dapur", name: "Dapur", type: "dapur", floorId: "f1", x: 3.22, y: 0.28, width: 4.5, depth: 1.72, areaM2: 7.74, locked: false },
        { id: "km1", name: "Kamar mandi 1", type: "kamar_mandi", floorId: "f1", x: 5.92, y: 1.92, width: 1.8, depth: 1.4, areaM2: 2.52, locked: false },
        { id: "keluarga", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 3.22, y: 3.32, width: 4.5, depth: 4.38, areaM2: 19.71, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0.28, y: 4.14, width: 2.88, depth: 3.56, areaM2: 10.25, locked: false },
      ],
      openings: [],
    }

    const result = handleFloorplanInstruction(
      "Aksi yang saya inginkan: bantu perbaiki peringatan ini dengan perubahan denah yang aman. Peringatan: Kamar mandi 1 cukup kecil (2.52 m²). Ruang tetangga yang boleh dikorbankan/diubah: ruang keluarga.",
      scene
    )

    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions).toEqual([
      { type: "updateRoom", roomId: "km1", patch: { x: 5.14, y: 2, width: 2.86 } },
      { type: "updateRoom", roomId: "keluarga", patch: { y: 3.4, depth: 4.3 } },
    ])
  })
})

describe("handleFloorplanInstruction — add room (spatially verified)", () => {
  it("matches 'tambah kamar tidur' and places it in verified free space on the active floor", () => {
    // f1 (active) 10x8: ruang_tamu sirkulasi (0,0,10,3) — strip atas. Kamar baru
    // ditaruh SELATAN strip: menempel dinding sirkulasi (agar dapat pintu),
    // menempel tepi lahan (agar dapat cahaya/ventilasi). Tanpa tetangga
    // sirkulasi yang menempel, ruang baru mendarat di gap tanpa pintu dan
    // gerbang menolaknya — jadi setiap add-room deterministik wajib tersambung.
    const scene: FloorplanScene = {
      site: { widthM: 10, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "tamu", name: "Ruang Tamu", type: "ruang_tamu", floorId: "f1", x: 0, y: 0, width: 10, depth: 3, areaM2: 30, locked: false },
      ],
      openings: [],
    }
    const result = handleFloorplanInstruction("tambah kamar tidur", scene)
    expect(result.matched).toBe(true)
    if (!result.matched) return
    const action = result.actions[0]
    expect(action.type).toBe("addRoom")
    if (action.type !== "addRoom") return
    expect(action.roomType).toBe("kamar_tidur")
    expect(action.x).toBeTypeOf("number")
    expect(action.y).toBeTypeOf("number")
    // Ruang baru wajib membawa pintu penghubung ke dalam rumah.
    const door = result.actions.find((a) => a.type === "addOpening")
    expect(door).toBeDefined()

    // kamar_tidur defaultAreaM2=12 -> side = round(sqrt(12)*2)/2 = 3.5
    const newRect = { x: action.x!, y: action.y!, width: 3.5, depth: 3.5 }
    for (const other of scene.rooms.filter((r) => r.floorId === scene.selectedFloorId)) {
      expect(rectsOverlap(newRect, other)).toBe(false)
    }
    expect(newRect.x + 3.5).toBeLessThanOrEqual(scene.site.widthM)
    expect(newRect.y + 3.5).toBeLessThanOrEqual(scene.site.depthM)
  })

  it("escalates to the LLM (matched:false) instead of overlapping when the active floor is full", () => {
    const scene: FloorplanScene = {
      site: { widthM: 4, depthM: 4 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "r1", name: "Ruang Tamu", type: "ruang_tamu", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16, locked: false },
      ],
      openings: [],
    }
    const result = handleFloorplanInstruction("tambah kamar tidur", scene)
    expect(result.matched).toBe(false)
  })
})

describe("handleFloorplanInstruction — natural light / ventilation (exterior access)", () => {
  /** A site fully "boxed in" by a 2m-thick ring of obstacles, leaving a 6x6
   *  interior hole (x:2..8, y:2..8) that is collision-free but touches NO
   *  site boundary — exactly the case that should reject a room needing a
   *  window (`requireExterior`) while still being fair game for one that
   *  doesn't need one. */
  function boxedScene(rooms: FloorplanScene["rooms"]): FloorplanScene {
    return {
      site: { widthM: 10, depthM: 10 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "top", name: "Gudang", type: "gudang", floorId: "f1", x: 0, y: 0, width: 10, depth: 2, areaM2: 20, locked: false },
        { id: "bottom", name: "Gudang", type: "gudang", floorId: "f1", x: 0, y: 8, width: 10, depth: 2, areaM2: 20, locked: false },
        { id: "left", name: "Gudang", type: "gudang", floorId: "f1", x: 0, y: 2, width: 2, depth: 6, areaM2: 12, locked: false },
        { id: "right", name: "Gudang", type: "gudang", floorId: "f1", x: 8, y: 2, width: 2, depth: 6, areaM2: 12, locked: false },
        ...rooms,
      ],
      openings: [],
    }
  }

  it("escalates (matched:false) for a light-requiring type when only interior space remains", () => {
    const scene = boxedScene([])
    // kamar_tidur (3.5x3.5) fits comfortably in the 6x6 interior hole, but
    // that hole touches no exterior wall — must NOT be auto-placed there.
    const result = handleFloorplanInstruction("tambah kamar tidur", scene)
    expect(result.matched).toBe(false)
  })

  it("still places a type that doesn't need daylight/ventilation in that same interior hole", () => {
    const scene = boxedScene([])
    const result = handleFloorplanInstruction("tambah gudang", scene)
    expect(result.matched).toBe(true)
    if (!result.matched) return
    const action = result.actions[0]
    expect(action.type).toBe("addRoom")
    if (action.type !== "addRoom") return
    // gudang defaultAreaM2=4 -> side 2 -> must land inside the interior hole.
    expect(action.x).toBeGreaterThanOrEqual(2)
    expect(action.y).toBeGreaterThanOrEqual(2)
  })

  it("honors an explicit opt-out (requiresNaturalLight/requiresVentilation both false) even for a normally light-requiring type", () => {
    const scene: FloorplanScene = {
      site: { widthM: 10, depthM: 10 },
      floors: [
        { id: "f1", name: "Lantai 1", level: 1 },
        { id: "f2", name: "Lantai 2", level: 2 },
      ],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "top", name: "Gudang", type: "gudang", floorId: "f1", x: 0, y: 0, width: 10, depth: 2, areaM2: 20, locked: false },
        { id: "bottom", name: "Gudang", type: "gudang", floorId: "f1", x: 0, y: 8, width: 10, depth: 2, areaM2: 20, locked: false },
        { id: "left", name: "Gudang", type: "gudang", floorId: "f1", x: 0, y: 2, width: 2, depth: 6, areaM2: 12, locked: false },
        { id: "right", name: "Gudang", type: "gudang", floorId: "f1", x: 8, y: 2, width: 2, depth: 6, areaM2: 12, locked: false },
        {
          id: "moving", name: "Kamar Tidur Tanpa Jendela", type: "kamar_tidur", floorId: "f2",
          x: 0, y: 0, width: 3.5, depth: 3.5, areaM2: 12.25, locked: false,
          requiresNaturalLight: false, requiresVentilation: false,
        },
      ],
      openings: [],
    }
    const result = handleFloorplanInstruction(
      "pindahkan kamar tidur dari lantai 2 ke lantai 1",
      scene
    )
    expect(result.matched).toBe(true)
    if (!result.matched) return
    const action = result.actions[0]
    expect(action.type).toBe("updateRoom")
    if (action.type !== "updateRoom") return
    // Must land in the interior hole (nothing exterior-adjacent was required).
    expect(action.patch.x).toBeGreaterThanOrEqual(2)
    expect(action.patch.y).toBeGreaterThanOrEqual(2)
  })

  it("mentions the exterior-wall check in the reply when it applies", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [],
      openings: [],
    }
    const result = handleFloorplanInstruction("tambah kamar tidur", scene)
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.reply.toLowerCase()).toContain("cahaya")
  })
})

describe("handleFloorplanInstruction — plumbing stacking for wet rooms", () => {
  it("prefers aligning a moved bathroom with a bathroom on ANOTHER floor over the nearest free spot", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [
        { id: "f1", name: "Lantai 1", level: 1 },
        { id: "f2", name: "Lantai 2", level: 2 },
        { id: "f3", name: "Lantai 3", level: 3 },
      ],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        // Blocks (0,0) on the target floor so the "nearest free spot" the
        // general search would otherwise pick is (2,0), NOT the stacked (6,0).
        { id: "blocker", name: "Gudang", type: "gudang", floorId: "f1", x: 0, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
        { id: "moving", name: "Kamar Mandi 2", type: "kamar_mandi", floorId: "f2", x: 0, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
        // The stacking reference: an existing bathroom on a DIFFERENT floor,
        // at a spot that's free (and exterior-valid) on the target floor too.
        { id: "reference", name: "Kamar Mandi 3", type: "kamar_mandi", floorId: "f3", x: 6, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
      ],
      openings: [],
    }
    const result = handleFloorplanInstruction(
      "pindahkan kamar mandi dari lantai 2 ke lantai 1",
      scene
    )
    expect(result.matched).toBe(true)
    if (!result.matched) return
    const action = result.actions[0]
    expect(action.type).toBe("updateRoom")
    if (action.type !== "updateRoom") return
    expect(action.roomId).toBe("moving")
    // Stacked with the Lantai 3 bathroom, NOT the (2,0) an unstacked search
    // would have produced.
    expect(action.patch.x).toBe(6)
    expect(action.patch.y).toBe(0)
    expect(result.reply.toLowerCase()).toContain("sejalur pipa")
  })

  it("prefers aligning a newly added kitchen with one on another floor over the nearest free spot", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [
        { id: "f1", name: "Lantai 1", level: 1 },
        { id: "f2", name: "Lantai 2", level: 2 },
      ],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "blocker", name: "Gudang", type: "gudang", floorId: "f1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
        { id: "reference", name: "Dapur 2", type: "dapur", floorId: "f2", x: 5, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
        // ruang_tamu menempel selatan spot tumpukan (5,0) → dapur baru yang
        // ditaruh di (5,0) tetap punya tetangga sirkulasi untuk pintunya.
        { id: "tamu", name: "Ruang Tamu", type: "ruang_tamu", floorId: "f1", x: 5, y: 3, width: 3, depth: 3, areaM2: 9, locked: false },
      ],
      openings: [],
    }
    const result = handleFloorplanInstruction("tambah dapur", scene)
    expect(result.matched).toBe(true)
    if (!result.matched) return
    const action = result.actions[0]
    expect(action.type).toBe("addRoom")
    if (action.type !== "addRoom") return
    // Stacked with Lantai 2's dapur at (5,0), not the (3,0) an unstacked
    // search would produce right next to the blocker.
    expect(action.x).toBe(5)
    expect(action.y).toBe(0)
    expect(result.reply.toLowerCase()).toContain("sejalur pipa")
  })

  it("falls back to the general search when the stacked position itself collides on the target floor", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [
        { id: "f1", name: "Lantai 1", level: 1 },
        { id: "f2", name: "Lantai 2", level: 2 },
      ],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        // The target floor already has something exactly where the stacking
        // reference would want to align a new dapur — must fall back.
        { id: "occupied", name: "Gudang", type: "gudang", floorId: "f1", x: 5, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
        { id: "reference", name: "Dapur 2", type: "dapur", floorId: "f2", x: 5, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
        // ruang_tamu (sirkulasi) supaya dapur hasil fallback tetap bisa diberi
        // pintu — floor nyata selalu punya sirkulasi.
        { id: "tamu", name: "Ruang Tamu", type: "ruang_tamu", floorId: "f1", x: 0, y: 4, width: 4, depth: 4, areaM2: 16, locked: false },
      ],
      openings: [],
    }
    const result = handleFloorplanInstruction("tambah dapur", scene)
    expect(result.matched).toBe(true)
    if (!result.matched) return
    const action = result.actions[0]
    expect(action.type).toBe("addRoom")
    if (action.type !== "addRoom") return
    const newRect = { x: action.x!, y: action.y!, width: 3, depth: 3 }
    expect(rectsOverlap(newRect, { x: 5, y: 0, width: 3, depth: 3 })).toBe(false)
    expect(result.reply.toLowerCase()).not.toContain("sejalur pipa")
  })

  it("does not apply stacking preference to non-wet room types", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [
        { id: "f1", name: "Lantai 1", level: 1 },
        { id: "f2", name: "Lantai 2", level: 2 },
      ],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "reference", name: "Ruang Tamu 2", type: "ruang_tamu", floorId: "f2", x: 6, y: 6, width: 1, depth: 1, areaM2: 1, locked: false },
      ],
      openings: [],
    }
    const result = handleFloorplanInstruction("tambah ruang tamu", scene)
    expect(result.matched).toBe(true)
    if (!result.matched) return
    const action = result.actions[0]
    expect(action.type).toBe("addRoom")
    if (action.type !== "addRoom") return
    // No stacking pull toward (6,6) — lands via the plain free-space search.
    expect(result.reply.toLowerCase()).not.toContain("sejalur pipa")
  })
})

describe("handleFloorplanInstruction — avoids ground-level sanitation (septic/soakwell/control boxes)", () => {
  it("turns a soakwell warning context into a deterministic moveSanitationObject action", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "family", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 0, y: 0, width: 6, depth: 8, areaM2: 48, locked: false },
        { id: "garden", name: "Taman", type: "taman", floorId: "f1", x: 6, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
      ],
      openings: [],
      sanitation: {
        // Currently under Ruang keluarga; 1x1 footprint.
        soakwell: { id: "sw1", x: 3, y: 4, widthM: 1, lengthM: 1, depthM: 2 },
      },
    }

    const result = handleFloorplanInstruction(
      "Aksi yang saya inginkan: pindahkan sumur resapan ke taman/halaman kosong. Peringatan: Sumur resapan di bawah Ruang keluarga — resapan butuh tanah terbuka.",
      scene
    )

    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions).toEqual([
      { type: "moveSanitationObject", kind: "soakwell", x: 7, y: 1 },
    ])
    expect(result.reply.toLowerCase()).toContain("sumur resapan")
  })

  it("explains the blockage instead of falling through to the LLM when no open ground exists for the soakwell", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "family", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 0, y: 0, width: 8, depth: 8, areaM2: 64, locked: false },
      ],
      openings: [],
      sanitation: {
        soakwell: { id: "sw1", x: 6, y: 6, widthM: 1.4, lengthM: 1.4, depthM: 2 },
      },
    }

    const result = handleFloorplanInstruction(
      "Peringatan: Sumur resapan di bawah Ruang keluarga; pindahkan ke taman/halaman.",
      scene
    )

    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions).toEqual([])
    expect(result.reply.toLowerCase()).toContain("belum menemukan taman")
  })

  it("uses a near-fit unlabeled void as a service court by nudging adjacent rooms", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "carport", name: "Carport", type: "carport", floorId: "f1", x: 0.28, y: 0.28, width: 2.88, depth: 3.82, areaM2: 11, locked: false },
        { id: "dapur", name: "Dapur", type: "dapur", floorId: "f1", x: 3.22, y: 0.28, width: 4.5, depth: 1.72, areaM2: 7.74, locked: false },
        { id: "km1", name: "Kamar mandi 1", type: "kamar_mandi", floorId: "f1", x: 4.57, y: 2, width: 3.15, depth: 1.32, areaM2: 4.16, locked: false },
        { id: "keluarga", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 3.22, y: 3.32, width: 4.5, depth: 4.38, areaM2: 19.71, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0.28, y: 4.14, width: 2.88, depth: 3.56, areaM2: 10.25, locked: false },
      ],
      openings: [],
      sanitation: {
        septicTank: { id: "st", x: 0.79, y: 3.18, widthM: 0.85, lengthM: 1.7, depthM: 1.8 },
        soakwell: { id: "sw1", x: 6, y: 6.8, widthM: 1.4, lengthM: 1.4, depthM: 2 },
        controlBoxes: [
          { id: "bk1", x: 0.56, y: 2.09, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
          { id: "bk2", x: 1.47, y: 3.84, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
          { id: "bk3", x: 4, y: 7.4, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
          { id: "bk4", x: 5.33, y: 7.4, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
          { id: "bk5", x: 6.67, y: 7.4, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
        ],
      },
    }

    const result = handleFloorplanInstruction(
      "Aksi yang saya inginkan: pindahkan sumur resapan ke taman/halaman kosong yang tidak berada di bawah ruang tertutup. Peringatan: Sumur resapan di bawah Ruang keluarga.",
      scene
    )

    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.reply.toLowerCase()).toContain("pocket kosong")
    expect(result.reply.toLowerCase()).toContain("taman servis")
    expect(result.actions).toEqual([
      { type: "updateRoom", roomId: "dapur", patch: { y: 0.2 } },
      { type: "updateRoom", roomId: "km1", patch: { x: 4.62 } },
      { type: "moveSanitationObject", kind: "soakwell", x: 3.92, y: 2.62 },
    ])
  })

  it("reproduces the reported bug's fix: moving a bathroom onto a floor with a soakwell must NOT overlap it", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [
        { id: "f1", name: "Lantai 1", level: 1 },
        { id: "f2", name: "Lantai 2", level: 2 },
      ],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "r1", name: "Dapur", type: "dapur", floorId: "f1", x: 0, y: 0, width: 6, depth: 3, areaM2: 18, locked: false },
        { id: "r2", name: "Kamar Mandi 2", type: "kamar_mandi", floorId: "f2", x: 0, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
      ],
      openings: [],
      sanitation: {
        // Center (7,7), 2x2 -> occupies x:[6,8], y:[6,8] — the only fully
        // free-of-rooms corner on Lantai 1's 8x8 site.
        soakwell: { id: "sw1", x: 7, y: 7, widthM: 2, lengthM: 2, depthM: 2 },
      },
    }
    const result = handleFloorplanInstruction(
      "pindahkan kamar mandi dari lantai 2 ke lantai 1",
      scene
    )
    expect(result.matched).toBe(true)
    if (!result.matched) return
    const action = result.actions[0]
    expect(action.type).toBe("updateRoom")
    if (action.type !== "updateRoom") return

    const movedRect = { x: action.patch.x!, y: action.patch.y!, width: 2, depth: 2 }
    expect(rectsOverlap(movedRect, { x: 0, y: 0, width: 6, depth: 3 })).toBe(false) // Dapur
    expect(rectsOverlap(movedRect, { x: 6, y: 6, width: 2, depth: 2 })).toBe(false) // soakwell
    expect(result.reply.toLowerCase()).toContain("instalasi sanitasi")
  })

  it("escalates (matched:false) instead of overlapping sanitation when no other spot exists", () => {
    const scene: FloorplanScene = {
      site: { widthM: 6, depthM: 3 },
      floors: [
        { id: "f1", name: "Lantai 1", level: 1 },
        { id: "f2", name: "Lantai 2", level: 2 },
      ],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        // Only a 2x3 strip (x:4..6) is free of rooms on Lantai 1...
        { id: "r1", name: "Dapur", type: "dapur", floorId: "f1", x: 0, y: 0, width: 4, depth: 3, areaM2: 12, locked: false },
        { id: "r2", name: "Kamar Mandi 2", type: "kamar_mandi", floorId: "f2", x: 0, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
      ],
      openings: [],
      sanitation: {
        // ...but the soakwell sits exactly there, so nothing is left.
        soakwell: { id: "sw1", x: 5, y: 1.5, widthM: 2, lengthM: 3, depthM: 2 },
      },
    }
    const result = handleFloorplanInstruction(
      "pindahkan kamar mandi dari lantai 2 ke lantai 1",
      scene
    )
    expect(result.matched).toBe(false)
  })

  it("does not treat sanitation as an obstacle for an upper (non-ground) floor", () => {
    const scene: FloorplanScene = {
      site: { widthM: 4, depthM: 4 },
      floors: [
        { id: "f1", name: "Lantai 1", level: 1 },
        { id: "f2", name: "Lantai 2", level: 2 },
      ],
      selectedFloorId: "f2",
      selectedRoomId: null,
      rooms: [],
      openings: [],
      sanitation: {
        // Covers the ENTIRE 4x4 site footprint — would block everything if
        // (wrongly) treated as an obstacle on Lantai 2.
        soakwell: { id: "sw1", x: 2, y: 2, widthM: 4, lengthM: 4, depthM: 2 },
      },
    }
    const result = handleFloorplanInstruction("tambah gudang", scene)
    expect(result.matched).toBe(true)
  })
})

describe("handleFloorplanInstruction — delete/opening (no placement, unaffected)", () => {
  it("matches 'hapus kamar mandi'", () => {
    const scene = makeScene()
    const result = handleFloorplanInstruction("hapus kamar mandi", scene)
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions[0]).toEqual({
      type: "deleteRoom",
      roomId: "r2",
    })
  })

  it("matches 'tambah pintu di ruang tamu' with a fallback to the first room", () => {
    const scene = makeScene()
    const result = handleFloorplanInstruction("tambah pintu", scene)
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions[0]).toMatchObject({
      type: "addOpening",
      openingType: "door",
    })
  })
})

describe("handleFloorplanInstruction — fix overlaps (reproduces the reported error)", () => {
  it("matches 'perbaiki tata letak lantai 1 yang bertumpuk' and moves the overlapping bathroom", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [
        { id: "f1", name: "Lantai 1", level: 1 },
      ],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "r1", name: "Dapur", type: "dapur", floorId: "f1", x: 0, y: 3, width: 4, depth: 3, areaM2: 12, locked: false },
        { id: "r2", name: "Kamar Mandi 1", type: "kamar_mandi", floorId: "f1", x: 3, y: 3, width: 3, depth: 2, areaM2: 6, locked: false, requiresVentilation: true },
      ],
      openings: [],
    }
    const result = handleFloorplanInstruction(
      "perbaiki tata letak lantai 1 yang masih saling bertumpuk kamarmandinya",
      scene
    )
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions).toHaveLength(1)
    const action = result.actions[0]
    expect(action.type).toBe("updateRoom")
    if (action.type !== "updateRoom") return
    expect(action.roomId).toBe("r2")

    const movedRect = { x: action.patch.x!, y: action.patch.y!, width: 3, depth: 2 }
    expect(rectsOverlap(movedRect, { x: 0, y: 3, width: 4, depth: 3 })).toBe(false)
    expect(result.reply.toLowerCase()).toContain("kamar mandi 1")
  })

  it("reports no overlaps when the floor is actually clean", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "r1", name: "Dapur", type: "dapur", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16, locked: false },
        { id: "r2", name: "Kamar Mandi 1", type: "kamar_mandi", floorId: "f1", x: 4, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
      ],
      openings: [],
    }
    const result = handleFloorplanInstruction(
      "perbaiki tata letak lantai 1 yang bertumpuk",
      scene
    )
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions).toHaveLength(0)
    expect(result.reply.toLowerCase()).toContain("tidak ada ruang yang bertumpuk")
  })

  it("does not match a generic 'perbaiki' without overlap/layout intent", () => {
    const scene = makeScene()
    const result = handleFloorplanInstruction("perbaiki kamar mandi", scene)
    expect(result.matched).toBe(false)
  })

  it("resolves via shrinking when the floor has zero free space for relocation (no room can move, only shrink)", () => {
    // Dapur covers the WHOLE 4x4 site; Kamar Mandi 1 (2x2) sits carved into
    // its corner. No relocation can EVER succeed here (Dapur IS the entire
    // site — there is no rect anywhere that doesn't overlap it), so this
    // exercises the shrink fallback specifically: Dapur's own rect must be
    // trimmed back to exclude Kamar Mandi 1's corner.
    const scene: FloorplanScene = {
      site: { widthM: 4, depthM: 4 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "r1", name: "Dapur", type: "dapur", floorId: "f1", x: 0, y: 0, width: 4, depth: 4, areaM2: 16, locked: false },
        { id: "r2", name: "Kamar Mandi 1", type: "kamar_mandi", floorId: "f1", x: 2, y: 2, width: 2, depth: 2, areaM2: 4, locked: false },
      ],
      openings: [],
    }
    const result = handleFloorplanInstruction(
      "perbaiki tata letak lantai 1 yang bertumpuk",
      scene
    )
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions).toHaveLength(1)
    const action = result.actions[0]
    expect(action.type).toBe("updateRoom")
    if (action.type !== "updateRoom") return
    // Dapur is the one trimmed (Kamar Mandi 1 keeps its original size/position
    // — it's boxed into the corner with zero shrink headroom on any side).
    expect(action.roomId).toBe("r1")
    expect(action.patch.width ?? 4).toBeLessThanOrEqual(4)
    expect(action.patch.depth ?? 4).toBeLessThanOrEqual(4)
    expect(Math.min(action.patch.width ?? 4, action.patch.depth ?? 4)).toBeGreaterThanOrEqual(1.2)

    const dapur = { x: action.patch.x ?? 0, y: action.patch.y ?? 0, width: action.patch.width ?? 4, depth: action.patch.depth ?? 4 }
    expect(rectsOverlap(dapur, { x: 2, y: 2, width: 2, depth: 2 })).toBe(false)
    expect(result.reply.toLowerCase()).toContain("perkecil")
  })

  it("escalates to LLM when overlaps exist and NEITHER relocating NOR shrinking (below MIN_ROOM) can resolve it", () => {
    // Both rooms are already right at the MIN_ROOM (1.2 m) boundary in every
    // direction relevant to the overlap — RoomA is the entire 2x2 site,
    // RoomB (1x1) sits flush in its far corner. Any shrink of either room
    // along either axis would land below 1.2 m, so this is a genuine dead
    // end: no relocation, no safe shrink — real architectural judgment needed.
    const scene: FloorplanScene = {
      site: { widthM: 2, depthM: 2 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "r1", name: "Dapur", type: "dapur", floorId: "f1", x: 0, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
        { id: "r2", name: "Kamar Mandi 1", type: "kamar_mandi", floorId: "f1", x: 1, y: 1, width: 1, depth: 1, areaM2: 1, locked: false },
      ],
      openings: [],
    }
    const result = handleFloorplanInstruction(
      "perbaiki tata letak lantai 1 yang bertumpuk",
      scene
    )
    expect(result.matched).toBe(false)
  })

  it("avoids sanitation objects when resolving an overlap on the ground floor", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "r1", name: "Dapur", type: "dapur", floorId: "f1", x: 0, y: 3, width: 4, depth: 3, areaM2: 12, locked: false },
        { id: "r2", name: "Kamar Mandi 1", type: "kamar_mandi", floorId: "f1", x: 3, y: 3, width: 3, depth: 2, areaM2: 6, locked: false, requiresVentilation: true },
      ],
      openings: [],
      sanitation: {
        // Occupies the only free corner x:[6,8], y:[6,8].
        soakwell: { id: "sw1", x: 7, y: 7, widthM: 2, lengthM: 2, depthM: 2 },
      },
    }
    const result = handleFloorplanInstruction(
      "perbaiki tata letak lantai 1 yang bertumpuk",
      scene
    )
    expect(result.matched).toBe(true)
    if (!result.matched) return
    const action = result.actions[0]
    expect(action.type).toBe("updateRoom")
    if (action.type !== "updateRoom") return
    const movedRect = { x: action.patch.x!, y: action.patch.y!, width: 3, depth: 2 }
    expect(rectsOverlap(movedRect, { x: 6, y: 6, width: 2, depth: 2 })).toBe(false)
    expect(rectsOverlap(movedRect, { x: 0, y: 3, width: 4, depth: 3 })).toBe(false)
  })

  it("reproduces the real 'Rumah Qyfa' production layout: Dapur/Kamar Mandi 1/Ruang Keluarga saturated ground floor", () => {
    // Exact Lantai 1 geometry pulled live from proj-sKeE6zh- (site 8x8m).
    // Carport + Ruang Tamu tile the whole left half; Dapur + Ruang Keluarga
    // tile the whole right half; Kamar Mandi 1 was carved into the right
    // half without ever trimming Dapur/Ruang Keluarga back, so it overlaps
    // BOTH of them (the user only noticed the Dapur one: "kamarmandi & dapur
    // tumpang tindih"). The floor is edge-to-edge tiled — there is no free
    // rect anywhere for relocation — so this can only resolve via shrinking.
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "floor-1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "floor-1",
      selectedRoomId: null,
      rooms: [
        { id: "room-OVGDUO", name: "Carport", type: "carport", floorId: "floor-1", x: 0.28, y: 0.28, width: 2.88, depth: 3.82, areaM2: 11, locked: false, requiresVentilation: false, requiresNaturalLight: false },
        { id: "room-BB_A3S", name: "Ruang tamu", type: "ruang_tamu", floorId: "floor-1", x: 0.28, y: 4.14, width: 2.88, depth: 3.56, areaM2: 10.25, locked: false, requiresVentilation: false, requiresNaturalLight: true },
        { id: "room-B9lRfP", name: "Dapur", type: "dapur", floorId: "floor-1", x: 3.22, y: 0.28, width: 4.5, depth: 3.04, areaM2: 13.68, locked: false, requiresVentilation: false, requiresNaturalLight: true },
        { id: "room-FPMQ_F", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "floor-1", x: 3.22, y: 3.32, width: 4.5, depth: 4.38, areaM2: 19.71, locked: false, requiresVentilation: false, requiresNaturalLight: true },
        { id: "room-uPeA4g", name: "Kamar mandi 1", type: "kamar_mandi", floorId: "floor-1", x: 4.57, y: 2, width: 3.15, depth: 1.61, areaM2: 5.07, locked: false, requiresVentilation: true, requiresNaturalLight: false },
      ],
      openings: [],
      sanitation: {
        soakwell: { id: "sani-Qm6nYDpR", x: 6, y: 6.8, widthM: 1.4, lengthM: 1.4, depthM: 2 },
        septicTank: { id: "sani-7Q8TJUo6", x: 2, y: 6.65, widthM: 0.85, lengthM: 1.7, depthM: 1.8 },
        controlBoxes: [
          { id: "sani-rGxt8_Cm", x: 1.33, y: 7.4, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
          { id: "sani-38e4l63P", x: 2.67, y: 7.4, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
          { id: "sani-Y9peNjnk", x: 4, y: 7.4, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
          { id: "sani-4rXlh2w2", x: 5.33, y: 7.4, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
          { id: "sani-Ko7A7Tp6", x: 6.67, y: 7.4, widthM: 0.4, lengthM: 0.4, depthM: 0.5 },
        ],
      },
    }

    const result = handleFloorplanInstruction(
      "perbaiki tata letak lantai 1, kamar mandi dan dapur tumpang tindih",
      scene
    )
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions).toHaveLength(2)

    const patches = new Map(
      result.actions
        .filter((a): a is { type: "updateRoom"; roomId: string; patch: { x?: number; y?: number; width?: number; depth?: number } } => a.type === "updateRoom")
        .map((a) => [a.roomId, a.patch])
    )
    // Both fixes are shrinks (depth-only) — the floor is fully tiled, so
    // neither Dapur nor Kamar Mandi 1 could have been relocated instead.
    expect(patches.get("room-B9lRfP")).toEqual({ depth: 1.72 })
    expect(patches.get("room-uPeA4g")).toEqual({ depth: 1.32 })

    const finalRects = scene.rooms.map((r) => ({
      ...r,
      ...(patches.get(r.id) ?? {}),
    }))
    for (let i = 0; i < finalRects.length; i++) {
      for (let j = i + 1; j < finalRects.length; j++) {
        expect(rectsOverlap(finalRects[i], finalRects[j])).toBe(false)
      }
    }
    expect(result.reply.toLowerCase()).toContain("perkecil")
  })
})

describe("handleFloorplanInstruction — batch daylight fix (audit phase 2)", () => {
  function daylightScene(): FloorplanScene {
    return {
      site: { widthM: 8, depthM: 10 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "kt", name: "Kamar utama", type: "kamar_tidur", floorId: "f1", x: 0, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0, y: 7, width: 4, depth: 3, areaM2: 12, locked: false },
        { id: "km", name: "Kamar mandi", type: "kamar_mandi", floorId: "f1", x: 3, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
      ],
      openings: [],
    }
  }

  it("'perbaiki cahaya' adds a window to every windowless habitable room, skipping wet rooms", () => {
    const result = handleFloorplanInstruction("perbaiki cahaya", daylightScene())
    expect(result.matched).toBe(true)
    if (!result.matched) return
    const windowRooms = result.actions
      .filter((a): a is { type: "addOpening"; roomId: string; side: string; positionM: number; openingType: string } => a.type === "addOpening")
      .map((a) => a.roomId)
      .sort()
    expect(windowRooms).toEqual(["kt", "tamu"]) // not the kamar mandi
    expect(result.reply).toMatch(/SNI 03-6572/)
  })

  it("a single 'tambah jendela di X' does NOT trigger the batch daylight fix", () => {
    // matchFixDaylight must not hijack a single-room phrasing that lacks a
    // batch marker ("semua"/"belum punya"/"perbaiki cahaya") — its SNI-6572
    // batch reply is its signature, and it must not appear here.
    const result = handleFloorplanInstruction("tambah jendela di ruang tamu", daylightScene())
    if (result.matched) {
      expect(result.reply).not.toMatch(/SNI 03-6572/)
    }
  })

  it("reports all-clear when every habitable room already has a window", () => {
    const scene = daylightScene()
    scene.openings = [
      { id: "o1", roomId: "kt", side: "n", type: "window", positionM: 1.5 },
      { id: "o2", roomId: "tamu", side: "s", type: "window", positionM: 2 },
    ]
    const result = handleFloorplanInstruction("perbaiki cahaya", scene)
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions).toHaveLength(0)
    expect(result.reply.toLowerCase()).toContain("sudah punya jendela")
  })
})

describe("handleFloorplanInstruction — audit-driven sanitation fix (phase 2b)", () => {
  it("'perbaiki sanitasi' relocates a misplaced soakwell to open ground", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "family", name: "Ruang keluarga", type: "ruang_keluarga", floorId: "f1", x: 0, y: 0, width: 6, depth: 8, areaM2: 48, locked: false },
        { id: "garden", name: "Taman", type: "taman", floorId: "f1", x: 6, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
      ],
      openings: [],
      sanitation: {
        soakwell: { id: "sw1", x: 3, y: 4, widthM: 1, lengthM: 1, depthM: 2 },
      },
    }
    // Audit phrasing — no "resapan" keyword, just "perbaiki sanitasi".
    const result = handleFloorplanInstruction("perbaiki sanitasi", scene)
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions.some((a) => a.type === "moveSanitationObject")).toBe(true)
    expect(result.reply.toLowerCase()).toContain("sumur resapan")
  })
})

describe("handleFloorplanInstruction — batch room-size fix to SNI (phase 2b)", () => {
  function sizeScene(): FloorplanScene {
    return {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "kt", name: "Kamar utama", type: "kamar_tidur", floorId: "f1", x: 0, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 0, y: 5, width: 4, depth: 3, areaM2: 12, locked: false },
      ],
      openings: [],
    }
  }

  it("'perbaiki ukuran ruang' enlarges the undersized bedroom to its SNI minimum", () => {
    const result = handleFloorplanInstruction("perbaiki ukuran ruang", sizeScene())
    expect(result.matched).toBe(true)
    if (!result.matched) return
    const upd = result.actions.filter((a): a is { type: "updateRoom"; roomId: string; patch: { width?: number; depth?: number } } => a.type === "updateRoom")
    expect(upd.some((a) => a.roomId === "kt")).toBe(true)
    expect(result.reply).toMatch(/SNI 03-1733/)
  })

  it("does NOT hijack the 'terlalu kecil' warning phrasing (leaves it to matchRepairSmallRoomWarning)", () => {
    const result = handleFloorplanInstruction("perbaiki ruang yang terlalu kecil", sizeScene())
    expect(result.matched).toBe(true)
    if (!result.matched) return
    // Whatever handles it, the reply must not be the SNI-1733 batch signature.
    expect(result.reply).not.toMatch(/ukuran minimum standar SNI 03-1733/)
  })
})

describe("handleFloorplanInstruction — one-shot 'perbaiki semua' (phase 3)", () => {
  function messyScene(): FloorplanScene {
    return {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        // Undersized + windowless, with free space east/south to grow.
        { id: "kt", name: "Kamar utama", type: "kamar_tidur", floorId: "f1", x: 0, y: 0, width: 2, depth: 2, areaM2: 4, locked: false },
        { id: "tamu", name: "Ruang tamu", type: "ruang_tamu", floorId: "f1", x: 5, y: 0, width: 3, depth: 3, areaM2: 9, locked: false },
        // Open ground for the soakwell to relocate into.
        { id: "taman", name: "Taman", type: "taman", floorId: "f1", x: 0, y: 6, width: 8, depth: 2, areaM2: 16, locked: false },
      ],
      openings: [],
      // Soakwell currently under Ruang tamu → needs relocation to the taman.
      sanitation: { soakwell: { id: "sw", x: 6.5, y: 1.5, widthM: 1, lengthM: 1, depthM: 2 } },
    }
  }

  it("'perbaiki semua' returns a combined, non-empty proposal touching more than one category", () => {
    const result = handleFloorplanInstruction("perbaiki semua", messyScene())
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions.length).toBeGreaterThan(1)
    const kinds = new Set(result.actions.map((a) => a.type))
    // At least room enlargement + one other kind.
    expect(kinds.has("updateRoom")).toBe(true)
    expect(kinds.size).toBeGreaterThanOrEqual(2)
    expect(result.reply.toLowerCase()).toContain("sesuai standar")
  })

  it("'perbaiki cahaya' still routes to the single-category handler, not the fix-all", () => {
    const result = handleFloorplanInstruction("perbaiki cahaya", messyScene())
    expect(result.matched).toBe(true)
    if (!result.matched) return
    // Single-category: only window additions, no room enlargement.
    expect(result.actions.every((a) => a.type === "addOpening")).toBe(true)
  })

  it("all-clear scene: 'perbaiki semua' matches with no actions and a reassuring reply", () => {
    const scene: FloorplanScene = {
      site: { widthM: 8, depthM: 8 },
      floors: [{ id: "f1", name: "Lantai 1", level: 1 }],
      selectedFloorId: "f1",
      selectedRoomId: null,
      rooms: [
        { id: "kt", name: "Kamar", type: "kamar_tidur", floorId: "f1", x: 0, y: 0, width: 3.2, depth: 3.2, areaM2: 10.24, locked: false },
      ],
      openings: [{ id: "o1", roomId: "kt", side: "n", type: "window", positionM: 1.5 }],
    }
    const result = handleFloorplanInstruction("perbaiki semua sesuai standar", scene)
    expect(result.matched).toBe(true)
    if (!result.matched) return
    expect(result.actions).toHaveLength(0)
  })
})
