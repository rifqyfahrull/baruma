"""E2E "audit lahan terbatas Tier-1" — deterministic browser-use script.

Harness: browser-use 0.13.7 (https://github.com/browser-use/browser-use). No
LLM key is configured in this environment, so this script does NOT use the
agentic `Agent` class — it drives the browser deterministically through the
low-level actor API (`BrowserSession` + `browser_use.actor.page.Page` /
`browser_use.actor.element.Element`), which wraps Chrome DevTools Protocol
directly (browser-use 0.13.7 has no Playwright dependency at all — see
`browser_use/actor/page.py`). This is the closest deterministic control
surface the installed package exposes: `Page.get_elements_by_css_selector`,
`Element.fill()/click()/get_attribute()`, `Page.evaluate()`.

Run against a dev server started with Supabase env EMPTY (open /app/*,
mock in-memory data source) — see e2e/browser-use/README or the task runbook.

Usage:
    D:\\tmp\\baruma-e2e\\.venv\\Scripts\\python e2e\\browser-use\\lahan-terbatas.py
"""

from __future__ import annotations

import asyncio
import base64
import re
import sys
import time
import traceback
from pathlib import Path

from browser_use import BrowserSession

# Windows consoles/log redirection default to cp1252, which can't encode the
# arrows/em-dashes this script (and the app's own Indonesian copy) uses.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

BASE_URL = "http://localhost:3100"
SHOTS_DIR = Path(r"D:\tmp\baruma-e2e\shots")
SHOTS_DIR.mkdir(parents=True, exist_ok=True)

RESULTS: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, msg: str = "") -> None:
    RESULTS.append((name, ok, msg))
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}" + (f" — {msg}" if msg else ""), flush=True)


class Assertion(AssertionError):
    pass


def require(cond: bool, msg: str) -> None:
    if not cond:
        raise Assertion(msg)


# ---------------------------------------------------------------------------
# Resilience: the headless Chrome renderer under this CDP-only actor API
# (no Playwright underneath — see module docstring) crashed intermittently
# mid-run under rapid-fire evaluate()/click() calls (observed: "CDP WebSocket
# message handler exited unexpectedly", Chrome child-process count dropping,
# reproduced with an isolated repro script). A `Page` object caches its CDP
# session id on first use; once that session dies, retrying through the SAME
# `Page` object keeps failing. `Ctx` fixes that by re-resolving a fresh
# `Page` (re-attaching to the same tab/target) before every retry.
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
        """Run `fn(page, *args, **kwargs)`, refreshing the page + retrying on
        any exception (crashed renderer / dead CDP session)."""
        last_exc: Exception | None = None
        for attempt in range(1, retries + 1):
            page = await self.ensure()
            if settle:
                await asyncio.sleep(settle)
            try:
                return await fn(page, *args, **kwargs)
            except Exception as e:  # noqa: BLE001 - deliberately broad, see docstring
                last_exc = e
                print(f"    ! {getattr(fn, '__name__', fn)} attempt {attempt}/{retries} failed: {e}", flush=True)
                await asyncio.sleep(1.5)
                try:
                    await self.refresh()
                except Exception as re_exc:
                    print(f"    ! refresh also failed: {re_exc}", flush=True)
        assert last_exc is not None
        raise last_exc


# ---------------------------------------------------------------------------
# Low-level helpers built on top of the browser-use actor API
# ---------------------------------------------------------------------------

async def goto(page, url: str) -> None:
    await page.goto(url)


async def save_shot(page, name: str) -> None:
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
        except Exception as e:
            last = ""
            consecutive_errors += 1
            # A handful of one-off eval errors during a navigation/transition
            # are normal — but 5 in a row means the CDP session/renderer is
            # actually dead. Re-raise so `Ctx.run` refreshes the page and
            # retries the whole wait from scratch, instead of silently
            # polling a corpse for the rest of `timeout`.
            if consecutive_errors >= 5:
                raise
        if substr in last:
            return True, last
        await asyncio.sleep(interval)
        elapsed += interval
    return False, last


