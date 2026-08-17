# Baruma → agent-lab Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Baruma's two prose advisory `chatText` call-sites through the central agent-lab service (Pattern B / context_blocks) WITHOUT making the agent dumber than today — which requires first adding DeepSeek thinking-mode passthrough (+ empty-content retry) to agent-lab.

**Architecture:** Part A extends agent-lab (repo `tampil.dev`, branch `feat/agent-lab-f1`) with an optional `thinking` LLM config that passes through to DeepSeek and retries once with thinking off on empty content (mirroring Baruma's proven `llm.ts` safety). Part B adds a resilient `agent-lab.ts` client to Baruma (repo `Baruma`, branch `feat/agent-lab-integration`) that returns `null` on any failure so the existing deterministic fallback + credit-refund logic is preserved, then swaps the two `chatText` calls for it. Ends with a real A/B parity gate proving no quality regression.

**Tech Stack:** agent-lab = Python 3.12 / FastAPI / pydantic / httpx / pytest / respx. Baruma = Next.js (App Router) / TypeScript / Zod / vitest.

## Global Constraints

- **Bar "tidak lebih bodoh"** (spec §0): the migrated advisory path must equal or beat today's quality. Baseline = `deepseek-v4-flash`, `temperature 0.4`, DeepSeek **thinking enabled**, with automatic one-shot retry-with-thinking-off on empty content.
- **Resilience contract** (spec §3, §8): `askAgentLab` NEVER throws and returns `null` on every failure (missing key, non-2xx, timeout, bad JSON, `mode != "answer"`). The existing refund + FALLBACK branches must remain byte-for-byte intact.
- **Out of scope, do not touch:** `enrich-alternatives.ts` (`chatJSON`), the `chatJSON` action extraction in `agent/route.ts`, `chatWithTools`, and all of santrenize.
- **Pattern B limits** (agent-lab): `context_blocks` ≤ 8 blocks AND total `len(title)+len(content)` ≤ 24000 chars; the client must trim defensively BEFORE sending (never 422 on overflow).
- **DeepSeek thinking is DeepSeek-only**: `LLMConfig.thinking` is valid only for provider `deepseek` or `custom` whose `base_url` contains `deepseek.com`; otherwise 422.
- **No secrets in logs/transcript.** API keys handled via env only; `agent-lab.ts` logs status/slug/latency, never prompt/answer/PII.
- **agent-lab tests hit the real test DB** where DB-backed (standing project rule); pure-logic tests use respx.

## File Map

**Part A — agent-lab (repo `d:/Ngoding/expr/VibeCoding.id/tampil.dev`, branch `feat/agent-lab-f1`):**
- Modify: `agent-lab/app/models.py` — add `LLMConfig.thinking` + deepseek-only validator.
- Modify: `agent-lab/app/upstreams.py` — `llm_chat(..., thinking=None)` passthrough + empty-content retry.
- Modify: `agent-lab/app/pipeline.py` — pass `llm_cfg.thinking` into `llm_chat`.
- Modify: `agent-lab/tests/test_models.py`, `tests/test_upstreams.py`, `tests/test_pipeline.py`.

**Part B — Baruma (repo `d:/Ngoding/expr/VibeCoding.id/Baruma`, branch `feat/agent-lab-integration`):**
- Create: `src/lib/server/agent-lab.ts` — resilient client.
- Create: `src/lib/server/agent-lab.test.ts`.
- Create: `src/lib/server/brief-assistant-context.ts` — `buildAssistantContextBlocks`.
- Create: `src/lib/server/brief-assistant-context.test.ts`.
- Modify: `src/app/api/v1/projects/[id]/brief/assistant/route.ts` — swap `chatText` → `askAgentLab`.
- Modify: `src/app/api/v1/projects/[id]/brief/assistant/route.test.ts`.
- Modify: `src/app/api/v1/projects/[id]/agent/route.ts` — swap the brief-chat `chatText` → `askAgentLab`.
- Modify: `src/app/api/v1/projects/[id]/agent/route.test.ts`.
- Modify: `.env.example` — add `AGENT_LAB_URL`, `AGENT_LAB_KEY`.

---

## PART A — agent-lab thinking-mode enhancement

### Task A1: `LLMConfig.thinking` + deepseek-only validator

**Files:**
- Modify: `agent-lab/app/models.py` (the `LLMConfig` class)
- Test: `agent-lab/tests/test_models.py` (add to `class TestLLMConfig`)

**Interfaces:**
- Produces: `LLMConfig` gains `thinking: Literal["enabled","disabled"] | None = None` and a helper `_is_deepseek() -> bool`. Consumed by Task A3 (`llm_cfg.thinking`).

- [ ] **Step 1: Failing tests** — append to `agent-lab/tests/test_models.py` inside `class TestLLMConfig`:

```python
    def test_thinking_allowed_for_deepseek(self):
        c = LLMConfig(provider="deepseek", model="deepseek-v4-flash", thinking="enabled")
        assert c.thinking == "enabled"

    def test_thinking_allowed_for_custom_deepseek(self):
        c = LLMConfig(provider="custom", model="m",
                      base_url="https://api.deepseek.com", thinking="disabled")
        assert c.thinking == "disabled"

    def test_thinking_rejected_for_non_deepseek(self):
        with pytest.raises(ValidationError, match="thinking"):
            LLMConfig(provider="openrouter", model="m", thinking="enabled")

    def test_thinking_defaults_none(self):
        assert LLMConfig(provider="deepseek", model="m").thinking is None
```

- [ ] **Step 2: Run → FAIL** — `cd agent-lab && .venv/Scripts/python.exe -m pytest tests/test_models.py -q` (AttributeError/ValidationError mismatch).

- [ ] **Step 3: Modify `agent-lab/app/models.py`** — the `LLMConfig` class. Add the field after `max_tokens`, extend the validator, add the helper:

```python
class LLMConfig(BaseModel):
    provider: Literal["deepseek", "openrouter", "custom"]
    base_url: str | None = None
    model: str
    temperature: float = Field(0.3, ge=0, le=2)
    max_tokens: int = Field(2048, ge=1, le=32000)
    thinking: Literal["enabled", "disabled"] | None = None

    @model_validator(mode="after")
    def _base_url_rules(self):
        if self.provider == "custom" and not self.base_url:
            raise ValueError("provider 'custom' wajib menyertakan base_url")
        if self.provider != "custom" and self.base_url:
            raise ValueError("base_url hanya untuk provider 'custom'")
        if self.thinking is not None and not self._is_deepseek():
            raise ValueError("thinking hanya untuk provider deepseek "
                             "(atau custom dengan base_url deepseek.com)")
        return self

    def _is_deepseek(self) -> bool:
        return self.provider == "deepseek" or (
            self.provider == "custom"
            and "deepseek.com" in (self.base_url or "").lower())

    @property
    def resolved_base_url(self) -> str:
        return self.base_url or _PROVIDER_BASE[self.provider]
```

- [ ] **Step 4: Run → PASS** — `cd agent-lab && .venv/Scripts/python.exe -m pytest tests/test_models.py -q` (expect all green, prior LLMConfig tests still pass).

- [ ] **Step 5: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/tampil.dev"
git add agent-lab/app/models.py agent-lab/tests/test_models.py
git commit -m "feat(agent-lab): LLMConfig.thinking (deepseek-only) for reasoning parity"
```

---

### Task A2: `llm_chat` thinking passthrough + empty-content retry

**Files:**
- Modify: `agent-lab/app/upstreams.py` (the `llm_chat` function)
- Test: `agent-lab/tests/test_upstreams.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `llm_chat(client, base_url, api_key, model, messages, temperature, max_tokens, thinking: str | None = None) -> dict`. On a 2xx-but-empty-content response with `thinking == "enabled"`, retries ONCE with `thinking="disabled"`; if still empty (or thinking was off/None), raises `UpstreamError("llm", ...)`. Consumed by Task A3.

- [ ] **Step 1: Failing tests** — append to `agent-lab/tests/test_upstreams.py`:

```python
@respx.mock
async def test_llm_passes_thinking_field(client):
    route = respx.post(f"{LLM}/chat/completions").respond(200, json={
        "choices": [{"message": {"content": "ya"}}], "usage": {}})
    await llm_chat(client, LLM, "sk", "deepseek-v4-flash",
                   [{"role": "user", "content": "hi"}], 0.4, 100, thinking="enabled")
    import json as _json
    sent = _json.loads(route.calls[0].request.content)
    assert sent["thinking"] == {"type": "enabled"}


@respx.mock
async def test_llm_empty_content_retries_with_thinking_off(client):
    route = respx.post(f"{LLM}/chat/completions")
    route.side_effect = [
        httpx.Response(200, json={"choices": [{"message": {"content": ""}}],
                                  "usage": {}}),
        httpx.Response(200, json={"choices": [{"message": {"content": "jawab"}}],
                                  "usage": {"prompt_tokens": 3, "completion_tokens": 2}}),
    ]
    out = await llm_chat(client, LLM, "sk", "deepseek-v4-flash",
                         [{"role": "user", "content": "hi"}], 0.4, 100, thinking="enabled")
    assert out["content"] == "jawab"
    assert route.call_count == 2
    import json as _json
    second = _json.loads(route.calls[1].request.content)
    assert second["thinking"] == {"type": "disabled"}


@respx.mock
async def test_llm_empty_content_no_thinking_raises(client):
    respx.post(f"{LLM}/chat/completions").respond(200, json={
        "choices": [{"message": {"content": "   "}}], "usage": {}})
    with pytest.raises(UpstreamError) as e:
        await llm_chat(client, LLM, "sk", "m",
                       [{"role": "user", "content": "hi"}], 0.4, 100)
    assert e.value.kind == "llm"
```

- [ ] **Step 2: Run → FAIL** — `cd agent-lab && .venv/Scripts/python.exe -m pytest tests/test_upstreams.py -q`.

- [ ] **Step 3: Replace `llm_chat` in `agent-lab/app/upstreams.py`** with:

```python
async def llm_chat(client: httpx.AsyncClient, base_url: str, api_key: str, model: str,
                   messages: list[dict], temperature: float, max_tokens: int,
                   thinking: str | None = None) -> dict:
    async def _once(think: str | None) -> dict | None:
        """One 3-attempt (5xx/network-retry) run. Returns the parsed dict, or
        None when the 2xx response had empty content (thinking may have spent
        the whole token budget on hidden reasoning — see Baruma llm.ts)."""
        payload: dict = {"model": model, "messages": messages,
                         "temperature": temperature, "max_tokens": max_tokens}
        if think is not None:
            payload["thinking"] = {"type": think}
        headers = {"Authorization": f"Bearer {api_key}"}
        last = "unknown"
        for attempt in range(3):
            try:
                r = await client.post(f"{base_url.rstrip('/')}/chat/completions",
                                      json=payload, headers=headers)
                if r.status_code >= 500:
                    last = f"HTTP {r.status_code}"
                elif r.status_code >= 400:
                    raise UpstreamError("llm", f"HTTP {r.status_code}: {r.text[:200]}")
                else:
                    j = r.json()
                    usage = j.get("usage") or {}
                    content = j["choices"][0]["message"]["content"] or ""
                    if not content.strip():
                        return None
                    return {"content": content,
                            "prompt_tokens": usage.get("prompt_tokens"),
                            "completion_tokens": usage.get("completion_tokens")}
            except UpstreamError:
                raise
            except Exception as e:  # noqa: BLE001 — timeout/network → retryable
                last = str(e)
            if attempt < 2:
                await asyncio.sleep(0.5 * (attempt + 1))
        raise UpstreamError("llm", f"gagal setelah retry: {last}")

    out = await _once(thinking)
    if out is not None:
        return out
    # Empty content. If thinking was ON, retry ONCE forced off (mirror Baruma's
    # chatText safety). Otherwise empty content is a genuine failure.
    if thinking == "enabled":
        retry = await _once("disabled")
        if retry is not None:
            return retry
    raise UpstreamError("llm", "empty content dari LLM (thinking mungkin menghabiskan token budget)")
```

- [ ] **Step 4: Run → PASS** — `cd agent-lab && .venv/Scripts/python.exe -m pytest tests/test_upstreams.py -q` (expect all green; the pre-existing retry/4xx tests still pass — they use non-empty content).

- [ ] **Step 5: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/tampil.dev"
git add agent-lab/app/upstreams.py agent-lab/tests/test_upstreams.py
git commit -m "feat(agent-lab): llm_chat thinking passthrough + empty-content retry"
```

---

### Task A3: pipeline forwards `thinking`

**Files:**
- Modify: `agent-lab/app/pipeline.py` (the `upstreams.llm_chat(...)` call in `run_ask`)
- Test: `agent-lab/tests/test_pipeline.py`

**Interfaces:**
- Consumes: `LLMConfig.thinking` (A1), `llm_chat(..., thinking=)` (A2).
- Produces: pipeline passes the agent's configured `thinking` to the LLM.

- [ ] **Step 1: Failing test** — append to `agent-lab/tests/test_pipeline.py`:

```python
class TestThinkingPassthrough:
    @respx.mock
    async def test_thinking_flows_from_config_to_llm(self, fake_repo):
        respx.post("https://api.deepseek.com/chat/completions").respond(200, json={
            "choices": [{"message": {"content": "Jawaban."}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 3}})
        agent = _agent("none")
        agent["llm_config"] = {"provider": "deepseek", "model": "deepseek-v4-flash",
                               "temperature": 0.4, "max_tokens": 512, "thinking": "enabled"}
        async with httpx.AsyncClient() as http:
            out = await run_ask(FakePool(), http, SET, agent, KEY,
                                AskRequest(user_id="u", text="halo"), "sk")
        assert out.mode == "answer"
        import json as _json
        body = _json.loads(respx.calls[0].request.content)
        assert body["thinking"] == {"type": "enabled"}
```

- [ ] **Step 2: Run → FAIL** — `cd agent-lab && .venv/Scripts/python.exe -m pytest tests/test_pipeline.py::TestThinkingPassthrough -q` (body has no `thinking` key).

- [ ] **Step 3: Modify `agent-lab/app/pipeline.py`** — find the `llm_out = await upstreams.llm_chat(...)` call in `run_ask` and add the `thinking` argument:

```python
    try:
        llm_out = await upstreams.llm_chat(
            http, llm_cfg.resolved_base_url, llm_api_key, llm_cfg.model,
            messages, llm_cfg.temperature, llm_cfg.max_tokens,
            thinking=llm_cfg.thinking)
    except upstreams.UpstreamError:
        await _fail(502, "llm_unavailable", "LLM upstream gagal setelah retry")
```

- [ ] **Step 4: Run → PASS + full suite** — `cd agent-lab && .venv/Scripts/python.exe -m pytest -q` (expect all pre-existing + new green).

- [ ] **Step 5: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/tampil.dev"
git add agent-lab/app/pipeline.py agent-lab/tests/test_pipeline.py
git commit -m "feat(agent-lab): pipeline forwards configured thinking to llm_chat"
```

---

### Task A4: Deploy agent-lab + verify thinking live (ops)

**Files:** none (operational).

**Interfaces:** Consumes A1-A3. Produces a live agent-lab that honors `thinking`.

- [ ] **Step 1: Ship updated source to droplet** (tar-over-ssh; rsync unavailable on Win):

```bash
cd "d:/Ngoding/expr/VibeCoding.id/tampil.dev/agent-lab"
tar czf - --exclude='.venv' --exclude='__pycache__' --exclude='.pytest_cache' \
  --exclude='.env*' --exclude='.ruff_cache' --exclude='.git' . \
  | ssh tampil-platform 'tar xzf - -C /opt/agent-lab && echo EXTRACT_OK'
```

- [ ] **Step 2: Restart + healthz**

```bash
ssh tampil-platform 'systemctl restart agent-lab && sleep 3 && curl -sf http://127.0.0.1:8100/healthz && echo OK'
```
Expected: `{"db":"ok","qdrant":"ok","embed":"ok","status":"ok"} OK`.

- [ ] **Step 3: Verify thinking is honored live** — set the existing `baruma-demo`/`e2e-smoke-b` (or create a temp) agent's `thinking:"enabled"` via admin API on the droplet, then ask a reasoning-heavy question and confirm a NON-empty answer (retry path works). Record the response. (Concrete admin-API commands mirror Task 13's E2E; the acceptance check is: `mode:answer`, non-empty `answer`.)

- [ ] **Step 4: Note** — no commit (ops). Record "agent-lab redeployed with thinking, verified live" in the progress ledger.

---

## PART B — Baruma integration

### Task B5: `agent-lab.ts` resilient client

**Files:**
- Create: `src/lib/server/agent-lab.ts`
- Test: `src/lib/server/agent-lab.test.ts`

**Interfaces:**
- Produces: `agentLabEnabled(): boolean`; `askAgentLab(slug: string, args: { userId: string; text: string; contextBlocks?: AgentLabContext[] }): Promise<string | null>`; `interface AgentLabContext { title: string; content: string }`. Consumed by B7, B8.

- [ ] **Step 1: Failing tests** — `src/lib/server/agent-lab.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { agentLabEnabled, askAgentLab } from "./agent-lab"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AGENT_LAB_URL = "http://lab.local"
  process.env.AGENT_LAB_KEY = "alk_test"
})
afterEach(() => { delete process.env.AGENT_LAB_KEY; delete process.env.AGENT_LAB_URL })

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("agentLabEnabled", () => {
  it("true when key set, false when not", () => {
    expect(agentLabEnabled()).toBe(true)
    delete process.env.AGENT_LAB_KEY
    expect(agentLabEnabled()).toBe(false)
  })
})

describe("askAgentLab", () => {
  it("returns answer on mode=answer and sends X-API-Key + body", async () => {
    fetchMock.mockResolvedValue(reply({ mode: "answer", answer: "Halo dunia", citations: [], used_context: true }))
    const out = await askAgentLab("baruma-assistant", {
      userId: "u1", text: "apa kabar?", contextBlocks: [{ title: "Brief", content: "x" }],
    })
    expect(out).toBe("Halo dunia")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://lab.local/v1/agents/baruma-assistant/ask")
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("alk_test")
    const sent = JSON.parse(init.body as string)
    expect(sent).toEqual({ user_id: "u1", text: "apa kabar?", context_blocks: [{ title: "Brief", content: "x" }] })
  })

  it("returns null on mode=clarify and mode=refuse", async () => {
    fetchMock.mockResolvedValueOnce(reply({ mode: "clarify", answer: "?", citations: [], used_context: false }))
    expect(await askAgentLab("s", { userId: "u", text: "t" })).toBeNull()
    fetchMock.mockResolvedValueOnce(reply({ mode: "refuse", answer: "no", citations: [], used_context: false }))
    expect(await askAgentLab("s", { userId: "u", text: "t" })).toBeNull()
  })

  it("returns null on HTTP 5xx, bad JSON, and missing key (no fetch)", async () => {
    fetchMock.mockResolvedValueOnce(reply({}, 502))
    expect(await askAgentLab("s", { userId: "u", text: "t" })).toBeNull()
    fetchMock.mockResolvedValueOnce(new Response("not-json", { status: 200 }))
    expect(await askAgentLab("s", { userId: "u", text: "t" })).toBeNull()
    delete process.env.AGENT_LAB_KEY
    fetchMock.mockClear()
    expect(await askAgentLab("s", { userId: "u", text: "t" })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never throws when fetch rejects (timeout/network)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("aborted"))
    expect(await askAgentLab("s", { userId: "u", text: "t" })).toBeNull()
  })

  it("trims to <=8 blocks and <=24000 chars before sending", async () => {
    fetchMock.mockResolvedValue(reply({ mode: "answer", answer: "ok", citations: [], used_context: true }))
    const blocks = Array.from({ length: 12 }, (_, i) => ({ title: `b${i}`, content: "x".repeat(5000) }))
    await askAgentLab("s", { userId: "u", text: "t", contextBlocks: blocks })
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(sent.context_blocks.length).toBeLessThanOrEqual(8)
    const total = sent.context_blocks.reduce(
      (n: number, b: { title: string; content: string }) => n + b.title.length + b.content.length, 0)
    expect(total).toBeLessThanOrEqual(24000)
  })
})
```

- [ ] **Step 2: Run → FAIL** — `cd "d:/Ngoding/expr/VibeCoding.id/Baruma" && npx vitest run src/lib/server/agent-lab.test.ts` (module not found).

- [ ] **Step 3: Implement `src/lib/server/agent-lab.ts`**:

```typescript
/**
 * Server-only client for the central agent-lab service (Pattern B).
 * Mirrors llm.ts's resilience contract: returns null on ANY failure so callers
 * fall back to deterministic logic + credit refund exactly as before. Never throws.
 */
const DEFAULT_URL = "https://agentlab.tampil.dev"
const MAX_BLOCKS = 8
const MAX_TOTAL_CHARS = 24000
const TIMEOUT_MS = 60_000

export interface AgentLabContext {
  title: string
  content: string
}

function baseUrl(): string {
  return process.env.AGENT_LAB_URL || DEFAULT_URL
}

function apiKey(): string | undefined {
  return process.env.AGENT_LAB_KEY
}

export function agentLabEnabled(): boolean {
  return !!apiKey()
}

/** Defensive trim so an oversized context never 422s: cap block count, then
 *  cap cumulative title+content chars (dropping whole trailing blocks). */
function trimBlocks(blocks: AgentLabContext[]): AgentLabContext[] {
  const capped = blocks.slice(0, MAX_BLOCKS)
  const out: AgentLabContext[] = []
  let total = 0
  for (const b of capped) {
    const size = b.title.length + b.content.length
    if (total + size > MAX_TOTAL_CHARS) break
    out.push(b)
    total += size
  }
  return out
}

/**
 * POST /v1/agents/{slug}/ask. Returns the answer string only on mode==="answer";
 * null on clarify/refuse/any failure. Never throws (mirrors llm.ts).
 */
export async function askAgentLab(
  slug: string,
  args: { userId: string; text: string; contextBlocks?: AgentLabContext[] },
): Promise<string | null> {
  const key = apiKey()
  if (!key) return null

  const body: Record<string, unknown> = { user_id: args.userId, text: args.text }
  if (args.contextBlocks && args.contextBlocks.length > 0) {
    body.context_blocks = trimBlocks(args.contextBlocks)
  }

  let res: Response
  try {
    res = await fetch(`${baseUrl()}/v1/agents/${encodeURIComponent(slug)}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    console.error("[agent-lab] request error:", e instanceof Error ? e.message : String(e))
    return null
  }

  if (!res.ok) {
    console.error(`[agent-lab] HTTP ${res.status} (slug=${slug})`)
    return null
  }

  let data: { mode?: string; answer?: string }
  try {
    data = await res.json()
  } catch (e) {
    console.error("[agent-lab] parse error:", e instanceof Error ? e.message : String(e))
    return null
  }

  if (data.mode !== "answer" || typeof data.answer !== "string" || data.answer.trim() === "") {
    // clarify/refuse/empty → treat as "no direct answer" so the caller uses its
    // existing graceful fallback (same shape as chatText resolving null today).
    return null
  }
  return data.answer
}
```

- [ ] **Step 4: Run → PASS** — `npx vitest run src/lib/server/agent-lab.test.ts` (expect all green).

- [ ] **Step 5: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/Baruma"
git add src/lib/server/agent-lab.ts src/lib/server/agent-lab.test.ts
git commit -m "feat(agent-lab): resilient server client (Pattern B, null-on-failure)"
```

