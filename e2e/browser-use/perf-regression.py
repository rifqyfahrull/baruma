"""E2E "perf regression" — deterministic browser-use script for the G2 perf
optimizations (autosave gzip + debounce, editor bundle split, draco/frameloop
on 3D).

Reuses the low-level CDP actor API + retry harness from lahan-terbatas.py
(see that file's module docstring for the full rationale: browser-use 0.13.7
has no Playwright dependency, drives Chrome directly via CDP). This script is
self-contained (duplicates the small helper set) rather than importing from
lahan-terbatas.py, matching the "one deterministic script per scenario" style
already used in this directory.

Differences from lahan-terbatas.py's browser launch:
  - No `--disable-gpu` here: step (iv) below needs a real WebGL context
    (house-model.tsx's draco-decoded GLBs, house-scene.tsx's
    frameloop="demand" canvas) to smoke-test that the 3D preview still
    renders. Real Chrome's headless mode renders WebGL fine via ANGLE/D3D11
    on this machine (verified: UNMASKED_RENDERER reports a real GPU, not a
    stub) — no `--disable-gpu`/`--disable-software-rasterizer` needed, and
    adding them would defeat the point of testing (iv).
  - `executable_path` pinned to the system Chrome install (see task runbook)
    instead of relying on whatever browser-use would otherwise resolve.

Verifies, against the SAME open-auth dev server as lahan-terbatas.py (Supabase
env emptied — see that script's docstring):
  (i)   create a project through the wizard -> editor (same flow as
        lahan-terbatas.py's scenario_a, trimmed to just reach /editor).
  (ii)  a `window.fetch` spy installed BEFORE any edit, recording
        {method, url, headers} for every request.
  (iii) one room edit (widen a room by 0.25 m via the "Lebar (m)" field in
        RoomInspectorCard) -> wait past the 1500ms debounce -> assert the
        autosave hook completes without error (UI settles on "Tersimpan
        otomatis", never "Gagal menyimpan otomatis") — this is a *wiring*
        regression check (does debounce/dirty-clearing still work after
        G2a's hook changes), not a network check: see the IMPORTANT note
        below for why.
  (iii-b) a same-tab, real-browser gzip *interop* smoke test: builds a
        request with the EXACT technique `src/lib/data/http.ts`'s
        `gzipJson()`/`req()` use (Blob -> `.stream()` ->
        `pipeThrough(new CompressionStream("gzip"))` -> `Response(...).
        arrayBuffer()`, `Content-Encoding: gzip` header) and PUTs it to
        `/api/v1/projects/<id>/layout` — served for this one request by a
        tiny local sidecar (`_GzipEchoHandler` below, started on
        127.0.0.1:3102) that gunzips with Python's stdlib `gzip` (RFC 1952,
        the same format Node's `zlib`/the real route's `readJsonBody` use)
        and echoes 200 back. Asserts the fetch spy captured the PUT with
        `Content-Encoding: gzip` AND the response was `ok`.

        IMPORTANT — why a sidecar instead of the real route: the real
        `PUT /api/v1/projects/[id]/layout` needs `requireUser` (a Supabase
        session or Bearer JWT) and a DB-backed `getOwnedProject`/
        `updateLayoutAtRevision`. This dev server's data source is the
        in-memory mock (`NEXT_PUBLIC_API_URL` unset — see lahan-terbatas.py's
        docstring on why: Supabase is disabled here specifically so the
        wizard/editor UI works headlessly without a captcha-gated login), so
        `saveLayout()` never touches the network at all in this mode — there
        is nothing for a fetch-spy to catch. Pointing the WHOLE app at HTTP
        mode instead would fix that but requires `DATABASE_URL`, and this
        repo's real Postgres is a shared instance reachable only from the
        deploy droplet's tailnet (docs/ARCHITECTURE.md: "DB pusat TIDAK bisa
        di-reach dari mesin dev") — not safe or possible to exercise from a
        local/CI sandbox. The gzip mechanism itself (client encode + server
        decode) already has thorough unit/integration coverage that DOES run
        against the real code: `src/lib/data/http.test.ts` (real Node
        `CompressionStream`, asserts the header + a `gunzipSync` round trip)
        and `route.test.ts` (calls the actual exported `PUT` handler,
        including `readJsonBody`'s gunzip branch, with the repo layer
        mocked). What ONLY a real browser can add is cross-runtime interop
        confidence (does Chrome's CompressionStream output decode cleanly
        outside Node) over a REAL network hop with the REAL header — that's
        exactly what step (iii-b) checks.
  (iv)  navigate to /preview-3d (client-side, via the project tab bar — a
        hard reload would wipe the in-memory mock project) -> wait for a
        WebGL <canvas> to mount with no "Gagal memuat preview 3D" fallback.

Usage:
    D:\\tmp\\baruma-e2e\\.venv\\Scripts\\python e2e\\browser-use\\perf-regression.py
"""

