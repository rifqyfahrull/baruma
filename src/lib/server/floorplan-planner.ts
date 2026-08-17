/**
 * AGENT UTAMA (baruma-assistant) — perencana untuk jalur editor denah.
 *
 * Opsi B dari sesi arsitektur agent (2026-08-01): user mengira "agent utama
 * berkomunikasi dengan agent denah", tapi kenyataannya `baruma-assistant`
 * TIDAK PERNAH terpanggil di jalur floorplan — router cuma keyword scoring
 * (project-agent.ts), dan satu-satunya LLM di pipeline adalah
 * `baruma-floorplan-actions` (llm.ts ACTIONS_SLUG). Log agent-lab 227 entri
 * membuktikannya: 100% baruma-floorplan-actions.
 *
 * Fungsi ini menutup celah itu dengan SATU panggilan prose tambahan (thinking
 * enabled) SEBELUM agent eksekusi: arsitek utama membaca permintaan + denah
 * ringkas, lalu menyusun rencana 3–5 butir yang disuntikkan ke prompt
 * floorplan-actions (RENCANA ARSITEK UTAMA) dan ditampilkan ke UI sebagai
 * kartu "Agent Utama". Rencana yang gagal dihasilkan (null) TIDAK menggagalkan
 * turn — pipeline jalan tanpa rencana, persis kontrak resilience llm.ts.
 */
import { chatText } from "@/lib/server/llm"
import type { Brief } from "@/types"
import type { FloorplanScene } from "@/lib/assistant/actions"

const PLANNER_SYSTEM =
  "Kamu ARSITEK UTAMA di aplikasi desain rumah Baruma. Tugasmu memahami permintaan " +
  "pengguna tentang denah, lalu menyusun RENCANA eksekusi singkat yang akan dikerjakan " +
  "Agent Denah (agent lain yang mengeksekusi aksi JSON).\n" +
  "Aturan:\n" +
  "- Balas HANYA rencana teks polos Bahasa Indonesia, 3–5 butir pendek, TANPA JSON, tanpa aksi, tanpa salam.\n" +
  "- Fokus: (1) maksud utama pengguna, (2) ruang yang terlibat (pakai NAMA ruang yang ada di DENAH di bawah), " +
  "(3) langkah eksekusi yang aman — jangan tumpang-tindih, jaga tiap ruang bisa diakses DARI DALAM rumah, " +
  "buat koridor bila ada ruang privat yang terkurung, (4) hal yang sebaiknya diklarifikasi ke pengguna bila ada.\n" +
  "- JANGAN mengarang id ruang atau aksi — itu tugas Agent Denah.\n" +
  "- DATA SUDAH LENGKAP — DILARANG meminta pengguna mengirim ulang daftar/nama/ukuran ruang. " +
  "Blok DENAH dan PROGRAM RUANG (BRIEF) di bawah adalah sumber kebenaran yang otoritatif; " +
  "meminta pengguna mengetik ulang isinya membuang waktu mereka.\n" +
  "- Bila DENAH kosong tetapi PROGRAM RUANG berisi daftar ruang, itu berarti rumah ini BELUM DIGAMBAR, " +
  "bukan datanya kurang: susun rencana membangun denah dari nol memakai program ruang tersebut. " +
  "Bagi ruang ke lantai sesuai fungsinya (publik/servis — carport, taman, ruang tamu, ruang keluarga, " +
  "ruang makan, dapur, laundry — di lantai dasar; privat — kamar tidur, kamar mandi — di lantai atas " +
  "bila diminta 2 lantai), sisakan jalur sirkulasi, dan sebut tangga bila lantainya lebih dari satu.\n" +
  "- MEMBANGUN DARI NOL ITU BERTAHAP. Bila program ruangnya besar (lebih dari 8 ruang), rencanakan " +
  "LANTAI DASAR SAJA untuk putaran ini — lengkap dengan KORIDOR selebar 0,9–1,2 m dari pintu masuk ke " +
  "area belakang supaya tiap ruang punya akses dari dalam — lalu sebut di butir terakhir bahwa lantai " +
  "atas menyusul di perintah berikutnya. Rencana yang memaksa semua ruang sekaligus akan ditolak " +
  "validator dan pengguna tidak mendapat apa pun.\n" +
  "- Angka pada ringkasan BRIEF (mis. \"12 ruang, ~199 m²\") menggambarkan program ruang, BUKAN bukti " +
  "denah sudah tergambar. Percayai blok DENAH untuk kondisi gambar saat ini.\n" +
  "- PERMINTAAN PENGGUNA MENANG atas angka lama di brief. Bila pengguna meminta 2 lantai sementara brief " +
  "menyebut 1 lantai, itu BUKAN konflik yang perlu dikonfirmasi — pengguna sedang mengubah keputusannya. " +
  "Susun rencana untuk 2 lantai, dan cukup sebut satu kalimat bahwa brief akan menyesuaikan. " +
  "JANGAN menjadikan selisih semacam ini sebagai alasan menunda eksekusi.\n" +
  "- Hanya bila DENAH kosong DAN PROGRAM RUANG kosong kamu boleh meminta arahan ruang ke pengguna — " +
  "itu satu-satunya kondisi yang sah untuk klarifikasi semacam itu.\n" +
  "- Bila permintaan tidak jelas karena sebab lain, tulis rencana klarfikasi: butir terakhir menyebut pertanyaan yang perlu ditanyakan."

