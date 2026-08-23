"use client";

/**
 * `ProjectBar` — chrome atas satu-satunya untuk rute proyek (Fase 5),
 * menggantikan `ProjectWorkspaceHeader` (h-[~88px]) + `ProjectTabs`
 * (h-[~46px]) → satu bar `h-12`. `AppTopbar` global menyembunyikan diri di
 * rute ini (lihat app-topbar.tsx) — bar ini SUDAH menyertakan
 * `SidebarTrigger`, jadi tak ada fungsi topbar yang hilang kecuali search
 * global (dipindah ke ⌘K dalam dropdown nama) dan ThemeToggle (dipindah ke
 * item menu dropdown nama juga — didokumentasikan di bawah).
 *
 * Layout (wireframe §Fase 5 di plan):
 *   Kiri   — SidebarTrigger · ← · nama project (DropdownMenu: Ganti nama,
 *            Bagikan, Cari ⌘K, Ganti tema) · dot status simpan (Popover).
 *   Tengah — stage nav 4 pill: Brief · Alternatif · Desain · Hasil. Desain &
 *            Hasil adalah GRUP (caret → sub-halaman via DropdownMenu); klik
 *            pill Desain langsung menuju permukaan (2D/3D) TERAKHIR dibuka
 *            (localStorage, lihat lib/nav.ts), klik pill Hasil menuju
 *            sub-halaman pertamanya (Gambar Kerja).
 *   Kanan  — ✦ AI Agent · Export (primary).
 *
 * Mode fokus (`useFokusMode`): bar ini KOLAPS jadi pill kecil mengambang
 * kiri-atas (nama terpotong + tombol keluar) alih-alih dirender penuh — satu
 * baris kondisional di `ProjectBar` sendiri, tak ada komponen terpisah.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Download,
  Loader2,
  Mail,
  MessageCircle,
  Minimize2,
  Moon,
  Pencil,
  Search,
  Share2,
  Sparkles,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import type { Project } from "@/types";
import { useProject, useShareLink, useCreateShareLink, useRevokeShareLink } from "@/lib/api/hooks";
import {
  PROJECT_STAGES,
  lastSurfacePath,
  rememberLastSurface,
  stageHref,
  type StagePage,
} from "@/lib/nav";
import { useUIStore } from "@/stores/ui-store";
import { useSaveStatusStore } from "@/stores/save-status-store";
import { useProjectAgentUiStore } from "@/stores/project-agent-ui-store";
import { useFokusMode } from "@/hooks/use-fokus-mode";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { ReadinessBadge } from "@/components/shared/readiness-badge";
import { RenameProjectDialog } from "@/components/project/rename-project-dialog";
import { Pill } from "@/components/chrome/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Segmen path proyek terkait permukaan Desain — dipakai untuk mengingat
 *  permukaan yang sedang dibuka (lihat efek `rememberLastSurface` di bawah). */
const SURFACE_SEGMENT_RE = /^\/app\/projects\/[^/]+\/(editor|preview-3d)(?:\/|$)/;

