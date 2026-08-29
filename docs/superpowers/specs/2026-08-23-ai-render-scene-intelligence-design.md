# AI Render Scene Intelligence — Design

Tanggal: 2026-08-23 · Status: disetujui user (brainstorm sesi 2026-08-23)

## Masalah

Fitur AI Render v1 (docs/plan-integrasi-ai-renderer-2026-08.md) hanya mengirim
screenshot + depth map + 3 fakta tipis (`facadeMaterials` unik, `roofType`,
`floors`) ke provider gambar. AI tidak tahu sisi bangunan mana yang difoto,
material dinding mana yang terlihat, elemen eksterior apa yang masuk frame,
dimensi/proporsi, maupun isi ruangan — padahal semua data itu ada di
`DesignLayout`. Hasil render terasa "menebak" dan tidak bisa render interior.

## Keputusan desain (dari brainstorm)

1. **Cakupan**: eksterior diperkuat + kemampuan baru interior per ruang.
   Dua fase: Fase A (eksterior cerdas) live dulu, baru Fase B (interior).
2. **Mekanisme analisa**: **hybrid** — analyzer deterministik (pure TS) wajib
   sebagai fondasi; lapisan LLM *polish* opsional di belakang flag.
3. **Sudut pandang**: **dua-duanya** — preset bidikan lama tetap ada (dipetakan
   ke pose kamera standar) + tombol "Render sudut ini" (pose kamera bebas).
   Satu jalur analisa: semua bidikan = pose kamera.

## Arsitektur

Analisa pindah ke **server**, bersumber dari **layout di DB**
(`getLayoutPayload` di `src/lib/server/repo/layouts.ts`). Klien hanya mengirim
yang cuma dia yang tahu: pose kamera + gambar capture.

```
Dialog → capture beauty+depth + pose {position, target, fov}
      → upload → POST /renders { mode, preset, pose, shotId?, target, roomId? }
      → server: getLayoutPayload(projectId)
      → analyzeScene(layout, site, pose[, roomId])  → SceneFacts | RoomFacts
      → [flag] polishScene(facts) → string|null      (cache per hash(facts))
      → compilePrompt v2 → Gemini (Cepat) / FLUX depth (Presisi)
```

Pipeline job/kredit/webhook/watermark **tidak berubah**.

### Unit baru (semua di `src/lib/server/ai-render/`)

| File | Tanggung jawab | Kontrak |
|---|---|---|
| `analyze.ts` | `analyzeScene(layout, site, pose) → SceneFacts` — pure, deterministik | Tak pernah throw; input sama → output identik |
| `analyze-room.ts` | `analyzeRoom(layout, pose atau roomId) → RoomFacts` | Sama; roomId tak ditemukan → null (route → 400) |
| `prompt.ts` (diperluas) | `describeScene v2`: facts → klausa prompt berurutan tetap; basis prompt interior terpisah | Snapshot-test; geometry guard lama dipertahankan |
| `polish.ts` | `polishScene(facts) → Promise<string\|null>` — lapisan LLM opsional | Never-throw; flag off/gagal/timeout 5 dtk → null → fallback deskripsi deterministik |

`pose` divalidasi zod di route: `{ position: [x,y,z], target: [x,y,z], fov: number }`,
angka finite, fov 10–120.

## `SceneFacts` (eksterior)

Dihitung deterministik dari pose + layout:

- **Sudut pandang**: sisi bangunan menghadap kamera (vektor kamera→pusat
  footprint → 1–2 sisi N/S/E/W), ketinggian kamera (eye-level <2,5 m /
  elevated / aerial), jarak (close-up/medium/wide dari rasio jarak vs diagonal
  footprint), lensa ekuivalen dari fov.
- **Fasad per sisi terlihat**: cladding tiap dinding sisi itu
  (`layout.facade` per wallId), jumlah & tipe bukaan (pintu/jendela/pintu
  garasi), `facadeElements` (louver, kanopi), balkon + gaya railing.
