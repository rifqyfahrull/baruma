# Analisa Production-Readiness Baruma — Agustus 2026

**Tanggal audit:** 23 Agustus 2026 · **Basis:** branch `feat/editor-ui-cleanup` (main + unifikasi UI editor) · **Metode:** 3 audit kode paralel (ops/keamanan · akurasi engineering · journey UX), seluruh temuan diverifikasi langsung di kode dengan path file.

**Pertanyaan yang dijawab:** fitur apa yang masih perlu dibangun agar Baruma (1) production-ready, (2) mudah & memuaskan digunakan, (3) akurat secara engineering — beserta prioritasnya.

**Keputusan arah (ditetapkan user):** target *siap jual ke user nyata*; janji marketing yang belum ditepati kode akan **dibangun fiturnya**, bukan diturunkan copy-nya.

---

## Ringkasan eksekutif

Baruma punya inti produk yang **jauh lebih dalam dari rata-rata MVP** — mesin audit standar ber-sitasi SNI, takeoff dinding dari geometri nyata, sanitasi SNI end-to-end sampai gambar & RAB, disiplin single-source yang langka, ±3.100 unit test + 25 spec e2e hijau. Namun ia belum layak menerima pelanggan berbayar karena tiga kelas masalah:

1. **Operasional buta.** Tidak ada error tracking, monitoring, backup, CI di PR, maupun email transaksional. Error produksi hanya `console.error` di log pm2 — tidak ada yang tahu tanpa SSH. Kasus terburuk yang mungkin terjadi hari ini: *user membayar, webhook gagal, sistem membalas 200, user tidak pernah ter-upgrade, dan tidak ada satu pun sinyal*.
2. **Janji melampaui kode.** 3 dari 8 kartu ekspor berbayar melempar error (DXF/IFC/ZIP dijual di landing); watermark dijual sebagai pembeda plan tanpa ada kodenya; "Kolaborasi tim" Studio tanpa satu pun tabel pendukung; "Project tanpa batas" Pro = 10; link "Bagikan" berujung *Project not found* bagi penerimanya; kartu template di dashboard palsu (hardcoded, tidak prefill apa pun).
3. **Akurasi yang tidak dilabeli.** Sebagian angka RAB adalah persentase-anggaran dengan "harga satuan" hasil derivasi-balik; `builtArea` ikut menghitung taman & kolam (slab beton dibilling di bawah taman); klaim "harga mengacu provinsi X" tanpa satu pun harga yang bervariasi per lokasi; gambar kerja berdinding satu garis tanpa poché/dimensi lengkap.

Kredensial produksi yang bocor Agustus 2026 **masih belum dirotasi** (P0 terbuka di `TODOS.md`), dan satu skrip ber-token produksi masih ter-track di git.

---

## Bagian 1 — Produksi & Operasional

### 1.1 Yang sudah ada (dan baik)

| Area | Bukti |
|---|---|
| Deploy otomatis push-ke-main | `.github/workflows/deploy.yml` — SSH ke droplet, build, migrate, pm2 reload, nginx, smoke curl |
| Migrasi SQL disiplin | `scripts/migrate.mjs` — transaksi per file, `schema_migrations`, fail-closed |
| Idempotensi pembayaran solid | `webhooks/payment` — atomic `UPDATE … WHERE status='pending'`, audit `payment_events` |
| Kredit transaksional & ber-ledger | `src/lib/server/repo/credits.ts` |
| Keamanan dasar kuat | 100% SQL berparameter, IDOR gating `getOwnedProject`, Argon2id + constant-time, `timingSafeEqual` webhook |
| 4 dari 6 temuan pentest 16 Agu sudah difix | BAR-SEC-01/02/03 fixed; 04 open; 05/06 by-design |

### 1.2 Gap kritis

