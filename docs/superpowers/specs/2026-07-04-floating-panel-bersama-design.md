# Sidebar Bersama — `<FloatingPanel>` (Editor 2D · Preview 3D · Gambar Kerja)

**Date:** 2026-07-04
**Status:** Design (disetujui user)
**Goal:** Satu komponen shell floating yang dipakai ketiga halaman (Editor 2D, Preview 3D, Gambar Kerja) — konsisten UI/UX, floating (pinned ke tepi), dan bisa di-minimize. Menyeragamkan **chrome**, menyisakan **isi** per-halaman.

## Context (kondisi kini)

- **Preview 3D** — sudah floating: `<aside data-testid="preview-floating-sidebar" className="absolute inset-y-4 right-4 z-30 w-[24rem] rounded-lg border bg-card/95 shadow-2xl backdrop-blur lg:block">` membungkus `PreviewControls`. **Belum bisa minimize.** e2e meng-assert `position:absolute` + body `preview-controls-scroll` `overflow-y:auto`.
- **Editor 2D** — panel kanan **docked**: `<aside className="hidden w-80 shrink-0 flex-col border-l bg-card lg:flex">` dengan strip 2-tab (Properti/Asisten) → `EditorInspector` / `EditorAssistantPanel`.
- **Gambar Kerja** — aside kiri **docked**: `<aside className="... lg:w-72 lg:border-r">` — header "Gambar Kerja" + daftar tombol `sheet-tab-<id>` (navigator) + cut-slider kondisional.
- Belum ada abstraksi floating/collapsible bersama. Primitive tersedia: `Card`, `collapsible` (radix, belum terpakai), `tabs`, `drawer` (fallback mobile), `scroll-area`. Token dark/light OKLCH; panel konsisten pakai `bg-card`, `border`, aktif `border-primary bg-primary/…`.
- Mobile: tiap halaman sudah punya fallback `Drawer` (editor 2 drawer, preview 1 drawer) / reflow (drawings).

## Keputusan desain (user-locked)

1. **"Floating" = overlay pinned ke tepi** (seperti Preview 3D kini), **bukan** jendela yang bisa diseret. Draggable = non-goal.
2. **Minimize → pill mengambang**: panel menciut jadi tombol/pill kecil di sudut sisi yang sama (ikon + judul); klik → buka. Status disimpan per-halaman (`localStorage`) agar bertahan lintas refresh/nav.
3. **Sisi natural per-peran**: Editor 2D + Preview 3D (inspector) → **kanan**; Gambar Kerja (navigator) → **kiri**.
4. **Shell menyeragamkan chrome saja**; isi body tetap spesifik per-halaman.
5. **Desktop-only chrome**: mobile tetap pakai Drawer/reflow yang ada (tak diubah); isi body dibagikan panel↔drawer.

## Komponen: `src/components/layout/floating-panel.tsx`

```ts
type FloatingPanelProps = {
  side: "left" | "right"
  title: React.ReactNode            // konten header kiri (judul / tab strip)
  actions?: React.ReactNode         // slot aksi header kanan (undo/redo, save, dsb)
  children: React.ReactNode         // isi body (scrollable)
  storageKey: string                // kunci persist status minimize (per halaman)
  widthClass?: string               // default "w-[24rem]"
  testId?: string                   // testid pada <aside> luar (mis. preview-floating-sidebar)
  bodyTestId?: string               // testid body scroll (mis. preview-controls-scroll)
  bodyClassName?: string            // kelas tambahan body
  minimizeLabel?: string            // aria-label tombol minimize/pill (default dari title)
}
```