from __future__ import annotations

import asyncio
import base64
import gzip
import http.server
import json
import re
import sys
import threading
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
GZIP_ECHO_PORT = 3102


# ---------------------------------------------------------------------------
# Gzip echo sidecar (see the module docstring's "IMPORTANT" note for why this
# exists instead of hitting the real DB-backed route). Decodes with Python's
# stdlib `gzip` — RFC 1952, the same wire format Node's `zlib.gunzipSync`
# (used by the real route's `readJsonBody`) and the browser's
# `CompressionStream` all implement — so a successful round trip here is
# genuine cross-runtime interop evidence, not a tautology.
# ---------------------------------------------------------------------------

class _GzipEchoHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"  # one request per connection — simplest, no keep-alive edge cases

    def log_message(self, fmt, *args) -> None:  # silence stdlib's per-request access log
        pass

    def _cors(self) -> None:
        # The dev server (localhost:3100) and this sidecar (localhost:3102)
        # are different origins — a real browser PUT with a custom header
        # (Content-Encoding) triggers a CORS preflight; without these headers
        # the fetch would be blocked before ever reaching the assertions.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type, content-encoding")

    def do_OPTIONS(self) -> None:  # CORS preflight
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_PUT(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        encoding = (self.headers.get("Content-Encoding") or "").lower()
        try:
            body = gzip.decompress(raw) if "gzip" in encoding else raw
            parsed = json.loads(body.decode("utf-8"))
            reply = json.dumps({
                "layout": parsed.get("layout"),
                "revision": (parsed.get("expectedRevision") or 0) + 1,
            }).encode("utf-8")
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(reply)))
            self.end_headers()
            self.wfile.write(reply)
        except Exception as e:  # noqa: BLE001 - report the failure to the client, not just locally
            reply = json.dumps({"error": "bad_request", "message": str(e)}).encode("utf-8")
            self.send_response(400)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(reply)))
            self.end_headers()
            self.wfile.write(reply)


class _QuietThreadingHTTPServer(http.server.ThreadingHTTPServer):
    """Suppresses the harmless `ConnectionResetError` traceback stdlib prints
    when Chrome tears down a connection (e.g. a speculative keep-alive probe)
    right as the sidecar shuts down at the end of the run — pure log noise,
    not a test failure."""

    def handle_error(self, request, client_address) -> None:
        pass


def start_gzip_echo_server(port: int = GZIP_ECHO_PORT) -> http.server.ThreadingHTTPServer:
    server = _QuietThreadingHTTPServer(("127.0.0.1", port), _GzipEchoHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"  gzip echo sidecar listening on 127.0.0.1:{port}", flush=True)
    return server

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
# Ctx: same CDP-session-resilience wrapper as lahan-terbatas.py — re-resolves
# a fresh `Page` before every retry instead of hammering a dead CDP session.
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
# Low-level helpers (mirrors lahan-terbatas.py)
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

