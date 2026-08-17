# PRD Addendum — Interior Design Module

## 1. Ringkasan Modul

Interior Design Module adalah fitur yang membantu user mendesain interior rumah berdasarkan denah yang sudah dibuat. Modul ini memungkinkan user memilih gaya interior, mengatur furniture, memilih material, mengatur lighting, membuat moodboard, melihat preview 3D interior, serta mendapatkan estimasi biaya interior.

Fitur ini ditujukan untuk user awam yang ingin mengetahui:

- Ruangan muat furniture apa saja.
- Layout interior paling nyaman.
- Warna/material apa yang cocok.
- Budget finishing dan furniture.
- Tampilan rumah sebelum dibangun.
- Apa saja yang perlu dibeli atau dikerjakan kontraktor/interior vendor.

## 2. Tujuan Fitur

Interior Design Module harus mampu:

1. Mengubah ruang kosong dari denah menjadi ruangan lengkap dengan furniture.
2. Memberikan rekomendasi layout interior berdasarkan ukuran ruang.
3. Memberikan style preset seperti modern tropis, Japandi, minimalis, industrial, klasik modern, Scandinavian, dan luxury compact.
4. Menghasilkan moodboard material.
5. Menghasilkan 3D interior preview.
6. Menghasilkan daftar furniture dan material.
7. Menghasilkan estimasi biaya interior.
8. Menghasilkan export interior pack untuk kontraktor/interior vendor.
9. Memberikan warning jika furniture terlalu besar, sirkulasi sempit, bukaan tertutup, atau layout tidak ergonomis.

## 3. Product Positioning

Interior Design Module bukan sekadar dekorasi visual. Modul ini harus menjadi:

> AI-assisted interior planning tool yang membantu user awam mengatur furniture, material, lighting, warna, dan budget interior berdasarkan ukuran ruang yang nyata.

Produk tidak boleh hanya menghasilkan gambar AI cantik yang tidak sesuai ukuran.

Source of truth tetap:

```text
Room geometry → furniture dimensions → clearance rules → material schedule → cost estimate → 3D preview
```

Bukan:

```text
AI image → dianggap ukuran asli
```

## 4. Scope MVP Interior

### 4.1 Ruangan yang Didukung MVP

MVP mendukung interior untuk:

- Ruang tamu.
- Ruang keluarga.
- Kamar tidur utama.
- Kamar tidur anak/tamu.
- Dapur.
- Ruang makan.
- Kamar mandi.
- Area kerja.
- Area rooftop lounge.
- Area kumpul keluarga.
- Musholla kecil.
- Laundry.
- Balkon.

### 4.2 Fitur MVP

MVP wajib memiliki:

1. Interior style selector.
2. Room-by-room interior planner.
3. Furniture auto-placement.
4. Furniture manual drag/drop.
5. Material palette.
6. Color palette.
7. Lighting suggestion.
8. 3D interior preview basic.
9. Interior RAB estimate.
10. Furniture and material schedule.
11. Export interior PDF.
12. Warning ergonomi/sirkulasi.

### 4.3 Non-MVP

Belum wajib di MVP:

- Photorealistic render super realistis.
- AR mode.
- Real product marketplace.
- Real-time ray tracing.
- Custom furniture modeling detail.
- Vendor interior marketplace.
- Auto-order furniture.
- Full MEP lighting calculation.
- VR walkthrough.
- Generative AI image final yang 100% presisi.

## 5. User Journey Interior

### 5.1 Entry Point

User bisa masuk ke Interior Module dari:

- Project workspace.
- 3D preview.
- Room inspector.
- Alternative layout page.
- Export page.
- AI assistant.

Contoh CTA:

```text
Desain Interior Ruangan Ini
```

atau:

```text
Generate Interior Design
```

### 5.2 Select Room

User memilih ruangan:

- Ruang tamu.
- Kamar utama.
- Dapur.
- Rooftop lounge.
- Area keluarga.
- Semua ruangan sekaligus.

UI menampilkan:

- Nama ruang.
- Ukuran ruang.
- Luas ruang.
- Bukaan pintu/jendela.
- Constraint ruangan.
- Rekomendasi furniture.

### 5.3 Choose Interior Style

User memilih style:

1. Modern Tropis.
2. Minimalis Warm.
3. Japandi.
4. Scandinavian.
5. Industrial.
6. Luxury Compact.
7. Classic Modern.
8. Natural Earth Tone.
9. Islamic Contemporary.
10. Family Cozy.

Setiap style memiliki:

- Warna utama.
- Warna aksen.
- Material lantai.
- Material dinding.
- Material plafon.
- Jenis furniture.
- Lighting style.
- Mood description.

