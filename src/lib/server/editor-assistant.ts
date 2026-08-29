/**
 * Server logic for the agentic editor AI assistant.
 *
 * - buildMessages(): grounds the model on the live scene + the exact action
 *   catalog and asks for a strict JSON envelope {reply, actions}.
 * - sanitizeActions(): re-validates the model's actions against zod AND the
 *   real scene (only existing ids / known catalog entries survive) and clamps
 *   numbers to sane ranges. The model can never produce a hallucinated id or an
 *   out-of-bounds size. Pure → unit-testable.
 */
import type { ChatMsg } from "./llm"
import { parseOpeningWall, rectsOverlap, roomArea, round2, snapLevelOffset, type Side } from "@/lib/geometry"
import { defaultRoomSize } from "@/lib/editor/create"
import { CANTILEVER_MAX_M } from "@/lib/editor/floors"
import { groundFloorIds, sanitationObstacles } from "@/lib/water/sanitation"
import { sanitationOverlapSeverity, validateLayout } from "@/lib/validation"
import { reconcileOverlappingRooms } from "@/lib/audit/reflow"
import { FURNITURE_LIBRARY, INTERIOR_STYLES, getFurniture } from "@/lib/interior/presets"
import { OPENING_KIND_META, ROOM_TYPES } from "@/lib/constants"
import { FACADE_CLADDINGS } from "@/lib/three/facade-claddings"
import { RENDER_PRESETS } from "./ai-render/prompt"
import { featureCatalogPromptBlock } from "@/lib/assistant/feature-catalog"
import { isSelfIntersecting, segmentLength } from "@/lib/exterior/geometry"
import { findConnectivityRegressions } from "./connectivity-guard"
import {
  OPENING_EDGE_MARGIN_M,
  findOpeningConflicts,
  freeDoorPosition,
  neighborServedByOpening,
  wallJunctions,
} from "@/lib/geometry/opening-plan"
import type { Brief, DesignLayout, Opening, Room, SanitationObject, ValidationIssue } from "@/types"
import {
  floorplanActionSchema,
  interiorActionSchema,
  type AssistantMessage,
  type EditorAssistantMode,
  type AssistantScene,
  type AssistantTurn,
  type FloorplanAction,
  type FloorplanScene,
  type InteriorAction,
  type InteriorScene,
} from "@/lib/assistant/actions"

const MAX_HISTORY = 8
const MIN_ROOM = 1.2

const ROOM_TYPE_LIST = Object.entries(ROOM_TYPES)
  .map(([id, v]) => `${id} (${v.label})`)
  .join(", ")

const CLADDING_LIST = FACADE_CLADDINGS.map((c) => `${c.id} (${c.label})`).join(", ")

const OPENING_KIND_LIST = Object.entries(OPENING_KIND_META)
  .map(([id, meta]) => `${id} (${meta.label})`)
  .join(", ")

/** Daftar id RENDER_PRESETS di-inline dari sumber tunggal (ai-render/prompt.ts)
 *  supaya prompt LLM tidak pernah menyimpang dari preset yang benar-benar ada. */
const AI_RENDER_PRESET_IDS = RENDER_PRESETS.map((p) => p.id).join("|")

/**
 * Dokumentasi aksi `aiRender` — sama persis di prompt floorplan & interior
 * (aksi lintas-mode, lihat `aiRenderActionSchema`). Sengaja TIDAK memicu
 * render langsung: aksi ini hanya membuka dialog Render AI pre-filled, user
 * tetap menekan tombol Generate sendiri (kredit terpotong sadar) — lihat
 * spec 2026-08-29-ai-render-chat-style-notes §1.
 */
const AI_RENDER_ACTION_DOC =
  '- {"type":"aiRender","target":"exterior|interior","roomId?":"<id ruang>","presetId?":"<id preset>","styleNotes?":"<teks Inggris ringkas>"} — buka dialog Render AI PRE-FILLED; TIDAK merender langsung, user tetap menekan Generate sendiri di dialog. HANYA keluarkan aksi ini bila pengguna EKSPLISIT meminta gambar render/visualisasi foto-realistis (bukan sekadar mengubah desain). target "interior" WAJIB roomId — pilih dari nama ruang yang disebut pengguna, cocokkan ke ruang yang ada di scene di atas; target "exterior" tidak memakai roomId. presetId salah satu: ' +
  AI_RENDER_PRESET_IDS +
  ' — isi HANYA bila suasana yang disebut pengguna jelas cocok dengan salah satu preset itu, jika tidak biarkan kosong (dialog memakai preset yang sedang aktif). styleNotes = terjemahan RINGKAS ke Bahasa Inggris dari keinginan pengguna, HANYA mood/suasana/cahaya DAN penambahan NON-STRUKTURAL (orang, kendaraan, tanaman/vegetasi, dekor) — JANGAN PERNAH menuliskan instruksi yang mengubah bangunan itu sendiri (dinding, atap, jumlah lantai, material struktur, tata ruang); maksimal 240 karakter.\n'

/**
 * Panduan memilih JENIS pintu — cerminan tabel keputusan `doorSpecFor()`
 * (lib/geometry/door-spec.ts), yang bersumber dari
 * domain-knowledge/domain-knowledge-pintu.md §2–§3.
 *
 * Dulu model hanya diberi daftar 19 nama OpeningKind tanpa satu pun kriteria,
 * lalu memilih sembarang jenis — keluhan produksi "belum pintar memilih jenis
 * pintu yang efisien". Lebar & posisi akhir tetap ditegakkan kode; blok ini
 * agar NARASI model selaras dengan yang benar-benar terpasang.
 */
const DOOR_KIND_RULES =
  "ATURAN JENIS PINTU (pilih kind sesuai fungsi ruang; lebar/posisi akhir disesuaikan otomatis oleh sistem):\n" +
  "- kamar mandi/toilet: JANGAN pintu ayun ke dalam. Sempit (<3 m²) → pocket_door; luas → hinged_door membuka KELUAR. Alasan keselamatan: penghuni yang jatuh di dalam akan mengganjal daun pintu.\n" +
  "- kamar tidur: hinged_door ~0,8 m, membuka ke dalam kamar (jaga sirkulasi koridor tetap bersih).\n" +
  "- dapur ↔ ruang makan/keluarga: default open_passage (tanpa daun) mengikuti tata ruang modern; pakai sliding_glass_door hanya bila user memang ingin bisa menutup bau/suara.\n" +
  "- antar ruang sosial (ruang tamu/keluarga/makan/koridor): open_passage bukaan lebar.\n" +
  "- akses ke balkon/teras/taman: sliding_glass_door (hemat ruang ayun).\n" +
  "- gudang/pantry/laundry: hinged_door sempit ~0,7 m.\n" +
  "- carport/garasi: garage_door.\n" +
  "- pintu utama rumah: hinged_door >= 0,9 m.\n"

/** Aturan sikap bersama kedua asisten: akui-salah sekali + perbaiki, jangan
 *  mengiyakan yang keliru, jangan mengklaim perubahan sudah terjadi. */
const ATTITUDE_RULES =
  "SIKAP:\n" +
  "- Setiap kali Anda bertanya, meminta konfirmasi, atau menawarkan pilihan ke pengguna (walaupun 1 pertanyaan atau lebih), Anda WAJIB memasukkannya ke dalam array JSON \"needs_clarify\": [{\"question\": \"...\", \"suggestions\": [\"Opsi 1\", \"Opsi 2\"]}]. Jika balasan bersifat tindakan/jawaban langsung tanpa perlu pilihan, kirim \"needs_clarify\": [] atau hilangkan key tersebut.\n" +
  "- Jika user menunjukkan hasil edit sebelumnya keliru: periksa penanda [diterapkan: ...] di riwayat dan keadaan terkini, AKUI secara spesifik apa yang keliru dengan SATU kalimat singkat, lalu langsung sertakan actions korektif. JANGAN meminta maaf berulang-ulang atau berlebihan — satu pengakuan singkat cukup, fokus ke perbaikan.\n" +
  "- Jika user yang keliru (mis. menyebut masalah yang tidak ada menurut data), koreksi dengan sopan berbasis data — jangan mengiyakan hal yang salah.\n" +
  "- Jangan mengklaim sudah mengubah apa pun: perubahan baru terjadi setelah user menekan Terapkan.\n" +
  "- Jangan mengarang action/field di luar daftar AKSI.\n"