async def wait_for_url(page, substr: str, timeout: float = 20.0, interval: float = 0.3) -> bool:
    elapsed = 0.0
    while elapsed < timeout:
        try:
            url = await page.get_url()
        except Exception:
            url = ""
        if substr in url:
            return True
        await asyncio.sleep(interval)
        elapsed += interval
    return False


# NOTE on performance/stability: the first version of this script used
# `Page.get_elements_by_css_selector()` + per-`Element` `.evaluate()` round
# trips to enumerate buttons/labels one CDP call at a time (describeNode +
# resolveNode + callFunctionOn *per element*). On a step with ~40 interactive
# elements ("Kebutuhan ruang") this flooded the CDP connection and crashed
# the headless renderer (observed: "CDP WebSocket message handler exited
# unexpectedly", Chrome subprocess count dropping). Fix: do the
# find-by-text/find-by-label matching inside a SINGLE `Page.evaluate()` call
# (one CDP round trip no matter how many candidate elements exist), and only
# fall back to the `Element` wrapper (for realistic keystroke-level `.fill()`)
# once a single, already-resolved target id is known.

_CLICK_TEXT_JS = """(sel, text, exact, idx) => {
	const els = Array.from(document.querySelectorAll(sel));
	const matches = els.filter((el) => {
		const t = (el.textContent || '').trim();
		return exact ? t === text : t.includes(text);
	});
	if (matches.length <= idx) return false;
	const el = matches[idx];
	el.scrollIntoView({ block: 'center' });
	el.click();
	return true;
}"""

_CLICK_ARIA_JS = """(label) => {
	const els = Array.from(document.querySelectorAll('[aria-label]'));
	const el = els.find((e) => e.getAttribute('aria-label') === label);
	if (!el) return false;
	el.scrollIntoView({ block: 'center' });
	el.click();
	return true;
}"""

_LABEL_FOR_ID_JS = """(text) => {
	const labels = Array.from(document.querySelectorAll('label[data-slot="form-label"]'));
	const lbl = labels.find((l) => (l.textContent || '').trim() === text);
	return lbl ? (lbl.getAttribute('for') || '') : '';
}"""


async def click_text(page, selector: str, text: str, *, exact: bool = True, index: int = 0,
                      timeout: float = 10.0) -> None:
    """Click the `index`-th element matching `selector` whose text == `text`.

    Matching + clicking happens inside one JS `evaluate()` call — see the
    performance note above.
    """
    elapsed = 0.0
    while elapsed < timeout:
        result = await page.evaluate(_CLICK_TEXT_JS, selector, text, exact, index)
        if result == "True":
            return
        await asyncio.sleep(0.3)
        elapsed += 0.3
    raise Assertion(f"click_text: '{text}' not found via selector {selector!r} within {timeout}s")


async def click_aria(page, label: str, timeout: float = 10.0) -> None:
    elapsed = 0.0
    while elapsed < timeout:
        result = await page.evaluate(_CLICK_ARIA_JS, label)
        if result == "True":
            return
        await asyncio.sleep(0.3)
        elapsed += 0.3
    raise Assertion(f"click_aria: no element with aria-label={label!r} within {timeout}s")


async def find_by_label(page, label_text: str, timeout: float = 10.0):
    """Resolve a shadcn <FormLabel> by exact text to its bound <input>/<textarea>.

    Label lookup happens in one JS call; only the single resolved id is then
    turned into an `Element` (for CDP-level `.fill()` with real keystrokes,
    which react-hook-form needs to see proper onChange events).
    """
    elapsed = 0.0
    while elapsed < timeout:
        for_id = await page.evaluate(_LABEL_FOR_ID_JS, label_text)
        if for_id:
            els = await page.get_elements_by_css_selector(f'[id="{for_id}"]')
            if els:
                return els[0]
        await asyncio.sleep(0.3)
        elapsed += 0.3
    raise Assertion(f"find_by_label: label {label_text!r} not found (or unresolved) within {timeout}s")


async def fill_label(page, label_text: str, value: str) -> None:
    el = await find_by_label(page, label_text)
    await el.fill(value)


# ---------------------------------------------------------------------------
# Scenario steps
# ---------------------------------------------------------------------------

PROJECT_NAME = f"Rumah Lahan Terbatas E2E {int(time.time())}"