| # | Gap | Dampak | Bukti |
|---|---|---|---|
| O1 | **Kredensial bocor belum dirotasi** (PAT, password DB prod, AUTH_SECRET, BARUMA_JWT_SECRET, dll.) + history belum di-purge | Siapa pun yang pernah clone bisa **forge JWT 30 hari untuk user mana pun** | `TODOS.md` P0 `[ ]`; blob `set-secrets.mjs` masih resolvable di history |
| O2 | `scripts/test-prod-agent.mjs` ter-track berisi session token + JWT produksi user nyata | Kredensial hidup di repo | grep token di scripts/ |
| O3 | **Zero observability** — tanpa Sentry/log terstruktur/uptime check; analytics dibuang ke `dataLayer` tanpa backend | Error produksi tak terlihat; 22 event funnel terbuang | grep sentry/datadog/posthog = 0; `src/lib/analytics/index.ts` |
| O4 | Webhook payment menelan SEMUA error ke 200 | "Bayar tapi tak aktif" tanpa jejak | `webhooks/payment/route.ts:152` |
| O5 | **Tanpa backup DB** — tidak ada pg_dump/cron/runbook | Satu insiden droplet = data pelanggan hilang | grep pg_dump/backup = 0 |
| O6 | **Tanpa CI di PR** — gate test hanya aturan manual | Regresi lolos ke deploy | tidak ada workflow test; `ARCHITECTURE.md:261` |
| O7 | Env tanpa validasi boot — `DATABASE_URL` hilang → diam-diam pakai memory-fallback in-process | Prod bisa "jalan" tanpa DB tanpa error | `memory-fallback.ts` `hasDb()` |
| O8 | Tanpa health endpoint — smoke deploy hanya curl `/` (halaman marketing) | Deploy "sukses" walau DB/storage putus | `deploy.yml` |
| O9 | **Tanpa email transaksional apa pun** (welcome/kuitansi/reminder/expiry) | User bayar tanpa bukti; expiry tanpa peringatan | grep resend/nodemailer/smtp = 0 |
| O10 | Billing tanpa dunning/kuitansi/refund/proration; expiry lazy hanya saat user membuka app | Langganan kedaluwarsa tak terdeteksi; ganti plan = hangus sisa periode | spec §Non-goals; `me/route.ts:48-80` |
| O11 | Rate limit hanya di 6/48 route — checkout, webhook, autosave, generate (ber-kredit/ber-LLM) semuanya tanpa limit | Abuse & biaya LLM tak terkendali | grep rateLimitGuard |
| O12 | BAR-SEC-04: `requestIdForRefund` tidak pernah di-assign — refund kredit agent mati | Kredit hangus saat error/restart pm2 | `agent/route.ts:147,439` |
| O13 | Rollback = tidak ada (git reset ke main, migrasi forward-only); tanpa staging; droplet tunggal SPOF | Insiden = downtime panjang | `deploy.yml` |
| O14 | Hard-delete semua data, tanpa hapus-akun, tanpa ekspor data user | Kepatuhan & kepercayaan | grep deleted_at = 0; `me/route.ts` |
| O15 | Tanpa `.env.example`; kebutuhan env hanya terdokumentasi di heredoc deploy | Setup rapuh | verifikasi find |

---

## Bagian 2 — Akurasi Engineering

### 2.1 Gradien kejujuran (temuan paling penting bagian ini)

**Dalam & jujur (aset nyata untuk marketing):**
- Sanitasi: septic/soakwell/bak kontrol dihitung formula SNI 2398:2017 & SNI 8456 end-to-end sampai gambar S-01..03 dan RAB (`src/lib/water/sanitation.ts`), penempatan sadar-rintangan & idempoten.
- Listrik: demand factor 0,7 × margin 1,25 → tier PLN, estimasi kWh/bulan, MCB standar, panel schedule di E-0n (`src/lib/electrical/*`).
- Audit engine: 19 fungsi ber-sitasi (SNI 03-1733-2004, 03-6572-2001, Kepmen PU 441/KPTS/1998, dll.) — *zero-LLM*, tiap temuan bawa `standard` + `fix` (`src/lib/audit/design-audit.ts` + `standards.ts`).
- Skala gambar: pemilihan 1:50/100/200/500 dan proyeksi mm yang benar (`src/lib/drawings/scale.ts`).
- Takeoff dinding dari union geometri nyata dengan filter ruang outdoor (`src/lib/exterior/quantities.ts`).
- Disiplin single-source: `effectiveRoof`, `buildingFootprint`, `kusenSchedule`, `STRUCT_DISCLAIMER`, dst. — dipin test parity.

