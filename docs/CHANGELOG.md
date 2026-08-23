# Baruma Engineering Changelog

Dokumen ini mencatat update engineering penting yang sudah masuk ke `main`.

## 2026-08-23 — Production Gelombang 1 (branch `feat/production-g1`)

- **Ops**: CI PR (tsc/eslint/vitest/build), `GET /api/health` + smoke deploy,
  Sentry (no-op tanpa DSN), validasi env saat boot (prod tanpa DB = crash
  jelas), backup DB nightly ke S3 + runbook restore, rate limit 6 route
  kritis, fix refund kredit agent (BAR-SEC-04), purge skrip ber-token prod +
  runbook rotasi kredensial.
- **Billing**: email transaksional Resend (welcome/kuitansi/reminder/expired),
  cron maintenance harian (expiry sweep + reminder H-7), riwayat transaksi +
  kuitansi PDF, tab Rekonsiliasi admin, Pro tanpa batas project
  (`maxProjects: null`).
- **Ekspor**: DXF R12 nyata (denah semua lantai, meter sungguhan), watermark
  PDF plan Free, Contractor Pack lengkap (denah + asumsi + warnings +
  thumbnail 3D), ZIP All, worksheet Asumsi di RAB Excel, kartu IFC "Segera".
- **Journey**: template→project (galeri/detail/dashboard), share link publik
  `/s/[token]` (viewer read-only + komentar tamu), OG/sitemap/robots,
  `builtArea` RAB mengecualikan ruang outdoor, biaya kredit tampil sebelum
  dipakai + saldo tak lagi basi.
- **Growth**: Umami analytics (22 event funnel hidup), checklist onboarding
  dashboard, kartu kredit/plan, halaman `/app/help`.

## 2026-08-22 — Unifikasi UI editor 2D/3D (branch `feat/editor-ui-cleanup`)

- Primitives chrome bersama (FloatingBar/ToolButton/Pill/ToolbarMore +
  SurfaceSwitcher [2D|3D]); rail 2D ~25→12 tombol dgn palette pencarian;
  rail 3D 10 tombol; ProjectBar h-12 (chrome atas 162→48px, nav 4 tahap);
  mode Fokus terpadu; satu model peringatan (tab "Cek"); SegmentedControl
  jadi idiom enum; ±2.000 baris kode mati dihapus; guard e2e touch-target
  ≥40px + bukti muat 720p.

## 2026-08-22 — Parent billing orchestration & fix keamanan Agustus

- Billing dialihkan ke orkestrasi parent (tampil.dev↔Mayar); idempotensi
  webhook via atomic UPDATE; fix BAR-SEC-01/02/03 (privesc allowlist admin,
  bypass rate-limit XFF, zip-bomb autosave).

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