_LABEL_FOR_ID_JS = """(text) => {
	const labels = Array.from(document.querySelectorAll('label[data-slot="form-label"]'));
	const lbl = labels.find((l) => (l.textContent || '').trim() === text);
	return lbl ? (lbl.getAttribute('for') || '') : '';
}"""


async def click_text(page, selector: str, text: str, *, exact: bool = True, index: int = 0,
                      timeout: float = 10.0) -> None:
    elapsed = 0.0
    while elapsed < timeout:
        result = await page.evaluate(_CLICK_TEXT_JS, selector, text, exact, index)
        if result == "True":
            return
        await asyncio.sleep(0.3)
        elapsed += 0.3
    raise Assertion(f"click_text: '{text}' not found via selector {selector!r} within {timeout}s")


async def find_by_label(page, label_text: str, timeout: float = 10.0):
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
# Perf-regression-specific helpers
# ---------------------------------------------------------------------------

# RoomInspectorCard's `<Field>` renders a plain shadcn <Label> (data-slot=
# "label", NO `for`/`htmlFor`) directly followed by the <Input> — unlike the
# wizard's react-hook-form <FormLabel> (data-slot="form-label", WITH `for`,
# handled by find_by_label above). Resolve those by DOM position instead:
# find the label by its text inside the room inspector, then its sibling
# input, tag it with a throwaway attribute for one-shot CSS lookup.
_FIND_ROOM_FIELD_JS = """(labelText) => {
	const root = document.querySelector('[data-testid="room-inspector"]');
	if (!root) return false;
	const labels = Array.from(root.querySelectorAll('label'));
	const lbl = labels.find((l) => (l.textContent || '').trim() === labelText);
	if (!lbl) return false;
	const wrapper = lbl.parentElement;
	const input = wrapper ? wrapper.querySelector('input') : null;
	if (!input) return false;
	input.setAttribute('data-e2e-field', 'target');
	return true;
}"""


async def find_room_field(page, label_text: str, timeout: float = 10.0):
    elapsed = 0.0
    while elapsed < timeout:
        ok = await page.evaluate(_FIND_ROOM_FIELD_JS, label_text)
        if ok == "True":
            els = await page.get_elements_by_css_selector('[data-e2e-field="target"]')
            if els:
                return els[0]
        await asyncio.sleep(0.3)
        elapsed += 0.3
    raise Assertion(f"find_room_field: label {label_text!r} not found within {timeout}s")


# Selects the FIRST room drawn on the 2D canvas: locates its name <text>
# (RoomRect in plan-canvas.tsx renders `<text class="... fill-foreground">`
# with the room name as the first <tspan>, `pointer-events-none` so a real
# click passes through to whatever's under the cursor — but a *dispatched*
# event bypasses hit-testing entirely, so targeting the text node directly is
# fine here), walks up to the enclosing `<g onPointerDown=...>` and dispatches
# a synthetic `pointerdown` there. `bubbles: true` is required — React 17+
# attaches its listeners at the root container, not on `g` itself.
_SELECT_FIRST_ROOM_JS = """() => {
	// Several toolbar/lucide icons are also inline <svg> elements that sort
	// before the plan canvas in DOM order — find the SVG that actually has a
	// room label instead of assuming the first <svg> is the canvas.
	const svgs = Array.from(document.querySelectorAll('svg'));
	const svg = svgs.find((s) => s.querySelector('text.fill-foreground'));
	if (!svg) return 'NO_SVG';
	const text = svg.querySelector('text.fill-foreground');
	if (!text) return 'NO_ROOM_TEXT';
	const g = text.closest('g');
	if (!g) return 'NO_G';
	const rect = g.getBoundingClientRect();
	const cx = rect.left + rect.width / 2;
	const cy = rect.top + rect.height / 2;
	const ev = new PointerEvent('pointerdown', {
		bubbles: true, cancelable: true, pointerId: 1, clientX: cx, clientY: cy, button: 0,
	});
	g.dispatchEvent(ev);
	const tspan = text.querySelector('tspan');
	return tspan ? (tspan.textContent || 'unnamed') : 'unnamed';
}"""