---

### Task B6: `buildAssistantContextBlocks` helper

**Files:**
- Create: `src/lib/server/brief-assistant-context.ts`
- Test: `src/lib/server/brief-assistant-context.test.ts`

**Interfaces:**
- Consumes: `AgentLabContext` (B5), `Brief` type, `AssistantTurn` (from `brief-assistant.ts`).
- Produces: `buildAssistantContextBlocks(input: { brief: Brief; history?: AssistantTurn[]; standardsNote?: string; designKnowledgeNote?: string; assetSuggestionsNote?: string }): AgentLabContext[]`. Consumed by B7, B8.

- [ ] **Step 1: Failing tests** — `src/lib/server/brief-assistant-context.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { buildAssistantContextBlocks } from "./brief-assistant-context"
import type { Brief } from "@/types"

const brief = {
  summary: "Rumah 2 lantai", site: { area: 90 }, building: { floors: 2 },
  priorities: ["hemat"], spaceProgram: [{ roomType: "kamar", name: "Kamar Utama", quantity: 1 }],
  constraints: [], risks: [{ title: "tanah sempit" }],
} as unknown as Brief

describe("buildAssistantContextBlocks", () => {
  it("always includes a Brief block first", () => {
    const blocks = buildAssistantContextBlocks({ brief })
    expect(blocks[0].title).toMatch(/brief/i)
    expect(blocks[0].content).toContain("Rumah 2 lantai")
  })

  it("includes optional notes as their own blocks when present, skips when absent", () => {
    const withNotes = buildAssistantContextBlocks({
      brief, standardsNote: "AUDIT: skor 64", designKnowledgeNote: "KB: ventilasi",
      assetSuggestionsNote: "Sofa A",
    })
    const titles = withNotes.map((b) => b.title.toLowerCase())
    expect(titles.some((t) => t.includes("standar"))).toBe(true)
    expect(titles.some((t) => t.includes("knowledge") || t.includes("pengetahuan"))).toBe(true)
    expect(titles.some((t) => t.includes("aset"))).toBe(true)

    const bare = buildAssistantContextBlocks({ brief })
    expect(bare.length).toBe(1) // only Brief
  })

  it("folds history into a single 'Percakapan sebelumnya' block, last turns only", () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turn${i}`,
    }))
    const blocks = buildAssistantContextBlocks({ brief, history })
    const hist = blocks.find((b) => b.title.toLowerCase().includes("percakapan"))
    expect(hist).toBeTruthy()
    expect(hist!.content).toContain("turn11")
    expect(hist!.content).not.toContain("turn0") // trimmed to last 8
  })

  it("returns at most 8 blocks", () => {
    const blocks = buildAssistantContextBlocks({
      brief, history: [{ role: "user", content: "h" }],
      standardsNote: "s", designKnowledgeNote: "k", assetSuggestionsNote: "a",
    })
    expect(blocks.length).toBeLessThanOrEqual(8)
  })
})
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/lib/server/brief-assistant-context.test.ts`.

- [ ] **Step 3: Implement `src/lib/server/brief-assistant-context.ts`**:

```typescript
/**
 * Converts Baruma's deterministic advisory context (brief summary, computed
 * standards audit, curated design knowledge, real asset suggestions, recent
 * chat history) into agent-lab Pattern B `context_blocks`. Pure for testing.
 *
 * The advisory SYSTEM PROMPT itself lives in the agent-lab agent config
 * (baruma-assistant), NOT here — this only supplies grounding context.
 */