function clampNum(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

function trimHistory(history: AssistantTurn[]): ChatMsg[] {
  return history.slice(-MAX_HISTORY).map((t) => ({ role: t.role, content: t.content }))
}

function briefBlock(brief?: Brief | null): string {
  if (!brief) {
    return (
      "BRIEF PROYEK: (Belum diisi oleh pengguna).\n" +
      "KETERANGAN: Jika pengguna meminta Anda menyusun atau membuat brief, bantu pandu dan susun ringkasan brief (gaya rumah, jumlah lantai, kebutuhan ruang, prioritas, & batasan) secara ramah.\n\n"
    )
  }
  const summary = JSON.stringify({
    summary: brief.summary,
    site: brief.site,
    building: brief.building,
    priorities: brief.priorities,
    spaceProgram: brief.spaceProgram.map((s) => ({
      roomType: s.roomType,
      name: s.name,
      quantity: s.quantity,
    })),
    constraints: brief.constraints,
    risks: brief.risks.map((r) => r.title),
  })
  return (
    "BRIEF PROYEK (Preferensi gaya, prioritas, kebutuhan ruang, & batasan pemilik rumah):\n" +
    summary +
    "\nATURAN PATUH BRIEF: Selalu pastikan rekomendasi denah & interior selaras dengan preferensi gaya dan batasan di Brief ini. Jika perintah pengguna bertentangan dengan Brief, jelaskan trade-off-nya secara ramah.\n\n"
  )
}

/* ------------------------------------------------------------------ */
/* Prompt builders                                                     */
/* ------------------------------------------------------------------ */

function buildFloorplanMessages(
  scene: FloorplanScene,
  instruction: string,
  history: AssistantTurn[],
  knowledgeNote?: string,
  mechanicsNote?: string,
  assetNote?: string,
  brief?: Brief | null,
  plannerNote?: string,
): ChatMsg[] {
  const sceneJSON = JSON.stringify({
    site: scene.site,
    floors: scene.floors,
    selectedFloorId: scene.selectedFloorId ?? null,
    selectedRoomId: scene.selectedRoomId ?? null,
    rooms: scene.rooms,
    openings: scene.openings,
    roof: scene.roof ?? null,
    roofZones: scene.roofZones ?? [],
    rooftopEnabled:
      scene.rooftopEnabled ?? scene.floors.some((f) => f.id === "floor-rooftop"),
    rooftopArea: scene.rooftopArea ?? null,
    facade: scene.facade ?? {},
    facadeInner: scene.facadeInner ?? {},
    facadeElements: scene.facadeElements ?? [],
    exteriorLamps: scene.exteriorLamps ?? [],
    electrical: scene.electrical ?? [],
    water: scene.water ?? [],
    sanitation: scene.sanitation ?? null,
  })
  const activeIssuesJSON = JSON.stringify(
    summarizeFloorplanIssues(scene).map((issue) => ({
      id: issue.id,
      level: issue.level,
      category: issue.category,
      message: issue.message,
      objectId: issue.objectId ?? null,
    }))
  )

  const system: ChatMsg = {
    role: "system",
    content:
      "Kamu asisten editor DENAH 2D di aplikasi desain rumah Baruma. Ubah denah sesuai perintah pengguna.\n" +
      'Balas HANYA JSON valid: {"reply":"<1-2 kalimat Bahasa Indonesia>","actions":[<aksi>],"needs_clarify":[{"question":"<Pertanyaan>","suggestions":["<Opsi 1>","<Opsi 2>"]}]}.\n' +
      "Jika perintah tidak jelas / di luar kemampuan, isi reply yang menjelaskan dan actions: [].\n\n" +
      "AKSI (pakai persis nama & field ini):\n" +
      '- {"type":"updateRoom","roomId":"<id>","patch":{...}} — patch boleh: name(string), type(RoomType), floorId(id lantai tujuan untuk pindah lantai), zoneId(id zona open-plan; samakan beberapa ruang untuk satu area terbuka), levelOffsetM(meter, split-level; +naik/-turun), x, y, width, depth (meter), locked(bool), requiresNaturalLight(bool), requiresVentilation(bool), stairDirection("n|s|w|e", ruang tipe tangga: arah NAIK), railingStyle("kaca|besi|tembok|kayu", balkon: model railing sisi terbuka), railingModelUrl/railingModelAssetId(model railing GLB dari library; null = lepas, kembali ke railingStyle), edgeBowM(meter 0–1.5, HANYA balkon: tonjolan busur tepi depan — pelat lantai & railing sisi paling menjorok keluar membusur keluar, sisi lain tetap lurus; 0/absen = lurus).\n' +
      '- {"type":"addOpening","roomId":"<id>","side":"n|e|s|w","positionM":<meter dari ujung dinding, TITIK TENGAH bukaan>,"openingType":"door|window","kind?":"<OpeningKind>"} — kind opsional untuk jenis spesifik, mis. "garage_door" = pintu garasi sectional (default 2.7×2.2 m, cocok di carport). PENTING: positionM JANGAN 0 atau sama dengan panjang dinding — kusen minimal 15 cm dari sudut/pertemuan tembok, atau daun pintu mentok. Bila ragu, taruh di tengah bidang dinding yang solid; posisi akan disesuaikan otomatis ke tempat sah terdekat.\n' +
      '- {"type":"deleteRoom","roomId":"<id>"}.\n' +
      '- {"type":"addRoom","roomType":"<RoomType>","floorId?":"<id lantai>","x":<meter?>,"y":<meter?>,"width":<meter?>,"depth":<meter?>} — buat ruang baru di lantai tertentu (default lantai aktif). WAJIB sertakan floorId (mis. "floor-2") jika membuat ruang untuk lantai baru/lantai 2, serta sertakan width & depth.\n' +
      '- {"type":"addFloor"} — tambah lantai baru (kosong).\n' +
      '- {"type":"removeFloor","floorId":"<id lantai>"} — hapus lantai + isinya.\n' +
      '- {"type":"updateFloor","floorId":"<id lantai>","patch":{heightM?,name?,baseOffsetM?<hanya mezzanine, elevasi dasar dari lantai induk>,offsetM?:{dx,dy}<KANTILEVER: geser massa lantai horizontal dari lantai di bawahnya, meter, koordinat site; di-clamp ±1,5 m per sumbu; pakai untuk kesan massa menjorok/berundak fasad modern>}} — rooftop tidak bisa diubah.\n' +
      '- {"type":"updateOpening","openingId":"<id>","patch":{positionM?,widthM?,heightM?,openingType?,kind?,frameColor?,sillHeightM?,headHeightM?,frameDepthM?<m 0-0.8: bingkai kusen MENONJOL keluar muka dinding (extruded frame, fasad modern); 0=flush>,archShape?<"arch"|"capsule": siluet LENGKUNG fasad mediterania/organik — "arch"=setengah lingkaran di atas (butuh heightM ≥ widthM/2 + 0.2, otomatis disesuaikan), "capsule"=setengah lingkaran di kedua ujung (pill); lubang dinding tetap persegi>,topSlopeM?<m ±3: tepi ATAS miring, bukaan TRAPESIUM mengikuti kemiringan atap/gable — beda tinggi sisi along+/along− tepi atas (± = arah); lubang dinding tetap persegi setinggi heightM (sisi tinggi), sisi rendah otomatis dijaga ≥ 0,3 m>,modelUrl?,modelAssetId?}} — kind = jenis spesifik (lihat OpeningKind; mengubah kind me-reset dimensi/metadata ke default jenis itu, field lain di patch yang same menimpanya); frameColor = warna kusen custom "#rrggbb"; modelUrl/modelAssetId = daun/panel GLB kustom dari library (null = lepas).\n' +
      '- {"type":"deleteOpening","openingId":"<id>"}.\n' +
      '- {"type":"setRoof","patch":{type?:"datar|pelana|limasan|miring",slopeDeg?:<15-40; khusus type miring boleh 5-40>,overhangM?:<0-1 meter>,material?:"genteng_beton|genteng_keramik|metal|aspal",lowSide?:"n|s|w|e",ridgeOffsetM?:<m, hanya pelana: geser bubungan dari tengah (gable asimetris), ± = arah +x/+y site>,gableEnds?:{n|s|w|e:"wall"|"glass"} <sopi-sopi: isi dinding/kaca ujung bubungan pelana; sisi valid = ujung ridge; {} menghapus>,fascia?:{heightM:<0.1-0.8>,color:"#rrggbb"}|null}} — ubah parameter atap (semua field opsional, hanya kirim yang berubah). "miring" = atap skillion satu bidang; lowSide = sisi RENDAH (arah air mengalir), hanya untuk type miring. fascia = lis band gelap tepi atap datar/dak/balkon (gaya modern); fascia:null = MATIKAN lis; jangan kirim fascia bila tidak diubah.\n' +
      '- {"type":"addRoofZone","zone":{type:"datar|pelana|limasan|miring",x:<center m>,y:<center m>,widthM:<m>,depthM:<m>,slopeDeg?:<0-60>,overhangM?:<0-1>,materialId?:"genteng_beton|genteng_keramik|metal|aspal",lowSide?:"n|s|w|e",floorId?:"<id lantai>"}} — tambah zona atap eksplisit. Gunakan saat user meminta atap kombinasi/split/massa berbeda; koordinat x/y adalah titik tengah zona.\n' +
      '- {"type":"updateRoofZone","id":"<id zona>","patch":{type?,x?,y?,widthM?,depthM?,slopeDeg?,overhangM?,materialId?,lowSide?,ridgeOffsetM?<m, pelana: gable asimetris — geser bubungan dari tengah>,gableEnds?{n|s|w|e:"wall"|"glass" — sopi-sopi ujung bubungan},floorId?}} — ubah zona atap eksplisit yang ada di DENAH.roofZones.\n' +
      '- {"type":"removeRoofZone","id":"<id zona>"} — hapus zona atap eksplisit.\n' +
      '- {"type":"setRooftop","enabled":true|false} — aktif/nonaktifkan lantai dak rooftop ("floor-rooftop"). true = tambah lantai dak yang bisa diakses; false = hapus lantai rooftop beserta isinya. WAJIB aktif dulu sebelum setRooftopArea.\n' +
      '- {"type":"setRooftopArea","area":{"x":<m>,"y":<m>,"width":<m>,"depth":<m>}} — atur area DECK rooftop (koordinat meter ABSOLUT di lahan, seperti ruang); sisa footprint otomatis jadi atap. Hanya untuk rumah dengan rooftop aktif (lihat DENAH.rooftopEnabled; kalau false, kirim setRooftop dulu); otomatis dijepit ke dalam footprint.\n' +
      '- {"type":"clearRooftopArea"} — kembalikan rooftop ke deck penuh (hapus area parsial).\n' +
      '- {"type":"setWallCladding","wallId":"<roomId>:<n|e|s|w>","claddingId":"<id cladding>|null","face?":"outer|inner"} — material pelapis MUKA dinding (fasad). face default "outer" (muka luar); "inner" = aksen muka dalam dinding itu saja. claddingId null = kembali polos/cat. Cladding aktif saat ini ada di DENAH.facade / DENAH.facadeInner.\n' +
      '- {"type":"addFacadeElement","wallId":"<roomId>:<n|e|s|w>"} — tambah LOUVER BAND (kisi-kisi vertikal lebar, khas fasad modern) di muka luar dinding itu; default selebar dinding, sill 0.3 m, tinggi 2.2 m.\n' +
      '- {"type":"updateFacadeElement","id":"<id elemen>","patch":{positionM?,widthM?,sillHeightM?,heightM?,kind?:"louver_band|slat_horizontal|roster_screen",finish?:"kayu|aluminium_gelap|putih",colorHex?,modelUrl?,modelAssetId?,pattern?:{orientation?:"v|h|grid|cross",pitchM?:<0.05-1.5>,barWidthM?:<0.02-0.5>,barDepthM?:<0.01-0.6>,rhythm?:<maks 8 angka 1-10, mis [3,1]=3 bilah rapat lalu 1 gap>,frame?:<bool>,inset?:<bool, bilah TENGGELAM di muka dinding = reveal line/nat beton, kebalikan bilah menonjol bawaan>}}} — ubah elemen fasad; pattern menggantikan konstanta pitch/lebar/kedalaman bawaan kind (absen = default numerik); colorHex = warna bilah custom "#rrggbb" (menang atas warna bawaan finish, mis. cocokkan dgn cladding kayu gelap "#6f4e37"); modelUrl/modelAssetId = GLB kustom dari library (null = lepas, kembali procedural); id dari DENAH.facadeElements. Panel sirip/fluted PENUH satu dinding: tombol 1-klik "Panel sirip (fluted)" di kartu inspector dinding (UI, bukan action) — atau susun manual lewat addFacadeElement kind louver_band lalu updateFacadeElement widthM=panjang dinding, sillHeightM=0, heightM=tinggi dinding, pattern pitchM≈0.07/barWidthM≈0.025/barDepthM≈0.02. Reveal line/nat beton PENUH satu dinding: tombol 1-klik "Nat beton / reveal line" di kartu inspector dinding — atau manual pattern orientation "h", pitchM≈0.6-1.2, barWidthM≈0.02, barDepthM≈0.012, inset:true. Bila user ingin MENYIMPAN pola ini sebagai preset bernama untuk dipakai lagi nanti, arahkan ke panel "Buka Studio Komponen" di kartu inspector elemen itu (bukan action — Studio yang menyimpan preset).\n' +
      '- {"type":"removeFacadeElement","id":"<id elemen>"} — hapus louver band.\n' +
      '- {"type":"addExteriorElement","element":{...}} — tambah elemen eksterior native. kind legal: boundary_wall/fence/sliding_gate/swing_gate/pedestrian_gate; solid_wall/facade_panel/column/chimney/beam/slab/canopy/planter; pergola (kisi silang 2 arah horizontal: x/y/zM/widthM/depthM=footprint/heightM=elevasi bidang kisi dari tanah/rotationDeg, optional pattern sama seperti updateFacadeElement (default orientation "cross"/pitch 0,4 m), optional posts:bool=4 kolom penyangga sudut default true); portal_frame; gable_frame (bingkai pelana asimetris di bidang fasad: x/y/zM/widthM/heightM=tinggi apex/eaveLeftM/eaveRightM/apexOffsetM/memberSizeM/depthM/rotationDeg — eave kiri-kanan boleh beda tinggi); exterior_stair; driveway/walkway/terrace_surface/garden_bed; asset/plant/tree/exterior_decor/vehicle. Segment memakai start/end/heightM, box memakai x/y/widthM/depthM/heightM, surface memakai points (maks 16), asset/plant/tree/decor/vehicle memakai envelope x/y/widthM/depthM/heightM dan optional modelUrl.\n' +
      '- {"type":"updateExteriorElement","id":"<id>","patch":{...}} — ubah geometry/material elemen eksterior yang ada; id/kind tidak dapat diubah. Segmen (boundary_wall/fence/*_gate) juga terima rotationDeg?<derajat, 0=horizontal — server menghitung ulang end di sekeliling start, panjang tetap> dan (kecuali boundary_wall, selalu solid) pattern?<sama seperti updateFacadeElement — pitch/lebar/rhythm jeruji ganti spasi bilah bawaan>.\n' +
      '- {"type":"removeExteriorElement","id":"<id>"} — hapus elemen eksterior native.\n' +
      '- {"type":"applyFacadeTemplate","templateId":"modern_concrete_vertical|brick_gable_roster|minimalist_portal_carport|modern_tropis_villa"} — terapkan komposisi tampak depan native sebagai satu perubahan undoable; gunakan saat user meminta gaya siap pakai.\n' +
      '- {"type":"addWallLamp","wallId":"<roomId>:<n|e|s|w>"} — tambah lampu dinding eksterior di tengah dinding itu.\n' +
      '- {"type":"updateLamp","id":"<id lampu>","patch":{color?:"#rrggbb",intensity?:<0-2; 0=mati>,watt?:<1-100>,mountH?:<meter>,modelUrl?,modelAssetId?}} — ubah lampu eksterior; id dari DENAH.exteriorLamps (termasuk lampu penempatan otomatis — mengedit akan mematerialisasikannya). modelUrl/modelAssetId null = kembali ke fixture bawaan.\n' +
      '- {"type":"removeLamp","id":"<id lampu>"} — hapus lampu eksterior.\n' +
      '- {"type":"setSoilBearing","soilBearingKPa":<50-400>} — set daya dukung tanah σ (kPa) untuk perhitungan struktur (pondasi/kolom).\n' +
      '- {"type":"addElectricalPoint","roomId":"<id>","pointType":"stopkontak|stopkontak_daya|saklar_tunggal|saklar_ganda|panel|data","x":<meter>,"y":<meter>} — tambah titik listrik (x/y = koordinat meter ABSOLUT di lahan).\n' +
      '- {"type":"moveElectricalPoint","id":"<id titik>","x":<meter>,"y":<meter>} — pindah titik listrik ke koordinat absolut.\n' +
      '- {"type":"updateElectricalPoint","id":"<id titik>","patch":{type?:"stopkontak|...","roomId?":"<id>","note?":"<teks>"}} — ubah tipe/ruang/catatan titik listrik.\n' +
      '- {"type":"removeElectricalPoint","id":"<id titik>"} — hapus titik listrik.\n' +
      '- {"type":"autoGenerateElectrical","floorId?":"<id lantai>"} — buat titik listrik default otomatis; tanpa floorId berlaku untuk semua lantai.\n' +
      '- {"type":"addWaterPoint","roomId":"<id>","waterType":"kloset|wastafel|shower|kran|kran_taman|floor_drain|sink_dapur|kran_wudhu","x":<meter>,"y":<meter>} — tambah titik air (x/y = koordinat meter ABSOLUT di lahan).\n' +
      '- {"type":"moveWaterPoint","id":"<id titik>","x":<meter>,"y":<meter>} — pindah titik air ke koordinat absolut.\n' +
      '- {"type":"updateWaterPoint","id":"<id titik>","patch":{type?:"kloset|...","roomId?":"<id>","note?":"<teks>"}} — ubah tipe/ruang/catatan titik air.\n' +
      '- {"type":"removeWaterPoint","id":"<id titik>"} — hapus titik air.\n' +
      '- {"type":"autoGenerateWater","floorId?":"<id lantai>"} — buat titik air default otomatis; tanpa floorId berlaku untuk semua lantai.\n' +
      '- {"type":"moveSanitationObject","kind":"septicTank|soakwell|controlBox","ref?":<indeks bak kontrol>,"x":<meter>,"y":<meter>} — geser objek sanitasi di LAHAN (x/y = koordinat meter absolut pada lahan; ref hanya untuk controlBox = indeks bak).\n' +
      '- {"type":"autoSizeSanitation"} — hitung ulang & tempatkan septic tank, sumur resapan, dan bak kontrol berukuran SNI (level lahan; tanpa argumen).\n' +
      AI_RENDER_ACTION_DOC +
      "\n" +
      "ATURAN:\n" +
      "- HUKUM DASAR RUMAH — langgar ini dan usulanmu ditolak sistem: (a) SETIAP ruang dalam wajib bisa dicapai DARI DALAM rumah, lewat pintu ke ruang tetangga atau koridor; pintu yang hanya membuka ke halaman/luar TIDAK membuat ruang itu terjangkau. (b) Rumah harus tersambung dari DEPAN ke BELAKANG di dalam — penghuni tidak boleh dipaksa keluar rumah (mis. memutar lewat carport/taman) untuk pindah antar ruang. (c) Jangan menghapus atau memindahkan pintu yang merupakan SATU-SATUNYA akses dalam sebuah ruang tanpa menyediakan penggantinya di usulan yang sama. (d) Ruang baru (addRoom) wajib disertai pintu yang menyambungkannya ke ruang yang sudah terhubung. Sebelum mengirim usulan, telusuri jalur kaki dari pintu masuk utama ke tiap ruang; bila ada yang tak tercapai, tambahkan pintu/koridor penghubung dalam usulan yang sama.\n" +
      '- KAPAN MEMBUAT KORIDOR: bila sebuah ruang hanya bertetangga dengan ruang PRIVAT lain (kamar tidur/kamar mandi orang), menambah pintu berarti memaksa penghuni menembus kamar orang — itu SALAH. Jawabannya ruang sirkulasi: {"type":"addRoom","roomType":"koridor","floorId":"<id>","x":..,"y":..,"width":..,"depth":..} selebar 0,9–1,2 m pada celah antara area sirkulasi (ruang tamu/keluarga) dan ruang-ruang terkurung, LALU tambahkan pintu dari tiap ruang itu ke koridor. Lebih baik mengorbankan sedikit luas ruang servis daripada membiarkan kamar hanya bisa dimasuki lewat kamar lain.\n' +
      "- DILARANG MENGHAPUS DESAIN YANG TIDAK DIMINTA: Jangan pernah menghapus ruang yang tidak diminta pengguna. DILARANG menghapus mayoritas/semua ruang satu lantai sekaligus — usulan seperti itu DITOLAK sistem. Bila sebuah ruang terlanjur berada di lantai yang salah, PINDAHKAN dengan updateRoom.floorId — JANGAN hapus lalu buat ulang (menghapus 10 ruang lantai 1 untuk 'memperbaiki' lantai 2 adalah malapetaka nyata di produksi).\n" +
      "- addRoom WAJIB menyertakan floorId bila instruksi menyebut lantai tujuan (mis. 'kerjakan lantai 2') — tanpa floorId ruang jatuh ke lantai aktif yang salah dan usulan DITOLAK sistem.\n" +
      "- HANYA gunakan roomId yang ADA di DENAH di bawah. Jangan mengarang id.\n" +
      "- Kamu BISA membuat ruang baru (addRoom) dan menambah/menghapus lantai (addFloor/removeFloor).\n" +
      "- DENAH memuat SEMUA lantai. Tiap ruang punya floorId; 'floors' = daftar lantai; 'selectedFloorId' = lantai yang sedang dilihat user.\n" +
      "- EKSEKUSI MULTI-LANGKAH BERTAHAP (MULTI-CALL > SINGLE-SHOT): Untuk permintaan kompleks yang luas (seperti menambah lantai 2 + ruang-ruang baru + fasad + balkon), UTAMAKAN eksekusi secara bertahap dan presisi di tiap putaran (misal: buat lantai & konfirmasi program ruang di putaran 1, buat ruang lantai 2 dengan floorId presisi di putaran 2, lalu terapkan material & fasad di putaran 3). Lebih baik eksekusi bertahap yang 100% valid dan berhasil daripada memaksakan puluhan aksi sekaligus dalam 1 kali balasan yang berisiko gagal atau tumpang-tindih.\n" +
      "- Untuk memindah ruang ke lantai lain, set patch.floorId ke id lantai tujuan dari 'floors'.\n" +
      "- Jika lantai tujuan penuh, kamu BOLEH menata ulang: perkecil, geser, atau tukar posisi ruang lain (updateRoom x/y/width/depth) agar muat. Pikirkan langkah demi langkah dan PASTIKAN tidak ada ruang yang tumpang-tindih. Jangan menyerah dengan alasan 'penuh' sebelum mencoba menata ulang.\n" +
      "- WAJIB BEBAS TUMPANG-TINDIH & BATAS LAHAN: Saat menambah/membuat ruang baru (misalnya koridor dari depan ke belakang), kamu WAJIB menggeser atau mengecilkan SEMUA ruang yang berada di jalur tersebut (termasuk Carport, Ruang Tamu, Kamar, Laundry). Contoh: jika koridor ditaruh di x=3.06 dengan lebar 1.0m (span x=3.06..4.06), maka ruang di sebelah kanannya HARUS mulai dari x=4.06, BUKAN x=3.06! Carport jika memotong jalur koridor WAJIB diperkecil lebarnya (width: 3.06). Pastikan x + width <= site.widthM dan y + depth <= site.depthM untuk SEMUA ruang.\n" +
      "- SIRKULASI & AKSESIBILITAS PENGHUNI: Koridor/selasar adalah jalur sirkulasi horizontal interior (lebar 0.9–1.2m) yang WAJIB menghubungkan area depan (publik: Carport, Ruang Tamu, Foyer) ke area belakang (privat/servis: Kamar Tidur, Dapur, Laundry) tanpa memaksa penghuni berjalan lewat luar rumah (seperti melalui carport outdoor). DILARANG membiarkan kamar tidur terisolasi tanpa akses indoor. Saat user meminta koridor atau perbaikan rute akses: (1) Periksa Brief & Denah eksisting untuk mengenali ruang privat belakang vs ruang publik depan. (2) Secara proaktif buat koridor lineal (x=0, x=tengah, atau x=kanan) atau bentuk L, dengan menggeser/mengecilkan ruang servis (laundry, dapur, taman depan) bukan menghapus kamar huni utama. (3) Kolaborasikan dengan gaya dan brief eksisting agar fungsionalitas dan jumlah kamar tetap terjaga.\n" +
      "- Ukuran dalam meter, masuk akal, dan muat di lahan.\n" +
      "- side: n=atas, s=bawah, w=kiri, e=kanan.\n" +
      "- Ruang dengan requiresNaturalLight/requiresVentilation true (lihat DENAH), serta tipe kamar_tidur/ruang_keluarga/ruang_tamu/kamar_mandi pada umumnya, SEBAIKNYA menempel ke tepi lahan (x=0, y=0, x+width=site.widthM, atau y+depth=site.depthM) supaya bisa punya jendela. Hindari mengurungnya di tengah dikelilingi ruang lain di semua sisi kalau ada alternatif tepi yang masuk akal.\n" +
      "- Saat memindah/menambah kamar_mandi, dapur, atau laundry, USAHAKAN sejajar (x,y sama) dengan kamar_mandi/dapur/laundry yang sudah ada di lantai LAIN, supaya jalur pipa vertikal (riser) tetap satu jalur dan tidak perlu pemipaan menyamping yang mahal. Ini preferensi, bukan keharusan mutlak — jangan korbankan 'tidak tumpang-tindih' demi ini.\n" +
      "- DENAH.sanitation (jika ada) berisi septicTank/soakwell/controlBoxes — instalasi BAWAH TANAH di LAHAN, bukan ruang. PENTING: koordinat x,y objek sanitasi adalah TITIK TENGAHnya (BEDA dengan ruang, yang x,y = pojok kiri-atas!), lebarnya widthM, panjangnya lengthM. Aturan terhadap ruang di lantai DASAR (level TERENDAH di 'floors', bukan rooftop): (1) sumur resapan (soakwell) WAJIB di tanah terbuka — DILARANG ada ruang di atasnya kecuali tipe taman; kalau bentrok, geser soakwell dulu (moveSanitationObject) ke titik kosong/taman, baru tempatkan ruangnya. (2) septic tank & bak kontrol boleh berada di bawah ruang bila terpaksa (lahan sempit) — lebih baik di bawah carport/taman daripada ruang huni — tapi USAHAKAN tetap di area kosong bila ada.\n\n" +
      "- BERPIKIR SEPERTI ARSITEK SENIOR: ruang kosong tak berlabel di antara massa ruang BUKAN otomatis 'tidak ada taman'. Jika ada pocket kosong yang dekat area basah/servis dan hampir cukup untuk sumur resapan, perlakukan sebagai kandidat taman servis / inner court / area resapan. Kamu boleh menggeser sedikit ruang servis tetangga (dapur/kamar_mandi/laundry/carport) sebelum ruang utama, selama tetap muat, tidak overlap, dan perubahan ukurannya masuk akal. Jelaskan trade-off itu di reply.\n\n" +
      "- Untuk kritik komposisi/tata letak seperti 'kurang pas', 'area harusnya clean', 'ruang ini menghalangi', 'lebih elok bila disambungkan', atau 'open plan', TERJEMAHKAN ke intent arsitektural yang bisa dieksekusi. Identifikasi dua ruang utama yang ingin dibuat menyatu/terhubung, cari ruang servis yang memotong sumbu visual/sirkulasi di antaranya, lalu usulkan action konkret: pindahkan ruang servis ke tepi/area servis, kompakkan dimensinya bila tidak ada spot kosong penuh, tambah bukaan bila relevan, dan samakan zoneId ruang utama untuk menandai area open-plan. Jangan membalas seolah user harus memberi perintah mekanis jika maksud arsitekturalnya sudah jelas dari denah.\n\n" +
      "- ISU VALIDASI AKTIF berisi warning/info/danger dari editor saat ini. Jika user meminta 'perbaiki peringatan ini', pilih isu yang disebut di instruksi atau objek terkaitnya, lalu hasilkan actions yang mengurangi/menyelesaikan isu itu. Jangan actions: [] kecuali benar-benar tidak ada perubahan aman; bila tidak aman, jelaskan trade-off spesifik ruang mana yang perlu dikorbankan.\n\n" +
      '- wallId untuk fasad/cladding/louver/lampu SELALU berformat "<roomId>:<n|e|s|w>" dengan roomId yang ADA di DENAH — sama seperti dinding tempat bukaan menempel.\n' +
      "- ANALISA ADAPTIF PENYESUAIAN FASAD & DENAH EKSISTING: Saat menerapkan template fasad (applyFacadeTemplate) atau mengubah tampak depan, lakukan evaluasi kondisional 2-langkah: (1) EVALUASI KEBUTUHAN TEMPLATE VS DENAH EKSISTING: Pahami batas spasial yang dibutuhkan oleh template (seperti clearance kanopi, portal entrance, atau louver) dan bandingkan dengan denah saat ini. Jika denah eksisting SUDAH MEMADAI (misal: sudah ada teras/setback yang cukup, atau template memang cocok dengan posisi dinding depan saat ini), TERAPKAN TEMPLATE LANGSUNG tanpa merelokasi ruang apapun! (2) PENYESUAIAN HANYA JIKA DIBUTUHKAN: Jika dan HANYA JIKA terjadi potensi bentrokan geometris (elemen portal/kanopi fasad menembus interior huni) atau sirkulasi terhambat, lakukan penyesuaian spasial secara proporsional (misal: geser/inset ruang depan secukupnya atau sesuaikan posisi bukaan pintu/jendela pada area bebas louver) agar fasad dan tata ruang tetap harmonis secara fungsi & estetika.\n\n" +
      ATTITUDE_RULES +
      "\n" +
      emptySceneBlock(scene, brief) +
      plannerBlock(plannerNote) +
      briefBlock(brief) +
      knowledgeBlock(knowledgeNote) +
      mechanicsBlock(mechanicsNote) +
      assetBlock(assetNote) +
      featureCatalogPromptBlock() +
      `RoomType yang valid: ${ROOM_TYPE_LIST}.\n` +
      `OpeningKind yang valid: ${OPENING_KIND_LIST}.\n` +
      DOOR_KIND_RULES +
      `Cladding yang valid (setWallCladding.claddingId): ${CLADDING_LIST}.\n` +
      `ISU VALIDASI AKTIF: ${activeIssuesJSON}\n` +
      `DENAH: ${sceneJSON}`,
  }

  return [system, ...trimHistory(history), { role: "user", content: instruction }]
}

/**
 * Blok PENGETAHUAN DESAIN untuk prompt editor (denah & interior).
 *
 * Sumbernya design_knowledge yang sama dengan brief mode — 71 topik memuat
 * layout_principles/placement_tips/common_mistakes yang sebelumnya menganggur
 * karena hanya brief mode yang ter-grounding. Agent penata furnitur justru
 * paling butuh ini ("tempat tidur jangan langsung menghadap pintu").
 */
function knowledgeBlock(note?: string): string {
  if (!note) return ""
  return (
    "PENGETAHUAN DESAIN (kurasi — jadikan dasar penataan bila relevan; " +
    "jangan mengarang prinsip di luar ini):\n" + note + "\n\n"
  )
}

/**
 * Blok MEMBANGUN DARI NOL — hanya saat denah benar-benar kosong.
 *
 * Regresi produksi 2026-08-02 (proj-modern-tropis-1): denah 0 ruang, brief
 * berisi 12 ruang bernama. Kedua agent malah menagih daftar ruang ke pengguna
 * ("saya perlu informasi lebih detail") padahal daftar itu ada di blok BRIEF
 * PROYEK pada prompt yang sama. Turn berakhir 0 aksi, pengguna menyimpulkan
 * agent-nya bodoh — dan penilaian itu adil.
 *
 * Blok ini tidak muncul saat denah sudah berisi ruang, supaya perilaku denah
 * eksisting persis seperti sebelumnya.
 */
function emptySceneBlock(scene: FloorplanScene, brief?: Brief | null): string {
  if (scene.rooms.length) return ""
  const program = brief?.spaceProgram ?? []
  if (!program.length) {
    return (
      "DENAH MASIH KOSONG & BRIEF BELUM BERISI KEBUTUHAN RUANG: tanyakan ruang apa saja yang " +
      "diinginkan pengguna (jumlah kamar, lantai, ruang servis) sebelum membuat apa pun.\n\n"
    )
  }
  const total = program.reduce((n, item) => n + (item.quantity || 1), 0)
  // Membangun belasan ruang sekaligus dari nol nyaris selalu ditolak guard
  // (tumpang-tindih / ruang tak terjangkau), lalu SELURUH usulan dibuang dan
  // pengguna dapat 0 aksi — hasil akhir yang sama buruknya dengan menagih data.
  // Karena itu batasi lingkup satu putaran secara eksplisit.
  const stageFirst = total > 8
  return (
    "MEMBANGUN DARI NOL — DENAH SAAT INI KOSONG (0 ruang):\n" +
    `- Daftar ruang yang diminta pemilik SUDAH TERSEDIA di spaceProgram di BRIEF PROYEK bawah (${total} ruang). ` +
    "Itu sumber kebenaranmu. DILARANG membalas tanpa aksi hanya untuk menagih nama/ukuran/daftar ruang — " +
    "data itu sudah ada di prompt ini, dan menagihnya membuat pengguna mengetik ulang hal yang sudah dia isi.\n" +
    "- Terbitkan addRoom untuk ruang-ruang tersebut, lengkap dengan floorId, x, y, width, depth. " +
    "Bila lantai tujuan belum ada di DENAH.floors, kirim addFloor lebih dulu di usulan yang sama.\n" +
    "- Tempatkan fungsi publik & servis (carport, taman, ruang tamu, ruang keluarga, ruang makan, dapur, " +
    "laundry) di lantai dasar; ruang privat (kamar tidur, kamar mandi) di lantai atas bila pengguna meminta " +
    "lebih dari satu lantai. Hormati preferredFloor bila ada di spaceProgram.\n" +
    "- Sediakan tangga bila lantainya lebih dari satu, dan pintu penghubung agar tiap ruang terjangkau dari dalam.\n" +
    "- Bila jumlah lantai yang diminta pengguna berbeda dari angka di brief, IKUTI PERMINTAAN PENGGUNA — " +
    "brief adalah catatan lama, perintah pengguna adalah keputusan terbaru. Cukup sebut penyesuaian itu " +
    "satu kalimat di reply, lalu tetap terbitkan aksinya. Selisih semacam ini BUKAN alasan sah untuk 0 aksi.\n" +
    (stageFirst
      ? "- LINGKUP PUTARAN INI — KERJAKAN LANTAI DASAR SAJA. Programnya terlalu besar untuk satu usulan; " +
        "membangun semuanya sekaligus membuat usulan ditolak sistem dan pengguna tidak mendapat apa pun. " +
        "Putaran ini: buat lantai dasar + ruang publik/servisnya + tangga, dan JANGAN sentuh lantai atas dulu. " +
        "Tutup reply dengan kalimat bahwa lantai atas menyusul di perintah berikutnya.\n" +
        "- WAJIB ADA KORIDOR di lantai dasar: buat ruang bertipe koridor selebar 0,9–1,2 m yang membentang dari " +
        "dekat pintu masuk ke area belakang, tempelkan ruang-ruang lain ke sisi koridor itu, lalu beri satu pintu " +
        "dari tiap ruang ke koridor. Tanpa koridor, ruang-ruang saling terkunci dan usulanmu ditolak.\n" +
        "- Sisakan ruang: dengan koridor, ruang lain harus dikecilkan. Lebih baik ruang sedikit lebih kecil " +
        "daripada usulan ditolak seluruhnya.\n\n"
      : "- Boleh bertahap: bila terlalu banyak untuk satu putaran, kerjakan lantai dasar dulu sampai valid, " +
        "sebutkan di reply bahwa lantai berikutnya menyusul. Yang DILARANG adalah 0 aksi.\n\n")
  )
}

/** Blok RENCANA ARSITEK UTAMA untuk prompt floorplan — rencana dari
 *  `baruma-assistant` (floorplan-planner.ts) yang disusun SEBELUM eksekusi.
 *  Agent eksekusi (baruma-floorplan-actions) wajib mengikuti rencana ini
 *  bila memungkinkan; bila tidak, jelaskan di reply dan beri alternatif.
 *  Tanpa rencana (opsi B gagal menghasilkan, atau mode lain) prompt persis
 *  seperti sebelumnya. */
function plannerBlock(note?: string): string {
  if (!note) return ""
  return (
    "RENCANA ARSITEK UTAMA (disusun arsitek utama sebelum eksekusi — jalankan sesuai rencana ini " +
    "bila memungkinkan; bila tidak mungkin, jelaskan di reply dan beri alternatif yang aman):\n" +
    note +
    "\n\n"
  )
}

function mechanicsBlock(note?: string): string {
  if (!note) return ""
  return (
    "MEKANIKA APLIKASI (diambil dari kode — patuhi efek & batasan ini; " +
    "JANGAN memakai aksi/parameter yang tidak disebut di daftar AKSI):\n" + note + "\n\n"
  )
}

function assetBlock(note?: string): string {
  if (!note) return ""
  return (
    "REKOMENDASI ASET 3D / MODEL NYATA DARI LIBRARY (rekomendasikan & gunakan bila relevan):\n" + note + "\n\n"
  )
}

function buildInteriorMessages(
  scene: InteriorScene,
  instruction: string,
  history: AssistantTurn[],
  knowledgeNote?: string,
  mechanicsNote?: string,
  assetNote?: string,
  brief?: Brief | null,
): ChatMsg[] {
  const catalog = FURNITURE_LIBRARY.map((f) => ({
    id: f.id,
    name: f.name,
    category: f.category,
    roomTypes: f.roomTypes,
  }))
  const styles = INTERIOR_STYLES.map((s) => ({ id: s.id, name: s.name }))
  const sceneJSON = JSON.stringify({
    style: scene.style,
    selectedRoomId: scene.selectedRoomId ?? null,
    rooms: scene.rooms,
  })

  const system: ChatMsg = {
    role: "system",
    content:
      "Kamu asisten editor INTERIOR 3D di aplikasi desain rumah Baruma. Atur furnitur & gaya ruangan sesuai perintah pengguna.\n" +
      'Balas HANYA JSON valid: {"reply":"<1-2 kalimat Bahasa Indonesia>","actions":[<aksi>],"needs_clarify":[{"question":"<Pertanyaan>","suggestions":["<Opsi 1>","<Opsi 2>"]}]}.\n' +
      "Jika perintah tidak jelas / di luar kemampuan, isi reply yang menjelaskan dan actions: [].\n\n" +
      "AKSI (pakai persis nama & field ini):\n" +
      '- {"type":"addFurniture","roomId":"<id>","furnitureId":"<id katalog>"}.\n' +
      '- {"type":"moveFurniture","roomId":"<id>","furnitureId":"<id furnitur di ruang>","x":<meter>,"y":<meter>}.\n' +
      '- {"type":"rotateFurniture","roomId":"<id>","furnitureId":"<id furnitur>"} — putar 90°.\n' +
      '- {"type":"removeFurniture","roomId":"<id>","furnitureId":"<id furnitur>"}.\n' +
      '- {"type":"setStyle","style":"<id gaya>"}.\n' +
      '- {"type":"resetRoom","roomId":"<id>"} — tata ulang otomatis seluruh ruang.\n' +
      '- {"type":"addLight","roomId":"<id>","lightType":"downlight|pendant|wall_lamp|indirect|task|outdoor"} — tambah lampu baru.\n' +
      '- {"type":"moveLight","roomId":"<id>","lightId":"<id lampu di ruang>","x":<meter>,"y":<meter>} — geser posisi lampu.\n' +
      '- {"type":"updateLight","roomId":"<id>","lightId":"<id lampu>","patch":{"lightType"?:"...","colorTemperature"?:"warm|neutral|cool","qty"?:<int>,"heightM"?:<meter>,"watt"?:<1-200, daya per unit — dipakai sirkuit/RAB/estimasi energi>}} — ubah properti lampu.\n' +
      '- {"type":"removeLight","roomId":"<id>","lightId":"<id lampu>"} — hapus lampu.\n' +
      AI_RENDER_ACTION_DOC +
      "\n" +
      "ATURAN:\n" +
      "- HANYA gunakan roomId yang ADA di RUANG di bawah, dan furnitureId katalog dari DAFTAR FURNITUR.\n" +
      "- Untuk move/rotate/remove, furnitureId adalah id furnitur yang SUDAH ada di ruang itu (lihat scene), bukan id katalog.\n" +
      "- Untuk moveLight/updateLight/removeLight, lightId adalah id lampu yang SUDAH ada di ruang itu (lihat scene.rooms[].lighting).\n" +
      "- Pilih furnitur yang cocok dengan tipe ruang.\n" +
      "- Jika pengguna meminta saran / merekomendasikan model 3D (seperti jendela, pintu, atau furnitur), evaluasi dan rekomendasikan model 3D nyata dari daftar REKOMENDASI ASET 3D jika ada.\n" +
      "- Jika pengguna meminta merubah struktur denah fisik (tambah/pindah/hapus ruang fisik), jelaskan ramah bahwa perubahan struktur denah fisik dilakukan di \"Asisten Denah\".\n\n" +
      ATTITUDE_RULES +
      "\n" +
      briefBlock(brief) +
      knowledgeBlock(knowledgeNote) +
      mechanicsBlock(mechanicsNote) +
      assetBlock(assetNote) +
      featureCatalogPromptBlock() +
      `DAFTAR FURNITUR (katalog): ${JSON.stringify(catalog)}\n` +
      `GAYA tersedia: ${JSON.stringify(styles)}\n` +
      `RUANG: ${sceneJSON}`,
  }

  return [system, ...trimHistory(history), { role: "user", content: instruction }]
}

const MAX_CONTEXT_TURNS = 16

/** Map stored thread messages → LLM context turns, annotating applied tool
 *  calls so the model knows what edits already happened. Trims to maxTurns. */
export function buildContextFromMessages(
  messages: AssistantMessage[],
  maxTurns = MAX_CONTEXT_TURNS
): AssistantTurn[] {
  return messages.slice(-maxTurns).map((m) => {
    const applied =
      m.role === "assistant" && m.status === "applied" && m.actionLabels?.length
        ? ` [diterapkan: ${m.actionLabels.join("; ")}]`
        : ""
    return { role: m.role, content: m.content + applied }
  })
}

export function buildMessages(
  mode: EditorAssistantMode,
  scene: AssistantScene,
  instruction: string,
  history: AssistantTurn[],
  /** Penalaran desain terkurasi (design_knowledge) yang relevan — prinsip tata
   *  letak/penempatan. Opsional: bila kosong, prompt persis seperti sebelumnya. */
  knowledgeNote?: string,
  /** Mekanika aplikasi (app_knowledge): efek samping & batasan aksi yang tak
   *  terbaca dari namanya. Membuat agent memilih langkah yang benar-benar
   *  mungkin, bukan aksi yang namanya terdengar cocok. */
  mechanicsNote?: string,
  assetNote?: string,
  brief?: Brief | null,
  /** Rencana singkat dari AGENT UTAMA (floorplan-planner.ts) — hanya relevan
   *  untuk mode floorplan; mode lain mengabaikannya. */
  plannerNote?: string,
): ChatMsg[] {
  return mode === "floorplan"
    ? buildFloorplanMessages(scene as FloorplanScene, instruction, history, knowledgeNote, mechanicsNote, assetNote, brief, plannerNote)
    : buildInteriorMessages(scene as InteriorScene, instruction, history, knowledgeNote, mechanicsNote, assetNote, brief)
}

/* ------------------------------------------------------------------ */
/* Action sanitizer                                                    */
/* ------------------------------------------------------------------ */

function sanitizeFloorplan(raw: unknown[], scene: FloorplanScene): FloorplanAction[] {
  const roomById = new Map(scene.rooms.map((r) => [r.id, r]))
  const floorIds = new Set(scene.floors.map((f) => f.id))
  const openingIds = new Set(scene.openings.map((o) => o.id))
  const electricalIds = new Set((scene.electrical ?? []).map((e) => e.id))
  const waterIds = new Set((scene.water ?? []).map((w) => w.id))
  const facadeElementById = new Map((scene.facadeElements ?? []).map((fe) => [fe.id, fe]))
  const exteriorElementById = new Map((scene.exteriorElements ?? []).map((element) => [element.id, element]))
  const roofZoneIds = new Set((scene.roofZones ?? []).map((z) => z.id))
  const lampIds = new Set((scene.exteriorLamps ?? []).map((l) => l.id))
  const sanitation = scene.sanitation
  /** Ruang host dari wallId "roomId:side" — null bila format/ruang tidak sah. */
  const wallHost = (wallId: string) => {
    const parsed = parseOpeningWall(wallId)
    if (!parsed) return null
    const room = roomById.get(parsed.roomId)
    return room ? { room, side: parsed.side } : null
  }
  const out: FloorplanAction[] = []
  for (const item of raw) {
    const parsed = floorplanActionSchema.safeParse(item)
    if (!parsed.success) continue
    const a = parsed.data

    if (a.type === "aiRender") {
      // Mirrors sanitizeInterior's aiRender branch: fully validated by the
      // zod schema already (target enum, styleNotes ≤240) and roomId is
      // OPTIONAL (target "exterior" has no room) — skip the generic roomId
      // guard below. Without this branch a floorplan-mode aiRender would be
      // silently dropped (roomId, when present, doesn't refer to a
      // FloorplanRoom the loop below would resolve).
      out.push(a)
      continue
    }
    if (a.type === "updateRoom" || a.type === "addOpening" || a.type === "deleteRoom") {
      const room = roomById.get(a.roomId)
      if (!room) continue

      if (a.type === "updateRoom") {
        const patch = { ...a.patch }
        // `void` bebas batas minimal dimensi (floor kecil saja agar tidak
        // degenerate) — konsisten dengan resize/inspector di editor.
        const minRoom = room.type === "void" ? 0.1 : MIN_ROOM
        if (patch.floorId != null && !floorIds.has(patch.floorId)) delete patch.floorId
        if (patch.width != null)
          patch.width = round2(clampNum(patch.width, minRoom, Math.max(minRoom, scene.site.widthM || patch.width)))
        if (patch.depth != null)
          patch.depth = round2(clampNum(patch.depth, minRoom, Math.max(minRoom, scene.site.depthM || patch.depth)))
        if (patch.x != null)
          patch.x = round2(clampNum(patch.x, 0, Math.max(0, scene.site.widthM - (patch.width ?? room.width))))
        if (patch.y != null)
          patch.y = round2(clampNum(patch.y, 0, Math.max(0, scene.site.depthM - (patch.depth ?? room.depth))))
        if (patch.levelOffsetM != null) patch.levelOffsetM = snapLevelOffset(patch.levelOffsetM)
        if (Object.keys(patch).length === 0) continue
        out.push({ type: "updateRoom", roomId: a.roomId, patch })
      } else if (a.type === "addOpening") {
        const widthM =
          (a.kind ? OPENING_KIND_META[a.kind]?.defaultWidthM : undefined) ??
          (a.openingType === "door" ? 0.9 : 1.2)
        out.push({
          type: "addOpening",
          roomId: a.roomId,
          side: a.side,
          positionM: solveOpeningPosition(scene, room, a.side, a.positionM, widthM),
          // kind menang: openingType diturunkan dari meta kind bila keduanya bentrok.
          openingType: a.kind ? OPENING_KIND_META[a.kind].type : a.openingType,
          ...(a.kind ? { kind: a.kind } : {}),
        })
      } else {
        out.push({ type: "deleteRoom", roomId: a.roomId })
      }
    } else if (a.type === "addRoom") {
      out.push({
        type: "addRoom",
        roomType: a.roomType,
        x: round2(clampNum(a.x ?? scene.site.widthM / 2, 0, scene.site.widthM)),
        y: round2(clampNum(a.y ?? scene.site.depthM / 2, 0, scene.site.depthM)),
        // Pass LLM-provided dimensions so simulateFloorplanActions uses the
        // correct footprint (e.g. a 1.2m koridor void) instead of defaultRoomSize.
        ...(a.width != null ? { width: round2(clampNum(a.width, 0.1, scene.site.widthM)) } : {}),
        ...(a.depth != null ? { depth: round2(clampNum(a.depth, 0.1, scene.site.depthM)) } : {}),
      })
    } else if (a.type === "addFloor") {
      out.push({ type: "addFloor" })
    } else if (a.type === "removeFloor") {
      if (floorIds.has(a.floorId)) out.push(a)
    } else if (a.type === "updateFloor") {
      if (!floorIds.has(a.floorId)) continue
      const patch = { ...a.patch }
      if (patch.heightM != null) patch.heightM = round2(clampNum(patch.heightM, 2.0, 4.5))
      if (patch.baseOffsetM != null) patch.baseOffsetM = round2(clampNum(patch.baseOffsetM, 1.0, 20))
      // CANTILEVER (CB3): batas ±CANTILEVER_MAX_M per sumbu — store melakukan
      // clamp final juga (defense in depth), tapi disamakan di sini agar
      // preview simulasi server konsisten dgn hasil di client.
      if (patch.offsetM) {
        patch.offsetM = {
          dx: round2(clampNum(patch.offsetM.dx, -CANTILEVER_MAX_M, CANTILEVER_MAX_M)),
          dy: round2(clampNum(patch.offsetM.dy, -CANTILEVER_MAX_M, CANTILEVER_MAX_M)),
        }
      }
      if (Object.keys(patch).length === 0) continue
      out.push({ type: "updateFloor", floorId: a.floorId, patch })
    } else if (a.type === "updateOpening") {
      if (!openingIds.has(a.openingId)) continue
      const patch = { ...a.patch }
      // kind adalah sumber kebenaran; openingType turunan meta agar tidak ada
      // jendela ber-kind pintu (apply mengeset type dari OPENING_KIND_META).
      if (patch.kind != null && patch.openingType != null) delete patch.openingType
      if (patch.sillHeightM != null) patch.sillHeightM = round2(clampNum(patch.sillHeightM, 0, 3))
      if (patch.headHeightM != null) patch.headHeightM = round2(clampNum(patch.headHeightM, 0.5, 4))
      if (Object.keys(patch).length === 0) continue
      out.push({ type: "updateOpening", openingId: a.openingId, patch })
    } else if (a.type === "deleteOpening") {
      if (openingIds.has(a.openingId)) out.push(a)
    } else if (a.type === "setRoof") {
      const patch = { ...a.patch }
      // Skillion ("miring") boleh landai sampai 5° (paritas editor-inspector);
      // tipe lain tetap 15–40. Tipe efektif = patch.type ?? atap scene saat ini.
      const effType = patch.type ?? scene.roof?.type
      if (patch.slopeDeg != null)
        patch.slopeDeg = clampNum(patch.slopeDeg, effType === "miring" ? 5 : 15, 40)
      if (patch.overhangM != null) patch.overhangM = clampNum(patch.overhangM, 0, 1)
      // lowSide hanya bermakna untuk atap miring — buang bila tipe efektif lain
      // supaya kartu preview tidak menyesatkan.
      if (patch.lowSide != null && effType !== "miring") delete patch.lowSide
      if (Object.keys(patch).length === 0) continue
      out.push({ type: "setRoof", patch })
    } else if (a.type === "addRoofZone") {
      const zone = { ...a.zone }
      if (zone.floorId != null && !floorIds.has(zone.floorId)) delete zone.floorId
      zone.widthM = round2(clampNum(zone.widthM, 0.1, Math.max(0.1, scene.site.widthM)))
      zone.depthM = round2(clampNum(zone.depthM, 0.1, Math.max(0.1, scene.site.depthM)))
      zone.x = round2(clampNum(zone.x, zone.widthM / 2, Math.max(zone.widthM / 2, scene.site.widthM - zone.widthM / 2)))
      zone.y = round2(clampNum(zone.y, zone.depthM / 2, Math.max(zone.depthM / 2, scene.site.depthM - zone.depthM / 2)))
      if (zone.slopeDeg != null) zone.slopeDeg = round2(clampNum(zone.slopeDeg, 0, 60))
      if (zone.overhangM != null) zone.overhangM = round2(clampNum(zone.overhangM, 0, 1))
      if (zone.lowSide != null && zone.type !== "miring") delete zone.lowSide
      out.push({ type: "addRoofZone", zone })
    } else if (a.type === "updateRoofZone") {
      if (!roofZoneIds.has(a.id)) continue
      const patch = { ...a.patch }
      const current = scene.roofZones.find((z) => z.id === a.id)
      if (patch.floorId != null && !floorIds.has(patch.floorId)) delete patch.floorId
      const widthM = round2(clampNum(patch.widthM ?? current?.widthM ?? 0.1, 0.1, Math.max(0.1, scene.site.widthM)))
      const depthM = round2(clampNum(patch.depthM ?? current?.depthM ?? 0.1, 0.1, Math.max(0.1, scene.site.depthM)))
      if (patch.widthM != null) patch.widthM = widthM
      if (patch.depthM != null) patch.depthM = depthM
      if (patch.x != null) patch.x = round2(clampNum(patch.x, widthM / 2, Math.max(widthM / 2, scene.site.widthM - widthM / 2)))
      if (patch.y != null) patch.y = round2(clampNum(patch.y, depthM / 2, Math.max(depthM / 2, scene.site.depthM - depthM / 2)))
      if (patch.slopeDeg != null) patch.slopeDeg = round2(clampNum(patch.slopeDeg, 0, 60))
      if (patch.overhangM != null) patch.overhangM = round2(clampNum(patch.overhangM, 0, 1))
      const effType = patch.type ?? current?.type
      if (patch.lowSide != null && effType !== "miring") delete patch.lowSide
      if (Object.keys(patch).length === 0) continue
      out.push({ type: "updateRoofZone", id: a.id, patch })
    } else if (a.type === "removeRoofZone") {
      if (roofZoneIds.has(a.id)) out.push({ type: "removeRoofZone", id: a.id })
    } else if (a.type === "setRooftop") {
      out.push({ type: "setRooftop", enabled: a.enabled })
    } else if (a.type === "setWallCladding") {
      // claddingId sudah enum-validated oleh zod (11 id katalog); dinding harus
      // milik ruang yang ada di scene.
      if (!wallHost(a.wallId)) continue
      out.push({ type: "setWallCladding", wallId: a.wallId, claddingId: a.claddingId, face: a.face })
    } else if (a.type === "addFacadeElement") {
      if (!wallHost(a.wallId)) continue
      out.push({ type: "addFacadeElement", wallId: a.wallId })
    } else if (a.type === "updateFacadeElement") {
      const fe = facadeElementById.get(a.id)
      if (!fe) continue
      const host = wallHost(fe.wallId)
      const edge = host
        ? host.side === "n" || host.side === "s" ? host.room.width : host.room.depth
        : 30
      const patch = { ...a.patch }
      if (patch.positionM != null) patch.positionM = round2(clampNum(patch.positionM, 0, edge))
      if (patch.widthM != null) patch.widthM = round2(clampNum(patch.widthM, 0.3, edge))
      if (patch.sillHeightM != null) patch.sillHeightM = round2(clampNum(patch.sillHeightM, 0, 3))
      if (patch.heightM != null) patch.heightM = round2(clampNum(patch.heightM, 0.3, 4))
      if (Object.keys(patch).length === 0) continue
      out.push({ type: "updateFacadeElement", id: a.id, patch })
    } else if (a.type === "removeFacadeElement") {
      if (!facadeElementById.has(a.id)) continue
      out.push({ type: "removeFacadeElement", id: a.id })
    } else if (a.type === "addExteriorElement") {
      const element = { ...a.element }
      if (element.floorId && !floorIds.has(element.floorId)) delete element.floorId
      const clampPoint = (point: { x: number; y: number }) => ({
        x: round2(clampNum(point.x, 0, scene.site.widthM)),
        y: round2(clampNum(point.y, 0, scene.site.depthM)),
      })
      if ("start" in element) {
        element.start = clampPoint(element.start)
        element.end = clampPoint(element.end)
        if (segmentLength(element.start, element.end) < 0.2) continue
        element.heightM = round2(clampNum(element.heightM, 0.1, 20))
      } else if ("points" in element) {
        element.points = element.points.map(clampPoint)
        if (isSelfIntersecting(element.points)) continue
      } else {
        element.x = round2(clampNum(element.x, 0, scene.site.widthM))
        element.y = round2(clampNum(element.y, 0, scene.site.depthM))
        element.widthM = round2(clampNum(element.widthM, 0.05, Math.max(0.05, scene.site.widthM)))
        if ("depthM" in element && element.depthM != null)
          element.depthM = round2(clampNum(element.depthM, 0.05, Math.max(0.05, scene.site.depthM)))
        if (element.kind === "portal_frame")
          element.memberSizeM = round2(clampNum(element.memberSizeM, 0.05, Math.min(element.widthM, element.heightM) / 2 - 0.01))
        if (element.kind === "gable_frame")
          element.memberSizeM = round2(clampNum(element.memberSizeM, 0.05, element.widthM / 4 - 0.01))
      }
      out.push({ type: "addExteriorElement", element } as FloorplanAction)
    } else if (a.type === "updateExteriorElement") {
      const existing = exteriorElementById.get(a.id)
      if (!existing) continue
      const patch = { ...a.patch }
      const common = ["floorId", "label", "material"]
      const allowedByKind: Record<string, string[]> = {
        // rotationDeg: store menghitung ulang `end` di sekeliling `start`
        // (lihat updateExteriorElement, editor-store.ts) — start/end tetap
        // sumber kebenaran. pattern (pitch/lebar/rhythm jeruji) HANYA
        // fence/gate; boundary_wall selalu solid (tak diberi pattern).
        boundary_wall: ["start", "end", "heightM", "thicknessM", "rotationDeg"],
        fence: ["start", "end", "heightM", "thicknessM", "rotationDeg", "pattern"],
        sliding_gate: ["start", "end", "heightM", "thicknessM", "rotationDeg", "pattern"],
        swing_gate: ["start", "end", "heightM", "thicknessM", "rotationDeg", "pattern"],
        pedestrian_gate: ["start", "end", "heightM", "thicknessM", "rotationDeg", "pattern"],
        solid_wall: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg"],
        facade_panel: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg"],
        column: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg"],
        chimney: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg"],
        beam: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg"],
        slab: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg"],
        canopy: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg"],
        planter: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg"],
        pergola: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg", "pattern", "posts"],
        portal_frame: ["x", "y", "widthM", "heightM", "depthM", "memberSizeM", "rotationDeg"],
        gable_frame: ["x", "y", "zM", "widthM", "heightM", "eaveLeftM", "eaveRightM", "apexOffsetM", "depthM", "memberSizeM", "rotationDeg"],
        exterior_stair: ["x", "y", "widthM", "lengthM", "riseM", "direction"],
        driveway: ["points", "thicknessM"],
        walkway: ["points", "thicknessM"],
        terrace_surface: ["points", "thicknessM"],
        garden_bed: ["points", "thicknessM", "scatterSeed"],
        asset: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg"],
        plant: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg"],
        tree: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg"],
        exterior_decor: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg"],
        vehicle: ["x", "y", "zM", "widthM", "depthM", "heightM", "rotationDeg"],
      }
      const allowed = new Set([...common, ...(allowedByKind[existing.kind] ?? [])])
      const patchRecord = patch as Record<string, unknown>
      Object.keys(patchRecord).forEach((key) => {
        if (!allowed.has(key)) delete patchRecord[key]
      })
      if (patch.floorId && !floorIds.has(patch.floorId)) delete patch.floorId
      if (patch.x != null) patch.x = round2(clampNum(patch.x, 0, scene.site.widthM))
      if (patch.y != null) patch.y = round2(clampNum(patch.y, 0, scene.site.depthM))
      if (patch.widthM != null) patch.widthM = round2(clampNum(patch.widthM, 0.05, Math.max(0.05, scene.site.widthM)))
      if (patch.depthM != null) patch.depthM = round2(clampNum(patch.depthM, 0.05, Math.max(0.05, scene.site.depthM)))
      if (patch.heightM != null) patch.heightM = round2(clampNum(patch.heightM, 0.05, 20))
      if (patch.lengthM != null) patch.lengthM = round2(clampNum(patch.lengthM, 0.05, Math.max(scene.site.widthM, scene.site.depthM)))
      if (patch.riseM != null) patch.riseM = round2(clampNum(patch.riseM, 0.05, 20))
      if (patch.thicknessM != null) patch.thicknessM = round2(clampNum(patch.thicknessM, 0.01, 2))
      if (patch.rotationDeg != null) patch.rotationDeg = ((patch.rotationDeg % 360) + 360) % 360
      if (patch.start) patch.start = {
        x: round2(clampNum(patch.start.x, 0, scene.site.widthM)),
        y: round2(clampNum(patch.start.y, 0, scene.site.depthM)),
      }
      if (patch.end) patch.end = {
        x: round2(clampNum(patch.end.x, 0, scene.site.widthM)),
        y: round2(clampNum(patch.end.y, 0, scene.site.depthM)),
      }
      if (patch.start || patch.end) {
        const record = existing as Record<string, unknown>
        const existingStart = record.start as { x: number; y: number } | undefined
        const existingEnd = record.end as { x: number; y: number } | undefined
        const start = patch.start ?? existingStart
        const end = patch.end ?? existingEnd
        if (!start || !end || segmentLength(start, end) < 0.2) continue
      }
      if (patch.memberSizeM != null) {
        const record = existing as Record<string, unknown>
        const widthM = patch.widthM ?? Number(record.widthM)
        const heightM = patch.heightM ?? Number(record.heightM)
        patch.memberSizeM = round2(clampNum(
          patch.memberSizeM,
          0.05,
          Math.max(0.05, Math.min(widthM, heightM) / 2 - 0.01),
        ))
      }
      if (patch.points) {
        patch.points = patch.points.map((point) => ({
          x: round2(clampNum(point.x, 0, scene.site.widthM)),
          y: round2(clampNum(point.y, 0, scene.site.depthM)),
        }))
        if (isSelfIntersecting(patch.points)) continue
      }
      if (Object.keys(patch).length === 0) continue
      out.push({ type: "updateExteriorElement", id: a.id, patch })
    } else if (a.type === "removeExteriorElement") {
      if (!exteriorElementById.has(a.id)) continue
      out.push(a)
    } else if (a.type === "applyFacadeTemplate") {
      out.push(a)
    } else if (a.type === "addWallLamp") {
      if (!wallHost(a.wallId)) continue
      out.push({ type: "addWallLamp", wallId: a.wallId })
    } else if (a.type === "updateLamp") {
      // Id harus ada di daftar lampu EFEKTIF (scene.exteriorLamps memuat
      // penempatan otomatis yang sudah dimaterialisasi client).
      if (!lampIds.has(a.id)) continue
      const patch = { ...a.patch }
      if (patch.intensity != null) patch.intensity = clampNum(patch.intensity, 0, 2)
      if (patch.watt != null) patch.watt = clampNum(patch.watt, 1, 100)
      if (patch.mountH != null) patch.mountH = round2(clampNum(patch.mountH, 0.2, 4))
      if (Object.keys(patch).length === 0) continue
      out.push({ type: "updateLamp", id: a.id, patch })
    } else if (a.type === "removeLamp") {
      if (!lampIds.has(a.id)) continue
      out.push({ type: "removeLamp", id: a.id })
    } else if (a.type === "setRooftopArea") {
      // Coordinates are validated finite/positive by zod; the store clamps the
      // rect to the building footprint on apply, so no clamping is done here.
      out.push({ type: "setRooftopArea", area: a.area })
    } else if (a.type === "clearRooftopArea") {
      out.push({ type: "clearRooftopArea" })
    } else if (a.type === "setSoilBearing") {
      out.push({ type: "setSoilBearing", soilBearingKPa: clampNum(a.soilBearingKPa, 50, 400) })
    } else if (a.type === "addElectricalPoint") {
      // roomId must exist; pointType already enum-validated by zod; x/y clamped
      // to the lot (coords are absolute metres, y-UP — matches the store).
      if (!roomById.has(a.roomId)) continue
      out.push({
        type: "addElectricalPoint",
        roomId: a.roomId,
        pointType: a.pointType,
        x: round2(clampNum(a.x, 0, scene.site.widthM)),
        y: round2(clampNum(a.y, 0, scene.site.depthM)),
      })
    } else if (a.type === "moveElectricalPoint") {
      if (!electricalIds.has(a.id)) continue
      out.push({
        type: "moveElectricalPoint",
        id: a.id,
        x: round2(clampNum(a.x, 0, scene.site.widthM)),
        y: round2(clampNum(a.y, 0, scene.site.depthM)),
      })
    } else if (a.type === "updateElectricalPoint") {
      if (!electricalIds.has(a.id)) continue
      const patch = { ...a.patch }
      if (patch.roomId != null && !roomById.has(patch.roomId)) delete patch.roomId
      if (Object.keys(patch).length === 0) continue
      out.push({ type: "updateElectricalPoint", id: a.id, patch })
    } else if (a.type === "removeElectricalPoint") {
      if (!electricalIds.has(a.id)) continue
      out.push({ type: "removeElectricalPoint", id: a.id })
    } else if (a.type === "autoGenerateElectrical") {
      if (a.floorId != null && !floorIds.has(a.floorId)) continue
      out.push({ type: "autoGenerateElectrical", floorId: a.floorId })
    } else if (a.type === "addWaterPoint") {
      // roomId must exist; waterType already enum-validated by zod; x/y clamped
      // to the lot (absolute metres, y-UP — matches the store, like electrical).
      if (!roomById.has(a.roomId)) continue
      out.push({
        type: "addWaterPoint",
        roomId: a.roomId,
        waterType: a.waterType,
        x: round2(clampNum(a.x, 0, scene.site.widthM)),
        y: round2(clampNum(a.y, 0, scene.site.depthM)),
      })
    } else if (a.type === "moveWaterPoint") {
      if (!waterIds.has(a.id)) continue
      out.push({
        type: "moveWaterPoint",
        id: a.id,
        x: round2(clampNum(a.x, 0, scene.site.widthM)),
        y: round2(clampNum(a.y, 0, scene.site.depthM)),
      })
    } else if (a.type === "updateWaterPoint") {
      if (!waterIds.has(a.id)) continue
      const patch = { ...a.patch }
      if (patch.roomId != null && !roomById.has(patch.roomId)) delete patch.roomId
      if (Object.keys(patch).length === 0) continue
      out.push({ type: "updateWaterPoint", id: a.id, patch })
    } else if (a.type === "removeWaterPoint") {
      if (!waterIds.has(a.id)) continue
      out.push({ type: "removeWaterPoint", id: a.id })
    } else if (a.type === "autoGenerateWater") {
      if (a.floorId != null && !floorIds.has(a.floorId)) continue
      out.push({ type: "autoGenerateWater", floorId: a.floorId })
    } else if (a.type === "moveSanitationObject") {
      // The targeted object must exist in the scene's sanitation bag. Control
      // boxes are indexed by `ref`; septic/soakwell ignore it. x/y clamp to the
      // whole lot (these objects live on the Site, not inside a room).
      const exists =
        a.kind === "controlBox"
          ? a.ref != null && a.ref < (sanitation?.controlBoxes?.length ?? 0)
          : Boolean(sanitation?.[a.kind])
      if (!exists) continue
      out.push({
        type: "moveSanitationObject",
        kind: a.kind,
        ...(a.ref != null ? { ref: a.ref } : {}),
        x: round2(clampNum(a.x, 0, scene.site.widthM)),
        y: round2(clampNum(a.y, 0, scene.site.depthM)),
      })
    } else if (a.type === "autoSizeSanitation") {
      out.push({ type: "autoSizeSanitation" })
    }
  }
  return out
}

function sanitizeInterior(raw: unknown[], scene: InteriorScene): InteriorAction[] {
  const roomById = new Map(scene.rooms.map((r) => [r.roomId, r]))
  const out: InteriorAction[] = []
  for (const item of raw) {
    const parsed = interiorActionSchema.safeParse(item)
    if (!parsed.success) continue
    const a = parsed.data

    if (a.type === "setStyle") {
      out.push(a) // style already validated by the enum schema
      continue
    }
    if (a.type === "aiRender") {
      // Fully validated by the zod schema already (target enum, styleNotes
      // ≤240) and roomId is OPTIONAL (target "exterior" has no room) — skip
      // the generic roomId guard below. Prompt grounding/instructions for
      // the LLM to emit this land in a follow-up task; forward a well-formed
      // call through untouched so it survives sanitization.
      out.push(a)
      continue
    }
    const room = roomById.get(a.roomId)
    if (!room) continue

    if (a.type === "addFurniture") {
      if (!getFurniture(a.furnitureId)) continue
      out.push(a)
    } else if (a.type === "resetRoom") {
      out.push(a)
    } else if (a.type === "addLight") {
      out.push(a)
    } else if (a.type === "moveLight") {
      if (!room.lighting.some((l) => l.id === a.lightId)) continue
      out.push({
        type: "moveLight",
        roomId: a.roomId,
        lightId: a.lightId,
        x: round2(clampNum(a.x, 0, room.widthM)),
        y: round2(clampNum(a.y, 0, room.depthM)),
      })
    } else if (a.type === "updateLight") {
      if (!room.lighting.some((l) => l.id === a.lightId)) continue
      const patch = { ...a.patch }
      if (patch.watt != null) patch.watt = clampNum(patch.watt, 1, 200)
      out.push({ ...a, patch })
    } else if (a.type === "removeLight") {
      if (!room.lighting.some((l) => l.id === a.lightId)) continue
      out.push(a)
    } else {
      // move / rotate / remove furniture → furnitureId must be an instance already in the room
      if (!room.furniture.some((f) => f.id === a.furnitureId)) continue
      out.push(a)
    }
  }
  return out
}

export function sanitizeActions(
  mode: EditorAssistantMode,
  raw: unknown[],
  scene: AssistantScene
): FloorplanAction[] | InteriorAction[] {
  return mode === "floorplan"
    ? sanitizeFloorplan(raw, scene as FloorplanScene)
    : sanitizeInterior(raw, scene as InteriorScene)
}

/* ------------------------------------------------------------------ */
/* Floorplan validation loop (server-side self-correction)             */
/* ------------------------------------------------------------------ */

type FloorplanRoom = FloorplanScene["rooms"][number]

function floorplanLayoutFromScene(
  scene: FloorplanScene,
  rooms: FloorplanRoom[] = scene.rooms,
  sanitation: FloorplanScene["sanitation"] = scene.sanitation
): DesignLayout {
  const roomById = new Map(rooms.map((room) => [room.id, room]))
  const openings: Opening[] = scene.openings.flatMap((opening) => {
    const room = roomById.get(opening.roomId)
    if (!room) return []
    const side = ["n", "e", "s", "w"].includes(opening.side) ? opening.side : "n"
    const type = opening.type === "door" || opening.type === "window" ? opening.type : "window"
    return [{
      id: opening.id,
      floorId: room.floorId,
      wallId: `${opening.roomId}:${side}`,
      type,
      positionM: opening.positionM,
      widthM: type === "door" ? 0.9 : 1.2,
      heightM: type === "door" ? 2.1 : 1.2,
    }]
  })

  return {
    id: "assistant-scene",
    projectId: "assistant",
    versionId: "assistant",
    floors: scene.floors.map((floor) => ({ ...floor, heightM: 3 })),
    rooms: rooms.map((room) => ({ ...room, areaM2: roomArea(room.width, room.depth) })) as Room[],
    walls: [],
    openings,
    stairs: [],
    pools: [],
    electrical: scene.electrical as DesignLayout["electrical"],
    water: scene.water as DesignLayout["water"],
    sanitation: sanitation as
      | { septicTank?: SanitationObject; soakwell?: SanitationObject; controlBoxes?: SanitationObject[] }
      | undefined,
    validation: { passed: true, issues: [] },
  }
}

export function summarizeFloorplanIssues(
  scene: FloorplanScene,
  rooms: FloorplanRoom[] = scene.rooms,
  sanitation: FloorplanScene["sanitation"] = scene.sanitation
): ValidationIssue[] {
  return validateLayout(floorplanLayoutFromScene(scene, rooms, sanitation), scene.site).issues
}

function normalizeIssueText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

function issueRepairKeywords(issue: ValidationIssue): string[] {
  if (issue.id.startsWith("small:")) return ["cukup kecil", "kecil", "luas", "area"]
  if (issue.id.startsWith("vent:")) return ["ventilasi", "jendela", "pintu"]
  if (issue.id.startsWith("overlap:")) return ["bertumpuk", "tumpang tindih", "overlap"]
  if (issue.id.startsWith("bounds:")) return ["keluar", "batas tanah", "lahan"]
  if (issue.id.startsWith("sanitation-overlap:")) return ["sumur resapan", "septic", "bak kontrol", "resapan"]
  if (issue.id.startsWith("rooftop-outside:")) return ["rooftop", "deck"]
  return ["peringatan"]
}

function mentionedIssues(
  instruction: string,
  scene: FloorplanScene,
  issues: ValidationIssue[]
): ValidationIssue[] {
  const norm = normalizeIssueText(instruction)
  const repairIntent =
    norm.includes("perbaiki peringatan") ||
    norm.includes("tangani peringatan") ||
    norm.includes("benahi peringatan") ||
    norm.includes("bantu perbaiki")
  const roomById = new Map(scene.rooms.map((room) => [room.id, room]))

  const found = issues.filter((issue) => {
    const message = normalizeIssueText(issue.message)
    if (message && norm.includes(message.slice(0, Math.min(42, message.length)))) return true

    const room = issue.objectId ? roomById.get(issue.objectId) : null
    const roomName = room ? normalizeIssueText(room.name) : ""
    const roomTypeLabel = room?.type ? normalizeIssueText(ROOM_TYPES[room.type as keyof typeof ROOM_TYPES]?.label ?? room.type) : ""
    const mentionsObject = Boolean(
      (roomName && norm.includes(roomName)) ||
      (roomTypeLabel && norm.includes(roomTypeLabel))
    )
    const mentionsIssueKind = issueRepairKeywords(issue).some((keyword) => norm.includes(keyword))
    if (mentionsObject && mentionsIssueKind) return true
    if (repairIntent && issue.objectId && issue.objectId === scene.selectedRoomId) return true
    return false
  })

  if (found.length > 0) return found
  return repairIntent && issues.length === 1 ? issues : []
}

export function findFloorplanProposalFeedback(
  scene: FloorplanScene,
  rooms: FloorplanRoom[],
  sanitation: FloorplanScene["sanitation"],
  instruction: string
): string[] {
  const feedback = findFloorplanViolations(rooms, scene.site, sanitation, scene.floors)
  const beforeIssues = summarizeFloorplanIssues(scene)
    .filter((issue) => issue.category === "spatial")
  const afterIssues = summarizeFloorplanIssues(scene, rooms, sanitation)
    .filter((issue) => issue.category === "spatial")
  const beforeIds = new Set(beforeIssues.map((issue) => issue.id))
  const hardText = new Set(feedback)

  for (const issue of afterIssues) {
    if (beforeIds.has(issue.id)) continue
    const text = `memunculkan peringatan baru: ${issue.message}`
    if (!hardText.has(text)) feedback.push(text)
  }

  const requested = mentionedIssues(instruction, scene, beforeIssues)
  for (const issue of requested) {
    if (!afterIssues.some((after) => after.id === issue.id)) continue
    feedback.push(`peringatan belum terselesaikan: ${issue.message}`)
  }

  return [...new Set(feedback)]
}

/**
 * Pemeriksaan BUKAAN untuk setiap usulan addOpening — dari jalur mana pun
 * (deterministik, loop JSON LLM, loop tool LLM; keduanya lewat gerbang ini).
 *
 * Lahir dari insiden produksi: agent menaruh pintu di titik tengah dinding
 * penuh, jatuh di depan tetangga yang salah, MENABRAK pintu yang sudah ada di
 * sisi seberang (terdaftar atas wallId ruang tetangga sehingga tak terlihat
 * cek satu-sisi), dan koneksi yang dijanjikan tidak pernah terjadi. Prinsip:
 * sebelum menaruh bukaan, keadaan dinding itu — KEDUA sisinya — harus
 * diperhitungkan dulu.
 */
export function findOpeningActionFeedback(
  scene: FloorplanScene,
  actions: FloorplanAction[]
): string[] {
  const feedback: string[] = []
  const roomById = new Map(scene.rooms.map((r) => [r.id, r]))
  // Usulan yang sudah lolos ikut jadi "keadaan" bagi usulan berikutnya, agar
  // dua pintu dalam satu proposal tidak saling menabrak.
  const existing = scene.openings.map((o) => ({
    id: o.id, roomId: o.roomId, side: o.side as Side,
    positionM: o.positionM, widthM: o.widthM ?? 0.9, type: o.type,
  }))

  for (const a of actions) {
    if (a.type !== "addOpening") continue
    const host = roomById.get(a.roomId)
    if (!host) continue
    const widthM =
      (a.kind ? OPENING_KIND_META[a.kind]?.defaultWidthM : undefined) ??
      (a.openingType === "door" ? 0.9 : 1.2)

    const conflicts = findOpeningConflicts(
      host, a.side, a.positionM, widthM, existing, scene.rooms,
    )
    if (conflicts.length) {
      const names = conflicts
        .map((c) => {
          const cHost = roomById.get(c.roomId)
          return `${c.type === "door" ? "pintu" : "jendela"} yang sudah ada di dinding ${cHost?.name ?? c.roomId}`
        })
        .join(", ")
      feedback.push(
        `${a.openingType === "door" ? "pintu" : "jendela"} baru di ${host.name} menabrak ${names} ` +
          `(bukaan di dinding bersama terdaftar di salah satu sisi tapi menempati dinding yang sama) — geser posisinya`,
      )
    }

    // Pintu antar dua ruang yang SUDAH terhubung pintu di dinding itu =
    // duplikasi; selaraskan dengan pintu yang ada alih-alih menambah.
    if (a.openingType === "door") {
      const servedNeighbor = neighborServedByOpening(
        host, a.side, a.positionM, widthM, scene.rooms,
      )
      if (servedNeighbor) {
        const already = existing.some((o) => {
          if (o.type !== "door") return false
          const oHost = roomById.get(o.roomId)
          if (!oHost) return false
          const oNb = neighborServedByOpening(oHost, o.side, o.positionM, o.widthM, scene.rooms)
          const pair = new Set([oHost.id, oNb?.id])
          return pair.has(host.id) && pair.has(servedNeighbor.id)
        })
        if (already) {
          feedback.push(
            `sudah ada pintu yang menghubungkan ${host.name} dan ${roomById.get(servedNeighbor.id)?.name ?? servedNeighbor.id} — ` +
              `pakai/selaraskan pintu yang ada alih-alih menambah pintu kedua`,
          )
        }
      }
    }

    existing.push({
      id: `usulan-${existing.length}`, roomId: a.roomId, side: a.side,
      positionM: a.positionM, widthM, type: a.openingType,
    })
  }
  return feedback
}

/**
 * Posisi bukaan usulan LLM, ditegakkan ke geometri yang sah.
 *
 * Jalur deterministik (generator, connect-rooms) sejak dulu memakai
 * `freeDoorPosition` — margin dari ujung dinding & titik pertemuan tembok,
 * di dalam bentang bersama tetangga. Jalur LLM tidak: ia hanya meng-clamp ke
 * `[0, edge]`, sehingga `positionM: 0` dari model diterima apa adanya dan
 * kusen mendarat persis di sudut. Itulah keluhan produksi "bukaan pintunya
 * pas di titik pertemuan/sudut tembok".
 *
 * Aturannya sendiri sudah tertulis di domain-knowledge-pintu.md §1: sisakan
 * 10–15 cm dari dinding tegak lurus, atau daun pintu mentok saat dibuka 90°.
 *
 * Kontraknya: LLM memilih NIAT (dinding mana, ruang mana yang dituju), kode
 * yang menghitung POSISI presisi — pola yang sama dengan cost/area Baruma
 * yang deterministik sementara LLM hanya mengisi narasi.
 *
 * Niat LLM tetap dihormati: dari semua posisi yang sah, dipilih yang PALING
 * DEKAT dengan angka yang ia minta. Bila dinding itu tak punya tempat sah
 * sama sekali, jatuh ke clamp lama — `findOpeningActionFeedback` yang akan
 * melaporkannya, alih-alih aksi hilang diam-diam.
 */
function solveOpeningPosition(
  scene: FloorplanScene,
  room: FloorplanRoom,
  side: Side,
  requestedM: number,
  widthM: number
): number {
  const edge = side === "n" || side === "s" ? room.width : room.depth
  const fallback = round2(clampNum(requestedM, 0, edge))
  const rooms = scene.rooms.filter((r) => r.floorId === room.floorId)
  // Scene assistant sudah menyimpan roomId+side terpisah (bukan wallId
  // gabungan), sama seperti yang dipakai findOpeningActionFeedback.
  const refs = scene.openings.map((o) => ({
    id: o.id,
    roomId: o.roomId,
    side: o.side as Side,
    positionM: o.positionM,
    widthM: o.widthM ?? 0.9,
    type: o.type,
  }))

  // Tetangga yang DIMAKSUD: ruang yang dilayani segmen di posisi yang diminta.
  // Bila ada, penempatan dikunci ke bentang bersama dengan ruang itu — supaya
  // pintu benar-benar membuka ke ruang yang dimaksud LLM, bukan meleset ke
  // tetangga lain di dinding yang sama.
  const intended = neighborServedByOpening(room, side, fallback, widthM, rooms)
  const solved = freeDoorPosition(room, side, intended, widthM, refs, rooms)
  if (solved == null) return fallback

  // Hormati niat LLM: dari kandidat sah, ambil yang terdekat ke permintaannya.
  const half = widthM / 2
  const lo = half + OPENING_EDGE_MARGIN_M
  const hi = edge - half - OPENING_EDGE_MARGIN_M
  if (hi < lo) return solved
  let best = solved
  let bestGap = Math.abs(solved - fallback)
  for (let p = lo; p <= hi + 1e-9; p = round2(p + 0.1)) {
    const gap = Math.abs(p - fallback)
    if (gap >= bestGap) continue
    if (intended && neighborServedByOpening(room, side, p, widthM, rooms)?.id !== intended.id) continue
    if (findOpeningConflicts(room, side, p, widthM, refs, rooms).length) continue
    if (wallJunctions(room, side, rooms).some((j) => Math.abs(j - p) < half + OPENING_EDGE_MARGIN_M - 1e-9)) continue
    best = round2(p)
    bestGap = gap
  }
  return best
}

/** Lantai yang disebut instruksi ("lantai 2", "lantai ke-3"). Null bila tak
 *  disebut — aturan lintas-lantai hanya aktif saat lantai eksplisit. */
function mentionedFloorLevel(instruction: string): number | null {
  const m = /lantai\s*(?:ke-?\s*)?(\d+)/i.exec(instruction)
  return m ? parseInt(m[1], 10) : null
}

/**
 * GUARD ANTI-DESTRUKTIF — insiden produksi 2026-08-01 (proj-modern-tropis-1):
 * user minta "kerjakan lantai 2", agent membalas deleteRoom ×10 yang menghapus
 * SEMUA ruang lantai 1, status "applied", design_layouts jadi 0 ruang.
 * Guard konektivitas tidak menangkapnya: semua ruang terhapus → tidak ada
 * ruang yang "terputus". Tiga aturan di sini menolak usulan seperti itu
 * SEBELUM sampai ke UI:
 *  (1) menghapus ≥50% ruang satu lantai (atau mengosongkan lantai) sekaligus;
 *  (2) menghapus ruang di lantai BERBEDA dari lantai yang disebut instruksi;
 *  (3) addRoom tanpa floorId padahal instruksi menyebut lantai lain yang ada —
 *      akar insiden: ruang lantai 2 dibuat di floor-1 karena lupa floorId
 *      (solusi yang benar: updateRoom.floorId, bukan hapus-buat-ulang).
 */
export function findDestructiveDeletionFeedback(
  scene: FloorplanScene,
  actions: FloorplanAction[],
  instruction: string
): string[] {
  const out: string[] = []
  const roomsOnFloor = new Map<string, number>()
  for (const r of scene.rooms) {
    roomsOnFloor.set(r.floorId, (roomsOnFloor.get(r.floorId) ?? 0) + 1)
  }
  const roomsById = new Map(scene.rooms.map((r) => [r.id, r]))

  const deletes = actions.filter(
    (a): a is Extract<FloorplanAction, { type: "deleteRoom" }> => a.type === "deleteRoom"
  )
  if (deletes.length > 0) {
    const deletedFloorIds = new Map<string, number>()
    for (const d of deletes) {
      const room = roomsById.get(d.roomId)
      if (!room) continue
      deletedFloorIds.set(room.floorId, (deletedFloorIds.get(room.floorId) ?? 0) + 1)
    }

    // (1) Menghapus mayoritas/semua ruang satu lantai sekaligus.
    for (const [floorId, count] of deletedFloorIds) {
      const total = roomsOnFloor.get(floorId) ?? 0
      // Mayoritas KETAT (>50%): "hapus taman & gudang" dari lantai 4 ruang
      // (2/4 = 50%) tetap sah; menghapus SEMUA/terbanyak ruang (10/10 insiden
      // 2026-08-01, 3/4, 1/1) ditolak.
      if (total > 0 && count / total > 0.5) {
        out.push(
          `Usulan menghapus ${count}/${total} ruang di "${floorId}" sekaligus. JANGAN hapus mayoritas/semua ruang satu lantai dalam satu usulan — bila hanya perlu memindahkan, gunakan updateRoom.floorId; bila benar-benar menghapus, pecah menjadi beberapa usulan kecil yang jelas diminta pengguna.`
        )
        break
      }
    }

    // (2) Menghapus ruang di lantai yang tidak diminta instruksi.
    const level = mentionedFloorLevel(instruction)
    if (level != null) {
      const requestedFloorId = scene.floors.find((f) => f.level === level)?.id
      if (requestedFloorId) {
        const foreign = deletes.some((d) => {
          const room = roomsById.get(d.roomId)
          return room && room.floorId !== requestedFloorId
        })
        if (foreign) {
          out.push(
            `Instruksi menyebut lantai ${level}, tapi usulan menghapus ruang di lantai LAIN. Jangan sentuh lantai yang tidak diminta pengguna.`
          )
        }
      }
    }
  }

  // (3) addRoom tanpa floorId saat instruksi menyebut lantai tujuan yang ada.
  const level = mentionedFloorLevel(instruction)
  if (level != null && scene.floors.some((f) => f.level === level)) {
    const missing = actions.some(
      (a): a is Extract<FloorplanAction, { type: "addRoom" }> =>
        a.type === "addRoom" && !a.floorId
    )
    if (missing) {
      out.push(
        `Instruksi menyebut lantai ${level}, tapi ada addRoom TANPA floorId — ruang akan jatuh ke lantai aktif yang salah. WAJIB sertakan floorId "${scene.floors.find((f) => f.level === level)?.id}" pada setiap addRoom.`
      )
    }
  }

  return out
}

export function findFloorplanActionFeedback(
  scene: FloorplanScene,
  actions: FloorplanAction[],
  instruction: string,
  opts?: { allowFullReset?: boolean }
): string[] {
  try {
    return [
      ...findFloorplanProposalFeedback(
        scene,
        simulateFloorplanActions(actions, scene),
        simulateSanitation(actions, scene),
        instruction
      ),
      ...findOpeningActionFeedback(scene, actions),
      // Invariant arsitektur: rumah harus tetap bisa dihuni. Bukaan yang sah
      // secara geometri tetap salah bila membuat sebuah ruang cuma bisa
      // dimasuki lewat luar rumah.
      ...findConnectivityRegressions(scene, actions),
      // Guard anti-destruktif: cegah usulan yang menghapus mayoritas ruang /
      // lantai yang tidak diminta / addRoom tanpa floorId (insiden 2026-08-01).
      // Pengecualian satu-satunya: reset EKSPLISIT ("bangun ulang dari 0") yang
      // dihasilkan DETERMINISTIK oleh buildInitialFloorplan — pengguna memang
      // meminta denah dikosongkan, jadi deleteRoom massal bukan kecelakaan LLM.
      ...(opts?.allowFullReset
        ? []
        : findDestructiveDeletionFeedback(scene, actions, instruction)),
    ]
  } catch (e) {
    console.error("[editor-assistant] findFloorplanActionFeedback error:", e)
    return []
  }
}

/**
 * Runs the deterministic pairwise-overlap reconciler over a proposed action
 * list and re-validates for real — so the caller learns, in one call,
 * whether the proposal is now clean or still needs an LLM revision.
 */
export function reconcileFloorplanOverlaps(
  scene: FloorplanScene,
  actions: FloorplanAction[],
  instruction: string,
): { actions: FloorplanAction[]; remainingViolations: string[] } {
  const rooms = simulateFloorplanActions(actions, scene)
  const { actions: patchActions } = reconcileOverlappingRooms(scene, rooms)
  // Sanitize BEFORE re-validating: the reconciler's corrective patches are
  // computed against `rooms`, a simulation that includes synthetic ids
  // (e.g. `new-2` for an addRoom action) which don't exist in the real
  // `scene.rooms`. sanitizeActions's floorplan path drops any updateRoom
  // action whose roomId isn't a REAL room, so a patch that only "fixes"
  // a synthetic-only room gets stripped here — causing the re-validation
  // below to correctly still find the original (unfixed) violation instead
  // of falsely certifying the layout as clean. It also re-applies numeric
  // clamping (site bounds, min room size) to the reconciler's raw patches.
  const merged = sanitizeActions("floorplan", [...actions, ...patchActions], scene) as FloorplanAction[]
  const remainingViolations = findFloorplanActionFeedback(scene, merged, instruction)
  return { actions: merged, remainingViolations }
}

const COORD_PAREN_RE = /\s*\([^()]*\bx:[^()]*\)/gi
const QUOTED_NAME_RE = /"([^"]+)"/g

