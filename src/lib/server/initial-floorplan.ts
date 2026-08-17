/**
 * MEMBANGUN DENAH AWAL SECARA DETERMINISTIK.
 *
 * AKAR MASALAH (proj-modern-tropis-1, 2026-08-02): saat denah kosong dan
 * pengguna berkata "buatkan denah 2 lantai sesuai brief", agent menempuh empat
 * kegagalan berlapis. Tiga lapis pertama sudah ditutup di sisi prompt —
 * `spaceProgram` kini dikirim ke planner, denah kosong dibedakan dari data
 * hilang, dan selisih jumlah lantai tak lagi dijadikan alasan berhenti.
 *
 * Lapis keempat tak bisa diselesaikan dengan prompt: setelah agent benar-benar
 * menggambar, koordinat yang ia karang selalu bertabrakan ("Koridor" menimpa
 * "Ruang makan"), validator menolak, SELURUH usulan dibuang, dan pengguna tetap
 * menerima 0 aksi. Menghitung tata letak 9 ruang + koridor bebas tabrakan
 * memang bukan pekerjaan LLM.
 *
 * Padahal solvernya sudah ada dan tervalidasi produksi: `generateLayout`
 * (treemap + ensureCorridor + generateConnectingDoors), dipakai jalur review,
 * rab, dan layout. Pola "solver ada tapi jalur agent tidak memakainya" sudah
 * berulang empat kali di Baruma; modul ini memutusnya.
 *
 * Pembagian kerja tetap seperti biaya/luas Baruma: LLM memilih NIAT
 * arsitektural, kode yang menyusun geometrinya.
 */
import { generateLayout } from "@/lib/mock/layout"
import { repairConnectivity } from "@/lib/server/connectivity-repair"
import { findFloorplanActionFeedback } from "@/lib/server/editor-assistant"
import { parseOpeningWall, round2, type Side } from "@/lib/geometry"
import { neighborServedByOpening } from "@/lib/geometry/opening-plan"
import { ROOM_TYPES } from "@/lib/constants"
import type { FloorplanAction, FloorplanScene } from "@/lib/assistant/actions"
import type { Brief, Project, RoomType } from "@/types"

/** Ruang sirkulasi — dilewati semua penghuni, jadi wajib punya pintu sendiri. */
const CIRCULATION_TYPES = new Set(["koridor", "foyer", "ruang_tamu", "ruang_keluarga", "ruang_makan"])
const OPPOSITE_SIDE: Record<Side, Side> = { n: "s", s: "n", w: "e", e: "w" }

export interface InitialFloorplanResult {
  matched: boolean
  reply: string
  actions: FloorplanAction[]
  /** true saat denah yang ada DIKOSONGKAN lalu disusun ulang (reset eksplisit). */
  reset?: boolean
}

const NO_MATCH: InitialFloorplanResult = { matched: false, reply: "", actions: [] }

/**
 * Ungkapan yang berarti "gambarkan rumahnya dari nol". Sengaja menuntut kata
 * kerja MEMBUAT + objek DENAH: "kenapa dapur di depan?" tidak boleh memicu
 * pembangunan ulang, dan "tambah kamar" ditangani handler lain.
 */
const BUILD_VERB = /\b(buat|buatkan|bikin|gambar|gambarkan|susun|rancang|generate|buatlah)\w*\b/i
// Akhiran "-nya"/"-ku" lazim di percakapan ("buatkan denahnya dong"), jadi
// jangan menuntut batas kata di ujung kanan.
const PLAN_NOUN = /\b(denah|layout|rumah|tata\s*ruang|floorplan)/i

/**
 * Ungkapan yang berarti "bongkar dan bangun kembali dari nol". Ini SATU-SATUNYA
 * perintah yang membolehkan menimpa denah yang sudah berisi ruang — tanpa kata
 * ini, build di denah terisi ditolak (menimpa karya pengguna = kegagalan yang
 * lebih buruk daripada tidak menolong). Guard anti-destruktif pun tetap melindungi
 * jalur LLM; pengecualian hanya untuk rebuild deterministik yang EKSPLISIT ini.
 */