import type { Brief } from "@/types"
import type { AgentLabContext } from "./agent-lab"
import type { AssistantTurn } from "./brief-assistant"

const MAX_HISTORY = 8

export function buildAssistantContextBlocks(input: {
  brief: Brief
  history?: AssistantTurn[]
  standardsNote?: string
  designKnowledgeNote?: string
  assetSuggestionsNote?: string
}): AgentLabContext[] {
  const { brief, history, standardsNote, designKnowledgeNote, assetSuggestionsNote } = input
  const blocks: AgentLabContext[] = []

  const briefContext = JSON.stringify({
    summary: brief.summary,
    site: brief.site,
    building: brief.building,
    priorities: brief.priorities,
    spaceProgram: brief.spaceProgram.map((s) => ({
      roomType: s.roomType, name: s.name, quantity: s.quantity,
    })),
    constraints: brief.constraints,
    risks: brief.risks.map((r) => r.title),
  })
  blocks.push({ title: "Brief proyek", content: briefContext })

  if (standardsNote) {
    blocks.push({
      title: "Hasil audit standar (computed — kutip, jangan mengarang penilaian)",
      content: standardsNote,
    })
  }
  if (designKnowledgeNote) {
    blocks.push({
      title: "Pengetahuan desain (kurasi — pakai bila relevan, jangan mengarang di luar)",
      content: designKnowledgeNote,
    })
  }
  if (assetSuggestionsNote) {
    blocks.push({
      title: "Aset/model tersedia di library (rekomendasikan HANYA dari sini, sebut nama persis)",
      content: assetSuggestionsNote,
    })
  }
  if (history && history.length > 0) {
    const recent = history
      .slice(-MAX_HISTORY)
      .map((t) => `${t.role === "user" ? "User" : "Asisten"}: ${t.content}`)
      .join("\n")
    blocks.push({ title: "Percakapan sebelumnya", content: recent })
  }

  return blocks.slice(0, 8)
}
```

- [ ] **Step 4: Run → PASS** — `npx vitest run src/lib/server/brief-assistant-context.test.ts`.

- [ ] **Step 5: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/Baruma"
git add src/lib/server/brief-assistant-context.ts src/lib/server/brief-assistant-context.test.ts
git commit -m "feat(agent-lab): build Pattern-B context blocks from advisory grounding"
```

