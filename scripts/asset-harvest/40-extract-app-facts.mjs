/**
 * Tahap 40 — ekstraksi FAKTA mekanika aplikasi dari KODE SUMBER.
 *
 * Langkah pertama membangun app_knowledge. Prinsipnya: sumber kebenaran
 * adalah kode, bukan ingatan model. Skrip ini mengumpulkan bukti mentah
 * (skema aksi, konstanta, cuplikan logika) supaya tahap 41 hanya perlu
 * MENJELASKAN apa yang sudah terbukti ada — bukan mengarang aksi yang tidak
 * tersedia, yang akan membuat agent menjalankan perintah fiktif.
 *
 * Output: out-app-facts.json (tak di-commit; regenerasi murah & deterministik).
 */
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8")

const facts = []

/* ── 1. Aksi agent: skema zod + deskripsi di prompt + label describeAction ── */
const actionsSrc = read("src/lib/assistant/actions.ts")
const editorSrc = read("src/lib/server/editor-assistant.ts")

// Blok objek zod per aksi: dari `z.literal("nama")` sampai penutup objeknya.
const actionBlocks = new Map()
const litRe = /z\.object\(\{\s*type:\s*z\.literal\("([a-zA-Z]+)"\)/g
let m
while ((m = litRe.exec(actionsSrc))) {
  const name = m[1]
  // Potong tepat di akhir definisi aksi ini. Versi pertama memakai jendela
  // 700 karakter tetap, sehingga bukti satu aksi bocor memuat 3-4 aksi
  // berikutnya — input yang membingungkan menghasilkan penjelasan ngawur.
  const chunk = actionsSrc.slice(m.index, m.index + 1200)
  const multi = chunk.indexOf("\n  }),")
  const single = chunk.indexOf("}),")
  const end = multi > 0 && multi < single ? multi + 6 : single > 0 ? single + 3 : 700
  actionBlocks.set(name, chunk.slice(0, end).trim())
}

// Baris dokumentasi aksi di system prompt editor (menjelaskan artinya ke LLM).
const promptLines = editorSrc
  .split("\n")
  .filter((l) => /'- \{"type":"/.test(l))
  .map((l) => l.trim())

// Perilaku SEBENARNYA ada di apply.ts (bukan di skema). Tanpa ini, model
// menebak efek samping — kalibrasi pertama sempat mengarang "pintu & jendela
// ikut terhapus" untuk deleteRoom, padahal buktinya cuma skema zod.
const applySrc = read("src/lib/assistant/apply.ts")
// Rantai bukti diteruskan sampai IMPLEMENTASI store, karena efek sebenarnya
// ada di sana. Contoh: deleteRoom → store.deleteObject → yang ternyata hanya
// menghapus bukaan ber-wallId milik ruang itu; pintu di dinding bersama yang
// terdaftar atas nama tetangga TETAP ADA. Tanpa rantai ini model hanya bisa
// menebak "semua bukaan ikut terhapus" — separuh benar, dan menyesatkan.
const storeSrc = read("src/stores/editor-store.ts")
function storeMethodEvidence(applyChunk) {
  const methods = [...new Set([...applyChunk.matchAll(/store\.([a-zA-Z]+)\(/g)].map((x) => x[1]))]
  const out = []
  for (const meth of methods.slice(0, 2)) {
    const i = storeSrc.search(new RegExp(`^\\s{4}${meth}:\\s*\\(`, "m"))
    if (i < 0) continue
    out.push(`// editor-store.ts — ${meth}\n${storeSrc.slice(i, i + 900).trim()}`)
  }
  return out.join("\n\n")
}

function applyEvidence(name) {
  const out = []
  const re = new RegExp(`a\\.type === "${name}"`, "g")
  let mm
  while ((mm = re.exec(applySrc))) {
    const start = Math.max(0, applySrc.lastIndexOf("\n", mm.index - 1))
    out.push(applySrc.slice(start, mm.index + 500).trim())
    if (out.length >= 2) break
  }
  return out.join("\n…\n")
}

for (const [name, schema] of actionBlocks) {
  const doc = promptLines.filter((l) => l.includes(`"${name}"`)).join("\n")
  const apply = applyEvidence(name)
  facts.push({
    id: `action:${name}`,
    kind: "action",
    name,
    evidence: [
      `// skema (actions.ts)\n${schema}`,
      doc ? `// dokumentasi prompt\n${doc}` : "",
      apply ? `// penerapan sebenarnya (apply.ts)\n${apply}` : "",
      apply ? storeMethodEvidence(apply) : "",
    ].filter(Boolean).join("\n\n"),
  })
}

/* ── 2. Tipe ruang: label, luas default, outdoor ── */
const constantsSrc = read("src/lib/constants/index.ts")
const roomBlock = constantsSrc.match(/export const ROOM_TYPES[\s\S]*?\n\}/)?.[0] ?? ""
const buildModel = read("src/lib/three/build-model.ts")
const openTypes = buildModel.match(/export const OPEN_TYPES[\s\S]*?\]/)?.[0] ?? ""

for (const line of roomBlock.split("\n")) {
  const rm = line.match(/^\s{2}([a-z_]+):\s*\{(.+)\},?\s*$/)
  if (!rm) continue
  const [, key, body] = rm
  facts.push({
    id: `room_type:${key}`,
    kind: "room_type",
    name: key,
    evidence:
      `// ROOM_TYPES (constants)\n${key}: {${body}}\n\n` +
      `// Ruang bertipe di OPEN_TYPES dirender TANPA dinding (build-model.ts: if (!isOpen) …)\n${openTypes}`,
  })
}

/* ── 3. Mekanika inti yang tak terlihat dari nama aksi ── */
const geometrySrc = read("src/lib/geometry/index.ts")
const grab = (src, re, pad = 900) => {
  const i = src.search(re)
  return i < 0 ? "" : src.slice(i, i + pad)
}

const MECHANICS = [
  {
    id: "mechanic:dinding-otomatis",
    name: "Dinding otomatis dari persegi ruang",
    evidence:
      `// build-model.ts — dinding TIDAK disimpan di data; diturunkan saat render\n` +
      grab(buildModel, /if \(!isOpen\) \{/, 700) +
      `\n\n// OPEN_TYPES = dirender tanpa dinding\n${openTypes}`,
  },
  {
    id: "mechanic:wallid-dua-sisi",
    name: "Bukaan di dinding bersama melayani dua ruang",
    evidence:
      `// geometry: openingServesRoom — pintu terdaftar di SATU wallId tapi melayani kedua sisi\n` +
      grab(geometrySrc, /export function openingServesRoom/, 900),
  },
  {
    id: "mechanic:positionm",
    name: "positionM = titik tengah bukaan pada dinding",
    evidence: `// geometry: openingSegment\n` + grab(geometrySrc, /export function openingSegment/, 900),
  },
  {
    id: "mechanic:konektivitas",
    name: "Keterjangkauan ruang lewat graf pintu",
    evidence:
      `// geometry/connectivity.ts\n` +
      grab(read("src/lib/geometry/connectivity.ts"), /export function analyzeRoomConnectivity/, 1200),
  },
  {
    id: "mechanic:akses-vs-ventilasi",
    name: "Akses (pintu) berbeda dari ventilasi (bukaan apa pun)",
    evidence:
      `// validation.ts — aturan lama hanya menuntut BUKAAN utk ventilasi\n` +
      grab(read("src/lib/validation.ts"), /requiresVentilation/, 600) +
      `\n\n// design-audit.ts — aturan akses & keterputusan\n` +
      grab(read("src/lib/audit/design-audit.ts"), /function auditRoomAccess/, 1400),
  },
]
facts.push(...MECHANICS.map((x) => ({ ...x, kind: "mechanic" })))

/* ── 4. Jenis bukaan (pintu/jendela) ── */
const kindMeta = constantsSrc.match(/export const OPENING_KIND_META[\s\S]*?\n\}/)?.[0] ?? ""
for (const km of kindMeta.matchAll(/^\s{2}([a-z_]+):\s*\{([\s\S]*?)\n\s{2}\},/gm)) {
  facts.push({
    id: `element:${km[1]}`,
    kind: "element",
    name: km[1],
    evidence: `// OPENING_KIND_META\n${km[1]}: {${km[2]}\n}`,
  })
}

/* ── 5. Efek DESTRUKTIF tersembunyi — tak terbaca dari nama aksi ──
   Ditemukan lewat audit manual store: setRooftop(false) & removeFloor
   menghapus data lain secara diam-diam. Agent yang tak tahu ini bisa
   menyarankan aksi yang membuang pekerjaan pengguna tanpa peringatan. */
const DESTRUCTIVE = [
  {
    id: "mechanic:rooftop-hapus-data",
    name: "Menonaktifkan rooftop menghapus seluruh isi lantainya",
    evidence:
      `// editor-store.ts — setRooftop(false)\n` +
      grab(storeSrc, /setRooftop: \(enabled\) => \{/, 900),
  },
  {
    id: "mechanic:removefloor-hapus-data",
    name: "Menghapus lantai membuang semua elemen di lantai itu",
    evidence:
      `// editor-store.ts — removeFloor\n` +
      grab(storeSrc, /removeFloor: \(floorId\) => \{/, 900),
  },
]
facts.push(...DESTRUCTIVE.map((x) => ({ ...x, kind: "mechanic" })))

/* ── 6. Listrik & air otomatis per tipe ruang ──
   ELECTRICAL_DEFAULTS/WATER_DEFAULTS: tabel per-tipe-ruang yang dipakai
   autoGenerateElectrical/autoGenerateWater. "void" sengaja dilewati generator
   — fakta yang tak terbaca dari nama aksinya. */
const elecDefaults = constantsSrc.match(/export const ELECTRICAL_DEFAULTS[\s\S]*?\n\}/)?.[0] ?? ""
const waterDefaults = constantsSrc.match(/export const WATER_DEFAULTS[\s\S]*?\n\}/)?.[0] ?? ""
const elecTypes = constantsSrc.match(/export const ELECTRICAL_POINT_TYPES[\s\S]*?\n\}/)?.[0] ?? ""
const waterTypes = constantsSrc.match(/export const WATER_POINT_TYPES[\s\S]*?\n\}/)?.[0] ?? ""

