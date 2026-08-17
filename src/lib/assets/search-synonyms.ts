/**
 * Ekspansi sinonim pencarian aset — mayoritas customer Baruma orang Indonesia,
 * tetapi katalog Objaverse bernama Inggris ("Gate", "Sofa", "Sink"). Fungsi ini
 * memetakan istilah Indonesia → padanan Inggris (dan kategori internal) sehingga
 * mencari "pagar"/"gerbang"/"pintu masuk" tetap menemukan model bernama "Gate".
 *
 * Dipakai server-side di listUserAssets (ILIKE ANY). Dua arah tak perlu: cukup
 * memperluas query ke SEMUA istilah terkait, lalu OR-kan.
 */

/** Grup sinonim: semua istilah dalam satu grup saling ekuivalen untuk search. */
const SYNONYM_GROUPS: string[][] = [
  // Eksterior / arsitektur
  ["gate", "gerbang", "pintu masuk", "pintu gerbang", "portal"],
  ["fence", "pagar", "railing pagar"],
  ["door", "pintu"],
  ["window", "jendela"],
  ["facade", "fasad", "muka bangunan", "tampak depan"],
  ["stair", "staircase", "tangga"],
  ["railing", "pagar tangga", "handrail", "balustrade"],
  ["canopy", "kanopi"],
  ["pergola", "pergola"],
  ["roof", "atap", "genteng"],
  ["column", "pillar", "kolom", "tiang", "pilar"],
  ["balcony", "balkon"],
  ["carport", "garasi", "carport"],
  ["roster", "krawangan", "loster", "roster"],
  // Interior / furnitur
  ["kitchen", "dapur", "kitchen set"],
  ["cabinet", "cupboard", "kabinet", "lemari", "kabinet dapur"],
  ["wardrobe", "closet", "lemari pakaian", "lemari baju"],
  ["sofa", "couch", "sofa"],
  ["armchair", "kursi santai"],
  ["chair", "kursi", "seat", "bangku"],
  ["stool", "bangku", "dingklik"],
  ["table", "meja"],
  ["desk", "meja kerja", "meja tulis"],
  ["coffee table", "meja kopi", "meja tamu"],
  ["dining table", "meja makan"],
  ["nightstand", "meja samping", "nakas"],
  ["bed", "tempat tidur", "ranjang", "kasur", "dipan"],
  ["dresser", "meja rias", "meja hias"],
  ["shelf", "bookshelf", "rak", "rak buku"],
  ["sideboard", "bufet", "credenza"],
  ["tv stand", "meja tv", "rak tv"],
  // Sanitair / kamar mandi
  ["sink", "washbasin", "basin", "wastafel"],
  ["toilet", "kloset", "wc", "closet duduk"],
  ["bathtub", "bak mandi", "bathtub"],
  ["shower", "pancuran", "shower"],
  ["faucet", "tap", "kran", "keran"],
  ["bathroom", "kamar mandi", "sanitair", "sanitary", "toilet"],
  // Lampu
  ["lamp", "light", "lampu"],
  ["chandelier", "lampu gantung", "lampu kristal"],
  ["pendant light", "lampu gantung"],
  ["ceiling light", "lampu plafon", "lampu langit-langit"],
  ["wall light", "sconce", "lampu dinding"],
  ["floor lamp", "lampu lantai", "standing lamp"],
  // Dekorasi
  ["vase", "vas", "pot bunga"],
  ["mirror", "cermin", "kaca rias"],
  ["rug", "carpet", "karpet", "permadani"],
  ["curtain", "gorden", "tirai", "korden"],
  ["plant", "tanaman", "pohon", "tree"],
  ["planter", "pot", "pot tanaman", "planter box"],
  ["clock", "jam", "jam dinding"],
  ["painting", "wall art", "lukisan", "hiasan dinding"],
]

// Peta istilah (lowercase) → set semua istilah dalam grupnya.
const TERM_TO_GROUP = new Map<string, string[]>()
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    TERM_TO_GROUP.set(term.toLowerCase(), group)
  }
}

/**
 * Perluas query pencarian menjadi daftar fragmen yang HARUS di-OR-kan (ILIKE).
 * Selalu menyertakan query asli. Jika query (atau salah satu katanya) cocok
 * sebuah grup sinonim, tambahkan seluruh istilah grup itu.
 *
 * Contoh: "pagar" → ["pagar", "fence", "railing pagar"]
 *         "pintu masuk" → ["pintu masuk", "gate", "gerbang", ...]
 */
export function expandSearchTerms(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out = new Set<string>([q])

  // Cocokkan frase penuh dulu (mis. "pintu masuk", "meja makan").
  const group = TERM_TO_GROUP.get(q)
  if (group) for (const t of group) out.add(t.toLowerCase())

  // Lalu per-kata (mis. "pagar besi" → ekspansi "pagar").
  for (const word of q.split(/\s+/)) {
    const g = TERM_TO_GROUP.get(word)
    if (g) for (const t of g) out.add(t.toLowerCase())
  }

  return [...out]
}