---

### Task B7: Wire `brief/assistant` route to agent-lab

**Files:**
- Modify: `src/app/api/v1/projects/[id]/brief/assistant/route.ts`
- Test: `src/app/api/v1/projects/[id]/brief/assistant/route.test.ts`

**Interfaces:**
- Consumes: `askAgentLab` (B5), `buildAssistantContextBlocks` (B6). Slug constant `"baruma-assistant"`.

- [ ] **Step 1: Update the test** — in `route.test.ts`, replace the `chatText` mock with an `askAgentLab` mock and keep the SAME assertions (success uses the answer; null → 200 + FALLBACK + refund called; throw → refund + error). Replace the `vi.mock("@/lib/server/llm", ...)` block and update the three behavior tests:

```typescript
// at top, alongside other mocks
vi.mock("@/lib/server/agent-lab", () => ({ askAgentLab: vi.fn() }))
import * as agentLab from "@/lib/server/agent-lab"
// ...in beforeEach: vi.mocked(agentLab.askAgentLab).mockReset()

// success:
it("returns the agent-lab answer on success", async () => {
  vi.mocked(agentLab.askAgentLab).mockResolvedValueOnce("Ya, cukup realistis.")
  // ...existing arrange for a valid request...
  // assert response body answer === "Ya, cukup realistis." and credit NOT refunded
})

// null → fallback + refund (keep the existing FALLBACK + refund assertions):
it("refunds and returns 200 with FALLBACK when agent-lab resolves null", async () => {
  vi.mocked(agentLab.askAgentLab).mockResolvedValueOnce(null)
  // ...assert 200, body answer === FALLBACK, refundCredits called once...
})

// throw → refund + error path preserved:
it("refunds then surfaces the error when agent-lab throws", async () => {
  vi.mocked(agentLab.askAgentLab).mockRejectedValueOnce(new Error("boom"))
  // ...assert refundCredits called; handleError path...
})
```
(Preserve the existing "insufficient credits → 402 without calling the LLM" test, swapping the assertion `expect(chatText).not.toHaveBeenCalled()` → `expect(askAgentLab).not.toHaveBeenCalled()`.)

