import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CreateProjectWizard } from "@/components/wizard/create-project-wizard"

export default function NewProjectPage() {
  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6 lg:p-8">
      <div className="mb-6 space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/app/dashboard">
            <ArrowLeft />
            Dashboard
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Buat project baru
          </h1>
          <p className="text-sm text-muted-foreground">
            Jawab beberapa pertanyaan sederhana — kami ubah jadi brief desain
            terstruktur.
          </p>
        </div>
      </div>

      <CreateProjectWizard />
    </div>
  )
}
