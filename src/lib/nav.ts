import {
  Armchair,
  Box,
  Calculator,
  ClipboardCheck,
  CreditCard,
  Download,
  FileText,
  FolderKanban,
  HelpCircle,
  LayoutDashboard,
  LayoutGrid,
  Library,
  Palette,
  PencilRuler,
  Ruler,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  disabled?: boolean
  badge?: string
}

/** Main dashboard sidebar (PRD §9.2). */
export const APP_NAV: NavItem[] = [
  { title: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard },
  { title: "Projects", href: "/app/projects", icon: FolderKanban },
  { title: "Asset Library", href: "/app/asset-library", icon: Library },
  { title: "Billing", href: "/app/billing", icon: CreditCard },
]

/** Rendered below the main nav in `AppSidebar` (WS-E §3) — separate list so
 *  it can grow (Bantuan today) without competing with `APP_NAV`'s primary
 *  workflow items for visual weight. */
export const APP_NAV_SECONDARY: NavItem[] = [
  { title: "Bantuan", href: "/app/help", icon: HelpCircle },
]

/**
 * Admin backoffice link (Task 8) — kept separate because it is conditionally
 * rendered only for admins (`useCurrentUser().role === "admin"`) and renders
 * nothing at all for everyone else.
 */
export const ADMIN_NAV_ITEM: NavItem = {
  title: "Admin",
  href: "/app/admin",
  icon: ShieldCheck,
}

/**
 * Stage nav proyek (Fase 5 — pill bar tengah `ProjectBar`, menggantikan
 * `ProjectTabs` datar-10-tab). Empat "tahap" alih-alih daftar rute: dua
 * tahap adalah halaman tunggal (Brief/Alternatif), dua sisanya adalah GRUP
 * berisi beberapa sub-halaman (Desain, Hasil) — grup punya caret yang
 * membuka `DropdownMenu` berisi `items`nya. Semua rute lama tetap reachable,
 * cuma pindah level (langsung → lewat caret).
 */
export type StageId = "brief" | "alternatif" | "desain" | "hasil"

export type StageSubItem = {
  title: string
  /** Segmen path relatif terhadap `/app/projects/[projectId]` (tanpa slash). */
  path: string
  icon: LucideIcon
  /** Desain: true = "permukaan" (2D/3D, diingat via localStorage sebagai
   *  target klik pill). false/undefined = sub-halaman sekunder (caret saja). */
  surface?: boolean
}

export type StagePage =
  | { id: StageId; title: string; icon: LucideIcon; path: string; items?: undefined }
  | { id: StageId; title: string; icon: LucideIcon; path?: undefined; items: StageSubItem[] }

export const PROJECT_STAGES: StagePage[] = [
  { id: "brief", title: "Brief", icon: FileText, path: "brief" },
  { id: "alternatif", title: "Alternatif", icon: LayoutGrid, path: "alternatives" },
  {
    id: "desain",
    title: "Desain",
    icon: PencilRuler,
    items: [
      { title: "2D Editor", path: "editor", icon: PencilRuler, surface: true },
      { title: "3D Preview", path: "preview-3d", icon: Box, surface: true },
      { title: "Materials", path: "materials", icon: Palette },
      { title: "Furniture", path: "furniture", icon: Armchair },
    ],
  },
  {
    id: "hasil",
    title: "Hasil",
    icon: ClipboardCheck,
    items: [
      { title: "Gambar Kerja", path: "drawings", icon: Ruler },
      { title: "RAB / BOQ", path: "rab", icon: Calculator },
      { title: "Exports", path: "exports", icon: Download },
      { title: "Review", path: "review", icon: ClipboardCheck },
    ],
  },
]

/** `stageHref(projectId, "brief")` → `/app/projects/x/brief`. */
export function stageHref(projectId: string, path: string): string {
  return `/app/projects/${projectId}/${path}`
}

/** localStorage key: permukaan Desain terakhir dibuka (2D/3D) — dipakai
 *  sebagai target klik pill "Desain" di `ProjectBar` (bukan selalu 2D). */
const LAST_SURFACE_KEY = "baruma:last-surface"
type SurfacePath = "editor" | "preview-3d"

export function rememberLastSurface(path: string): void {
  if (path !== "editor" && path !== "preview-3d") return
  try {
    window.localStorage.setItem(LAST_SURFACE_KEY, path)
  } catch {
    // localStorage tak tersedia (privat/quota) — abaikan, default tetap jalan.
  }
}

/** Default "editor" bila belum pernah membuka salah satu permukaan, atau
 *  saat dipanggil di server (SSR-safe: window belum ada). */
export function lastSurfacePath(): SurfacePath {
  try {
    const stored = window.localStorage.getItem(LAST_SURFACE_KEY)
    if (stored === "editor" || stored === "preview-3d") return stored
  } catch {
    // ignore
  }
  return "editor"
}
