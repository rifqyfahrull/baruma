import type { Metadata } from "next"

import { FaucetCheckClient } from "@/components/faucet-check/faucet-check-client"

export const metadata: Metadata = {
  title: "Faucet Asset Workflow Check",
  description:
    "Tester OpenAI-compatible dan preflight workflow asset research, ingestion, license gate, dan catalog DB.",
}

export default function FaucetCheckPage() {
  return <FaucetCheckClient />
}
