# Baruma — Frontend

Web-based SaaS untuk membuat konsep rumah terukur dari ide sederhana: brief →
alternatif layout → editor denah 2D → preview 3D → RAB → contractor pack.
Dibangun **frontend-first** dengan **mocked backend** (lihat [docs/PRD.md](docs/PRD.md)).

> Prinsip: user awam harus merasa mudah, tetapi output teknis harus tetap jujur
> soal batasannya.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (radix-nova, Geist font, Lucide icons)
- **TanStack Query** (server state) + **Zustand** (UI state)
- **React Hook Form + Zod** (forms & validation)
- **Auth.js (NextAuth v5)** — real auth, Credentials + demo fallback
- **Data layer** (`src/lib/data`) — mock ⇄ HTTP, di-switch via env (lihat [docs/API.md](docs/API.md))

## Menjalankan

```bash
pnpm install
cp .env.example .env.local && echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env.local
pnpm dev          # http://localhost:3000
pnpm build        # production build
npx tsc --noEmit  # typecheck
pnpm test         # Vitest unit/component (32)
pnpm test:e2e     # Playwright E2E + a11y (auto dev server :3100, 26 test)
```

Tanpa backend, app jalan di **mock** (in-memory). Untuk menyambung backend asli,
set `NEXT_PUBLIC_API_URL` (+ `NEXT_PUBLIC_DATA_SOURCE=http`) dan implement endpoint
di [docs/API.md](docs/API.md). Schema DB kanonik: [db/migrations/0001_init.sql](db/migrations/0001_init.sql).

## Yang sudah dibangun (FE-0 → FE-3)

| Area | Status |
| --- | --- |
| Design system + brand palette (teal/sand) + tema light/dark | ✅ |
| Landing page + Pricing (`/`, `/pricing`) | ✅ |
| Auth nyata — Auth.js (`/login`, `/register`, `/forgot-password`) | ✅ |
| Billing & paket (`/app/billing`) — langganan Mayar nyata + admin backoffice (`/app/admin`) | ✅ |
| App shell (sidebar, topbar, command palette ⌘K, user menu, credits) | ✅ |
| Dashboard + Projects list (`/app/dashboard`, `/app/projects`) | ✅ |
| Create-project wizard 5 langkah (`/app/projects/new`) | ✅ |
| Project workspace shell (header + tabs) | ✅ |
| Brief page (`/app/projects/[id]/brief`) | ✅ |
| Alternatives + comparison (`/app/projects/[id]/alternatives`) | ✅ |
| 2D Editor MVP (`/app/projects/[id]/editor`) — SVG denah | ✅ |
| 3D Preview MVP (`/app/projects/[id]/preview-3d`) — React Three Fiber | ✅ |
| RAB / BOQ (`/app/projects/[id]/rab`) — estimasi biaya dari layout | ✅ |
| Exports (`/app/projects/[id]/exports`) — mock jobs, warning, lock | ✅ |
| Review & Share (`/app/projects/[id]/review`) — warnings, checklist, komentar | ✅ |

### Demo

Mulai dari **Dashboard** → project **"Rumah 8×8 Modern Tropis"** (PRD §31), atau
buat project baru lewat wizard. Semua data dari mock API (`src/lib/mock`).

### 2D Editor (FE-4)

SVG-based, internal unit meter (PRD §16). Pilih/geser/resize ruang (snap grid),
tambah pintu/jendela, ganti lantai, zoom/pan (wheel + Space), undo/redo,
validasi live (keluar batas / bertumpuk / ventilasi), simpan draft. Layout awal
di-generate dari brief dengan **squarified treemap** yang mengisi penuh luas
tanah (`src/lib/geometry` → `squarifiedTreemap`).

### 3D Preview (FE-5)

React Three Fiber, di-generate dari layout JSON yang sama (PRD §17): slab,
dinding, bukaan, kolam, atap + railing rooftop. Orbit/zoom/pan, toggle
visibilitas per lantai, exploded view, sembunyikan atap, label, furnitur,
5 material preset (Modern Tropis/Minimalis/Industrial/Japandi/Warm Wood),
view preset (iso/depan/atas/rooftop), klik ruang untuk info, screenshot.
Three.js di-`dynamic` import (`ssr:false`) supaya tidak terbawa ke halaman lain,
dengan error-boundary fallback ke 2D bila WebGL gagal.

### RAB / BOQ (FE-6)

Estimasi biaya dihitung dari luas layout + level finishing (`src/lib/mock/rab.ts`):
total budget dialokasikan ke kategori (struktur/arsitektur/finishing/plumbing/
listrik + kolam/rooftop) lalu dipecah jadi line item BOQ. Cost summary cards,
selector finishing (recompute langsung), tabel BOQ dengan filter kategori +
total, breakdown per kategori, saran penghematan, asumsi, dan disclaimer draft.

