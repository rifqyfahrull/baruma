# Analisa Tools SEO & Marketing — Baruma

> Riset & audit: 2026-08-15. Konteks: Next.js 16 App Router, React 19, self-hosted 1 droplet VPS + pm2, Postgres, tim kecil, produk visual 3D (three.js/WebGL). Harga terverifikasi via web (Agustus 2026).

## Ringkasan eksekutif

Tool bukan hambatan utama — hampir semua kebutuhan inti **gratis**. Pengungkit terbesar adalah dua hal yang sudah di tangan tapi belum dioptimalkan:
1. **Fondasi SEO teknis belum ada sama sekali** (sitemap, robots, OG image, structured data, analytics).
2. **14 halaman `/templates`** yang baru dirilis = infrastruktur **programmatic SEO** siap pakai yang belum menghasilkan karena mesin pencari belum menemukannya.

Stack awal yang direkomendasikan: **Rp 0/bulan**, menutup ~90% gap.

## Audit kondisi SEO saat ini (dari kode)

**Sudah ada:**
- Metadata dasar di `src/app/layout.tsx`: title template (`%s · Baruma`), description, `lang="id"`.
- `generateMetadata` per-template di `src/app/(marketing)/templates/[slug]/page.tsx`.
- Route group `(marketing)` publik dengan nav + footer.

**Gap (belum ada):**
- `src/app/sitemap.ts` dan `src/app/robots.ts` — mesin pencari tak punya peta situs.
- `metadataBase` + OG image default + Twitter/OpenGraph card — share link (WhatsApp!) tampil blank.
- Structured data (JSON-LD schema.org) — tak ada rich result.
- **Nol analytics/measurement** — tak ada GA4, Umami, PostHog, Clarity, GTM.
- 14 halaman `/templates/[slug]` belum di-sitemap, belum ada JSON-LD/OG per halaman.

## Stack minimal — mulai sekarang, gratis

| Kategori | Tool | Alasan untuk Baruma |
|---|---|---|
| Fondasi teknis | `sitemap.ts` + `robots.ts` + `metadataBase` (native Next.js 16, tanpa library) | Paling mendesak. Ini kode, bukan tool eksternal. |
| Search Console | Google Search Console + Bing Webmaster (import dari GSC) | Wajib. Verifikasi via DNS TXT, submit sitemap. |
| Web analytics | **Umami** self-hosted | Numpang di droplet + Postgres yang ada, RAM ~200–500MB, data di server sendiri (UU PDP). Jauh lebih ringan dari Plausible (butuh ClickHouse 2–4GB). |
| Product funnel | **PostHog Cloud** (free 1M event/bln) — *jangan* self-host | Funnel "lihat template → daftar → mulai desain", feature flag, A/B test AI. Self-host tak ekonomis untuk tim kecil. |
| Perilaku/CRO | **Microsoft Clarity** | Heatmap + session recording gratis tanpa batas. Lihat drop-off funnel `/templates`. |
| Audit crawl | Screaming Frog (free <500 URL) + Ahrefs Webmaster Tools (gratis) | Situs jauh di bawah 500 URL — versi gratis cukup. |
| Riset kata kunci | Google Keyword Planner + Google Trends | Data volume Indonesia langsung dari Google. |

**Total: Rp 0/bulan.**

## Catatan teknis SEO untuk Next.js 16
- Pakai **primitif native** (`app/sitemap.ts`, `app/robots.ts`, Metadata API) — `next-sitemap`/`next-seo` sudah usang (peninggalan Pages Router).
- **`metadataBase` kritis & belum ada** — tanpa ini OG image jadi relative path & preview share pecah.
- **OG image dinamis** via `next/og` (`ImageResponse`, built-in) → file `opengraph-image.tsx` di folder template, render nama+gaya+harga jadi 1200×630. Constraint: Flexbox-only, font manual, <500KB.
- **JSON-LD**: `Product` (eligible rich snippet harga, `priceCurrency: "IDR"`) atau `CreativeWork` (lebih aman, deskriptif tanpa klaim harga) untuk halaman template.
- **Canonical** per halaman (`alternates.canonical`) untuk hindari duplikat query-param di `/templates`. Hreflang belum perlu (single-language `id`).
- **three.js & Core Web Vitals**: halaman `/templates` publik **jangan** memuat bundle three.js (hanya `/editor`, `/preview-3d`) — kalau tidak, LCP hancur. Saat ini tab 3D sudah lazy-load, jaga tetap begitu. Reserve dimensi canvas untuk cegah CLS.