### 5.4 AI Generate Interior

AI menghasilkan:

- Furniture layout.
- Material palette.
- Color palette.
- Lighting plan.
- Decoration suggestion.
- Cost estimate.
- Warning.

Contoh hasil:

```text
Kamar utama 3m x 4m cocok untuk kasur queen, wardrobe 2m, meja kerja kecil, dan side table. Sirkulasi minimal 70 cm dipertahankan di sisi kanan kasur.
```

### 5.5 Manual Editing

User bisa:

- Geser furniture.
- Rotate furniture.
- Ganti ukuran furniture.
- Hapus furniture.
- Tambah furniture.
- Ganti material.
- Ganti warna dinding.
- Ganti lantai.
- Ganti lampu.
- Lock item.
- Reset layout.

### 5.6 Preview

User bisa melihat:

- 2D furniture layout.
- 3D room preview.
- Before/after empty room vs designed room.
- View dari pintu.
- View dari sudut ruangan.
- Top view.
- Material preview.

### 5.7 Export

User bisa export:

- Interior PDF.
- Furniture list.
- Material list.
- Lighting list.
- Interior RAB Excel.
- 3D snapshot.
- Contractor/vendor notes.

## 6. Interior Feature Detail

## 6.1 Interior Style Preset

Setiap style preset berisi:

```json
{
  "id": "modern_tropical",
  "name": "Modern Tropis",
  "description": "Interior terang, natural, banyak kayu, tanaman, dan sirkulasi udara.",
  "colors": {
    "primary": "#F7F3EA",
    "secondary": "#8B6F47",
    "accent": "#2F5D50"
  },
  "materials": {
    "floor": ["vinyl wood", "homogeneous tile cream"],
    "wall": ["off white paint", "limewash texture"],
    "ceiling": ["white gypsum"],
    "accent": ["wood panel", "natural stone"]
  },
  "furniture": {
    "sofa": "linen neutral",
    "table": "wood",
    "cabinet": "wood laminate"
  },
  "lighting": ["warm downlight", "indirect light", "wall lamp"]
}
```

Style preset MVP:

- Modern Tropis.
- Minimalis Warm.
- Japandi.
- Scandinavian.
- Industrial.
- Luxury Compact.
- Family Cozy.

## 6.2 Room Interior Template

Setiap room type punya template furniture default.

### Ruang Tamu

Default furniture:

- Sofa 2-seater/3-seater.
- Coffee table.
- TV cabinet optional.
- Side table.
- Rug.
- Indoor plant.
- Wall decor.

Rules:

- Sofa tidak boleh menutup pintu.
- Jalur sirkulasi minimal 70–90 cm.
- TV distance disesuaikan ukuran ruang.
- Coffee table minimal 35–45 cm dari sofa.

### Ruang Keluarga

Default furniture:

- Sofa L.
- TV cabinet.
- Storage.
- Karpet.
- Bean bag optional.
- Rak display.
- Lampu lantai.

Rules:

- Cocok untuk kumpul.
- Area duduk bisa lesehan.
- Tidak mengganggu jalur tangga.
- View ke TV nyaman.

### Kamar Tidur Utama

Default furniture:

- Queen/king bed.
- Wardrobe.
- Side table.
- Dresser.
- Work desk optional.
- TV optional.

Rules:

- Sisi kasur tetap punya sirkulasi.
- Lemari bisa dibuka.
- Pintu tidak tabrakan dengan furniture.
- Jendela tidak tertutup full.

### Kamar Anak/Tamu

Default furniture:

- Single bed.
- Wardrobe kecil.
- Study desk.
- Side table.
- Storage.

Rules:

- Layout compact.
- Meja belajar dekat cahaya alami.
- Lemari tidak menghalangi pintu.

### Dapur

Default furniture:

- Kitchen set bawah.
- Kitchen set atas.
- Sink.
- Kompor.
- Kulkas.
- Countertop.
- Storage.
- Cooker hood optional.

Rules:

- Work triangle: sink, stove, fridge.
- Sink dekat jalur plumbing.
- Kompor punya ventilasi.
- Jarak gerak minimal nyaman.
- Jangan menutup jendela utama.

### Ruang Makan

Default furniture:

- Dining table 4/6 seat.
- Cabinet.
- Pendant lamp.
- Bench optional.

Rules:

- Kursi bisa ditarik.
- Sirkulasi tetap ada.
- Dekat dapur.

### Kamar Mandi

Default fixture:

- Shower.
- Toilet.
- Wastafel.
- Mirror.
- Storage.
- Floor drain.

