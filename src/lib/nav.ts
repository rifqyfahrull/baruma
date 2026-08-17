import {
  Armchair,
  Box,
  Calculator,
  ClipboardCheck,
  CreditCard,
  Download,
  FileText,
  FolderKanban,
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

export const APP_NAV_SECONDARY: NavItem[] = []

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

/** Project workspace left sidebar (PRD §9.3). Items beyond brief/alternatives
 *  arrive in later milestones, shown disabled with a "Segera" badge. */
export function projectNav(projectId: string): NavItem[] {
  const base = `/app/projects/${projectId}`
  return [
    { title: "Brief", href: `${base}/brief`, icon: FileText },
    { title: "Alternatif", href: `${base}/alternatives`, icon: LayoutGrid },
    { title: "2D Editor", href: `${base}/editor`, icon: PencilRuler },
    { title: "3D Preview", href: `${base}/preview-3d`, icon: Box },
    { title: "Gambar Kerja", href: `${base}/drawings`, icon: Ruler },
    { title: "Materials", href: `${base}/materials`, icon: Palette },
    { title: "Furniture", href: `${base}/furniture`, icon: Armchair },
    { title: "RAB / BOQ", href: `${base}/rab`, icon: Calculator },
    { title: "Exports", href: `${base}/exports`, icon: Download },
    { title: "Review", href: `${base}/review`, icon: ClipboardCheck },
  ]
}