facts.push({
  id: "mechanic:listrik-default-per-ruang",
  kind: "mechanic",
  name: "Titik listrik otomatis mengikuti tipe ruang",
  evidence: `// constants — jenis titik + default per tipe ruang\n${elecTypes}\n\n${elecDefaults}`,
})
facts.push({
  id: "mechanic:air-default-per-ruang",
  kind: "mechanic",
  name: "Titik air otomatis mengikuti tipe ruang",
  evidence: `// constants — jenis titik + default per tipe ruang\n${waterTypes}\n\n${waterDefaults}`,
})

/* ── 7. Kolam: sirkulasi & kelistrikan dihitung, bukan diisi manual ── */
facts.push({
  id: "mechanic:kolam-sirkulasi",
  kind: "mechanic",
  name: "Sistem sirkulasi kolam dihitung otomatis dari ukuran & kedalaman",
  evidence:
    `// pool-circulation.ts — debit, pompa, filter, skimmer semua turunan luas×kedalaman\n` +
    grab(read("src/lib/three/pool-circulation.ts"), /export function poolCirculation/, 1100),
})
facts.push({
  id: "mechanic:kolam-listrik",
  kind: "mechanic",
  name: "Beban listrik kolam dihitung otomatis (pompa/lampu/heater/klorinator)",
  evidence:
    `// pool-electrical.ts\n` +
    grab(read("src/lib/three/pool-electrical.ts"), /export function poolElectrical/, 900),
})

