/**
 * Baruma — Frontend domain types.
 * Mirrors PRD §13 and extends it for brief, alternatives, RAB, exports,
 * review, and readiness. These types are the shared contract between the
 * mock API, the forms (Zod), the stores, and the UI.
 */

import type { ComponentPatternSpec, ExteriorElement, RoofZone } from "./exterior";

export type {
  ComponentPatternSpec,
  ComponentPreset,
  ComponentPresetFamily,
  CostingPolicy,
  ExteriorAssetElement,
  ExteriorBoxElement,
  ExteriorElement,
  ExteriorElementKind,
  ExteriorFrameElement,
  ExteriorGableFrameElement,
  ExteriorMaterialSlot,
  ExteriorSegmentElement,
  ExteriorStairElement,
  ExteriorSurfaceElement,
  ExteriorStructuralRole,
  MaterialRef,
  MaterialSurfaceRef,
  ModelRef,
  RoofZone,
} from "./exterior";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                  */
/* ------------------------------------------------------------------ */

export type Point = { x: number; y: number };

export type Orientation = "north" | "east" | "south" | "west" | "unknown";

/** Project lifecycle stage. */
export type ProjectStatus =
  | "draft"
  | "brief"
  | "alternatives"
  | "editing"
  | "review"
  | "archived";

/** How "buildable" a design is — always shown to the user (PRD §19). */
export type ReadinessStatus =
  | "concept_ready"
  | "contractor_discussion_ready"
  | "engineer_review_required"
  | "engineer_approved"
  | "invalid";

export type Severity = "info" | "warning" | "danger";

export type RiskCategory =
  | "structural"
  | "spatial"
  | "cost"
  | "legal"
  | "general";

/* ------------------------------------------------------------------ */
/* User & plan                                                        */
/* ------------------------------------------------------------------ */

export type Plan = "free" | "pro" | "studio";

export type User = {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  creditsUsed: number;
  creditsTotal: number;
  avatarUrl?: string;
  /** Server-managed role (admin backoffice). Absent in older payloads = "user". */
  role?: "user" | "admin";
  /** Phone number — Mayar invoices require `mobile`. Null when never set. */
  phone?: string | null;
  /** Entitlements of the user's current plan. Null when the plan row is missing (defensive). */
  entitlements?: Entitlements | null;
  /** Active subscription summary, if any (manual-renew Mayar billing). Null when none active. */
  subscription?: { status: string; currentPeriodEnd: string } | null;
};

/**
 * Plan entitlements enforced by the server (billing). The keys are FIXED
 * across the whole codebase — see docs/superpowers/specs/2026-07-05.
 */
export type Entitlements = {
  creditsPerPeriod: number;
  /** null = tanpa batas (Pro: "Project tanpa batas" — lihat plan-defaults.ts). */
  maxProjects: number | null;
  exportPdf: boolean;
  glbUpload: boolean;
  /** Render AI mode Presisi (HD, tanpa watermark) — lihat src/lib/server/ai-render. */
  aiRenderHd: boolean;
};

/* ------------------------------------------------------------------ */
/* AI Image Renderer (Fase 8 — docs/plan-integrasi-ai-renderer-2026-08.md) */
/* ------------------------------------------------------------------ */

/** Siklus hidup job render AI — mirror kolom `render_jobs.status`. */
export type AiRenderStatus =
  | "queued"
  | "submitted"
  | "processing"
  | "succeeded"
  | "failed";

/** Mode render AI — Cepat (draft, Nano Banana) vs Presisi (HD, FLUX Depth). */
export type AiRenderModeId = "cepat" | "presisi";

/**
 * Bentuk job render yang dikirim server ke klien (lihat
 * `RenderJobView`/`renderJobView` di src/lib/server/ai-render/view.ts).
 * Didefinisikan ULANG di sini alih-alih diimpor — view.ts mengimpor
 * `src/lib/server/repo/renders.ts` (pg), yang TIDAK boleh masuk bundle klien.
 */
export type AiRenderJob = {
  id: string;
  status: AiRenderStatus;
  mode: AiRenderModeId;
  preset: string;
  shotId: string;
  /** "exterior" | "interior" — opsional (job lama dari server pra-Fase B /
   *  cache klien lama tidak membawanya; absen dibaca sbg eksterior). */
  target?: "exterior" | "interior";
  /** Hanya render interior per ruang: id ruangan yang dirender (hasil
   *  resolusi server — utk label galeri, di-join ke layout.rooms klien). */
  roomId?: string;
  /** Catatan gaya opsional (chat pre-fill ATAU diketik manual di dialog —
   *  spec 2026-08-29 ai-render-chat-style-notes). Absen di job lama pra-
   *  fitur ini. */
  styleNotes?: string;
  watermarked: boolean;
  outputUrl: string | null;
  errorMessage?: string;
  createdAt: string;
};

/** One row of the `plans` table — the single DB-driven source for pricing. */
export type PlanRow = {
  id: string;
  name: string;
  priceIdr: number;
  period: "month" | "year";
  tagline: string | null;
  featured: boolean;
  sortOrder: number;
  active: boolean;
  features: string[];
  limits: string[];
  entitlements: Entitlements;
};

/* ------------------------------------------------------------------ */
/* Admin backoffice (Task 8) — client-facing contract types            */
/* ------------------------------------------------------------------ */

/**
 * One row of the admin "Transaksi" listing — a subscription joined with its
 * owner's email and plan name. Mirrors `listSubscriptionsAdmin()`'s return
 * shape (src/lib/server/repo/subscriptions.ts), redeclared here rather than
 * imported so client bundles never reach into `lib/server/repo` (that module
 * imports `@/lib/server/db` → `pg`, a Node-only dependency).
 */
export type AdminSubscriptionRow = {
  id: string;
  profileId: string;
  planId: string;
  status: string;
  provider: string | null;
  providerRef: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string;
  email: string;
  planName: string;
};

/**
 * One row of the admin "Users" listing — a safe (no credential fields) view
 * of a profile. `ProfileRow` (src/lib/server/repo/profiles.ts) never carries
 * `password_hash` either (that lives on the separate `CredentialRow`), but
 * this client-facing shape is kept minimal to exactly what the Users tab
 * renders/edits.
 */
