"use client";

/**
 * Pengganti `window.confirm` — dialog konfirmasi terkontrol berbasis
 * `AlertDialog` yang sudah ada. `window.confirm/alert` dilarang di editor
 * (blocking, tidak bisa di-style, tidak accessible secara konsisten lintas
 * browser); `useConfirm()` memberi API async yang setara ("tunggu jawaban
 * user") tanpa memblokir main thread.
 *
 * Satu `ConfirmDialogProvider` dipasang secara global (dekat `Toaster` /
 * `TooltipProvider`) merender SATU `AlertDialog` yang dipakai bergantian
 * oleh seluruh app — permintaan berikutnya menunggu promise sebelumnya
 * selesai (tak ada antrean dialog bertumpuk).
 */

import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Aksi destruktif (mis. hapus) → tombol konfirmasi bergaya destructive. */
  destructive?: boolean;
};

type PendingConfirm = ConfirmOptions & {
  resolve: (confirmed: boolean) => void;
};

type ConfirmContextValue = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmContextValue | null>(null);

/** Hook konsumen: `const confirm = useConfirm(); const ok = await confirm({...})`. */
export function useConfirm(): ConfirmContextValue {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm() harus dipakai di dalam <ConfirmDialogProvider>");
  }
  return ctx;
}

export function ConfirmDialogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);

  const confirm = React.useCallback<ConfirmContextValue>((opts) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const settle = React.useCallback(
    (confirmed: boolean) => {
      setPending((current) => {
        current?.resolve(confirmed);
        return null;
      });
    },
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          // Ditutup lewat Escape / klik overlay — hitung sebagai batal.
          if (!open) settle(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            {pending?.description && (
              <AlertDialogDescription>
                {pending.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {pending?.cancelLabel ?? "Batal"}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.destructive ? "destructive" : "default"}
              onClick={() => settle(true)}
            >
              {pending?.confirmLabel ?? "Lanjutkan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
