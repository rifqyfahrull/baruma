import type {
  FurnitureItem,
  InteriorStyleId,
  InteriorStylePreset,
  MaterialItem,
  RoomType,
} from "@/types"

export const INTERIOR_STYLES: InteriorStylePreset[] = [
  {
    id: "modern_tropical",
    name: "Modern Tropis",
    description: "Terang, natural, banyak kayu, tanaman, dan udara hangat.",
    mood: "Santai, adem, dan mudah dipadukan dengan rumah tropis Indonesia.",
    colors: {
      primary: "#F7F3EA",
      secondary: "#8B6F47",
      accent: "#2F5D50",
      wood: "#A97845",
      metal: "#3F4B45",
      fabric: "#D9CBB8",
    },
    materials: {
      floor: ["Vinyl oak natural", "Homogeneous tile cream"],
      wall: ["Cat off white", "Limewash halus"],
      ceiling: ["Gypsum putih matte"],
      accent: ["Panel kayu", "Batu alam terang"],
    },
    lighting: ["Warm downlight", "Indirect light", "Wall lamp"],
  },
  {
    id: "warm_minimalist",
    name: "Minimalis Warm",
    description: "Bersih dan rapi dengan warna hangat yang tidak terasa dingin.",
    mood: "Tenang, mudah dirawat, dan cocok untuk ruang kecil.",
    colors: {
      primary: "#F8F1E8",
      secondary: "#C8A27A",
      accent: "#6C7762",
      wood: "#B8875D",
      metal: "#7A746A",
      fabric: "#E4D8C8",
    },
    materials: {
      floor: ["Vinyl warm oak", "Granite cream matte"],
      wall: ["Cat warm white", "Microcement soft beige"],
      ceiling: ["Gypsum putih hangat"],
      accent: ["Laminate kayu", "Ribbed panel"],
    },
    lighting: ["Warm downlight", "Pendant sederhana", "Task light"],
  },
  {
    id: "japandi",
    name: "Japandi",
    description: "Rapi, natural, rendah visual noise, dan menonjolkan tekstur.",
    mood: "Kalem, fungsional, dan terasa lega.",
    colors: {
      primary: "#F4EFE5",
      secondary: "#B69B7A",
      accent: "#4F5D50",
      wood: "#C69B6D",
      metal: "#6E6A60",
      fabric: "#D8D1C3",
    },
    materials: {
      floor: ["Vinyl oak muda", "Parket engineered"],
      wall: ["Cat ivory", "Limewash beige"],
      ceiling: ["Gypsum shadowline"],
      accent: ["Panel kayu terang", "Anyaman natural"],
    },
    lighting: ["Paper pendant", "Indirect warm light", "Low glare downlight"],
  },
  {
    id: "scandinavian",
    name: "Scandinavian",
    description: "Terang, ringan, praktis, dengan aksen warna lembut.",
    mood: "Bersih, friendly, dan cocok untuk keluarga muda.",
    colors: {
      primary: "#F9FAF7",
      secondary: "#D8D2C1",
      accent: "#6F92A3",
      wood: "#D7B98E",
      metal: "#C6C8C4",
      fabric: "#E7E2D8",
    },
    materials: {
      floor: ["Vinyl ash light", "Tile putih matte"],
      wall: ["Cat putih hangat", "Panel wainscot simple"],
      ceiling: ["Gypsum putih"],
      accent: ["Oak veneer", "Fabric panel"],
    },
    lighting: ["Neutral downlight", "Floor lamp", "Pendant linen"],
  },
  {
    id: "industrial",
    name: "Industrial",
    description: "Material jujur, kontras gelap, metal, dan tekstur beton.",
    mood: "Tegas, urban, dan tahan pakai.",
    colors: {
      primary: "#E7E1D8",
      secondary: "#66605A",
      accent: "#9A5A35",
      wood: "#8A5A36",
      metal: "#2E3130",
      fabric: "#7B746B",
    },
    materials: {
      floor: ["Polished concrete", "Tile semen matte"],
      wall: ["Cat abu hangat", "Exposed brick"],
      ceiling: ["Expose ceiling rapi"],
      accent: ["Metal hitam", "Kayu reclaimed"],
    },
    lighting: ["Track light", "Metal pendant", "Wall washer"],
  },
  {
    id: "luxury_compact",
    name: "Luxury Compact",
    description: "Terasa premium tanpa memenuhi ruangan dengan terlalu banyak item.",
    mood: "Rapi, elegan, dan cocok untuk ruang terbatas.",
    colors: {
      primary: "#F6F0E7",
      secondary: "#B08A5E",
      accent: "#263B3A",
      wood: "#7B5234",
      metal: "#B9975B",
      fabric: "#D7C1AD",
    },
    materials: {
      floor: ["Granite cream large slab", "SPC premium oak"],
      wall: ["Cat ivory", "Marble-look panel"],
      ceiling: ["Drop ceiling indirect"],
      accent: ["Brass trim", "Fluted panel"],
    },
    lighting: ["Indirect cove light", "Decorative wall lamp", "Warm spotlight"],
  },
  {
    id: "family_cozy",
    name: "Family Cozy",
    description: "Nyaman untuk kumpul, mudah dirapikan, dan ramah anak.",
    mood: "Hangat, empuk, dan terasa hidup.",
    colors: {
      primary: "#FBF2E8",
      secondary: "#C98F62",
      accent: "#446B5B",
      wood: "#B97F55",
      metal: "#7A6E62",
      fabric: "#E6C8AE",
    },
    materials: {
      floor: ["Vinyl anti slip", "Tile cream matte"],
      wall: ["Cat washable warm white", "Panel fabric"],
      ceiling: ["Gypsum putih"],
      accent: ["Storage kayu", "Rug woven"],
    },
    lighting: ["Warm downlight", "Floor lamp", "Indirect night light"],
  },
]

