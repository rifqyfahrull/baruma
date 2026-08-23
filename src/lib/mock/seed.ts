/**
 * Seed data for the mocked backend. The hero demo is "Rumah 8×8 Modern Tropis"
 * (PRD §31) which appears across landing, dashboard, alternatives, etc.
 */
import type {
  Alternative,
  Brief,
  Project,
  RAB,
  User,
} from "@/types"

export const DEMO_PROJECT_ID = "proj-demo-8x8"

// Demo/mock user is plan "studio" so local dev + e2e can exercise every
// export format and other pro/studio-gated features without a real
// subscription (see Task 7, Mayar billing plan Global Constraints).
export const seedUser: User = {
  id: "user-1",
  name: "Budi Santoso",
  email: "budi@contoh.id",
  plan: "studio",
  creditsUsed: 12,
  creditsTotal: 500,
}

export const seedProjects: Project[] = [
  {
    id: DEMO_PROJECT_ID,
    name: "Rumah 8×8 Modern Tropis",
    status: "alternatives",
    readiness: "engineer_review_required",
    location: "Sidoarjo, Jawa Timur",
    city: "Sidoarjo",
    province: "Jawa Timur",
    style: "modern_tropis",
    projectType: "new",
    thumbnail: "courtyard",
    site: {
      widthM: 8,
      depthM: 8,
      areaM2: 64,
      city: "Sidoarjo",
      province: "Jawa Timur",
      frontOrientation: "east",
      sidesAttached: 2,
      frontRoadWidthM: 6,
    },
    floors: 3,
    rooftop: true,
    createdAt: "2026-06-12T03:20:00.000Z",
    updatedAt: "2026-06-18T09:05:00.000Z",
  },
  {
    id: "proj-minimalis-6x15",
    name: "Rumah Minimalis 6×15",
    status: "editing",
    readiness: "contractor_discussion_ready",
    location: "Bekasi, Jawa Barat",
    city: "Bekasi",
    province: "Jawa Barat",
    style: "minimalis",
    projectType: "new",
    thumbnail: "vertical",
    site: {
      widthM: 6,
      depthM: 15,
      areaM2: 90,
      city: "Bekasi",
      province: "Jawa Barat",
      frontOrientation: "south",
      sidesAttached: 2,
      frontRoadWidthM: 5,
    },
    floors: 2,
    rooftop: false,
    createdAt: "2026-05-28T02:10:00.000Z",
    updatedAt: "2026-06-15T11:40:00.000Z",
  },
  {
    id: "proj-renovasi-joglo",
    name: "Renovasi Joglo 10×20",
    status: "brief",
    readiness: "concept_ready",
    location: "Yogyakarta",
    city: "Yogyakarta",
    province: "DI Yogyakarta",
    style: "klasik",
    projectType: "renovation",
    thumbnail: "family",
    site: {
      widthM: 10,
      depthM: 20,
      areaM2: 200,
      city: "Yogyakarta",
      province: "DI Yogyakarta",
      frontOrientation: "north",
      sidesAttached: 0,
      frontRoadWidthM: 8,
    },
    floors: 1,
    rooftop: false,
    createdAt: "2026-06-10T08:00:00.000Z",
    updatedAt: "2026-06-11T07:15:00.000Z",
  },
]

export const seedBriefs: Record<string, Brief> = {
  [DEMO_PROJECT_ID]: {
    projectId: DEMO_PROJECT_ID,
    summary:
      "Rumah 3 lantai + rooftop di tanah 8×8 m, Sidoarjo. Fokus pada kesan lega, ruang kumpul keluarga, dan cahaya alami, dengan plunge pool dan rooftop lounge sebagai daya tarik.",
    site: {
      widthM: 8,
      depthM: 8,
      areaM2: 64,
      city: "Sidoarjo",
      province: "Jawa Timur",
      frontOrientation: "east",
      sidesAttached: 2,
      frontRoadWidthM: 6,
    },
    building: {
      floors: 3,
      rooftop: true,
      budget: { minIDR: 1_000_000_000, maxIDR: 1_600_000_000 },
      finishingLevel: "menengah",
    },
    priorities: ["terasa_lega", "keluarga_besar", "banyak_cahaya"],
    spaceProgram: [
      { id: "sp-1", roomType: "carport", name: "Carport", required: true, quantity: 1, preferredFloor: 1 },
      { id: "sp-2", roomType: "ruang_tamu", name: "Ruang tamu", required: true, quantity: 1, preferredFloor: 1 },
      { id: "sp-3", roomType: "area_kumpul", name: "Area kumpul keluarga", required: true, quantity: 1, preferredFloor: 1, sizePreference: "large" },
      { id: "sp-4", roomType: "dapur", name: "Dapur", required: true, quantity: 1, preferredFloor: 1 },
      { id: "sp-5", roomType: "ruang_makan", name: "Ruang makan", required: true, quantity: 1, preferredFloor: 1 },
      { id: "sp-6", roomType: "kolam", name: "Plunge pool", required: true, quantity: 1, preferredFloor: 1 },
      { id: "sp-7", roomType: "kamar_tidur", name: "Kamar tidur", required: true, quantity: 3, preferredFloor: 2 },
      { id: "sp-8", roomType: "kamar_mandi", name: "Kamar mandi", required: true, quantity: 3 },
      { id: "sp-9", roomType: "musholla", name: "Musholla", required: false, quantity: 1, preferredFloor: 2 },
      { id: "sp-10", roomType: "kamar_tidur", name: "Kamar utama", required: true, quantity: 1, preferredFloor: 3, sizePreference: "large" },
      { id: "sp-11", roomType: "rooftop_lounge", name: "Rooftop lounge", required: true, quantity: 1, sizePreference: "large" },
    ],
    assumptions: [
      "Tanah relatif datar dan kering.",
      "Akses jalan depan cukup untuk material standar.",
      "Sumber air dan listrik PLN tersedia di lokasi.",
      "Tinggi antar lantai 3,2 m (standar rumah tinggal).",
    ],
    constraints: [
      "Lahan sempit 8×8 m dengan 2 sisi menempel tetangga.",
      "Sirkulasi vertikal (tangga) memakan area di setiap lantai.",
      "Bukaan terbatas pada sisi depan dan belakang.",
    ],
    risks: [
      {
        id: "risk-1",
        level: "warning",
        category: "structural",
        title: "Bangunan 3 lantai",
        message:
          "Struktur 3 lantai perlu ditinjau engineer struktur sebelum dibangun.",
      },
      {
        id: "risk-2",
        level: "warning",
        category: "structural",
        title: "Plunge pool",
        message:
          "Kolam menambah beban dan kebutuhan waterproofing. Perlu review struktur & MEP.",
      },
      {
        id: "risk-3",
        level: "info",
        category: "spatial",
        title: "Cahaya & ventilasi",
        message:
          "Dengan 2 sisi menempel, pertimbangkan void atau skylight agar tetap terang dan adem.",
      },
    ],
  },
}