/**
 * Turns internal violation strings (built for the LLM, with raw x/y/width/
 * depth) into a homeowner-readable message: coordinates stripped, room
 * names kept, offered as tappable needs_clarify chips (same JSON-content
 * convention as `clarificationReply` in project-agent.ts) when any are found.
 */
export function humanizeViolations(violations: string[]): string {
  const cleaned = violations.map((v) => v.replace(COORD_PAREN_RE, "").replace(/\s{2,}/g, " ").trim())
  const names = [...new Set(cleaned.flatMap((v) => [...v.matchAll(QUOTED_NAME_RE)].map((m) => m[1])))]
  const body = cleaned.join("; ")
  const reply =
    `Saya belum berhasil menata ini tanpa tumpang-tindih (${body}). ` +
    "Coba perintah yang lebih spesifik — misalnya sebutkan ruang mana yang boleh saya perkecil atau pindahkan untuk memberi ruang."
  if (names.length === 0) return reply
  return JSON.stringify({
    reply,
    needs_clarify: [{ question: "Ruang mana yang boleh diperkecil/dipindah?", suggestions: names }],
  })
}

/** Apply floorplan actions to a clone of the scene rooms, for server-side
 *  overlap pre-checking. addOpening doesn't change room rectangles. */
export function simulateFloorplanActions(
  actions: FloorplanAction[],
  scene: FloorplanScene
): FloorplanRoom[] {
  let rooms = scene.rooms.map((r) => ({ ...r }))
  for (const a of actions) {
    if (a.type === "deleteRoom") {
      rooms = rooms.filter((r) => r.id !== a.roomId)
    } else if (a.type === "updateRoom") {
      const r = rooms.find((x) => x.id === a.roomId)
      if (r) {
        Object.assign(r, a.patch)
        r.areaM2 = roomArea(r.width, r.depth)
      }
    } else if (a.type === "addRoom") {
      const defaultDims = defaultRoomSize(a.roomType)
      const w = a.width ?? defaultDims.width
      const d = a.depth ?? defaultDims.depth
      rooms.push({
        id: `new-${rooms.length}`, name: ROOM_TYPES[a.roomType].label, type: a.roomType,
        floorId: a.floorId ?? scene.selectedFloorId ?? rooms[0]?.floorId ?? "",
        x: a.x ?? 0, y: a.y ?? 0, width: w, depth: d, areaM2: roomArea(w, d),
      })
    }
  }
  return rooms
}