export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  role: "user" | "admin";
  creditsUsed: number;
  creditsTotal: number;
};

/**
 * One row of the user-facing "Riwayat transaksi" listing (WS-B) — GET
 * /api/v1/me/transactions. Mirrors `listSubscriptionsForProfile`'s return
 * shape (src/lib/server/repo/subscriptions.ts), redeclared here for the same
 * reason as AdminSubscriptionRow above (client bundles never reach into
 * lib/server/repo).
 */
export type TransactionRow = {
  id: string;
  planName: string;
  priceIdr: number;
  status: string;
  createdAt: string;
  currentPeriodEnd: string | null;
  providerOrderId: string | null;
};

/**
 * One row of the admin "Rekonsiliasi pembayaran" listing (WS-B) — GET
 * /api/v1/admin/payments. Mirrors listPaymentReconciliation's return shape
 * (src/lib/server/repo/payment-events.ts).
 */
export type AdminPaymentRow = {
  id: string;
  provider: string | null;
  eventType: string | null;
  processed: boolean;
  createdAt: string;
  email: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  providerOrderId: string | null;
  mismatch: boolean;
};

/* ------------------------------------------------------------------ */
/* Site & project                                                     */
/* ------------------------------------------------------------------ */

/**
 * Override manual regulasi Perda setempat, per proyek (Tier 1 lahan
 * terbatas — lihat domain-knowledge-regulasi-tapak-lahan-sempit.md). Semua
 * field opsional; absent = pakai default nasional konservatif di
 * `lib/audit/standards.ts` (MAX_KDB/MAX_KLB/MIN_KDH/GSB_ROAD_FRACTION).
 * `maxKdb`/`minKdh` = rasio 0..1 (bukan persen). `gsbM` = meter EKSPLISIT
 * yang MENGGANTIKAN rumus ½ lebar jalan (dipakai apa adanya, bukan
 * dikalikan lagi).
 */
export type SiteRegulation = {
  maxKdb?: number | null;
  maxKlb?: number | null;
  gsbM?: number | null;
  minKdh?: number | null;
};

export type Site = {
  widthM: number;
  depthM: number;
  areaM2: number;
  city?: string;
  province?: string;
  frontOrientation?: Orientation;
  sidesAttached?: number;
  frontRoadWidthM?: number;
  notes?: string;
  /** Override angka Perda lokal untuk audit regulasi. Absent = default nasional. */
  regulation?: SiteRegulation;
};

export type HouseStyle =
  | "modern_tropis"
  | "minimalis"
  | "industrial"
  | "japandi"
  | "klasik"
  | "scandinavian";

/** Visual variant used by the generated <LayoutThumbnail /> (no real images yet). */
export type ThumbnailVariant =
  | "courtyard"
  | "vertical"
  | "family"
  | "compact"
  | "tropis";

export type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  readiness: ReadinessStatus;
  location?: string;
  city?: string;
  province?: string;
  style?: HouseStyle;
  projectType: "new" | "renovation";
  thumbnail: ThumbnailVariant;
  site: Site;
  floors: number;
  rooftop: boolean;
  currentVersionId?: string;
  createdAt: string;
  updatedAt: string;
};

/* ------------------------------------------------------------------ */
/* Brief (output of the create-project wizard, PRD §10.3 / §10.4)     */
/* ------------------------------------------------------------------ */

export type Priority =
  | "hemat_biaya"
  | "banyak_kamar"
  | "terasa_lega"
  | "keluarga_besar"
  | "ada_kolam"
  | "ada_rooftop"
  | "banyak_cahaya"
  | "ventilasi"
  | "tampilan_mewah";

export type FinishingLevel = "standar" | "menengah" | "premium";

export type BudgetRange = { minIDR: number; maxIDR: number };

export type RoomType =
  | "kamar_tidur"
  | "kamar_mandi"
  | "ruang_tamu"
  | "ruang_keluarga"
  | "dapur"
  | "ruang_makan"
  | "musholla"
  | "laundry"
  | "gudang"
  | "balkon"
  | "rooftop_lounge"
  | "area_kumpul"
  | "kolam"
  | "taman"
  | "workspace"
  | "carport"
  | "void"
  | "tangga"
  /** Jalur sirkulasi interior (selasar). Sudah lama dirujuk sebagai ruang
   *  sirkulasi di connect-rooms.ts / deterministic.ts / door-spec.ts, tapi
   *  belum pernah ada di union ini — sehingga zod menolak addRoom bertipe
   *  koridor dan agent tak bisa mengeksekusi solusi yang ia diagnosis
   *  sendiri ("butuh koridor"). */
  | "koridor";

export type SizePreference = "small" | "standard" | "large";

export type SpaceProgramItem = {
  id: string;
  roomType: RoomType;
  name: string;
  required: boolean;
  quantity: number;
  preferredFloor?: number;
  sizePreference?: SizePreference;
  notes?: string;
};

export type RiskWarning = {
  id: string;
  level: Severity;
  category: RiskCategory;
  title: string;
  message: string;
};

export type Brief = {
  projectId: string;
  summary: string;
  site: Site;
  building: {
    floors: number;
    rooftop: boolean;
    budget: BudgetRange;
    finishingLevel: FinishingLevel;
  };
  priorities: Priority[];
  spaceProgram: SpaceProgramItem[];
  assumptions: string[];
  constraints: string[];
  risks: RiskWarning[];
};

/* ------------------------------------------------------------------ */
/* Alternatives (PRD §10.5)                                           */
/* ------------------------------------------------------------------ */

export type AlternativeType =
  | "hemat_biaya"
  | "terasa_lega"
  | "fitur_maksimal"
  | "keluarga_besar"
  | "premium_compact";

export type RiskBadge = { level: Severity; label: string };

