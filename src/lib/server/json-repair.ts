export function repairAndExtractJson(raw: string): unknown {
  let repaired = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();
  if (repaired.startsWith("```")) {
    repaired = repaired.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  const start = repaired.indexOf("{");
  if (start < 0) return null;
  repaired = repaired.slice(start);

  // If ends with a trailing comma, strip it
  repaired = repaired.replace(/,\s*$/, "");

  // If string ended inside a quote, close the quote
  let inString = false;
  let escaped = false;
  let openBraces = 0;
  let openBrackets = 0;

  for (let i = 0; i < repaired.length; i++) {
    const c = repaired[i];
    if (inString) {
      if (c === "\\" && !escaped) {
        escaped = true;
      } else {
        if (c === '"' && !escaped) inString = false;
        escaped = false;
      }
    } else {
      if (c === '"') inString = true;
      else if (c === "{") openBraces++;
      else if (c === "}") openBraces = Math.max(0, openBraces - 1);
      else if (c === "[") openBrackets++;
      else if (c === "]") openBrackets = Math.max(0, openBrackets - 1);
    }
  }

  if (inString) {
    repaired += '"';
  }

  // Remove trailing partial keys/properties like `,"patch": {"x": 1.4, "de"`
  repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*([^,}\]]*)$/, "");
  repaired = repaired.replace(/,\s*"[^"]*"$/, "");

  // Recalculate brackets/braces after cleaning
  openBraces = 0;
  openBrackets = 0;
  inString = false;
  escaped = false;

  for (let i = 0; i < repaired.length; i++) {
    const c = repaired[i];
    if (inString) {
      if (c === "\\" && !escaped) {
        escaped = true;
      } else {
        if (c === '"' && !escaped) inString = false;
        escaped = false;
      }
    } else {
      if (c === '"') inString = true;
      else if (c === "{") openBraces++;
      else if (c === "}") openBraces = Math.max(0, openBraces - 1);
      else if (c === "[") openBrackets++;
      else if (c === "]") openBrackets = Math.max(0, openBrackets - 1);
    }
  }

  while (openBrackets > 0) {
    repaired += "]";
    openBrackets--;
  }
  while (openBraces > 0) {
    repaired += "}";
    openBraces--;
  }

  try {
    return JSON.parse(repaired);
  } catch {
    const replyMatch = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const reply = replyMatch ? replyMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : undefined;

    if (reply) {
      return { reply, actions: [] };
    }
    return null;
  }
}
