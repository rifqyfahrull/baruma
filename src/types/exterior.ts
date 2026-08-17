export type MaterialSurfaceRef = {
  materialId?: string;
  color?: string;
  finish?: string;
};

export type ExteriorMaterialSlot = "top" | "side" | "underside";

export type MaterialRef = MaterialSurfaceRef & {
  surfaces?: Partial<Record<ExteriorMaterialSlot, MaterialSurfaceRef>>;
};

export type CostingPolicy = {
  rateId?: string;
  includeInRab?: boolean;
};

export type ModelRef = {
  modelAssetId?: string | null;
  modelUrl?: string | null;
  fitMode?: "fit_envelope" | "use_real_size";
  upAxis?: "y" | "z";
  frontAxis?: "z+" | "z-" | "x+" | "x-";
  performance?: {
    triangleCount?: number;
    meshCount?: number;
    drawCallCount?: number;
    textureBytes?: number;
    fileSizeBytes?: number;
  };
};

export type ExteriorStructuralRole = "non_structural" | "secondary_unverified";

/**
 * Parameter pola kisi/roster KUSTOM — dipakai elemen fasad
 * (louver_band/slat_horizontal/roster_screen, lihat `FacadeElement.pattern`)
 * DAN elemen eksterior pergola (`ExteriorBoxElement.pattern`, kind
 * "pergola"). Semua field optional; absen SEMUA = jalur numerik lama
 * (konstanta hardcoded per pemanggil) PERSIS byte-identik. Nilai di luar
 * rentang clamp di-clamp oleh resolver (`lib/three/component-pattern.ts`),
 * bukan ditolak.
 */
export type ComponentPatternSpec = {
  /** Arah bilah: "v" vertikal, "h" horizontal, "grid"/"cross" dua arah. */
  orientation?: "v" | "h" | "grid" | "cross";
  /** Jarak antar bilah (m). Clamp 0.05–1.5. */
  pitchM?: number;
  /** Lebar penampang bilah tegak lurus arah bentang (m). Clamp 0.02–0.5. */
  barWidthM?: number;
  /** Kedalaman/tebal bilah (m). Clamp 0.01–0.6. */
  barDepthM?: number;
  /** Pola pengelompokan spasi, mis. [3,1] = 3 bilah rapat lalu 1 slot pitch
   *  kosong (gap ekstra), berulang. Maks 8 angka, tiap angka bulat 1–10. */
  rhythm?: number[];
  /** Tambah bingkai keliling 4 sisi mengelilingi bidang pola. */
  frame?: boolean;
  /** TENGGELAM di muka (reveal line/nat beton) alih-alih menonjol keluar —
   *  arah standoff dibalik ke dalam ketebalan dinding host, kedalaman efektif
   *  dibatasi aman (≈ WALL_T/2 - 0.01) supaya tak tembus sisi dalam dinding.
   *  Hanya berefek pada elemen fasad (bilah menempel dinding, konteks
   *  WALL_T); elemen eksterior bebas berdiri (pergola dst.) mengabaikannya
   *  secara visual — field tetap tersimpan utuh utk konsistensi skema. */
  inset?: boolean;
};

/** Keluarga komponen yang mengonsumsi `ComponentPatternSpec` (Studio Komponen). */
export type ComponentPresetFamily = "kisi" | "roster" | "pagar" | "gerbang" | "pergola";

/**
 * Preset pola KOMPONEN tersimpan (Studio Komponen) — snapshot `pattern` yang
 * bisa diberi nama dan diterapkan ulang ke elemen fasad (louver_band/
 * slat_horizontal/roster_screen) atau eksterior (fence/gate/pergola) mana
 * pun, tanpa mengetik ulang pitch/lebar/rhythm tiap kali. `family` murni
 * label kategorisasi UI (daftar "Preset Saya") — TIDAK membatasi target
 * penerapan; pattern yang sama valid untuk elemen fasad maupun eksterior.
 */
export type ComponentPreset = {
  id: string;
  name: string;
  family: ComponentPresetFamily;
  pattern: ComponentPatternSpec;
  /** Opsional: saran finish/material (mis. "kayu", "aluminium_gelap") — murni informatif. */
  finish?: string;
  createdAt: string;
};

export type ExteriorElementCommon = {
  id: string;
  floorId?: string;
  label?: string;
  structuralRole: ExteriorStructuralRole;
  material?: MaterialRef;
  costing?: CostingPolicy;
  model?: ModelRef;
  locked?: boolean;
  hidden?: boolean;
};

export type ExteriorSegmentElement = ExteriorElementCommon & {
  kind:
    | "boundary_wall"
    | "fence"
    | "sliding_gate"
    | "swing_gate"
    | "pedestrian_gate";
  start: { x: number; y: number };
  end: { x: number; y: number };
  heightM: number;
  thicknessM?: number;
  /** Rotasi (°, 0–360) opsional — 0 = horizontal (+x). `start`/`end` TETAP
   *  satu-satunya sumber kebenaran geometri (posisi/panjang/arah dipakai 2D
   *  denah & prim 3D via atan2); menulis field ini (inspector/agent patch)
   *  membuat store menghitung ULANG `end` di sekeliling `start` sepanjang
   *  panjang saat ini, jadi 2D & 3D otomatis konsisten (bukan jalur rotasi
   *  terpisah). Absen = perilaku lama, byte-identik. */
  rotationDeg?: number;
  /** Hanya kind fence/gate (sliding_gate/swing_gate/pedestrian_gate) — pola
   *  jeruji/bilah KUSTOM (pitch/lebar/rhythm), dipakai `patternBarOffsets`
   *  (lib/three/component-pattern.ts) menggantikan spasi bilah adaptif lama.
   *  `boundary_wall` selalu solid (pattern diabaikan). Absen = jalur lama. */
  pattern?: ComponentPatternSpec;
};