export type Alternative = {
  id: string;
  projectId: string;
  name: string;
  type: AlternativeType;
  score: number;
  thumbnail: ThumbnailVariant;
  description: string;
  keyFeatures: string[];
  pros: string[];
  cons: string[];
  estimatedCost: BudgetRange;
  readiness: ReadinessStatus;
  risks: RiskBadge[];
  areaM2: number;
  roomCount: number;
  floors: number;
};

/* ------------------------------------------------------------------ */
/* Layout geometry (PRD §13.3 – §13.6) — used by the 2D/3D editor     */
/* ------------------------------------------------------------------ */

export type Floor = {
  id: string;
  level: number;
  name: string;
  /** Floor-to-floor (m). Mezzanine: tinggi ruang mezzanine-nya sendiri.
   *  Rooftop: tebal dak. */
  heightM: number;
  /** Jenis lantai. Absen = "regular". "rooftop" menggantikan magic string
   *  id "floor-rooftop" (id lama tetap valid — dinormalisasi saat load).
   *  "mezzanine" = lantai antara PARSIAL di dalam lantai induknya. */
  kind?: "regular" | "mezzanine" | "rooftop";
  /** Mezzanine: elevasi dasarnya relatif dasar lantai INDUK (lantai reguler
   *  tepat sebelumnya di array). Default ½ floor-to-floor induk. */
  baseOffsetM?: number;
  /** CANTILEVER: geser HORIZONTAL seluruh massa lantai ini (m, koordinat
   *  site) — lantai atas menjorok di atas carport/teras. Absen/0 = tak
   *  bergeser. Slab lantai ikut menggeser (muka bawahnya = soffit). */
  offsetM?: { dx: number; dy: number };
};

export type Room = {
  id: string;
  floorId: string;
  name: string;
  type: RoomType;
  x: number;
  y: number;
  width: number;
  depth: number;
  areaM2: number;
  locked?: boolean;
  requiresNaturalLight?: boolean;
  requiresVentilation?: boolean;
  /** Open-plan grouping: rooms sharing a zoneId render with no walls between them.
   *  Legacy single-zone field — kept for saved layouts and AI patches; when
   *  `zoneIds` is present it wins. */
  zoneId?: string;
  /** Open-plan groupings (multi): a room may belong to SEVERAL zones — e.g. a
   *  family room open to the kitchen (zone A) AND to the dining area (zone B),
   *  while kitchen and dining keep their wall. Walls drop on any shared zone. */
  zoneIds?: string[];
  /** Split-level elevation offset (metres) relative to the room's floor slab; + up, - down. */
  levelOffsetM?: number;
  /** COURTYARD/light-well: ruang terbuka ke LANGIT (hanya bermakna utk tipe
   *  taman/kolam/void). Atap/slab di atasnya dilubangi (mesin roof-holes). */
  openToSky?: boolean;
  /** Rect lubang atap yang DIATUR USER (site coords, pojok kiri-atas);
   *  absen = seluas rect ruang. Digeser/di-resize di layer Atap 2D. */
  openToSkyRect?: { x: number; y: number; width: number; depth: number };
  /** Untuk ruang tipe "tangga": arah NAIK anak tangga. Default: sepanjang sisi terpanjang. */
  stairDirection?: "n" | "s" | "w" | "e";
  /** Target tinggi tanjakan (riser, m) tangga — absent/null = otomatis 0.18.
   *  Jumlah anak diturunkan: round(totalRise / riser), min 3. */
  stairRiserM?: number | null;
  /** Bentuk tangga: lurus (default), L (belok 90° dgn bordes), U (balik arah).
   *  L/U diturunkan otomatis dari footprint room; terdegradasi ke lurus bila
   *  ruang terlalu kecil (lihat interiorStairLayout). */
  stairShape?: "lurus" | "L" | "U" | null;
  /** Arah belok run kedua relatif arah jalan (default "kanan"). */
  stairTurn?: "kiri" | "kanan" | null;
  /** Untuk ruang tipe "balkon"/"void": model railing sisi terbuka (balkon:
   *  sisi tanpa ruang berdinding; void: sisi berbagi zona open-plan dengan
   *  tetangga solid). Default "kaca" (balkon) / "besi" (void). */
  railingStyle?: RailingStyle;
  /** Model railing GLB kustom dari library — HANYA balkon (void belum
   *  didukung; void selalu pakai railingStyle bawaan). Bila terisi, visual
   *  railing memakai model ini (di-tile sepanjang sisi terbuka) menggantikan
   *  railingStyle; memilih gaya bawaan melepasnya. */
  railingModelUrl?: string | null;
  railingModelAssetId?: string | null;
  /** Untuk ruang tipe "balkon": kedalaman tonjolan busur (m) di TENGAH tepi
   *  depan (sisi terbuka paling menjorok keluar bangunan) — pelat lantai &
   *  railing sisi itu membusur keluar, sisi lain tetap lurus. 0/absen =
   *  lurus (jalur lama, byte-identik). Clamp wajar 0–1,5 m. */
  edgeBowM?: number;
  /** Untuk ruang tipe "kolam": kedalaman air (m). Default per poolKind. */
  poolDepthM?: number;
  /** Untuk ruang tipe "kolam": tipe kolam — memengaruhi kedalaman & preset MEP. */
  poolKind?: PoolKind;
  /** Untuk ruang tipe "kolam": finish dinding/lantai kolam (warna air + waterline). */
  poolFinish?: PoolFinish;
  /** Kedalaman ujung dangkal/dalam (m) — keduanya terisi = dasar miring;
   *  absent = kedalaman uniform poolDepthM. Sirkulasi memakai rata-rata. */
  poolShallowM?: number | null;
  poolDeepM?: number | null;
  /** Sisi tangga masuk kolam (undakan). Absent = tanpa tangga masuk. */
  poolEntrySide?: "n" | "s" | "w" | "e" | null;
  /** Sistem sirkulasi kolam: skimmer (default, ekonomis) atau overflow
   *  (gutter keliling + balancing tank — kelas premium). */
  poolCirculationType?: "skimmer" | "overflow" | null;
  /** Spa/jacuzzi: aktifkan jet/blower (menambah beban listrik & RAB). */
  poolHasJets?: boolean | null;
  /** Pemanas air kolam (listrik) — opsional. */
  poolHeater?: boolean | null;
  /** Sistem klorinasi garam (salt chlorinator) — opsional. */
  poolSaltChlorinator?: boolean | null;
  /** Explicitly disables the procedural carport canopy when a custom canopy is modeled. */
  carportCanopyMode?: "automatic" | "none";
};