**Perilaku:**
- **Expanded** (desktop, `hidden lg:flex`): `<aside>` `absolute inset-y-4 {side}-4 z-30 {widthClass} flex flex-col overflow-hidden rounded-lg border bg-card/95 shadow-2xl backdrop-blur`. Isi: header (`flex items-center justify-between border-b px-4 py-3`: `title` + `actions` + tombol minimize [ikon `PanelRightClose`/`PanelLeftClose` sesuai `side`, aria-label]) + body (`min-h-0 flex-1 overflow-y-auto p-3` + `bodyTestId`/`bodyClassName`).
- **Minimized**: body tak dirender; render `<button>` pill di `absolute top-4 {side}-4 z-30` (`flex items-center gap-2 rounded-full border bg-card/95 px-3 py-2 shadow-lg backdrop-blur`) dgn ikon + judul ringkas + `aria-label`; klik → expand.
- **State**: `useState(() => read localStorage[storageKey] ?? false)`; toggle → tulis localStorage. SSR-safe (guard `typeof window`).
- **z-index ≤ 30** (di bawah topbar sticky z-30 pada shell; CommandMenu z-50 tetap menang).

## Migrasi per halaman (isi tetap, dibungkus shell)

- **Preview 3D** (`preview-3d-view.tsx`): ganti `<aside …preview-floating-sidebar>` → `<FloatingPanel side="right" testId="preview-floating-sidebar" bodyTestId="preview-controls-scroll" storageKey="panel:preview3d" title={<h2>Preview 3D</h2>} actions={header actions PreviewControls}>{body PreviewControls}</FloatingPanel>`. `PreviewControls` di-refactor: header lama pindah ke `title`+`actions`; body tetap (7 AccordionSection + inspector cards). **Wajib jaga** testid + heading + label.
- **Editor 2D** (`editor/page.tsx`): ganti `<aside w-80>` → `<FloatingPanel side="right" storageKey="panel:editor" title={tab strip Properti/Asisten}>{aktif: EditorInspector | EditorAssistantPanel}</FloatingPanel>`. Kanvas jadi full-width (overlay kanan). Toolbar kiri (sudah kartu mengambang) tak disentuh.
- **Gambar Kerja** (`drawings/page.tsx`): ganti `<aside lg:w-72>` → `<FloatingPanel side="left" storageKey="panel:drawings" title={<h1>Gambar Kerja</h1>}>{daftar sheet-tab + cut-slider}</FloatingPanel>`. SVG jadi full-width (panel overlay kiri). Jaga `sheet-tab-<id>`, `cut-slider`, `mini-plan`.

## Testing

- **Unit** (`floating-panel.test.tsx`, jsdom): render body saat expanded; klik minimize → body hilang, pill tampil (aria-label); klik pill → body kembali; `storageKey` dibaca+ditulis (minimize persist); kelas posisi sesuai `side` (`left-4`/`right-4`); `testId`/`bodyTestId` diteruskan.
- **E2E**: SEMUA e2e existing tetap hijau (testid/heading/posisi terjaga — `preview-floating-sidebar` `position:absolute`, `preview-controls-scroll` `overflow-y:auto`, `sheet-tab-*`, `preview-3d-interior-add`, accordion `defaultOpen`). +1 e2e: minimize panel (mis. di /preview-3d) → pill tampil, klik → panel kembali.
- **Gate penuh**: tsc · vitest · build · Playwright FULL.

## Non-goals

Panel draggable/resizable; menyeragamkan fallback mobile ke satu Drawer bersama (tetap per-halaman); memindah/menyatukan toolbar kiri editor; mengubah isi/inspector apa pun (murni pembungkusan chrome).

## Risiko

- Editor/Drawings beralih dari docked → floating: konten utama (kanvas/SVG) jadi full-width, panel overlay. Saat expanded panel menutupi tepi konten — minimize (pill) memberi ruang penuh; dapat diterima (inspector/navigator). 
- e2e ketat pada Preview 3D (position:absolute, overflow-y:auto, banyak testid) — shell WAJIB pertahankan pada mode floating + passthrough testid.
- Status minimize shell TIDAK boleh mengganggu `defaultOpen=false` AccordionSection internal (e2e assert re-collapse saat remount).

## Sequencing (≈5 task)

T1 `<FloatingPanel>` + unit test → T2 migrasi Preview 3D (paling e2e-sensitif) → T3 migrasi Editor 2D → T4 migrasi Gambar Kerja → T5 e2e minimize + gate penuh + review akhir.
