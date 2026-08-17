"use client";

import * as React from "react";
import { toast } from "sonner";

import { useRenameProject } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Dialog ganti nama project — dipakai dari daftar project (ProjectCard) dan
 * dari header workspace editor, keduanya lewat useRenameProject yang sama.
 *
 * Isi form (RenameProjectForm) hanya dirender saat `open`, sehingga tiap kali
 * dialog dibuka ia mount baru dan `useState(currentName)` otomatis reset —
 * tidak perlu effect untuk menyinkronkan input ke prop.
 */
export function RenameProjectDialog({
  projectId,
  currentName,
  open,
  onOpenChange,
}: {
  projectId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ganti nama project</DialogTitle>
          <DialogDescription>
            Nama baru langsung terlihat di daftar project dan halaman ini.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <RenameProjectForm
            projectId={projectId}
            currentName={currentName}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameProjectForm({
  projectId,
  currentName,
  onClose,
}: {
  projectId: string;
  currentName: string;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(currentName);
  const renameMutation = useRenameProject();

  const trimmed = name.trim();
  const invalid = trimmed.length < 2;
  const unchanged = trimmed === currentName.trim();

  const handleSave = () => {
    if (invalid || unchanged || renameMutation.isPending) return;
    renameMutation.mutate(
      { projectId, name: trimmed },
      {
        onSuccess: () => {
          toast.success("Nama project diperbarui.");
          onClose();
        },
        onError: () => {
          toast.error("Gagal mengganti nama project.");
        },
      }
    );
  };

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="rename-project-input">Nama project</Label>
        <Input
          id="rename-project-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSave();
            }
          }}
          autoFocus
          maxLength={120}
        />
        {invalid && (
          <p className="text-xs text-destructive">
            Nama project minimal 2 karakter.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button
          onClick={handleSave}
          disabled={invalid || unchanged || renameMutation.isPending}
        >
          {renameMutation.isPending ? "Menyimpan…" : "Simpan"}
        </Button>
      </DialogFooter>
    </>
  );
}