const RESET_INTENT =
  /\b(bangun\s*ulang|mulai\s*ulang|mulai\s*dari\s*nol|buat\s*ulang|gambar\s*ulang|susun\s*ulang|reset\s*denah|reset\s*layout|dari\s*nol|dari\s*awal)\b/i

export function isExplicitResetIntent(instruction: string): boolean {
  return RESET_INTENT.test(instruction)
}

/** Jumlah lantai yang diminta di instruksi, bila disebut. */
function requestedFloors(instruction: string): number | null {
  const digit = instruction.match(/(\d+)\s*(?:lantai|tingkat)/i)
  if (digit) {
    const n = Number(digit[1])
    if (Number.isFinite(n) && n >= 1 && n <= 4) return n
  }
  const words: Record<string, number> = { satu: 1, dua: 2, tiga: 3, empat: 4 }
  const word = instruction.match(/\b(satu|dua|tiga|empat)\s*(?:lantai|tingkat)/i)
  if (word) return words[word[1].toLowerCase()] ?? null
  return null
}

/**
 * Usulkan denah lengkap saat kanvas masih kosong.
 *
 * Menolak (matched: false) bila denah sudah berisi ruang — menimpa karya
 * pengguna adalah kegagalan yang lebih buruk daripada tidak menolong, dan
 * riwayat produksi sudah pernah mencatat agent menghapus seisi lantai 1 saat
 * diminta memperbaiki lantai 2.
 */
export function buildInitialFloorplan(
  instruction: string,
  scene: FloorplanScene,
  project: Project,
  brief: Brief | null | undefined
): InitialFloorplanResult {
  // Scene snapshot dari klien tak selalu lengkap (jalur test & payload lama
  // mengirim tanpa `rooms`); handler ini tidak boleh melempar di jalur panas.
  const sceneRooms = Array.isArray(scene.rooms) ? scene.rooms : []
  // Denah yang sudah berisi ruang ditolak KECUALI pengguna EKSPLISIT minta
  // bangun ulang dari nol ("bangun ulang denah ini", "mulai dari nol").
  const reset = isExplicitResetIntent(instruction) && sceneRooms.length > 0
  if (sceneRooms.length > 0 && !reset) return NO_MATCH
  if (!project?.site || !Number.isFinite(project.site.widthM) || !Number.isFinite(project.site.depthM)) {
    return NO_MATCH
  }
  const program = brief?.spaceProgram
  if (!Array.isArray(program) || program.length === 0) return NO_MATCH
  // Reset eksplisit ("mulai dari nol", "reset denah") cukup kuat sebagai niat
  // membongkar-bangun ulang — tak menuntut lagi kata kerja "buat/gambar".
  if (!reset && (!BUILD_VERB.test(instruction) || !PLAN_NOUN.test(instruction))) {
    return NO_MATCH
  }

  // Perintah pengguna menang atas angka lama di brief — ini keputusan terbaru.
  const baseFloors = requestedFloors(instruction) ?? Math.max(1, project.floors || 1)

  // Program padat di SATU lantai adalah kasus yang treemap belum tangani:
  // kamar terkubur di tengah dan `ensureCorridor` sengaja tidak menyisipkan
  // koridor bila lantai sudah punya ruang sirkulasi (catatan lib/mock/layout.ts).
  // Daripada menyerahkan usulan yang pasti dibuang, coba juga penataan
  // bertingkat: ruang privat naik ke atas sehingga tiap lantai punya kepadatan
  // yang bisa disirkulasikan. Hanya dipakai bila varian aslinya memang gagal.
  const candidates = new Set<number>([baseFloors])
  const totalUnits = program.reduce((n, item) => n + (item.quantity || 1), 0)
  if (baseFloors === 1 && totalUnits > 8) candidates.add(2)

  for (const floors of candidates) {
    const attempt = tryBuild(instruction, scene, project, brief as Brief, floors, reset)
    if (attempt) {
      // Menyimpang dari jumlah lantai yang DIHARAPKAN pengguna — baik yang ia
      // ucapkan, maupun yang tertulis di brief bila ia tidak menyebutnya. Kedua
      // hal itu adalah ekspektasi yang ia pegang, jadi keduanya perlu penjelasan.
      if (floors !== baseFloors) {
        return {
          ...attempt,
          reply:
            `Program ${totalUnits} ruang tidak bisa ditata layak huni dalam ${baseFloors} lantai pada lahan ` +
            `${project.site.widthM}×${project.site.depthM} m — ruang di tengah selalu terkunci tanpa ` +
            `jalur masuk dari dalam rumah. Saya susun ${floors} lantai sebagai gantinya.\n\n` +
            attempt.reply,
        }
      }
      return attempt
    }
  }
  return NO_MATCH
}