/* ── 8. Elemen eksterior: 6 keluarga geometri, bukan satu bentuk seragam ──
   addExteriorElement mencabang berdasarkan `kind` ke 6 constructor berbeda
   (segmen/portal/tangga/permukaan/aset/kotak) — tiap keluarga menuntut field
   parameter yang BERBEDA (mis. start/end vs x/y vs points). Agent yang tak
   tahu ini bisa mengirim parameter yang salah untuk kind tertentu. */
const applyExtSnippet = grab(applySrc, /a\.type === "addExteriorElement"/, 2200)
facts.push({
  id: "mechanic:eksterior-keluarga-geometri",
  kind: "mechanic",
  name: "Elemen eksterior punya 6 keluarga geometri dengan parameter berbeda",
  evidence: `// apply.ts — addExteriorElement bercabang per kind\n${applyExtSnippet}`,
})

const exteriorLabels = read("src/lib/exterior/labels.ts")
const editorLabels = exteriorLabels.match(/export const EDITOR_EXTERIOR_KIND_LABELS[\s\S]*?\n\}/)?.[0] ?? ""
const assetCategoryMap = exteriorLabels.match(/export const EXTERIOR_KIND_ASSET_CATEGORY[\s\S]*?\n\}/)?.[0] ?? ""
for (const lm of editorLabels.matchAll(/^\s{2}([a-z_]+):\s*"([^"]+)",?\s*$/gm)) {
  const [, key, label] = lm
  // Keluarga geometri per kind (cermin dispatch di apply.ts) — disertakan
  // supaya model tak perlu menebak dari nama.
  const family =
    ["boundary_wall", "fence", "solid_wall", "facade_panel"].includes(key) ? "segment (start/end)"
    : key === "portal_frame" ? "portal_frame (x/y/widthM/heightM/depthM)"
    : key === "exterior_stair" ? "exterior_stair (x/y/widthM/lengthM/riseM)"
    : ["driveway", "walkway", "terrace_surface", "garden_bed"].includes(key) ? "surface (points[])"
    : ["asset", "plant", "tree", "exterior_decor", "vehicle"].includes(key) ? "asset (x/y + modelUrl)"
    : "box (x/y/widthM/depthM/heightM)"
  facts.push({
    id: `element:exterior-${key}`,
    kind: "element",
    name: key,
    evidence:
      `// EDITOR_EXTERIOR_KIND_LABELS\n${key}: "${label}"\n` +
      `// keluarga geometri (dispatch apply.ts addExteriorElement): ${family}\n` +
      (assetCategoryMap.includes(`${key}:`) ? `// dipetakan ke kategori library aset saat user minta model 3D\n${assetCategoryMap}` : ""),
  })
}