/** Gaya railing/pengaman sisi terbuka — dipakai balkon (per-Room) & dak rooftop (per-layout). */
export type RailingStyle = "kaca" | "besi" | "tembok" | "kayu";

/** Tipe kolam renang — memengaruhi kedalaman bawaan & (fase MEP) preset pipa/pompa. */
export type PoolKind = "renang" | "plunge" | "anak" | "spa";

/** Finish permukaan kolam — menentukan warna air & garis waterline di 3D. */
export type PoolFinish =
  | "keramik_biru"
  | "mozaik_hijau"
  | "pebble_gelap"
  | "batu_alam";

export type Wall = {
  id: string;
  floorId: string;
  start: Point;
  end: Point;
  thicknessM: number;
  isExternal: boolean;
};

export type OpeningKind =
  | "fixed_window"
  | "casement_window"
  | "sliding_window"
  | "awning_window"
  | "clerestory_window"
  | "curtain_wall"
  | "skylight"
  | "jalousie_window"
  | "roster"
  | "krawangan"
  // Jendela bulat (porthole) — MVP: visual bundar di dalam lubang persegi
  // (pemotongan dinding tetap rect; lihat PLAN_TUTUP_GAP.md Gap 1 Track A).
  | "porthole"
  | "hinged_door"
  | "sliding_glass_door"
  | "pocket_door"
  | "folding_door"
  | "pivot_door"
  | "garage_door"
  | "open_passage"
  | "facade_cutout"
  | "cantilever_opening";

export type OpeningPurpose = "vision" | "ventilation" | "access" | "facade";
export type OpeningFrameMaterial =
  | "aluminium"
  | "wood"
  | "upvc"
  | "steel"
  | "frameless"
  | "concrete"
  | "grc";
export type OpeningOperation =
  | "fixed"
  | "swing"
  | "sliding"
  | "folding"
  | "pivot"
  | "louvre"
  | "perforated"
  | "roof";
export type OpeningPrivacyLevel = "low" | "medium" | "high";
export type OpeningShading =
  | "none"
  | "overhang"
  | "vertical_fin"
  | "screen"
  | "secondary_skin";

/**
 * Lampu eksterior — EDITABLE: warna cahaya, intensitas, tinggi, bisa dihapus/
 * ditambah. Bila `DesignLayout.exteriorLamps` absent, preview memakai
 * penempatan otomatis (lib/three/lamps.ts); edit pertama mematerialisasi
 * daftar otomatis itu ke layout lalu memodifikasinya (copy-on-write).
 */
export type ExteriorLamp = {
  id: string;
  kind: "wall" | "bollard" | "canopy";
  /** Posisi ABSOLUT site (meter), konvensi Room.x/y. */
  x: number;
  y: number;
  /** Tinggi tumpu fixture dari lantai ruangnya (meter). */
  mountH: number;
  /** Untuk lampu dinding: sisi dinding host (arah keluar fixture). */
  side?: "n" | "s" | "w" | "e";
  floorId: string;
  /** Warna cahaya (hex). Default hangat #ffc98a. */
  color?: string;
  /** Skala intensitas 0–2 (1 = default; 0 = mati). */
  intensity?: number;
  /** Daya (Watt). Absent = default jenis (wall 7 / bollard 5 / canopy 9). */
  watt?: number;
  /** Model GLB kustom dari asset library (menggantikan fixture prosedural). */
  modelAssetId?: string | null;
  modelUrl?: string | null;
};

/** Finish elemen fasad (louver band). */
export type FacadeElementFinish = "kayu" | "aluminium_gelap" | "putih" | "terakota";

/**
 * Elemen fasad mandiri yang menempel PROUD di muka luar dinding — v1: louver
 * band (kisi-kisi vertikal lebar, bisa menutupi beberapa jendela sekaligus,
 * khas fasad modern). Posisi memakai konvensi Opening: `positionM` = titik
 * tengah sepanjang dinding host, `sillHeightM` dari lantai ruang host.
 */
/**
 * Jenis bidang kisi/roster fasad:
 * - `louver_band`   — sirip VERTIKAL (kisi-kisi klasik).
 * - `slat_horizontal` — bilah HORIZONTAL bertumpuk.
 * - `roster_screen` — grid vertikal+horizontal (krawangan/breeze-block).
 */
export type FacadeElementKind =
  | "louver_band"
  | "slat_horizontal"
  | "roster_screen";

export type FacadeElement = {
  id: string;
  /** `${roomId}:${side}` — dinding host (sisi luarnya). */
  wallId: string;
  floorId: string;
  kind: FacadeElementKind;
  positionM: number;
  widthM: number;
  sillHeightM: number;
  heightM: number;
  finish: FacadeElementFinish;
  /**
   * Model GLB kustom dari My Library yang menggantikan kisi/roster prosedural.
   * Di preview 3D model di-fit ke envelope `widthM × heightM` elemen fasad.
   * `null` = lepas model dan kembali ke geometri prosedural sesuai `kind`.
   */
  modelUrl?: string | null;
  modelAssetId?: string | null;
  /** Pola kisi/roster KUSTOM — menggantikan konstanta pitch/lebar/kedalaman
   *  bilah hardcoded per `kind`. Absen = jalur numerik lama PERSIS
   *  byte-identik (lihat build-model.ts generator elemen fasad). */
  pattern?: ComponentPatternSpec;
  /** Warna bilah custom (hex "#rrggbb") — menang atas warna bawaan `finish`
   *  (LOUVER_FINISH_COLORS), supaya sirip bisa dicocokkan dengan cladding
   *  dinding (mis. kayu gelap "#6f4e37"). Absen = warna dari `finish`
   *  PERSIS seperti sebelumnya (byte-identik). Rel/bingkai keliling tetap
   *  warna metal tetap, tak ikut colorHex. */
  colorHex?: string;
};

