"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Loader2,
  Mail,
  MessageCircle,
  Pencil,
  Share2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { useProject } from "@/lib/api/hooks";
import { LayoutConflictBanner } from "@/components/project/layout-conflict-banner";
import { RenameProjectDialog } from "@/components/project/rename-project-dialog";
import { useSaveStatusStore } from "@/stores/save-status-store";
import { usePreviewStore } from "@/stores/preview-store";
import { useProjectAgentUiStore } from "@/stores/project-agent-ui-store";
import { track } from "@/lib/analytics";
import { ReadinessBadge } from "@/components/shared/readiness-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Status simpan LIVE di bawah nama project — dilaporkan halaman editor
 * (2D/3D) via useSaveStatusStore. Halaman lain: default "Tersimpan otomatis".
 */
function HeaderSaveStatus() {
  const status = useSaveStatusStore((s) => s.status);
  const dirty = useSaveStatusStore((s) => s.dirty);

  return (
    <p
      className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"
      data-testid="header-save-status"
      aria-live="polite"
    >
      {status === "saving" ? (
        <>
          <Loader2 className="size-3 animate-spin" />
          Menyimpan…
        </>
      ) : status === "conflict" ? (
        <>
          <TriangleAlert className="size-3 text-destructive" />
          <span className="text-destructive">
            Konflik penyimpanan — pilih tindakan di banner
          </span>
        </>
      ) : status === "error" ? (
        <>
          <TriangleAlert className="size-3 text-destructive" />
          <span className="text-destructive">Gagal menyimpan otomatis</span>
        </>
      ) : dirty ? (
        <>
          <span className="size-2 rounded-full bg-warning" aria-hidden />
          Belum tersimpan
        </>
      ) : (
        <>
          <Check className="size-3 text-success" />
          Tersimpan otomatis
        </>
      )}
    </p>
  );
}

export function ProjectWorkspaceHeader({ projectId }: { projectId: string }) {
  const { data: project, isLoading } = useProject(projectId);
  const [open, setOpen] = React.useState(false);
  const [showRename, setShowRename] = React.useState(false);
  const origin = React.useSyncExternalStore(
    React.useCallback(() => () => {}, []),
    () => window.location.origin,
    () => process.env.NEXT_PUBLIC_APP_URL || "https://proj-upgrade.emergent.host"
  );
  const cleanMode = usePreviewStore((s) => s.cleanMode);
  const openAgent = useProjectAgentUiStore((s) => s.setOpen);

  const shareUrl = `${origin}/app/projects/${projectId}/review`;
  const shareText = project?.name
    ? `Lihat project *${project.name}* di Baruma:`
    : "Lihat project ini di Baruma:";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Tautan disalin.");
    } catch {
      toast.error("Gagal menyalin tautan.");
    }
  };

  const shareWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const shareEmail = () => {
    const subject = project?.name
      ? `Project ${project.name} di Baruma`
      : "Project di Baruma";
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${shareText}\n\n${shareUrl}`)}`;
    window.location.href = url;
  };

  const openLink = () => {
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      track("share_clicked", { project_id: projectId });
    }
  };

  // Mode bersih (preview 3D): header disembunyikan — keluar via tombol
  // mode bersih di ViewToolbar atau tekan Escape. Banner konflik tetap
  // dirender: kehilangan data tidak boleh tersembunyi di mode apa pun.
  if (cleanMode) return <LayoutConflictBanner projectId={projectId} />;

  return (
    <>
    <LayoutConflictBanner projectId={projectId} />
    <div className="flex flex-col gap-3 border-b px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Kembali">
          <Link href="/app/projects">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0">
          {isLoading || !project ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {project.name}
              </h1>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Ganti nama project"
                onClick={() => setShowRename(true)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <ReadinessBadge status={project.readiness} size="sm" />
            </div>
          )}
          <HeaderSaveStatus />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => openAgent(true)}>
          <Sparkles />
          AI Agent
        </Button>
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Share2 />
              Bagikan
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Bagikan project</DialogTitle>
              <DialogDescription>
                Tautan di bawah mengarah ke halaman review project. Penerima
                perlu login untuk melihat detail lengkap.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input readOnly value={shareUrl} className="font-mono text-xs" />
              <Button
                size="icon"
                variant="outline"
                onClick={copy}
                aria-label="Salin tautan"
              >
                <Copy />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={shareWhatsApp}
                aria-label="Bagikan via WhatsApp"
              >
                <MessageCircle className="size-4" />
                WhatsApp
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={shareEmail}
                aria-label="Bagikan via Email"
              >
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
                aria-label="Buka pratinjau tautan"
              >
                Buka pratinjau tautan
              </Button>
              <p className="text-xs text-muted-foreground">
                Tautan di atas mengarah ke halaman review dalam aplikasi.
                Bagikan publik anonim masih dalam pengembangan.
              </p>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Button
          size="sm"
          onClick={() => toast.info("Export tersedia di milestone berikutnya.")}
        >
          <Download />
          Export
        </Button>
      </div>
    </div>
    {project && (
      <RenameProjectDialog
        projectId={projectId}
        currentName={project.name}
        open={showRename}
        onOpenChange={setShowRename}
      />
    )}
    </>
  );
}
