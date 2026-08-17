# FE-First PRD Addendum — Baruma

## 1. Fokus Addendum

Dokumen ini melengkapi PRD utama dengan fokus penuh pada frontend.

Target fase ini:

> Membangun frontend production-ready yang bisa berjalan dengan mocked backend, sehingga user dapat membuat project, mengisi brief, melihat alternatif layout, mengedit denah 2D, preview 3D sederhana, melihat RAB awal, dan menghasilkan tampilan contractor pack secara simulatif.

Backend CAD/BIM/AI engine belum harus selesai. Frontend harus dirancang agar nanti tinggal disambungkan ke API asli.

## 2. Keputusan Platform FE

Produk dibuat sebagai **web-based SaaS**.

Frontend harus:

- Mudah dipakai user awam.
- Mobile-friendly untuk input dan preview.
- Desktop-first untuk editor denah.
- Memiliki UI yang clean, modern, dan profesional.
- Menggunakan shadcn/ui sebagai design system foundation.
- Mendukung mocked API sejak awal.
- Siap dihubungkan ke backend FastAPI/Node API.
- Siap mendukung 2D editor, 3D viewer, export flow, dan collaboration.

## 3. FE Tech Stack

### 3.1 Core Stack

```text
Framework: Next.js App Router
Language: TypeScript
UI: shadcn/ui
Styling: Tailwind CSS
Forms: React Hook Form + Zod
Server State: TanStack Query
Client State: Zustand
2D Editor: SVG first, Canvas later jika perlu performa
3D Viewer: React Three Fiber + Drei
Table: TanStack Table
Charts: Recharts
Icons: Lucide React
Drag/resize: dnd-kit / custom pointer events
PDF preview: iframe / object preview
Mock API: MSW / local mock service
Testing: Vitest + React Testing Library + Playwright
Linting: ESLint + Prettier
Package Manager: pnpm
```

### 3.2 Rekomendasi Final

Untuk fase awal:

```text
Next.js + TypeScript + shadcn/ui + Tailwind
Zustand untuk editor state
TanStack Query untuk data API
SVG untuk 2D floor plan
React Three Fiber untuk 3D preview
Mock API dulu sebelum backend ready
```

## 4. FE Product Goals

Frontend harus memungkinkan user melakukan flow berikut:

```text
1. Landing
2. Register/Login
3. Dashboard project
4. Create project
5. Input data tanah
6. Input kebutuhan ruang
7. Generate mock alternatives
8. Pilih layout
9. Edit denah 2D
10. Preview 3D
11. Lihat RAB/BOQ awal
12. Lihat contractor pack preview
13. Download mock export
14. Share project/review
```

## 5. FE Non-Goals Fase Awal

Fase FE awal tidak wajib:

- Generate CAD asli.
- Generate BIM asli.
- Render photorealistic.
- Menghitung struktur.
- Membuat AutoCAD-level editor.
- Membuat Revit-like BIM editor.
- Offline mode.
- Collaboration realtime.
- Payment production penuh.
- Marketplace kontraktor.

Tetapi UI harus sudah menyediakan placeholder flow untuk:

- DXF export.
- IFC export.
- RAB Excel.
- Contractor pack.
- Engineer review.

## 6. Design Direction

### 6.1 Style

Tone visual:

- Modern.
- Clean.
- Professional.
- Warm.
- Tidak terlalu teknis.
- Cocok untuk user awam dan kontraktor.

Inspirasi:

- SaaS dashboard modern.
- Architecture studio.
- Construction document viewer.
- AI workspace.
- Figma-like editor ringan.
- Notion-like project workspace.

### 6.2 Warna

Default theme:

- Background: off-white / neutral.
- Primary: deep green / teal / slate.
- Accent: warm sand / amber.
- Danger: red.
- Warning: amber.
- Success: green.
- Info: blue.

Design tokens:

```text
primary: untuk CTA utama
secondary: untuk action pendukung
muted: untuk area form/editor
destructive: untuk error/risk
warning: untuk structural warning
success: untuk validation passed
```

### 6.3 Typography

Gunakan font modern yang readable:

- Inter.
- Geist.
- Plus Jakarta Sans.

Untuk MVP:

- Gunakan Geist atau Inter.

### 6.4 UI Personality

UI harus terasa seperti:

- “AI assistant yang ngerti rumah”
- “Software teknis tapi tidak menakutkan”
- “Dashboard desain rumah untuk orang awam”

Hindari:

- Terlalu engineering.
- Terlalu banyak istilah struktur.
- Terlalu ramai.
- Terlalu seperti CAD profesional.

## 7. shadcn/ui Component Inventory

Install dan gunakan komponen shadcn berikut:

### 7.1 Core UI

