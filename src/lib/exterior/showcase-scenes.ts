/**
 * SHOWCASE SCENES — projek demo hand-crafted yang memamerkan grammar fasad
 * penuh (gelombang W1–W3). Pola sama dengan certification-scenes: layout
 * pre-built dipakai mock/dev APA ADANYA (tanpa generateLayout).
 *
 * Scene C merekonstruksi ref-1 (prototipe_fasad_scandi_tropis_v3.html)
 * SETIA PADA PALET & KOMPOSISI prototipe (bukan sekadar fiturnya):
 * - SEMUA dinding putih bersih (0xf8f9fa ≈ bata_putih) — bukan preset greige;
 * - massa kiri lt-2: pelana ASIMETRIS + SOPI-SOPI KACA menghadap jalan,
 *   dengan panel slat kayu di muka gable (aproksimasi panel-3 prototipe);
 * - massa kanan: box datar + jendela ber-HOOD PUTIH (frameDepthM+frameColor);
 * - ROSTER PUTIH di muka kanan + planter gelap + tanaman + 2 pilar putih;
 * - balkon railing BESI tipis; tangga eksterior kiri mendarat di tepinya
 *   (railing otomatis terpotong, R1); kanopi GELAP TIPIS di bawah balkon;
 * - dinding batas properti PUTIH kiri-kanan (bukan pagar besi).
 *
 * Batas grammar yang DIKETAHUI belum tercapai (kandidat W4):
 * - bingkai gable putih ber-outline (prototipe: extruded frame, bukan atap);
 * - roster benar-benar berdiri bebas (roster_screen masih menempel dinding);
 * - sulur/vine menjuntai dari planter gantung; lampu dinding eksterior.
 */
import type {
  DesignLayout,
  ExteriorElement,
  FacadeElement,
  Project,
  Site,
} from "@/types"
import { buildFacadeComposerTemplate } from "@/lib/exterior/facade-templates"
import { buildFacadePreset } from "@/lib/three/facade-presets"
import {
  makeBoxElement,
  makeFrameElement,
  makeGableFrameElement,
  makeRoofZone,
  makeSegmentElement,
  makeStairElement,
  makeSurfaceElement,
} from "@/lib/exterior/factories"

export type ShowcaseScene = {
  id: string
  label: string
  description: string
  project: Project
  site: Site
  layout: DesignLayout
}

const ISO = "2026-08-15T00:00:00.000Z"
const PUTIH = { materialId: "bata_putih" }
const GELAP = { materialId: "granit_hitam" }

