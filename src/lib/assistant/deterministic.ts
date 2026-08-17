/**
 * Deterministic intent handlers for the editor AI assistant.
 *
 * These handle common, unambiguous floorplan instructions directly without
 * calling the LLM. They are fast, reliable, and work even when the LLM is
 * unavailable or misconfigured. The LLM remains the fallback for anything
 * not matched here — INCLUDING cases matched here whose safe execution turns
 * out to require real spatial judgment (see "escalation" below).
 *
 * Architect-style spatial checks, not just keyword matching:
 * A room relocation or addition is only ever auto-applied once verified
 * against the destination floor's ACTUAL free space (`findFreeRect`, a
 * bin-packing search over the other rooms already there) — never by blindly
 * copying the room's old coordinates or planting it at a fixed point. Two
 * further architectural preferences feed into that same search:
 *  - Rooms that need daylight/ventilation (`requiresNaturalLight` /
 *    `requiresVentilation`, or a type in LIGHT_ROOM_TYPES/VENT_ROOM_TYPES —
 *    see `needsExteriorAccess`) are only placed against the site boundary,
 *    where an exterior window is actually possible.
 *  - "Wet" rooms (kamar_mandi/dapur/laundry — see `plumbingStackPositions`)
 *    prefer a spot aligned with a same-type room on ANOTHER floor, so their
 *    plumbing shares one vertical riser instead of routing sideways.
 * If no spot satisfies these (the floor is genuinely full, or full of
 * interior-only space for a room that needs a window), that's exactly the
 * situation a professional architect would need to make a judgment call
 * (shrink this room? move that one? accept no exterior wall? reject the
 * request?) — so instead of guessing with a heuristic, these handlers
 * deliberately return `{matched:false}` to ESCALATE to the LLM path, which
 * has the full scene, an explicit system-prompt mandate covering the same
 * preferences, and a propose→simulate→revise self-correction loop to verify
 * the result.
 */
import {
  LIGHT_ROOM_TYPES,
  ROOM_TYPES,
  VENT_ROOM_TYPES,
  WET_ROOM_TYPES,
} from "@/lib/constants";
import { MIN_ROOM, defaultRoomSize } from "@/lib/editor/create";
import { findFreeRect, parseOpeningWall, rectsOverlap, round2, type Rect, type Side } from "@/lib/geometry";
import { generateConnectingDoors } from "@/lib/geometry/connect-rooms";
import { analyzeRoomConnectivity } from "@/lib/geometry/connectivity";
import { freeDoorPosition, sharedWallSpan } from "@/lib/geometry/opening-plan";
import type { Opening, Room, RoomType } from "@/types";
import type { FloorplanAction, FloorplanScene } from "./actions";
import {
  proposeOpenPlanConnection,
  proposeSmallRoomRepair,
  proposeSoakwellRelocation,
} from "./design-strategies";
import { sanitationObstaclesForFloor } from "./spatial-analysis";
import { daylightFixes, roomSizeFixes } from "@/lib/audit/auto-fix";
import { collectSafeFixes } from "@/lib/audit/fix-all";
import { repairConnectivity } from "@/lib/server/connectivity-repair";
import { findConnectivityRegressions } from "@/lib/server/connectivity-guard";

type SceneRoom = FloorplanScene["rooms"][number];

/**
 * Whether a room should be placed against an exterior wall (so it can get a
 * window). An explicit pair of `false` flags on the room itself — the user
 * deliberately unchecked both "perlu cahaya alami" and "perlu ventilasi" in
 * the inspector — is honored even for a type that usually wants one (e.g. a
 * windowless powder room). Otherwise falls back to the same type-based
 * convention used when generating a layout from a brief.
 */
function needsExteriorAccess(
  type: string,
  room?: Pick<SceneRoom, "requiresNaturalLight" | "requiresVentilation">,
): boolean {
  if (room?.requiresNaturalLight || room?.requiresVentilation) return true;
  if (
    room &&
    room.requiresNaturalLight === false &&
    room.requiresVentilation === false
  ) {
    return false;
  }
  return (
    LIGHT_ROOM_TYPES.includes(type as RoomType) ||
    VENT_ROOM_TYPES.includes(type as RoomType)
  );
}

/**
 * For "wet" room types, the (x, y) of same-type rooms already on OTHER
 * floors — tried first (via `findFreeRect`'s `preferredPositions`) so a
 * relocated/new bathroom, kitchen, or laundry keeps sharing a plumbing riser
 * with its counterpart upstairs/downstairs instead of needing a separate
 * horizontal drain run.
 */
function plumbingStackPositions(
  scene: FloorplanScene,
  type: string,
  excludeFloorId: string,
): { x: number; y: number }[] {
  if (!WET_ROOM_TYPES.includes(type as RoomType)) return [];
  return scene.rooms
    .filter((r) => r.type === type && r.floorId !== excludeFloorId)
    .map((r) => ({ x: r.x, y: r.y }));
}

/** Ruang sirkulasi — tempat orang lewat; satu-satunya tetangga yang PANTAS
 *  ditembus pintu untuk ruang dalam baru (kamar yang hanya menempel kamar
 *  privat lain tak bisa diberi pintu tanpa menjadikan ruang privat itu
 *  lintasan — duh, dan gerbang membuang usulannya). */
const CIRCULATION_TYPES = new Set([
  "koridor", "foyer", "ruang_tamu", "ruang_keluarga", "ruang_makan",
]);

/**
 * Posisi kandidat yang menempel dinding dengan ruang SIRKULASI di lantai
 * sasaran (utara/selatan/barat/timur tiap ruang sirkulasi). Ditaruh di
 * `preferredPositions` agar ruang dalam baru TIDAK mendarat di "gap telanjang"
 * yang tak bersentuhan siapa pun — di sana ia lahir tanpa pintu, gerbang
 * membuang seluruh usulan, dan pengguna melihat 0 aksi (kasus nyata: tambah
 * kamar tidur di lantai 2 denah hasil build). Menempel sirkulasi = pintu bisa
 * terpasang = usulan lolos.
 */
function circulationAdjacentPositions(
  scene: FloorplanScene,
  size: { width: number; depth: number },
  floorId: string,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const w = size.width;
  const d = size.depth;
  for (const room of scene.rooms) {
    if (room.floorId !== floorId || !CIRCULATION_TYPES.has(room.type)) continue;
    out.push({ x: round2(room.x + room.width), y: round2(room.y) }); // timur
    out.push({ x: round2(Math.max(0, room.x - w)), y: round2(room.y) }); // barat
    out.push({ x: round2(room.x), y: round2(room.y + room.depth) }); // selatan
    out.push({ x: round2(room.x), y: round2(Math.max(0, room.y - d)) }); // utara
  }
  return out;
}

/** `["a"] -> "a"`, `["a","b"] -> "a dan b"`, `["a","b","c"] -> "a, b, dan c"`. */
function joinBahasa(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return parts.join(" dan ");
  return `${parts.slice(0, -1).join(", ")}, dan ${parts[parts.length - 1]}`;
}

/** True when `pos` matches one of the plumbing-stack candidates (used only
 *  to decide whether the reply should mention it — the placement itself
 *  already came from `findFreeRect`). */
function isStackedPosition(
  pos: { x: number; y: number },
  candidates: { x: number; y: number }[],
): boolean {
  return candidates.some(
    (c) => Math.abs(c.x - pos.x) < 0.01 && Math.abs(c.y - pos.y) < 0.01,
  );
}

export type DeterministicResult =
  | { matched: false }
  | { matched: true; reply: string; actions: FloorplanAction[] };

const MOVE_KEYWORDS = [
  "pindah",
  "pindahkan",
  "pindahin",
  "geser",
  "geserkan",
  "pindahin",
  "alihkan",
];

const ADD_KEYWORDS = ["tambah", "tambahkan", "buat", "bikin", "buatkan"];
const DELETE_KEYWORDS = ["hapus", "hapuskan", "buang", "delete", "hilangkan"];

const ROOM_TYPE_ALIASES: Record<string, string[]> = {
  kamar_tidur: ["kamar tidur", "kt", "bedroom"],
  kamar_mandi: ["kamar mandi", "km", "wc", "toilet", "bathroom", "mandi"],
  ruang_tamu: ["ruang tamu", "rt", "living room", "living"],
  ruang_keluarga: ["ruang keluarga", "keluarga", "family room"],
  dapur: ["dapur", "kitchen"],
  ruang_makan: ["ruang makan", "makan", "dining"],
  musholla: ["musholla", "mushola", "sholat", "prayer"],
  laundry: ["laundry", "cuci"],
  gudang: ["gudang", "storage"],
  balkon: ["balkon", "balcony"],
  rooftop_lounge: ["rooftop lounge", "rooftop"],
  area_kumpul: ["area kumpul", "kumpul"],
  kolam: ["kolam", "pool"],
  taman: ["taman", "garden"],
  workspace: ["workspace", "kantor", "office", "kerja"],
  carport: ["carport", "parkir", "garasi"],
  void: ["void"],
  tangga: ["tangga", "stairs"],
};