```text
button
input
textarea
select
checkbox
radio-group
switch
slider
label
separator
badge
card
tabs
dialog
sheet
drawer
popover
tooltip
dropdown-menu
accordion
alert
alert-dialog
toast / sonner
breadcrumb
avatar
progress
skeleton
scroll-area
resizable
command
calendar
table
```

### 7.2 App-Specific Usage

| shadcn Component | Penggunaan                                  |
| ---------------- | ------------------------------------------- |
| Button           | CTA, generate, save, export                 |
| Card             | project card, alternative card, RAB summary |
| Tabs             | project workspace navigation                |
| Sheet            | property inspector, AI assistant side panel |
| Dialog           | confirm export, delete project, warning     |
| Drawer           | mobile property panel                       |
| Select           | style, floor, room type, export format      |
| Slider           | room size, budget, finishing level          |
| Badge            | readiness status, warning status            |
| Alert            | risk warning, failed validation             |
| Progress         | generation/export progress                  |
| Skeleton         | loading project/layout                      |
| Table            | RAB, BOQ, room schedule                     |
| Resizable        | editor panels                               |
| Tooltip          | explain architectural terms                 |
| Command          | quick action palette                        |
| Breadcrumb       | project navigation                          |
| Sonner           | success/error notification                  |

## 8. Routing Structure

Gunakan Next.js App Router.

```text
app/
  (marketing)/
    page.tsx
    pricing/page.tsx
    templates/page.tsx
    examples/page.tsx

  (auth)/
    login/page.tsx
    register/page.tsx
    forgot-password/page.tsx

  app/
    layout.tsx
    dashboard/page.tsx
    projects/page.tsx
    projects/new/page.tsx
    projects/[projectId]/
      page.tsx
      brief/page.tsx
      alternatives/page.tsx
      editor/page.tsx
      preview-3d/page.tsx
      rab/page.tsx
      exports/page.tsx
      review/page.tsx
      settings/page.tsx

  admin/
    dashboard/page.tsx
    users/page.tsx
    projects/page.tsx
    exports/page.tsx
```

## 9. Layout Shell

### 9.1 Marketing Layout

Halaman publik:

- Navbar.
- Hero.
- Demo preview.
- Feature sections.
- Pricing.
- FAQ.
- CTA.
- Footer.

### 9.2 App Layout

Dashboard layout:

- Left sidebar.
- Topbar.
- Main content.
- User profile dropdown.
- Project switcher.
- Credit usage indicator.
- Export queue indicator.

### 9.3 Project Workspace Layout

Untuk `/app/projects/[projectId]/*`:

```text
Topbar:
- Project name
- Version selector
- Save status
- Share button
- Export button

Left sidebar:
- Brief
- Alternatives
- 2D Editor
- 3D Preview
- RAB / BOQ
- Exports
- Review

Main area:
- Current workspace

Right panel:
- Contextual inspector
- AI assistant
- Validation warnings
```

Desktop:

- 3-column layout untuk editor.

Mobile:

- Bottom navigation.
- Editor simplified.
- Property inspector via Drawer.

## 10. Page-by-Page Specification

## 10.1 Landing Page

Goal:

- Menjelaskan produk dengan cepat.
- Menunjukkan hasil nyata.
- Mengarahkan user ke create project.

Sections:

1. Hero.
2. Problem.
3. Product workflow.
4. Example: rumah 8×8 3 lantai + rooftop + kolam.
5. Output showcase: Denah, 3D, RAB, DXF, IFC.
6. Safety positioning.
7. Pricing preview.
8. FAQ.
9. CTA.

Hero copy:

```text
Bikin konsep rumah terukur dari ide sederhana.
Dapatkan denah, 3D preview, RAB awal, dan paket diskusi kontraktor dalam satu workspace.
```

CTA:

- Mulai desain rumah.
- Lihat contoh output.

## 10.2 Dashboard

Goal:

- Menampilkan project user.

Components:

- Welcome card.
- Create project button.
- Recent projects grid.
- Usage/credits card.
- Export history.
- Suggested templates.

Project card harus menampilkan:

- Thumbnail denah/3D.
- Project name.
- Lokasi.
- Luas tanah.
- Jumlah lantai.
- Status.
- Last updated.
- Quick actions: open, duplicate, export.

Empty state:

```text
Belum ada project.
Mulai dari ukuran tanah dan kebutuhan rumahmu.
```

CTA:

- Buat Project Baru.

## 10.3 Create Project Wizard

Goal:

- Mengubah user awam menjadi structured brief.

Wizard steps:

### Step 1 — Basic Info

Fields:

- Nama project.
- Lokasi kota/kabupaten.
- Tipe project: rumah baru / renovasi.
- Style awal.

### Step 2 — Data Tanah

Fields:

- Lebar tanah.
- Panjang tanah.
- Arah hadap.
- Jumlah sisi menempel tetangga.
- Lebar jalan depan.
- Butuh carport: ya/tidak.
- Catatan kondisi tanah.

Validation:

- Lebar/panjang wajib.
- Minimal 3 m.
- Luas otomatis dihitung.

### Step 3 — Bangunan

Fields:

- Jumlah lantai.
- Rooftop ya/tidak.
- Budget range.
- Target kualitas finishing.
- Prioritas utama.

Prioritas:

- Hemat biaya.
- Banyak kamar.
- Terasa lega.
- Cocok keluarga besar.
- Ada kolam.
- Ada rooftop.
- Banyak cahaya.
- Adem/ventilasi.
- Tampilan mewah.

### Step 4 — Kebutuhan Ruang

Room selector:

- Kamar tidur.
- Kamar mandi.
- Ruang tamu.
- Ruang keluarga.
- Dapur.
- Ruang makan.
- Musholla.
- Laundry.
- Gudang.
- Balkon.
- Rooftop lounge.
- Area kumpul keluarga.
- Kolam.
- Taman.
- Workspace.

Setiap ruang bisa punya:

- required / optional.
- preferred floor.
- size preference.
- notes.

### Step 5 — AI Summary

Tampilkan ringkasan:

- Luas tanah.
- Jumlah lantai.
- Daftar ruang.
- Risiko awal.
- Rekomendasi AI.
- Tombol generate alternatives.

UI:

- Card summary.
- Alert warning.
- Editable summary.
- Generate button.

## 10.4 Brief Page

Goal:

- Menampilkan design brief secara terstruktur.

Sections:

- Project summary.
- Site data.
- User priorities.
- Space program.
- Assumptions.
- Constraints.
- Risk warnings.

Actions:

- Edit brief.
- Ask AI to improve brief.
- Generate alternatives.
- Export brief PDF.

Right panel:

- AI Assistant.
- “Apa maksud void?”
- “Apakah kolam realistis di tanah ini?”
- “Buat versi lebih hemat.”

## 10.5 Alternatives Page

Goal:

- Menampilkan 3–5 alternatif layout.

Alternative card:

- Name.
- Score.
- Thumbnail denah.
- Key features.
- Pros.
- Cons.
- Estimated cost.
- Readiness status.
- Risk badges.
- Select button.

Alternative types:

1. Hemat biaya.
2. Terasa lega.
3. Fitur maksimal.
4. Keluarga besar.
5. Premium compact.

Comparison mode:

- Side-by-side cards.
- Area comparison.
- Room count.
- Cost range.
- Risk level.

Actions:

- Select alternative.
- Regenerate.
- Modify prompt.
- Duplicate.

## 10.6 2D Editor Page

Goal:

- User bisa melihat dan mengedit denah.

Layout:

```text
Left Toolbar | Main Canvas | Right Inspector
```

### Left Toolbar

Tools:

- Select.
- Pan.
- Add room.
- Add wall.
- Add door.
- Add window.
- Add stair.
- Add furniture.
- Add dimension.
- Add annotation.
- Delete.
- Undo.
- Redo.

MVP wajib:

- Select.
- Move room.
- Resize room.
- Add door/window.
- Floor switcher.
- Undo/redo.
- Zoom/pan.
- Save.

### Main Canvas

Features:

- Grid.
- Snap to grid.
- Floor boundary.
- Room polygons.
- Wall lines.
- Door/window symbols.
- Room labels.
- Area labels.
- Dimension labels.
- Warning markers.
- Mini map optional.

Canvas state:

- current floor.
- selected object.
- zoom level.
- pan position.
- active tool.
- snap enabled.
- measurement unit.

### Right Inspector

Jika room selected:

- Room name.
- Room type.
- Width.
- Depth.
- Area.
- Floor.
- Requires natural light.
- Requires ventilation.
- Lock position.
- Delete.

Jika wall selected:

- Thickness.
- Wall type.
- External/internal.
- Delete.

Jika door/window selected:

- Width.
- Height.
- Sill height.
- Position.

Jika no object:

- Design summary.
- Validation warnings.
- AI suggestions.

### Validation UX

Warning markers:

- Red: invalid.
- Amber: caution.
- Blue: suggestion.

Examples:

- “Kamar mandi tidak punya ventilasi.”
- “Kolam memerlukan review struktur.”
- “Tangga terlalu curam.”
- “Room overlap.”
- “Pintu belum terhubung ke dinding.”

### Editor Acceptance Criteria

- User bisa switch lantai.
- User bisa select room.
- User bisa move/resize room.
- Area otomatis update.
- Warning muncul jika layout invalid.
- 3D preview bisa sync dari layout.
- Changes tersimpan sebagai draft.
- Undo/redo bekerja.
- Tidak crash saat 100+ objects.

