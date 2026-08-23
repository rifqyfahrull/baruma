export interface ClarificationStep {
  index: number
  title: string
  question: string
  options: string[]
}

function cleanMarkdown(text: string): string {
  return text.replace(/\*\*/g, "").replace(/`/g, "").trim()
}

export function extractOptionsForPoint(title: string, question: string): string[] {
  const options: string[] = []

  // Check for "misalnya X, Y, Z, atau W" pattern
  const egMatch = question.match(/(?:misalnya|contoh|seperti|opsi|pilihan)[:\s]+([^\.\?\!\n]+)/i)
  if (egMatch && egMatch[1]) {
    const rawOptions = egMatch[1]
      .split(/,|\batau\b|\batau lainnya\b/i)
      .map((s) => cleanMarkdown(s))
      .filter((s) => s.length >= 2 && s.length <= 35 && !s.toLowerCase().includes("lainnya"))

    for (const opt of rawOptions) {
      if (opt && !options.includes(opt)) {
        options.push(opt)
      }
    }
  }

  // Common architectural fallbacks if empty based on title keywords
  const titleLower = title.toLowerCase()
  const questionLower = question.toLowerCase()

  if (options.length === 0) {
    if (titleLower.includes("gaya") || questionLower.includes("gaya")) {
      options.push("Minimalis", "Industrial", "Klasik", "Tropis Modern", "Japandi")
    } else if (titleLower.includes("lantai") || questionLower.includes("lantai")) {
      options.push("1 Lantai", "2 Lantai", "3 Lantai")
    } else if (titleLower.includes("kebutuhan") || titleLower.includes("ruang") || questionLower.includes("ruang")) {
      options.push("3 Kamar, 2 Kamar Mandi, Dapur", "4 Kamar, Ruang Kerja & Dapur", "2 Kamar, Ruang Tamu & Carport")
    } else if (titleLower.includes("prioritas") || questionLower.includes("prioritas")) {
      options.push("Pencahayaan alami", "Sirkulasi udara", "Efisiensi biaya", "Fungsionalitas maksimal")
    } else if (titleLower.includes("batasan") || questionLower.includes("anggaran") || questionLower.includes("tanah")) {
      options.push("Hemat Biaya", "Luas Lahan Terbatas", "Sesuai Standar Daerah")
    }
  }

  return options.slice(0, 5)
}

export function parseClarificationSteps(
  content: string,
  needsClarify?: Array<{ question: string; suggestions: string[] }>
): ClarificationStep[] {
  if (needsClarify && needsClarify.length > 0) {
    return needsClarify.map((item, idx) => ({
      index: idx + 1,
      title: item.question,
      question: item.question,
      options: item.suggestions,
    }))
  }

  if (!content) return []
  const trimmedContent = content.trim()
  if (trimmedContent.startsWith("{") && trimmedContent.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmedContent)
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.needs_clarify) && parsed.needs_clarify.length > 0) {
        return parsed.needs_clarify.map((item: { question?: unknown; suggestions?: unknown }, idx: number) => {
          const question =
            typeof item.question === "string" && item.question.trim().length > 0
              ? item.question
              : `Poin ${idx + 1}`
          const options = Array.isArray(item.suggestions)
            ? item.suggestions.filter((s: unknown): s is string => typeof s === "string")
            : []
          return { index: idx + 1, title: question, question, options }
        })
      }
    } catch {
      /* ignore */
    }
  }

  const steps: ClarificationStep[] = []
  const lines = content.split("\n")

  for (const line of lines) {
    const trimmed = line.trim()
    const match = trimmed.match(/^(\d+)\.\s+(\*\*([^*]+)\*\*|([^\-\–\:\?]+))[\s\-\–\:]*(.*)$/)
    if (match) {
      const idx = parseInt(match[1], 10)
      const rawTitle = match[3] || match[4] || `Poin ${idx}`
      const title = cleanMarkdown(rawTitle)
      const restQuestion = match[5] || ""
      const fullQuestion = cleanMarkdown(trimmed.replace(/^\d+\.\s+/, ""))
      const options = extractOptionsForPoint(title, fullQuestion || restQuestion)

      steps.push({
        index: idx,
        title,
        question: fullQuestion || title,
        options,
      })
    }
  }

  return steps
}