export const seedAlternatives: Record<string, Alternative[]> = {
  [DEMO_PROJECT_ID]: [
    {
      id: "alt-courtyard",
      projectId: DEMO_PROJECT_ID,
      name: "Compact Courtyard Pool",
      type: "terasa_lega",
      score: 88,
      thumbnail: "courtyard",
      description:
        "Void tengah + plunge pool di belakang membuat rumah terasa lega dan penuh cahaya meski lahan sempit.",
      keyFeatures: [
        "Void 2 lantai untuk cahaya",
        "Plunge pool di area belakang",
        "Rooftop lounge keluarga",
      ],
      pros: ["Terasa paling lega", "Cahaya alami maksimal", "Sirkulasi udara baik"],
      cons: ["Void mengurangi luas lantai", "Biaya finishing lebih tinggi"],
      estimatedCost: { minIDR: 1_250_000_000, maxIDR: 1_520_000_000 },
      readiness: "engineer_review_required",
      risks: [
        { level: "warning", label: "Perlu review struktur" },
        { level: "info", label: "Waterproofing kolam" },
      ],
      areaM2: 168,
      roomCount: 9,
      floors: 3,
    },
    {
      id: "alt-family",
      projectId: DEMO_PROJECT_ID,
      name: "Family Gathering Priority",
      type: "keluarga_besar",
      score: 84,
      thumbnail: "family",
      description:
        "Memaksimalkan ruang kumpul dan jumlah kamar untuk keluarga besar, dengan dapur-ruang makan menyatu.",
      keyFeatures: [
        "Area kumpul keluarga luas",
        "4 kamar tidur",
        "Dapur + ruang makan menyatu",
      ],
      pros: ["Kapasitas keluarga besar", "Ruang sosial luas", "Fleksibel"],
      cons: ["Kamar relatif kompak", "Plunge pool jadi opsional"],
      estimatedCost: { minIDR: 1_180_000_000, maxIDR: 1_440_000_000 },
      readiness: "engineer_review_required",
      risks: [{ level: "warning", label: "Perlu review struktur" }],
      areaM2: 172,
      roomCount: 11,
      floors: 3,
    },
    {
      id: "alt-vertical",
      projectId: DEMO_PROJECT_ID,
      name: "Cost Efficient Vertical House",
      type: "hemat_biaya",
      score: 80,
      thumbnail: "vertical",
      description:
        "Tata ruang efisien dan struktur sederhana untuk menekan biaya, tetap dengan rooftop sebagai bonus.",
      keyFeatures: [
        "Struktur grid sederhana",
        "Tanpa void agar luas maksimal",
        "Rooftop multifungsi",
      ],
      pros: ["Paling hemat", "Luas lantai maksimal", "Mudah dibangun"],
      cons: ["Kurang dramatis", "Cahaya tengah lebih terbatas"],
      estimatedCost: { minIDR: 980_000_000, maxIDR: 1_220_000_000 },
      readiness: "contractor_discussion_ready",
      risks: [{ level: "info", label: "Tetap cek beban rooftop" }],
      areaM2: 176,
      roomCount: 10,
      floors: 3,
    },
  ],
}

export const seedRAB: Record<string, RAB> = {
  [DEMO_PROJECT_ID]: {
    projectId: DEMO_PROJECT_ID,
    versionId: "ver-demo-1",
    areaM2: 168,
    summary: {
      lowIDR: 1_180_000_000,
      midIDR: 1_350_000_000,
      highIDR: 1_540_000_000,
      perM2IDR: 8_035_000,
      confidence: "medium",
    },
    items: [],
    assumptions: [
      "Harga satuan mengacu rata-rata Jawa Timur Q2 2026.",
      "Belum termasuk perizinan (PBG) dan biaya tak terduga.",
      "Finishing level: menengah.",
    ],
  },
}