## Pengungkit #1: programmatic SEO di `/templates`

Struktur data template (`style`, `city`, `floors`, `site.areaM2`) sudah ideal. Cluster diurut dari data paling padat:
1. **"Denah rumah type [luas]"** (Type 36/45/70…) dari `site.areaM2` — volume tinggi, Baruma unggul karena denah interaktif + RAB otomatis.
2. **"Desain rumah [gaya]"** — 6 halaman kurasi dari `HOUSE_STYLES` (filter `style=X`).
3. **"Estimasi biaya bangun rumah type XX"** — gabung template + engine RAB, paling bottom-funnel.

⚠️ **Jangan** buat kombinasi kota × gaya × type dulu (14 template → banyak thin content, dihukum Google). Perbanyak template dulu (target 3–5 per kota) sebelum halaman per-kota.

## Kanal: fokus 3
1. **TikTok** — jangkauan nasional terluas 2026, konten edukasi pendek konversi 4× lebih cepat. Barrier rendah (HP + render 3D existing).
2. **Pinterest** — home decor kategori visual #1, traffic evergreen, biaya produksi nyaris nol (repost render fasad/3D).
3. **SEO Google (blog + `/templates`)** — search intent tinggi terbukti besar.

Kelola dengan **Buffer free tier** (3 channel). WhatsApp (**Mekari Qontak** ~Rp 400rb/user/bln) & email nurture (**Brevo**, kontak unlimited gratis) menyusul saat ada traksi.

## Cluster kata kunci domain (Indonesia)
Bottom-funnel (dekat fitur inti — prioritaskan): "denah rumah type 36/45/70", "biaya bangun rumah per meter", "RAB rumah", "cara menghitung RAB", "cara membuat denah rumah sendiri", "estimasi biaya renovasi".
Top-funnel visual (pintu masuk sosial): "desain rumah minimalis", "fasad rumah modern", "desain rumah [gaya]", "rumah tropis/scandinavian/japandi", "desain rumah lahan sempit", "denah rumah 2 lantai lebar 6".
Commercial: "aplikasi desain rumah (gratis)", "jasa desain rumah online", "cari kontraktor rumah".

## Kompetitor
- **Planner 5D** — kompetitor tools terdekat (3D home design global), TAPI tak punya modul RAB/kontraktor lokal → **celah diferensiasi Baruma**.
- **Magicplan** — scan ruangan AR → denah otomatis (segmen renovasi/survei).
- **Pinhome / Rumah123 / Dekoruma / Orami** — marketplace properti; gatekeeper top-of-funnel listicle "aplikasi desain rumah" (kanal distribusi potensial).
- Monitoring: Google Alerts (gratis) + pantau manual listicle mereka.

## Kalau ada budget ~$50–150/bln
- **Ubersuggest** ($12–29/bln) — riset keyword lebih dalam saat blog jalan.
- **NeuronWriter** (~$23/bln) — optimasi on-page saat produksi artikel >10–15/bln.
- **PostHog Cloud** PAYG (kemungkinan tetap $0) — funnel/product analytics lebih dalam.
- **Ahrefs berbayar ($129/bln) belum perlu** sampai halaman programmatic SEO tembus 100+.

## Rencana bertahap
- **Minggu 1 (kode, gratis):** `sitemap.ts`, `robots.ts`, `metadataBase`, OG image default + per-template, JSON-LD template. Pasang GSC + Bing + Clarity + Umami.
- **Bulan 1:** cluster programmatic SEO "type" & "gaya"; mulai TikTok + Pinterest (repost render 3D); riset keyword Keyword Planner/Trends.
- **Bulan 2–3:** blog bottom-funnel (RAB/biaya bangun), funnel PostHog, evaluasi Ubersuggest/Brevo saat ada traksi.