const allStyles = INTERIOR_STYLES.map((s) => s.id)
const warmStyles: InteriorStyleId[] = [
  "modern_tropical",
  "warm_minimalist",
  "japandi",
  "family_cozy",
]
const materialRoomTypes: RoomType[] = [
  "ruang_tamu",
  "ruang_keluarga",
  "area_kumpul",
  "kamar_tidur",
  "dapur",
  "ruang_makan",
  "kamar_mandi",
  "workspace",
  "rooftop_lounge",
  "musholla",
  "laundry",
  "balkon",
  "taman",
]

export const FURNITURE_LIBRARY: FurnitureItem[] = [
  item("sofa-3-seat", "Sofa 3 Dudukan", "seating", 2.1, 0.85, 0.8, ["ruang_tamu", "ruang_keluarga", "area_kumpul"], warmStyles, 2_500_000, 5_000_000, 12_000_000, 0.6, 0.2),
  item("sofa-l", "Sofa L Compact", "seating", 2.4, 1.6, 0.8, ["ruang_keluarga", "area_kumpul"], ["warm_minimalist", "family_cozy", "luxury_compact"], 4_500_000, 9_000_000, 18_000_000, 0.75, 0.2),
  item("coffee-table", "Coffee Table", "table", 0.9, 0.55, 0.42, ["ruang_tamu", "ruang_keluarga", "area_kumpul", "rooftop_lounge"], allStyles, 600_000, 1_500_000, 4_000_000, 0.35, 0.2),
  item("tv-cabinet", "Meja TV / TV Cabinet", "cabinet", 1.8, 0.45, 0.55, ["ruang_tamu", "ruang_keluarga", "kamar_tidur", "area_kumpul"], allStyles, 1_500_000, 4_000_000, 12_000_000, 0.6, 0.15),
  item("tv-55", "TV 55 Inch", "appliance", 1.25, 0.12, 0.75, ["ruang_tamu", "ruang_keluarga", "kamar_tidur", "area_kumpul"], allStyles, 3_500_000, 7_500_000, 18_000_000, 0.6, 0.1),
  item("rug-large", "Karpet Area", "decor", 1.8, 1.3, 0.02, ["ruang_tamu", "ruang_keluarga", "area_kumpul", "kamar_tidur"], allStyles, 450_000, 1_200_000, 4_500_000, 0.1, 0.1),
  item("queen-bed", "Kasur Queen", "bed", 1.6, 2.0, 0.9, ["kamar_tidur"], allStyles, 3_500_000, 6_500_000, 18_000_000, 0.7, 0.45),
  item("single-bed", "Kasur Single", "bed", 1.0, 2.0, 0.85, ["kamar_tidur"], allStyles, 2_000_000, 4_000_000, 10_000_000, 0.6, 0.35),
  item("wardrobe-2m", "Lemari / Wardrobe Built-in 2m", "wardrobe", 2.0, 0.6, 2.4, ["kamar_tidur"], allStyles, 6_000_000, 12_000_000, 28_000_000, 0.8, 0.1),
  item("wardrobe-free", "Lemari Pakaian 1.6m", "wardrobe", 1.6, 0.58, 2.1, ["kamar_tidur", "ruang_keluarga"], allStyles, 3_500_000, 7_500_000, 18_000_000, 0.75, 0.1),
  item("side-table", "Nakas / Side Table", "table", 0.45, 0.4, 0.5, ["kamar_tidur", "ruang_tamu"], allStyles, 350_000, 850_000, 2_500_000, 0.2, 0.1),
  item("work-desk", "Meja Kerja", "workspace", 1.2, 0.6, 0.75, ["workspace", "kamar_tidur"], allStyles, 1_000_000, 2_800_000, 7_000_000, 0.75, 0.15),
  item("kitchen-linear", "Kitchen Set Linear", "kitchen", 2.6, 0.6, 2.4, ["dapur"], allStyles, 9_000_000, 18_000_000, 45_000_000, 0.9, 0.1),
  item("fridge", "Kulkas 2 Pintu", "appliance", 0.72, 0.72, 1.7, ["dapur"], allStyles, 3_000_000, 6_000_000, 16_000_000, 0.8, 0.1),
  item("dining-table-4", "Dining Table 4 Kursi", "table", 1.4, 0.85, 0.75, ["ruang_makan", "dapur"], allStyles, 2_000_000, 5_000_000, 14_000_000, 0.8, 0.6),
  item("bathroom-shower", "Area Shower", "bathroom_fixture", 0.9, 0.9, 2.1, ["kamar_mandi"], allStyles, 1_500_000, 3_500_000, 9_000_000, 0.45, 0.1),
  item("bathroom-vanity", "Wastafel + Mirror", "bathroom_fixture", 0.8, 0.45, 1.8, ["kamar_mandi"], allStyles, 1_500_000, 4_000_000, 12_000_000, 0.6, 0.1),
  item("toilet", "Toilet", "bathroom_fixture", 0.45, 0.7, 0.8, ["kamar_mandi"], allStyles, 1_200_000, 3_000_000, 8_000_000, 0.6, 0.1),
  item("prayer-rug-area", "Area Sajadah 2 Orang", "prayer", 1.3, 1.2, 0.02, ["musholla"], warmStyles, 250_000, 800_000, 2_000_000, 0.45, 0.2),
  item("quran-shelf", "Rak Al-Qur'an", "storage", 0.8, 0.32, 1.2, ["musholla"], warmStyles, 600_000, 1_500_000, 4_000_000, 0.5, 0.1),
  item("laundry-machine", "Mesin Cuci", "appliance", 0.65, 0.65, 0.9, ["laundry"], allStyles, 2_500_000, 5_000_000, 12_000_000, 0.7, 0.1),
  item("outdoor-sofa", "Outdoor Sofa", "outdoor", 1.8, 0.8, 0.75, ["rooftop_lounge", "balkon", "area_kumpul"], ["modern_tropical", "industrial", "family_cozy"], 3_000_000, 7_000_000, 18_000_000, 0.75, 0.25),
  item("planter", "Planter Box", "decor", 1.2, 0.35, 0.45, ["rooftop_lounge", "balkon", "taman"], ["modern_tropical", "family_cozy", "japandi"], 450_000, 1_500_000, 4_500_000, 0.3, 0.1),
]

