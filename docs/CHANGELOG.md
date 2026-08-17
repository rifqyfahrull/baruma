# Baruma Engineering Changelog

Dokumen ini mencatat update engineering penting yang sudah masuk ke `main`.

## 2026-07-13 — Facade Composer vertical slice

- Menambahkan tiga template tampak depan native: Modern Concrete Vertical,
  Brick Gable Roster, dan Minimalist Portal Carport. Template tersedia dari
  toolbar editor, mempertahankan elemen manual, dan apply/undo sebagai satu
  transaction.
- Menghubungkan seluruh `exteriorElements` ke Preview 3D: primitive pure,
  rotation/elevation per floor, polygon surface, selection, material, serta
  custom GLB dengan envelope fallback.
- Menghubungkan exterior semantic elements ke denah/elevasi Gambar Kerja dengan
  `refId` yang dapat ditelusuri.
- Mengintegrasikan quantity exterior ke RAB melalui rate catalog bertanggal,
  `sourceElementIds`, dan explicit exclusion untuk custom asset tanpa rate.
- Memperluas Unified AI Agent menjadi 36 action floorplan/MEP/facade/exterior,
  termasuk add/update/remove exterior dan apply facade template. Semua action
  melalui sanitizer dan store undo/redo yang sama dengan UI.
- Verification: full ESLint bersih, TypeScript bersih, 1.722 Vitest tests lulus,
  dan Next.js production build lulus.

## 2026-07-13 — Exterior frontage editor, lint cleanup, dan Next.js proxy migration

Status akhir: tidak ada pending item objektif yang diketahui setelah verifikasi `lint`, TypeScript, test suite, dan production build.

### Exterior / site frontage editor

- Menambahkan kanvas/editor exterior frontage untuk mengelola elemen tapak/fasad dari sisi editor.
- Menghubungkan toolbar, inspector, store actions, analytics, dan tipe data exterior agar elemen exterior menjadi bagian dari workflow editor yang sama.
- Memperbaiki aturan render exterior di plan canvas:
  - elemen `hidden` tidak dirender dan tidak punya selection handles;
  - elemen site-level tanpa `floorId` tampil di semua lantai;
  - elemen yang punya `floorId` hanya tampil di lantai yang sesuai.
- Factory exterior sekarang mempertahankan metadata umum seperti `locked` dan `hidden`.
- Test coverage ditambah untuk perilaku site-level, floor-owned, dan hidden exterior elements.

### Full repo lint cleanup

- `npm run lint` sekarang clean tanpa warning/error.
- Generated third-party decoder asset `public/draco/**` dikecualikan dari ESLint karena bukan source code aplikasi.
- Beberapa pola React 19 / React Compiler lint diperbaiki, terutama:
  - set state sinkron di effect;
  - akses/update ref saat render;
  - impure call saat render;
  - unescaped JSX text;
  - unused imports/helpers/variables.

### Next.js 16 proxy migration

- Migrasi file convention deprecated:
  - `src/middleware.ts` → `src/proxy.ts`
  - function `middleware` → `proxy`
- Matcher auth/session tetap sama:
  - `/app/:path*`
  - `/login`
  - `/register`
- Production build sudah tidak menampilkan warning `middleware` deprecated.

### Verifikasi

- `npm run lint` — pass, clean.
- `npx tsc --noEmit` — pass.
- `npm run test` — pass, 161 files / 1699 tests.
- `npm run build` — pass, tanpa warning `middleware-to-proxy`.