function sceneCScandiTropis(): ShowcaseScene {
  const id = "scene-c-scandi-tropis"
  const site: Site = {
    widthM: 12,
    depthM: 20,
    areaM2: 240,
    city: "Bogor",
    province: "Jawa Barat",
    frontOrientation: "south",
    frontRoadWidthM: 6,
  }

  const base: DesignLayout = {
    id: `${id}-layout`,
    projectId: id,
    versionId: `${id}-v1`,
    floors: [
      { id: "floor-1", level: 0, name: "Lantai 1", heightM: 3 },
      { id: "floor-2", level: 1, name: "Lantai 2", heightM: 3 },
    ],
    rooms: [
      // Lantai 1 — dua massa berdampingan, muka depan di y = 13 (front = south).
      { id: "c-living", floorId: "floor-1", name: "Ruang Tamu", type: "ruang_tamu", x: 1.2, y: 7.4, width: 4, depth: 5.6, areaM2: 22.4 },
      { id: "c-dining", floorId: "floor-1", name: "Dapur & Ruang Makan", type: "dapur", x: 5.2, y: 8.8, width: 4.6, depth: 5.6, areaM2: 25.76 },
      // Lantai 2 — massa kiri (gable asimetris) + massa kanan (box datar).
      { id: "c-master", floorId: "floor-2", name: "Kamar Utama", type: "kamar_tidur", x: 1.2, y: 7.4, width: 4, depth: 5.6, areaM2: 22.4 },
      { id: "c-family", floorId: "floor-2", name: "Ruang Keluarga", type: "ruang_keluarga", x: 5.2, y: 8.8, width: 4.6, depth: 5.6, areaM2: 25.76 },
      // Balkon depan massa kiri — railing BESI tipis (ref: 38 batang besi);
      // pendaratan tangga eksterior memotong railingnya otomatis (R1).
      { id: "c-balcony", floorId: "floor-2", name: "Balkon", type: "balkon", x: 1.2, y: 13, width: 4, depth: 1.4, areaM2: 5.6, railingStyle: "besi" },
    ],
    walls: [],
    openings: [
      // Ref-1 lt-1: jendela tinggi kusen hitam + pintu kayu berkusen hitam.
      { id: "c-w-living-1", floorId: "floor-1", wallId: "c-living:s", type: "window", kind: "curtain_wall", positionM: 0.5, widthM: 0.8, heightM: 2.4, sillHeightM: 0.25, frameColor: "#111111" },
      { id: "c-d-entry", floorId: "floor-1", wallId: "c-living:s", type: "door", kind: "pivot_door", positionM: 2.8, widthM: 1.2, heightM: 2.8, frameColor: "#111111" },
      { id: "c-w-dining", floorId: "floor-1", wallId: "c-dining:s", type: "window", kind: "curtain_wall", positionM: 1.2, widthM: 2, heightM: 2.4, sillHeightM: 0.25, frameColor: "#111111" },
      // Lt-2 muka gable = TRI-PANEL prototipe: sepertiga KANAN kaca penuh
      // (curtain wall sill 0 → menyambung visual dgn sopi-sopi kaca di atas,
      // membentuk bidang kaca mengikuti kemiringan); kiri & tengah ditutup
      // panel beton/kayu (exterior facade_panel di bawah).
      { id: "c-w-gable-glass", floorId: "floor-2", wallId: "c-master:s", type: "window", kind: "curtain_wall", positionM: 3.3, widthM: 1.3, heightM: 2.9, sillHeightM: 0.05, frameColor: "#111111" },
      // Jendela vertikal DI TENGAH box kanan (ref winF2 1.2×2.2 di center)
      // + hood putih (frameDepthM). Sebelumnya mepet kiri → muka terasa polos.
      // CATATAN keterbacaan low-poly: frameColor putih (hood putih ref) membuat
      // kusen+hood+kaca menyatu dgn dinding putih — jendela "hilang" secara
      // visual. Satu frameColor mengatur kusen & hood sekaligus → pakai
      // charcoal (kusen hitam ref) agar bukaan terbaca.
      { id: "c-w-family", floorId: "floor-2", wallId: "c-family:s", type: "window", kind: "curtain_wall", positionM: 2.3, widthM: 1.6, heightM: 2.2, sillHeightM: 0.4, frameDepthM: 0.35, frameColor: "#111111" },
      { id: "c-w-master-w", floorId: "floor-2", wallId: "c-master:w", type: "window", kind: "jalousie_window", positionM: 1.6, widthM: 1.4, heightM: 1.4, sillHeightM: 0.9, frameColor: "#111111" },
      // Sisi BARAT (kiri) — jendela tinggi kusen hitam agar tidak polos;
      // semua bisa dibuat user via UI (Tambah jendela) / agent (addOpening).
      { id: "c-w-living-w1", floorId: "floor-1", wallId: "c-living:w", type: "window", kind: "fixed_window", positionM: 1.5, widthM: 0.9, heightM: 2.3, sillHeightM: 0.25, frameColor: "#111111" },
      { id: "c-w-living-w2", floorId: "floor-1", wallId: "c-living:w", type: "window", kind: "fixed_window", positionM: 3.9, widthM: 0.9, heightM: 2.3, sillHeightM: 0.25, frameColor: "#111111" },
    ],
    stairs: [],
    pools: [],
    // Global fallback + fascia gelap utk zona datar (band tepi modern).
    roof: {
      type: "datar",
      slopeDeg: 0,
      overhangM: 0.4,
      material: "genteng_beton",
      fascia: { heightM: 0.35, color: "#3a3f44" },
    },
    roofZones: [
      // Massa kiri: PELANA ASIMETRIS + SOPI-SOPI KACA menghadap jalan (W1).
      // width 4 < depth 5.6 → ridge along y → ujung gable n/s; s = muka depan.
      // ridgeOffset −1: apex condong KIRI seperti prototipe (apex 2.8 dari 5.5).
      {
        ...makeRoofZone("pelana", 3.2, 10.2, {
          id: "c-roof-gable-left",
          floorId: "floor-2",
          widthM: 4,
          depthM: 5.6,
          slopeDeg: 35,
          overhangM: 0.45,
          materialId: "metal",
        }),
        // Ref: apex 2.8/5.5 nyaris tengah tapi condong kiri; asimetri utama
        // prototipe ada di beda tinggi eave (belum ada di grammar — dicatat).
        ridgeOffsetM: -0.5,
        gableEnds: { s: "glass" },
      },
      // Massa kanan: box datar (staggered massing ref-1).
      makeRoofZone("datar", 7.5, 11.6, {
        id: "c-roof-flat-right",
        floorId: "floor-2",
        widthM: 4.6,
        depthM: 5.6,
        slopeDeg: 0,
        overhangM: 0.35,
        materialId: "metal",
      }),
    ],
    validation: { passed: true, issues: [] },
  }

  // Template dipakai hanya untuk PAVING halaman (driveway/walkway/taman) —
  // fence/gate besi, kanopi generik, pilar & tangga template TIDAK sesuai
  // palet prototipe (putih), jadi seluruh elemen keras dirakit manual.
  const template = buildFacadeComposerTemplate(base, site, "scandi_tropis")
  const paving = template.exteriorElements
    .filter((el) => el.kind === "driveway" || el.kind === "walkway" || el.kind === "garden_bed")
    .map((el, i) => ({ ...el, id: `${id}-paving-${i + 1}` }))

  // SEMUA dinding putih bersih (ref matWhite 0xf8f9fa) — timpa peran
  // hero/accent preset. PENTING: key BAND (`roomId:side@sill-head`) dibuang —
  // band adalah panel overlay menonjol yang MENUTUPI jendela di baliknya
  // (inilah yang membuat jendela muka kanan "hilang"); sisakan cladding polos
  // satu per dinding.
  const facade: Record<string, string> = Object.fromEntries(
    Object.keys(template.facade)
      .map((key) => key.split("@")[0])
      .map((key) => [key, "bata_putih"]),
  )

  const facadeElements: FacadeElement[] = [
    // ROSTER PUTIH selebar muka kanan (ref: grid 13×7 blok putih di depan
    // jendela — cahaya hangat menembus dari dalam).
    {
      id: `${id}-roster-putih`,
      wallId: "c-dining:s",
      floorId: "floor-1",
      kind: "roster_screen",
      positionM: 2.3,
      widthM: 4.2,
      sillHeightM: 0.2,
      heightM: 2.3,
      finish: "putih",
    },
    // Sisi BARAT: kisi kayu vertikal (lt-1, di antara jendela) + bilah kayu
    // horizontal (lt-2) — via UI: klik dinding → Tambah kisi/louver.
    {
      id: `${id}-louver-barat`,
      wallId: "c-living:w",
      floorId: "floor-1",
      kind: "louver_band",
      positionM: 2.7,
      widthM: 1.6,
      sillHeightM: 0.3,
      heightM: 2.25,
      finish: "kayu",
    },
    {
      id: `${id}-slat-barat`,
      wallId: "c-master:w",
      floorId: "floor-2",
      kind: "slat_horizontal",
      positionM: 3.9,
      widthM: 2.6,
      sillHeightM: 0.25,
      heightM: 2.5,
      finish: "kayu",
    },
  ]

  const custom: ExteriorElement[] = [
    // Dinding batas properti PUTIH kiri & kanan (ref fenceL/fenceR putih).
    makeSegmentElement("boundary_wall", { x: 0.3, y: 9.5 }, { x: 0.3, y: 19 }, {
      id: `${id}-batas-kiri`, heightM: 2.5, thicknessM: 0.3, material: PUTIH,
    }),
    makeSegmentElement("boundary_wall", { x: 11.7, y: 9.5 }, { x: 11.7, y: 19 }, {
      id: `${id}-batas-kanan`, heightM: 2.5, thicknessM: 0.3, material: PUTIH,
    }),
    // KANOPI GELAP TIPIS menerus di bawah level balkon (ref darkCanopy 9.5×1.8
    // di y3.9) — menaungi pintu masuk & jendela lt-1.
    makeBoxElement("canopy", 5.2, 14.62, {
      id: `${id}-kanopi-gelap`, widthM: 8.4, depthM: 1.5, heightM: 0.16, zM: 2.95, material: GELAP,
    }),
    // BINGKAI GABLE PUTIH (W4 — signature prototipe): outline pelana
    // asimetris berdiri di bidang fasad, kaki KIRI LEBIH TINGGI dari kanan
    // (ref eave 9.5 vs 9.0), apex condong kiri, membungkus tri-panel di
    // bawah. Dasar di lantai balkon (zM 3.18), sedikit proud dari dinding.
    makeGableFrameElement(3.2, 13.35, {
      id: `${id}-gable-frame`,
      widthM: 4.9,
      heightM: 4.55,
      eaveLeftM: 3.15,
      eaveRightM: 2.8,
      apexOffsetM: -0.5,
      memberSizeM: 0.45,
      depthM: 0.55,
      zM: 3.18,
      floorId: "floor-1",
      material: PUTIH,
    }),
    // TRI-PANEL muka gable lt-2 (ref backing wall prototipe: beton | kayu |
    // kaca). Panel beton & kayu = facade_panel setinggi dinding, menempel
    // proud di muka; sepertiga kanan dibiarkan KACA (curtain wall di atas +
    // sopi-sopi kaca meneruskannya mengikuti kemiringan atap).
    makeBoxElement("facade_panel", 1.87, 13.05, {
      id: `${id}-panel-beton`, widthM: 1.34, depthM: 0.12, heightM: 2.95, zM: 3.18,
      material: { materialId: "beton_ekspos" },
    }),
    makeBoxElement("facade_panel", 3.2, 13.05, {
      id: `${id}-panel-kayu`, widthM: 1.32, depthM: 0.12, heightM: 2.95, zM: 3.18,
      material: { materialId: "kayu_cladding" },
    }),
    // PILAR BATU aksen di samping pintu (ref stonePillar 0.6×4.0 dekat pintu).
    makeBoxElement("facade_panel", 3.75, 13.12, {
      id: `${id}-pilar-batu`, widthM: 0.6, depthM: 0.28, heightM: 3.2,
      material: { materialId: "batu_alam_gelap" },
    }),
    // Teras + undakan putih di depan pintu (ref terrace+steps).
    makeBoxElement("slab", 4, 13.6, {
      id: `${id}-teras`, widthM: 2, depthM: 1.2, heightM: 0.26, material: PUTIH,
    }),
    // 2 PILAR PUTIH mengapit area roster (ref pillarR1/R2).
    makeBoxElement("column", 5.5, 14.25, {
      id: `${id}-pilar-putih-1`, widthM: 0.32, depthM: 0.32, heightM: 2.5, material: PUTIH,
    }),
    makeBoxElement("column", 9.9, 14.25, {
      id: `${id}-pilar-putih-2`, widthM: 0.4, depthM: 0.4, heightM: 2.7, material: PUTIH,
    }),
    // PLANTER GELAP memanjang di kaki roster (ref planterRoster 4.2×0.6).
    makeBoxElement("planter", 7.7, 14.35, {
      id: `${id}-planter-roster`, widthM: 4.2, depthM: 0.6, heightM: 0.45, material: GELAP,
    }),
    // PLANTER GANTUNG gelap di bawah jendela massa kanan (ref hangingPlanter;
    // sulur menjuntai = W4).
    makeBoxElement("planter", 7.5, 14.62, {
      id: `${id}-planter-gantung`, widthM: 3.4, depthM: 0.5, heightM: 0.5, zM: 2.75, material: GELAP,
    }),
    // TANGGA EKSTERIOR beton sisi kiri (ref: 20 anak tangga di samping tembok
    // kiri) → mendarat TEPAT di tepi depan balkon (y 14.4): arah "s" = vektor
    // y−, landing = 19 − 4.6 = 14.4 → railing besi balkon otomatis terpotong.
    makeStairElement(2, 19, {
      id: `${id}-stair-balkon`,
      label: "Tangga eksterior → balkon",
      widthM: 1.2,
      lengthM: 4.6,
      riseM: 3.15,
      direction: "s",
      floorId: "floor-1",
      material: { materialId: "beton_ekspos" },
    }),
  ]

  const layout: DesignLayout = {
    ...base,
    facade,
    facadeElements,
    exteriorElements: [...paving, ...custom],
    // LAMPU DINDING arsitektural (ref addWallLight ×4: 2 di muka gable, 2
    // mengapit jendela box kanan). Bisa diedit user via agent addWallLamp/
    // updateLamp/removeLamp; eksplisit = menggantikan penempatan otomatis.
    exteriorLamps: [
      { id: "c-lamp-gable-1", kind: "wall", x: 1.75, y: 13, mountH: 2.3, side: "s", floorId: "floor-2" },
      { id: "c-lamp-gable-2", kind: "wall", x: 3.05, y: 13, mountH: 2.3, side: "s", floorId: "floor-2" },
      { id: "c-lamp-box-1", kind: "wall", x: 6.3, y: 14.4, mountH: 2.2, side: "s", floorId: "floor-2" },
      { id: "c-lamp-box-2", kind: "wall", x: 8.7, y: 14.4, mountH: 2.2, side: "s", floorId: "floor-2" },
    ],
  }

  const project: Project = {
    id,
    name: "Rumah Scandi Tropis — Gable Kaca",
    status: "editing",
    readiness: "contractor_discussion_ready",
    projectType: "new",
    thumbnail: "vertical",
    style: "scandinavian",
    location: "Bogor, Jawa Barat",
    city: "Bogor",
    province: "Jawa Barat",
    site,
    floors: 2,
    rooftop: false,
    createdAt: ISO,
    updatedAt: ISO,
  }

  return {
    id,
    label: "Scene C — Scandi Tropis (ref-1)",
    description:
      "Rekonstruksi prototipe scandi-tropis: dinding putih, gable asimetris + kaca, roster putih + planter + pilar, tangga eksterior ke balkon railing besi, kanopi gelap tipis, hood jendela putih.",
    project,
    site,
    layout,
  }
}


