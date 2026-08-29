# AI Render × AI Chat — Catatan Gaya User (Style Notes) — Design

Tanggal: 2026-08-29 · Status: disetujui user · Lanjutan spec scene-intelligence
(2026-08-23) & split-level (2026-08-29).

## Masalah & tujuan

User ingin mengarahkan hasil render dengan bahasa natural lewat dialog AI Chat
(panel Asisten proyek), tetap memakai provider AI Renderer yang ada. Desain v1
sengaja melarang prompt bebas (anti prompt-injection, konsistensi, geometry
guard). Solusi: teks user TIDAK menggantikan prompt — ia menjadi SATU klausa
"catatan gaya" yang diapit fakta scene deterministik (depan) dan geometry
guard yang diperkuat (belakang). Komposisi, bukan substitusi.

## Keputusan (dari brainstorm)

1. **Alur**: chat → agent mengeluarkan aksi `aiRender` → panel Asisten MEMBUKA
   dialog Render AI pre-filled (target/ruangan/preset/catatan gaya). User
   menekan Generate sendiri — kredit terpotong sadar. TIDAK ada render
   langsung dari chat.
2. **Batas prompting**: gaya/suasana/mood/cahaya DAN isi **non-struktural**
   (orang, kendaraan, vegetasi, dekor). Guard diperkuat: penambahan hanya
   boleh non-struktural; bangunan tak pernah diubah.
3. Field "Catatan gaya" juga bisa diketik MANUAL di dialog (chat hanya salah
   satu jalan masuk; chip "dari Asisten" saat pre-filled).

## Komponen

### 1. Aksi agent `aiRender` (`src/lib/assistant/actions.ts` + server)
- Schema (ditambahkan ke `floorplanActionSchema` DAN `interiorActionSchema`
  via satu konstanta bersama supaya kedua mode chat bisa memicunya):
  `{ type: "aiRender", target: "exterior"|"interior", roomId?: string,
  presetId?: string, styleNotes?: string (max 240) }`.
- `describeAction()` dapat case: `Buka dialog Render AI ({target}...)`.
- `apply.ts` atomic appliers: no-op eksplisit utk `aiRender` (defensif — panel
  seharusnya sudah menyaringnya sebelum apply).
- `src/lib/server/editor-assistant.ts`: blok dokumentasi aksi utk LLM +
  instruksi: keluarkan HANYA saat user minta render; `styleNotes` ditulis
  Inggris ringkas (terjemahan permintaan user), tanpa instruksi struktural;
  `roomId` dari nama ruangan di scene snapshot; `presetId` salah satu id
  RENDER_PRESETS bila user menyebut suasana yang cocok.
- `src/lib/assistant/feature-catalog.ts`: entri baru (trigger `agent`, action
  `aiRender`) supaya asisten sadar kapabilitas ini.

### 2. Panel Asisten (`src/components/assistant/project-agent-panel.tsx`)
- Di titik eksekusi aksi (±baris 304): pisahkan aksi `aiRender` dari daftar
  SEBELUM `applyFloorplanActionsAtomic`/`applyInteriorActionsAtomic`;
  jalankan dgn memanggil store request baru; sisanya diterapkan seperti biasa.
- Store (`preview-store.ts`): `aiRenderPrefill: {target, roomId?, presetId?,
  styleNotes?, nonce} | null` + `requestAiRenderPrefill(p)` (bump nonce).
  Dialog Render AI (yang hidup di toolbar preview-3d) bereaksi pada nonce:
  buka dialog + isi state. Bila user sedang di halaman editor 2D (dialog tak
  ter-mount), panel menampilkan toast arahan "Buka Preview 3D untuk render"
  — prefill tetap tersimpan di store dan dipakai saat dialog mount.

### 3. Dialog Render AI (`ai-render-dialog.tsx`)
- Field baru "Catatan gaya (opsional)" — textarea 1-3 baris, maxLength 240 +
  counter, di kedua target. Chip kecil "dari Asisten" bila terisi via prefill
  (hilang saat user mengedit).
- Prefill: saat `aiRenderPrefill.nonce` berubah → `setOpen(true)` + isi
  target/roomId (validasi: roomId harus ada di layout, selain itu abaikan)/
  preset (validasi id, fallback preset aktif)/styleNotes.
- Payload `createRender` + `styleNotes?: string` (hanya bila non-kosong).
- `paramsHash`: bila styleNotes ada, ikutkan dalam kunci hash (append) —
  catatan beda = cache entry beda; TANPA styleNotes kunci identik dgn
  sebelumnya (kompat cache lama).

### 4. Server (`POST /renders` + prompt + DB)
- Body + `styleNotes: z.string().max(240).optional()`.
- `sanitizeStyleNotes(raw)` (pure, di `src/lib/server/ai-render/style-notes.ts`):
  strip karakter kontrol, buang URL (`https?://…`, `www.…`), kutip ganda →
  kutip tunggal, collapse whitespace, trim, potong 240; hasil kosong →
  undefined. Deterministik + unit test.
- Prompt: `compilePromptV2`/`compilePromptInterior` param opsional baru
  `styleNotes` → klausa `client wishes (mood and non-structural additions
  only): "<teks>"` disisipkan SETELAH deskripsi (+klausa lampu) SEBELUM
  fragmen preset; dan guard diperkuat HANYA saat styleNotes ada:
  `PROMPT_GEOMETRY_GUARD + "; requested additions may only introduce
  non-structural elements (people, vehicles, plants, furniture, decor) and
  mood changes; never alter, add, or remove any part of the building itself"`.
  Tanpa styleNotes → output byte-identik dgn sekarang (snapshot lama utuh).
- Polish TIDAK berubah (input polish tetap facts murni, tanpa styleNotes).
- Migrasi `0044_render_style_notes.sql`: `ALTER TABLE render_jobs ADD COLUMN
  IF NOT EXISTS style_notes text;` — repo insert dinamis (pola target/roomId),
  `RenderJob.styleNotes?`, COLS, `RenderJobView.styleNotes?` (audit/galeri).

## Keamanan & properti yang dipertahankan
- Geometry guard selalu klausa terakhir; styleNotes tak pernah bisa
  menimpanya (komposisi string server-side, bukan template user).
- Provider gambar tidak mengeksekusi tool — worst case injection = gambar
  aneh; sanitasi memblokir URL & kutip ganda (pecah kutipan) + cap 240.
- Kredit/rate-limit/flag `ai_render_v1` tak berubah; determinisme: prompt =
  f(facts, preset, styleNotes-tersanitasi) tetap pure.

## Testing
- actions: schema aiRender valid/invalid; describeAction; apply no-op.
- panel: pesan berisi aiRender + aksi lain → aiRender di-intercept (request
  prefill terpanggil), sisanya tetap di-apply.
- dialog: prefill mengisi & membuka; roomId/preset invalid → fallback; edit
  field menghapus chip; payload memuat styleNotes; hash berubah saat notes
  beda & identik saat kosong.
- style-notes.ts: URL dibuang, kontrol char, 240 cap, kutip ganda, kosong.
- prompt: snapshot dgn styleNotes (eksterior+interior) memuat klausa+guard
  diperkuat; tanpa styleNotes byte-identik.
- route: styleNotes diteruskan tersanitasi ke prompt & job; repo insert.
- e2e: ketik catatan gaya manual di dialog → render mock sukses (smoke).

## Di luar cakupan
Render langsung dari chat (tanpa dialog); hasil render muncul sebagai balasan
chat; terjemahan server-side; moderasi konten LLM; menampilkan styleNotes di
galeri (kolom sudah ada — UI menyusul).