export const MATERIAL_LIBRARY: MaterialItem[] = [
  material("floor-vinyl-oak", "Vinyl Motif Oak", "floor", "m2", 120_000, 180_000, 350_000, warmStyles, ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "area_kumpul", "workspace", "musholla"], "medium", "medium"),
  material("floor-cream-tile", "Homogeneous Tile Cream", "floor", "m2", 180_000, 280_000, 650_000, allStyles, ["ruang_tamu", "ruang_keluarga", "dapur", "ruang_makan", "kamar_mandi"], "low", "high"),
  material("floor-porcelain-matte", "Porcelain Tile Matte 60x60", "floor", "m2", 220_000, 340_000, 780_000, allStyles, ["ruang_tamu", "ruang_keluarga", "dapur", "ruang_makan", "kamar_tidur", "workspace"], "low", "high"),
  material("floor-terrazzo", "Terrazzo Tile", "floor", "m2", 260_000, 480_000, 950_000, ["warm_minimalist", "japandi", "scandinavian", "luxury_compact"], ["ruang_tamu", "ruang_keluarga", "dapur", "ruang_makan", "workspace"], "low", "high"),
  material("floor-polished-concrete", "Polished Concrete", "floor", "m2", 220_000, 380_000, 750_000, ["industrial", "luxury_compact"], ["ruang_tamu", "ruang_keluarga", "dapur", "rooftop_lounge"], "low", "high"),
  material("wall-warm-white", "Cat Warm White Washable", "wall_paint", "m2", 45_000, 75_000, 140_000, allStyles, ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "dapur", "ruang_makan", "workspace", "musholla"], "low", "medium"),
  material("wall-limewash", "Limewash Texture", "wall_paint", "m2", 90_000, 160_000, 320_000, warmStyles, ["kamar_tidur", "ruang_tamu", "ruang_keluarga"], "medium", "low"),
  material("panel-wood", "Panel Kayu / HPL", "wall_panel", "m2", 250_000, 450_000, 950_000, ["modern_tropical", "warm_minimalist", "japandi", "luxury_compact", "family_cozy"], ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "area_kumpul"], "medium", "medium"),
  material("wall-exposed-brick", "Bata Ekspos / Brick Veneer", "wall_panel", "m2", 180_000, 320_000, 700_000, ["industrial", "modern_tropical", "family_cozy"], ["ruang_tamu", "ruang_keluarga", "dapur", "area_kumpul"], "medium", "medium"),
  material("wall-stone-cladding", "Batu Alam Cladding", "wall_panel", "m2", 280_000, 520_000, 1_100_000, ["modern_tropical", "industrial", "luxury_compact"], ["ruang_tamu", "ruang_keluarga", "taman", "rooftop_lounge"], "medium", "high"),
  material("wall-wallpaper-stripes", "Wallpaper Garis Vertikal", "wall_paint", "m2", 85_000, 150_000, 300_000, allStyles, ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "ruang_makan", "workspace"], "low", "medium"),
  material("wall-wainscot-panel", "Panel Wainscot Klasik", "wall_panel", "m2", 220_000, 380_000, 780_000, ["warm_minimalist", "family_cozy", "luxury_compact", "scandinavian"], ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "ruang_makan"], "medium", "medium"),
  material("wall-geometric-motif", "Motif Geometris Aksen", "wall_panel", "m2", 190_000, 340_000, 700_000, ["modern_tropical", "japandi", "luxury_compact", "industrial"], ["ruang_tamu", "ruang_keluarga", "area_kumpul", "musholla"], "low", "medium"),
  // ── Motif tekstur ASLI dari bank asset (SketchUp Master Design Kit) ──
  material("wall-bata-metro-putih", "Bata Metro Putih", "wall_panel", "m2", 170_000, 300_000, 640_000, allStyles, ["dapur", "kamar_mandi", "ruang_tamu", "ruang_keluarga"], "low", "high"),
  material("wall-bata-putih", "Bata Ekspos Putih", "wall_panel", "m2", 180_000, 320_000, 680_000, ["scandinavian", "warm_minimalist", "industrial", "japandi"], ["ruang_tamu", "ruang_keluarga", "kamar_tidur", "workspace"], "medium", "medium"),
  material("wall-bata-warna", "Bata Warna Halus", "wall_panel", "m2", 175_000, 310_000, 660_000, ["family_cozy", "modern_tropical", "industrial"], ["ruang_tamu", "ruang_keluarga", "area_kumpul"], "medium", "medium"),
  material("wall-bata-merah", "Bata Merah Klasik", "wall_panel", "m2", 165_000, 290_000, 620_000, ["industrial", "modern_tropical", "family_cozy"], ["ruang_tamu", "ruang_keluarga", "dapur", "taman"], "medium", "high"),
  material("wall-bata-tua", "Bata Tua Rustic", "wall_panel", "m2", 185_000, 330_000, 690_000, ["industrial", "luxury_compact"], ["ruang_tamu", "ruang_keluarga", "workspace"], "medium", "high"),
  material("panel-kayu-hetre", "Panel Kayu Hetre", "wall_panel", "m2", 240_000, 430_000, 900_000, ["japandi", "scandinavian", "warm_minimalist", "family_cozy"], ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "area_kumpul"], "medium", "medium"),
  material("panel-kayu-rosewood", "Panel Kayu Rosewood", "wall_panel", "m2", 280_000, 500_000, 1_050_000, ["luxury_compact", "modern_tropical", "warm_minimalist"], ["kamar_tidur", "ruang_tamu", "ruang_keluarga"], "medium", "medium"),
  material("floor-parket-maple", "Parket Maple", "floor", "m2", 240_000, 420_000, 880_000, ["scandinavian", "japandi", "warm_minimalist"], ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "workspace"], "medium", "medium"),
  material("floor-parket-cherry", "Parket Cherry", "floor", "m2", 260_000, 460_000, 950_000, ["luxury_compact", "family_cozy", "warm_minimalist"], ["kamar_tidur", "ruang_tamu", "ruang_keluarga"], "medium", "medium"),
  material("floor-parket-oak", "Parket Oak Natural", "floor", "m2", 250_000, 440_000, 920_000, allStyles, ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "ruang_makan", "workspace"], "medium", "medium"),
  material("floor-karpet-loop", "Karpet Loop Abu", "floor", "m2", 150_000, 260_000, 540_000, ["family_cozy", "scandinavian", "warm_minimalist"], ["kamar_tidur", "ruang_keluarga", "workspace"], "high", "low"),
  material("floor-karpet-gelap", "Karpet Loop Gelap", "floor", "m2", 155_000, 270_000, 560_000, ["industrial", "luxury_compact"], ["kamar_tidur", "ruang_keluarga", "workspace"], "high", "low"),
  material("floor-karpet-stripes", "Karpet Stripes", "floor", "m2", 160_000, 280_000, 580_000, ["family_cozy", "modern_tropical"], ["kamar_tidur", "ruang_keluarga"], "high", "low"),
  // ── Wave 2 bank asset: marmer, HPL, parket, kayu (2026-07-11) ──
  material("floor-marmer-carrara", "Marmer Carrara", "floor", "m2", 650_000, 1_100_000, 2_400_000, ["luxury_compact", "warm_minimalist", "scandinavian"], ["ruang_tamu", "ruang_keluarga", "ruang_makan", "kamar_mandi"], "high", "high"),
  material("floor-marmer-travertine", "Travertine Krem", "floor", "m2", 480_000, 850_000, 1_800_000, ["luxury_compact", "modern_tropical", "warm_minimalist"], ["ruang_tamu", "ruang_keluarga", "ruang_makan"], "high", "medium"),
  material("floor-parket-natural", "Parket Natural Plank", "floor", "m2", 240_000, 420_000, 880_000, allStyles, ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "workspace", "musholla"], "medium", "medium"),
  material("floor-parket-gelap", "Parket Walnut Gelap", "floor", "m2", 270_000, 480_000, 980_000, ["luxury_compact", "industrial", "family_cozy"], ["kamar_tidur", "ruang_tamu", "ruang_keluarga"], "medium", "medium"),
  material("wall-marmer-emperador", "Marmer Emperador (Aksen)", "wall_panel", "m2", 750_000, 1_300_000, 2_800_000, ["luxury_compact", "modern_tropical"], ["ruang_tamu", "ruang_keluarga", "kamar_mandi"], "high", "high"),
  material("panel-hpl-winter-maple", "HPL Winter Maple", "wall_panel", "m2", 210_000, 380_000, 780_000, ["scandinavian", "japandi", "warm_minimalist"], ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "workspace"], "low", "medium"),
  material("panel-hpl-dark-moka", "HPL Dark Moka", "wall_panel", "m2", 210_000, 380_000, 780_000, ["luxury_compact", "industrial", "family_cozy"], ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "area_kumpul"], "low", "medium"),
  material("panel-hpl-auburn-oak", "HPL Auburn Oak", "wall_panel", "m2", 210_000, 380_000, 780_000, allStyles, ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "workspace", "area_kumpul"], "low", "medium"),
  material("panel-kayu-alder", "Panel Kayu Alder", "wall_panel", "m2", 260_000, 470_000, 960_000, ["japandi", "scandinavian", "warm_minimalist", "modern_tropical"], ["kamar_tidur", "ruang_tamu", "ruang_keluarga"], "medium", "medium"),
  material("panel-kayu-beech", "Panel Kayu Beech", "wall_panel", "m2", 255_000, 460_000, 940_000, ["scandinavian", "japandi", "family_cozy"], ["kamar_tidur", "ruang_tamu", "ruang_keluarga", "workspace"], "medium", "medium"),
  material("backsplash-subway-tile", "Subway Tile Backsplash", "backsplash", "m2", 160_000, 280_000, 620_000, allStyles, ["dapur", "kamar_mandi", "laundry"], "low", "high"),
  material("bathroom-tile", "Keramik Kamar Mandi Anti Slip", "bathroom_tile", "m2", 180_000, 320_000, 850_000, allStyles, ["kamar_mandi", "laundry"], "low", "high"),
  material("outdoor-deck", "Decking Outdoor WPC", "outdoor_decking", "m2", 350_000, 650_000, 1_300_000, ["modern_tropical", "industrial", "family_cozy"], ["rooftop_lounge", "balkon", "taman"], "medium", "high"),
  material("ceiling-gypsum", "Plafon Gypsum Putih", "ceiling", "m2", 95_000, 150_000, 260_000, allStyles, materialRoomTypes, "low", "medium"),
  material("ceiling-shadowline", "Plafon Gypsum Shadowline", "ceiling", "m2", 140_000, 230_000, 420_000, ["warm_minimalist", "japandi", "luxury_compact"], materialRoomTypes, "low", "medium"),
  material("ceiling-expose-industrial", "Expose Ceiling Industrial", "ceiling", "m2", 120_000, 220_000, 450_000, ["industrial"], ["ruang_tamu", "ruang_keluarga", "dapur", "workspace"], "medium", "medium"),
]