- [ ] **Step 2: Run → FAIL** — `npx vitest run "src/app/api/v1/projects/[id]/brief/assistant/route.test.ts"`.

- [ ] **Step 3: Modify `route.ts`** — swap imports and the LLM call, keep everything else (auth, credit gate, refund, FALLBACK, response) identical:

Replace the import line:
```typescript
import { chatText } from "@/lib/server/llm"
```
with:
```typescript
import { askAgentLab } from "@/lib/server/agent-lab"
import { buildAssistantContextBlocks } from "@/lib/server/brief-assistant-context"
```
Add near the other consts:
```typescript
const AGENT_SLUG = "baruma-assistant"
```
Replace the message-building + `chatText` block (the `const messages = buildAssistantMessages(...)` through the `answer = await chatText(...)` try/catch) with:
```typescript
    const contextBlocks = buildAssistantContextBlocks({
      brief,
      history: parsed.data.history ?? [],
      standardsNote,
    })
    let answer: string | null
    try {
      answer = await askAgentLab(AGENT_SLUG, {
        userId,
        text: parsed.data.question,
        contextBlocks,
      })
    } catch (e) {
      await refundCredits(userId, 1, "brief_assistant_refund", id)
      throw e
    }
    if (answer === null) {
      await refundCredits(userId, 1, "brief_assistant_refund", id)
    }

    return ok({ answer: answer ?? FALLBACK })
```
(`buildAssistantMessages` import can be dropped from this file if now unused; leave `standardsNote` derivation and everything above untouched.)