**Dangkal tapi dilabeli (boleh bertahan, sudah jujur):**
- Struktur = gravitasi saja: grid kolom seragam ≤4 m, sizing rule-of-thumb (`Ag=Pu/0.33f'c`, balok h=span/12), tanpa gempa/angin/tulangan/lendutan — SETIAP sheet struktural membawa disclaimer wajib "wajib diverifikasi insinyur struktur berlisensi (persyaratan PBG)". SNI 1726 (gempa): nol kemunculan di seluruh repo.
- 25 tarif eksterior semua `confidence: "low"` dengan `effectiveDate` (`src/lib/exterior/rates.ts`).

**Dangkal TANPA label (harus dibereskan):**

| # | Masalah | Bukti |
|---|---|---|
| E1 | RAB "tier B": lantai/cat/plafon/titik air/sanitair = **persentase anggaran** (`base × 0.28 × 0.4` dst.), lalu "harga satuan" **diderivasi balik** `total/volume` — tampil seolah rate nyata | `src/lib/mock/rab.ts:454-500,578-596,94` |
| E2 | `builtArea` = Σ semua ruang **termasuk taman/kolam/carport/void** → slab, keramik, plafon dibilling di bawah taman; harga/m² terdistorsi | `rab.ts:111-114` (tanpa filter `isOutdoorRoom` — padahal takeoff dinding memfilternya) |
| E3 | Asumsi RAB mengklaim "Harga satuan mengacu rata-rata {provinsi} 2026" — **tidak satu pun harga bervariasi per lokasi** | `rab.ts:948` |
| E4 | Footprint = **bounding box**: rumah L/U dapat atap menutup ceruk, kolom melayang di void, soakwell oversized | `src/lib/structural/grid.ts:110` |
| E5 | Harga hardcoded tanpa tanggal/sumber (23 literal IDR di rab.ts) + **tanpa CRUD harga admin** (`CostingPolicy.rateId` ada di types, tak pernah ditulis) | `rab.ts`, `src/components/admin/` |
| E6 | Ekspor Excel RAB **membuang daftar asumsi** (jalur yang paling mungkin sampai ke kontraktor) | `src/lib/rab/export-rab.ts:29-51` |
| E7 | Item RAB hilang: persiapan, galian/urugan bangunan, lantai kerja, **bekisting & pembesian** (terlipat dalam rate m³), waterproofing KM, keramik dinding KM, talang, overhead/PPN/contingency (disclaimed tapi tanpa toggle) | inventaris `rab.ts` |
| E8 | Gambar kerja: **dinding satu garis** di semua sheet (tanpa tebal/poché), dimensi hanya 2 rantai per denah, tanpa pondasi di potongan, tanpa arc/hatch/tabel di kontrak primitive | `layout-sheet.ts:218`, `section.ts:148`, `drawings/types.ts` |
| E9 | Beban mezzanine & rooftop deck **tidak masuk takedown kolom** (footprint mengecualikan rooftop; mezzanine dikecualikan storey count) | `grid.ts`, `takedown.ts` |
| E10 | GLB furnitur di-**auto-scale ke dimensi katalog** (model salah skala jadi "benar" diam-diam); clearance interior cuma 5 aturan (dining hardcoded 1 id; `clearance` metadata tak pernah dibaca) | `validation-profiles.ts`, `interior/plan.ts:1148-1240,322` |
| E11 | Contractor Pack tidak memuat denah/3D/catatan yang dijanjikan deskripsinya — hanya brief + tabel RAB | `src/lib/exports/contractor-pack.ts` |
| E12 | Sumber jumlah lantai bercabang: `Project.floors` (RAB/validasi) vs `storeyCount(layout)` (sheets) | `sheet-list.ts:104` |

### 2.2 Ekspor: janji vs kenyataan

