# Spec — Persistensi Interior Design (Postgres jsonb)

- **Tanggal:** 2026-06-26
- **Status:** Disetujui (siap masuk rencana implementasi)
- **Modul:** Interior Design / 3D Preview
- **Scope:** HANYA persistensi editan interior. Kapabilitas desain baru (warna tembok,
  keramik/lantai, varian kasur, desain pintu) ada di spec terpisah berikutnya.

## 1. Masalah

Editan interior (style, tambah/geser/rotate/hapus furniture) hidup hanya di store
Zustand in-memory ([`src/stores/interior-store.ts`](../../../src/stores/interior-store.ts)).
Plan di-*generate ulang* dari `DesignLayout` setiap load via `generateInteriorPlan`
([`src/lib/interior/plan.ts:71`](../../../src/lib/interior/plan.ts#L71)) dan tidak pernah
disimpan. Akibatnya semua editan user **hilang saat reload / pindah halaman**.

## 2. Tujuan & Non-Tujuan

**Tujuan**
- Editan interior tersimpan ke **Postgres (jsonb)** lewat data-layer yang sudah ada,
  durable & cross-device saat app jalan mode `http`.
- Saat membuka kembali ruang/preview-3d, interior memuat editan tersimpan, bukan
  generate ulang dari nol.
- Autosave otomatis dengan indikator status, tanpa tombol simpan manual.
- Skema forward-compatible: field desain ke depan (surface/warna/pintu) tinggal
  ditambahkan ke payload tanpa migrasi struktur ulang.

**Non-Tujuan**
- Tidak menambah kapabilitas desain baru (itu spec lain).
- Tidak mengubah editor 2D layout atau alur generate alternatif.
- Tidak menghapus field vestigial `DesignLayout.interiors?` (di luar scope; lihat §9).

## 3. Keputusan Arsitektur (Approach A)

Interior disimpan di **tabel khusus `project_interiors`** (bukan di payload layout),
meniru persis pola `design_layouts`. Alasan: pemisahan bersih, tidak bentrok dengan
save editor 2D, dan paling sehat untuk pertumbuhan data desain berikutnya.

Yang disimpan adalah **intent** (style + penempatan furniture per ruang), BUKAN snapshot
derived (budget/warning). Derived dihitung ulang saat load sehingga selalu konsisten
dengan harga katalog terkini.

## 4. Data Model

### 4.1 Tabel — `db/migrations/0004_interior.sql`
```sql
create table project_interiors (
  project_id text primary key references projects(id) on delete cascade,
  version_id text not null,
  payload    jsonb not null,            -- SavedInterior shape (lihat 4.2)
  updated_at timestamptz not null default now()
);
create trigger project_interiors_updated before update on project_interiors
  for each row execute function set_updated_at();
```
`set_updated_at()` sudah ada dari `0001_init.sql`. Relasi 1:1 per project, `on delete cascade`.

### 4.2 Payload tersimpan — `SavedInterior` (zod-validated)
```ts
type SavedInterior = {
  schemaVersion: 1
  style: InteriorStyleId
  rooms: Array<{
    roomId: string
    furniture: PlacedFurniture[]   // x, y, rotationDeg, furnitureId, dims, dll
  }>
  // FORWARD-COMPAT (spec berikutnya): rooms[].surfaces, rooms[].colors, rooms[].doors
}
```
- `version_id` kolom = `layout.versionId` saat penyimpanan (kunci validitas).
- Schema baru divalidasi zod di boundary (route + sebelum hydrate). `schemaVersion`
  memungkinkan migrasi payload non-breaking ke depan.

## 5. Aliran Data (mengikuti pola layout yang ada)

1. **Repo** — `src/lib/server/repo/interiors.ts`
   - `getInteriorPayload(projectId): Promise<SavedInterior | null>`
   - `upsertInterior(projectId, versionId, payload): Promise<SavedInterior>` (INSERT … ON CONFLICT)
2. **API route** — `src/app/api/v1/projects/[id]/interior/route.ts`
   - `GET` → `requireUser` + `getOwnedProject`; kalau tidak ada baris → `ok(null)` (bukan 404 fatal).
   - `PUT` → validasi body via zod `SavedInterior`; `upsertInterior(id, versionId, payload)`.
3. **DataSource contract** — `src/lib/data/source.ts`
   - `getInterior(projectId): Promise<SavedInterior | null>`
   - `saveInterior(projectId, payload: SavedInterior): Promise<SavedInterior>`
   - Impl **mock** (`src/lib/mock/index.ts`): simpan di `db.interiors` (memori sesi).
   - Impl **http** (`src/lib/data/http.ts`): `GET`/`PUT` ke route di atas.
4. **Hooks** — `src/lib/api/hooks.ts`
   - `useInterior(projectId)` (query, `staleTime: Infinity` — editing lokal, mirip `useLayout`).
   - `useSaveInterior(projectId)` (mutation → `setQueryData` + invalidate ringan).

## 6. Hydration & Autosave

### 6.1 Hydration (load)
- Fungsi pure baru di `plan.ts`: `applySavedInterior(layout, saved): InteriorPlan`
  - Generate base via `generateInteriorPlan(layout, { style: saved.style })`.
  - Untuk tiap `saved.rooms`, **overlay** `furniture` ke room yang cocok, lalu recompute
    `warnings` (`validateFurnitureInRoom`) + `budgetEstimate` (`buildRoomBudget`) memakai
    materials/lighting hasil generate. Recompute `totalEstimate` plan.
  - Room di `saved` yang tidak ada di layout saat ini → diabaikan; room baru di layout
    yang tidak ada di `saved` → pakai hasil generate default.
- `interior-store.load()` terima opsi `saved?: SavedInterior`:
  - `saved` ada **dan** `saved` valid utk `layout.versionId` → `applySavedInterior`.
  - selain itu → generate fresh (perilaku sekarang).
- `Preview3DView` ([`preview-3d-view.tsx`](../../../src/components/preview-3d/preview-3d-view.tsx))
  memanggil `useInterior(projectId)`, lalu `load({ …, saved })` setelah data siap.
  `InteriorWorkspace` (jika nanti diaktifkan) mengikuti pola sama.

### 6.2 Autosave
- Tiap mutasi store (`setStyle`, `addFurniture`, `moveFurniture`, `rotateFurniture`,
  `removeFurniture`, `resetRoom`) menandai `dirty = true`.
- Komponen menjalankan **debounce 800ms**: setelah idle, serialize store → `SavedInterior`
  → `useSaveInterior.mutate`. (Debounce diimplementasikan di lapisan komponen/hook,
  bukan di dalam store, agar store tetap pure & mudah dites.)
- Status simpan ditampilkan di sidebar `PreviewControls`: `menyimpan… / tersimpan / gagal`.
- Saat `layout.versionId` berubah (pilih alternatif baru), interior tersimpan lama
  diabaikan → generate fresh (cegah data basi). Versi baru otomatis menyimpan ulang.

## 7. Error Handling

- `GET` gagal / `null` → editor generate fresh, tidak blocking.
- `PUT` gagal → indikator "gagal — coba lagi", `dirty` tetap true, retry pada edit
  berikutnya (atau tombol "coba simpan lagi" pada indikator). Editor tetap jalan (optimistic).
- Mode mock → `saveInterior` simpan memori sesi; durabilitas Postgres aktif hanya saat
  `http` + `DATABASE_URL` + migration ter-apply.

## 8. Testing

- **Unit (`plan.test.ts`)**: `applySavedInterior` — overlay furniture, recompute budget &
  warning; room mismatch → fallback default; versionId mismatch → tidak dipakai.
- **Schema**: zod `SavedInterior` round-trip (parse/serialize) + reject payload rusak.
- **Store (`interior-store.test.ts`)**: mutasi → `dirty=true`; `load({ saved })` → tidak
  regenerate (furniture hasil saved dipertahankan).
- **Repo/route**: mirror pola test layout yang ada (`route.test.ts`), termasuk
  ownership guard (`getOwnedProject`).
- Target: semua test hijau, `npm run build` 0 error.

## 9. Catatan / Risiko

- `DesignLayout.interiors?: RoomInteriorPlan[]` ([`src/types/index.ts:307`](../../../src/types/index.ts#L307))
  saat ini **tidak terpakai**. Approach A tidak memakainya. Dibiarkan apa adanya (tidak
  dihapus) untuk menghindari churn; bisa dibersihkan di spec lain.
- Autosave chatty saat geser ±0.25m beruntun → diredam debounce 800ms.
- Konsistensi versi: validitas interior diikat ke `layout.versionId`.

## 10. Prasyarat Operasional

1. Apply migration `db/migrations/0004_interior.sql` ke DB central.
2. Jalankan app mode `http`: set `NEXT_PUBLIC_API_URL` + `DATABASE_URL`.
   (Mode mock tetap berfungsi, tapi hanya durable per-sesi.)