## 10.7 3D Preview Page

Goal:

- User awam bisa memahami rumah secara visual.

Features:

- Orbit camera.
- Zoom.
- Pan.
- Floor toggle.
- Exploded floor view.
- Hide roof.
- Show/hide furniture.
- Show/hide labels.
- Click room to inspect.
- Material preset selector.
- View preset: front, top, isometric, rooftop.
- Screenshot button.

Material presets:

- Modern tropis.
- Minimalis putih.
- Industrial.
- Japandi.
- Warm wood.

MVP 3D:

- Slab.
- Walls.
- Openings.
- Doors/windows basic.
- Stairs basic.
- Pool basic.
- Rooftop railing.
- Furniture placeholder.

Right panel:

- Selected room info.
- Material options.
- View controls.
- 3D generation status.

Fallback:

- Jika 3D gagal, tampilkan 2D preview dan error message.

## 10.8 RAB / BOQ Page

Goal:

- User memahami estimasi biaya.

Sections:

1. Cost summary.
2. Area summary.
3. Cost by category.
4. BOQ table.
5. Assumptions.
6. Cost saving suggestions.

Cards:

- Total estimate low.
- Total estimate mid.
- Total estimate high.
- Cost per m².
- Confidence level.

BOQ table columns:

- Kategori.
- Item.
- Volume.
- Unit.
- Harga satuan.
- Total.
- Confidence.
- Notes.

Filters:

- Struktur.
- Arsitektur.
- Plumbing.
- Listrik.
- Finishing.
- Kolam.
- Rooftop.

Actions:

- Change finishing level.
- Export Excel.
- Export PDF.
- Add manual price.
- Duplicate scenario.

## 10.9 Exports Page

Goal:

- User meng-generate dan download file.

Export cards:

- Contractor Pack PDF.
- DXF CAD.
- IFC BIM Basic.
- GLB 3D.
- RAB Excel.
- ZIP All Files.

Each card:

- Description.
- Status.
- Last generated.
- File size.
- Readiness label.
- Generate button.
- Download button.

Export flow:

1. User klik generate.
2. Dialog warning muncul.
3. User confirm.
4. Job queued.
5. Progress shown.
6. Download available.

Warning copy:

```text
Dokumen ini adalah draft desain awal untuk diskusi. Belum dapat digunakan sebagai gambar kerja final sebelum ditinjau tenaga ahli.
```

## 10.10 Review Page

Goal:

- Mengumpulkan warning dan komentar.

Sections:

- Validation status.
- Structural warnings.
- Spatial warnings.
- Cost warnings.
- AI review summary.
- Professional review checklist.
- Comments.

Review checklist:

- Arsitek.
- Engineer struktur.
- MEP/plumbing.
- Kontraktor.
- PBG/legal.

Actions:

- Add comment.
- Resolve issue.
- Request professional review.
- Mark as reviewed.

## 11. Frontend Architecture

## 11.1 Folder Structure

```text
src/
  app/
    (marketing)/
    (auth)/
    app/
      dashboard/
      projects/
  components/
    ui/
    layout/
    marketing/
    dashboard/
    project/
    wizard/
    editor/
    preview-3d/
    rab/
    exports/
    review/
    shared/
  features/
    auth/
    projects/
    brief/
    alternatives/
    editor/
    preview3d/
    rab/
    exports/
    review/
  lib/
    api/
    mock/
    schemas/
    utils/
    geometry/
    constants/
  stores/
    editor-store.ts
    project-store.ts
    ui-store.ts
  hooks/
  types/
  styles/
```

## 11.2 Component Philosophy

Rules:

- shadcn/ui components stay in `components/ui`.
- App-specific components stay in feature folders.
- Business logic stays outside UI components.
- Editor state stays in Zustand.
- API data stays in TanStack Query.
- Zod schema shared between form and mock API.
- Components should be small and composable.

## 11.3 Server vs Client Components

Use Server Components for:

- Static marketing pages.
- Dashboard shell where possible.
- Initial project fetch if using SSR later.
- Pricing page.

Use Client Components for:

- Wizard forms.
- 2D editor.
- 3D viewer.
- AI chat panel.
- Drag/resize interactions.
- Live validation.
- Toasts.
- Dialogs with local state.

## 12. State Management

## 12.1 TanStack Query

Use for server-state:

- Projects.
- Design versions.
- Alternatives.
- Exports.
- RAB data.
- Reviews.
- User profile.

Example query keys:

```text
["projects"]
["project", projectId]
["design-version", projectId, versionId]
["alternatives", projectId]
["exports", projectId, versionId]
["rab", projectId, versionId]
```

## 12.2 Zustand