- [ ] **Step 4: Run → PASS** — `npx vitest run "src/app/api/v1/projects/[id]/brief/assistant/route.test.ts"`.

- [ ] **Step 5: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/Baruma"
git add "src/app/api/v1/projects/[id]/brief/assistant/route.ts" "src/app/api/v1/projects/[id]/brief/assistant/route.test.ts"
git commit -m "feat(agent-lab): route brief/assistant through agent-lab (Pattern B), refund/fallback intact"
```

---

### Task B8: Wire `agent` route brief-chat mode to agent-lab

**Files:**
- Modify: `src/app/api/v1/projects/[id]/agent/route.ts` (only the brief-chat `chatText` at ~line 189-194)
- Test: `src/app/api/v1/projects/[id]/agent/route.test.ts`

**Interfaces:**
- Consumes: `askAgentLab` (B5), `buildAssistantContextBlocks` (B6). Reuse slug `"baruma-assistant"`.

- [ ] **Step 1: Update the test** — in `agent/route.test.ts`, add an `askAgentLab` mock; for the brief-chat mode, assert success uses the agent-lab answer and null → `BRIEF_FALLBACK` with `llmFailed` true. Keep floorplan/chatJSON tests unchanged:

```typescript
vi.mock("@/lib/server/agent-lab", () => ({ askAgentLab: vi.fn() }))
import * as agentLab from "@/lib/server/agent-lab"
// beforeEach: vi.mocked(agentLab.askAgentLab).mockReset()