async def select_first_room(page, timeout: float = 15.0) -> str:
    elapsed = 0.0
    while elapsed < timeout:
        result = await page.evaluate(_SELECT_FIRST_ROOM_JS)
        if result not in ("NO_SVG", "NO_ROOM_TEXT", "NO_G", None):
            return result
        await asyncio.sleep(0.4)
        elapsed += 0.4
    raise Assertion(f"select_first_room: no clickable room text found on canvas within {timeout}s")


_INSTALL_FETCH_SPY_JS = """() => {
	if (window.__fetchSpyInstalled) return true;
	window.__fetchSpyInstalled = true;
	window.__fetchLog = [];
	const origFetch = window.fetch;
	window.fetch = function (input, init) {
		try {
			const url = typeof input === 'string' ? input : (input && input.url) || '';
			const method = (init && init.method) || (input && input.method) || 'GET';
			let headers = {};
			const h = (init && init.headers) || (input && input.headers);
			if (h) {
				if (typeof Headers !== 'undefined' && h instanceof Headers) {
					h.forEach((v, k) => { headers[k] = v; });
				} else if (Array.isArray(h)) {
					h.forEach(([k, v]) => { headers[k] = v; });
				} else {
					Object.keys(h).forEach((k) => { headers[k] = h[k]; });
				}
			}
			window.__fetchLog.push({ method, url, headers, ts: Date.now() });
		} catch (e) {
			/* never let the spy break the real request */
		}
		return origFetch.apply(this, arguments);
	};
	return true;
}"""


async def install_fetch_spy(page) -> None:
    result = await page.evaluate(_INSTALL_FETCH_SPY_JS)
    require(result == "True", "failed to install window.fetch spy")


_READ_FETCH_LOG_JS = """() => JSON.stringify(window.__fetchLog || [])"""


async def read_fetch_log(page) -> list[dict]:
    import json
    raw = await page.evaluate(_READ_FETCH_LOG_JS)
    try:
        return json.loads(raw)
    except Exception:
        return []


# Mirrors src/lib/data/http.ts's gzipJson()+req({gzip:true}) EXACTLY: same
# Blob -> stream() -> pipeThrough(CompressionStream('gzip')) -> Response(...)
# .arrayBuffer() technique, same `content-encoding: gzip` header. browser-use's
# Page.evaluate requires the expression to start with `(` — an `async (...) =>`
# prefix is rejected outright (see actor/page.py's format check), so the
# outer function stays sync and immediately invokes an async IIFE, which
# Runtime.evaluate still awaits (`awaitPromise: True` is always set).
_GZIP_INTEROP_JS = """(echoUrl, layoutId) => (async () => {
	const payload = JSON.stringify({
		layout: { id: layoutId, rooms: [], floors: [] },
		expectedRevision: 1,
	});
	const stream = new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'));
	const compressed = await new Response(stream).arrayBuffer();
	const res = await fetch(echoUrl, {
		method: 'PUT',
		headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
		body: compressed,
	});
	const json = await res.json().catch(() => null);
	return JSON.stringify({
		status: res.status,
		ok: res.ok,
		compressedBytes: compressed.byteLength,
		plainBytes: payload.length,
		json,
	});
})()"""


async def run_gzip_interop_smoke(page, echo_url: str, layout_id: str) -> dict:
    raw = await page.evaluate(_GZIP_INTEROP_JS, echo_url, layout_id)
    return json.loads(raw)


_CANVAS_CHECK_JS = """() => {
	const canvases = Array.from(document.querySelectorAll('canvas'));
	const live = canvases.filter((c) => c.width > 0 && c.height > 0);
	return JSON.stringify({ count: canvases.length, live: live.length });
}"""