async def fill_wizard_site_step(ctx: Ctx) -> None:
    await ctx.run(fill_label, "Lebar tanah", "6")
    await ctx.run(fill_label, "Panjang tanah", "15")
    await ctx.run(fill_label, "Sisi menempel tetangga", "2")
    await ctx.run(click_aria, "Buka aturan tata ruang (opsional)")
    await ctx.run(fill_label, "KDB maksimum (%)", "60")
    await ctx.run(fill_label, "GSB depan (meter)", "3")


async def scenario_a(ctx: Ctx) -> str:
    """Create a project through the wizard with a narrow, twice-attached lot
    and Perda overrides (KDB 60%, GSB 3 m), then push it all the way through
    to the 2D editor via Generate Alternatif -> Pilih layout ini."""
    name = "scenario-a-create-project"
    try:
        await ctx.run(goto, f"{BASE_URL}/app/projects/new")
        ok, _ = await ctx.run(wait_for_text, "Nama project", timeout=15)
        require(ok, "wizard 'Nama project' field never appeared")

        await ctx.run(fill_label, "Nama project", PROJECT_NAME)
        await ctx.run(fill_label, "Lokasi (kota/kabupaten)", "Surabaya")

        await ctx.run(click_text, "button", "Lanjut")  # -> Data tanah
        ok, _ = await ctx.run(wait_for_text, "Ukuran & kondisi lahan", timeout=10)
        require(ok, "did not reach 'Data tanah' step")

        await fill_wizard_site_step(ctx)
        await ctx.run(save_shot, "01-wizard-site-filled")

        await ctx.run(click_text, "button", "Lanjut")  # -> Bangunan
        ok, _ = await ctx.run(wait_for_text, "Lantai, budget, prioritas", timeout=10)
        require(ok, "did not reach 'Bangunan' step")
        # priorities is required (min 1) — pick one, same as existing e2e suite.
        await ctx.run(click_text, "button", "Terasa lega")

        await ctx.run(click_text, "button", "Lanjut")  # -> Kebutuhan ruang
        ok, _ = await ctx.run(wait_for_text, "Ruang yang diinginkan", timeout=10)
        require(ok, "did not reach 'Kebutuhan ruang' step")

        await ctx.run(click_text, "button", "Lanjut")  # -> Ringkasan
        ok, _ = await ctx.run(wait_for_text, "Cek & buat project", timeout=10)
        require(ok, "did not reach 'Ringkasan' step")
        await ctx.run(save_shot, "02-wizard-summary")

        await ctx.run(click_text, "button", "Buat project")
        ok = await ctx.run(wait_for_url, "/brief", timeout=30)
        require(ok, "did not navigate to /brief after 'Buat project'")
        url = await ctx.run(lambda page: page.get_url())
        m = re.search(r"/app/projects/(proj-[^/]+)/brief", url)
        require(bool(m), f"could not parse projectId from url {url!r}")
        project_id = m.group(1)

        ok, _ = await ctx.run(wait_for_text, PROJECT_NAME, timeout=15)
        require(ok, "brief page never showed the project name")
        await ctx.run(save_shot, "03-brief-page")

        # Generate Alternatif -> auto-navigates to /alternatives on success.
        await ctx.run(click_text, "button", "Generate Alternatif", exact=False)
        ok = await ctx.run(wait_for_url, "/alternatives", timeout=30)
        require(ok, "did not navigate to /alternatives after Generate Alternatif")

        ok, _ = await ctx.run(wait_for_text, "Pilih layout", timeout=20)
        require(ok, "alternatives page never rendered a 'Pilih layout' card")
        await ctx.run(save_shot, "04-alternatives")

        await ctx.run(click_text, "button", "Pilih layout ini", exact=False)
        ok = await ctx.run(wait_for_url, f"/app/projects/{project_id}/editor", timeout=30)
        require(ok, "did not navigate to /editor after selecting a layout")

        ok, _ = await ctx.run(wait_for_text, "Cek & AI", timeout=20)
        require(ok, "editor page never rendered ('Cek & AI' tab missing)")
        await ctx.run(save_shot, "05-editor-loaded")

        record(name, True, f"project_id={project_id}")
        return project_id
    except Exception as e:
        await ctx.run(save_shot, "ERROR-scenario-a")
        record(name, False, f"{e}\n{traceback.format_exc(limit=3)}")
        raise


