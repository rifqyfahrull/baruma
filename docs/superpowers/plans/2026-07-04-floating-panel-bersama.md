# FloatingPanel Bersama — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Satu `<FloatingPanel>` shell dipakai Editor 2D / Preview 3D / Gambar Kerja — floating pinned ke tepi, bisa minimize→pill, chrome konsisten. e2e-gated.

**Architecture:** Komponen baru `src/components/layout/floating-panel.tsx` (chrome-only shell) + migrasi 3 halaman membungkus panel/aside mereka ke shell. Isi body tak diubah. Mobile Drawer/reflow per-halaman tetap.

## Global Constraints

- Spec: [2026-07-04-floating-panel-bersama-design.md](../specs/2026-07-04-floating-panel-bersama-design.md). Keputusan user: floating (bukan draggable); minimize→pill mengambang (persist localStorage); sisi kanan (editor+preview) / kiri (drawings); shell chrome-only.
- **Floating class (generalisasi aside preview-3d):** expanded `absolute inset-y-4 {side}-4 z-30 {widthClass} flex flex-col overflow-hidden rounded-lg border bg-card/95 shadow-2xl backdrop-blur`; desktop-only `hidden lg:flex`. `widthClass` default `"w-[24rem]"`.
- **Pill minimized:** `absolute top-4 {side}-4 z-30 flex items-center gap-2 rounded-full border bg-card/95 px-3 py-2 shadow-lg backdrop-blur`.
- **z-index ≤ 30**; CommandMenu (z-50) & topbar tetap menang.
- **e2e-WAJIB dijaga:** `preview-floating-sidebar` tetap `position:absolute` (aside luar); `preview-controls-scroll` tetap `overflow-y:auto`; heading "Preview 3D"/"Gambar Kerja"; `sheet-tab-<id>`, `cut-slider`, `mini-plan`, `preview-3d-interior-add`, `preview-active-furniture`, `interior-save-status`, accordion `defaultOpen` internal, nama tombol accordion/toggle, Edit-toggle title. Status minimize shell TIDAK ganggu AccordionSection internal.
- Tanpa dep baru; ikon dari `lucide-react` (sudah dipakai). Bahasa UI. Persist SSR-safe (guard `typeof window`).

---

## Task 1: `<FloatingPanel>` + unit test (TDD)
**Create** `src/components/layout/floating-panel.tsx` per spec (props side/title/actions/children/storageKey/widthClass/testId/bodyTestId/bodyClassName/minimizeLabel). Expanded aside (chrome + header[title+actions+tombol minimize ikon `PanelRightClose`/`PanelLeftClose` by side, aria-label] + body scroll passthrough); minimized pill (ikon `PanelRightOpen`/`PanelLeftOpen`, aria-label). State seed dari `localStorage[storageKey]` (guard window), toggle persist. **Create** `floating-panel.test.tsx` (jsdom): expanded render children; minimize→children hilang + pill (getByRole button aria-label); pill klik→children kembali; storageKey dibaca (seed minimized bila "1") + ditulis saat toggle; `side="left"`→kelas `left-4`, `right`→`right-4`; testId di aside, bodyTestId di body. Commit `feat(ui): FloatingPanel shell (floating + minimize pill)` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Task 2: Migrasi Preview 3D (paling e2e-sensitif)
**Modify** `src/components/preview-3d/preview-3d-view.tsx` (ganti `<aside …preview-floating-sidebar>` → `<FloatingPanel side="right" testId="preview-floating-sidebar" bodyTestId="preview-controls-scroll" storageKey="panel:preview3d" widthClass="w-[24rem]" title={<h2 …>Preview 3D</h2>} actions={<PreviewControlsActions/>}>{<PreviewControlsBody/>}</FloatingPanel>`) + `src/components/preview-3d/preview-controls.tsx` (pisah header lama jadi: actions cluster [undo/redo, Edit/View toggle, SaveIndicator] → `actions`; heading "Preview 3D" → `title`; body [7 AccordionSection + inspector cards] tetap; jangan ubah AccordionSection/testid/aria-label/heading). Mobile Drawer `PreviewControls` tetap (drawer render header+body versi lengkap seperti kini — atau bungkus body+actions; jaga agar mobile tetap punya semua kontrol). Verifikasi manual: preview-3d masih render, testid utuh. Commit `refactor(preview-3d): pakai FloatingPanel (+ minimize)` + trailer.

## Task 3: Migrasi Editor 2D
**Modify** `src/app/app/projects/[projectId]/editor/page.tsx` (ganti `<aside w-80 …lg:flex>` → `<FloatingPanel side="right" storageKey="panel:editor" title={<PanelTabs>Properti/Asisten</PanelTabs>}>{sidePanel==="properti" ? <EditorInspector/> : <EditorAssistantPanel mode="floorplan"/>}</FloatingPanel>`; tab strip `PanelTab` pindah ke `title`). Kanvas jadi full-width (overlay). Mobile Drawer (Properti+Asisten) tetap. Jaga: EditorInspector/StructuralSection/RoofInspector aria-label, testid save/assistant. Commit `refactor(editor): panel kanan pakai FloatingPanel` + trailer.

## Task 4: Migrasi Gambar Kerja
**Modify** `src/app/app/projects/[projectId]/drawings/page.tsx` (ganti `<aside lg:w-72>` → `<FloatingPanel side="left" storageKey="panel:drawings" title={<h1 …>Gambar Kerja</h1>}>{header copy + nav sheet-tab + cut-slider kondisional}</FloatingPanel>`). SVG area jadi full-width. Mobile: kini reflow (aside di atas) — pertahankan perilaku mobile (FloatingPanel desktop-only; mobile tampilkan daftar sheet seperti kini via non-lg fallback ATAU Drawer baru — pilih yang menjaga `sheet-tab-*` tetap terjangkau di mobile). Jaga `sheet-tab-<id>`, `cut-slider`, `mini-plan`, heading "Gambar Kerja". Commit `refactor(drawings): panel kiri pakai FloatingPanel` + trailer.

## Task 5: E2E minimize + gate penuh + review akhir
**Modify** `e2e/` (+1 test: /preview-3d → minimize panel via tombol (aria-label) → `preview-floating-sidebar` hilang/pill tampil → klik pill → panel kembali; run 2×). Existing e2e TIDAK dilemahkan. Gate penuh: `npx tsc` · `npx vitest run` · `npx next build` (langsung) · `pnpm exec playwright test` (FULL) → hijau. Review akhir whole-branch (opus). Commit `test(e2e): FloatingPanel minimize` + trailer.

---

## Self-Review
**Coverage:** komponen (T1), 3 migrasi (T2-T4), e2e+gate (T5). **Placeholder:** tidak ada — props, kelas floating/pill, storageKey, testid-dijaga dipatok. **Konsistensi:** `FloatingPanel` API T1 ↔ T2-T4; testid preserved list ↔ e2e T5. **Risiko:** T2 paling e2e-sensitif (dulukan, verifikasi testid/position/overflow); T4 mobile fallback drawings (kini reflow) — jaga sheet-tab terjangkau di mobile; status minimize shell vs AccordionSection internal (independen). **Pelajaran (SP4/SP5/SP6):** a11y aria-label tombol minimize/pill; build gate langsung; dev server bersih; jangan konkurenkan review-akhir dgn gate vitest.