export type Opening = {
  id: string;
  floorId: string;
  wallId: string;
  type: "door" | "window";
  kind?: OpeningKind;
  purpose?: OpeningPurpose;
  operation?: OpeningOperation;
  frameMaterial?: OpeningFrameMaterial;
  /** Warna kusen custom (hex, mis. "#3c4245") — menang atas warna bawaan frameMaterial. */
  frameColor?: string;
  /** BINGKAI MENONJOL (extruded frame): kedalaman bingkai keluar dari muka
   *  dinding (m, 0–0.8). Absen/0 = kusen flush (perilaku lama). */
  frameDepthM?: number;
  privacyLevel?: OpeningPrivacyLevel;
  shading?: OpeningShading;
  positionM: number;
  widthM: number;
  heightM: number;
  sillHeightM?: number;
  headHeightM?: number;
  notes?: string;
  /** Model GLB kustom dari library — menggantikan VISUAL daun/panel bukaan di
   *  3D (di-fit ke lebar×tinggi bukaan). Lubang, kusen data, & gambar kerja
   *  tetap dari dimensi bukaan. */
  modelUrl?: string | null;
  modelAssetId?: string | null;
  /** Model GLB gorden/tirai — OVERLAY di sisi DALAM jendela (tidak mengganti
   *  kaca). Di-fit sedikit lebih besar dari bukaan (overhang) & digantung di
   *  muka interior. Hanya bermakna untuk `type: "window"`. */
  curtainModelUrl?: string | null;
  curtainAssetId?: string | null;
  /**
   * Siluet LENGKUNG (fasad mediterania/organik) — MVP: lubang dinding tetap
   * PERSEGI (mesin segmentasi tak berubah); prim pengisi sudut wall-material
   * (pola sama dgn `kind:"porthole"`) menutup sudut kotak jadi aproksimasi
   * lengkung low-poly (4-6 step per sudut, lihat build-model.ts). Kaca/daun
   * tetap persegi penuh — corner-fill menutupinya dari luar.
   * - "arch"    = setengah lingkaran DI ATAS (radius = widthM/2; heightM
   *               harus ≥ widthM/2 + 0.2 — divalidasi/clamp di store).
   * - "capsule" = setengah lingkaran di KEDUA ujung (pill/stadium); orientasi
   *               (horizontal/vertikal) dideteksi dari rasio widthM:heightM.
   * Absen = persegi (perilaku lama, byte-identik).
   */
  archShape?: "arch" | "capsule";
  /**
   * Tepi ATAS miring (bukaan TRAPESIUM mengikuti kemiringan atap/gable) —
   * beda tinggi (m) tepi atas antara sisi "along" positif (kanan pada
   * dinding n/s, timur pada dinding w/e) dan sisi "along" negatif: positif
   * = sisi along+ lebih TINGGI (sisi along− ditutup step-fill); negatif =
   * sebaliknya. Lubang dinding tetap PERSEGI setinggi `heightM` (sisi
   * tinggi, tak berubah — sama prinsip dgn `archShape`); sudut atas sisi
   * RENDAH ditutup step-box staircase low-poly (lihat
   * `topSlopeCornerFillPrims` di build-model.ts, idiom sama dgn corner-fill
   * arch/kapsul: prim "wall" + wallSide ikut cladding fasad, kaca/daun
   * tetap persegi penuh). Clamp store: |topSlopeM| ≤ 3 dan sisi rendah tak
   * boleh < ~0.3 m (heightM − |topSlopeM| ≥ 0.3, disesuaikan otomatis).
   * Absen/0 = persegi biasa (perilaku lama, byte-identik).
   */
  topSlopeM?: number;
};

/**
 * @deprecated Tangga nyata = `Room` dengan `type:"tangga"`
 * (+`stairShape`/`stairDirection`/`stairRiserM`). Tipe ini legacy dan
 * `layout.stairs` selalu `[]`. Jangan dipakai untuk fitur baru.
 */
export type Stair = {
  id: string;
  floorId: string;
  fromFloor: number;
  toFloor: number;
  x: number;
  y: number;
  widthM: number;
  lengthM: number;
  /** Arah NAIK (anak tangga terendah di sisi berlawanan). Default "n".
   *  n/s: footprint widthM×lengthM; w/e: footprint lengthM×widthM. */
  direction?: "n" | "s" | "w" | "e";
};

/**
 * @deprecated Kolam nyata = `Room` dengan `type:"kolam"`
 * (+`poolKind`/`poolDepthM`/`poolFinish`/…). Tipe ini legacy dan
 * `layout.pools` selalu `[]`. Jangan dipakai untuk fitur baru.
 */
export type Pool = {
  id: string;
  floorId: string;
  x: number;
  y: number;
  widthM: number;
  depthM: number;
  waterDepthM: number;
};

export type ValidationIssue = {
  id: string;
  level: Severity;
  category: RiskCategory;
  message: string;
  objectId?: string;
};

export type ValidationResult = {
  passed: boolean;
  issues: ValidationIssue[];
};

/** Roof shape. Absent `DesignLayout.roof` means "datar" (current/legacy behaviour). */
export type RoofType = "datar" | "pelana" | "limasan" | "miring";

export type RoofMaterial =
  | "genteng_beton"
  | "genteng_keramik"
  | "metal"
  | "aspal";

/** Lis fascia — band gelap di tepi atap datar & tepi dak balkon (gaya modern). */
export type RoofFascia = {
  /** Tinggi band dari tepi slab ke bawah (m). */
  heightM: number;
  /** Warna band (hex). */
  color: string;
};

export type RoofSpec = {
  type: RoofType;
  slopeDeg: number;
  overhangM: number;
  material: RoofMaterial;
  /** Hanya utk type "miring" (skillion): sisi RENDAH — arah air mengalir. Default "s". */
  lowSide?: "n" | "s" | "w" | "e";
  /** Gable ASIMETRIS (hanya type "pelana"): geser bubungan dari tengah (m),
   *  positif = arah +x/+y site. Absen/0 = simetris (perilaku lama). */
  ridgeOffsetM?: number;
  /** SOPI-SOPI (hanya "pelana"): isi dinding/kaca ujung bubungan (lihat
   *  RoofZone.gableEnds). Absen = tanpa infill (perilaku lama). */
  gableEnds?: Partial<Record<"n" | "s" | "w" | "e", "wall" | "glass">>;
  /** Absent = tanpa lis fascia (perilaku lama). */
  fascia?: RoofFascia;
};