Rules:

- Area basah/kering jelas.
- Pintu tidak menabrak fixture.
- Ventilasi atau exhaust.
- Slope lantai diarahkan ke drain.

### Rooftop Lounge

Default furniture:

- Outdoor sofa.
- Coffee table.
- Pergola.
- Planter.
- BBQ counter optional.
- Outdoor lamp.
- Railing.

Rules:

- Furniture outdoor tahan cuaca.
- Beban rooftop diberi warning.
- Drainase rooftop tidak boleh tertutup.
- Railing wajib.

### Musholla Kecil

Default furniture:

- Area sajadah.
- Rak Al-Qur’an.
- Storage mukena/sarung.
- Indirect light.
- Wall direction marker.

Rules:

- Arah kiblat sebagai metadata/manual input.
- Area bersih.
- Tidak terlalu dekat toilet jika bisa dihindari.
- Sirkulasi tetap nyaman.

## 6.3 Furniture Library

Furniture object harus berbasis ukuran, bukan hanya gambar.

Furniture schema:

```json
{
  "id": "furniture_sofa_3seat_001",
  "name": "Sofa 3 Dudukan",
  "category": "sofa",
  "width_m": 2.1,
  "depth_m": 0.85,
  "height_m": 0.8,
  "room_types": ["living_room", "family_room"],
  "style_tags": ["modern", "minimalist", "tropical"],
  "price_range": {
    "low": 2500000,
    "mid": 5000000,
    "high": 12000000
  },
  "clearance": {
    "front_m": 0.6,
    "side_m": 0.2
  }
}
```

Furniture categories:

- Seating.
- Table.
- Bed.
- Wardrobe.
- Cabinet.
- Kitchen set.
- Appliance.
- Lighting.
- Decor.
- Bathroom fixture.
- Outdoor furniture.
- Storage.
- Workspace.
- Religious/prayer furniture.

## 6.4 Furniture Placement Engine

Auto-placement harus mempertimbangkan:

- Ukuran ruangan.
- Pintu.
- Jendela.
- Sirkulasi.
- Fungsi ruang.
- Style.
- Prioritas user.
- Clearance.
- Focal point.
- Jalur listrik/plumbing jika ada.

Placement strategy:

```text
Room polygon
→ detect doors/windows
→ define circulation path
→ define focal wall
→ place primary furniture
→ place secondary furniture
→ validate clearance
→ score layout
→ return best options
```

Contoh:

- Kamar tidur: kasur adalah primary furniture.
- Ruang tamu: sofa adalah primary furniture.
- Dapur: sink/kompor/kulkas adalah primary system.
- Rooftop: seating + pergola adalah primary arrangement.

Scoring:

- Clearance score.
- Usability score.
- Style match score.
- Cost score.
- Natural light score.
- Circulation score.

## 6.5 Material Library

Material object:

```json
{
  "id": "material_floor_vinyl_oak",
  "name": "Vinyl Motif Oak",
  "category": "floor",
  "unit": "m2",
  "price_range": {
    "low": 120000,
    "mid": 180000,
    "high": 350000
  },
  "style_tags": ["japandi", "modern_tropical", "warm_minimalist"],
  "suitable_rooms": ["bedroom", "living_room", "family_room"],
  "maintenance": "medium",
  "water_resistance": "medium"
}
```

Material categories:

- Floor.
- Wall paint.
- Wall panel.
- Ceiling.
- Countertop.
- Cabinet finish.
- Backsplash.
- Bathroom tile.
- Outdoor decking.
- Pool deck.
- Railing.
- Lighting fixture.

Material UI:

- Palette card.
- Apply to room.
- Apply to all similar rooms.
- Compare material.
- Cost impact badge.

## 6.6 Color Palette Generator

AI bisa generate color palette berdasarkan style.

Output:

- Primary wall color.
- Secondary color.
- Accent color.
- Wood tone.
- Metal finish.
- Fabric color.

UI:

- Color swatches.
- Apply to room.
- Apply to house.
- Copy color code.
- Mood description.

## 6.7 Lighting Plan

Lighting module MVP:

- Downlight placement suggestion.
- Pendant lamp suggestion.
- Wall lamp suggestion.
- Indirect light suggestion.
- Outdoor light suggestion.
- Task lighting for kitchen/workspace.
- Warm/cool temperature suggestion.

Lighting object:

```json
{
  "id": "light_001",
  "type": "downlight",
  "x": 1.5,
  "y": 2.0,
  "height_m": 2.8,
  "color_temperature": "warm",
  "room_id": "living_001"
}
```

Warning:

