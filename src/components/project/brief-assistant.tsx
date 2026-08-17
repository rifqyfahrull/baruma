"use client"

import { Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useProjectAgentUiStore } from "@/stores/project-agent-ui-store"

const PROMPTS = [
  "Buat versi lebih hemat",
  "Apakah kolam realistis di tanah ini?",
  "Tambah musholla kecil",
]

/** Brief entry point for the project-level unified Agent. */
export function BriefAssistant({ projectId }: { projectId: string }) {
  const injectDraft = useProjectAgentUiStore((state) => state.injectDraft)

  return (
    <Card data-project-id={projectId}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-info" aria-hidden /> AI Agent
        </CardTitle>
        <CardDescription>
          Percakapan Brief, Denah, dan Interior sekarang berada dalam satu thread proyek.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {PROMPTS.map((prompt) => (
          <Button
            key={prompt}
            variant="outline"
            size="sm"
            className="h-auto w-full justify-start text-left"
            onClick={() => injectDraft(prompt, "brief")}
          >
            {prompt}
          </Button>
        ))}
        <Button className="w-full" onClick={() => injectDraft("", "brief")}>
          <Sparkles /> Buka AI Agent
        </Button>
      </CardContent>
    </Card>
  )
}