// brief-chat success:
vi.mocked(agentLab.askAgentLab).mockResolvedValue("jawaban")
// ...assert reply === "jawaban" for a brief-chat-mode request...
```
(Keep the existing test that credit is reserved before the LLM call; swap its `chatText` order assertion for `askAgentLab`.)

- [ ] **Step 2: Run → FAIL** — `npx vitest run "src/app/api/v1/projects/[id]/agent/route.test.ts"`.

- [ ] **Step 3: Modify `agent/route.ts`** — add imports (top):
```typescript
import { askAgentLab, agentLabEnabled } from "@/lib/server/agent-lab"
import { buildAssistantContextBlocks } from "@/lib/server/brief-assistant-context"
```
**Gate flip (controller decision):** the brief-chat block sits under `else if (!llmEnabled())` (checks the OLD DeepSeek key). Since this path now uses agent-lab, flip that guard to `else if (!agentLabEnabled())` so availability is judged by `AGENT_LAB_KEY` (not the unrelated `LLM_API_KEY`). Leave every OTHER `llmEnabled()` use in the file (floorplan/`chatJSON` paths) untouched — those still use the direct LLM.
Add a slug const near the other consts:
```typescript
const AGENT_SLUG = "baruma-assistant"
```
Replace the brief-chat block (`const messages = buildAssistantMessages(...); const answer = await chatText(messages, { temperature: 0.4 }); llmFailed = answer === null; reply = answer ?? BRIEF_FALLBACK`) with:
```typescript
        const contextBlocks = buildAssistantContextBlocks({
          brief, history, standardsNote, designKnowledgeNote, assetSuggestionsNote,
        })
        const answer = await askAgentLab(AGENT_SLUG, {
          userId, text: input.instruction, contextBlocks,
        })
        llmFailed = answer === null
        reply = answer ?? BRIEF_FALLBACK
```
(Verify `userId` is in scope in this handler — it comes from `requireUser`; if the local variable is named differently, use that name. Leave the `chatJSON` action path and floorplan handlers untouched. Keep `chatText`/`buildAssistantMessages` imports only if still used elsewhere in the file; drop if now unused.)

- [ ] **Step 4: Run → PASS + full agent-route suite** — `npx vitest run "src/app/api/v1/projects/[id]/agent/route.test.ts"`.

- [ ] **Step 5: Commit**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/Baruma"
git add "src/app/api/v1/projects/[id]/agent/route.ts" "src/app/api/v1/projects/[id]/agent/route.test.ts"
git commit -m "feat(agent-lab): route agent brief-chat mode through agent-lab, floorplan/actions untouched"
```

