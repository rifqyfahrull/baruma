# 3D Asset Harvest Pipeline

Implementasi workflow dari **3D Asset Research Workflow PRD** — otomatis
menemukan, memfilter (legal + teknis), mengategorikan, mengunduh, dan
mengkatalogkan GLB arsitektur & interior untuk desain rumah. Target: 10.000
GLB "yang benar-benar dibutuhkan".

## Sumber & legalitas

Sumber utama: **Objaverse** (allenai) — mirror resmi metadata + GLB dari
Sketchfab untuk model berlisensi **Creative Commons**, di-host di Hugging Face.
Ini jalur API-first/dataset-import (PRD §9, §11.1) — legal, tanpa scraping liar,
tanpa bypass ToS/CAPTCHA. License Gate (PRD §13) hanya meloloskan **CC0** &
**CC-BY**; NC (non-commercial) dan konten age-restricted di-reject otomatis.
Tiap aset menyimpan bukti lisensi + atribusi (wajib untuk CC-BY).

## Tahapan

| Script | Tahap PRD | Output |
|---|---|---|
| `01-fetch-metadata.mjs` | Source/Dataset import | `meta/*.json.gz` (160 chunk ~800k objek) |
| `02-discover.mjs` | Candidate Discovery + License/Technical Gate (§12,§13,§16) | `out/candidates.jsonl` |
| `03-categorize.mjs` | Categorize deterministik (§18.4 "code untuk fakta") | `out/categorized.jsonl` |
| `04-select.mjs` | Selection + Dedup per-author/kategori (§6.2,§19) | `out/selected.jsonl` |
| `05-download.mjs` | Download/Import + validasi GLB (§14,§16) | `raw/<cat>/<uid>.glb`, `out/downloaded.jsonl` |
| `06-catalog.mjs` | Catalog Writer + License Evidence (§22,§13.4) | `out/catalog.jsonl`, `out/catalog-stats.json` |
| `03-classify.mjs` | MiMo Semantic Review (§18) — **enrichment** | `out/classified.jsonl`, `out/usage.json` |
| `07-bbox.mjs` | Geometry analyzer — bounding box nyata (§16) | `out/bbox.jsonl` |
| `08-upload.mjs` | Upload GLB ke storage (§14) — scoped ke catalog | `out/uploaded.jsonl` |
| `09-migration.mjs` | Generate seed SQL → user_assets (§22) | file `.sql` |
| `10-apply.mjs` | Apply SQL ke DB via pg (transaksi, atomic) | rows di `user_assets` |

Jalankan berurutan:

```bash
node scripts/asset-harvest/01-fetch-metadata.mjs
node scripts/asset-harvest/02-discover.mjs
node scripts/asset-harvest/03-categorize.mjs
node scripts/asset-harvest/04-select.mjs
node scripts/asset-harvest/05-download.mjs --conc=14
node scripts/asset-harvest/06-catalog.mjs
# opsional, jalan kapan pun endpoint faucet hidup (resumable):
node scripts/asset-harvest/03-classify.mjs --batch=20
```

Semua tahap **idempotent & resumable** (baca file output sebelumnya, lewati
yang sudah selesai). Workdir default `D:/tmp/glb-harvest` (override via
`HARVEST_DIR`). GLB TIDAK masuk git — hanya di disk/storage (aturan repo).

## Kenapa deterministik-first, MiMo enrichment

Endpoint `mimo-v2.5-pro` di faucet **text-only** (tidak menerima gambar) dan
**intermittent** (sering 429/503/524 berjam-jam). Jadi:

- **Kategorisasi deterministik** (tahap 03) jadi tulang punggung: skor keyword
  berbobot pada name+tags+categories Sketchfab (yang sudah kaya) + negative
  filter + cap per-author. Gratis, instan, 100% coverage, tidak memblokir.
- **MiMo** (tahap 03-classify) hanya melapisi kualitas: subkategori, style,
  material, dan prune false-positive. Berjalan low-and-slow di background dengan
  backoff sabar; kemajuannya bonus, bukan syarat katalog jadi.

Ini sesuai PRD §18.4: *"Code untuk fakta yang bisa dihitung. LLM untuk
interpretasi."*

## Config (.env.local, gitignored)

```
FAUCET_API_KEY=tf_...           # fallback token tunggal
FAUCET_BASE_URL=https://freetokenfaucet.com/v1
FAUCET_MODEL=deepseek-v4-flash  # lihat catatan model di bawah
```

Token round-robin: taruh beberapa token (1 per baris, `tf_...`) di
`src/components/faucet-check/tokens.txt` (gitignored). Kuota faucet dibatasi
per-token, jadi 1 worker per token menghindari rate-limit.

### Catatan model (per 2026-07-18)

Faucet ini punya **gateway-timeout ~15s** (request >15s balik body kosong) dan
throughput per-model variabel. Hasil probe:

| Model | Status |
|---|---|
| `mimo-v2.5-pro` (PRD asli) | ❌ NO_UPSTREAM_AVAILABLE, text-only (tolak gambar) |
| `deepseek-v4-flash` | ✅ **tercepat & akurat** (~11s untuk batch 5) — dipakai |
| `qwen3.6-flash` | ⚠️ jalan tapi ~15s (mepet gateway) |
| `minimax-m2.7`, `qwen3.7-plus` | ⚠️ reasoning, sering >15s → kosong |
| `gemini-3.5-flash`, `glm-5` | ❌ balik error pendek |

Ganti model via `FAUCET_MODEL`. Batch aman: 4–5 untuk deepseek-v4-flash.

## Go-live (SUDAH DIJALANKAN 2026-07-18)

Pipeline lengkap dari discovery → live di app:

```bash
node scripts/asset-harvest/06-catalog.mjs               # relevant-only: 9.822 aset
node scripts/asset-harvest/07-bbox.mjs                  # dimensi nyata
node scripts/asset-harvest/08-upload.mjs --conc=12      # 28GB → bucket baruma
node scripts/asset-harvest/09-migration.mjs --out=<f>.sql
node scripts/asset-harvest/10-apply.mjs --file=<f>.sql  # → user_assets, is_public=true
```

Hasil: **9.822 aset Objaverse (CC0/CC-BY) live di My Library semua user**
(public user_assets 263 → 10.085), seimbang antar kategori termasuk P0
(facade/gate/window/fence/door). Owner usr-MPbZPdo6Bj.

### Utang teknis / lanjutan (PRD)

- **Normalisasi skala**: ~25% GLB bbox-nya janggal (bukan meter) → dimensi
  di-NULL-kan (app pakai default 1 m). Butuh Blender headless untuk
  normalisasi pivot/scale + re-hitung bbox.
- **Preview multi-angle** (§17): belum dirender — My Library pakai render
  live GLB. Preview WebP untuk thumbnail cepat = pekerjaan lanjutan.
- **UI taksonomi**: filter My Library baru 5 chip; 13 kategori harvest
  disimpan di kolom category (bisa dicari) tapi belum jadi filter chip.
- **~0.8% aset** tak sempat ter-enrich (token faucet habis di 99.2%) —
  tidak masuk catalog relevant-only. Bisa dilengkapi saat token terisi
  (resume `03-classify.mjs`).