/** Apply any `moveSanitationObject` actions to a clone of the scene's
 *  sanitation bag, for server-side overlap pre-checking (parity with
 *  `simulateFloorplanActions` for rooms). `autoSizeSanitation`'s real SNI
 *  sizing/positioning depends on the full layout + roof area, which this
 *  lightweight scene snapshot doesn't carry — a proposal containing it is
 *  optimistically treated as "resolved" for THIS check; it's re-verified for
 *  real (via `validateLayout`) once actually applied. */
export function simulateSanitation(
  actions: FloorplanAction[],
  scene: FloorplanScene
): FloorplanScene["sanitation"] {
  if (!scene.sanitation) return scene.sanitation
  let sanitation = {
    ...scene.sanitation,
    controlBoxes: scene.sanitation.controlBoxes ? [...scene.sanitation.controlBoxes] : [],
  }
  for (const a of actions) {
    if (a.type !== "moveSanitationObject") continue
    if (a.kind === "septicTank" && sanitation.septicTank) {
      sanitation = { ...sanitation, septicTank: { ...sanitation.septicTank, x: a.x, y: a.y } }
    } else if (a.kind === "soakwell" && sanitation.soakwell) {
      sanitation = { ...sanitation, soakwell: { ...sanitation.soakwell, x: a.x, y: a.y } }
    } else if (a.kind === "controlBox" && a.ref != null && sanitation.controlBoxes[a.ref]) {
      const boxes = sanitation.controlBoxes.slice()
      boxes[a.ref] = { ...boxes[a.ref], x: a.x, y: a.y }
      sanitation = { ...sanitation, controlBoxes: boxes }
    }
  }
  return sanitation
}