---

### Task B9: Env + provision `baruma-assistant` agent + key (ops)

**Files:**
- Modify: `.env.example`

**Interfaces:** Produces the live `baruma-assistant` agent + a `baruma` product key.

- [ ] **Step 1: Add env keys to `.env.example`** (after the `LLM_*` block):

```bash
# --- agent-lab (central AI agent service; Pattern B advisory) ---
AGENT_LAB_URL=https://agentlab.tampil.dev
AGENT_LAB_KEY=            # alk_... product key scoped to baruma-assistant (from backoffice reveal)
```

- [ ] **Step 2: Provision the agent** — in the backoffice `https://tampil.dev/admin/agent-lab` (or admin API on the droplet), create agent `baruma-assistant`:
  - `retrieval_config`: `{"type":"none"}`
  - `llm_config`: `{"provider":"deepseek","model":"deepseek-v4-flash","temperature":0.4,"max_tokens":4096,"thinking":"enabled"}`
  - `system_prompt`: the EXACT advisory system prompt copied verbatim from `src/lib/server/brief-assistant.ts` `buildAssistantMessages` (the "Kamu asisten arsitek di aplikasi Baruma…" base text, WITHOUT the note-injection tails — those arrive as context_blocks now).
  - `behavior_config`: `{"max_history_turns":0}`

- [ ] **Step 3: Issue a `baruma` product key** scoped to `["baruma-assistant"]`, copy the plaintext from the reveal modal.

- [ ] **Step 4: Set env on the Baruma droplet** — append `AGENT_LAB_URL` + `AGENT_LAB_KEY=<plaintext>` to Baruma's prod env (`/opt/baruma/app/.env.local`, LF-only), and to local `.env.local` for dev. Do NOT commit the real key.

- [ ] **Step 5: Commit the example only**

```bash
cd "d:/Ngoding/expr/VibeCoding.id/Baruma"
git add .env.example
git commit -m "chore(agent-lab): document AGENT_LAB_URL/AGENT_LAB_KEY env"
```

---

### Task B10: Parity hard gate — real A/B, fallback, E2E (DoD)

**Files:** none (verification; record results in the PR/session notes).

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Full suites green** — `cd Baruma && npx vitest run` AND `cd tampil.dev/agent-lab && .venv/Scripts/python.exe -m pytest -q`. Both fully green.

- [ ] **Step 2: Thinking-live check** — POST `/v1/agents/baruma-assistant/ask` (via droplet, using the baruma key) with a reasoning-heavy advisory question; confirm `mode:answer`, non-empty `answer` (proves thinking + retry live). Record.

- [ ] **Step 3: A/B parity set (≥5 questions)** — for each advisory question (incl. one multi-turn with history, one "apakah desain sudah sesuai standar?" that exercises `standardsNote`), run: (a) the old path (`chatText` on a checkout of `main`, or a saved baseline), (b) the new agent-lab path with identical brief/context. Compare: agent-lab equals-or-beats — grounded in the blocks, no hallucination, no empty answer, standards/knowledge/asset detail preserved. Record the pairs in a short results table.

- [ ] **Step 4: Real fallback** — temporarily unset `AGENT_LAB_KEY` on the droplet (or point `AGENT_LAB_URL` at an unreachable host); hit the `brief/assistant` endpoint → expect 200 with `FALLBACK` + credit refunded (no 500). Restore the key.

- [ ] **Step 5: Live E2E** — with a real authenticated session (or staging), exercise both migrated endpoints against a real project; verify answers render and credits charge on success / refund on forced failure.

- [ ] **Step 6: Record + finish** — capture all results; then use `superpowers:finishing-a-development-branch` for BOTH branches (agent-lab `feat/agent-lab-f1` already has its own PR flow; Baruma `feat/agent-lab-integration` → PR to Baruma `main`, no auto-merge).

---

## Self-Review

**Spec coverage:** §0 bar → Global Constraints + A1-A3 + B9 config + B10 gate. §2 scope (2 chatText in, enrich/chatJSON/tools out) → B7/B8 modify only the prose calls; explicitly noted untouched. §3 client → B5. §3a agent-lab enhancement → A1-A4. §4 client contract → B5 tests. §5 mapping → B7/B8. §5c helper → B6. §6 provisioning → B9. §7 env → B9. §8 resilience → B5 (null-on-all-failure) + B7/B8 (refund/fallback intact). §9 santrenize → out of scope, no task (correct). §10 testing → B5/B6/B7/B8 unit + B10 gate. §10a parity → B10. §11 rollout → B9 kill-switch (empty key) + B10 fallback test.

**Placeholder scan:** No TBD/TODO. B7/B8 test steps describe the mock-swap concretely (the surrounding route tests already exist; the implementer adapts them — exact new mock + assertions given). All new files (B5/B6, A1-A3) carry complete code.

**Type consistency:** `AgentLabContext {title, content}` defined B5, used B6. `askAgentLab(slug, {userId, text, contextBlocks?})` signature identical across B5/B7/B8. `buildAssistantContextBlocks(input)` object-arg shape identical B6/B7/B8. `LLMConfig.thinking: Literal["enabled","disabled"]|None` defined A1, consumed A3 (`llm_cfg.thinking`) and A2 (`thinking` param). Slug `"baruma-assistant"` consistent B7/B8/B9.