Use for local UI/editor state:

- Selected floor.
- Selected object.
- Active tool.
- Canvas zoom/pan.
- Draft layout.
- Undo/redo stack.
- Inspector state.
- Temporary operations.
- 3D view settings.

Editor store shape:

```ts
type EditorStore = {
  activeTool:
    | "select"
    | "pan"
    | "room"
    | "wall"
    | "door"
    | "window"
    | "dimension";
  selectedFloorId: string;
  selectedObjectId: string | null;
  zoom: number;
  pan: { x: number; y: number };
  snapEnabled: boolean;
  gridSize: number;
  draftLayout: DesignLayout;
  history: LayoutOperation[];
  future: LayoutOperation[];
  setActiveTool: (tool: EditorTool) => void;
  selectObject: (id: string | null) => void;
  applyOperation: (operation: LayoutOperation) => void;
  undo: () => void;
  redo: () => void;
};
```

## 13. Frontend Domain Types

## 13.1 Project

```ts
type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  location?: string;
  thumbnailUrl?: string;
  site: Site;
  createdAt: string;
  updatedAt: string;
};
```

## 13.2 Site

```ts
type Site = {
  widthM: number;
  depthM: number;
  areaM2: number;
  city?: string;
  province?: string;
  frontOrientation?: "north" | "east" | "south" | "west" | "unknown";
};
```

## 13.3 Room

```ts
type Room = {
  id: string;
  floorId: string;
  name: string;
  type: RoomType;
  x: number;
  y: number;
  width: number;
  depth: number;
  areaM2: number;
  locked?: boolean;
  requiresNaturalLight?: boolean;
  requiresVentilation?: boolean;
};
```

## 13.4 Wall

```ts
type Wall = {
  id: string;
  floorId: string;
  start: Point;
  end: Point;
  thicknessM: number;
  isExternal: boolean;
};
```

## 13.5 Opening

```ts
type Opening = {
  id: string;
  floorId: string;
  wallId: string;
  type: "door" | "window";
  positionM: number;
  widthM: number;
  heightM: number;
};
```

## 13.6 Design Layout

```ts
type DesignLayout = {
  id: string;
  projectId: string;
  versionId: string;
  floors: Floor[];
  rooms: Room[];
  walls: Wall[];
  openings: Opening[];
  stairs: Stair[];
  pools: Pool[];
  validation: ValidationResult;
};
```

## 14. Mock API Plan

Sebelum backend siap, buat mock service.

Mock files:

```text
src/lib/mock/projects.ts
src/lib/mock/layouts.ts
src/lib/mock/alternatives.ts
src/lib/mock/rab.ts
src/lib/mock/exports.ts
```

Mock API behavior:

- Create project returns fake project.
- Generate alternatives returns 3 template layouts.
- Select alternative creates design version.
- Save editor updates local/mock layout.
- Generate export returns fake job with delayed completed state.
- RAB returns generated estimate from layout area.

Use MSW if ingin mirip API asli. Kalau ingin cepat, pakai local service functions dulu.

## 15. FE Validation

Gunakan Zod untuk:

- Create project wizard.
- Site dimensions.
- Room requirements.
- Budget.
- Export request.
- Layout object validation.

Example validation:

```ts
const siteSchema = z.object({
  widthM: z.number().min(3).max(50),
  depthM: z.number().min(3).max(100),
  city: z.string().optional(),
});
```

Editor validation:

- Room width/depth minimum.
- Room inside boundary.
- No negative dimensions.
- Object has floorId.
- Door/window attached to wall.
- Stair connects valid floors.

## 16. 2D Editor Implementation Detail

## 16.1 Why SVG First

Gunakan SVG untuk MVP karena:

- Mudah render shapes.
- Mudah handle click/select.
- Mudah export ke image/PDF.
- Mudah debug.
- Cukup untuk denah rumah sederhana.

Canvas/WebGL bisa dipakai nanti jika:

- Object sangat banyak.
- Performance turun.
- Butuh CAD-like rendering lebih kompleks.

## 16.2 Coordinate System

Internal unit: meter.

Canvas transform:

```text
1 meter = 80 px default
```

Support:

- zoom.
- pan.
- snap to 0.25 m or 0.5 m.
- display dimensions in meter.

## 16.3 Editor Objects

Render order:

1. Site boundary.
2. Grid.
3. Rooms.
4. Walls.
5. Openings.
6. Furniture.
7. Dimensions.
8. Labels.
9. Warning markers.
10. Selection handles.

## 16.4 Selection Behavior

Click room:

- Highlight room.
- Show resize handles.
- Show inspector.

Drag room:

- Move room.
- Snap to grid.
- Validate after drag.

Resize room:

- Update width/depth.
- Update area.
- Show live dimension.