/** Electrical installation points. Coordinates are ABSOLUTE metres (editor room
 *  space: room.x/room.y/room.width/room.depth, y-UP). Absent = none placed. */
export type ElectricalPointType =
  | "stopkontak"
  | "stopkontak_daya"
  | "saklar_tunggal"
  | "saklar_ganda"
  | "panel"
  | "data";

export type ElectricalPoint = {
  id: string;
  roomId: string;
  type: ElectricalPointType;
  x: number;
  y: number;
  note?: string;
};

/** Water installation point types (SNI 8153:2015 fixtures). */
export type WaterPointType =
  | "kloset"
  | "wastafel"
  | "shower"
  | "kran"
  | "kran_taman"
  | "floor_drain"
  | "sink_dapur"
  | "kran_wudhu";

/** Piping system a fixture belongs to: bersih (supply), kotor (grey), limbah (black). */
export type WaterSystem = "bersih" | "kotor" | "limbah";

/** Water installation point. Coordinates are ABSOLUTE metres (editor room
 *  space, y-UP), same convention as ElectricalPoint. Absent = none placed. */
export type WaterPoint = {
  id: string;
  roomId: string;
  type: WaterPointType;
  x: number;
  y: number;
  note?: string;
};

/** Land-level sanitation object (septic tank / soakwell / control box).
 *  Coordinates are ABSOLUTE metres on the Site (widthM × depthM); dimensions
 *  are SNI-derived. */
export type SanitationObject = {
  id: string;
  x: number;
  y: number;
  widthM: number;
  lengthM: number;
  depthM: number;
  capacity?: number;
};

export type DesignLayout = {
  /** Persisted schema version. Absent legacy layouts normalize to version 2. */
  schemaVersion?: 1 | 2;
  id: string;
  projectId: string;
  versionId: string;
  floors: Floor[];
  rooms: Room[];
  walls: Wall[];
  openings: Opening[];
  /** @deprecated legacy, selalu []. Tangga = `Room` type:"tangga". */
  stairs?: Stair[];
  /** @deprecated legacy, selalu []. Kolam = `Room` type:"kolam". */
  pools?: Pool[];
  interiors?: RoomInteriorPlan[];
  /** Roof parameters. Absent = datar (legacy behaviour). */
  roof?: RoofSpec;
  /** Rooftop deck footprint (metres, site coords like rooms). Only meaningful when
   *  the layout has a "floor-rooftop" floor. Absent = deck covers the whole building
   *  footprint (current/legacy behaviour). Present + smaller than the footprint =
   *  partial rooftop: the remainder is covered by `roof`. */
  rooftopArea?: { x: number; y: number; width: number; depth: number };
  /** Gaya railing keliling DAK rooftop. Rooftop bukan sebuah Room (bisa penuh
   *  tanpa satu pun room di floor-rooftop), jadi gaya railingnya disimpan di
   *  layout, bukan di Room seperti balkon. Default "kaca" bila kosong. */
  rooftopRailingStyle?: RailingStyle;
  /** Model railing GLB kustom untuk DAK rooftop (analog Room.railingModelUrl
   *  balkon). Bila terisi, visual railing dak memakai model ini di-tile keliling
   *  perimeter dak (house-model), menggantikan gaya bawaan; memilih gaya melepasnya. */
  rooftopRailingModelUrl?: string | null;
  rooftopRailingModelAssetId?: string | null;
  /** Akses DAK rooftop tipe tangga monyet (ship ladder servis) menempel muka
   *  luar bangunan pada sisi terpilih. Akses tangga dalam ruang TIDAK disimpan
   *  di sini — ia direpresentasikan room type "tangga" di lantai teratas.
   *  Absent/null = tanpa tangga monyet. */
  /** Skylight bidang atap DATAR (atap datar legacy / dak rooftop / zona
   *  datar). Koordinat = POJOK kiri-atas rect dalam meter site (seperti
   *  rooftopArea/Room — BUKAN center seperti RoofZone). Bidang host
   *  diresolusi otomatis (lib/geometry/roof-holes). Atap miring belum
   *  didukung (tervalidasi, data dipertahankan). */
  skylights?: Array<{
    id: string;
    x: number;
    y: number;
    widthM: number;
    depthM: number;
    /** fixed = kaca mati; operable = bisa dibuka (ventilasi). */
    kind: "fixed" | "operable";
  }>;
  rooftopAccess?: {
    kind: "tangga_monyet";
    side: "n" | "s" | "w" | "e";
    /** Posisi sumbu tangga sepanjang sisi, meter dari ujung sisi (x0 utk
     *  sisi n/s, y0 utk sisi w/e). Absent = tengah sisi. */
    posM?: number;
  } | null;
  /** Structural parameters. Absent → soil bearing defaults to SOIL_DEFAULT_KPA (150). */
  structural?: { soilBearingKPa: number };
  /**
   * Cladding fasad per dinding: key = wallId (`${roomId}:${side}`), value =
   * id dari FACADE_CLADDINGS. Hanya MUKA LUAR dinding yang memakai cladding;
   * muka dalam tetap mengikuti material ruang. Absent = fasad polos (preset).
   */
  facade?: Record<string, string>;
  /** Aksen MUKA DALAM per dinding: key = wallId, value = id FACADE_CLADDINGS.
   *  Menang atas material dinding ruang utk muka dalam dinding itu saja. */
  facadeInner?: Record<string, string>;
  /** Elemen fasad mandiri (louver band dsb.) menempel di muka luar dinding. */
  facadeElements?: FacadeElement[];
  /** Site/freestanding exterior architecture elements. */
  exteriorElements?: ExteriorElement[];
  /** Explicit roof areas. When present, these win over the legacy global roof spec. */
  roofZones?: RoofZone[];
  /** Lampu eksterior (editable). Absent = penempatan otomatis (lib/three/lamps.ts). */
  exteriorLamps?: ExteriorLamp[];
  /** Electrical installation points (absolute metres). Absent = none placed. */
  electrical?: ElectricalPoint[];
  /** Water installation points (absolute metres). Absent = none placed. */
  water?: WaterPoint[];
  /** Land-level sanitation objects (absolute metres on the Site). Absent = none. */
  sanitation?: {
    septicTank?: SanitationObject;
    soakwell?: SanitationObject;
    controlBoxes?: SanitationObject[];
  };
  validation: ValidationResult;
};

