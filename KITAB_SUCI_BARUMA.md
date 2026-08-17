# Kitab Suci Baruma — Arsitektur & Panduan Kode

> **Versi:** 2026-06-28  
> **Stack:** Next.js 16 (App Router) + PostgreSQL + React Three Fiber  
> **Deploy:** DigitalOcean droplet via GitHub Actions + pm2  

Dokumen ini adalah **sumber kebenaran tunggal** untuk memahami bagaimana kode Baruma bekerja.  
Semua developer WAJIB membaca ini sebelum menyentuh kode.

---

## Daftar Isi

1. [Gambaran Besar](#1-gambaran-besar)
2. [Tech Stack](#2-tech-stack)
3. [Struktur Direktori](#3-struktur-direktori)
4. [Data Flow: Dari UI ke DB](#4-data-flow-dari-ui-ke-db)
5. [Auth System](#5-auth-system)
6. [Database & Migrasi](#6-database--migrasi)
7. [API Routes](#7-api-routes)
8. [3D Rendering Pipeline](#8-3d-rendering-pipeline)
9. [Interior Design System](#9-interior-design-system)
10. [State Management](#10-state-management)
11. [FurniMesh Model Ingestion](#11-furnimesh-model-ingestion)
12. [Testing](#12-testing)
13. [Deploy & CI/CD](#13-deploy--cicd)
14. [Cara Menambah Fitur Baru](#14-cara-menambah-fitur-baru)

---

## 1. Gambaran Besar

Baruma adalah platform **AI interior design** untuk rumah tinggal di Indonesia. User bisa:
- Membuat brief project rumah (jumlah lantai, tipe ruang, budget)
- Generate alternatif denah dengan AI
- Edit denah 2D
- Lihat preview 3D real-time dengan React Three Fiber
- Edit interior per ruangan (drag & drop furniture, ganti style)
- Lihat RAB (Rencana Anggaran Biaya)
- Upload model 3D furniture sendiri (via FurniMesh)

Arsitektur: **monolith Next.js App Router** — frontend + backend dalam satu aplikasi. Tidak ada microservice, Redis, atau worker terpisah.

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Client)                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐  │
│  │ React UI │  │ Zustand  │  │ React Three Fiber 3D  │  │
│  │ (shadcn) │  │  Stores  │  │ (R3F + Drei + Three)  │  │
│  └────┬─────┘  └────┬─────┘  └───────────────────────┘  │
│       │              │                                   │
│  ┌────▼──────────────▼─────┐                            │
│  │   TanStack Query Hooks   │                            │
│  │   (src/lib/api/hooks.ts) │                            │
│  └────────────┬─────────────┘                            │
│               │ DataSource contract                       │
│  ┌────────────▼─────────────┐                            │
│  │  mock (in-memory)   │ http (fetch API)                │
│  └─────────────────────────┘                            │
└─────────────────────────────────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────────┐
│              Next.js API Routes (/api/v1/...)            │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  requireUser  │  │  Zod Schema  │  │  LLM (NVIDIA) │  │
│  │  (JWT verify) │  │  Validation  │  │  chatJSON/Text│  │
│  └──────┬───────┘  └──────────────┘  └───────────────┘  │
│         │                                                 │
│  ┌──────▼───────┐                                        │
│  │  Server Repo  │  src/lib/server/repo/*                │
│  │  (pg queries) │                                        │
│  └──────┬───────┘                                        │
└─────────┼────────────────────────────────────────────────┘
          │
┌─────────▼────────────────────────────────────────────────┐
│              PostgreSQL (jsonb payloads)                   │
│  projects | briefs | alternatives | project_interiors    │
│  user_assets | asset_ingestion_jobs | profiles           │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Bahasa | TypeScript (strict) |
| UI | React 19 + shadcn/ui + Tailwind CSS 4 |
| State | Zustand 5 |
| Data Fetching | TanStack Query 5 via DataSource pattern |
| Auth | Auth.js 5 (Credentials + JWT session) |
| Password Hash | @node-rs/argon2 (argon2id) |
| JWT | jose (HS256, 30d expiry) |
| Validation | Zod 4 |
| Database | PostgreSQL via `pg` (no ORM) |
| 3D | React Three Fiber 9 + Drei 10 + Three.js 0.184 |
| GLB Loading | useGLTF + Draco decoder (public/draco/) |
| LLM | OpenAI-compatible (NVIDIA NIM default, swappable) |
| Object Storage | Cloudflare R2 / S3-compatible (aws4fetch) |
| Test | Vitest 4 (unit) + Playwright 1.61 (e2e) |
| Deploy | GitHub Actions → pm2 di DigitalOcean droplet |

---

## 3. Struktur Direktori

```
Baruma/
├── src/
│   ├── app/                          # Next.js App Router pages & API
│   │   ├── (auth)/                   # Login, Register, Forgot Password
│   │   ├── (marketing)/              # Landing page, Pricing
│   │   ├── app/                      # Authenticated app pages
│   │   │   ├── dashboard/
│   │   │   ├── projects/[id]/        # Editor, Interior, Review, RAB
│   │   │   └── guides/furnimesh/     # FurniMesh guide page
│   │   ├── api/v1/                   # REST API routes
│   │   │   ├── auth/login|register/
│   │   │   ├── me/
│   │   │   ├── projects/[id]/
│   │   │   │   ├── brief|alternatives|layout|interior|rab|review/
│   │   │   │   └── slots/[slotId]/   # Asset attach/detach
│   │   │   └── assets/               # Upload, ingestion, library
│   │   ├── layout.tsx                # Root layout
│   │   └── globals.css
│   │
│   ├── components/                   # React components
│   │   ├── ui/                       # shadcn/ui primitives (button, dialog, etc.)
│   │   ├── shared/                   # Reusable: logo, badges, empty-state
│   │   ├── layout/                   # App shell: sidebar, topbar, user-menu
│   │   ├── landing/                  # Marketing landing page
│   │   ├── wizard/                   # Create/edit project wizard
│   │   ├── editor/                   # 2D floor plan editor
│   │   ├── preview-3d/              # 3D preview (R3F)
│   │   │   ├── house-scene.tsx       # Canvas + OrbitControls
│   │   │   ├── house-model.tsx       # 3D primitives + furniture + labels
│   │   │   ├── furniture-model.tsx   # GLB→procedural→box per furniture
│   │   │   ├── furniture-preview.tsx # Mini 3D preview for picker
│   │   │   ├── furniture-procedural.tsx # Procedural geometry fallback
│   │   │   ├── preview-3d-view.tsx   # Layout: scene + floating sidebar
│   │   │   ├── preview-controls.tsx  # Sidebar: room list, furniture inspector
│   │   │   └── camera-rig.tsx        # Camera preset (iso/front/top/rooftop)
│   │   ├── interior/                 # Interior workspace
│   │   ├── assets/                   # Asset upload dialog + library panel
│   │   ├── alternative/             # Alternative cards
│   │   ├── rab/                      # RAB tables + charts
│   │   ├── review/                   # Review checklist + comments
│   │   └── exports/                  # Export pack UI
│   │
│   ├── lib/                          # Core logic (no React)
│   │   ├── api/                      # TanStack Query hooks + keys
│   │   │   ├── hooks.ts             # All query/mutation hooks
│   │   │   └── keys.ts              # Centralized query keys
│   │   ├── data/                     # DataSource pattern
│   │   │   ├── source.ts            # DataSource interface (contract)
│   │   │   ├── index.ts             # Auto-select mock vs http
│   │   │   └── http.ts              # HTTP implementation
│   │   ├── server/                   # Server-only code
│   │   │   ├── db.ts                # pg Pool singleton
│   │   │   ├── auth-server.ts       # JWT sign/verify, requireUser
│   │   │   ├── llm.ts               # OpenAI-compatible chat (chatJSON/chatText)
│   │   │   ├── storage.ts           # R2/S3 signed URL utility
│   │   │   ├── response.ts          # ok/err/handleError helpers
│   │   │   └── repo/                # Database query functions
│   │   │       ├── projects.ts      # CRUD projects
│   │   │       ├── profiles.ts      # User profiles
│   │   │       ├── briefs.ts        # Brief payloads
│   │   │       ├── interiors.ts     # Interior plan payloads
│   │   │       ├── assets.ts        # User assets + ingestion jobs
│   │   │       └── ...
│   │   ├── three/                    # 3D math + utilities (pure, no React)
│   │   │   ├── build-model.ts       # Layout → 3D primitives
│   │   │   ├── fit-transform.ts     # BBox → scale/position fit
│   │   │   ├── furniture-models.ts  # GLB registry + resolver
│   │   │   ├── materials.ts         # Material presets + shared colors
│   │   │   ├── drag-plane.ts        # World→room local coordinate math
│   │   │   └── glb-analyzer.ts      # Client-side GLB validation
│   │   ├── interior/                 # Interior design logic
│   │   │   ├── plan.ts              # Generate interior plan, furniture placement
│   │   │   ├── presets.ts           # Furniture library, materials, styles
│   │   │   └── validation-profiles.ts # TV/sofa/coffee_table slot profiles
│   │   ├── mock/                     # In-memory mock backend
│   │   │   ├── index.ts             # Mock DataSource implementation
│   │   │   ├── layout.ts            # Layout generation
│   │   │   ├── rab.ts               # RAB generation
│   │   │   ├── review.ts            # Review generation
│   │   │   └── seed.ts              # Demo seed data
│   │   ├── schemas/                  # Zod validation schemas
│   │   │   ├── project.ts           # CreateProjectInput
│   │   │   └── interior.ts          # SavedInterior (persistence shape)
│   │   ├── brief/                    # Brief building logic
│   │   ├── rab/                      # RAB calculation logic
│   │   ├── exports/                  # Export generation
│   │   ├── geometry/                 # 2D geometry (treemap, overlap, etc.)
│   │   ├── constants/               # Room types, priorities, etc.
│   │   ├── format.ts                # Number/currency formatting
│   │   └── validation.ts            # Layout validation
│   │
│   ├── stores/                       # Zustand stores
│   │   ├── interior-store.ts        # Interior plan + undo/redo
│   │   ├── preview-store.ts         # 3D preview settings + interaction mode
│   │   ├── editor-store.ts          # 2D editor state
│   │   ├── export-store.ts          # Export state
│   │   └── ui-store.ts             # UI state
│   │
│   ├── hooks/                        # Custom React hooks
│   │   ├── use-interior-autosave.ts # Debounced autosave
│   │   └── use-mobile.ts           # Mobile detection
│   │
│   ├── types/                        # TypeScript types
│   │   └── index.ts                 # ALL domain types (677 lines)
│   │
│   ├── auth.ts                       # NextAuth instance
│   ├── auth.config.ts               # Edge-safe auth config
│   └── middleware.ts                 # Auth gate for /app/*
│
├── db/migrations/                    # PostgreSQL migrations
│   ├── 0001_init.sql                # profiles, projects, briefs, alternatives, layouts, reviews
│   ├── 0002_auth.sql                # Auth schema
│   ├── 0003_rab.sql                 # RAB persistence
│   ├── 0004_interior.sql            # project_interiors (jsonb)
│   └── 0005_assets.sql              # user_assets + asset_ingestion_jobs
│
├── e2e/                              # Playwright e2e tests
├── public/draco/                     # Draco decoder WASM for GLB
├── .github/workflows/deploy.yml     # CI/CD deploy to DO droplet
└── set-secrets.mjs                  # GitHub Actions secrets provisioning
```

---

## 4. Data Flow: Dari UI ke DB

### 4.1 DataSource Pattern (WAJIB)

Semua komunikasi client-server lewat **DataSource contract**. JANGAN panggil `fetch()` langsung.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  TanStack Query  │ ──▶ │  DataSource       │ ──▶ │  API Route      │
│  Hook            │     │  (mock / http)    │     │  /api/v1/...    │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                    NEXT_PUBLIC_DATA_SOURCE                │
                    = "mock" → in-memory                   │
                    = "http" → real API                    ▼
                                                 ┌─────────────────┐
                                                 │  Server Repo    │
                                                 │  (pg queries)   │
                                                 └────────┬────────┘
                                                          ▼
                                                 ┌─────────────────┐
                                                 │  PostgreSQL     │
                                                 └─────────────────┘
```

**Cara menambah method baru:**

1. Tambah signature di `src/lib/data/source.ts` (interface `DataSource`)
2. Implementasi di `src/lib/mock/index.ts` (mock, untuk dev)
3. Implementasi di `src/lib/data/http.ts` (http, untuk production)
4. Wire di `src/lib/data/index.ts` (mockSource)
5. Tambah query key di `src/lib/api/keys.ts`
6. Tambah hook di `src/lib/api/hooks.ts`
7. Buat API route di `src/app/api/v1/...`

### 4.2 Mock Mode

Saat `NEXT_PUBLIC_DATA_SOURCE` tidak diset atau diset ke `"mock"`, aplikasi jalan tanpa backend. Semua data disimpan in-memory di module scope `src/lib/mock/index.ts`. Data hilang saat browser refresh. Cocok untuk development.

### 4.3 HTTP Mode (Production)

Saat `NEXT_PUBLIC_DATA_SOURCE=http`, semua query TanStack Query akan fetch ke API routes Next.js. Auth token dari Auth.js session otomatis di-attach sebagai `Authorization: Bearer <token>`.

---

## 5. Auth System

### 5.1 Dua Layer Auth

| Layer | Teknologi | Fungsi |
|-------|-----------|--------|
| **Middleware** | Auth.js `authorized` callback | Gate `/app/*` — redirect ke `/login` jika belum login |
| **API Routes** | JWT (jose, HS256) via `requireUser()` | Verifikasi token di setiap route handler |

### 5.2 Flow Login

```
User input email+password
  → Auth.js Credentials provider
  → POST /api/v1/auth/login (atau demo user jika mock mode)
  → Server: argon2 verify password, sign JWT
  → Return { user, accessToken }
  → Auth.js simpan di JWT session cookie
  → accessToken di-attach ke semua API call via DataSource http
```

### 5.3 requireUser() Pattern

Setiap API route WAJIB panggil `requireUser(request)` di awal:

```typescript
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireUser(request)  // ← WAJIB
    const { id } = await ctx.params
    const project = await getOwnedProject(id, userId)  // ownership check
    if (!project) return err(404, "Project not found")
    // ... business logic
  } catch (e) {
    return handleError(e)
  }
}
```

### 5.4 Ownership Check

`getOwnedProject(projectId, userId)` — selalu cek bahwa project dimiliki oleh user yang login. Return `null` jika bukan pemilik (→ 404).

---

## 6. Database & Migrasi

### 6.1 Schema Pattern

- **Tabel relasional** untuk data yang perlu di-query (projects, profiles, user_assets)
- **jsonb payload** untuk data yang terikat ke domain object tertentu (briefs, interiors, alternatives)
- Semua tabel punya trigger `set_updated_at()` untuk auto-update timestamp

### 6.2 Tabel Utama

| Tabel | Key | Isi |
|-------|-----|-----|
| `profiles` | `id` (text) | User profile: email, name, plan, credits |
| `projects` | `id` (text) | Project metadata: name, status, floors, rooftop, site (jsonb) |
| `briefs` | `project_id` | Brief payload (jsonb) |
| `alternatives` | `project_id, alternative_id` | Alternative payload (jsonb) |
| `design_layouts` | `project_id` | Layout payload (jsonb) |
| `project_interiors` | `project_id` | SavedInterior payload (jsonb) |
| `reviews` | `project_id` | Review payload (jsonb) |
| `user_assets` | `id` (text) | User-uploaded 3D models metadata |
| `asset_ingestion_jobs` | `id` (text) | Upload validation job state |

### 6.3 Cara Menambah Tabel

1. Buat file `db/migrations/NNNN_nama.sql` dengan SQL murni
2. Gunakan `text primary key` untuk id (bukan UUID, ikuti konvensi existing)
3. Tambah trigger `set_updated_at()`
4. Buat repo file di `src/lib/server/repo/nama.ts`
5. Gunakan `query()` dari `src/lib/server/db.ts`

### 6.4 Repo Pattern

```typescript
// src/lib/server/repo/nama.ts
import { query } from "@/lib/server/db"

export async function getSomething(id: string): Promise<Something | null> {
  const res = await query<{ payload: Something }>(
    `SELECT payload FROM some_table WHERE id = $1`, [id]
  )
  return res.rows[0]?.payload ?? null
}
```

---

## 7. API Routes

### 7.1 Konvensi

- Prefix: `/api/v1/...`
- Project-scoped: `/api/v1/projects/[id]/...`
- Method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`
- Auth: `requireUser(request)` di setiap handler
- Validation: Zod schema
- Response: `ok(data)`, `err(status, message)`, `handleError(e)`

### 7.2 Struktur Route

```
src/app/api/v1/
├── auth/login/route.ts           # POST — login
├── auth/register/route.ts        # POST — register
├── me/route.ts                   # GET — current user
├── projects/
│   ├── route.ts                  # GET (list), POST (create)
│   └── [id]/
│       ├── route.ts              # GET (single)
│       ├── brief/route.ts        # GET, PATCH
│       ├── alternatives/route.ts # GET, POST (generate)
│       ├── layout/route.ts       # GET, PUT
│       ├── interior/route.ts     # GET, PUT
│       ├── rab/route.ts          # GET, PUT, DELETE
│       ├── review/route.ts       # GET
│       └── slots/[slotId]/
│           ├── attach-asset/route.ts  # POST
│           └── asset/route.ts         # DELETE
└── assets/
    ├── upload-url/route.ts       # POST — signed URL
    ├── ingestion-jobs/
    │   ├── route.ts              # POST — create job
    │   └── [jobId]/route.ts      # GET — poll status
    ├── [assetId]/metadata/route.ts  # PATCH
    └── my-library/route.ts       # GET
```

---

## 8. 3D Rendering Pipeline

### 8.1 Arsitektur

```
DesignLayout (2D data)
     │
     ▼
buildModel() ──▶ Prim[] (3D primitives: slab, wall, door, window, etc.)
     │
     ▼
HouseModel (R3F component)
     ├── Mesh primitives (walls, floors, roof)
     ├── Html labels (room names)
     ├── FurnitureModel[] (interior furniture)
     │     ├── GLB (useGLTF → cloned scene → computeFitTransform)
     │     ├── Procedural (ProceduralFurniture)
     │     └── Box (fallback)
     └── Railing (rooftop perimeter)
     │
     ▼
HouseScene (Canvas + lights + OrbitControls + CameraRig)
     │
     ▼
Preview3DView (layout: scene + floating sidebar)
```

### 8.2 FurnitureModel — 3 Source Priority

1. **User upload** (`item.modelUrl`) — GLB dari object storage
2. **Registry** (`FURNITURE_MODEL_REGISTRY`) — GLB statis di `/public/models/`
3. **Procedural** (`archetypeForCategory`) — geometry dari `furniture-procedural.tsx`
4. **Box** — fallback akhir, mesh kotak sederhana

Error handling: `GlbErrorBoundary` + `Suspense` — jika GLB gagal, langsung fallback ke procedural.

### 8.3 computeFitTransform

Pure math — tidak ada dependency Three.js. Normalisasi bounding box GLB ke dimensi footprint furniture:
- Uniform scale (fit dalam w×d×h)
- Center di x/z
- Alas di y=0

### 8.4 Drag & Drop Furniture

1. `FurnitureModel` punya invisible hitbox mesh
2. `onPointerDown` → simpan posisi awal di floor plane
3. `onPointerMove` → setelah threshold 3cm, mulai drag → `onDrag(worldX, worldZ)`
4. `worldToRoomLocal()` → konversi world coordinate ke room-local
5. `moveFurniture()` → update Zustand store
6. `OrbitControls` disabled saat dragging

### 8.5 Interaction Mode

| Mode | OrbitControls | Drag Furniture | Inspector Controls |
|------|:---:|:---:|:---:|
| **Edit** | Disabled saat drag | Ya | Move, Rotate, Hapus |
| **View** | Selalu aktif | Tidak | Disembunyikan |

Toggle via button di header sidebar.

### 8.6 Rooftop Rendering

Saat `project.rooftop = true`:
- Floor `"floor-rooftop"` ditambahkan di `generateLayout()` (mock/layout.ts)
- `rooftop_lounge` rooms di-assign ke floor ini
- Di `buildModel()`, rooftop floor dirender **di atas roof slab** (bukan di lantai biasa)
- Railing perimeter ditambahkan di sekeliling rooftop

---

## 9. Interior Design System

### 9.1 Alur

```
DesignLayout (rooms)
     │
     ▼
generateInteriorPlan(layout, { style })
     │
     ├── generateRoomInterior() per room
     │     ├── placeFurniture() — dari TEMPLATE per room type
     │     ├── assignMaterials() — floor, wall, ceiling
     │     ├── suggestLighting() — downlight, pendant, etc.
     │     └── buildRoomBudget() — kalkulasi biaya
     │
     ▼
InteriorPlan { rooms: RoomInteriorPlan[], totalEstimate, warnings }
     │
     ├── Zustand: useInteriorStore
     │     ├── moveFurniture / rotateFurniture / addFurniture / removeFurniture
     │     ├── setStyle (regenerate materials, keep furniture)
     │     └── undo / redo (history stack, max 30)
     │
     ├── Autosave: useInteriorAutosave (debounce 800ms)
     │     └── toSavedInterior() → SavedInterior → upsertInterior()
     │
     └── Persist: project_interiors (jsonb)
```

### 9.2 Furniture Template per Room

```typescript
const TEMPLATE: Partial<Record<RoomType, string[]>> = {
  ruang_tamu: ["sofa-3-seat", "coffee-table", "tv-cabinet", "tv-55", "rug-large"],
  kamar_tidur: ["queen-bed", "wardrobe-2m", "side-table", "work-desk"],
  // ...
}
```

### 9.3 Style Change (setStyle)

Saat user ganti style interior:
1. Generate fresh plan dengan style baru (materials, colors, lighting baru)
2. **Overlay furniture existing** — posisi/rotasi user tetap dipertahankan
3. Update priceRange sesuai style (luxury_compact = +25%)
4. Recompute warnings + budget

### 9.4 Semantic Slots (FurniMesh)

Furniture dengan `slotType` (tv, sofa, coffee_table) bisa diganti dengan model upload user. Lihat [§11](#11-furnimesh-model-ingestion).

---

## 10. State Management

### 10.1 Zustand Stores

| Store | File | Isi |
|-------|------|-----|
| `useInteriorStore` | `stores/interior-store.ts` | InteriorPlan, furniture CRUD, undo/redo, style |
| `usePreviewStore` | `stores/preview-store.ts` | 3D view settings, floors, interaction mode |
| `useEditorStore` | `stores/editor-store.ts` | 2D editor tool, selection, undo/redo |
| `useExportStore` | `stores/export-store.ts` | Export jobs state |
| `useUiStore` | `stores/ui-store.ts` | Sidebar, mobile detection |

### 10.2 TanStack Query

Semua data fetching lewat hooks di `src/lib/api/hooks.ts`. Query keys centralized di `src/lib/api/keys.ts`.

**Stale time:**
- `user`: 5 menit
- `layout`, `interior`: `Infinity` (editing is local, refetch would clobber draft)
- `myAssets`: 30 detik

### 10.3 Interior Autosave

`useInteriorAutosave(projectId)` — watch `dirty` flag di interior store, debounce 800ms, persist ke server via `useSaveInterior`.

---

## 11. FurniMesh Model Ingestion

### 11.1 Alur Upload

```
User klik placeholder (TV/Sofa/Coffee Table)
  → Inspector: "Upload 3D Model"
  → ModelUploadDialog (7-step wizard)
  → Upload GLB ke R2 via signed URL
  → Client-side GLB analysis (glb-analyzer.ts)
  → Server: create user_asset + ingestion_job
  → Poll job status → needs_scale / ready / failed
  → User isi dimensi + lisensi + material mode
  → Attach asset ke slot (update interior plan)
  → FurnitureModel render GLB dari modelUrl
```

### 11.2 File Terkait

| File | Fungsi |
|------|--------|
| `lib/three/glb-analyzer.ts` | Client-side GLB validation (mesh count, bbox, performance) |
| `lib/interior/validation-profiles.ts` | TV/sofa/coffee_table dimension profiles + material tokens |
| `components/assets/upload/model-upload-dialog.tsx` | 7-step upload wizard UI |
| `components/assets/library/my-asset-library-panel.tsx` | Asset library browser |
| `app/app/guides/furnimesh/page.tsx` | FurniMesh guide page |
| `db/migrations/0005_assets.sql` | user_assets + asset_ingestion_jobs tables |
| `lib/server/repo/assets.ts` | DB queries for assets |
| `lib/server/storage.ts` | R2/S3 signed URL generation |

---

## 12. Testing

### 12.1 Unit Test (Vitest)

```bash
pnpm test          # vitest run (semua)
pnpm test:watch    # vitest (watch mode)
```

Konvensi:
- File test di samping file source: `foo.ts` → `foo.test.ts`
- Test server-only code: `// @vitest-environment node`
- Test React components: pakai `@testing-library/react`
- Fixtures di `src/test-utils/fixtures.ts`

### 12.2 E2E Test (Playwright)

```bash
pnpm test:e2e      # playwright test
pnpm test:e2e:ui   # playwright test --ui
```

Test ada di `e2e/` directory. Screenshot artifacts di `test-results/`.

---

## 13. Deploy & CI/CD

### 13.1 Arsitektur Deploy

```
GitHub (rfq13/baruma)
  │
  │ git push main
  ▼
GitHub Actions (.github/workflows/deploy.yml)
  │
  │ SSH ke droplet
  ▼
DigitalOcean Droplet (167.172.76.248)
  ├── /opt/baruma/app/     ← git clone
  ├── pm2: baruma process  ← next start -p 3000
  └── nginx: reverse proxy ← :80 → :3000
```

### 13.2 Deploy Flow

1. `git reset --hard origin/main`
2. Write `.env.local` dari GitHub Secrets
3. `pnpm install`
4. `next build`
5. `pm2 restart baruma --update-env`

### 13.3 Secrets

Dikelola via `set-secrets.mjs`. Env vars kritis:
- `DATABASE_URL` — PostgreSQL connection string
- `AUTH_SECRET` — Auth.js secret
- `BARUMA_JWT_SECRET` — JWT signing key
- `AGENT_LAB_KEY` / `AGENT_LAB_URL` — koneksi server Baruma ke Agent Lab
- `DEPLOY_HOST` / `DEPLOY_SSH_KEY` — Deploy target

---

## 14. Cara Menambah Fitur Baru

### Checklist

1. **Types** — tambah/update di `src/types/index.ts`
2. **Schema** — jika perlu validasi, tambah di `src/lib/schemas/`
3. **DataSource** — tambah method di `src/lib/data/source.ts`
4. **Mock** — implementasi mock di `src/lib/mock/index.ts`
5. **HTTP** — implementasi http di `src/lib/data/http.ts`
6. **Wire** — daftarkan di `src/lib/data/index.ts`
7. **Query Keys** — tambah di `src/lib/api/keys.ts`
8. **Hooks** — tambah TanStack Query hook di `src/lib/api/hooks.ts`
9. **API Route** — buat di `src/app/api/v1/...`
10. **Repo** — jika perlu query DB, buat di `src/lib/server/repo/`
11. **Migration** — jika perlu tabel baru, buat di `db/migrations/`
12. **Component** — buat UI di `src/components/`
13. **Store** — jika perlu state client, tambah di `src/stores/`
14. **Test** — tulis unit test (`.test.ts`)

### Aturan Emas

- **JANGAN** panggil `fetch()` langsung dari komponen — selalu lewat DataSource → TanStack Query
- **JANGAN** buat backend terpisah — semua di dalam Next.js route handler
- **JANGAN** skip `requireUser()` di API route
- **JANGAN** skip ownership check (`getOwnedProject`)
- **JANGAN** simpan file upload di `public/` — wajib di object storage eksternal
- **JANGAN** simpan provider/model/provider API key di Baruma — konfigurasi hanya di Agent Lab
- **WAJIB** fallback deterministik untuk semua pemakaian LLM
- **WAJIB** ikuti pola existing (lihat file tetangga sebelum bikin baru)

---

## 15. 2D Editor

### 15.1 Editor Store

`useEditorStore` (`stores/editor-store.ts`) — mengelola state editor denah 2D:
- `activeTool`: select | pan | room | wall | door | window | dimension
- `selectedFloorId` / `selectedObjectId`: objek yang sedang dipilih
- `zoom` / `pan` / `snapEnabled` / `gridSize`: viewport settings
- `past` / `future`: undo/redo history (snapshot `DesignLayout[]`)
- `dirty`: flag untuk autosave

### 15.2 Plan Canvas

`PlanCanvas` (`components/editor/plan-canvas.tsx`) — SVG-based 2D editor:
- Render rooms sebagai rect dengan warna per room type
- Resize handler (8 handle: n/s/e/w + 4 corner)
- Drag room untuk reposition
- Add door/window via wall click
- Validation issues overlay (warning/danger badges)

### 15.3 Editor Inspector

`EditorInspector` (`components/editor/editor-inspector.tsx`) — panel properti untuk objek yang dipilih:
- Room: name, type, dimensions, floor
- Wall: length, thickness
- Opening: type (door/window), position, width

---

## 16. LLM Integration

### 16.1 Agent Lab sebagai satu-satunya gateway

`src/lib/server/llm.ts` adalah facade kompatibilitas menuju Agent Lab. Baruma
hanya menyimpan `AGENT_LAB_URL` dan product API key `AGENT_LAB_KEY`; provider,
endpoint, model, temperature, max token, thinking mode, dan provider API key
berasal dari Agent Lab **per-slug**: `baruma-assistant` (thinking enabled,
prosa — `chatText`, dan `chatJSON` yang di-override eksplisit ke slug ini)
atau `baruma-floorplan-actions` (thinking disabled, default `chatJSON` —
generate aksi denah/interior). Tidak ada fallback provider key dari
environment Baruma maupun environment Agent Lab.

### 16.2 Fungsi

| Fungsi | Output | Slug default | Use Case |
|--------|--------|--------------|----------|
| `chatJSON<T>(messages, opts?)` | `T \| null` | `baruma-floorplan-actions`; `opts.slug` untuk override (mis. `PROSE_SLUG` untuk narasi) | Aksi denah/interior; brief enrichment & alternative narrative pakai override prosa |
| `chatText(messages)` | `string \| null` | `baruma-assistant` | Brief assistant, interactive chat |

### 16.3 Kontrak Wajib

- **SEMUA pemakaian LLM HARUS punya fallback deterministik**
- Helper LLM return `null` saat Agent Lab/key/config/upstream tidak tersedia
- Fallback yang diperbolehkan hanya fallback respons deterministik, bukan fallback kredensial/provider
- LLM hanya **mempertajam**, tidak pernah jadi single point of failure
- Tidak dipakai untuk gating yang harus pasti (validasi ukuran, fit math, lisensi)

---

> *"The user owns the model source. The platform owns the layout, validation, consistency, and usability layer."*
>
> — Prinsip Akhir Baruma, NEW_REVAMP_PRD.md §23
