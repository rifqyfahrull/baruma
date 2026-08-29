# AI Render × AI Chat — Style Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User bisa mengarahkan render lewat chat Asisten (aksi `aiRender` → dialog pre-filled) atau field manual "Catatan gaya"; teks user jadi klausa terapit di prompt (fakta di depan, guard diperkuat di belakang), tetap provider yang ada.

**Architecture:** Lihat spec `docs/superpowers/specs/2026-08-29-ai-render-chat-style-notes-design.md` (AUTHORITATIVE — semua format klausa, aturan sanitasi, dan alur ada di sana). Perubahan: assistant actions + prompt server + dialog/panel klien + migrasi kolom audit.

**Tech Stack:** sama dgn fase sebelumnya.

## Global Constraints

- Semua konstrain fase sebelumnya (pure/deterministik, never-throw, snapshot lama byte-identik tanpa styleNotes, komentar Indonesia, fragmen prompt Inggris).
- styleNotes user TIDAK PERNAH menggantikan/menyusul geometry guard — guard (+ penguatan non-struktural) selalu klausa terakhir; komposisi di server, bukan template klien.
- Sanitasi server WAJIB sebelum dipakai prompt/DB: kontrol char, URL, kutip ganda→tunggal, collapse whitespace, cap 240, kosong→undefined.
- `params_hash` klien memuat styleNotes bila ada; tanpa styleNotes kunci byte-identik dgn sebelumnya.
- Migrasi idempoten `db/migrations/0044_render_style_notes.sql` (nomor cek ulang saat implementasi — bila 0044 sudah terpakai, pakai nomor bebas berikutnya + catat).
- Verifikasi per task `rtk vitest run <files>`; akhir: `rtk tsc --noEmit`, `rtk vitest run`, `rtk next build`, `rtk playwright test e2e/ai-render.spec.ts`.

## Task breakdown

### Task 1: Aksi `aiRender` (klien-shared) — `actions.ts`, `apply.ts`, `feature-catalog.ts`
**Files:** Modify `src/lib/assistant/actions.ts` (+test), `src/lib/assistant/apply.ts` (+test bila ada idiomnya), `src/lib/assistant/feature-catalog.ts` (+test existing menjaga konsistensi action nyata).
- [ ] Test dulu: schema `{type:"aiRender", target, roomId?, presetId?, styleNotes? (max 240)}` valid; target selain exterior/interior → invalid; ada di KEDUA union (floorplan & interior); `describeAction` menghasilkan kalimat "Buka dialog Render AI…"; apply atomic no-op utk aiRender (layout tak berubah).
- [ ] Implement (satu konstanta schema bersama di-spread ke kedua union), run green + tsc, commit `feat(assistant): aksi aiRender — schema, describeAction, apply no-op, kamus fitur`.

### Task 2: Prompt server + sanitasi + migrasi + repo — `style-notes.ts`, `prompt.ts`, migrasi, `renders.ts`, `view.ts`
**Files:** Create `src/lib/server/ai-render/style-notes.ts` (+test); Modify `prompt.ts` (+test/+snap), `db/migrations/0044_render_style_notes.sql`, `src/lib/server/repo/renders.ts` (+test), `src/lib/server/ai-render/view.ts`.
- [ ] Test dulu: sanitizeStyleNotes (URL dibuang, kontrol char, kutip ganda→tunggal, collapse, cap 240, kosong/whitespace→undefined); compilePromptV2/compilePromptInterior param `styleNotes?` → klausa `client wishes (mood and non-structural additions only): "<teks>"` setelah deskripsi(+lampu) sebelum fragmen preset + guard diperkuat (kalimat persis di spec) — dan TANPA styleNotes semua snapshot lama byte-identik; repo insert dinamis kolom `style_notes` (pola target/roomId Fase B) + `RenderJob.styleNotes?` + COLS + view.
- [ ] Implement, run green (prompt+polish+renders test) + tsc, commit `feat(ai-render): klausa catatan gaya terapit + sanitasi + kolom audit style_notes`.

### Task 3: Route — terima & teruskan styleNotes
**Files:** Modify `src/app/api/v1/projects/[id]/renders/route.ts` (+test; kasus lama JANGAN diubah).
- [ ] Test dulu: body styleNotes valid → prompt ke provider memuat "client wishes" + createRenderJob menerima styleNotes TERSANITASI; styleNotes berisi URL → yang tersimpan/terpakai sudah bersih; >240 → 400 dari zod; tanpa styleNotes → perilaku lama byte-identik (kasus lama hijau).
- [ ] Implement (zod max 240 → sanitizeStyleNotes → teruskan ke compile* dan createRenderJob), run green + tsc, commit `feat(ai-render): route terima styleNotes tersanitasi`.

### Task 4: Server prompt agent — `editor-assistant.ts`
**Files:** Modify `src/lib/server/editor-assistant.ts` (+test existing suite).
- [ ] Test dulu (ikut idiom test editor-assistant yang ada): parse respons LLM berisi aksi aiRender lolos `floorplanActionSchema.safeParse` jalur existing (±baris 486); blok prompt system menyebut aksi aiRender + aturan (hanya saat diminta render; styleNotes Inggris ringkas non-struktural; roomId dari scene snapshot; presetId dari id preset yang disebut — daftar id RENDER_PRESETS di-inline di prompt).
- [ ] Implement, run green + tsc, commit `feat(assistant): agent tahu aksi aiRender (dokumentasi prompt + validasi)`.

### Task 5: Klien — store prefill, intercept panel, field dialog, hash, kontrak
**Files:** Modify `src/stores/preview-store.ts` (+test), `src/components/assistant/project-agent-panel.tsx` (+test), `src/components/preview-3d/ai-render-dialog.tsx` (+test), `src/lib/three/render-capture.ts` (+test hash), `src/lib/data/source.ts`, `src/lib/mock/index.ts`.
- [ ] Test dulu: store `requestAiRenderPrefill` (nonce bump + payload); panel — pesan dgn [aiRender, addRoom] → prefill terpanggil 1×, addRoom tetap di-apply, toast arahan bila perlu; dialog — nonce prefill membuka dialog & mengisi (roomId invalid → fallback, preset invalid → fallback), field textarea maxLength 240 + counter, chip "dari Asisten" hilang saat edit, payload memuat styleNotes non-kosong saja; renderParamsHash input opsional styleNotes → append ke key HANYA bila ada (tanpa → hash lama byte-identik, dites).
- [ ] Implement, run green + tsc penuh, commit `feat(ai-render): chat pre-fill dialog + field Catatan gaya + hash`.

### Task 6: E2E + verifikasi penuh
**Files:** `e2e/ai-render.spec.ts`.
- [ ] Kasus baru: buka dialog → isi "Catatan gaya" manual ("warm sunset, add a parked car") → submit → sukses mock (pola kasus existing). Jalankan e2e 7/7, lalu `rtk tsc --noEmit` 0, `rtk vitest run` 0 fail, `rtk next build` 0.
- [ ] Commit `feat(ai-render): e2e catatan gaya + verifikasi`.

## Catatan eksekutor
Task 1 → (2,4) paralel-aman setelah 1; Task 3 butuh 2; Task 5 butuh 1+3; Task 6 terakhir. Kerjakan berurutan 1→2→3→4→5→6 (aman). Jangan sentuh polish.ts (input polish tetap facts murni) & kredit/cache/webhook.