/** Konteks denah RINGKAS untuk perencana — cukup untuk memahami, tidak seberat
 *  prompt eksekusi (yang membawa seluruh DENAH + katalog aksi). Menjaga biaya
 *  tetap rendah: 1 panggilan prose kecil sebelum eksekusi. */
function compactScene(scene: FloorplanScene): string {
  const floors = scene.floors.length
    ? scene.floors.map((f) => `${f.name} (${f.id})`).join(", ")
    : "(belum ada lantai)"
  // Denah kosong HARUS dinyatakan sebagai kalimat, bukan daftar kosong. Regresi
  // proj-modern-tropis-1: daftar ruang kosong + summary brief yang menyebut
  // "12 ruang" membuat Planner menyimpulkan denahnya ada tapi tak terkirim,
  // lalu menagih "nama dan ukuran 12 ruang eksisting" ke pengguna.
  const rooms = scene.rooms.length
    ? scene.rooms
        .map(
          (r) =>
            `${r.name} [${r.type}] ${r.width}×${r.depth} m @x${r.x},y${r.y} (${r.floorId})`
        )
        .join("\n")
    : "(BELUM ADA RUANG — denah masih kosong, rumah belum digambar sama sekali)"
  return (
    `- Lahan: ${scene.site.widthM}×${scene.site.depthM} m\n` +
    `- Lantai: ${floors}\n` +
    `- Ruang:\n${rooms}`
  )
}

/**
 * PROGRAM RUANG dari brief — daftar ruang yang diinginkan pemilik.
 *
 * Dulu tidak pernah dikirim: `compactBrief` hanya memuat summary + priorities,
 * sehingga Planner tahu "ada 12 ruang" (dari kalimat summary) tapi tidak tahu
 * ruang apa saja. Untuk proyek yang denahnya kosong, ini satu-satunya sumber
 * daftar ruang — tanpa itu Planner mustahil menyusun rencana dan pasti bertanya
 * balik.
 */
function compactSpaceProgram(brief?: Brief | null): string {
  const program = brief?.spaceProgram
  if (!program?.length) return "(kosong — pemilik belum menentukan kebutuhan ruang)"
  return program
    .map((item) => {
      const qty = item.quantity > 1 ? ` ×${item.quantity}` : ""
      const size = item.sizePreference ? `, ukuran ${item.sizePreference}` : ""
      const floor = item.preferredFloor ? `, minta lantai ${item.preferredFloor}` : ""
      return `- ${item.name || item.roomType} [${item.roomType}]${qty}${size}${floor}`
    })
    .join("\n")
}

function compactBrief(brief?: Brief | null): string {
  if (!brief) return "—"
  return (
    `"${brief.summary ?? "—"}"` +
    (brief.priorities?.length ? `; prioritas: ${brief.priorities.join(", ")}` : "") +
    (brief.building?.floors ? `; target ${brief.building.floors} lantai` : "")
  )
}

/**
 * Satu panggilan ke `baruma-assistant` (PROSE_SLUG, thinking ENABLED) untuk
 * menyusun rencana eksekusi. Mengembalikan teks rencana, atau null bila layanan
 * gagal — pemanggil HARUS lanjut tanpa rencana, tidak pernah throw.
 */
export async function planFloorplanTurn(args: {
  instruction: string
  scene: FloorplanScene
  brief?: Brief | null
}): Promise<string | null> {
  const user =
    "PERMINTAAN PENGGUNA:\n" +
    args.instruction +
    "\n\nDENAH (ringkas):\n" +
    compactScene(args.scene) +
    "\n\nPROGRAM RUANG (BRIEF — daftar ruang yang diinginkan pemilik):\n" +
    compactSpaceProgram(args.brief) +
    "\n\nBRIEF (ringkas): " +
    compactBrief(args.brief)
  try {
    const plan = await chatText([
      { role: "system", content: PLANNER_SYSTEM },
      { role: "user", content: user },
    ])
    if (!plan || !plan.trim()) return null
    const trimmed = plan.trim()
    return trimmed.length > 1200 ? trimmed.slice(0, 1200) : trimmed
  } catch (e) {
    console.error("[floorplan-planner] plan failed:", e instanceof Error ? e.message : String(e))
    return null
  }
}