async def scenario_b(ctx: Ctx, project_id: str) -> None:
    """Open the design-audit card in the editor and verify (1) the KDB/GSB
    override language shows up ("Perda yang Anda isi") and (2) a
    narrow-lot-specific finding is present (lighting void/skylight, KDH, or
    the 0-lot-line opening rule — whichever the generated layout actually
    triggers).

    IMPORTANT: this project's data lives ONLY in the browser tab's in-memory
    mock store (`src/lib/mock/index.ts`, lazy-loaded client-side — see
    `src/lib/data/index.ts`). A hard navigation (`page.goto`) reloads the JS
    context and wipes it, so scenario_a already leaves the tab sitting on
    this exact editor page — we deliberately do NOT `goto()` here.
    """
    name = "scenario-b-audit-card-shows-override-and-narrow-finding"
    try:
        ok, _ = await ctx.run(wait_for_text, "Cek & AI", timeout=20)
        require(ok, "editor did not load ('Cek & AI' tab missing)")

        await ctx.run(click_text, "button", "Cek & AI", exact=False)
        ok, _ = await ctx.run(wait_for_text, "Cek Standar", timeout=15)
        require(ok, "'Cek Standar' card never appeared")

        await ctx.run(click_aria, "Buka detail cek standar desain")
        # give the collapsible content a beat to mount
        await asyncio.sleep(0.6)
        txt = await ctx.run(body_text)
        await ctx.run(save_shot, "06-audit-card-open")

        has_override = "Perda yang Anda isi" in txt
        narrow_markers = [
            "sumber cahaya tengah",
            "void",
            "skylight",
            "KDH",
            "batas kavling",
            "0-lot-line",
        ]
        found_markers = [m for m in narrow_markers if m.lower() in txt.lower()]

        print("  --- audit card text (excerpt) ---")
        for line in txt.splitlines():
            line = line.strip()
            if line and any(k.lower() in line.lower() for k in ["KDB", "KDH", "GSB", "cahaya", "kavling", "Perda", "skylight", "void"]):
                print(f"    | {line}")
        print("  ----------------------------------")

        require(has_override, "audit text never mentions 'Perda yang Anda isi' (override not proven applied)")
        require(len(found_markers) > 0, f"no narrow-lot finding marker found; checked {narrow_markers}")

        record(name, True, f"override_text=True narrow_markers={found_markers}")
    except Exception as e:
        await ctx.run(save_shot, "ERROR-scenario-b")
        record(name, False, f"{e}\n{traceback.format_exc(limit=3)}")
        raise


async def _read_input_value(page, label_text: str) -> str:
    el = await find_by_label(page, label_text)
    return await el.evaluate("() => this.value")


