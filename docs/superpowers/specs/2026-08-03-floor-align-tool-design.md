# Design: Alat "Samakan footprint" untuk menyelaraskan luas antar lantai (editor 2D)

Tanggal: 2026-08-03 · Status: approved

## Context

User kesulitan menyelaraskan ukuran luas lantai1 & lantai2 di editor 2D. Akar kesulitan:
`plan-canvas.tsx:1553` hanya merender ruang lantai **terpilih** — outline lantai lain tidak
terlihat saat mengedit, jadi tidak ada referensi visual footprint antar lantai. Plus, proporsi
lantai antar tingkat bisa sangat berbeda (mis. `proj-modern-tropis-1`: lantai1 lebar-pendek,
lantai2 sempit-tinggi) sehingga penyelarasan manual sulit.

Deliverable (dikonfirmasi user): **fitur editor reusable** — alat "Samakan footprint" (auto-fit)
yang menyamakan batas luar bangunan lantai aktif ke footprint lantai acuan — **dan** koreksi
`proj-modern-tropis-1` memakai alat tsb.

## Keputusan desain (hasil brainstorming)

- **Fitur inti**: alat auto-fit/samakan, dipakai reusable untuk semua proyek.
- **Lantai acuan**: default lantai bawah + dropdown pilih lantai lain.
- **Ruang dalam**: dipertahankan; hanya ruang yang **terekspos** di sisi yang diubah.
- **Area kosong** (target lebih besar): lebarkan ruang tepi sampai menutup — tanpa auto-create.
- **Overhang** (ruang meluber target): susutkan ruang tepi; ruang degenerate dihapus/ditandai.
- **Algoritma**: edge-alignment terhadap **bounding box** target (bukan union polygon).

## Arsitektur

### 1. Algoritma murni — `src/lib/geometry/floor-align.ts` (baru)

```ts
type AlignSummary = { grown: string[]; shrunk: string[]; removed: string[] }
function alignFloorRoomsToFootprint(
  rooms: Room[],            // ruang lantai AKTIF (hanya yang akan diubah)
  targetBBox: { x: number; y: number; width: number; depth: number }
): { rooms: Room[]; summary: AlignSummary }
```

- `targetBBox` = kotak batas union ruang **indoor** (`!isOutdoorRoom`) lantai acuan —
  konsisten dengan logika dinding/cangkang (`quantities.ts`, `perimeter.ts`).
- Untuk tiap sisi `N/S/E/W`:
  - ruang **terekspos** di sisi itu = tidak ada ruang lain tepat di luarnya
    (adjacency via `rectsShareEdge`/`sharedEdgeLength`, toleransi `WALL_T` — reuse `src/lib/geometry/union.ts`).
  - sisi aktif **di dalam** target → ruang ekspos pada sisi itu dilebarkan hingga tepinya = tepi target.
  - sisi aktif **meluber** target → ruang ekspos pada sisi itu disusutkan hingga tepi target.
  - ruang **tidak** ekspos (interior) → tidak diubah.
- Ruang degenerate (lebar/depth ≤ 0 setelah susut) → dihapus + dicatat di `summary.removed`.
- Tidak ada efek samping (pure); semua perubahan koordinat mempertahankan `x`/`y` origin
  (hanya `width`/`depth` dan posisi tepi yang diubah, `areaM2` di-recalc via helper yang ada).

Reuse yang sudah ada:
- `isOutdoorRoom` — `src/lib/geometry/connectivity.ts`
- `rectsShareEdge`, `sharedEdgeLength`, `Rect` — `src/lib/geometry/union.ts`
- konstanta `WALL_T` — `src/lib/three/build-model.ts` (atau duplikasi nilai lokal dengan komentar).

### 2. Aksi store — `src/stores/editor-store.ts`

`alignFloorToReference(floorId: string, refFloorId: string)`:
- Menghitung `targetBBox` dari indoor rooms `refFloorId`.
- Memanggil `alignFloorRoomsToFootprint` pada indoor rooms `floorId`.
- Menulis ruang baru via pola `commit()` yang sudah ada → **satu entri undo**, `dirty=true`.
- No-op bila salah satu lantai tanpa ruang indoor.

### 3. UI — `src/components/editor/floor-switcher.tsx` (+ test)

- Di samping tab lantai, tombol "Samakan footprint" (ikon sejajar) + dropdown lantai acuan.
- Default lantai acuan = lantai **di bawah** (menurut `level`); bila tidak ada → dropdown tetap tersedia.
- Klik → `window.confirm` → jalankan store action → tampilkan `summary` (ruang yang digrow/disusut/dihapus).
- Undo tersedia (undo toolbar sudah ada).

### 4. Koreksi `proj-modern-tropis-1`

- Jalur utama: setelah fitur ship, user membuka proyek itu di editor dan memakai "Samakan footprint"
  (lantai2 → samakan ke lantai1) — bersih & reusable.
- Opsional (ops): script one-off `scripts/align-floor.mjs` yang memuat layout dari DB, memanggil fungsi
  yang sama, menulis kembali — untuk deploy tanpa membuka editor. (Diputuskan saat implementasi.)

## Testing

- `src/lib/geometry/floor-align.test.ts`: grow sisi timur (multi-band), shrink sisi selatan,
  hapus ruang degenerate, interior tidak berubah, target bbox dari indoor-only, no-op bila kosong.
- `src/stores/editor-store.test.ts` (atau file serupa): `alignFloorToReference` commit + undo + dirty.
- `src/components/editor/floor-switcher.test.tsx`: tombol muncul, dropdown lantai acuan (default bawah),
  konfirmasi → action dipanggil.

## Non-goals

- Tidak menambahkan overlay ghost footprint (user memilih alat auto-fit, bukan overlay).
- Tidak mengubah renderer 3D / gambar kerja / RAB.
- Tidak scale seragam ruang dalam (kontradiktif dengan "interior dipertahankan").

## Verification

1. `pnpm vitest run src/lib/geometry/floor-align.test.ts src/components/editor/floor-switcher.test.tsx`
   (+ store test) — hijau.
2. `pnpm tsc --noEmit` bersih.
3. `pnpm vitest run` — suite penuh hijau (regresi).
4. Manual: buka proyek bertingkat → lantai2 edit → "Samakan footprint" default ke lantai1 →
   batas luar lantai2 menyamai lantai1, ruang dalam tetap, area kosong tertutup; Undo mengembalikan.
5. Terapkan pada `proj-modern-tropis-1`; commit + push (standing rule).