- **Elemen eksterior dalam frame**: frustum check 2D footprint elemen
  (`exteriorElements`: pagar, carport, kolam, taman, portal, tembok batas) —
  hanya yang masuk frame yang disebut.
- **Atap**: `roofZones` terlihat (tipe per zona) atau `roof` global, dak
  rooftop + railing (`rooftopArea`/`rooftopRailingStyle`), `skylights`.
- **Massa & proporsi**: dimensi tapak & footprint (meter), jumlah lantai +
  perkiraan tinggi, setback lantai atas.
- **Konteks preset**: `exteriorLamps` (dipakai preset Malam), vegetasi.

## `RoomFacts` (interior, Fase B)

- **UX**: pilihan target Eksterior/Interior di dialog. Interior: dropdown
  ruangan per lantai (`layout.rooms`) → kamera otomatis eye-level ±1,5 m di
  dalam ruang menghadap diagonal terpanjang (scene preview existing; atap
  disembunyikan saat capture lalu dikembalikan). Atau "Render sudut ini" saat
  kamera sudah di dalam footprint sebuah ruang (dideteksi analyzer).
- **Fakta**: tipe ruang, dimensi & luas, lantai ke-berapa, tinggi plafon;
  material & gaya & palet warna dari `RoomInteriorPlan`
  (`materials`, `style`, `colorPalette`); furnitur `PlacedFurniture[]` dengan
  posisi relatif kasar ("bed against the north wall"); jendela per dinding →
  arah cahaya alami; pintu koneksi; gorden (`curtainModelUrl`); skylight;
  `lighting` (preset Malam).
- **Prompt interior**: basis fotografi sendiri (*interior architectural
  photography, 16–24 mm, natural light from the window side*) + 4 preset
  suasana yang sama. Depth capture identik (near/far dirapatkan ke bounding
  ruang — mekanisme existing di render-capture.ts).

## Lapisan LLM opsional & divergensi 2 repo

- Flag `FEATURE_AI_RENDER_POLISH` (default **off**), pola flags §21.
- Hasil polish **di-cache per `hash(facts)`** — render ulang layout sama tidak
  memanggil LLM lagi; `params_hash` tetap bermakna.
- **Divergensi repo diisolasi di `polish.ts` saja**: repo utama → Agent Lab;
  Emergent (rifqyfahrull/baruma) → openai-client. File sengaja kecil & jarang
  berubah; bila auto-sync (`.github/workflows/sync-emergent.yml`) bentrok di
  file ini, workflow gagal-jelas sesuai desain — port manual.

## DB & API

- Migrasi `0040`: di `render_jobs` tambah `target` text default 'exterior'
  (`exterior`/`interior`), `room_id` text null, `camera_pose` jsonb null; plus
  tabel cache terpisah `render_polish_cache(facts_hash text pk, description
  text, created_at)` — terpisah karena satu hasil polish dipakai lintas job
  selama layout tidak berubah. `shot_id` lama tetap valid (dipetakan ke pose).
- `POST /renders` menerima `pose` (wajib untuk jalur baru), `target`,
  `roomId` (wajib bila target=interior). Backward compat: request lama tanpa
  pose (shotId saja) tetap jalan — shotId → pose standar di server.

## Pricing, testing, rollout

- Kredit tak berubah: Cepat 1 / Presisi 2; interior tarif sama; polish tidak
  menambah biaya kredit user.
- Testing: unit analyzer (pose→sisi, frustum, deteksi ruang dari pose),
  snapshot prompt v2 (eksterior & interior), route test validasi pose/roomId,
  e2e capture interior headless (pola `e2e/ai-render.spec.ts`).
- Rollout: Fase A live & terverifikasi dulu → Fase B. Gerbang utama tetap
  `ai_render_v1`.

## Di luar cakupan

- Multi-image / video render, edit hasil render, prompt bebas user (tetap
  dilarang — anti prompt-injection), perubahan provider.