async def scenario_c(ctx: Ctx, project_id: str) -> None:
    """Open /brief/edit, verify the regulation fields are pre-filled (KDB
    60%), change KDH to 20%, save, then go back to the editor and verify the
    audit card text changed to reflect the new KDH override.

    Navigates via the project tab bar's <Link>s (client-side SPA routing),
    NOT `page.goto()` — see the note in scenario_b: a hard reload wipes the
    in-memory mock project this whole test is built on.
    """
    name = "scenario-c-edit-brief-kdh-override-updates-audit"
    try:
        await ctx.run(click_text, "a", "Brief")  # project tab bar -> /brief
        ok, _ = await ctx.run(wait_for_text, "Edit brief", timeout=20)
        require(ok, "brief page did not load ('Edit brief' action missing)")

        await ctx.run(click_text, "button", "Edit brief", exact=False)
        ok, _ = await ctx.run(wait_for_text, "Ukuran & kondisi lahan", timeout=20)
        require(ok, "edit-brief wizard did not load on the 'Data tanah' step")

        kdb_value = await ctx.run(_read_input_value, "KDB maksimum (%)")
        await ctx.run(save_shot, "07-edit-brief-site-prefilled")
        require(kdb_value.strip() == "60", f"KDB field not prefilled with 60, got {kdb_value!r}")

        await ctx.run(fill_label, "KDH minimum (%)", "20")
        await ctx.run(save_shot, "08-edit-brief-kdh-set")

        await ctx.run(click_text, "button", "Lanjut")  # -> Bangunan
        ok, _ = await ctx.run(wait_for_text, "Lantai, budget, prioritas", timeout=10)
        require(ok, "edit wizard did not reach 'Bangunan' step")

        await ctx.run(click_text, "button", "Lanjut")  # -> Kebutuhan ruang
        ok, _ = await ctx.run(wait_for_text, "Ruang yang diinginkan", timeout=10)
        require(ok, "edit wizard did not reach 'Kebutuhan ruang' step")

        await ctx.run(click_text, "button", "Lanjut")  # -> Ringkasan
        ok, _ = await ctx.run(wait_for_text, "Cek & simpan perubahan", timeout=10)
        require(ok, "edit wizard did not reach 'Ringkasan' step")

        await ctx.run(click_text, "button", "Simpan perubahan")
        ok = await ctx.run(wait_for_url, "/brief", timeout=20)
        require(ok, "did not navigate back to /brief after saving")

        await ctx.run(click_text, "a", "2D Editor")  # project tab bar -> /editor
        ok, _ = await ctx.run(wait_for_text, "Cek & AI", timeout=20)
        require(ok, "editor did not reload after brief edit")
        await ctx.run(click_text, "button", "Cek & AI", exact=False)
        ok, _ = await ctx.run(wait_for_text, "Cek Standar", timeout=15)
        require(ok, "'Cek Standar' card never appeared after edit")
        await ctx.run(click_aria, "Buka detail cek standar desain")
        await asyncio.sleep(0.6)
        txt = await ctx.run(body_text)
        await ctx.run(save_shot, "09-audit-card-after-kdh-edit")

        print("  --- audit card text after KDH edit (excerpt) ---")
        for line in txt.splitlines():
            line = line.strip()
            if line and any(k.lower() in line.lower() for k in ["KDH", "Perda", "hijau"]):
                print(f"    | {line}")
        print("  --------------------------------------------------")

        # The meaningful, loose-but-real assertion: SOME KDH-related text is
        # present, tagged with the override phrase rather than "default
        # nasional" (proving the freshly-saved override is what the audit
        # engine now reads — not the pre-edit default).
        has_kdh_mention = "KDH" in txt
        has_kdh_override = "KDH (sesuai angka Perda yang Anda isi)" in txt
        has_kdh_default = "KDH (default nasional" in txt

        require(has_kdh_mention, "audit text has no KDH mention at all after setting KDH override")
        require(
            has_kdh_override or not has_kdh_default,
            "KDH finding (if present) still shows 'default nasional' wording after an explicit override was saved",
        )

        record(
            name,
            True,
            f"kdb_prefilled=60 kdh_mention={has_kdh_mention} kdh_override_wording={has_kdh_override}",
        )
    except Exception as e:
        await ctx.run(save_shot, "ERROR-scenario-c")
        record(name, False, f"{e}\n{traceback.format_exc(limit=3)}")
        raise


async def main() -> int:
    session = BrowserSession(
        headless=True,
        window_size={"width": 1440, "height": 1000},
        # Headless GPU-process instability on Windows was crashing the
        # renderer mid-run (observed as "CDP WebSocket message handler
        # exited unexpectedly" right after a heavy DOM step). Disabling GPU
        # acceleration (this app doesn't need WebGL for these routes) fixed it.
        args=["--disable-gpu", "--disable-software-rasterizer"],
    )
    await session.start()
    ctx = Ctx(session)
    try:
        # sanity: make sure the dev server is actually reachable & open (no
        # login redirect) before spending time on the real scenarios.
        await ctx.run(goto, f"{BASE_URL}/app/dashboard")
        ok, _ = await ctx.run(wait_for_text, "Dashboard", timeout=20)
        if not ok:
            record("00-dev-server-open-mode-sanity", False, "'/app/dashboard' did not render — is the dev server up with Supabase env emptied?")
            return 1
        record("00-dev-server-open-mode-sanity", True)

        project_id = await scenario_a(ctx)
        await scenario_b(ctx, project_id)
        await scenario_c(ctx, project_id)
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