export function getInteriorStyle(id: InteriorStyleId): InteriorStylePreset {
  return INTERIOR_STYLES.find((style) => style.id === id) ?? INTERIOR_STYLES[0]
}

export function getFurniture(id: string): FurnitureItem | undefined {
  return FURNITURE_LIBRARY.find((item) => item.id === id)
}

export function getMaterial(id: string): MaterialItem | undefined {
  return MATERIAL_LIBRARY.find((item) => item.id === id)
}

export function furnitureForRoom(roomType: RoomType, style: InteriorStyleId): FurnitureItem[] {
  return FURNITURE_LIBRARY.filter(
    (item) => item.roomTypes.includes(roomType) && item.styleTags.includes(style)
  )
}

function item(
  id: string,
  name: string,
  category: FurnitureItem["category"],
  widthM: number,
  depthM: number,
  heightM: number,
  roomTypes: RoomType[],
  styleTags: InteriorStyleId[],
  low: number,
  mid: number,
  high: number,
  frontM: number,
  sideM: number
): FurnitureItem {
  return {
    id,
    name,
    category,
    widthM,
    depthM,
    heightM,
    roomTypes,
    styleTags,
    priceRange: { low, mid, high },
    clearance: { frontM, sideM },
  }
}

function material(
  id: string,
  name: string,
  category: MaterialItem["category"],
  unit: MaterialItem["unit"],
  low: number,
  mid: number,
  high: number,
  styleTags: InteriorStyleId[],
  suitableRooms: RoomType[],
  maintenance: MaterialItem["maintenance"],
  waterResistance: MaterialItem["waterResistance"]
): MaterialItem {
  return {
    id,
    name,
    category,
    unit,
    priceRange: { low, mid, high },
    styleTags,
    suitableRooms,
    maintenance,
    waterResistance,
  }
}