/* ── 9. Atap: roofZones eksplisit vs `roof` legacy, tipe & material ── */
const roofTypeDef = read("src/types/exterior.ts").match(/export type RoofZone = \{[\s\S]*?\n\};/)?.[0] ?? ""
const roofMaterialLine = constantsSrc.match(/export const ROOF_PRICES[\s\S]*?\n\}/)?.[0] ?? ""
facts.push({
  id: "mechanic:roofzones-vs-legacy",
  kind: "mechanic",
  name: "Atap eksplisit (roofZones) menang atas layout.roof lama bila keduanya ada",
  evidence:
    `// types/exterior.ts — bentuk RoofZone\n${roofTypeDef}\n\n` +
    `// build-model.ts — komentar: roofZones eksplisit; absent = fallback ke layout.roof\n` +
    grab(buildModel, /Material atap eksplisit per prim \(roofZones\)/, 500) +
    `\n\n// material atap yang sah + harga\n${roofMaterialLine}`,
})

/* ── 10. Fasad: cladding per-dinding vs template sekali-jadi ── */
const claddingIds = [...read("src/lib/three/facade-claddings.ts").matchAll(/id:\s*"([a-z_]+)"/g)].map((x) => x[1])
facts.push({
  id: "mechanic:fasad-cladding-vs-template",
  kind: "mechanic",
  name: "setWallCladding mengubah satu dinding; applyFacadeTemplate mengubah semuanya sekaligus",
  evidence:
    `// facade-claddings.ts — daftar id cladding yang sah\n${claddingIds.join(", ")}\n\n` +
    `// skema aksi\n${actionBlocks.get("setWallCladding") ?? ""}\n${actionBlocks.get("applyFacadeTemplate") ?? ""}`,
})

const out = path.join(repoRoot, "scripts/asset-harvest/out-app-facts.json")
writeFileSync(out, JSON.stringify(facts, null, 1))
const byKind = facts.reduce((a, f) => ((a[f.kind] = (a[f.kind] ?? 0) + 1), a), {})
console.log(`FAKTA MEKANIKA APP terekstrak: ${facts.length}`)
console.log(JSON.stringify(byKind, null, 1))
console.log(`→ ${out}`)
console.log(`\nContoh bukti (action:addRoom):`)
console.log((facts.find((f) => f.id === "action:addRoom")?.evidence ?? "(tidak ada)").slice(0, 400))