export type DesignVersion = {
  id: string;
  projectId: string;
  name: string;
  readiness: ReadinessStatus;
  createdAt: string;
};

/* ------------------------------------------------------------------ */
/* Editor operations (PRD §12.2) — undo/redo                          */
/* ------------------------------------------------------------------ */

// Fase 3 (unifikasi UI editor): trim ke 10 member yang benar-benar hidup —
// "wall"/"dimension" tak pernah dijadikan activeTool (dimensi = overlay
// terpisah; dinding dipilih via EntityRef "wall", bukan tool), dan 6 member
// "exterior_*" adalah sisa desain lama yang tak pernah dipakai (elemen
// eksterior semua lahir lewat tool "exterior" tunggal + pendingPlacement.variant).
export type EditorTool =
  | "select"
  | "pan"
  | "room"
  | "door"
  | "window"
  | "electrical"
  | "water"
  | "stair"
  | "exterior"
  | "roofZone";

export type LayoutOperation = {
  id: string;
  label: string;
  kind:
    | "update-room"
    | "add-room"
    | "delete-room"
    | "update-opening"
    | "add-opening"
    | "delete-opening"
    | "update-wall";
  /** Snapshot patch applied on redo. */
  after: Partial<DesignLayout>;
  /** Snapshot patch applied on undo. */
  before: Partial<DesignLayout>;
};

/* ------------------------------------------------------------------ */
/* Interior design (room-scale furniture, materials, lighting, budget) */
/* ------------------------------------------------------------------ */

export type InteriorStyleId =
  | "modern_tropical"
  | "warm_minimalist"
  | "japandi"
  | "scandinavian"
  | "industrial"
  | "luxury_compact"
  | "family_cozy";

export type InteriorStylePreset = {
  id: InteriorStyleId;
  name: string;
  description: string;
  mood: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    wood: string;
    metal: string;
    fabric: string;
  };
  materials: {
    floor: string[];
    wall: string[];
    ceiling: string[];
    accent: string[];
  };
  lighting: string[];
};

export type FurnitureCategory =
  | "seating"
  | "table"
  | "bed"
  | "wardrobe"
  | "cabinet"
  | "kitchen"
  | "appliance"
  | "lighting"
  | "decor"
  | "bathroom_fixture"
  | "outdoor"
  | "storage"
  | "workspace"
  | "prayer";

export type PriceRange = {
  low: number;
  mid: number;
  high: number;
};

export type FurnitureItem = {
  id: string;
  name: string;
  category: FurnitureCategory;
  widthM: number;
  depthM: number;
  heightM: number;
  roomTypes: RoomType[];
  styleTags: InteriorStyleId[];
  priceRange: PriceRange;
  clearance: {
    frontM: number;
    sideM: number;
  };
};

/** Slot type for semantic furniture placement (furnimesh model ingestion).
 *  "generic" is the catch-all: every furniture item accepts a custom GLB. */
export type SlotType = "tv" | "sofa" | "coffee_table" | "generic";

/** How a furniture item is placed in the room. */
export type PlacementType = "floor" | "wall_mounted" | "cabinet_mounted";

/** Validation profile for a specific slot type. */
export type ValidationProfile = {
  category: SlotType;
  placement: PlacementType[];
  recommended: {
    widthM: [number, number];
    depthM: [number, number];
    heightM: [number, number];
    widthToDepthMin?: number;
    widthToHeight?: [number, number];
  };
  materialTokens: Record<string, string[]>;
};

/** How the model material should be treated relative to the project style. */
export type MaterialMode =
  | "keep_original"
  | "match_project_style"
  | "customize";

/** How the model should be fitted to the slot dimensions. */
export type FitMode =
  | "fit_to_slot_width"
  | "fit_to_slot_depth"
  | "fit_to_slot_height"
  | "use_real_size";

export type PlacedFurniture = {
  id: string;
  furnitureId: string;
  roomId: string;
  name: string;
  category: FurnitureCategory;
  x: number;
  y: number;
  rotationDeg: number;
  widthM: number;
  depthM: number;
  heightM: number;
  locked: boolean;
  priceRange: PriceRange;
  /** Override harga per-instance (Rp) — menang atas priceRange item/aset.
   *  Absent/null = pakai harga katalog/aset; furniture kustom tanpa harga
   *  berstatus "belum dihargai" (excluded eksplisit), bukan Rp 0 senyap. */
  priceOverrideIDR?: number | null;

  // ── semantic slot (furnimesh model ingestion) ──
  /** Semantic slot type — null means generic placeholder, not a replaceable slot. */
  slotType?: SlotType | null;
  /** The asset id from user_assets that's currently attached, if any. */
  modelAssetId?: string | null;
  /** URL to the GLB model file (from object storage). */
  modelUrl?: string | null;
  /** How the model is fitted into the slot dimensions. */
  fitMode?: FitMode | null;
  /** How the model material should be handled. */
  materialMode?: MaterialMode | null;
  /** Tinggi pasang dari lantai (m) — jam dinding, ambalan, TV gantung.
   *  Absent/null = duduk di lantai (perilaku lama). */
  mountHeightM?: number | null;
  /** Scale factor applied to the model for real-world size correction. */
  scaleFactor?: { x: number; y: number; z: number } | null;
};

export type MaterialCategory =
  | "floor"
  | "wall_paint"
  | "wall_panel"
  | "ceiling"
  | "countertop"
  | "cabinet_finish"
  | "backsplash"
  | "bathroom_tile"
  | "outdoor_decking"
  | "lighting_fixture";

