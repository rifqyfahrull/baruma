import Link from "next/link"
import { Home, LinkIcon } from "lucide-react"

import { Logo } from "@/components/shared/logo"
import { Button } from "@/components/ui/button"

/** Friendly 404 for an unknown/revoked share token — never leaks whether the
 *  token used to be valid (see getSharedProjectByToken's doc comment). */
export default function ShareNotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div className="space-y-2">
        <LinkIcon className="mx-auto size-8 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Tautan tidak ditemukan</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Tautan ini tidak berlaku lagi — mungkin sudah dinonaktifkan oleh pemiliknya, atau alamatnya salah ketik.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">
          <Home /> Ke beranda Baruma
        </Link>
      </Button>
    </div>
  )
}