| Format | Status kode | Dijual sebagai |
|---|---|---|
| Contractor/Interior/Drawings PDF, GLB, RAB xlsx | ✅ nyata | — |
| **DXF** | ❌ `throw "belum tersedia"` | Landing + kartu Pro "AutoCAD, LibreCAD" |
| **IFC** | ❌ throw | Landing + kartu Pro "Revit, ArchiCAD" |
| **ZIP All** | ❌ throw | Kartu |
| **Watermark free plan** | ❌ tidak ada kode | Pembeda plan di landing & `plan-defaults` |
| Server-side export gate | ❌ tidak ada route server — gate client "bypassable via devtools" (diakui di kode) | — |

---

## Bagian 3 — Journey UX

### 3.1 Skor per tahap

| Tahap | Status | Temuan kunci |
|---|---|---|
| Landing → daftar | Mulus tapi bergerbang | Tanpa demo tanpa-daftar; verifikasi email = hard stop sebelum nilai produk terlihat |
| Sesi pertama | **Tanpa panduan** | Nol tour/checklist; kartu "Template saran" dashboard **palsu** (hardcoded, link ke wizard kosong) |
| Wizard brief | **Kuat** | 5 langkah tervalidasi, default masuk akal, risk notes hidup; minus: tanpa persist draft (reload = hilang) |
| Alternatif | **Kredibilitas patah** | 3 arketipe hardcoded (skor 87/83/79 tetap); LLM hanya menulis ulang narasi; **pilihan tidak pernah memengaruhi `generateLayout`** — memilih "Lega" vs "Hemat" menghasilkan denah identik; Regenerate −1 kredit untuk hasil sama |
| Editor + 3D | Solid (baru diredesign) | Autosave 1,5 dtk + guard revisi 409 + banner konflik; 3D loading terbaik di app; minus: undo in-memory, tanpa riwayat versi/restore |
| RAB/ekspor | Baik / **3 kartu error** | BOQ editable + Excel; DXF/IFC/ZIP throw; 1 toast mock tersisa |
| Review/Bagikan | **Buntu bagi penerima** | Semua route review `getOwnedProject` → penerima link = 404; komentar semua ber-author literal "Kamu"; "review profesional" = toast mock; link WhatsApp render blank (tanpa OG/meta) |
| Retensi | **Tidak ada** | Nol email, nol notifikasi, analytics tak ber-backend |
| Bantuan | **Hampir nol** | Tanpa menu help/kontak/feedback; "Pengaturan" disabled permanen; satu-satunya panduan = FurniMesh |
| Billing | Berfungsi, copy menyesatkan | "Tanpa batas"=10; "DXF & IFC"=throw; "Kolaborasi tim"=tanpa schema; tanpa top-up kredit, riwayat invoice, cancel |

### 3.2 AI Agent
Mesin dalam (~60 aksi ber-zod lintas denah/atap/fasad/MEP/furnitur, SSE, wizard klarifikasi, guard konektivitas) tapi UX biaya tipis: **biaya kredit tidak pernah ditampilkan** sebelum pakai, saldo sidebar bisa basi 5 menit (tanpa invalidasi `queryKeys.user`), discoverability terbatas 1–2 chip per permukaan padahal `feature-catalog.ts` (771 baris) ada di server.

---

## Bagian 4 — Tabel janji-vs-kode (kontrak perbaikan)

