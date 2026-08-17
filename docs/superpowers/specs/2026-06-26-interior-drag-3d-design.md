# Spec — Bagian 2: Drag Furnitur Mulus di 3D

- **Tanggal:** 2026-06-26
- **Status:** Disetujui
- **Modul:** Interior Design / 3D Preview
- **Branch:** `feat/interior-3d-models`

## 1. Tujuan
User dapat **menyeret furnitur langsung di tampilan 3D** dengan mouse/sentuh:
tekan furnitur → seret → furnitur mengikuti kursor di lantai ruangnya → lepas untuk
menaruh. Posisi ter-clamp di dalam ruang; autosave (fitur persistensi) menyimpan otomatis.
Menggantikan ketergantungan pada tombol langkah ±0.25 m sebagai cara utama memindah.

## 2. Non-Tujuan
- Rotasi tetap via tombol Rotate (drag = translasi saja).
- Tidak ada drag lintas-ruang/lintas-lantai (hanya di dalam ruang furnitur itu).
- Snapping ke grid / ke dinding: di luar scope.

## 3. Arsitektur

### 3.1 State — `src/stores/preview-store.ts`
Tambah `draggingFurnitureId: string | null` + `setDragging(id: string | null)`. Dipakai untuk
menonaktifkan OrbitControls saat menyeret.

### 3.2 Pure helper — `src/lib/three/drag-plane.ts` (unit-tested)
`worldToRoomLocal(opts): { x: number; y: number }` mengonversi titik dunia (hasil raycast ke
bidang lantai) menjadi koordinat sudut (corner) furnitur room-local, dengan **center furnitur
mengikuti pointer**:
```ts
worldToRoomLocal({ worldX, worldZ, roomX, roomY, cx, cz, widthM, depthM }): { x, y }
// x = worldX + cx - roomX - widthM/2
// y = worldZ + cz - roomY - depthM/2
```
(Kebalikan dari rumus posisi di house-model: `worldX = roomX + x + widthM/2 - cx`.) Clamp ke
dalam ruang TIDAK dilakukan di sini — sudah ditangani `movePlacedFurniture` di store.

### 3.3 Drag di `FurnitureModel` (presentational) — `furniture-model.tsx`
Tambah prop opsional `onDragStart?: () => void`, `onDrag?: (worldX: number, worldZ: number) => void`,
`onDragEnd?: () => void`, dan `floorY: number` (Y dunia lantai = `position[1]`). Pada **hitbox** mesh:
- `onPointerDown(e)`: `stopPropagation`; `onSelect()`; `e.target.setPointerCapture(e.pointerId)`;
  set ref `dragging=true`; `onDragStart()`.
- `onPointerMove(e)`: jika `dragging` → `stopPropagation`; intersect `e.ray` dengan
  `THREE.Plane(normal (0,1,0), konstanta -floorY)`; jika ada titik → `onDrag(point.x, point.z)`.
  (Jika tidak ada perpotongan, abaikan — jangan lempar.)
- `onPointerUp(e)`: `releasePointerCapture`; `dragging=false`; `onDragEnd()`.
Pointer capture membuat move/up tetap terkirim walau kursor keluar hitbox.

### 3.4 Wiring — `src/components/preview-3d/house-model.tsx`
Untuk tiap `<FurnitureModel>`: teruskan `floorY={posBase[1]}`, dan:
- `onDragStart={() => setDragging(item.id)}`
- `onDrag={(wx, wz) => moveFurniture(room.id, item.id, worldToRoomLocal({ worldX: wx, worldZ: wz, roomX: room.x, roomY: room.y, cx, cz, widthM: item.widthM, depthM: item.depthM }).x /*and .y*/))}`
  (panggil `worldToRoomLocal` sekali, ambil `{x,y}`, lalu `moveFurniture(room.id, item.id, x, y)`).
- `onDragEnd={() => setDragging(null)}`.
`setDragging` dari `usePreviewStore`, `moveFurniture` dari `useInteriorStore`, `cx/cz` sudah ada.

### 3.5 OrbitControls — `src/components/preview-3d/house-scene.tsx`
`const dragging = usePreviewStore((s) => s.draggingFurnitureId)`; `<OrbitControls enabled={!dragging} .../>`
(plus pertahankan prop lain). Mencegah kamera berputar saat menyeret.

## 4. Error & edge
- Raycast meleset (pointer keluar bidang) → update di-skip, tidak crash.
- Drag dimulai dengan menekan furnitur (juga otomatis menyeleksinya).
- Clamp dalam ruang oleh `movePlacedFurniture` (sudah ada & teruji).
- Autosave debounce (persistensi) menyimpan hasil geseran.

## 5. Testing (e2e benar-benar diuji)
- **Unit**: `drag-plane.test.ts` — `worldToRoomLocal` (konversi center-follow, offset cx/cz, tepi).
- **Build/type**: `npx tsc --noEmit` 0; `npm run build` sukses.
- **E2E (Playwright)**: di `/app/projects/proj-demo-8x8/preview-3d`, tambah Kasur Queen, lalu
  lakukan `page.mouse` drag (down di tengah canvas pada area furnitur → move → up) dan pastikan:
  scene tetap render, tanpa console error. (Verifikasi posisi presisi sulit headless; gate utama =
  tidak crash + tidak error + suite lama tetap hijau.) Tambah di `e2e/interior-3d-models.spec.ts`
  atau file baru `e2e/interior-drag.spec.ts`.

## 6. Risiko
- Pointer capture lintas-browser: pakai R3F event `e.target.setPointerCapture` (didukung).
- Konflik OrbitControls vs drag diselesaikan via flag `draggingFurnitureId` (enabled=false saat drag).
- Verifikasi presisi posisi via unit test helper, bukan e2e pixel.