/** Satu percobaan penataan pada jumlah lantai tertentu; null bila tak layak. */
function tryBuild(
  instruction: string,
  scene: FloorplanScene,
  project: Project,
  brief: Brief,
  floors: number,
  reset = false
): InitialFloorplanResult | null {
  const program = brief.spaceProgram
  const layout = generateLayout({ ...project, floors, rooftop: false }, brief)

  const usedFloorIds = new Set(layout.rooms.map((r) => r.floorId))
  const actions: FloorplanAction[] = []

  // RESET: kosongkan ruang lama dulu. deleteRoom di store ikut membersihkan
  // bukaan & fasad yang menempel di dinding ruang. Lantai tidak dihapus —
  // level yang sama dipakai ulang di bawah.
  if (reset) {
    const existing = Array.isArray(scene.rooms) ? scene.rooms : []
    for (const room of existing) {
      actions.push({ type: "deleteRoom", roomId: room.id } as FloorplanAction)
    }
  }

  // Lantai hasil `generateLayout` menamai "floor-1..N" (deterministik), padahal
  // lantai NYATA di scene ber-id acak utk level ≥2 ("floor-k4KTN1"). Petakan
  // per LEVEL: level yang sudah ada dipakai id aslinya (tanpa addFloor — kalau
  // tidak, rebuild di denah berlantai melahirkan lantai hantu level 3/4); level
  // baru dibuat via addFloor, dan di jalur apply dicarikan lagi per level
  // (resolveFloorId di apply.ts).
  const sceneFloorByLevel = new Map(scene.floors.map((f) => [f.level, f.id]))
  const layoutFloorLevel = new Map(layout.floors.map((f) => [f.id, f.level]))

  for (const floor of layout.floors) {
    if (!usedFloorIds.has(floor.id)) continue
    if (sceneFloorByLevel.has(floor.level)) continue
    actions.push({ type: "addFloor" } as FloorplanAction)
  }

  const floorIdFor = (layoutFloorId: string): string => {
    const level = layoutFloorLevel.get(layoutFloorId)
    if (level == null) return layoutFloorId
    return sceneFloorByLevel.get(level) ?? layoutFloorId
  }

  // PEMETAAN ID — bagian yang menentukan hidup-matinya usulan ini.
  //
  // `generateLayout` memberi ruang id internalnya sendiri ("room-…"), tapi
  // ruang yang lahir dari aksi `addRoom` baru mendapat id saat diterapkan; di
  // pra-cek server `simulateFloorplanActions` menamainya `new-<indeks>` sesuai
  // urutan penambahan. Bila `addOpening` tetap merujuk id generator, seluruh
  // pintu jatuh ke ruang yang tak pernah ada — validator lalu menyimpulkan
  // setiap ruang terkurung dan MEMBUANG usulannya. Karena itu id dipetakan
  // mengikuti urutan yang sama persis dengan simulator.
  const idMap = new Map<string, string>()
  // Offset id `new-N` harus sama persis dengan cara `simulateFloorplanActions`
  // menghitungnya: ia mulai dari `scene.rooms.length` lalu bertambah per
  // addRoom. Untuk RESET semua ruang lama dihapus DULUAN, sehingga penghitung
  // mulai dari 0 — memakai offset scene.rooms.length akan menaruh seluruh pintu
  // ke ruang yang tak pernah ada dan membuat validator menolak usulan
  // (regresi proj-modern-tropis-1, 2026-08-02).
  const idOffset = reset ? 0 : (scene.rooms?.length ?? 0)
  layout.rooms.forEach((room, index) => {
    idMap.set(room.id, `new-${idOffset + index}`)
  })

  for (const room of layout.rooms) {
    actions.push({
      type: "addRoom",
      roomType: room.type as RoomType,
      floorId: floorIdFor(room.floorId),
      x: room.x,
      y: room.y,
      width: room.width,
      depth: room.depth,
    } as FloorplanAction)
  }

  for (const opening of layout.openings) {
    const parsed = parseOpeningWall(opening.wallId)
    if (!parsed) continue
    const roomId = idMap.get(parsed.roomId)
    if (!roomId) continue
    actions.push({
      type: "addOpening",
      roomId,
      side: parsed.side,
      positionM: opening.positionM,
      openingType: opening.type,
      ...(opening.kind ? { kind: opening.kind } : {}),
    } as FloorplanAction)
  }

  // PINTU CERMIN UNTUK RUANG SIRKULASI.
  //
  // `generateLayout` memasang pintu kamar→koridor hanya di sisi KAMAR, dan
  // secara arsitektural itu sudah benar: analisis konektivitas membaca pintu
  // dua arah, sehingga denah hasil generator tidak punya ruang terkurung.
  // Tetapi gerbang `findConnectivityRegressions` menilai ruang BARU dengan
  // aturan lebih ketat — ruang baru yang tidak menjadi TUAN RUMAH satu pun
  // pintu langsung dicap tak bisa dimasuki (connectivity-guard.ts:132).
  // Koridor persis jatuh ke celah itu: dilewati semua orang, tapi tak memiliki
  // satu pun daun pintu atas namanya, sehingga SELURUH usulan dibuang dan
  // pengguna kembali menerima 0 aksi.
  //
  // Solusinya bukan melonggarkan gerbang — aturan itu menangkap kesalahan nyata
  // pada usulan LLM. Yang tepat adalah mencatat pintu yang sama dari sisi
  // koridor juga: satu bukaan fisik, dua ruang yang mengakuinya.
  const roomById = new Map(layout.rooms.map((r) => [r.id, r]))
  const circulationIds = new Set(
    layout.rooms.filter((r) => CIRCULATION_TYPES.has(r.type)).map((r) => r.id)
  )
  const hostedCirculation = new Set(
    layout.openings
      .filter((o) => o.type === "door")
      .map((o) => parseOpeningWall(o.wallId)?.roomId)
      .filter((id): id is string => !!id && circulationIds.has(id))
  )
  for (const opening of layout.openings) {
    if (opening.type !== "door") continue
    const parsed = parseOpeningWall(opening.wallId)
    if (!parsed) continue
    const host = roomById.get(parsed.roomId)
    if (!host) continue
    const neighbor = neighborServedByOpening(
      host,
      parsed.side,
      opening.positionM,
      opening.widthM,
      layout.rooms
    )
    if (!neighbor) continue
    const neighborRoom = roomById.get(neighbor.id)
    if (!neighborRoom || !circulationIds.has(neighborRoom.id)) continue
    if (hostedCirculation.has(neighborRoom.id)) continue
    const mirroredSide = OPPOSITE_SIDE[parsed.side]
    const roomId = idMap.get(neighborRoom.id)
    if (!roomId) continue
    // Posisi diukur dari ujung dinding ruang penerima, bukan ruang asal.
    const positionM =
      mirroredSide === "n" || mirroredSide === "s"
        ? round2(host.x + opening.positionM - neighborRoom.x)
        : round2(host.y + opening.positionM - neighborRoom.y)
    const span = mirroredSide === "n" || mirroredSide === "s" ? neighborRoom.width : neighborRoom.depth
    if (positionM <= 0 || positionM >= span) continue
    actions.push({
      type: "addOpening",
      roomId,
      side: mirroredSide,
      positionM,
      openingType: "door",
      ...(opening.kind ? { kind: opening.kind } : {}),
    } as FloorplanAction)
    hostedCirculation.add(neighborRoom.id)
  }

  // Jahitan terakhir: `generateLayout` menyisipkan koridor pada lantai privat
  // tapi tidak selalu memberinya pintu — pada brief nyata proj-modern-tropis-1
  // koridor lantai 2 lahir tanpa satu pun bukaan, dan justru KORIDOR itu yang
  // dinilai terkurung sehingga seluruh usulan dibuang. `repairConnectivity`
  // sudah menyelesaikan kelas masalah ini untuk usulan agent; pakai solver yang
  // sama di sini alih-alih menambal sendiri.
  const repaired = repairConnectivity(scene, actions)
  const finalActions = repaired.actions.length >= actions.length ? repaired.actions : actions

  // PERIKSA HASIL SENDIRI SEBELUM MENGAKU BISA.
  //
  // Gerbang `findFloorplanActionFeedback` membuang usulan yang cacat secara
  // diam-diam: pengguna melihat 0 aksi tanpa tahu sebabnya. Mengembalikan
  // matched:true untuk usulan yang pasti ditolak sama saja dengan berbohong,
  // jadi periksa dulu dengan gerbang yang sama.
  //
  // Kasus yang diketahui belum tertangani: program padat (12 ruang) yang
  // dipaksa muat di SATU lantai — treemap mengubur kamar di tengah dan
  // `ensureCorridor` sengaja tidak menyisipkan koridor saat lantai sudah punya
  // ruang sirkulasi (lihat catatan di lib/mock/layout.ts). Untuk itu jalur LLM
  // masih dipakai; agent tidak berpura-pura sanggup.
  // Guard anti-destruktif dilewati HANYA untuk reset eksplisit ini — pengguna
  // meminta denah dikosongkan, jadi deleteRoom massal adalah permintaan, bukan
  // kecelakaan LLM. Guard lain (overlap, konektivitas, bukaan) tetap berlaku.
  const rejection = findFloorplanActionFeedback(scene, finalActions, instruction, {
    allowFullReset: reset,
  })
  if (rejection.length) return null

  const perFloor = layout.floors
    .filter((f) => usedFloorIds.has(f.id))
    .map((f) => {
      const names = layout.rooms.filter((r) => r.floorId === f.id).map((r) => r.name)
      return `${f.name}: ${names.join(", ")}`
    })
  const doorCount = finalActions.filter(
    (a) => a.type === "addOpening" && (a as { openingType?: string }).openingType === "door"
  ).length
  const totalArea = layout.rooms.reduce((sum, r) => sum + r.areaM2, 0)

  const resetNote = reset
    ? "Denah yang ada saya kosongkan lalu menyusun ulang seluruh ruang sesuai brief.\n\n"
    : ""
  const reply =
    `${resetNote}Denah tersusun dari program ruang di brief — ${layout.rooms.length} ruang di ` +
    `${perFloor.length} lantai, total ±${Math.round(totalArea)} m² pada lahan ` +
    `${project.site.widthM}×${project.site.depthM} m.\n\n` +
    perFloor.map((line) => `• ${line}`).join("\n") +
    `\n\nSetiap ruang sudah diberi pintu penghubung (${doorCount} pintu) agar terjangkau ` +
    `dari dalam rumah, plus jendela untuk ruang yang butuh cahaya dan ventilasi. ` +
    `Silakan langsung geser atau ubah ukurannya di kanvas, atau minta saya menyesuaikan ruang tertentu.`

  return { matched: true, reply, actions: finalActions, reset }
}

/** Nama ruang program untuk pesan, dipakai jalur prompt bila handler ini lewat. */
export function programRoomNames(brief: Brief | null | undefined): string[] {
  const program = brief?.spaceProgram
  if (!Array.isArray(program)) return []
  return program.flatMap((item) => {
    const label = item.name || ROOM_TYPES[item.roomType as RoomType]?.label || item.roomType
    const qty = item.quantity || 1
    return qty > 1 ? Array.from({ length: qty }, (_, i) => `${label} ${i + 1}`) : [label]
  })
}