| Janji | Lokasi janji | Kenyataan | Keputusan |
|---|---|---|---|
| Export DXF (CAD) | landing, kartu Pro | throw | **Bangun (G1)** |
| Export IFC (BIM) | landing, kartu Pro | throw | Bangun (G2, web-ifc); sementara kartu "Segera" tanpa tombol error |
| ZIP All | kartu | throw | **Bangun (G1)** |
| Watermark di plan Free | landing, plan-defaults | tidak ada | **Bangun (G1)** |
| Contractor Pack "denah, 3D, RAB, catatan" | EXPORT_META | brief+RAB saja | **Bangun (G1)** |
| "Project tanpa batas" (Pro) | plan copy | maxProjects=10 | **Hormati (G1)**: unlimited |
| Bagikan ke kontraktor | dialog share | 404 bagi penerima | **Bangun (G1)**: share token publik |
| Template → mulai project | dashboard + galeri | tidak ada jalur | **Bangun (G1)** |
| "Kolaborasi tim" (Studio) | plan copy | tanpa schema | Bangun (G2): members+roles+undangan |
| "Review profesional prioritas" (Studio) | review page | toast mock | Bangun (G2/G3, perlu jaringan arsitek — keputusan bisnis) |
| "Harga mengacu provinsi" | asumsi RAB | tidak regional | G1: kalimat jujur; G2: tabel regional nyata |
| "Brand kustom pada export" (Studio) | plan copy | tidak ada | Bangun (G2, bersama watermark pipeline) |

---

## Roadmap

### Gelombang 1 — "Layak dijual & tidak menipu" (±3–4 minggu) — SEDANG DIEKSEKUSI
- **WS-A Keamanan & ops**: purge skrip ber-token + runbook rotasi kredensial terpandu; CI PR (tsc/eslint/vitest/build); `/api/health` + smoke deploy; Sentry (no-op tanpa DSN); validasi env boot (prod tanpa DB = crash jelas); backup DB nightly → S3 + runbook restore; rate limit 6 route kritis; fix refund BAR-SEC-04.
- **WS-B Uang dipercaya**: email transaksional Resend (welcome/kuitansi/reminder H-7/expiry, no-op tanpa key); cron harian expiry-sweep; riwayat transaksi + kuitansi PDF di billing; view rekonsiliasi admin; Pro unlimited projects.
- **WS-C Ekspor**: DXF nyata dari primitives gambar; watermark PDF free plan; Contractor Pack lengkap (denah+3D+asumsi+warnings); ZIP All (JSZip); Excel + sheet Asumsi; IFC → kartu "Segera".
- **WS-D Journey**: template→project (endpoint clone + CTA galeri + dashboard nyata); share link publik ber-token `/s/[token]` (view 3D readOnly + review + komentar bernama); OG/sitemap/robots (link WhatsApp tampil benar); `builtArea` filter outdoor; kalimat provinsi jujur; hapus toast mock; enable Pengaturan; biaya kredit tampil di agent/regenerate + invalidasi saldo.
- **WS-E Analytics & retensi minimum**: Umami/PostHog (22 event funnel hidup); checklist onboarding 4 langkah di dashboard; halaman Bantuan + kontak.
- **WS-F Verifikasi**: e2e baru (template→project, share publik, DXF/zip/watermark, health), full suite, CHANGELOG.

### Gelombang 2 — Kedalaman produk (±4–6 minggu)
Alternatif nyata (parameterisasi `generateLayout` per arketipe — perbaikan kredibilitas terbesar); kolaborasi tim Studio; IFC basic; top-up kredit; tabel harga regional + admin CRUD rates + RAB tier-B → takeoff nyata (+ bekisting/pembesian sebagai item); riwayat versi + restore; hapus akun + ekspor data; notifikasi in-app; PWA; sweep i18n (nav EN→ID).

### Gelombang 3 — Engineering depth
Dinding double-line + poché + rantai dimensi lengkap (kontrak primitive + hatch/tabel); footprint union menggantikan bbox (atap/kolom/soakwell); beban mezzanine/rooftop masuk takedown; input & peringatan zona gempa (jalan menuju SNI 1726); clearance interior lanjutan (jalur sirkulasi, swing pintu, work triangle); server-side export enforcement.

---

## Lampiran — dependensi eksternal yang butuh tindakan user
1. **Rotasi kredensial P0** (runbook `docs/runbook-rotasi-kredensial.md`) — paling mendesak, tidak bisa diwakilkan.
2. Akun **Sentry** (DSN) & **Resend** (API key + verifikasi domain email).
3. Uptime monitor (UptimeRobot gratis → `/api/health`).
4. Email support resmi (dipakai halaman Bantuan & kuitansi).
5. G2: keputusan bisnis "review profesional" (jaringan arsitek nyata vs hapus klaim).
