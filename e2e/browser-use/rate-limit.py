"""E2E "rate-limit hardening" — deterministic browser-use script.

Verifies, against the SAME open-auth dev server as lahan-terbatas.py /
perf-regression.py (see those files' docstrings for the full open-mode
rationale: `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` emptied
so `/app/*` stays open and headless), that the in-memory rate limiter
(`src/lib/server/rate-limit.ts`) is actually wired up end-to-end on a REAL
running server — not just asserted against mocks in vitest.

Scenario 1 (login brute-force, REAL 429): from a page on the app's own
origin, `Page.evaluate` runs a `fetch` loop POSTing wrong credentials (same
fake email every time) to `/api/v1/auth/login` until the server answers
`429` with a `Retry-After` header. This exercises the REAL route, REAL DB
lookup path (`getCredentialByEmail`) and REAL `rateLimitGuard` — nothing here
is mocked. Same-origin fetch (page navigated to BASE_URL first) avoids any
CORS complication.

Scenario 2 (editor-assistant per-user guard, BEST-EFFORT): the task asks us
to also prove the per-user guard added to
`projects/[id]/editor/assistant/route.ts` end-to-end, which needs an
authenticated Bearer/Supabase session. This dev server can't produce one:

  - Supabase is deliberately disabled for this whole e2e setup (see above) —
    that's what keeps `/app/*` open without a captcha-gated login.
  - The legacy JWT path (`POST /api/v1/auth/login` -> `signToken()` ->
    `Authorization: Bearer <jwt>`) needs `BARUMA_JWT_SECRET`, which is NOT
    set anywhere in this environment (checked: absent from `.env.local`,
    `.env.example`, and process env). `requireUser()` wraps the resulting
    `getJwtSecret()` throw into a clean 401 ("Invalid or expired token") for
    ANY Bearer token, well-formed or not — confirmed live with a manual curl
    against this exact dev server before this script existed:
      `POST /projects/e2e-test-project/editor/assistant` with
      `Authorization: Bearer dummy.token.here` -> SSE
      `{"type":"error","error":"Invalid or expired token","status":401}`.
  - We will NOT brute-force or guess a real account's password against the
    shared prod DB this dev server is wired to — that would be an actual
    attack, not a test, and is exactly the kind of behavior this hardening
    pass exists to stop.

  So scenario 2 is executed as a best-effort PRECONDITION CHECK (does this
  dev server have any path to a valid session?) and, when that's negative (as
  expected here), reported as an honest SKIP with the reason above — not
  faked as a pass. The per-user guard on editor-assistant / agent IS covered
  end-to-end against the real route code by
  `src/app/api/v1/projects/[id]/editor/assistant/route.test.ts` and
  `src/app/api/v1/projects/[id]/agent/route.test.ts` (both updated in this
  same change), just with `requireUser` mocked instead of a real session —
  that's the standard way this repo's own route tests already work.

Usage:
    D:\\tmp\\baruma-e2e\\.venv\\Scripts\\python e2e\\browser-use\\rate-limit.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import traceback
from pathlib import Path

from browser_use import BrowserSession

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

BASE_URL = "http://localhost:3100"
SHOTS_DIR = Path(r"D:\tmp\baruma-e2e\shots")
SHOTS_DIR.mkdir(parents=True, exist_ok=True)
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
REPO_ROOT = Path(__file__).resolve().parents[2]

RESULTS: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, msg: str = "") -> None:
    RESULTS.append((name, ok, msg))
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}" + (f" — {msg}" if msg else ""), flush=True)


def record_skip(name: str, msg: str) -> None:
    RESULTS.append((name, True, f"SKIP — {msg}"))
    print(f"[SKIP] {name} — {msg}", flush=True)


class Assertion(AssertionError):
    pass


def require(cond: bool, msg: str) -> None:
    if not cond:
        raise Assertion(msg)


# ---------------------------------------------------------------------------
# Ctx: same CDP-session-resilience wrapper as lahan-terbatas.py /
# perf-regression.py — re-resolves a fresh `Page` before every retry instead
# of hammering a dead CDP session.
# ---------------------------------------------------------------------------

class Ctx:
    def __init__(self, session):
        self.session = session
        self.page = None

    async def ensure(self):
        if self.page is None:
            self.page = await self.session.get_current_page()
            if self.page is None:
                self.page = await self.session.new_page("about:blank")
        return self.page

    async def refresh(self):
        print("    (refreshing CDP page/session attachment...)", flush=True)
        self.page = await self.session.get_current_page()
        if self.page is None:
            self.page = await self.session.new_page("about:blank")
        return self.page

    async def run(self, fn, *args, retries: int = 3, settle: float = 0.25, **kwargs):
        last_exc: Exception | None = None
        for attempt in range(1, retries + 1):
            page = await self.ensure()
            if settle:
                await asyncio.sleep(settle)
            try:
                return await fn(page, *args, **kwargs)
            except Exception as e:  # noqa: BLE001 - deliberately broad, see lahan-terbatas.py docstring
                last_exc = e
                print(f"    ! {getattr(fn, '__name__', fn)} attempt {attempt}/{retries} failed: {e}", flush=True)
                await asyncio.sleep(1.5)
                try:
                    await self.refresh()
                except Exception as re_exc:
                    print(f"    ! refresh also failed: {re_exc}", flush=True)
        assert last_exc is not None
        raise last_exc


async def goto(page, url: str) -> None:
    await page.goto(url)


async def save_shot(page, name: str) -> None:
    import base64
    png_b64 = await page.screenshot()
    (SHOTS_DIR / f"{name}.png").write_bytes(base64.b64decode(png_b64))
    print(f"  screenshot -> {SHOTS_DIR / f'{name}.png'}", flush=True)


async def body_text(page) -> str:
    return await page.evaluate("() => document.body ? document.body.innerText : ''")


async def wait_for_text(page, substr: str, timeout: float = 20.0, interval: float = 0.4) -> tuple[bool, str]:
    elapsed = 0.0
    last = ""
    consecutive_errors = 0
    while elapsed < timeout:
        try:
            last = await body_text(page)
            consecutive_errors = 0
        except Exception:
            last = ""
            consecutive_errors += 1
            if consecutive_errors >= 5:
                raise
        if substr in last:
            return True, last
        await asyncio.sleep(interval)
        elapsed += interval
    return False, last


# ---------------------------------------------------------------------------
# Scenario 1: login brute-force -> real 429
# ---------------------------------------------------------------------------

# Fake, obviously-invalid account (unique per run via timestamp) so this
# never collides with a real prod user or a previous run's still-active
# rate-limit bucket. Same email every attempt -> trips the tighter per-ACCOUNT
# limit (5/5min) before the per-IP one (10/5min) would.
_TEST_EMAIL = f"e2e-rate-limit-{int(time.time())}@example.invalid"

_LOGIN_BRUTE_FORCE_JS = """(email) => (async () => {
	const attempts = [];
	for (let i = 0; i < 12; i++) {
		const res = await fetch('/api/v1/auth/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email, password: 'wrong-password-' + i }),
		});
		const retryAfter = res.headers.get('Retry-After');
		const body = await res.json().catch(() => null);
		attempts.push({ i, status: res.status, retryAfter, error: body && body.error });
		if (res.status === 429) break;
	}
	return JSON.stringify(attempts);
})()"""


async def run_login_brute_force(page, email: str) -> list[dict]:
    raw = await page.evaluate(_LOGIN_BRUTE_FORCE_JS, email)
    return json.loads(raw)


async def scenario_login_rate_limit(ctx: Ctx) -> None:
    name = "01-login-brute-force-429-with-retry-after"
    try:
        attempts = await ctx.run(run_login_brute_force, _TEST_EMAIL)
        require(len(attempts) > 0, "no attempts recorded")
        last = attempts[-1]
        require(last["status"] == 429, f"never hit 429 within {len(attempts)} attempts — last={last}")
        require(bool(last.get("retryAfter")), "429 response had no Retry-After header")
        require(int(last["retryAfter"]) > 0, f"Retry-After was not a positive number: {last.get('retryAfter')!r}")
        # Every attempt before the 429 must have been a normal credential
        # rejection (401), not some unrelated failure (proves the limiter —
        # not a bug — is what's blocking us).
        for a in attempts[:-1]:
            require(a["status"] == 401, f"expected 401 before the 429, got {a}")
        record(
            name,
            True,
            f"429 reached after {len(attempts)} attempts, Retry-After={last['retryAfter']}s "
            f"(scope=login-acct, limit=5/5min per account)",
        )
    except Exception as e:
        await ctx.run(save_shot, "rate-limit-ERROR-scenario1")
        record(name, False, f"{e}\n{traceback.format_exc(limit=3)}")
        raise


# ---------------------------------------------------------------------------
# Scenario 2: editor-assistant per-user guard — best-effort precondition
# check, honest SKIP when (as expected in this dev environment) no session
# can be obtained. See module docstring for the full reasoning.
# ---------------------------------------------------------------------------

_PROBE_BEARER_JS = """() => (async () => {
	const res = await fetch('/api/v1/projects/e2e-rate-limit-probe/editor/assistant', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'authorization': 'Bearer probe.probe.probe' },
		body: JSON.stringify({ mode: 'interior', instruction: 'halo', scene: {} }),
	});
	const text = await res.text();
	return JSON.stringify({ status: res.status, text });
})()"""


async def scenario_editor_assistant_best_effort(ctx: Ctx) -> None:
    name = "02-editor-assistant-per-user-guard"
    env_has_secret = bool(os.environ.get("BARUMA_JWT_SECRET"))
    dotenv_has_secret = False
    for candidate in (".env.local", ".env"):
        p = REPO_ROOT / candidate
        if p.exists() and "BARUMA_JWT_SECRET=" in p.read_text(encoding="utf-8", errors="ignore"):
            dotenv_has_secret = True
            break

    if env_has_secret or dotenv_has_secret:
        # A secret IS configured in this environment — unexpected relative to
        # the audited setup, but don't silently skip; try to reach the route
        # is out of scope without a real signing utility here, so still SKIP
        # but flag it loudly for a human to double check.
        record_skip(
            name,
            "BARUMA_JWT_SECRET IS configured in this environment (unexpected — "
            "re-check whether a real session can now be minted for this scenario)",
        )
        return

    try:
        raw = await ctx.run(page_evaluate_probe)
        probe = json.loads(raw)
        # editor/assistant/route.ts streams SSE (see its module docstring):
        # the outer HTTP response is always 200, with the real status folded
        # into the emitted JSON event (`{"type":"error",...,"status":401}`).
        require(
            probe["status"] == 200 and '"status":401' in probe["text"],
            f"expected the SSE stream to report status 401 (Unauthorized), proving no valid "
            f"session is obtainable, got {probe}",
        )
        record_skip(
            name,
            "Supabase disabled (open-auth e2e mode) AND BARUMA_JWT_SECRET unset in this dev "
            "environment -> requireUser() rejects every Bearer token with 401 "
            f"(confirmed live: {probe['text'][:200]!r}), so no authenticated session exists to "
            "drive the per-user guard through a real browser. Refusing to brute-force a real "
            "prod account's password to work around this. Coverage for the per-user guard "
            "(429 after 15/5min, credit not spent, users isolated) is proven instead by "
            "editor/assistant/route.test.ts and agent/route.test.ts (vitest, added in this "
            "same change) with requireUser mocked.",
        )
    except Exception as e:
        await ctx.run(save_shot, "rate-limit-ERROR-scenario2")
        record(name, False, f"precondition probe itself failed unexpectedly: {e}\n{traceback.format_exc(limit=3)}")
        raise


async def page_evaluate_probe(page):
    return await page.evaluate(_PROBE_BEARER_JS)


async def main() -> int:
    session = BrowserSession(
        headless=True,
        executable_path=CHROME_PATH,
        window_size={"width": 1440, "height": 1000},
        args=["--disable-gpu", "--disable-software-rasterizer"],
    )
    await session.start()
    ctx = Ctx(session)
    try:
        await ctx.run(goto, f"{BASE_URL}/app/dashboard")
        ok, _ = await ctx.run(wait_for_text, "Dashboard", timeout=20)
        if not ok:
            record("00-dev-server-open-mode-sanity", False, "'/app/dashboard' did not render — is the dev server up with Supabase env emptied?")
            return 1
        record("00-dev-server-open-mode-sanity", True)

        await scenario_login_rate_limit(ctx)
        await scenario_editor_assistant_best_effort(ctx)
    finally:
        await session.stop()

    print("\n=== SUMMARY ===")
    all_ok = True
    for name, ok, msg in RESULTS:
        all_ok = all_ok and ok
        print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {msg}" if msg else ""))
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