export type ExteriorBoxElement = ExteriorElementCommon & {
  kind:
    | "solid_wall"
    | "facade_panel"
    | "column"
    | "chimney"
    | "beam"
    | "slab"
    | "canopy"
    | "overhang_slab"
    | "planter"
    | "pergola";
  x: number;
  y: number;
  zM?: number;
  widthM: number;
  depthM: number;
  /** Untuk kind "pergola": elevasi bidang kisi (atas kolom) dari tanah/zM,
   *  BUKAN tinggi ekstrusi box seperti kind lain. */
  heightM: number;
  rotationDeg?: number;
  /** Hanya kind "pergola": pola kisi silang 2 arah. Absen = orientation
   *  "cross" default, pitch 0,4 m (lihat exterior-primitives.ts). */
  pattern?: ComponentPatternSpec;
  /** Hanya kind "pergola": 4 kolom penyangga di sudut footprint. Absen = true. */
  posts?: boolean;
};

export type ExteriorFrameElement = ExteriorElementCommon & {
  kind: "portal_frame";
  x: number;
  y: number;
  widthM: number;
  heightM: number;
  depthM?: number;
  memberSizeM: number;
  rotationDeg?: number;
};

/**
 * BINGKAI GABLE (W4/ref scandi-tropis): outline pelana ASIMETRIS berdiri di
 * bidang fasad — kaki kiri/kanan boleh BEDA TINGGI (eaveLeftM/eaveRightM),
 * apex digeser via apexOffsetM (m dari tengah, + ke kanan lokal). Terbuka di
 * bawah (tanpa chord dasar) seperti frame gable Skandinavia. `heightM` =
 * tinggi APEX dari dasar elemen; `zM` menaikkan dasar (mis. ke lantai balkon).
 */
export type ExteriorGableFrameElement = ExteriorElementCommon & {
  kind: "gable_frame";
  x: number;
  y: number;
  zM?: number;
  widthM: number;
  heightM: number;
  eaveLeftM: number;
  eaveRightM: number;
  apexOffsetM?: number;
  depthM?: number;
  memberSizeM: number;
  rotationDeg?: number;
};

export type ExteriorStairElement = ExteriorElementCommon & {
  kind: "exterior_stair";
  x: number;
  y: number;
  widthM: number;
  lengthM: number;
  riseM: number;
  direction: "n" | "s" | "w" | "e";
};

export type ExteriorSurfaceElement = ExteriorElementCommon & {
  kind: "driveway" | "walkway" | "terrace_surface" | "garden_bed";
  points: Array<{ x: number; y: number }>;
  thicknessM?: number;
  scatterSeed?: number;
};

export type ExteriorAssetElement = ExteriorElementCommon & {
  kind: "asset" | "plant" | "tree" | "exterior_decor" | "vehicle";
  x: number;
  y: number;
  zM?: number;
  widthM: number;
  depthM: number;
  heightM: number;
  rotationDeg?: number;
};

export type ExteriorElementKind = ExteriorElement["kind"];

export type ExteriorElement =
  | ExteriorSegmentElement
  | ExteriorBoxElement
  | ExteriorFrameElement
  | ExteriorGableFrameElement
  | ExteriorStairElement
  | ExteriorSurfaceElement
  | ExteriorAssetElement;

export type RoofZone = {
  id: string;
  floorId?: string;
  type: "datar" | "pelana" | "limasan" | "miring";
  x: number;
  y: number;
  widthM: number;
  depthM: number;
  slopeDeg: number;
  overhangM: number;
  /** Override overhang PER SISI (m) — dipakai cincin zona courtyard: sisi
   *  menghadap lubang diberi 0 agar tritisan tidak menjorok menutup bukaan.
   *  Absen per sisi = pakai overhangM. */
  overhangSides?: Partial<Record<"n" | "s" | "w" | "e", number>>;
  materialId?: string;
  lowSide?: "n" | "s" | "w" | "e";
  /** Gable ASIMETRIS (hanya type "pelana"): geser bubungan dari tengah (m)
   *  sepanjang sumbu tegak-lurus ridge; positif = arah +x/+y site. Absen/0 =
   *  simetris (perilaku lama). Clamp |ro| ≤ span/2 − 0.3. */
  ridgeOffsetM?: number;
  /** SOPI-SOPI (hanya "pelana"): isi dinding/kaca pada ujung bubungan.
   *  Kunci = sisi ujung ridge (ridge along x → w/e; along y → n/s); sisi tak
   *  valid diabaikan. Absen = tanpa infill (perilaku lama — segitiga terbuka). */
  gableEnds?: Partial<Record<"n" | "s" | "w" | "e", "wall" | "glass">>;
  /** Sembunyikan zona ini dari denah 2D (bisa di-reveal via showHiddenRoofZones). */
  hidden?: boolean;
};