async def canvas_check(page) -> dict:
    import json
    raw = await page.evaluate(_CANVAS_CHECK_JS)
    try:
        return json.loads(raw)
    except Exception:
        return {"count": 0, "live": 0}


# ---------------------------------------------------------------------------
# Scenario steps
# ---------------------------------------------------------------------------

PROJECT_NAME = f"Rumah Perf Regression E2E {int(time.time())}"


async def fill_wizard_site_step(ctx: Ctx) -> None:
    await ctx.run(fill_label, "Lebar tanah", "8")
    await ctx.run(fill_label, "Panjang tanah", "18")
    await ctx.run(fill_label, "Sisi menempel tetangga", "1")


async def create_project_to_editor(ctx: Ctx) -> str:
    """Wizard -> Generate Alternatif -> Pilih layout ini -> /editor. Trimmed
    replay of lahan-terbatas.py's scenario_a (no Perda overrides needed
    here — this script doesn't touch the audit card)."""
    name = "step-1-create-project-to-editor"
    try:
        await ctx.run(goto, f"{BASE_URL}/app/projects/new")
        ok, _ = await ctx.run(wait_for_text, "Nama project", timeout=15)
        require(ok, "wizard 'Nama project' field never appeared")

        await ctx.run(fill_label, "Nama project", PROJECT_NAME)
        await ctx.run(fill_label, "Lokasi (kota/kabupaten)", "Bandung")

        await ctx.run(click_text, "button", "Lanjut")  # -> Data tanah
        ok, _ = await ctx.run(wait_for_text, "Ukuran & kondisi lahan", timeout=10)
        require(ok, "did not reach 'Data tanah' step")

        await fill_wizard_site_step(ctx)

        await ctx.run(click_text, "button", "Lanjut")  # -> Bangunan
        ok, _ = await ctx.run(wait_for_text, "Lantai, budget, prioritas", timeout=10)
        require(ok, "did not reach 'Bangunan' step")
        await ctx.run(click_text, "button", "Terasa lega")

        await ctx.run(click_text, "button", "Lanjut")  # -> Kebutuhan ruang
        ok, _ = await ctx.run(wait_for_text, "Ruang yang diinginkan", timeout=10)
        require(ok, "did not reach 'Kebutuhan ruang' step")

        await ctx.run(click_text, "button", "Lanjut")  # -> Ringkasan
        ok, _ = await ctx.run(wait_for_text, "Cek & buat project", timeout=10)
        require(ok, "did not reach 'Ringkasan' step")

        await ctx.run(click_text, "button", "Buat project")
        ok = await ctx.run(wait_for_url, "/brief", timeout=30)
        require(ok, "did not navigate to /brief after 'Buat project'")
        url = await ctx.run(lambda page: page.get_url())
        m = re.search(r"/app/projects/(proj-[^/]+)/brief", url)
        require(bool(m), f"could not parse projectId from url {url!r}")
        project_id = m.group(1)

        ok, _ = await ctx.run(wait_for_text, PROJECT_NAME, timeout=15)
        require(ok, "brief page never showed the project name")

        await ctx.run(click_text, "button", "Generate Alternatif", exact=False)
        ok = await ctx.run(wait_for_url, "/alternatives", timeout=30)
        require(ok, "did not navigate to /alternatives after Generate Alternatif")

        ok, _ = await ctx.run(wait_for_text, "Pilih layout", timeout=20)
        require(ok, "alternatives page never rendered a 'Pilih layout' card")

        await ctx.run(click_text, "button", "Pilih layout ini", exact=False)
        ok = await ctx.run(wait_for_url, f"/app/projects/{project_id}/editor", timeout=30)
        require(ok, "did not navigate to /editor after selecting a layout")

        ok, _ = await ctx.run(wait_for_text, "Cek & AI", timeout=20)
        require(ok, "editor page never rendered ('Cek & AI' tab missing)")
        await ctx.run(save_shot, "perf-01-editor-loaded")

        record(name, True, f"project_id={project_id}")
        return project_id
    except Exception as e:
        await ctx.run(save_shot, "perf-ERROR-step1")
        record(name, False, f"{e}\n{traceback.format_exc(limit=3)}")
        raise