### Exports (FE-7)

6 export card (Contractor Pack PDF, GLB, RAB Excel, DXF, IFC, ZIP) dengan
penjelasan untuk-siapa/dibuka-dengan/kapan/batasan (PRD §21.4). Flow: Generate →
dialog warning → progress (job tersimulasi di `src/stores/export-store.ts`) →
Download file contoh. Format Pro (DXF/IFC/ZIP) terkunci untuk plan Free dengan
CTA upgrade (PRD §28). Pratinjau Contractor Pack (mock dokumen + watermark DRAFT).

### Review & Share (FE-8)

Validation summary + peringatan teragregasi (struktur/tata ruang/biaya/legal,
generator di `src/lib/mock/review.ts`) dengan tombol "Teratasi", ringkasan AI,
checklist tenaga ahli (arsitek/engineer/MEP/kontraktor/PBG) dengan status,
thread komentar (tambah + tandai teratasi), dan CTA "Minta review profesional".
Share lewat tombol di topbar workspace. **Semua tab project kini aktif.**

### E2E (Playwright)

`e2e/critical-flows.spec.ts` mencakup 9 critical flow PRD §25: marketing,
login demo, wizard create → brief, pilih alternatif → editor, 2D editor +
ganti lantai, 3D preview (canvas/fallback), RAB recompute, export
generate + Pro-lock, review (komentar + resolve). Semua **9 test lulus**.
Config: `playwright.config.ts` (auto-start dev di :3100).

### Production polish (FE-9)

- **Analytics** (`src/lib/analytics`): `track()` typed → `window.dataLayer` +
  dev console; 16 event PRD §27 ter-wire (project_created, wizard_step_completed,
  alternatives_generated, alternative_selected, editor/3d/rab opened, export
  started/completed/downloaded, share/upgrade clicked, room_edited, dll).
- **Unit/component tests** (Vitest, `pnpm test`): 32 test — format, geometry
  (incl. treemap), validation, Zod schema, RAB generator, editor store
  (undo/redo/resize/delete), ReadinessBadge.
- **Error & 404 pages** (`app/error.tsx`, `app/not-found.tsx`).
- **A11y**: skip-to-content link, `aria-current` pada nav & tab aktif.
- **Perf**: grid editor di-memo; 3D di-`dynamic` import; selector store granular.

### Backend, auth & payments (di luar PRD awal)

- **Auth.js (NextAuth v5)** — `src/auth.ts` (Credentials → `API_URL/auth/login`,
  fallback demo), middleware gating `/app/*`, `SessionProvider`. Login/register
  pakai `signIn`, logout `signOut`.
- **Data layer** — `src/lib/data` (`DataSource` interface, impl `mock` + `http`).
  Hooks tidak berubah; sumber data di-switch via env. HTTP client kirim bearer
  token dari session. Kontrak endpoint: [docs/API.md](docs/API.md).
- **SQL schema** — [db/migrations/0001_init.sql](db/migrations/0001_init.sql):
  domain + billing (plans, subscriptions, credits_ledger, payment_events).
- **Billing (Mayar)** — `/api/checkout` + `/api/webhooks/payment` (provider di
  `src/lib/billing/providers/mayar.ts`, akun bersama tampil.dev), langganan
  manual-renew (aktivasi via webhook, expiry lazy via `/me`), enforcement
  server (kredit AI/kuota proyek/GLB) + gate export PDF client, admin
  backoffice `/app/admin` (plans/transaksi/users). Env: `MAYAR_API_BASE_URL`
  + `MAYAR_API_KEY` + `MAYAR_WEBHOOK_TOKEN` + `ADMIN_EMAILS` (lihat `.env.example`).
- **A11y audit** — `e2e/a11y.spec.ts` (@axe-core/playwright) scan 15 halaman,
  **0 violation serious/critical**.

## Status

Fitur inti **FE-0 → FE-9 lengkap** + auth nyata, data layer ke API eksternal,
payment scaffold, dan audit aksesibilitas. **58 automated test** (32 Vitest +
26 Playwright termasuk 15 a11y) hijau, `tsc` bersih, `next build` 0/0.

## Struktur

```
src/
  app/            # routes: (marketing), (auth), app/
  components/
    ui/           # shadcn primitives
    layout/       # app shell, marketing nav/footer
    shared/       # readiness/risk/score badges, thumbnail, empty state
    project/      # project card, workspace header/tabs
    wizard/       # create-project wizard + steps
    alternative/  # alternative card
    providers/    # query + theme + tooltip + toaster
  lib/
    api/          # TanStack Query hooks + query keys
    mock/         # in-memory mock backend + seed data
    schemas/      # Zod schemas
    constants/    # labels, readiness, copy
    format.ts     # IDR / area / tanggal formatters
  stores/         # Zustand
  types/          # domain types (PRD §13)
```