- Ruangan gelap.
- Lampu terlalu sedikit.
- Lampu mengganggu area tidur.
- Kitchen kurang task lighting.

## 6.8 Interior RAB

Interior RAB menghitung:

- Furniture loose.
- Built-in furniture.
- Kitchen set.
- Wardrobe.
- TV cabinet.
- Lighting.
- Paint.
- Wall panel.
- Flooring.
- Ceiling.
- Bathroom fixture.
- Decor.
- Outdoor rooftop furniture.
- Installation cost.

Output:

- Low/mid/high estimate.
- Per room estimate.
- Per category estimate.
- Furniture list.
- Material list.
- Optional item list.
- Cost-saving suggestions.

Example:

```json
{
  "room": "Kamar Utama",
  "estimate": {
    "low": 18000000,
    "mid": 35000000,
    "high": 75000000
  },
  "items": [
    {
      "name": "Queen Bed",
      "qty": 1,
      "category": "furniture",
      "price_mid": 6000000
    },
    {
      "name": "Wardrobe Built-in 2.4m",
      "qty": 1,
      "category": "built_in",
      "price_mid": 12000000
    }
  ]
}
```

## 6.9 Interior AI Assistant

AI assistant untuk interior bisa menerima perintah:

- “Buat kamar utama nuansa hotel.”
- “Buat ruang keluarga yang nyaman buat lesehan.”
- “Buat dapur kecil tapi banyak storage.”
- “Buat rooftop buat ngopi malam.”
- “Bikin versi lebih hemat.”
- “Ganti style jadi Japandi.”
- “Kurangi furniture biar lega.”
- “Buat cocok untuk keluarga besar.”
- “Buat warna lebih warm.”
- “Jangan terlalu mahal.”

AI output harus berupa:

- Proposed changes.
- Furniture operation.
- Material operation.
- Cost impact.
- Warning.

Example:

```json
{
  "summary": "Saya akan mengganti layout ruang keluarga menjadi lebih lesehan dan hemat.",
  "operations": [
    {
      "type": "remove_furniture",
      "target": "large_sofa"
    },
    {
      "type": "add_furniture",
      "item": "floor_cushion_set",
      "position": { "x": 2.1, "y": 3.2 }
    },
    {
      "type": "change_material",
      "target": "floor",
      "material": "vinyl_warm_oak"
    }
  ],
  "cost_impact": "decrease",
  "warnings": []
}
```

## 7. FE Addendum for Interior Module

## 7.1 New Routes

Tambahkan routes:

```text
app/projects/[projectId]/interior/page.tsx
app/projects/[projectId]/interior/[roomId]/page.tsx
app/projects/[projectId]/materials/page.tsx
app/projects/[projectId]/furniture/page.tsx
```

Project workspace navigation menjadi:

```text
Brief
Alternatives
2D Editor
3D Preview
Interior
Materials
RAB / BOQ
Exports
Review
```

## 7.2 Interior Page Layout

Desktop layout:

```text
Left: Room List
Center: 2D/3D Interior Canvas
Right: Interior Inspector + AI Assistant
```

Tabs di center:

- 2D Layout.
- 3D Room.
- Moodboard.
- Budget.

## 7.3 Interior Components

Tambahkan komponen:

```text
InteriorWorkspace
RoomInteriorList
InteriorStyleSelector
FurnitureLibraryPanel
FurnitureItemCard
FurnitureCanvasObject
MaterialPalettePanel
MaterialSwatch
ColorPaletteCard
LightingPlanPanel
InteriorInspector
InteriorAIAssistant
MoodboardGrid
RoomBudgetSummary
InteriorWarningList
InteriorExportCard
```

## 7.4 shadcn/ui Usage

Gunakan:

- `Tabs` untuk 2D/3D/Moodboard/Budget.
- `Sheet` untuk furniture library.
- `Drawer` untuk mobile inspector.
- `Card` untuk style preset/material/furniture.
- `Command` untuk quick add furniture.
- `Popover` untuk color/material picker.
- `Slider` untuk budget/quality level.
- `Badge` untuk style tag, cost level, warning.
- `Table` untuk furniture/material schedule.
- `Alert` untuk warning ergonomi.
- `Dialog` untuk confirm apply style ke semua ruangan.

## 8. Interior State Model

Tambahkan ke design JSON:

```json
{
  "interiors": [
    {
      "room_id": "room_living_001",
      "style": "modern_tropical",
      "furniture": [],
      "materials": [],
      "lighting": [],
      "color_palette": {},
      "warnings": [],
      "budget_estimate": {}
    }
  ]
}
```

