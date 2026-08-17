"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  useAdjustUserCredits,
  useAdminUsers,
  useCreatePhantomLogin,
  useUpdateUserPlan,
  useUpdateUserRole,
} from "@/lib/api/hooks"
import type { AdminUserRow } from "@/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Ghost } from "lucide-react"

export function UsersTable() {
  const { data: users, isLoading } = useAdminUsers()
  const updateRole = useUpdateUserRole()
  const updatePlan = useUpdateUserPlan()
  const createPhantomLogin = useCreatePhantomLogin()
  const [creditsFor, setCreditsFor] = React.useState<AdminUserRow | null>(null)

  function handleRoleChange(user: AdminUserRow, role: string) {
    updateRole.mutate(
      { profileId: user.id, role: role as "user" | "admin" },
      { onError: () => toast.error("Gagal mengubah role.") }
    )
  }

  function handlePlanChange(user: AdminUserRow, plan: string) {
    updatePlan.mutate(
      { profileId: user.id, plan },
      { onError: () => toast.error("Gagal mengubah plan.") }
    )
  }

  async function handlePhantomLogin(user: AdminUserRow) {
    const phantomTab = window.open("about:blank", "_blank")
    if (!phantomTab) {
      toast.error("Browser memblokir tab baru. Izinkan pop-up untuk membuka phantom login.")
      return
    }
    try {
      phantomTab.opener = null
      phantomTab.document.title = "Membuka Phantom Login..."
      phantomTab.document.body.innerHTML =
        "<p style=\"font-family: system-ui; padding: 24px;\">Menyiapkan phantom login...</p>"
      const { url } = await createPhantomLogin.mutateAsync(user.id)
      phantomTab.location.replace(url)
      toast.success(`Phantom login dibuka sebagai ${user.name}.`)
    } catch {
      phantomTab.close()
      toast.error("Gagal membuka phantom login.")
    }
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nama</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Kredit</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={6}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            ))
          ) : !users || users.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-muted-foreground"
              >
                Belum ada pengguna.
              </TableCell>
            </TableRow>
          ) : (
            users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Select
                    value={user.plan}
                    onValueChange={(v) => handlePlanChange(user, v)}
                  >
                    <SelectTrigger aria-label={`Ubah plan untuk ${user.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="studio">Studio</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={user.role}
                    onValueChange={(v) => handleRoleChange(user, v)}
                  >
                    <SelectTrigger aria-label={`Ubah role untuk ${user.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {user.creditsUsed}/{user.creditsTotal}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      aria-label={`Phantom login sebagai ${user.name}`}
                      disabled={createPhantomLogin.isPending}
                      onClick={() => void handlePhantomLogin(user)}
                    >
                      <Ghost className="size-4" />
                      Phantom
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Sesuaikan kredit untuk ${user.name}`}
                      onClick={() => setCreditsFor(user)}
                    >
                      Sesuaikan kredit
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <AdjustCreditsDialog
        user={creditsFor}
        open={creditsFor !== null}
        onOpenChange={(open) => !open && setCreditsFor(null)}
      />
    </div>
  )
}

function AdjustCreditsDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const adjustCredits = useAdjustUserCredits()
  const [delta, setDelta] = React.useState(0)
  const [reason, setReason] = React.useState("")

  React.useEffect(() => {
    if (!user) return
    const timer = setTimeout(() => {
      setDelta(0)
      setReason("")
    }, 0)
    return () => clearTimeout(timer)
  }, [user])

  if (!user) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !reason.trim()) return
    try {
      await adjustCredits.mutateAsync({
        profileId: user.id,
        deltaTotal: delta,
        reason: reason.trim(),
      })
      toast.success(`Kredit ${user.name} disesuaikan.`)
      onOpenChange(false)
    } catch {
      toast.error("Gagal menyesuaikan kredit.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Sesuaikan kredit — {user.name}</DialogTitle>
            <DialogDescription>
              Kredit saat ini: {user.creditsUsed}/{user.creditsTotal}. Nilai
              boleh negatif untuk mengurangi.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="credit-delta">Perubahan jumlah kredit</Label>
            <Input
              id="credit-delta"
              type="number"
              aria-label="Perubahan jumlah kredit (boleh negatif)"
              value={delta}
              onChange={(e) => setDelta(Number(e.target.value))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="credit-reason">Alasan</Label>
            <Input
              id="credit-reason"
              aria-label="Alasan penyesuaian kredit"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={adjustCredits.isPending || !reason.trim()}
            >
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
