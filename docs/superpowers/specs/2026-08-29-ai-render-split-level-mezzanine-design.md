# AI Render — Split-Level/Mezzanine Support (Fase C akhir) — Design

Tanggal: 2026-08-29 · Status: disetujui user · Lanjutan spec 2026-08-23 (scene intelligence)

## Masalah

Model data Baruma sudah punya dua mekanisme level antara: **lantai mezzanine**
(`Floor.kind:"mezzanine"`, `baseOffsetM` relatif lantai induk — `floorElevations`
di `src/lib/geometry/vertical.ts` sudah menghitung `baseY`/`floorToFloorM`-nya
dengan benar) dan **split-level per-ruang** (`Room.levelOffsetM`). Konsumen
AI-render belum memakainya:

1. **Deteksi ruang dari pose** (`analyze-room.ts` `resolveRoom`): band lantai
   mezzanine bertumpang-tindih dengan band induknya (mezzanine duduk DI DALAM
   floor-to-floor induk) → kamera di platform mezzanine cocok ke dua band,
   urutan array yang menang (bisa salah ruang). `levelOffsetM` tak menggeser band.
2. **Label lantai**: `FloorElevation.index` mezzanine = index induk → prompt
   bilang "on the ground floor" untuk ruang mezzanine.
3. **Kamera interior otomatis** (`camera-rig.tsx`): mengabaikan `levelOffsetM`
   → mata bisa 1,5 m di bawah/atas platform ruang split-level; tak ada clamp
   plafon utk mezzanine rendah.
4. **`ceilingHeightM`** RoomFacts = `WALL_H` global — salah utk mezzanine &
   lantai ber-tinggi kustom.
5. **Massing eksterior** (`analyze.ts`): hitungan lantai memfilter hanya id
   `"floor-rooftop"` → mezzanine (dan rooftop ber-id lain) terhitung lantai
   penuh ("3-storey" utk 2 lantai + mezzanine).

Cakupan disetujui: **koreksi kelima temuan + pengayaan prompt** (mezzanine
overlooking, double-height, split-level offset).

## Keputusan desain

**Resolver "platform tertinggi di bawah mata menang"** (pendekatan A):
- Band efektif per ruang kandidat: `base = elev(room.floorId).baseY +
  (room.levelOffsetM ?? 0)`; `top = base + elev(room.floorId).floorToFloorM`.
- Kandidat = ruang yang rect-nya memuat titik kamera (plan) DAN band-nya
  memuat y kamera. Pemenang = `base` **tertinggi**; seri → urutan array
  (deterministik). Tak ada kandidat → `null` (perilaku sekarang).
- Alasan: fisik-intuitif (berdiri di lantai tertinggi di bawah kaki); benar
  otomatis utk split-level & double-height (ruang `void` sudah dikecualikan
  dari kandidat interior). Alternatif volume-aware penuh = YAGNI; hint lantai
  aktif dari klien = tidak ada konsepnya di preview 3D.

## Perubahan per komponen

### `src/lib/server/ai-render/analyze-room.ts`
- `resolveRoom` → resolver v2 di atas.
- `RoomFacts` bertambah (semua deterministik, tanpa I/O):
  - `floorKind: "regular" | "mezzanine"` (dari `Floor.kind`, absen = regular).
  - `ceilingHeightM` = `round1(elev.wallHM)` lantai ruang (bukan `WALL_H`);
    bila `doubleHeight` → `round1(wallHM + floorToFloorM lantai void di atas)`.
  - `mezzanineOverlooking?: string` — HANYA ruang di lantai mezzanine: nama
    ruang di lantai INDUK (lantai reguler tepat sebelum mezzanine di array)
    dengan luas overlap denah terbesar (>0). Tak ada overlap → absen.
  - `doubleHeight: boolean` — ada ruang `type:"void"` di lantai reguler
    BERIKUTNYA (stacking) yang overlap denahnya ≥50% luas ruang ini.
  - `levelOffsetM?: number` — diteruskan bila ≠0 (round1).
- `floorIndex` tetap ada (kompat); prompt beralih ke `floorKind` utk label.

### `src/lib/server/ai-render/prompt.ts` (`describeRoomFacts`)
- Label lantai: `floorKind:"mezzanine"` → `"on the mezzanine level"`
  (+ `", overlooking the {mezzanineOverlooking}"` bila ada); regular tetap
  `"the ground floor"` / `"floor {n+1}"`.
- Klausa dimensi: `doubleHeight` → tambah `", double-height ceiling"`.
- `levelOffsetM` ≠ 0 → klausa `"split-level, raised {x} m"` / `"lowered"`.
- Snapshot lama non-mezzanine harus byte-identik (fakta baru default off).

### `src/components/preview-3d/camera-rig.tsx` (efek interior)
- `platformY = baseY + SLAB_T + (room.levelOffsetM ?? 0)`.
- Mata = `platformY + min(1.5, wallHM lantai − 0.3)` (clamp plafon mezzanine
  rendah); target `platformY + min(1.3, eye − 0.1)`.

### `src/lib/server/ai-render/analyze.ts` (eksterior)
- `floors` massing = hitung lantai `kind` regular saja (pakai
  `isMezzanineFloor`/`isRooftopFloor` dari `@/lib/editor/floors` — pure).
- `massing.hasMezzanine: boolean` baru → klausa massing `"with a mezzanine
  level"`. Snapshot eksterior lama tanpa mezzanine byte-identik.

## Yang TIDAK berubah

Route/DB/kontrak API/kredit/cache params_hash — nol perubahan. Cache polish
otomatis benar (factsHash berubah bila facts berubah). Dialog klien tidak
berubah (dropdown ruangan sudah menampilkan semua lantai termasuk mezzanine).

## Testing

- Resolver: fixture induk+mezzanine overlap — kamera di platform → ruang
  mezzanine; di bawah platform → ruang induk; `levelOffsetM` menggeser band;
  kamera di atas semua band → null.
- Facts: ceiling per lantai (mezzanine rendah), `mezzanineOverlooking`
  (overlap terbesar menang), `doubleHeight` (≥50% void di atas; <50% → false),
  `levelOffsetM` diteruskan.
- Prompt: snapshot ruang mezzanine (overlooking + ceiling rendah) & ruang
  double-height; snapshot lama byte-identik.
- Kamera: unit test murni bila helper diekstrak; minimal e2e existing tetap
  hijau.
- Eksterior: 2 reguler + 1 mezzanine + rooftop → `floors=2`, `hasMezzanine`,
  klausa massing; snapshot lama utuh.

## Di luar cakupan

Void/taman/kolam sebagai target render interior; perubahan editor/2D;
kantilever horizontal (`Floor` cantilever offset) — tidak relevan utk deteksi.