Furniture placement:

```json
{
  "id": "placed_sofa_001",
  "furniture_id": "furniture_sofa_3seat_001",
  "room_id": "room_living_001",
  "x": 1.2,
  "y": 2.5,
  "rotation_deg": 90,
  "width_m": 2.1,
  "depth_m": 0.85,
  "locked": false
}
```

Material assignment:

```json
{
  "id": "material_assignment_001",
  "room_id": "room_living_001",
  "surface": "floor",
  "material_id": "material_floor_vinyl_oak",
  "area_m2": 14.2
}
```

## 9. Interior Validation Rules

Minimum rules:

- Furniture must be inside room boundary.
- Furniture cannot block door swing.
- Furniture should not cover main window.
- Minimum circulation path must be preserved.
- Bed must have usable side access where possible.
- Dining chair pull-out clearance should be checked.
- Wardrobe door clearance should be checked.
- Kitchen sink/stove/fridge should be logically placed.
- Bathroom fixture must fit minimum clearance.
- Rooftop furniture must trigger outdoor/weather warning.
- Heavy rooftop feature must trigger structure warning.
- Built-in furniture must be included in RAB separately.

Warning examples:

```text
Sirkulasi antara sofa dan meja terlalu sempit.
Lemari terlalu dekat dengan pintu.
Kasur queen terlalu besar untuk kamar ini.
Kitchen set menutup jendela utama.
Furniture rooftop perlu material outdoor tahan cuaca.
Built-in cabinet perlu pengukuran ulang di lapangan.
```

## 10. Interior Export Pack

Tambahkan ke contractor pack:

```text
/interior/
  interior-summary.pdf
  furniture-schedule.xlsx
  material-schedule.xlsx
  lighting-schedule.xlsx
  room-moodboards.pdf
  room-renders/
    living-room.png
    master-bedroom.png
    kitchen.png
  interior-design.json
```

Interior PDF berisi:

1. Interior concept summary.
2. Style and moodboard.
3. Room-by-room layout.
4. Furniture schedule.
5. Material schedule.
6. Lighting schedule.
7. Interior RAB.
8. Vendor/contractor notes.
9. Warning and assumptions.

## 11. Interior Roadmap

### Phase Interior 1 — MVP

- Style selector.
- Furniture library basic.
- Auto furniture placement.
- Manual drag/drop.
- Material palette.
- Interior RAB basic.
- 3D room preview basic.
- Interior PDF export.

### Phase Interior 2 — Better Visualization

- Better 3D assets.
- Room render snapshots.
- Lighting preview.
- Wall/floor material preview.
- Moodboard generator.
- Before/after view.

### Phase Interior 3 — Product Catalog

- Custom furniture catalog.
- Local vendor price input.
- Shopee/Tokopedia inspiration link manual.
- Built-in furniture pricing.
- Material database by region.

### Phase Interior 4 — Marketplace

- Interior vendor review.
- Request quotation.
- Vendor package.
- Real product recommendation.
- Affiliate/commission model.

### Phase Interior 5 — Advanced AI

- Upload reference image.
- Generate similar style.
- AI room redesign.
- AI cost optimization.
- AI material substitution.
- AI family lifestyle personalization.

## 12. MVP Priority Interior

Urutan implementasi terbaik:

1. Interior data schema.
2. Style preset.
3. Furniture library static.
4. 2D furniture placement.
5. Room inspector.
6. Material palette.
7. Interior RAB.
8. 3D furniture preview.
9. AI assistant mock.
10. Interior export mock.

Jangan mulai dari photorealistic render. Mulai dari layout interior yang terukur.

## 13. Business Value

Interior module bisa dimonetisasi sebagai:

- Paid interior design generation.
- Paid room render.
- Paid furniture schedule.
- Paid material schedule.
- Interior vendor referral.
- Built-in furniture quote.
- Marketplace template interior.
- Premium style pack.

Pricing idea:

```text
Generate interior 1 room: Rp9.000
Generate full house interior: Rp49.000
Interior PDF pack: Rp29.000
Interior RAB Excel: Rp19.000
Premium render: Rp9.000/image
Vendor quote request: commission-based
```

## 14. Final Principle

Interior module harus mengikuti prinsip:

> Interior design yang baik bukan hanya cantik, tetapi muat, nyaman, bisa dibangun, dan sesuai budget.

Core flow:

```text
Room geometry
→ furniture placement
→ clearance validation
→ material selection
→ lighting suggestion
→ interior RAB
→ 3D preview
→ export interior pack
```

Hindari:

```text
AI image cantik
→ dianggap sebagai desain interior final
```
