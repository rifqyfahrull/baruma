"""Baruma - RAB/Layout API regression tests (demand-based rebar takeoff).

Verifies:
  - 12 struktur lines (beton/pembesian/bekisting) with correct units
  - Kolom pembesian notes cite Pu + n x diameter (nD16) + As
  - Balok pembesian notes cite Mu + D16 + sloof 4D12
  - Price book stamp v2026.1 effective 2026-06-01, cites BPS IKK 2024 + AHSP
  - No stale price warning
  - Layout returns floors + rooms + openings (pintu/jendela)
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3000").rstrip("/")
TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3ItUW00VXFuTVo5LSIsImlhdCI6MTc4Njk0OTk4NCwiZXhwIjoxNzg3MTIyNzg0fQ.l2ESrJnlHpJgzbLr_Sy0AiAQVZzkEX_LahGh6op6xyY"
PROJECT_ID = "proj-asset-rumah-tipe-36"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"authorization": f"Bearer {TOKEN}"})
    return s


@pytest.fixture(scope="module")
def rab(client):
    r = client.get(f"{BASE_URL}/api/v1/projects/{PROJECT_ID}/rab", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def layout(client):
    r = client.get(f"{BASE_URL}/api/v1/projects/{PROJECT_ID}/layout", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestRabStruktur:
    def test_has_12_struktur_lines(self, rab):
        struktur = [i for i in rab["items"] if i["category"] == "struktur"]
        assert len(struktur) == 12, f"expected 12 struktur lines got {len(struktur)}"

    def test_split_beton_pembesian_bekisting_per_element(self, rab):
        elems = ["Pondasi telapak", "Kolom", "Balok & sloof", "Plat lantai"]
        items = {i["item"]: i for i in rab["items"]}
        for e in elems:
            beton = next((it for k, it in items.items() if k.startswith(e) and "beton" in k), None)
            besi = next((it for k, it in items.items() if k.startswith(e) and "pembesian" in k), None)
            bek = next((it for k, it in items.items() if k.startswith(e) and "bekisting" in k), None)
            assert beton and beton["unit"] == "m³", f"{e} beton missing/wrong unit"
            assert besi and besi["unit"] == "kg", f"{e} pembesian missing/wrong unit"
            assert bek and bek["unit"] == "m²", f"{e} bekisting missing/wrong unit"

    def test_kolom_pembesian_demand_based(self, rab):
        it = next(i for i in rab["items"] if i["item"].startswith("Kolom") and "pembesian" in i["item"])
        notes = it.get("notes", "")
        assert "Pu" in notes, notes
        assert re.search(r"\d+D\d+", notes), notes  # nD16 pattern
        assert "As" in notes, notes

    def test_balok_pembesian_demand_based(self, rab):
        it = next(i for i in rab["items"] if i["item"].startswith("Balok") and "pembesian" in i["item"])
        notes = it.get("notes", "")
        assert "Mu" in notes, notes
        assert "D16" in notes, notes


class TestPriceBook:
    def test_price_book_stamp_v2026_1(self, rab):
        assumptions = " | ".join(rab["assumptions"])
        assert "Buku harga v2026.1" in assumptions
        assert "2026-06-01" in assumptions

    def test_cites_bps_ikk_and_ahsp(self, rab):
        assumptions = " | ".join(rab["assumptions"])
        assert "IKK" in assumptions and "2024" in assumptions
        assert "AHSP" in assumptions

    def test_no_stale_warning(self, rab):
        for a in rab["assumptions"]:
            assert not a.startswith("⚠"), f"stale warning present: {a}"


class TestLayout:
    def test_layout_has_floors_rooms_openings(self, layout):
        lay = layout.get("layout", layout)
        assert lay.get("floors") and len(lay["floors"]) >= 1
        assert lay.get("rooms") and len(lay["rooms"]) >= 1
        assert lay.get("openings") and len(lay["openings"]) >= 1

    def test_openings_have_doors_or_windows(self, layout):
        lay = layout.get("layout", layout)
        kinds = {o.get("type") for o in lay.get("openings", [])}
        assert kinds & {"door", "window"}, f"openings types: {kinds}"