export type InteriorSurface = "floor" | "wall" | "ceiling" | "accent";

export type MaterialItem = {
  id: string;
  name: string;
  category: MaterialCategory;
  unit: "m2" | "m" | "unit";
  priceRange: PriceRange;
  styleTags: InteriorStyleId[];
  suitableRooms: RoomType[];
  maintenance: "low" | "medium" | "high";
  waterResistance: "low" | "medium" | "high";
};

export type MaterialAssignment = {
  id: string;
  roomId: string;
  surface: InteriorSurface;
  materialId: string;
  name: string;
  areaM2: number;
  priceRange: PriceRange;
};

export type LightingFixture = {
  id: string;
  roomId: string;
  type: "downlight" | "pendant" | "wall_lamp" | "indirect" | "task" | "outdoor";
  x: number;
  y: number;
  heightM: number;
  colorTemperature: "warm" | "neutral" | "cool";
  qty: number;
  priceRange: PriceRange;
  /** Daya per unit (Watt). Absent = default tipe (LAMP_LOAD_VA). Dipakai sirkuit/MCB, RAB, dan estimasi energi. */
  watt?: number;
};

export type InteriorWarning = {
  id: string;
  level: Severity;
  category:
    | "ergonomic"
    | "circulation"
    | "opening"
    | "budget"
    | "structure"
    | "material";
  title: string;
  message: string;
  furnitureId?: string;
};

export type InteriorBudgetLine = {
  id: string;
  roomId: string;
  category:
    | "furniture"
    | "built_in"
    | "material"
    | "lighting"
    | "installation"
    | "decor";
  item: string;
  qty: number;
  unit: string;
  lowIDR: number;
  midIDR: number;
  highIDR: number;
  /** false = item belum dihargai (excluded eksplisit dari subtotal & baseline
   *  instalasi). Absent = priced (backward-compatible dengan payload lama). */
  priced?: boolean;
};

export type InteriorBudgetEstimate = {
  lowIDR: number;
  midIDR: number;
  highIDR: number;
  lines: InteriorBudgetLine[];
  /** Jumlah line "belum dihargai" — >0 berarti estimasi belum lengkap. */
  unpricedCount?: number;
};

export type RoomInteriorPlan = {
  roomId: string;
  roomName: string;
  roomType: RoomType;
  floorId: string;
  style: InteriorStyleId;
  furniture: PlacedFurniture[];
  materials: MaterialAssignment[];
  lighting: LightingFixture[];
  colorPalette: InteriorStylePreset["colors"];
  warnings: InteriorWarning[];
  budgetEstimate: InteriorBudgetEstimate;
  score: {
    clearance: number;
    usability: number;
    styleMatch: number;
    cost: number;
    naturalLight: number;
    circulation: number;
  };
};

export type InteriorPlan = {
  projectId: string;
  versionId: string;
  style: InteriorStyleId;
  rooms: RoomInteriorPlan[];
  totalEstimate: InteriorBudgetEstimate;
  warnings: InteriorWarning[];
  generatedAt: string;
};

/* ------------------------------------------------------------------ */
/* RAB / BOQ (PRD §10.8)                                              */
/* ------------------------------------------------------------------ */

export type CostCategory =
  | "struktur"
  | "arsitektur"
  | "plumbing"
  | "listrik"
  | "finishing"
  | "kolam"
  | "rooftop"
  /** Furnitur lepas & dekorasi dari plan interior — BUKAN biaya konstruksi;
   *  dipisahkan agar RAB bangunan tetap jujur untuk KPR/kontraktor. */
  | "furnishing";

export type Confidence = "low" | "medium" | "high";

export type BOQItem = {
  id: string;
  category: CostCategory;
  item: string;
  volume: number;
  unit: string;
  unitPriceIDR: number;
  totalIDR: number;
  confidence: Confidence;
  notes?: string;
  /** Semantic design objects that produced this line item. */
  sourceElementIds?: string[];
};

export type CostSummary = {
  lowIDR: number;
  midIDR: number;
  highIDR: number;
  perM2IDR: number;
  confidence: Confidence;
};

export type RAB = {
  projectId: string;
  versionId: string;
  areaM2: number;
  summary: CostSummary;
  items: BOQItem[];
  assumptions: string[];
  manual?: boolean;
};

/* ------------------------------------------------------------------ */
/* Exports (PRD §10.9)                                                */
/* ------------------------------------------------------------------ */

export type ExportFormat =
  | "contractor_pack"
  | "interior_pack"
  | "drawings_pack"
  | "dxf"
  | "ifc"
  | "glb"
  | "rab_excel"
  | "zip_all";

export type ExportStatus =
  | "idle"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type ExportItem = {
  format: ExportFormat;
  title: string;
  description: string;
  audience: string;
  opensWith: string;
  whenToUse: string;
  limitation: string;
  locked: boolean;
  status: ExportStatus;
  readiness: ReadinessStatus;
  lastGeneratedAt?: string;
  fileSize?: string;
};

export type ExportJob = {
  id: string;
  projectId: string;
  versionId: string;
  format: ExportFormat;
  status: ExportStatus;
  progress: number;
  createdAt: string;
  fileUrl?: string;
};

/* ------------------------------------------------------------------ */
/* Review (PRD §10.10)                                                */
/* ------------------------------------------------------------------ */

export type ReviewRole =
  | "arsitek"
  | "engineer_struktur"
  | "mep"
  | "kontraktor"
  | "pbg_legal";

export type ReviewChecklistItem = {
  role: ReviewRole;
  label: string;
  status: "pending" | "reviewed" | "not_required";
};

export type Comment = {
  id: string;
  author: string;
  role?: ReviewRole;
  body: string;
  createdAt: string;
  resolved: boolean;
};

export type Review = {
  projectId: string;
  versionId: string;
  aiSummary: string;
  checklist: ReviewChecklistItem[];
  comments: Comment[];
  warnings: RiskWarning[];
  resolvedWarningIds: string[];
};