/**
 * SCENE D — "Modern Tropis Klasik" (ref prototipe_fasad_modern_klasik_v2):
 * - CORNICE KLASIK BERUNDAK (stepped crown molding): 3 box canopy bertumpuk
 *   makin lebar, di DUA level — pemisah lantai (sekaligus kanopi carport &
 *   lantai balkon) dan mahkota atap;
 * - pilar besar putih ber-MOLDING PANEL (portal_frame trim) + cagak pagar
 *   ber-molding; pagar & GERBANG BESI hitam; pintu kayu gelap;
 * - balkon KACA selebar rumah (railing kaca + handrail), dinding lt-2 kiri
 *   bertekstur garis (slat horizontal putih), jendela kusen besi;
 * - dinding carport ABU GELAP; 2 lampion dinding + 2 lampion cagak (bollard).
 * Pelajaran w-edge diterapkan: balkon selebar rumah menutup seluruh tepi
 * selatan lt-2 → tidak ada dinding tepi sintetis yang mengubur fasad.
 */
function sceneDModernKlasik(): ShowcaseScene {
  const id = "scene-d-modern-klasik"
  const TRIM = { materialId: "bata_putih" }
  const BESI = { materialId: "metal_gelap" }
  const site: Site = {
    widthM: 12,
    depthM: 20,
    areaM2: 240,
    city: "Jakarta",
    province: "DKI Jakarta",
    frontOrientation: "south",
    frontRoadWidthM: 8,
  }

  const base: DesignLayout = {
    id: `${id}-layout`,
    projectId: id,
    versionId: `${id}-v1`,
    floors: [
      { id: "floor-1", level: 0, name: "Lantai 1", heightM: 3.1 },
      { id: "floor-2", level: 1, name: "Lantai 2", heightM: 3 },
    ],
    rooms: [
      { id: "d-tamu", floorId: "floor-1", name: "Ruang Tamu", type: "ruang_tamu", x: 1.5, y: 8.4, width: 3.6, depth: 4.6, areaM2: 16.56 },
      { id: "d-carport", floorId: "floor-1", name: "Carport", type: "carport", x: 5.1, y: 8.4, width: 5.4, depth: 6, areaM2: 32.4 },
      { id: "d-master", floorId: "floor-2", name: "Kamar Utama", type: "kamar_tidur", x: 1.5, y: 8.4, width: 3.6, depth: 4.6, areaM2: 16.56 },
      { id: "d-keluarga", floorId: "floor-2", name: "Ruang Keluarga", type: "ruang_keluarga", x: 5.1, y: 8.4, width: 5.4, depth: 4.6, areaM2: 24.84 },
      // Balkon KACA selebar rumah (ref railing 8.6 m) — sekaligus menutup
      // tepi selatan footprint lt-2 (anti w-edge).
      { id: "d-balkon", floorId: "floor-2", name: "Balkon", type: "balkon", x: 1.5, y: 13, width: 9, depth: 1.4, areaM2: 12.6, railingStyle: "kaca" },
    ],
    walls: [],
    openings: [
      // L1: pintu kayu gelap + jendela tinggi kusen hitam (ref doorF1/winF1).
      { id: "d-o-pintu", floorId: "floor-1", wallId: "d-tamu:s", type: "door", kind: "pivot_door", positionM: 1.6, widthM: 1.3, heightM: 2.6, frameColor: "#111111" },
      { id: "d-o-jendela1", floorId: "floor-1", wallId: "d-tamu:s", type: "window", kind: "fixed_window", positionM: 3, widthM: 0.8, heightM: 2.6, sillHeightM: 0.15, frameColor: "#111111" },
      // L2 kiri: pintu balkon kaca kusen kayu (ref doorF2L).
      { id: "d-o-balkon", floorId: "floor-2", wallId: "d-master:s", type: "door", kind: "sliding_glass_door", positionM: 1.7, widthM: 1.6, heightM: 2.5, frameColor: "#3e2723" },
      // L2 kanan: jendela kusen besi (ref winF2R).
      { id: "d-o-jendela2", floorId: "floor-2", wallId: "d-keluarga:s", type: "window", kind: "fixed_window", positionM: 2.4, widthM: 1.8, heightM: 2, sillHeightM: 0.5, frameColor: "#111111" },
    ],
    stairs: [],
    pools: [],
    roof: { type: "datar", slopeDeg: 0, overhangM: 0.25, material: "metal" },
    validation: { passed: true, issues: [] },
  }

  // Semua dinding putih bersih; key band dibuang (band = overlay penutup bukaan).
  const preset = buildFacadePreset(base, "minimalis_putih", "s")
  const facade: Record<string, string> = Object.fromEntries(
    Object.keys(preset.facade)
      .map((key) => key.split("@")[0])
      .map((key) => [key, "bata_putih"]),
  )

  const facadeElements: FacadeElement[] = [
    // "Lined wall" lt-2 kiri (ref matLinedWall): bilah horizontal PUTIH
    // mengapit pintu balkon.
    { id: `${id}-lined-1`, wallId: "d-master:s", floorId: "floor-2", kind: "slat_horizontal", positionM: 0.5, widthM: 0.85, sillHeightM: 0.15, heightM: 2.7, finish: "putih" },
    { id: `${id}-lined-2`, wallId: "d-master:s", floorId: "floor-2", kind: "slat_horizontal", positionM: 3, widthM: 1.15, sillHeightM: 0.15, heightM: 2.7, finish: "putih" },
  ]

  const mid = (zM: number, w: number, d: number, h: number, i: number) =>
    makeBoxElement("canopy", 6, 11.45, {
      id: `${id}-cornice-mid-${i}`, widthM: w, depthM: d, heightM: h, zM, material: PUTIH,
    })
  const top = (zM: number, w: number, d: number, h: number, i: number) =>
    makeBoxElement("canopy", 6, 11.45, {
      id: `${id}-cornice-top-${i}`, widthM: w, depthM: d, heightM: h, zM, material: PUTIH,
    })

  const custom: ExteriorElement[] = [
    // Tembok batas putih kiri-kanan (ref fenceL/fenceR 3.5 m).
    makeSegmentElement("boundary_wall", { x: 0.7, y: 9 }, { x: 0.7, y: 19 }, {
      id: `${id}-batas-kiri`, heightM: 3, thicknessM: 0.3, material: PUTIH,
    }),
    makeSegmentElement("boundary_wall", { x: 11.3, y: 9 }, { x: 11.3, y: 19 }, {
      id: `${id}-batas-kanan`, heightM: 3, thicknessM: 0.3, material: PUTIH,
    }),
    // Dinding belakang carport ABU GELAP (ref carportWall 2c3e50).
    makeBoxElement("solid_wall", 7.8, 8.78, {
      id: `${id}-carport-gelap`, widthM: 5.3, depthM: 0.22, heightM: 4.2,
      material: { materialId: "granit_hitam" },
    }),
    // CORNICE BERUNDAK — pemisah lantai / kanopi carport (3 undak makin lebar).
    mid(3.05, 9.6, 6.8, 0.34, 1),
    mid(3.41, 9.9, 7.1, 0.1, 2),
    mid(3.53, 10.2, 7.4, 0.1, 3),
    // CORNICE BERUNDAK — mahkota atap.
    top(6.34, 9.6, 6.8, 0.34, 1),
    top(6.7, 9.9, 7.1, 0.1, 2),
    top(6.82, 10.2, 7.4, 0.1, 3),
    // PILAR BESAR putih menopang cornice (ref pillar 0.8×4.5) + MOLDING PANEL.
    makeBoxElement("column", 4.5, 14.3, {
      id: `${id}-pilar-teras`, widthM: 0.75, depthM: 0.75, heightM: 3.05, material: PUTIH,
    }),
    makeFrameElement(4.5, 14.72, {
      id: `${id}-molding-pilar`, widthM: 0.5, heightM: 2.4, depthM: 0.05, memberSizeM: 0.05, material: TRIM,
    }),
    // Teras putih di kaki pilar.
    makeBoxElement("slab", 3.2, 13.9, {
      id: `${id}-teras`, widthM: 3.4, depthM: 1.8, heightM: 0.28, material: PUTIH,
    }),
    // CAGAK pagar putih ber-molding + pagar besi kiri + GERBANG besi kanan.
    makeBoxElement("column", 1.9, 16.2, {
      id: `${id}-cagak`, widthM: 0.5, depthM: 0.5, heightM: 1.5, material: PUTIH,
    }),
    makeFrameElement(1.9, 16.47, {
      id: `${id}-molding-cagak`, widthM: 0.3, heightM: 0.95, depthM: 0.04, memberSizeM: 0.04, material: TRIM,
    }),
    makeSegmentElement("fence", { x: 2.15, y: 16.2 }, { x: 4.7, y: 16.2 }, {
      id: `${id}-pagar-besi`, heightM: 1.75, thicknessM: 0.05, material: BESI,
    }),
    makeSegmentElement("sliding_gate", { x: 5.2, y: 16.2 }, { x: 10.3, y: 16.2 }, {
      id: `${id}-gerbang`, heightM: 1.9, thicknessM: 0.06, material: BESI,
    }),
    // Halaman: driveway carport + walkway teras.
    makeSurfaceElement("driveway", [
      { x: 5.1, y: 14.4 }, { x: 10.5, y: 14.4 }, { x: 10.5, y: 19.4 }, { x: 5.1, y: 19.4 },
    ], { id: `${id}-driveway`, material: { materialId: "beton_ekspos" } }),
    makeSurfaceElement("walkway", [
      { x: 2.4, y: 14.7 }, { x: 4.2, y: 14.7 }, { x: 4.2, y: 19.4 }, { x: 2.4, y: 19.4 },
    ], { id: `${id}-walkway`, material: { materialId: "batu_andesit" } }),
  ]

  const layout: DesignLayout = {
    ...base,
    facade,
    facadeElements,
    exteriorElements: custom,
    // LAMPION klasik (ref addClassicLamp ×4): 2 dinding lt-2 + 2 bollard
    // (cagak & samping pilar).
    exteriorLamps: [
      { id: "d-lamp-w1", kind: "wall", x: 2.4, y: 13, mountH: 2.3, side: "s", floorId: "floor-2" },
      { id: "d-lamp-w2", kind: "wall", x: 4.6, y: 13, mountH: 2.3, side: "s", floorId: "floor-2" },
      { id: "d-lamp-b1", kind: "bollard", x: 1.9, y: 16.6, mountH: 1.6, floorId: "floor-1" },
      { id: "d-lamp-b2", kind: "bollard", x: 5, y: 14.9, mountH: 1.6, floorId: "floor-1" },
    ],
  }

  const project: Project = {
    id,
    name: "Rumah Modern Klasik — Cornice Putih",
    status: "editing",
    readiness: "contractor_discussion_ready",
    projectType: "new",
    thumbnail: "family",
    style: "klasik",
    location: "Jakarta",
    city: "Jakarta",
    province: "DKI Jakarta",
    site,
    floors: 2,
    rooftop: false,
    createdAt: ISO,
    updatedAt: ISO,
  }

  return {
    id,
    label: "Scene D — Modern Klasik (ref-4)",
    description:
      "Rekonstruksi prototipe modern-klasik: cornice berundak putih 2 level, pilar & cagak ber-molding panel, balkon kaca selebar rumah, dinding carport gelap, gerbang besi, lampion.",
    project,
    site,
    layout,
  }
}

export function showcaseScenes(): ShowcaseScene[] {
  return [sceneCScandiTropis(), sceneDModernKlasik()]
}