async def edit_room_and_verify_debounced_autosave(ctx: Ctx) -> None:
    """(ii)+(iii): install the fetch spy, widen a room, wait past the 1500ms
    debounce, and assert the autosave hook completes cleanly — dirty clears,
    UI settles on "Tersimpan otomatis", never "Gagal menyimpan otomatis".

    This dev server runs on the in-memory mock data source (see the module
    docstring's IMPORTANT note), so `saveLayout()` here does NOT hit the
    network — this step is a wiring/debounce regression check (does
    use-layout-autosave.ts's G2a 1500ms-debounce rewrite still clear `dirty`
    and report success correctly), not a gzip check. The gzip mechanism
    itself is verified separately in `verify_gzip_interop_via_sidecar` right
    after this, in the same tab.
    """
    name = "step-2-edit-room-debounced-autosave-completes-without-error"
    try:
        await ctx.run(install_fetch_spy)

        room_name = await ctx.run(select_first_room)
        print(f"  selected room: {room_name!r}", flush=True)
        ok, _ = await ctx.run(wait_for_text, "Lebar (m)", timeout=10)
        require(ok, "RoomInspectorCard ('Lebar (m)' field) never appeared after selecting a room")
        await ctx.run(save_shot, "perf-02-room-selected")

        width_input = await ctx.run(find_room_field, "Lebar (m)")
        current = await ctx.run(lambda page, el=width_input: el.evaluate("() => this.value"))
        new_value = str(round(float(current) + 0.25, 2))
        await ctx.run(lambda page, el=width_input, v=new_value: el.fill(v))
        # commitNumber() fires on blur — explicitly blur to commit deterministically
        # rather than relying on a subsequent click to steal focus.
        await ctx.run(lambda page: page.evaluate(
            "() => { const el = document.activeElement; if (el && el.blur) el.blur(); return true; }"
        ))
        print(f"  widened room from {current} to {new_value}", flush=True)

        # Debounce is 1500ms — wait comfortably past it before checking.
        await asyncio.sleep(2.5)

        txt = await ctx.run(body_text)
        has_error = "Gagal menyimpan otomatis" in txt
        has_saved = "Tersimpan otomatis" in txt
        await ctx.run(save_shot, "perf-03-after-autosave")
        require(not has_error, "UI shows 'Gagal menyimpan otomatis' after the debounced autosave")
        require(has_saved, "UI never settled on 'Tersimpan otomatis' after the debounced autosave")

        record(name, True, f"room={room_name} width={current}->{new_value}")
    except Exception as e:
        await ctx.run(save_shot, "perf-ERROR-step2")
        record(name, False, f"{e}\n{traceback.format_exc(limit=3)}")
        raise