Keyboard:

- Delete selected.
- Escape clear selection.
- Ctrl/Cmd+Z undo.
- Ctrl/Cmd+Y redo.
- Space hold pan optional.

## 17. 3D Viewer Implementation Detail

## 17.1 MVP Approach

Generate 3D directly on frontend from layout JSON.

Objects:

- Floor slab = box.
- Wall = box from line.
- Room floor = plane.
- Door/window = cutout approximation or colored placeholder.
- Stair = repeated boxes.
- Pool = depressed blue box.
- Rooftop = slab + railing.

This avoids waiting for backend GLB generation.

Later:

- Backend generates GLB.
- Frontend loads GLB.
- 3D preview still uses same layout JSON.

## 17.2 3D Features MVP

- Orbit controls.
- Floor visibility toggle.
- Exploded floors.
- Room hover.
- Room click.
- Labels optional.
- Material preset.
- Screenshot.

## 18. AI Assistant Panel FE

AI Assistant is a right-side sheet/panel.

Modes:

- Brief assistant.
- Layout assistant.
- Cost assistant.
- Review assistant.

Input examples:

- “Buat lebih hemat.”
- “Kolam pindah ke belakang.”
- “Tambah musholla kecil.”
- “Rooftop buat nongkrong keluarga.”
- “Jelaskan warning ini.”
- “Buat layout terasa lebih lega.”

MVP behavior:

- Mock responses.
- Some commands trigger local transformations.
- Later connected to AI API.

AI response card:

- Summary.
- Proposed changes.
- Apply button.
- Reject button.

Apply operation:

- AI response returns layout operations.
- User confirms.
- Store applies operations.
- Validation reruns.

## 19. Readiness Status UI

Every project/version must show status badge:

Statuses:

- Concept Ready.
- Contractor Discussion Ready.
- Engineer Review Required.
- Engineer Approved.

Badge colors:

- Concept Ready: blue/neutral.
- Contractor Discussion Ready: green.
- Engineer Review Required: amber.
- Engineer Approved: emerald.
- Invalid: red.

Status component:

```text
<ReadinessBadge status="engineer_review_required" />
```

Warnings should be visible:

- Top alert.
- Review tab.
- Export confirmation.
- PDF mock preview.

## 20. Design System Components to Build

Beyond shadcn/ui, build custom components:

### 20.1 Layout Components

```text
AppShell
AppSidebar
AppTopbar
ProjectWorkspaceShell
ProjectNav
RightInspector
PageHeader
EmptyState
LoadingState
```

### 20.2 Project Components

```text
ProjectCard
ProjectStatusBadge
CreateProjectWizard
SiteInputForm
RoomRequirementSelector
PrioritySelector
BudgetRangeInput
```

### 20.3 Brief Components

```text
BriefSummaryCard
SpaceProgramTable
AssumptionList
ConstraintWarningList
```

### 20.4 Alternative Components

```text
AlternativeCard
AlternativeComparisonTable
LayoutThumbnail
ScoreBadge
RiskBadgeGroup
```

### 20.5 Editor Components

```text
PlanCanvas
EditorToolbar
FloorSwitcher
RoomShape
WallShape
DoorSymbol
WindowSymbol
DimensionLine
SelectionHandles
EditorInspector
ValidationMarker
MiniMap
```

### 20.6 3D Components

```text
HouseScene
FloorMesh
WallMesh
RoomLabel3D
StairMesh
PoolMesh
OrbitControlsPanel
MaterialPresetSelector
ViewPresetButtons
```

### 20.7 RAB Components

```text
CostSummaryCards
RABTable
BOQTable
FinishingLevelSelector
CostAssumptionCard
CostSavingSuggestions
```

### 20.8 Export Components

```text
ExportCard
ExportJobProgress
DownloadButton
ExportWarningDialog
ContractorPackPreview
```

### 20.9 Review Components

```text
ValidationSummary
WarningCard
ReviewChecklist
CommentThread
ProfessionalReviewCTA
```

## 21. FE UX Rules

### 21.1 User Awam First

Gunakan bahasa:

- “Denah”
- “Ukuran ruang”
- “Estimasi biaya”
- “Perlu review struktur”
- “Paket diskusi kontraktor”

Hindari terlalu sering:

- “BIM”
- “IFC”
- “parametric geometry”
- “structural load”
- “topology validation”

Kecuali di halaman export/pro mode.

### 21.2 Always Explain Risk

Jika ada fitur seperti:

- 3 lantai.
- rooftop.
- kolam.
- bentang ruang besar.

UI wajib menampilkan warning:

```text
Desain ini perlu ditinjau engineer struktur sebelum dibangun.
```

### 21.3 Never Hide Limitations

Export page wajib menampilkan:

```text
File ini adalah draft awal untuk diskusi. Belum dapat digunakan sebagai gambar kerja final.
```

### 21.4 Make Technical Output Feel Useful

Untuk setiap export, jelaskan:

- File ini untuk siapa.
- Bisa dibuka dengan apa.
- Kapan digunakan.
- Apa batasannya.

Contoh DXF:

```text
DXF cocok untuk drafter/kontraktor yang ingin membuka denah di software CAD.
```

## 22. Responsive Requirements

### Desktop

Full functionality:

- Dashboard.
- Wizard.
- 2D editor.
- 3D viewer.
- RAB table.
- Export.

### Tablet

Supported:

- Wizard.
- Dashboard.
- Preview.
- Light editing.

### Mobile

Supported:

- Create project.
- Input brief.
- View alternatives.
- View 3D simple.
- View RAB.
- Download exports.

Not ideal:

- Detailed 2D editing.

On mobile editor:

- Show warning: “Editing denah lebih nyaman di laptop/desktop.”
- Provide simplified controls.

## 23. Accessibility

Requirements:

- Keyboard navigation for forms.
- Proper labels.
- Dialog focus trap.
- Color is not only indicator.
- Tooltips have accessible text.
- Buttons have clear names.
- Tables readable.
- Toast not required for critical information.
- Warning remains visible in page content.

## 24. Loading, Empty, Error States

### Loading

Use skeleton for:

- Dashboard projects.
- Alternatives.
- RAB table.
- Export jobs.

Use progress for:

- Generate alternatives.
- Generate 3D.
- Generate export.

### Empty

Examples:

- No project.
- No alternatives.
- No export.
- No comments.

### Error

Error card should contain:

- What happened.
- Suggested action.
- Retry button.
- Contact support optional.

Example:

```text
Gagal membuat preview 3D.
Denah tetap aman tersimpan. Coba generate ulang preview.
```

## 25. FE Testing Strategy

### Unit Tests

Test:

- Utility functions.
- Zod schemas.
- Geometry helpers.
- Cost formatting.
- Status mapping.

### Component Tests

Test:

- Wizard step validation.
- Alternative card actions.
- Readiness badge.
- RAB table.
- Export card states.

### Editor Tests

Test:

- Select room.
- Move room.
- Resize room.
- Undo/redo.
- Validation warnings.

### E2E Tests

Critical flows:

1. Register/login mock.
2. Create project.
3. Fill wizard.
4. Generate alternatives.
5. Select alternative.
6. Edit room.
7. Open 3D preview.
8. Generate export.
9. Download mock file.

## 26. FE Performance Targets

- Initial marketing page LCP < 2.5s.
- Dashboard load < 2s with cached data.
- Editor interaction < 100ms.
- 2D canvas supports 100 objects smoothly.
- 3D preview initial load < 5s for basic model.
- Route transitions feel instant with skeletons.
- Avoid loading 3D libraries on non-3D pages.

Implementation:

- Dynamic import 3D viewer.
- Lazy load heavy editor.
- Memoize SVG objects.
- Split editor store selectors.
- Use virtualization for long tables.

## 27. Analytics Events

Track:

```text
signup_started
signup_completed
project_created
wizard_step_completed
brief_generated
alternatives_generated
alternative_selected
editor_opened
room_edited
validation_warning_clicked
preview_3d_opened
rab_opened
export_started
export_completed
export_downloaded
share_clicked
upgrade_clicked
```

Each event should include:

- project_id.
- design_version_id.
- user_plan.
- source page.
- timestamp.

## 28. FE Monetization Hooks

Even before payment backend exists, UI should prepare:

- Usage card.
- Credit balance.
- Upgrade CTA.
- Locked export formats.
- Plan badges.
- Watermark notice.
- Pay-per-export modal placeholder.

Locked features:

- DXF export.
- IFC export.
- Contractor pack ZIP.
- High quality render.
- Professional review.

## 29. Development Milestones FE-First

## Milestone FE-0 — Project Setup

Deliverables:

- Next.js project.
- TypeScript.
- Tailwind.
- shadcn/ui.
- ESLint/Prettier.
- Base layout.
- Theme tokens.
- Basic routing.

Done when:

- App runs.
- shadcn components installed.
- Light/dark mode optional.
- App shell works.

## Milestone FE-1 — Marketing + Auth Mock

Deliverables:

- Landing page.
- Pricing page.
- Login/register mock.
- App shell.

Done when:

- User can enter dashboard with mock auth.

## Milestone FE-2 — Dashboard + Project Wizard

Deliverables:

- Dashboard.
- Project cards.
- Create project wizard.
- Form validation.
- Mock project creation.

Done when:

- User can create project from wizard.

## Milestone FE-3 — Brief + Alternatives