const OPENING_ALIASES: Record<string, "door" | "window"> = {
  pintu: "door",
  jendela: "window",
  kusen: "window",
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findRoomType(text: string): string | null {
  const norm = normalize(text);
  for (const [type, aliases] of Object.entries(ROOM_TYPE_ALIASES)) {
    for (const alias of aliases) {
      if (norm.includes(alias)) return type;
    }
  }
  return null;
}

function findRoomTypes(text: string): string[] {
  const norm = normalize(text);
  const found: string[] = [];
  for (const [type, aliases] of Object.entries(ROOM_TYPE_ALIASES)) {
    if (aliases.some((alias) => norm.includes(alias)) && !found.includes(type)) {
      found.push(type);
    }
  }
  return found;
}

function findFloorNumber(text: string): number | null {
  const match = text.match(/lantai\s+(\d+)/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

function findFloorIdByNumber(scene: FloorplanScene, n: number): string | null {
  // Prefer floor whose level matches; fall back to name contains "Lantai N".
  const byLevel = scene.floors.find((f) => f.level === n);
  if (byLevel) return byLevel.id;
  const byName = scene.floors.find((f) =>
    normalize(f.name).includes(`lantai ${n}`),
  );
  return byName?.id ?? null;
}

function findRoomOnFloor(
  scene: FloorplanScene,
  type: string,
  floorId: string,
  ordinal?: number,
): { id: string; name: string } | null {
  const matches = scene.rooms.filter(
    (r) => r.type === type && r.floorId === floorId,
  );
  if (matches.length === 0) return null;
  if (ordinal != null && ordinal > 0 && ordinal <= matches.length) {
    return { id: matches[ordinal - 1].id, name: matches[ordinal - 1].name };
  }
  return { id: matches[0].id, name: matches[0].name };
}

function extractOrdinal(text: string): number | null {
  const match = text.match(
    /(?:\s|^)(satu|dua|tiga|empat|lima|1|2|3|4|5)(?:\s|$)/i,
  );
  if (!match) return null;
  const word = match[1].toLowerCase();
  const map: Record<string, number> = {
    satu: 1,
    dua: 2,
    tiga: 3,
    empat: 4,
    lima: 5,
  };
  return map[word] ?? parseInt(word, 10);
}

/**
 * Try to match subjective "this room is in the wrong spot" requests where
 * the user complains about a room's POSITION on its current floor (no
 * floor change) — e.g. "kamar mandi di tengah dapur & ruang keluarga, pindah
 * biar lebih clean" or "kamar tidur pojok ini kurang pas, geser ke belakang".
 *
 * The original `matchMoveRoomToFloor` strictly requires TWO explicit floor
 * numbers (source + target). This was too strict: when the user says "lantai
 * 1" once, talking about WHY a position is bad, the request is actually
 * "reposition this room on the SAME floor to a less-bad spot" — moving it
 * to ANOTHER floor would not address their concern. The LLM fallback then
 * had to guess, and it often produced a low-confidence empty action set
 * (the FALLBACK reply "Asisten AI belum berhasil memproses…"). Resolving it
 * here keeps the credit cost at 0 and turns a known-bad UX into a
 * verifiable one.
 *
 * Strategy: when there's exactly ONE floor mentioned, treat the
 * mentioned type on that floor as the candidate to relocate, then call the
 * same `relocateRoomOnFloor` we use for `matchFixOverlaps` — the architectural
 * preferences (exterior access, plumbing stacking, sanitation obstacles) all
 * carry over. We only relocate onto the SAME floor as the source so we never
 * accidentally change the floor when the user just wanted a horizontal move.
 */
function matchRepositionRoomOnFloor(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  const norm = normalize(instruction);

  // Subjective-positioning keywords. These signal "this room is in a bad
  // spot" rather than "I want this specific (x, y)" — i.e. the user wants
  // the assistant to PICK a better spot, not the floor-level matchMoveRoom
  // (which requires an explicit target floor).
  const subjectiveHints = [
    "kurang pas",
    "kurang tepat",
    "kurang cocok",
    "posisi",
    "tempat",
    "di tengah",
    "menghalangi",
    "mengganggu",
    "menganggu",
    "membersihkan",
    "clean",
    "lebih elok",
    "lebih bagus",
    "lebih baik",
    "harusnya",
    "seharusnya",
  ];
  const hasSubjectiveHint = subjectiveHints.some((k) => norm.includes(k));
  if (!hasSubjectiveHint) return { matched: false };

  // Only fire when the user mentions EXACTLY ONE floor number — that's the
  // signature of "the room on this floor, not the one upstairs" rather
  // than "move between two floors" (which matchMoveRoomToFloor handles).
  const floorNumbers = [...norm.matchAll(/lantai\s+(\d+)/g)].map((m) =>
    parseInt(m[1], 10),
  );
  if (floorNumbers.length !== 1) return { matched: false };

  // Subjective repositions are also typically expressed with a MOVE-style
  // verb. If the user only describes the problem without any movement
  // intent ("kamar mandi di tengah dapur"), we still treat the description
  // as a request — the MOVE_KEYWORDS filter is there to AVOID colliding with
  // a totally different intent (e.g. "berapa biaya bangun dapur?"), so we
  // require a move verb OR a room-type mention (the latter is the most
  // common phrasing: "[room type] di [bad location]").
  const type = findRoomType(instruction);
  if (!type) return { matched: false };
  const hasMoveIntent = MOVE_KEYWORDS.some((k) => norm.includes(k));
  if (!hasMoveIntent && !norm.includes(type.replace(/_/g, " "))) {
    // Still allow if the room type's plain label is mentioned with a
    // subjective hint, which is the most common phrasing for "this room is
    // badly placed" complaints.
    const typeLabel = ROOM_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
    if (!norm.includes(typeLabel)) return { matched: false };
  }

  const floorN = floorNumbers[0];
  const floorId = findFloorIdByNumber(scene, floorN);
  if (!floorId) return { matched: false };

  const ordinal = extractOrdinal(instruction);
  const roomRef = findRoomOnFloor(scene, type, floorId, ordinal ?? undefined);
  if (!roomRef) return { matched: false };
  const room = scene.rooms.find((r) => r.id === roomRef.id);
  if (!room) return { matched: false };

  // Same call as matchFixOverlaps — same exterior/plumbing/sanitation
  // preferences, so the architectural contract is identical.
  const pos = relocateRoomOnFloor(room, floorId, scene.rooms, scene);
  if (!pos) {
    // No free spot at all on this floor — escalate to the LLM (which has
    // the full scene + system prompt to reason about shrinking other
    // rooms, suggesting a different floor, etc.).
    return { matched: false };
  }

  // No-op: the chosen "better" spot is the room's current position. That's
  // the assistant agreeing with the user that the room is already well
  // placed. Tell the user explicitly rather than silently returning a no-op
  // (which would be confusing: the user reported a problem and got back
  // "no changes" with no explanation).
  if (round2(pos.x) === round2(room.x) && round2(pos.y) === round2(room.y)) {
    return {
      matched: true,
      reply: `Saya periksa posisi ${room.name} di ${scene.floors.find((f) => f.id === floorId)?.name ?? `Lantai ${floorN}`} — belum ada spot kosong lain yang lebih baik di lantai ini (semua sudut sudah dipakai atau terhalang sanitasi). Mau saya coba pindahkan ke lantai lain?`,
      actions: [],
    };
  }

  const sanitationRects = sanitationObstaclesForFloor(scene, floorId);
  const notes: string[] = [];
  if (sanitationRects.length > 0) {
    notes.push("tidak bertumpuk dengan ruang atau instalasi sanitasi lain");
  } else {
    notes.push("tidak bertumpuk dengan ruang lain");
  }
  if (needsExteriorAccess(type, room)) {
    notes.push("tetap di tepi lahan supaya bisa dapat jendela/cahaya alami");
  }
  if (isStackedPosition(pos, plumbingStackPositions(scene, type, floorId))) {
    notes.push(
      `sejalur pipa dengan ${ROOM_TYPE_LABELS[type] ?? type} di lantai lain`,
    );
  }

  // Menggeser ruang meninggalkan pintunya di posisi lama — sambungkan ulang,
  // atau serahkan ke LLM bila di posisi baru tak bisa disambung sama sekali.
  const reconnect = reconnectAfterMove(scene, room.id, { x: pos.x, y: pos.y });
  if (reconnect === null) return { matched: false };

  return {
    matched: true,
    reply: `Oke, saya geser posisi ${room.name} di ${scene.floors.find((f) => f.id === floorId)?.name ?? `Lantai ${floorN}`} ke area yang lebih longgar — sudah dicek, ${joinBahasa(notes)}. Klik Terapkan untuk menyimpan perubahan.`,
    actions: [
      { type: "updateRoom", roomId: room.id, patch: { x: pos.x, y: pos.y } },
      ...reconnect,
    ],
  };
}

/** Try to match "pindahkan [N] [tipe ruang] dari lantai X ke lantai Y". */
/**
 * Bukaan scene → bentuk domain `Opening`.
 *
 * Scene editor menyimpan bukaan sebagai {roomId, side}; solver geometri bekerja
 * dengan `wallId` gabungan. Tanpa konversi ini `parseOpeningWall` menerima
 * undefined dan solver melempar — dan yang lebih halus: bukaan lama jadi tak
 * terlihat, sehingga pintu baru bisa ditaruh menimpanya.
 */
/**
 * Pintu pengganti untuk ruang yang BARU DIPINDAH/DIGESER.
 *
 * Pintu sebuah ruang menyambung ke tetangga di posisi LAMA. Begitu ruangnya
 * bergerak, pintu itu menggantung: ruang lahir terkurung, gerbang konektivitas
 * membuang SELURUH usulan, dan pengguna menerima 0 aksi tanpa penjelasan. Ini
 * cacat yang sama yang muncul tiga kali (tambah ruang, pindah lantai, geser
 * dalam lantai), jadi disatukan di sini.
 *
 * Mengembalikan null bila ruang itu TADINYA berpintu tapi di posisi baru tak
 * bisa disambungkan sama sekali — penanda bahwa usulan ini akan ditolak gerbang
 * dan sebaiknya diserahkan ke LLM (yang bisa menata ulang tetangganya lebih
 * dulu), bukan dipaksakan.
 */
function reconnectAfterMove(
  scene: FloorplanScene,
  roomId: string,
  moved: { floorId?: string; x: number; y: number },
): FloorplanAction[] | null {
  const rooms = (scene.rooms as unknown as Room[]).map((r) =>
    r.id === roomId
      ? { ...r, floorId: moved.floorId ?? r.floorId, x: moved.x, y: moved.y }
      : r,
  );
  const kept = toDomainOpenings(scene).filter(
    (o) => parseOpeningWall(o.wallId)?.roomId !== roomId,
  );
  const doors = generateConnectingDoors(
    rooms,
    kept,
    scene.floors.map((f) => ({ id: f.id, level: f.level })),
  ).filter((d) => parseOpeningWall(d.wallId)?.roomId === roomId);

  if (!doors.length) {
    const hadDoor = toDomainOpenings(scene).some(
      (o) => o.type === "door" && parseOpeningWall(o.wallId)?.roomId === roomId,
    );
    return hadDoor ? null : [];
  }
  return doors.map((d) => {
    const parsed = parseOpeningWall(d.wallId)!;
    return {
      type: "addOpening" as const,
      roomId: parsed.roomId,
      side: parsed.side,
      positionM: d.positionM,
      openingType: "door" as const,
    };
  });
}

/**
 * Bukaan scene → bentuk domain `Opening`.
 *
 * Scene editor menyimpan bukaan sebagai {roomId, side}; solver geometri bekerja
 * dengan `wallId` gabungan. Tanpa konversi ini `parseOpeningWall` menerima
 * undefined dan solver melempar — dan yang lebih halus: bukaan lama jadi tak
 * terlihat, sehingga pintu baru bisa ditaruh menimpanya.
 */
function toDomainOpenings(scene: FloorplanScene): Opening[] {
  const floorOf = new Map(
    (scene.rooms as unknown as Room[]).map((r) => [r.id, r.floorId]),
  );
  return (
    scene.openings as unknown as Array<{
      id: string; roomId?: string; side?: string; wallId?: string;
      type: string; positionM: number; widthM?: number; heightM?: number;
    }>
  ).flatMap((o) => {
    const wallId = o.wallId ?? (o.roomId && o.side ? `${o.roomId}:${o.side}` : null);
    if (!wallId) return [];
    const host = parseOpeningWall(wallId)?.roomId;
    return [
      {
        id: o.id,
        floorId: (host && floorOf.get(host)) || "",
        wallId,
        type: o.type,
        positionM: o.positionM,
        widthM: o.widthM ?? 0.9,
        heightM: o.heightM ?? 2.1,
      } as Opening,
    ];
  });
}

function matchMoveRoomToFloor(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  const norm = normalize(instruction);
  if (!MOVE_KEYWORDS.some((k) => norm.includes(k))) return { matched: false };

  const type = findRoomType(instruction);
  if (!type) return { matched: false };

  // Floor numbers mentioned by the user. Two means both source and target were
  // spelled out ("pindahkan kamar mandi DARI lantai 1 KE lantai 2").
  const floors = [...instruction.matchAll(/lantai\s+(\d+)/gi)].map((m) =>
    parseInt(m[1], 10),
  );

  // ONE floor number + a move verb means the user named only the DESTINATION
  // ("pindahkan laundry ke lantai 1") — the phrasing people actually use. The
  // source is not missing information: the scene already knows which floor the
  // room sits on. Demanding the user restate it is the same failure as asking
  // for a room list that's already in the brief; infer it when exactly one
  // room of that type exists outside the destination floor.
  if (floors.length === 1) {
    const targetId = findFloorIdByNumber(scene, floors[0]);
    if (!targetId) return { matched: false };
    const candidates = scene.rooms.filter(
      (r) => r.type === type && r.floorId !== targetId,
    );
    // Ambiguous (several such rooms on different floors) — let the LLM ask.
    if (candidates.length !== 1) return { matched: false };
    const sourceFloor = scene.floors.find((f) => f.id === candidates[0].floorId);
    // `findFloorIdByNumber` resolves a spoken number against `level`, so the
    // inferred source must be expressed the same way — deriving it by counting
    // floors would silently disagree whenever levels aren't 1..n (rooftop).
    if (sourceFloor?.level == null) return { matched: false };
    floors.unshift(sourceFloor.level);
  }

  // We need both source and target floors — stated or inferred above.
  if (floors.length < 2) return { matched: false };

  const [sourceN, targetN] = floors;
  const sourceId = findFloorIdByNumber(scene, sourceN);
  const targetId = findFloorIdByNumber(scene, targetN);
  if (!sourceId || !targetId) {
    return {
      matched: true,
      reply: `Maaf, tidak menemukan lantai ${sourceId ? targetN : sourceN} di denah.`,
      actions: [],
    };
  }

  const ordinal = extractOrdinal(instruction);
  const roomRef = findRoomOnFloor(scene, type, sourceId, ordinal ?? undefined);
  if (!roomRef) {
    return {
      matched: true,
      reply: `Tidak menemukan ${ROOM_TYPE_LABELS[type] ?? type} di lantai ${sourceN}.`,
      actions: [],
    };
  }
  const room = scene.rooms.find((r) => r.id === roomRef.id);
  if (!room) return { matched: false };

  // Never blindly carry the room's old (x, y) onto the new floor — that's
  // the exact bug this handler exists to prevent: those coordinates are
  // meaningful on the SOURCE floor and mean nothing on the destination one,
  // so reusing them can (and did, in production) drop the room on top of
  // whatever already occupies that spot there. Verify real free space first
  // — preferring a plumbing-stacked spot, and requiring an exterior wall if
  // this room needs daylight/ventilation.
  const requireExterior = needsExteriorAccess(type, room);
  const preferredPositions = plumbingStackPositions(scene, type, targetId);
  const sanitationRects = sanitationObstaclesForFloor(scene, targetId);
  const obstacles = [
    ...scene.rooms.filter((r) => r.floorId === targetId),
    ...sanitationRects,
  ];
  const pos = findFreeRect(
    { width: room.width, depth: room.depth },
    obstacles,
    scene.site,
    { requireExterior, preferredPositions },
  );
  if (!pos) {
    // No spot clears every requirement (no overlap with rooms OR sanitation;
    // exterior wall if this room needs one). Deciding what to shrink/
    // rearrange — or whether to accept a compromise — is a real design
    // trade-off, not a pattern match — hand off to the LLM (system prompt
    // covers the same preferences) instead of forcing an overlap or a
    // windowless room.
    return { matched: false };
  }

  const notes = [
    sanitationRects.length > 0
      ? "tidak bertumpuk dengan ruang atau instalasi sanitasi lain di lantai itu"
      : "tidak bertumpuk dengan ruang lain di lantai itu",
  ];
  if (requireExterior)
    notes.push("tetap di tepi lahan supaya dapat cahaya/ventilasi alami");
  if (isStackedPosition(pos, preferredPositions)) {
    notes.push(
      `sejalur pipa dengan ${ROOM_TYPE_LABELS[type] ?? type} di lantai lain`,
    );
  }

  // Pintu ruang ini menyambung ke tetangganya di lantai ASAL — setelah pindah
  // ia menggantung. Sambungkan ulang; null berarti ruang ini tadinya berpintu
  // tapi di lantai tujuan tak bisa disambung sama sekali (regresi), jadi
  // serahkan ke LLM yang bisa menata ulang ukuran/tetangganya lebih dulu.
  const reconnect = reconnectAfterMove(scene, room.id, {
    floorId: targetId,
    x: pos.x,
    y: pos.y,
  });
  if (reconnect === null) return { matched: false };

  return {
    matched: true,
    reply: `Oke, saya pindahkan ${room.name} dari Lantai ${sourceN} ke Lantai ${targetN} — sudah dicek, ${joinBahasa(notes)}. Klik Terapkan untuk menyimpan perubahan.`,
    actions: [
      {
        type: "updateRoom",
        roomId: room.id,
        patch: { floorId: targetId, x: pos.x, y: pos.y },
      },
      ...reconnect,
    ],
  };
}

/** Try to match "tambah [tipe ruang]". */
function matchAddRoom(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  const norm = normalize(instruction);
  if (!ADD_KEYWORDS.some((k) => norm.includes(k))) return { matched: false };

  const type = findRoomType(instruction);
  if (!type) return { matched: false };
  const roomType = type as import("@/types").RoomType;

  // Lantai tujuan: hormati nomor lantai yang DISEBUT pengguna ("tambah gudang
  // di lantai 1"), bukan sekadar lantai yang sedang dilihat — kalau tidak,
  // ruangnya jatuh ke lantai lain dan guard menolak seluruh usulan.
  const spokenFloor = instruction.match(/lantai\s+(\d+)/i);
  const spokenFloorId = spokenFloor
    ? findFloorIdByNumber(scene, parseInt(spokenFloor[1], 10))
    : null;
  if (spokenFloor && !spokenFloorId) return { matched: false };
  const activeFloorId = spokenFloorId ?? scene.selectedFloorId ?? scene.floors[0]?.id ?? null;
  if (!activeFloorId) return { matched: false };

  // Same rule as moving a room: never plant a new room at a fixed point
  // (the old code used the site's center, which happily overlapped whatever
  // was already there) — verify real free space at the room's default size
  // first (preferring a plumbing-stacked spot, requiring an exterior wall if
  // this type needs daylight/ventilation), and hand off to the LLM if the
  // active floor can't satisfy that (it may need to shrink/rearrange
  // something else to make space).
  const requireExterior = needsExteriorAccess(roomType);
  const size = defaultRoomSize(roomType);
  // Plumbing-stack dulu (kamar basah sejajar riser vertikal), lalu posisi yang
  // menempel ruang sirkulasi — supaya ruang dalam baru dapat pintu dan usulan
  // LOLOS gerbang, bukan mendarat di gap tanpa pintu lalu dibuang (0 aksi di
  // layar). findFreeRect mencobanya berurutan; yang tak muat di-skip diam-diam.
  // `plumbingCandidates` dipisah untuk isStackedPosition: penempatan yang
  // menempel sirkulasi bukan berarti "sejalur pipa dengan lantai lain".
  const plumbingCandidates = plumbingStackPositions(scene, roomType, activeFloorId);
  const preferredPositions = [
    ...plumbingCandidates,
    ...circulationAdjacentPositions(scene, size, activeFloorId),
  ];
  const sanitationRects = sanitationObstaclesForFloor(scene, activeFloorId);
  const obstacles = [
    ...scene.rooms.filter((r) => r.floorId === activeFloorId),
    ...sanitationRects,
  ];
  const pos = findFreeRect(size, obstacles, scene.site, {
    requireExterior,
    preferredPositions,
  });
  if (!pos) return { matched: false };

  const notes: string[] = [];
  if (isStackedPosition(pos, plumbingCandidates)) {
    notes.push(
      `sejalur pipa dengan ${ROOM_TYPE_LABELS[type] ?? type} di lantai lain`,
    );
  }
  if (requireExterior)
    notes.push("menempel tepi lahan agar dapat cahaya/ventilasi alami");
  const placement = notes.length
    ? joinBahasa(notes)
    : "di area kosong pada lantai aktif";

  // Ruang baru WAJIB punya pintu — tanpa itu ia lahir terkurung dan gerbang
  // konektivitas membuang seluruh usulan (pengguna melihat 0 aksi). Solver
  // `generateConnectingDoors` sudah tahu tetangga mana yang pantas ditembus,
  // jadi pakai itu alih-alih menebak sisi dinding sendiri.
  //
  // Id ruang baru belum ada saat aksi disusun; pra-cek server
  // (`simulateFloorplanActions`) menamainya `new-<jumlah ruang saat ini>`,
  // jadi bukaan harus merujuk id itu agar tidak jatuh ke ruang yang tak pernah
  // ada — pelajaran dari pembangun denah awal.
  const newId = `new-${scene.rooms.length}`;
  const simulatedRooms = [
    ...(scene.rooms as unknown as Room[]),
    {
      id: newId,
      floorId: activeFloorId,
      name: ROOM_TYPE_LABELS[type] ?? type,
      type: roomType,
      x: pos.x,
      y: pos.y,
      width: size.width,
      depth: size.depth,
      areaM2: round2(size.width * size.depth),
    } as Room,
  ];
  const existingOpenings = toDomainOpenings(scene);
  const doors = generateConnectingDoors(
    simulatedRooms,
    existingOpenings,
    scene.floors.map((f) => ({ id: f.id, level: f.level })),
  ).filter((d) => d.wallId.startsWith(`${newId}:`));

  // Ruang baru yang BERSENTUHAN dinding dengan ruang dalam lain wajib diberi
  // pintu — kalau tidak ia lahir terkurung, gerbang konektivitas membuang
  // seluruh usulan, dan pengguna menerima 0 aksi tanpa penjelasan.
  //
  // Yang TIDAK dituntut: ruang yang berdiri sendiri tanpa tetangga bersentuhan
  // (ruang pertama di lantai, atau petak yang kebetulan renggang). Di situ
  // memang belum ada dinding bersama untuk dipasangi pintu, dan menolaknya
  // hanya membuang penempatan yang sebenarnya sah.
  const touchesIndoorNeighbour = (scene.rooms as unknown as Room[]).some((r) => {
    if (r.floorId !== activeFloorId || ROOM_TYPES[r.type]?.outdoor) return false
    const candidate = { x: pos.x, y: pos.y, width: size.width, depth: size.depth }
    return (["n", "e", "s", "w"] as Side[]).some((side) => sharedWallSpan(candidate as never, side, r))
  });

  // Invariant: lantai yang SUDAH punya ruang dalam lain, ruang dalam BARU wajib
  // mendapat pintu penghubung. Petak "gap telanjang" yang tak bersentuhan dinding
  // dengan ruang mana pun lahir terkurung dan gerbang membuang SELURUH usulan →
  // pengguna melihat 0 aksi (kasus nyata: tambah kamar tidur di lantai 2 denah
  // hasil build — kamar ditaruh di gap tanpa pintu). Yang dikecualikan hanya
  // lantai yang masih KOSONG dari ruang dalam (ruang pertama — memang belum ada
  // dinding bersama untuk dipasangi pintu).
  const floorAlreadyHasIndoor = (scene.rooms as unknown as Room[]).some(
    (r) => r.floorId === activeFloorId && !ROOM_TYPES[r.type]?.outdoor,
  );
  if (!doors.length && (touchesIndoorNeighbour || floorAlreadyHasIndoor)) {
    return { matched: false };
  }

  const floorLabel = scene.floors.find((f) => f.id === activeFloorId)?.name ?? "lantai aktif";
  const actions: FloorplanAction[] = [
    { type: "addRoom", roomType, floorId: activeFloorId, x: pos.x, y: pos.y, width: size.width, depth: size.depth },
    ...doors.map((d) => {
      const parsed = parseOpeningWall(d.wallId)!;
      return {
        type: "addOpening" as const,
        roomId: parsed.roomId,
        side: parsed.side,
        positionM: d.positionM,
        openingType: "door" as const,
      };
    }),
  ];

  return {
    matched: true,
    reply:
      `Oke, saya tambahkan ${ROOM_TYPE_LABELS[type] ?? type} (±${Math.round(size.width * size.depth)} m²) ` +
      `di ${floorLabel}, ${placement}, lengkap dengan pintu penghubung ke dalam rumah. ` +
      `Klik Terapkan untuk menyimpan perubahan.`,
    actions,
  };
}

/** Try to match "hapus [tipe ruang] (di lantai X)". */
function matchDeleteRoom(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  const norm = normalize(instruction);
  if (!DELETE_KEYWORDS.some((k) => norm.includes(k))) return { matched: false };

  const type = findRoomType(instruction);
  if (!type) return { matched: false };

  let floorId: string | null = null;
  const floorN = findFloorNumber(instruction);
  if (floorN != null) floorId = findFloorIdByNumber(scene, floorN);

  const rooms = scene.rooms.filter(
    (r) => r.type === type && (floorId == null || r.floorId === floorId),
  );
  if (rooms.length === 0) {
    return {
      matched: true,
      reply: `Tidak menemukan ${ROOM_TYPE_LABELS[type] ?? type} untuk dihapus.`,
      actions: [],
    };
  }

  const deleteAction: FloorplanAction = { type: "deleteRoom", roomId: rooms[0].id };

  // Menghapus ruang bisa memutus pintu satu-satunya tetangga. Kasus nyata di
  // denah hasil build: tangga lantai 1 hanya bisa dimasuki lewat Dapur —
  // menghapus Dapur mengisolasi tangga, gerbang lalu MEMBUANG seluruh usulan
  // dan pengguna melihat 0 aksi. Sambungkan ulang tetangga yang kehilangan
  // akses dengan solver yang sama seperti saat menambah/memindah ruang.
  //
  // Yang diukur adalah REGRESI (ruang yang tadinya terjangkau jadi terputus),
  // bukan "masih ada ruang tanpa pintu" — denah yang sejak awal tak berpintu
  // (mis. denah yang sedang dikerjakan) bukan salah aksi hapus ini. Bila
  // penghapusan menuntut koridor/redesain (tetap regresi), serahkan ke LLM —
  // jangan sanggup memutus konektivitas rumah.
  const repaired = repairConnectivity(scene, [deleteAction]);
  const addedCorridor = repaired.actions.some(
    (a): a is Extract<FloorplanAction, { type: "addRoom" }> =>
      a.type === "addRoom" && a.roomType === "koridor",
  );
  if (addedCorridor) {
    return { matched: false };
  }
  const regressions = findConnectivityRegressions(scene, repaired.actions);
  if (regressions.length) {
    // Menghapus ruang ini akan mengisolasi ruang lain (kasus nyata: tangga
    // lantai 1 hanya bisa dimasuki lewat Dapur — menghapus Dapur memutus
    // aksesnya dan tak ada tetangga lain untuk disambungkan). Alih-alih diam-
    // diam menyerah ke LLM (yang mungkin balasan acak) atau mengirim usulan
    // yang dibuang gerbang (0 aksi di layar tanpa penjelasan), tolak dengan
    // alasan JELAS agar pengguna tahu keputusan desain apa yang harus dibuat.
    return {
      matched: true,
      reply: `Maaf, saya tidak bisa menghapus ${rooms[0].name}: ${regressions[0]}`,
      actions: [],
    };
  }

  return {
    matched: true,
    reply: `Oke, saya hapus ${rooms[0].name}. Klik Terapkan untuk menyimpan perubahan.`,
    actions: repaired.actions,
  };
}

/** Try to match the one-shot "perbaiki semua" / "buat sesuai standar" request —
 *  the layperson's "just fix everything you safely can". Applies every safe
 *  standards fix at once (enlarge undersized rooms, add daylight windows,
 *  relocate a misplaced soakwell), derived sequentially so the actions never
 *  conflict. Runs FIRST so a broad request isn't captured by a single-category
 *  matcher. */
function matchFixAll(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  const norm = normalize(instruction);
  const fixVerb =
    norm.includes("perbaiki") || norm.includes("benahi") || norm.includes("rapikan") || norm.includes("rapihkan");
  const scopeAll =
    norm.includes("semua") ||
    norm.includes("semuanya") ||
    norm.includes("sesuai standar") ||
    norm.includes("sesuai sni") ||
    norm.includes("sesuaikan standar");
  const buatSesuai = norm.includes("buat") && (norm.includes("sesuai standar") || norm.includes("sesuai sni"));
  // Require BOTH a fix verb and an all/standards scope, so "perbaiki cahaya"
  // (single category) still routes to its own handler.
  if (!buatSesuai && !(fixVerb && scopeAll)) return { matched: false };
  // A category word makes it a single-category request, not "fix everything".
  if (
    norm.includes("cahaya") ||
    norm.includes("jendela") ||
    norm.includes("ventilasi") ||
    norm.includes("sanitasi") ||
    norm.includes("resapan") ||
    norm.includes("ukuran") ||
    norm.includes("tumpang") ||
    norm.includes("tumpuk")
  ) {
    return { matched: false };
  }

  const result = collectSafeFixes(scene);
  if (result.actions.length === 0) {
    const anyBlocked = result.blocked.rooms.length > 0 || result.blocked.windowsLandlocked.length > 0;
    return {
      matched: true,
      reply: anyBlocked
        ? "Saya sudah mencoba termasuk menata ulang (menggeser/memperkecil tetangga), tapi ruang yang bermasalah tetap tidak muat — ruang di sekitarnya sudah berada di batas minimum standarnya masing-masing. Perbaikannya butuh perombakan besar: pindahkan salah satu ruang ke lantai lain, atau perbesar footprint bangunan."
        : "Denah sudah memenuhi standar dasar yang bisa saya perbaiki otomatis (ukuran ruang, cahaya, sanitasi). Tidak ada yang perlu diubah.",
      actions: [],
    };
  }

  const parts: string[] = [];
  if (result.applied.rooms > 0) parts.push(`${result.applied.rooms} ruang diperbesar ke ukuran minimum SNI`);
  if (result.reflowed.length > 0) {
    const detail = result.reflowed
      .map((f) => `${f.roomName}${f.movedNeighbors.length ? ` (menggeser ${f.movedNeighbors.join(" & ")})` : ""}`)
      .join(", ");
    parts.push(`${result.reflowed.length} ruang ditata ulang: ${detail}`);
  }
  if (result.applied.windows > 0) parts.push(`${result.applied.windows} jendela ditambahkan`);
  if (result.applied.soakwell > 0) parts.push(`sumur resapan dipindah ke tanah terbuka`);
  const blockedNames = [...new Set([...result.blocked.rooms, ...result.blocked.windowsLandlocked])];
  const blockedNote =
    blockedNames.length > 0
      ? ` Yang benar-benar tidak muat tanpa merombak besar: ${blockedNames.join(", ")} — tetangganya sudah di batas minimum standar masing-masing, jadi saya tidak memaksakannya.`
      : "";
  return {
    matched: true,
    reply: `Saya perbaiki sekaligus sesuai standar: ${parts.join(", ")}. Klik Terapkan untuk menyimpan semua perubahan.${blockedNote}`,
    actions: result.actions,
  };
}

/** Try to match a batch room-size fix: "perbaiki ukuran ruang", "perbesar
 *  ruang yang kecil", "perbaiki peringatan ukuran". Enlarges every room below
 *  its per-type SNI minimum area into adjacent free space (verify-safe, never
 *  overlapping). The actionable counterpart to the audit's "lebih kecil dari
 *  standar" findings. Distinct from matchRepairSmallRoomWarning (which targets
 *  the 4 m² usable floor on "terlalu kecil" phrasing); this targets full SNI
 *  per-type minimums on "perbaiki ukuran / perbesar ruang" phrasing. */
function matchFixRoomSize(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  const norm = normalize(instruction);
  // Batch SNI-size intent: "perbaiki/sesuaikan UKURAN/LUAS ..." or an explicit
  // batch "perbesar SEMUA/… ruang KECIL". A bare "perbesar kamar" is a single
  // subjective resize — leave that to the LLM, don't intercept it here.
  const fixVerb = norm.includes("perbaiki") || norm.includes("sesuaikan");
  const sizeNoun = norm.includes("ukuran") || norm.includes("luas");
  const batchPerbesar = norm.includes("perbesar") && (norm.includes("semua") || norm.includes("kecil"));
  if (!((fixVerb && sizeNoun) || batchPerbesar)) return { matched: false };
  // Don't hijack the "terlalu kecil" warning phrasing — that's the existing
  // matchRepairSmallRoomWarning's job (runs earlier in the chain anyway).
  if (norm.includes("terlalu kecil") || norm.includes("cukup kecil")) return { matched: false };

  const { fixes, blocked } = roomSizeFixes(scene);
  if (fixes.length === 0) {
    const reply =
      blocked.length > 0
        ? `Ruang yang di bawah ukuran standar (${blocked
            .map((r) => r.name)
            .join(", ")}) belum bisa saya perbesar tanpa menggeser ruang lain — sekelilingnya sudah terisi. Sebutkan ruang tetangga mana yang boleh saya geser/perkecil.`
        : "Semua ruang sudah memenuhi ukuran minimum standar SNI. Tidak ada yang perlu diperbesar.";
    return { matched: true, reply, actions: [] };
  }

  const names = fixes.map((f) => `${f.roomName} (${f.fromAreaM2}→${f.toAreaM2} m²)`).join(", ");
  const blockedNote =
    blocked.length > 0
      ? ` ${blocked.map((r) => r.name).join(", ")} belum bisa (terkurung ruang lain) — perlu ditata ulang dulu.`
      : "";
  return {
    matched: true,
    reply: `Saya perbesar ${fixes.length} ruang ke ukuran minimum standar SNI 03-1733: ${names}. Klik Terapkan untuk menyimpan.${blockedNote}`,
    actions: fixes.map((f) => f.action),
  };
}

/** Try to match a batch daylight fix: "perbaiki cahaya", "tambahkan jendela ke
 *  semua kamar yang belum punya", "perbaiki peringatan ventilasi/cahaya". Adds
 *  a window on the correct exterior wall of every habitable, windowless room —
 *  the actionable counterpart to the audit's "belum punya jendela" findings.
 *  Runs BEFORE matchAddOpening so a plural/standards phrasing batch-fixes
 *  instead of adding a single window. */
function matchFixDaylight(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  const norm = normalize(instruction);
  const mentionsDaylight =
    norm.includes("cahaya") ||
    norm.includes("ventilasi") ||
    norm.includes("jendela") ||
    norm.includes("pencahayaan");
  if (!mentionsDaylight) return { matched: false };
  const isFixVerb = norm.includes("perbaiki") || norm.includes("tambah") || norm.includes("beri");
  const isBatch =
    norm.includes("semua") ||
    norm.includes("belum punya") ||
    norm.includes("belum ada") ||
    norm.includes("perbaiki cahaya") ||
    norm.includes("perbaiki pencahayaan") ||
    norm.includes("perbaiki ventilasi");
  // "perbaiki cahaya/ventilasi/pencahayaan" is a batch intent on its own; other
  // phrasings need an explicit batch marker ("semua"/"belum punya") so a single
  // "tambah jendela di dapur" still falls through to matchAddOpening.
  const standaloneFix =
    norm.includes("perbaiki cahaya") ||
    norm.includes("perbaiki pencahayaan") ||
    norm.includes("perbaiki ventilasi");
  if (!standaloneFix && !(isFixVerb && isBatch)) return { matched: false };

  const { fixes, landlocked } = daylightFixes(scene);
  if (fixes.length === 0) {
    const reply =
      landlocked.length > 0
        ? `Semua ruang huni yang belum punya jendela (${landlocked
            .map((r) => r.name)
            .join(", ")}) terkurung di tengah tanpa dinding luar, jadi jendela ke luar belum bisa ditambahkan. Perlu menata ulang agar ruang itu menyentuh tepi lahan dulu.`
        : "Semua ruang huni sudah punya jendela. Tidak ada yang perlu diperbaiki untuk pencahayaan.";
    return { matched: true, reply, actions: [] };
  }

  const names = fixes.map((f) => f.roomName).join(", ");
  const landlockedNote =
    landlocked.length > 0
      ? ` ${landlocked.map((r) => r.name).join(", ")} belum bisa (terkurung tanpa dinding luar) — perlu ditata ke tepi lahan dulu.`
      : "";
  return {
    matched: true,
    reply: `Saya tambahkan jendela ke ${fixes.length} ruang yang belum punya (${names}) di dinding luarnya agar memenuhi standar cahaya ≥ 10% luas lantai (SNI 03-6572). Klik Terapkan untuk menyimpan.${landlockedNote}`,
    actions: fixes.map((f) => f.action),
  };
}

/** Try to match "tambah pintu/jendela di [ruang/tipe ruang]". */
function matchAddOpening(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  const norm = normalize(instruction);
  if (!norm.includes("tambah")) return { matched: false };

  let openingType: "door" | "window" | null = null;
  for (const [alias, type] of Object.entries(OPENING_ALIASES)) {
    if (norm.includes(alias)) {
      openingType = type;
      break;
    }
  }
  if (!openingType) return { matched: false };

  const type = findRoomType(instruction);
  const room = type
    ? scene.rooms.find((r) => r.type === type)
    : scene.selectedRoomId
      ? scene.rooms.find((r) => r.id === scene.selectedRoomId)
      : scene.rooms[0];

  if (!room) {
    return {
      matched: true,
      reply: `Tidak menemukan ruang yang cocok untuk menambah ${openingType === "door" ? "pintu" : "jendela"}.`,
      actions: [],
    };
  }

  // Perhitungkan keadaan dinding dulu (dulu: selalu sisi "s" di tengah dinding
  // penuh — bisa menabrak bukaan yang ada atau, utk pintu, jatuh di depan
  // tetangga yang tak dimaksud). Pintu → cari bentang bersama dgn tetangga
  // dalam yang bebas tabrakan; jendela → utamakan sisi dinding LUAR yang bebas.
  const roomsAll = scene.rooms as unknown as Room[];
  const hostRoom = room as unknown as Room;
  const sameFloorAll = roomsAll.filter((r) => r.floorId === room.floorId && r.id !== room.id);
  const refs = scene.openings.map((o) => ({
    id: o.id, roomId: o.roomId, side: o.side as Side,
    positionM: o.positionM, widthM: o.widthM ?? 0.9, type: o.type,
  }));
  const widthM = openingType === "door" ? 0.9 : 1.2;

  let placement: { side: Side; positionM: number; via?: string } | null = null;
  for (const side of ["s", "n", "e", "w"] as Side[]) {
    const neighborsHere = sameFloorAll.filter((r) => sharedWallSpan(hostRoom, side, r));
    if (openingType === "door") {
      for (const nb of neighborsHere) {
        const p = freeDoorPosition(hostRoom, side, nb, widthM, refs, roomsAll);
        if (p != null) { placement = { side, positionM: p, via: nb.name }; break; }
      }
    } else if (neighborsHere.length === 0) {
      // dinding luar — jendela ke ruang lain tidak masuk akal
      const p = freeDoorPosition(hostRoom, side, null, widthM, refs, roomsAll);
      if (p != null) placement = { side, positionM: p };
    }
    if (placement) break;
  }
  // Pintu ke dinding luar sbg cadangan terakhir (mis. ruang tanpa tetangga).
  if (!placement && openingType === "door") {
    for (const side of ["s", "n", "e", "w"] as Side[]) {
      if (sameFloorAll.some((r) => sharedWallSpan(hostRoom, side, r))) continue;
      const p = freeDoorPosition(hostRoom, side, null, widthM, refs, roomsAll);
      if (p != null) { placement = { side, positionM: p }; break; }
    }
  }
  if (!placement) {
    return {
      matched: true,
      reply:
        `Semua dinding ${room.name} sudah penuh bukaan — tidak ada bentang bebas untuk ` +
        `${openingType === "door" ? "pintu" : "jendela"} baru tanpa menabrak yang ada. ` +
        `Geser bukaan yang ada dulu, atau tunjukkan dinding mana yang Anda maksud.`,
      actions: [],
    };
  }

  return {
    matched: true,
    reply:
      `Oke, saya tambahkan ${openingType === "door" ? "pintu" : "jendela"} di ${room.name}` +
      (placement.via ? ` pada dinding yang berbatasan dengan ${placement.via}` : " pada dinding luar") +
      ` — posisinya sudah dicek tidak menabrak bukaan lain. Klik Terapkan untuk menyimpan perubahan.`,
    actions: [
      {
        type: "addOpening",
        roomId: room.id,
        side: placement.side,
        positionM: placement.positionM,
        openingType,
      },
    ],
  };
}

/** Try to match warning/context text like:
 *  "Peringatan: Sumur resapan di bawah Ruang keluarga ... pindahkan ke
 *  taman/halaman." This should never need LLM guessing: the scene already
 *  contains the soakwell dimensions and all room obstacles, so we can propose
 *  the exact `moveSanitationObject` action or explain that no open ground
 *  exists. */
function matchMoveSoakwellFromWarning(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  const norm = normalize(instruction);
  const mentionsSoakwell =
    norm.includes("sumur resapan") ||
    norm.includes("soakwell") ||
    norm.includes("resapan") ||
    // Audit-driven phrasing: "perbaiki sanitasi" — the soakwell-under-room
    // finding is the only critical, deterministically-fixable sanitation
    // issue, so a generic sanitation-fix request routes here.
    norm.includes("sanitasi");
  if (!mentionsSoakwell) return { matched: false };
  if (
    !norm.includes("pindah") &&
    !norm.includes("tangani") &&
    !norm.includes("perbaiki") &&
    !norm.includes("benahi") &&
    !norm.includes("peringatan")
  ) {
    return { matched: false };
  }

  const soakwell = scene.sanitation?.soakwell;
  if (!soakwell) {
    return {
      matched: true,
      reply: "Saya tidak menemukan objek sumur resapan di denah ini.",
      actions: [],
    };
  }

  const proposal = proposeSoakwellRelocation(scene);
  if (proposal?.strategyId === "move-soakwell-to-open-ground") {
    return {
      matched: true,
      reply:
        "Oke, saya pindahkan sumur resapan ke area tanah terbuka/taman agar tidak berada di bawah ruang tertutup. " +
        "Klik Terapkan untuk menyimpan perubahan.",
      actions: proposal.actions,
    };
  }

  if (proposal?.strategyId === "service-court-for-soakwell") {
    return {
      matched: true,
      reply:
        "Saya menemukan pocket kosong tak berlabel yang lebih tepat dijadikan taman servis/inner court untuk resapan. " +
        `${proposal.rationale} ` +
        "lalu sumur resapan saya pindahkan ke sana. Klik Terapkan untuk menyimpan perubahan.",
      actions: proposal.actions,
    };
  }

  return {
    matched: true,
    reply:
      "Saya belum menemukan taman/halaman atau pocket kosong yang cukup untuk memindahkan sumur resapan. " +
      "Tambahkan atau sisakan area taman servis dulu, atau sebutkan ruang mana yang boleh digeser/diperkecil.",
    actions: [],
  };
}

function matchRepairSmallRoomWarning(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  const norm = normalize(instruction);
  const hasRepairIntent =
    ["perbaiki", "benahi", "tangani", "bantu", "rapihkan", "rapikan"].some((keyword) =>
      norm.includes(keyword),
    );
  const mentionsSmallWarning =
    norm.includes("cukup kecil") ||
    norm.includes("terlalu kecil") ||
    (norm.includes("peringatan") && norm.includes("kecil"));
  if (!hasRepairIntent || !mentionsSmallWarning) return { matched: false };

  const smallRooms = scene.rooms
    .filter((room) => round2(room.width * room.depth) < 4)
    .sort((a, b) => round2(a.width * a.depth) - round2(b.width * b.depth));
  if (smallRooms.length === 0) {
    return {
      matched: true,
      reply: "Saya tidak menemukan ruang yang saat ini berada di bawah ambang luas minimum 4 m2.",
      actions: [],
    };
  }

  const mentionedType = findRoomType(instruction);
  const target =
    smallRooms.find((room) => norm.includes(normalize(room.name))) ??
    (mentionedType ? smallRooms.find((room) => room.type === mentionedType) : null) ??
    (scene.selectedRoomId ? smallRooms.find((room) => room.id === scene.selectedRoomId) : null) ??
    smallRooms[0];
  const sacrificeRoomTypes = findRoomTypes(instruction).filter((type) => type !== target.type);

  const proposal = proposeSmallRoomRepair(scene, {
    roomId: target.id,
    floorId: target.floorId,
    sacrificeRoomTypes,
  });

  if (!proposal) {
    return {
      matched: true,
      reply:
        `${target.name} memang terlalu kecil, tetapi saya belum menemukan pembesaran aman tanpa membuat ruang lain tumpang-tindih atau ikut terlalu kecil. ` +
        "Sebutkan ruang tetangga mana yang boleh dikorbankan/diubah lebih besar bila ingin saya coba lagi.",
      actions: [],
    };
  }

  return {
    matched: true,
    reply:
      `${target.name} saya perbesar ke ambang layak tanpa membuat overlap; batas ruang tetangga ikut disesuaikan bila perlu. ` +
      "Klik Terapkan untuk menyimpan perubahan.",
    actions: proposal.actions,
  };
}

function matchOpenPlanConnection(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  const norm = normalize(instruction);
  const connectionHints = [
    "sambung",
    "sambungkan",
    "disambungkan",
    "hubung",
    "hubungkan",
    "terhubung",
    "menyatu",
    "open plan",
    "openplan",
    "clean",
    "lebih elok",
    "lebih bagus",
    "lebih baik",
  ];
  if (!connectionHints.some((hint) => norm.includes(hint))) return { matched: false };

  const mentionedTypes = findRoomTypes(instruction);
  const mainRoomTypes = mentionedTypes.filter((type) =>
    ["dapur", "ruang_keluarga", "ruang_tamu", "ruang_makan", "area_kumpul"].includes(type)
  );
  if (mainRoomTypes.length < 2) return { matched: false };

  const blockerType = mentionedTypes.find((type) =>
    ["kamar_mandi", "laundry", "gudang", "tangga"].includes(type)
  ) ?? null;
  const floorN = findFloorNumber(instruction);
  const floorId = floorN != null ? findFloorIdByNumber(scene, floorN) : scene.selectedFloorId ?? null;

  const proposal = proposeOpenPlanConnection(scene, {
    mainRoomTypes,
    blockerType,
    floorId,
  });
  if (!proposal) return { matched: false };

  return {
    matched: true,
    reply:
      "Saya baca ini sebagai masalah komposisi ruang, bukan sekadar geser objek. " +
      `${proposal.rationale} Klik Terapkan untuk menyimpan perubahan.`,
    actions: proposal.actions,
  };
}

const ROOM_TYPE_LABELS: Record<string, string> = {
  kamar_tidur: "kamar tidur",
  kamar_mandi: "kamar mandi",
  ruang_tamu: "ruang tamu",
  ruang_keluarga: "ruang keluarga",
  dapur: "dapur",
  ruang_makan: "ruang makan",
  musholla: "musholla",
  laundry: "laundry",
  gudang: "gudang",
  balkon: "balkon",
  rooftop_lounge: "rooftop lounge",
  area_kumpul: "area kumpul",
  kolam: "kolam",
  taman: "taman",
  workspace: "workspace",
  carport: "carport",
  void: "void",
  tangga: "tangga",
};

const FIX_OVERLAP_KEYWORDS = [
  "tumpang tindih",
  "tumpang-tindih",
  "bertumpuk",
  "tumpuk",
];

/** All overlapping room pairs on a given floor, using the same geometry check
 *  as the rest of the app. */
function findOverlapPairs(rooms: SceneRoom[]): [SceneRoom, SceneRoom][] {
  const pairs: [SceneRoom, SceneRoom][] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (rectsOverlap(rooms[i], rooms[j])) {
        pairs.push([rooms[i], rooms[j]]);
      }
    }
  }
  return pairs;
}

/** Move a room to a collision-free spot on the same floor, honouring the same
 *  architectural preferences (exterior access, plumbing stacking, sanitation
 *  obstacles) as the other deterministic handlers. Returns null if no spot. */
function relocateRoomOnFloor(
  room: SceneRoom,
  floorId: string,
  others: SceneRoom[],
  scene: FloorplanScene,
): { x: number; y: number } | null {
  const sanitationRects = sanitationObstaclesForFloor(scene, floorId);
  const obstacles = [
    ...others.filter((r) => r.id !== room.id),
    ...sanitationRects,
  ];
  const requireExterior = needsExteriorAccess(room.type, room);
  const preferredPositions = plumbingStackPositions(scene, room.type, floorId);
  return findFreeRect(
    { width: room.width, depth: room.depth },
    obstacles,
    scene.site,
    { requireExterior, preferredPositions },
  );
}

/**
 * Compute a `width`/`depth` (and, when the trimmed edge is the room's own
 * origin corner, `x`/`y`) patch that shrinks `room` just enough to stop
 * overlapping `other`, along whichever axis removes the LEAST size — never
 * both axes, and never below `MIN_ROOM` (1.2 m) per dimension.
 *
 * This is the common "ensuite carved from a bigger room's corner" pattern:
 * a small room's rect sits inside/against a bigger room's rect, but the
 * bigger room's own rectangle was never trimmed back to exclude it. On a
 * floor plan with zero free space left (a small/narrow lot, or a floor
 * already tiled edge-to-edge), NO relocation can ever succeed — the only
 * physically possible fix is to shrink one of the two rooms exactly enough
 * to clear the overlap. Only ever trims `room`; `other` is treated as fixed
 * and re-verified by the caller's overlap loop on the next iteration.
 *
 * Returns null when neither axis can be resolved without shrinking a
 * dimension below `MIN_ROOM` — a genuine "would need to demolish this room"
 * case, which the caller should treat as truly unresolvable here.
 */
function trimRoomToAvoid(
  room: Rect,
  other: Rect,
): { width?: number; depth?: number; x?: number; y?: number } | null {
  const ox0 = Math.max(room.x, other.x);
  const ox1 = Math.min(room.x + room.width, other.x + other.width);
  const oy0 = Math.max(room.y, other.y);
  const oy1 = Math.min(room.y + room.depth, other.y + other.depth);
  if (ox1 - ox0 <= 0 || oy1 - oy0 <= 0) return null; // not actually overlapping

  type Candidate = {
    removed: number;
    patch: { width?: number; depth?: number; x?: number; y?: number };
  };
  const candidates: Candidate[] = [];

  // Y-axis: trim depth from the bottom (keep y — valid when room's bottom
  // pokes past other's top), or from the top (move y down — valid when
  // room's top starts before other's bottom).
  const bottomTrimDepth = round2(other.y - room.y);
  if (bottomTrimDepth >= MIN_ROOM && bottomTrimDepth < room.depth) {
    candidates.push({
      removed: round2(room.depth - bottomTrimDepth),
      patch: { depth: bottomTrimDepth },
    });
  }
  const topTrimY = round2(other.y + other.depth);
  const topTrimDepth = round2(room.y + room.depth - topTrimY);
  if (
    topTrimDepth >= MIN_ROOM &&
    topTrimDepth < room.depth &&
    topTrimY > room.y
  ) {
    candidates.push({
      removed: round2(room.depth - topTrimDepth),
      patch: { y: topTrimY, depth: topTrimDepth },
    });
  }

  // X-axis: trim width from the right (keep x), or from the left (move x right).
  const rightTrimWidth = round2(other.x - room.x);
  if (rightTrimWidth >= MIN_ROOM && rightTrimWidth < room.width) {
    candidates.push({
      removed: round2(room.width - rightTrimWidth),
      patch: { width: rightTrimWidth },
    });
  }
  const leftTrimX = round2(other.x + other.width);
  const leftTrimWidth = round2(room.x + room.width - leftTrimX);
  if (
    leftTrimWidth >= MIN_ROOM &&
    leftTrimWidth < room.width &&
    leftTrimX > room.x
  ) {
    candidates.push({
      removed: round2(room.width - leftTrimWidth),
      patch: { x: leftTrimX, width: leftTrimWidth },
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.removed - b.removed); // smallest change first
  return candidates[0].patch;
}

/** Try to match "perbaiki tata letak lantai X yang bertumpuk" / "ruang yang
 *  tumpang tindih" / "kamar mandi dan dapur bertumpuk".
 *
 * This is the most common user complaint after adding/moving rooms: a room is
 * overlapping another room on the same floor. The LLM is a poor geometry
 * engine (it often hallucinates that touching rectangles are not overlapping),
 * so we resolve it deterministically whenever possible.
 *
 * The solver repeatedly picks the first overlap pair, moves the smaller /
 * non-locked room (or the room explicitly mentioned in the instruction), and
 * re-checks until the floor is clean or no progress can be made. If a room
 * can't be RELOCATED (no free rect exists — common on a fully-tiled floor,
 * where relocation can never succeed no matter which room is tried), it
 * falls back to SHRINKING one side of one of the two rooms just enough to
 * clear the overlap (`trimRoomToAvoid`) — the "ensuite carved from a corner,
 * but the parent room's rect was never trimmed back" pattern. Only when
 * NEITHER relocating NOR a safe (≥ MIN_ROOM) shrink can resolve a pair does
 * it escalate to the LLM instead of guessing. */
function matchFixOverlaps(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  const norm = normalize(instruction);
  const hasOverlapKeyword = FIX_OVERLAP_KEYWORDS.some((k) => norm.includes(k));
  const hasLayoutFixIntent =
    norm.includes("tata letak") &&
    ["perbaiki", "betulkan", "rapihkan", "rapikan", "benahi"].some((k) =>
      norm.includes(k),
    );
  if (!hasOverlapKeyword && !hasLayoutFixIntent) return { matched: false };

  const floorN = findFloorNumber(instruction);
  const floorId =
    floorN != null ? findFloorIdByNumber(scene, floorN) : scene.selectedFloorId;
  if (!floorId) return { matched: false };
  const floor = scene.floors.find((f) => f.id === floorId);
  if (!floor) return { matched: false };

  const rooms = scene.rooms.filter((r) => r.floorId === floorId);
  let pairs = findOverlapPairs(rooms);
  if (pairs.length === 0) {
    return {
      matched: true,
      reply: `Saya periksa ${floor.name} — sebenarnya tidak ada ruang yang bertumpuk di sana. Mungkin yang Anda lihat adalah dinding saling menempel? Coba tinjau kembali, atau beri tahu saya ruang mana yang ingin dipindahkan.`,
      actions: [],
    };
  }

  // Room type explicitly called out in the instruction (e.g. "kamar mandi")
  // — prefer moving it when it is part of an overlap.
  const mentionedType = findRoomType(instruction);

  const actions: FloorplanAction[] = [];
  const working = rooms.map((r) => ({ ...r }));
  const maxIterations = 20;

  for (let i = 0; i < maxIterations && pairs.length > 0; i++) {
    const [a, b] = pairs[0];

    // Decide which room to move. Order of preference:
    // 1. Mentioned type (if one of the pair matches)
    // 2. Non-locked over locked
    // 3. Smaller area over larger
    let toMove: SceneRoom;
    if (
      mentionedType &&
      (a.type === mentionedType || b.type === mentionedType)
    ) {
      toMove = a.type === mentionedType ? a : b;
    } else if (a.locked && !b.locked) {
      toMove = b;
    } else if (b.locked && !a.locked) {
      toMove = a;
    } else {
      toMove = a.areaM2 <= b.areaM2 ? a : b;
    }
    const other = toMove.id === a.id ? b : a;

    // Try moving the chosen room.
    const pos = relocateRoomOnFloor(toMove, floorId, working, scene);
    if (pos) {
      actions.push({
        type: "updateRoom",
        roomId: toMove.id,
        patch: { x: pos.x, y: pos.y },
      });
      const idx = working.findIndex((r) => r.id === toMove.id);
      working[idx] = { ...working[idx], x: pos.x, y: pos.y };
      pairs = findOverlapPairs(working);
      continue;
    }

    // If that fails, try the other room.
    const posOther = relocateRoomOnFloor(other, floorId, working, scene);
    if (posOther) {
      actions.push({
        type: "updateRoom",
        roomId: other.id,
        patch: { x: posOther.x, y: posOther.y },
      });
      const idx = working.findIndex((r) => r.id === other.id);
      working[idx] = { ...working[idx], x: posOther.x, y: posOther.y };
      pairs = findOverlapPairs(working);
      continue;
    }

    // Neither room can be RELOCATED (no free rect anywhere — the floor may be
    // fully tiled edge-to-edge, which no relocation search can ever solve).
    // Fall back to shrinking one side of whichever room clears the overlap
    // with the least size loss, same preference order as above.
    const shrinkToMove = trimRoomToAvoid(toMove, other);
    if (shrinkToMove) {
      actions.push({
        type: "updateRoom",
        roomId: toMove.id,
        patch: shrinkToMove,
      });
      const idx = working.findIndex((r) => r.id === toMove.id);
      working[idx] = { ...working[idx], ...shrinkToMove };
      pairs = findOverlapPairs(working);
      continue;
    }
    const shrinkOther = trimRoomToAvoid(other, toMove);
    if (shrinkOther) {
      actions.push({
        type: "updateRoom",
        roomId: other.id,
        patch: shrinkOther,
      });
      const idx = working.findIndex((r) => r.id === other.id);
      working[idx] = { ...working[idx], ...shrinkOther };
      pairs = findOverlapPairs(working);
      continue;
    }

    // Neither relocating nor a safe shrink can resolve this — real judgment call.
    return { matched: false };
  }

  if (pairs.length > 0) return { matched: false };

  type RoomPatch = { x?: number; y?: number; width?: number; depth?: number };
  const updateActions = actions.filter(
    (a): a is { type: "updateRoom"; roomId: string; patch: RoomPatch } =>
      a.type === "updateRoom",
  );
  const movedNames = Array.from(
    new Set(
      updateActions
        .filter((a) => a.patch.x != null || a.patch.y != null)
        .map(
          (a) => scene.rooms.find((r) => r.id === a.roomId)?.name ?? "ruang",
        ),
    ),
  );
  const shrunkNames = Array.from(
    new Set(
      updateActions
        .filter((a) => a.patch.width != null || a.patch.depth != null)
        .map(
          (a) => scene.rooms.find((r) => r.id === a.roomId)?.name ?? "ruang",
        ),
    ),
  );

  const clauses: string[] = [];
  if (movedNames.length > 0)
    clauses.push(`${joinBahasa(movedNames)} saya geser`);
  if (shrunkNames.length > 0)
    clauses.push(`${joinBahasa(shrunkNames)} saya perkecil sedikit`);

  return {
    matched: true,
    reply: `Oke, saya perbaiki tata letak ${floor.name} — ${joinBahasa(clauses)} agar tidak bertumpuk lagi. Klik Terapkan untuk menyimpan perubahan.`,
    actions,
  };
}

/**
 * Attempt to handle a floorplan instruction deterministically.
 * Returns a result only if a confident, unambiguous match is found.
 */
/** Keluhan "ruang ini tak bisa dimasuki dari dalam rumah". */
const ACCESS_COMPLAINT =
  /(tidak|tak|gak|nggak|ga|belum)\s+(ada\s+)?(akses|terhubung|tersambung)|(hanya|cuma|doang)\s+(bisa\s+)?(keluar|ke luar)|pintu(nya)?\s+(hanya|cuma)\s+(keluar|ke luar)|(tidak|gak|nggak|ga)\s+bisa\s+masuk|terputus|terisolasi|terpencil/;

/**
 * Perbaiki ruang yang TERPUTUS dari inti rumah.
 *
 * Dilaporkan pemilik rumah persis begini: "kamar tidur 2 tidak ada akses ke
 * dalam rumah, pintunya hanya keluar rumah". Memeriksa "punya pintu" tidak
 * menangkapnya — kamar itu punya dua pintu (ke halaman + ke kamar mandinya
 * sendiri) tapi tetap tak terjangkau dari ruang keluarga. Karena itu targetnya
 * dipilih lewat analisis konektivitas, dan pintu baru WAJIB menembus ke ruang
 * yang sudah berada di gugus utama.
 */
function matchFixRoomAccess(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  const norm = normalize(instruction);
  if (!ACCESS_COMPLAINT.test(norm)) return { matched: false };
  // Harus menyangkut akses/pintu, bukan keluhan lain yang kebetulan mirip.
  if (!/(akses|pintu|masuk|terhubung|tersambung|terputus)/.test(norm)) return { matched: false };

  const rooms = scene.rooms as unknown as Room[];
  const openings = scene.openings.map((o) => ({
    ...o,
    wallId: `${o.roomId}:${o.side}`,
  })) as unknown as Opening[];
  const { isolated, componentOf, mainComponentByFloor } = analyzeRoomConnectivity(rooms, openings);
  if (!isolated.length) {
    return {
      matched: true,
      reply: "Saya cek jalur pintunya: semua ruang sudah terhubung ke dalam rumah, tidak ada yang harus lewat luar.",
      actions: [],
    };
  }

  // Ruang sasaran: yang disebut di instruksi → yang sedang dipilih → yang terputus.
  const named = isolated.find((r) => norm.includes(normalize(r.name)));
  const selected = isolated.find((r) => r.id === scene.selectedRoomId);
  const target = named ?? selected ?? isolated[0];
  // Gugus utama LANTAI target — lantai tak terhubung satu sama lain lewat
  // pintu, jadi "gugus utama" harus dilihat per lantai (lihat komentar di
  // connectivity.ts: sebelumnya satu angka global sempat membuat ruang tamu
  // lantai dasar tertandai "terputus" hanya krn kamar di lantai atas
  // kebetulan membentuk gugus yang lebih besar).
  const mainComponent = mainComponentByFloor.get(target.floorId);

  // Kandidat = pasangan (sisi, tetangga) — SEMUA tetangga per sisi, bukan
  // cuma yang pertama. Satu dinding bisa punya beberapa tetangga (insiden
  // produksi: dinding utara Ruang Tamu = Dapur DAN Ruang Makan; agent memilih
  // Dapur tapi menaruh pintu di tengah dinding penuh → jatuh di depan Ruang
  // Makan, menabrak pintu yang sudah ada di sisi seberang, dan koneksi ke
  // Dapur tidak pernah terjadi). Ruang PRIVAT tetap bukan jalur lintasan
  // (kecuali kamar mandi en-suite dari kamar tidurnya).
  const sameFloor = rooms.filter((r) => r.floorId === target.floorId && r.id !== target.id);
  const CIRCULATION = ["ruang_keluarga", "ruang_tamu", "ruang_makan", "koridor", "foyer", "teras"];
  const SEMI = ["dapur", "laundry", "gudang", "tangga"];
  const PRIVATE = ["kamar_tidur", "kamar_mandi", "musholla"];
  const DOOR_W = 0.9;
  const openingRefs = scene.openings.map((o) => ({
    id: o.id, roomId: o.roomId, side: o.side as Side,
    positionM: o.positionM, widthM: o.widthM ?? 0.9, type: o.type,
  }));

  const candidates: { side: Side; neighbor: Room; score: number }[] = [];
  const connectedNeighbors: Room[] = [];
  for (const side of ["n", "s", "w", "e"] as Side[]) {
    for (const neighbor of sameFloor) {
      if (!sharedWallSpan(target, side, neighbor)) continue;
      if (componentOf.get(neighbor.id) !== mainComponent) continue;
      connectedNeighbors.push(neighbor);
      let score: number;
      if (PRIVATE.includes(neighbor.type)) {
        const enSuite = target.type === "kamar_mandi" && neighbor.type === "kamar_tidur";
        if (!enSuite) continue; // bukan jalur yang pantas
        score = 3;
      } else if (CIRCULATION.includes(neighbor.type)) score = 3;
      else if (SEMI.includes(neighbor.type)) score = 2;
      else score = 1;
      candidates.push({ side, neighbor, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  // Sebelum menaruh pintu: (1) posisi harus DI DALAM bentang bersama tetangga
  // yang dituju & bebas tabrakan dgn bukaan mana pun di dinding itu — kedua
  // sisi; (2) usulan DISIMULASIKAN dulu dan hanya diklaim berhasil bila
  // konektivitas benar-benar tersambung. Tidak ada lagi "saya tambahkan pintu
  // ke X" yang pintunya nyatanya membuka ke Y.
  for (const cand of candidates) {
    const positionM = freeDoorPosition(
      target, cand.side, cand.neighbor, DOOR_W, openingRefs, rooms,
    );
    if (positionM == null) continue;
    const simulated: Opening[] = [
      ...openings,
      {
        id: "usulan", floorId: target.floorId,
        wallId: `${target.id}:${cand.side}`,
        type: "door", positionM, widthM: DOOR_W, heightM: 2.1,
      } as Opening,
    ];
    const after = analyzeRoomConnectivity(rooms, simulated);
    const joined =
      after.componentOf.get(target.id) === after.mainComponentByFloor.get(target.floorId);
    if (!joined) continue;
    return {
      matched: true,
      reply:
        `Betul, ${target.name} hanya bisa dicapai dari luar rumah. Saya tambahkan pintu di bentang dinding ` +
        `yang berbatasan langsung dengan ${cand.neighbor.name} (sudah saya cek tidak menabrak bukaan yang ada), ` +
        `jadi bisa diakses dari dalam. Klik Terapkan untuk menyimpan.`,
      actions: [
        { type: "addOpening", roomId: target.id, side: cand.side, positionM, openingType: "door" },
      ],
    };
  }

  // Tak ada penempatan yang lolos pemeriksaan — jelaskan penghalang yang
  // SEBENARNYA; pesan yang menyebut penghalang salah membuat pemilik rumah
  // mencari solusi yang keliru.
  const privateBlocked = connectedNeighbors.filter((n) => PRIVATE.includes(n.type));
  const reply = privateBlocked.length
    ? `${target.name} memang hanya bisa dicapai dari luar rumah. Sebenarnya ia bersebelahan dengan ` +
      `${[...new Set(privateBlocked.map((n) => n.name))].join(" dan ")}, tapi itu ruang privat — menembus ke sana ` +
      `berarti penghuni harus melewati kamar orang lain untuk masuk. Yang dibutuhkan ruang sirkulasi (koridor) ` +
      `atau penyesuaian tata letak, bukan sekadar satu pintu tambahan.`
    : connectedNeighbors.length
      ? `${target.name} memang belum terhubung ke dalam rumah. Ia bersebelahan dengan bagian rumah yang ` +
        `tersambung, tapi tidak ada bentang dinding yang cukup bebas untuk pintu baru (bukaan lain sudah ` +
        `memenuhi dinding itu) — perlu menggeser bukaan yang ada atau menyesuaikan tata letak.`
      : `${target.name} memang belum terhubung ke dalam rumah, dan tak satu pun dindingnya bersebelahan ` +
        `dengan bagian rumah yang sudah tersambung — jadi menambah satu pintu saja tidak cukup. ` +
        `Perlu ruang sirkulasi (koridor) atau menggeser tata letaknya lebih dulu.`;
  return { matched: true, reply, actions: [] };
}

export function handleFloorplanInstruction(
  instruction: string,
  scene: FloorplanScene,
): DeterministicResult {
  // Subjective "this room is in the wrong spot on this floor" requests must
  // run BEFORE `matchMoveRoomToFloor` — both can match the same instruction,
  // but the repositional case (one floor number + complaint, no target
  // floor) is the one the user actually meant, and it should be handled
  // without an LLM call.
  const handlers = [
    matchRepairSmallRoomWarning,
    matchFixAll,
    matchMoveSoakwellFromWarning,
    matchOpenPlanConnection,
    matchFixOverlaps,
    matchRepositionRoomOnFloor,
    matchMoveRoomToFloor,
    matchAddRoom,
    matchDeleteRoom,
    matchFixRoomSize,
    matchFixDaylight,
    // Sebelum matchAddOpening: keluhan akses juga menyebut "pintu", tapi yang
    // dimaksud pengguna adalah menyambungkan ruang, bukan sekadar menempel
    // satu daun pintu di sisi mana pun.
    matchFixRoomAccess,
    matchAddOpening,
  ];
  for (const handler of handlers) {
    const result = handler(instruction, scene);
    if (result.matched) return result;
  }
  return { matched: false };
}
