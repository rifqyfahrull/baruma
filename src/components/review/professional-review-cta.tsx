"use client"

import { BadgeCheck, Loader2, UserCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function ProfessionalReviewCTA({
  onRequest,
  onMark,
  requesting,
}: {
  onRequest: () => void
  onMark: () => void
  requesting?: boolean
}) {
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCheck className="size-4 text-primary" />
          Butuh kepastian?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Hubungkan dengan arsitek/engineer untuk meninjau desain sebelum dibangun.
        </p>
        <Button className="w-full" onClick={onRequest} disabled={requesting}>
          {requesting ? <Loader2 className="animate-spin" /> : <UserCheck />}
          Minta review profesional
        </Button>
        <Button variant="outline" className="w-full" onClick={onMark}>
          <BadgeCheck />
          Tandai sudah saya tinjau
        </Button>
      </CardContent>
    </Card>
  )
}