async def verify_gzip_interop_via_sidecar(ctx: Ctx, project_id: str, echo_port: int) -> None:
    """(iii-b): real-browser gzip interop smoke test against the local
    sidecar — see the module docstring's IMPORTANT note for the full
    rationale. Runs in the SAME tab/session as the rest of the flow (fetch
    spy from step 2 is still installed) so the PUT is independently visible
    both in the sidecar's own response AND in window.__fetchLog."""
    name = "step-2b-gzip-interop-real-browser-put-to-sidecar"
    try:
        echo_url = f"http://localhost:{echo_port}/api/v1/projects/{project_id}/layout"
        result = await ctx.run(run_gzip_interop_smoke, echo_url, project_id)
        print(f"  gzip interop result: {result}", flush=True)

        require(result.get("ok") is True, f"sidecar PUT did not resolve ok (result={result})")
        require(result.get("status") == 200, f"sidecar PUT status != 200 (result={result})")
        require(
            result.get("json", {}).get("layout", {}).get("id") == project_id,
            f"sidecar echo did not round-trip the layout payload correctly (result={result})",
        )

        log = await ctx.run(read_fetch_log)
        matching = [
            e for e in log
            if e.get("method", "").upper() == "PUT"
            and "/layout" in e.get("url", "")
            and str(echo_port) in e.get("url", "")
        ]
        require(len(matching) > 0, f"fetch spy never saw the sidecar PUT (log had {len(log)} entries)")
        headers = {k.lower(): v for k, v in matching[-1].get("headers", {}).items()}
        content_encoding = headers.get("content-encoding", "")
        require(
            "gzip" in content_encoding.lower(),
            f"fetch spy captured the PUT but without Content-Encoding: gzip (headers={matching[-1].get('headers')})",
        )
        print(f"  fetch spy captured PUT {matching[-1].get('url')} headers={matching[-1].get('headers')}", flush=True)

        record(
            name, True,
            f"status={result.get('status')} compressedBytes={result.get('compressedBytes')} "
            f"plainBytes={result.get('plainBytes')} content_encoding={content_encoding!r}",
        )
    except Exception as e:
        await ctx.run(save_shot, "perf-ERROR-step2b")
        record(name, False, f"{e}\n{traceback.format_exc(limit=3)}")
        raise


async def verify_preview_3d_smoke(ctx: Ctx) -> None:
    """(iv): navigate to /preview-3d via the project tab bar (client-side —
    a hard reload wipes the in-memory mock project) and confirm a live WebGL
    canvas mounts with no 'Gagal memuat preview 3D' fallback (smoke test for
    house-model.tsx's draco decoder path + house-scene.tsx's frameloop=
    "demand")."""
    name = "step-3-preview-3d-canvas-renders-no-fallback"
    try:
        await ctx.run(click_text, "a", "3D Preview", exact=False)
        ok = await ctx.run(wait_for_url, "/preview-3d", timeout=20)
        require(ok, "did not navigate to /preview-3d")

        # Give r3f a beat to mount + the GPU pipeline to warm up.
        deadline = 30.0
        elapsed = 0.0
        info = {"count": 0, "live": 0}
        while elapsed < deadline:
            info = await ctx.run(canvas_check)
            if info.get("live", 0) > 0:
                break
            await asyncio.sleep(0.5)
            elapsed += 0.5

        txt = await ctx.run(body_text)
        has_fallback = "Gagal memuat preview 3D" in txt
        await ctx.run(save_shot, "perf-04-preview-3d")

        require(not has_fallback, "preview-3d shows the WebGL-unavailable fallback ('Gagal memuat preview 3D')")
        require(info.get("live", 0) > 0, f"no live (non-zero-sized) <canvas> found on /preview-3d (info={info})")

        record(name, True, f"canvas_info={info}")
    except Exception as e:
        await ctx.run(save_shot, "perf-ERROR-step3")
        record(name, False, f"{e}\n{traceback.format_exc(limit=3)}")
        raise


async def main() -> int:
    echo_server = start_gzip_echo_server()
    session = BrowserSession(
        headless=True,
        executable_path=CHROME_PATH,
        window_size={"width": 1440, "height": 1000},
        # Deliberately NOT --disable-gpu here (unlike lahan-terbatas.py) —
        # step 3 needs a real WebGL context. See module docstring.
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

        project_id = await create_project_to_editor(ctx)
        await edit_room_and_verify_debounced_autosave(ctx)
        await verify_gzip_interop_via_sidecar(ctx, project_id, GZIP_ECHO_PORT)
        await verify_preview_3d_smoke(ctx)
    finally:
        await session.stop()
        echo_server.shutdown()

    print("\n=== SUMMARY ===")
    all_ok = True
    for name, ok, msg in RESULTS:
        all_ok = all_ok and ok
        print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {msg}" if msg else ""))
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