/** Human-readable validity problems (room overlaps, out-of-lot, and — when
 *  `sanitation`/`floors` are supplied — ground-floor rooms overlapping the
 *  septic tank / soakwell / control boxes) for a simulated floorplan. Empty
 *  array = valid. Room overlaps are checked per floor. */
export function findFloorplanViolations(
  rooms: FloorplanRoom[],
  site?: { widthM: number; depthM: number },
  sanitation?: FloorplanScene["sanitation"],
  floors?: FloorplanScene["floors"]
): string[] {
  const issues: string[] = []
  const TOL = 0.05
  const s = site && typeof site.widthM === "number" && typeof site.depthM === "number"
    ? site
    : { widthM: 100, depthM: 100 }

  for (const r of rooms) {
    if (
      r.x < -TOL ||
      r.y < -TOL ||
      r.x + r.width > s.widthM + TOL ||
      r.y + r.depth > s.depthM + TOL
    ) {
      issues.push(`"${r.name}" keluar lahan (posisi x:${r.x}, y:${r.y}, ukuran ${r.width}×${r.depth}m; batas lahan max width:${s.widthM}m, depth:${s.depthM}m)`)
    }
  }

  const byFloor = new Map<string, FloorplanRoom[]>()
  for (const r of rooms) {
    const list = byFloor.get(r.floorId) ?? []
    list.push(r)
    byFloor.set(r.floorId, list)
  }
  for (const list of byFloor.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        if (
          rectsOverlap(
            { x: a.x, y: a.y, width: a.width, depth: a.depth },
            { x: b.x, y: b.y, width: b.width, depth: b.depth }
          )
        ) {
          issues.push(`"${a.name}" (x:${a.x}, y:${a.y}, ${a.width}×${a.depth}m) & "${b.name}" (x:${b.x}, y:${b.y}, ${b.width}×${b.depth}m) tumpang-tindih`)
        }
      }
    }
  }

  // Ground-floor rooms vs septic tank / soakwell / control boxes — these are
  // buried yard fixtures at grade, invisible to the room-vs-room check above.
  // Only the combinations `sanitationOverlapSeverity` rates "danger" (a
  // soakwell under anything but a taman — it needs open ground to work) are
  // hard violations here; septic/control-box overlaps surface as editor
  // warnings/info but must NOT make the assistant reject a proposal, or it
  // could never produce a valid answer on a fully-built lot whose sanitation
  // already sits under rooms it cannot move.
  if (sanitation && floors) {
    const sanitationRects = sanitationObstacles(sanitation)
    if (sanitationRects.length > 0) {
      const groundIds = groundFloorIds(floors)
      for (const r of rooms) {
        if (!groundIds.has(r.floorId)) continue
        for (const obj of sanitationRects) {
          if (sanitationOverlapSeverity(r.type, obj.kind) !== "danger") continue
          if (rectsOverlap({ x: r.x, y: r.y, width: r.width, depth: r.depth }, obj.rect)) {
            issues.push(`"${r.name}" bertumpuk dengan ${obj.label}`)
          }
        }
      }
    }
  }

  return issues
}

/** Feedback prompt asking the model to fix the listed violations. */
export function buildRevisionMessage(violations: string[]): string {
  return (
    "Usulanmu BELUM valid: " +
    violations.join("; ") +
    ". Perbaiki agar tidak ada hard conflict, tidak memunculkan warning baru, dan warning yang diminta user benar-benar terselesaikan. " +
    "Kamu boleh memperkecil/menggeser/menukar posisi ruang lain, tetapi jangan membuat ruang servis/ruang utama menjadi terlalu kecil. " +
    'Balas JSON {"reply":"...","actions":[...]} yang sudah diperbaiki.'
  )
}