Deliverables:

- Brief page.
- Space program table.
- Generate alternatives mock.
- Alternative cards.
- Select alternative.

Done when:

- User can select one generated design.

## Milestone FE-4 — 2D Editor MVP

Deliverables:

- SVG plan canvas.
- Floor switcher.
- Room render.
- Select/move/resize.
- Inspector.
- Validation warnings.
- Undo/redo.

Done when:

- User can edit a selected layout visually.

## Milestone FE-5 — 3D Preview MVP

Deliverables:

- React Three Fiber scene.
- Generate simple 3D from layout JSON.
- Orbit controls.
- Floor toggle.
- Room click.

Done when:

- 3D preview matches 2D layout.

## Milestone FE-6 — RAB/BOQ UI

Deliverables:

- Cost summary cards.
- RAB table.
- BOQ table.
- Assumptions.
- Finishing level selector.

Done when:

- User can understand cost estimate.

## Milestone FE-7 — Export UI

Deliverables:

- Export page.
- Export cards.
- Mock export jobs.
- Progress.
- Download mock files.
- Warning dialog.

Done when:

- User can simulate contractor pack export.

## Milestone FE-8 — Review + Share

Deliverables:

- Review page.
- Warning list.
- Comment UI.
- Share dialog.
- Professional review CTA.

Done when:

- User can review all risks and share project mock link.

## Milestone FE-9 — Production Polish

Deliverables:

- Responsive.
- Accessibility.
- Loading states.
- Error states.
- E2E tests.
- Analytics events.
- Performance optimization.

Done when:

- FE is usable by beta users end-to-end.

## 30. Recommended Sprint Plan

### Sprint 1

Focus:

- Setup.
- shadcn theme.
- App shell.
- Dashboard.
- Create project wizard.

### Sprint 2

Focus:

- Brief page.
- Alternatives page.
- Mock layout data.
- Project version structure.

### Sprint 3

Focus:

- 2D editor MVP.
- Room select/move/resize.
- Inspector.
- Validation.

### Sprint 4

Focus:

- 3D preview.
- RAB page.
- Export page mock.

### Sprint 5

Focus:

- Review page.
- Share flow.
- Responsive.
- Polish.
- E2E.

## 31. First Demo Case

Gunakan demo bawaan:

```text
Nama: Rumah 8x8 Modern Tropis
Lokasi: Sidoarjo
Tanah: 8m x 8m
Lantai: 3 lantai + rooftop
Fitur: plunge pool, area kumpul keluarga, rooftop lounge
Style: modern tropis
Prioritas: terasa lega, keluarga besar, cahaya alami
```

Alternatif mock:

1. Compact Courtyard Pool.
2. Family Gathering Priority.
3. Cost Efficient Vertical House.

Demo ini harus terlihat di:

- Landing example.
- Template page.
- Dashboard sample.
- Alternatives page.
- 2D editor.
- 3D preview.
- RAB page.
- Export preview.

## 32. Definition of Done FE Beta

FE dianggap siap beta jika:

- User bisa masuk dashboard.
- User bisa buat project.
- User bisa isi wizard.
- User bisa lihat brief.
- User bisa generate mock alternatives.
- User bisa pilih layout.
- User bisa edit denah 2D sederhana.
- User bisa lihat 3D preview sederhana.
- User bisa lihat RAB awal.
- User bisa masuk export page.
- User bisa generate mock contractor pack.
- User bisa melihat warning legal/struktur.
- UI responsive minimal untuk mobile.
- Critical flow punya E2E test.
- Tidak ada crash pada main flow.
- Performance editor masih nyaman.
- Semua fitur berat yang belum real diberi label mock/beta/internal.

## 33. Frontend Principle

Frontend produk ini harus memegang prinsip:

> User awam harus merasa mudah, tetapi output teknis harus tetap jujur soal batasannya.

Jangan buat UI yang membuat user merasa:

```text
Ini sudah pasti bisa langsung dibangun.
```

Buat user merasa:

```text
Sekarang saya punya brief, denah, visual, dan dokumen awal yang jauh lebih jelas untuk dibawa ke kontraktor/arsitek/engineer.
```

## 34. Final FE Recommendation

Bangun FE dulu dengan urutan:

```text
shadcn design system
→ project wizard
→ alternatives
→ 2D editor SVG
→ 3D preview R3F
→ RAB UI
→ export mock
→ review/warning
```

Backend CAD/BIM menyusul setelah FE flow terbukti.

Untuk MVP awal, yang paling penting bukan IFC dulu, tapi:

- User paham flow.
- Denah bisa diedit.
- 3D match dengan denah.
- RAB terlihat masuk akal.
- Export flow terasa valuable.
- Warning profesional selalu jelas.
