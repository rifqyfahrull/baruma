"use client";

import * as React from "react";
import { Loader2, RefreshCw, Copy, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { data } from "@/lib/data";
import { briefToFormValues } from "@/lib/brief/brief-to-form";
import { useEditorStore } from "@/stores/editor-store";
import { useSaveStatusStore } from "@/stores/save-status-store";
import { Button } from "@/components/ui/button";

/**
 * Banner konflik autosave (HTTP 409, revision guard): tab/perangkat lain sudah
 * menyimpan revision lebih baru, autosave halaman ini berhenti. Sesuai roadmap
 * eksterior P0.3, user memilih secara eksplisit — tidak ada auto-merge diam:
 *
 * - "Muat ulang": ambil versi terbaru dari server; edit lokal yang belum
 *   tersimpan hilang.
 * - "Simpan sebagai salinan": edit lokal ditulis ke project duplikat baru
 *   (brief disalin), lalu navigasi ke editor project tersebut.
 */
export function LayoutConflictBanner({ projectId }: { projectId: string }) {
  const status = useSaveStatusStore((s) => s.status);
  const [busy, setBusy] = React.useState(false);

  if (status !== "conflict") return null;

  const reload = () => {
    window.location.reload();
  };

  const saveAsCopy = async () => {
    const layout = useEditorStore.getState().layout;
    if (!layout) return;
    setBusy(true);
    try {
      const [project, brief] = await Promise.all([
        data.getProject(projectId),
        data.getBrief(projectId),
      ]);
      if (!project || !brief) {
        throw new Error("Project atau brief tidak ditemukan.");
      }
      const created = await data.createProject({
        ...briefToFormValues(brief, project),
        name: `${project.name} (Salinan)`,
      });
      // GET dulu supaya row layout project baru dibuat (lazy) dan kita dapat
      // revision awalnya, lalu timpa dengan edit lokal via revision guard.
      const doc = await data.getLayoutDocument(created.project.id);
      if (!doc) {
        throw new Error("Layout project salinan tidak tersedia.");
      }
      await data.saveLayout(created.project.id, {
        layout: {
          ...layout,
          id: doc.layout.id,
          projectId: doc.layout.projectId,
          versionId: doc.layout.versionId,
        },
        expectedRevision: doc.revision,
      });
      toast.success("Perubahan tersimpan sebagai project salinan.");
      // Hard navigation: editor store & react-query cache masih memegang
      // state project lama — muat halaman project salinan dari bersih.
      window.location.assign(`/app/projects/${created.project.id}/editor`);
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : "Gagal menyimpan salinan. Coba lagi atau muat ulang."
      );
      setBusy(false);
    }
  };

  return (
    <div
      role="alert"
      data-testid="layout-conflict-banner"
      className="flex flex-col gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"
    >
      <div className="flex items-start gap-2 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <p className="font-medium text-destructive">
            Konflik penyimpanan: project ini sudah diubah dari tab atau
            perangkat lain.
          </p>
          <p className="text-xs text-muted-foreground">
            Penyimpanan otomatis dihentikan agar perubahan lain tidak
            tertimpa. Pilih salah satu untuk melanjutkan.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={reload} disabled={busy}>
          <RefreshCw />
          Muat ulang
        </Button>
        <Button size="sm" onClick={saveAsCopy} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Copy />}
          Simpan sebagai salinan
        </Button>
      </div>
    </div>
  );
}