export function ProjectBar({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const { data: project, isLoading } = useProject(projectId);
  const { fokusMode, toggle: toggleFokus } = useFokusMode();

  // Ingat permukaan Desain terakhir dibuka (2D/3D) — target klik pill Desain.
  React.useEffect(() => {
    const match = pathname?.match(SURFACE_SEGMENT_RE);
    if (match) rememberLastSurface(match[1]);
  }, [pathname]);

  if (fokusMode) {
    return (
      <FokusPill
        projectName={project?.name}
        isLoading={isLoading}
        onExit={toggleFokus}
      />
    );
  }

  return (
    <div
      data-testid="project-bar"
      className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <SidebarTrigger className="-ml-1" />
        <Button asChild variant="ghost" size="icon-sm" aria-label="Kembali">
          <Link href="/app/projects">
            <ArrowLeft />
          </Link>
        </Button>

        {isLoading || !project ? (
          <Skeleton className="h-6 w-40" />
        ) : (
          <ProjectNameMenu projectId={projectId} project={project} />
        )}

        <SaveStatusDot />
      </div>

      <nav aria-label="Tahap project" className="hidden shrink-0 items-center gap-1 sm:flex">
        {PROJECT_STAGES.map((stage) => (
          <StagePill key={stage.id} stage={stage} projectId={projectId} pathname={pathname} />
        ))}
      </nav>

      <div className="flex flex-1 items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => useProjectAgentUiStore.getState().setOpen(true)}
        >
          <Sparkles />
          AI Agent
        </Button>
        <Button
          size="sm"
          onClick={() => toast.info("Export tersedia di milestone berikutnya.")}
        >
          <Download />
          Export
        </Button>
      </div>
    </div>
  );
}

/** Pill mengambang kiri-atas saat mode fokus aktif — ProjectBar penuh tidak
 *  dirender sama sekali (bukan disembunyikan via CSS) sehingga tak memakan
 *  tinggi baris di layout flex kolom; `fixed` supaya mengambang di atas
 *  kanvas tanpa butuh posisi relatif dari parent. */
function FokusPill({
  projectName,
  isLoading,
  onExit,
}: {
  projectName: string | undefined;
  isLoading: boolean;
  onExit: () => void;
}) {
  return (
    <div
      data-testid="project-bar-fokus-pill"
      className="fixed left-3 top-3 z-40 flex items-center gap-1 rounded-xl border bg-card/95 px-2 py-1.5 shadow-sm backdrop-blur"
    >
      <SidebarTrigger className="size-7" />
      {isLoading || !projectName ? (
        <Skeleton className="h-4 w-24" />
      ) : (
        <span className="max-w-40 truncate text-xs font-medium">{projectName}</span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Keluar mode fokus"
            data-testid="fokus-exit"
            onClick={onExit}
          >
            <Minimize2 className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Keluar mode fokus (Esc)</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Nama project sebagai trigger `DropdownMenu` — item: ReadinessBadge (info,
 *  bukan aksi), Ganti nama…, Bagikan…, Cari… ⌘K, Ganti tema. ThemeToggle
 *  DIPINDAH ke sini (bukan tetap berdiri sendiri di kanan) — keputusan
 *  pragmatis Fase 5: `AppTopbar` (yang biasa menampungnya) hilang di rute
 *  proyek, dan cluster kanan bar ini sengaja dikunci ke 2 tombol (AI Agent /
 *  Export) sesuai wireframe plan; ganti tema tetap 1 klik lewat sini atau
 *  lewat ⌘K (command-menu.tsx sudah punya entrinya juga). */
function ProjectNameMenu({
  projectId,
  project,
}: {
  projectId: string;
  project: Project;
}) {
  const [showRename, setShowRename] = React.useState(false);
  const [showShare, setShowShare] = React.useState(false);
  const { setTheme, resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 gap-1 px-1.5 font-semibold"
            data-testid="project-name-menu-trigger"
          >
            <span className="max-w-48 truncate">{project.name}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">
              Status
            </span>
            <ReadinessBadge status={project.readiness} size="sm" />
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setShowRename(true)}>
            <Pencil />
            Ganti nama…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShowShare(true)}>
            <Share2 />
            Bagikan…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useUIStore.getState().setCommandOpen(true)}>
            <Search />
            Cari…
            <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setTheme(isDark ? "light" : "dark")}>
            {isDark ? <Sun /> : <Moon />}
            Ganti tema {isDark ? "terang" : "gelap"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameProjectDialog
        projectId={projectId}
        currentName={project.name}
        open={showRename}
        onOpenChange={setShowRename}
      />
      <ShareProjectDialog projectId={projectId} projectName={project.name} open={showShare} onOpenChange={setShowShare} />
    </>
  );
}

/** Dialog Bagikan — kini pakai tautan publik ber-token (`/s/[token]`, WS-D §2)
 *  alih-alih URL /review yang owner-only (404 bagi penerima). Tautan dibuat
 *  (atau dipakai ulang bila sudah ada) begitu dialog dibuka; "Nonaktifkan
 *  tautan" merevoke-nya sehingga penerima lama mendapat 404 ramah. */
function ShareProjectDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
}: {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: existing, isLoading } = useShareLink(projectId, { enabled: open });
  const createLink = useCreateShareLink(projectId);
  const revokeLink = useRevokeShareLink(projectId);

  // Begitu dialog terbuka dan ternyata belum ada tautan aktif, buat satu
  // otomatis (idempotent server-side) — pengguna tak perlu klik "Buat" dulu.
  React.useEffect(() => {
    if (open && !isLoading && existing && existing.url === null && !createLink.isPending) {
      createLink.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hanya reaksi ke open/existing, bukan createLink identity
  }, [open, isLoading, existing]);

  const shareUrl = existing?.url ?? createLink.data?.url ?? null;
  const shareText = `Lihat project *${projectName}* di Baruma:`;
  const pending = isLoading || createLink.isPending || (open && !shareUrl);

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Tautan disalin.");
    } catch {
      toast.error("Gagal menyalin tautan.");
    }
  };

  const shareWhatsApp = () => {
    if (!shareUrl) return;
    const url = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const shareEmail = () => {
    if (!shareUrl) return;
    const subject = `Project ${projectName} di Baruma`;
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${shareText}\n\n${shareUrl}`)}`;
    window.location.href = url;
  };

  const openLink = () => {
    if (!shareUrl) return;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  const disable = () => {
    revokeLink.mutate(undefined, {
      onSuccess: () => {
        toast.success("Tautan dinonaktifkan. Penerima lama tak bisa lagi membukanya.");
        // Tutup dialog (bukan biarkan terbuka) — effect di atas akan langsung
        // membuat tautan BARU begitu `existing.url` kembali null, yang bukan
        // niat pengguna saat menekan "Nonaktifkan".
        onOpenChange(false);
      },
      onError: () => toast.error("Gagal menonaktifkan tautan."),
    });
  };

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (next) track("share_clicked", { project_id: projectId });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bagikan project</DialogTitle>
          <DialogDescription>
            Tautan publik lihat-saja — penerima bisa melihat denah, 3D, dan
            ringkasan review tanpa perlu login, lalu meninggalkan komentar.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            aria-label="Tautan bagikan"
            value={pending ? "Menyiapkan tautan…" : shareUrl ?? ""}
            className="font-mono text-xs"
          />
          <Button size="icon" variant="outline" onClick={copy} disabled={!shareUrl} aria-label="Salin tautan">
            <Copy />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={shareWhatsApp} disabled={!shareUrl} aria-label="Bagikan via WhatsApp">
            <MessageCircle className="size-4" />
            WhatsApp
          </Button>
          <Button variant="outline" size="sm" onClick={shareEmail} disabled={!shareUrl} aria-label="Bagikan via Email">
            <Mail className="size-4" />
            Email
          </Button>
        </div>
        <DialogFooter className="flex-col items-start gap-2 sm:flex-col sm:items-start">
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 py-0 text-xs"
            onClick={openLink}
            disabled={!shareUrl}
            aria-label="Buka pratinjau tautan"
          >
            Buka pratinjau tautan
          </Button>
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 py-0 text-xs text-destructive"
            onClick={disable}
            disabled={!shareUrl || revokeLink.isPending}
            aria-label="Nonaktifkan tautan"
          >
            Nonaktifkan tautan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Dot status simpan — pengganti teks `HeaderSaveStatus` lama. Klik membuka
 *  `Popover` berisi status penuh + "Simpan sekarang", tombol itu HANYA
 *  tampil bila halaman aktif mendaftarkan `saveHandler` (lihat komentar di
 *  save-status-store.ts) — 3D preview murni otosave, jadi popovernya di
 *  sana hanya berisi teks status tanpa tombol. */
function SaveStatusDot() {
  const status = useSaveStatusStore((s) => s.status);
  const dirty = useSaveStatusStore((s) => s.dirty);
  const saveHandler = useSaveStatusStore((s) => s.saveHandler);
  const [open, setOpen] = React.useState(false);

  const { dot, label, icon } =
    status === "saving"
      ? { dot: "bg-warning", label: "Menyimpan…", icon: <Loader2 className="size-3.5 animate-spin" /> }
      : status === "conflict"
        ? {
            dot: "bg-destructive",
            label: "Konflik penyimpanan — pilih tindakan di banner",
            icon: <TriangleAlert className="size-3.5 text-destructive" />,
          }
        : status === "error"
          ? {
              dot: "bg-destructive",
              label: "Gagal menyimpan otomatis",
              icon: <TriangleAlert className="size-3.5 text-destructive" />,
            }
          : dirty
            ? { dot: "bg-warning", label: "Belum tersimpan", icon: null }
            : { dot: "bg-success", label: "Tersimpan otomatis", icon: <Check className="size-3.5 text-success" /> };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Status simpan: ${label}`}
          data-testid="save-status-dot"
          className="flex shrink-0 items-center justify-center rounded-full p-1.5 hover:bg-muted"
        >
          <span className={cn("block size-2 rounded-full", dot)} aria-hidden data-testid="save-status-dot-color" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2" data-testid="save-status-popover">
        <div className="flex items-center gap-1.5 text-xs">
          {icon}
          <span className={status === "error" || status === "conflict" ? "text-destructive" : ""}>{label}</span>
        </div>
        {saveHandler && (
          <Button
            size="sm"
            className="w-full"
            data-testid="save-now-button"
            onClick={() => {
              saveHandler();
              setOpen(false);
            }}
          >
            Simpan sekarang
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Satu entri stage nav tengah. Brief/Alternatif = pill tunggal (halaman
 *  langsung). Desain/Hasil = GRUP: pill utama + caret kecil di sampingnya
 *  yang membuka `DropdownMenu` berisi sub-halaman (dengan tanda aktif). */
function StagePill({
  stage,
  projectId,
  pathname,
}: {
  stage: StagePage;
  projectId: string;
  pathname: string | null;
}) {
  const router = useRouter();

  if (stage.path !== undefined) {
    const href = stageHref(projectId, stage.path);
    const active = pathname === href;
    return (
      <Pill
        pressed={active}
        exclusive
        label={stage.title}
        data-testid={`stage-${stage.id}`}
        onClick={() => router.push(href)}
      >
        {stage.title}
      </Pill>
    );
  }

  const items = stage.items;
  const active = items.some((item) => pathname?.startsWith(stageHref(projectId, item.path)));
  const mainTarget =
    stage.id === "desain" ? stageHref(projectId, lastSurfacePath()) : stageHref(projectId, items[0].path);

  return (
    <div className="flex items-center gap-0.5">
      <Pill
        pressed={active}
        exclusive
        label={stage.title}
        data-testid={`stage-${stage.id}`}
        onClick={() => router.push(mainTarget)}
      >
        {stage.title}
      </Pill>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Sub-halaman ${stage.title}`}
            data-testid={`stage-${stage.id}-caret`}
            className={cn(
              "flex items-center justify-center rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground",
              active && "text-foreground"
            )}
          >
            <ChevronDown className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          {items.map((item) => {
            const href = stageHref(projectId, item.path);
            const itemActive = pathname?.startsWith(href);
            return (
              <DropdownMenuItem key={item.path} asChild>
                <Link href={href} data-testid={`stage-${stage.id}-item-${item.path}`}>
                  <item.icon />
                  {item.title}
                  {itemActive && <Check className="ml-auto size-3.5" />}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
