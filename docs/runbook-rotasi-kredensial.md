# Runbook: Rotasi Kredensial Bocor (P0)

> Sumber temuan: `TODOS.md` §P0 + `.gstack/security-reports/2026-08-09-cso-comprehensive.json`.
> Kredensial di bawah pernah ter-commit ke git (mis. `set-secrets.mjs` commit
> `14195b8`, `.claude/settings.json` versi lama) dan **MASIH VALID sampai
> dicabut secara eksplisit** — histori git yang di-purge TIDAK mencabut
> kredensial itu sendiri. Urutan wajib: **rotasi dulu, baru purge history**.
> Kalau urutannya dibalik, siapa pun yang sudah meng-clone repo sebelum purge
> tetap punya kredensial lama yang masih hidup.

Dokumen ini dieksekusi top-to-bottom oleh pemilik akses (butuh akses provider:
GitHub org owner, DigitalOcean droplet root, Supabase/DB admin, DeepSeek/NVIDIA
console, akses ke repo `tampil.dev`/agent-lab). Setiap langkah bercentang
sebelum lanjut ke berikutnya.

---

## 0. Sebelum mulai

- [ ] Siapkan akses GitHub → `Settings → Secrets and variables → Actions` di
      repo `rfq13/baruma` (untuk update GH Actions secrets).
- [ ] Siapkan akses SSH root ke droplet Baruma saat ini (untuk restart app
      setelah env berubah, dan untuk langkah hardening non-root di §8).
- [ ] Beri tahu tim bahwa **rotasi `BARUMA_JWT_SECRET` akan logout SEMUA
      user aktif** (lihat §4) — pilih waktu dengan traffic rendah bila bisa,
      tapi jangan ditunda karena token lama tetap valid sampai secret diganti.

---

## 1. GitHub Personal Access Token (`GH_TOKEN`)

**Dipakai untuk:** `deploy.yml` — droplet meng-clone/fetch repo privat via
`git -c http.extraheader=...` (lihat §8 untuk histori kenapa token tidak lagi
ditulis ke `.git/config`).

1. **Rotasi di provider:** GitHub → foto profil → `Settings` →
   `Developer settings` → `Personal access tokens` → `Tokens (classic)` (atau
   `Fine-grained tokens` bila token lama jenis itu). Cari token dengan awalan
   `ghp_cnf5…` (atau token deploy manapun yang cocok dengan yang tercatat di
   `.gstack/security-reports/2026-08-09-cso-comprehensive.json`) → **Delete**.
2. **Buat token baru:** `Generate new token (classic)` → scope minimal
   `repo` (butuh clone privat) — jangan beri scope lebih dari itu. Simpan
   nilainya sekali saja (GitHub tidak menampilkannya lagi).
3. **Update GH Actions secret:** repo `rfq13/baruma` →
   `Settings → Secrets and variables → Actions` → `GH_TOKEN` → `Update` →
   tempel token baru.
4. **Verifikasi:** jalankan workflow `Deploy Baruma` secara manual
   (`Actions → Deploy Baruma → Run workflow` pada branch `main`) dan pastikan
   step `=== fresh clone ===`/`git fetch origin main` sukses (log tidak
   menunjukkan `Authentication failed`).
5. **Dampak:** tidak ada downtime — token lama baru berhenti berfungsi
   setelah dihapus di langkah 1, dan deploy berikutnya otomatis pakai token
   baru dari secret.

---

## 2. Password Database PostgreSQL Produksi (`DATABASE_URL`)

**Dipakai untuk:** koneksi `pg.Pool` (`src/lib/server/db.ts`) dari app ke DB
central, dan `scripts/migrate.mjs` saat deploy.

1. **Rotasi di provider:** masuk ke server/managed-instance Postgres (droplet
   central via tailnet `100.99.142.119`, atau dashboard managed DB bila
   dipakai) → ganti password role aplikasi:
   ```sql
   ALTER ROLE <nama_role_baruma> WITH PASSWORD '<password-baru-panjang-acak>';
   ```
   Gunakan generator acak ≥32 karakter (mis. `openssl rand -base64 32`).
2. **Susun `DATABASE_URL` baru:** `postgres://<role>:<password-baru>@<host>:5432/<db>`
   — host/db/role TIDAK berubah, hanya password.
3. **Update GH Actions secret:** `DATABASE_URL` → `Update` → tempel connection
   string baru.
4. **Deploy ulang:** jalankan workflow `Deploy Baruma` (push ke `main` atau
   `workflow_dispatch`) — `.env.local` di droplet ditulis ulang dari secret
   setiap deploy (lihat `deploy.yml` step `writing .env.local`), pm2 di-reload
   dengan `--update-env`.
5. **Verifikasi:** `curl https://baruma.tampil.dev/api/health` → pastikan
   `"ok":true` dan `"checks":{"db":true,...}` (endpoint baru dari WS-A ini —
   lihat `src/app/api/health/route.ts`). Bila `db:false`/503, password/host
   salah — cek log pm2 (`pm2 logs baruma`) untuk pesan `password authentication
   failed`.
6. **Dampak:** tanpa downtime bila deploy berjalan mulus (pm2 `reload` bukan
   `restart`) — tapi SEMUA koneksi pool lama diputus saat proses baru start,
   jadi request yang persis di tengah query saat restart bisa gagal sekali
   (klien akan retry).

---

## 3. `AUTH_SECRET` (sesi NextAuth / Supabase SSO cookie signing)

**Dipakai untuk:** menandatangani sesi auth sisi Next.js.

1. **Generate nilai baru:** `openssl rand -base64 32` (tidak ada "provider
   console" — ini secret lokal, bukan API key pihak ketiga).
2. **Update GH Actions secret:** `AUTH_SECRET` → `Update` → tempel nilai baru.
3. **Deploy ulang** (lihat langkah 4 di §2).
4. **Verifikasi:** buka `https://baruma.tampil.dev/login`, login dengan akun
   uji → pastikan sesi terbentuk (redirect ke `/app/dashboard`) tanpa error.
5. **Dampak:** **semua sesi NextAuth yang sedang aktif menjadi tidak valid** —
   user yang sedang login diminta login ulang saat request berikutnya (sesi
   Supabase SSO terpisah, lihat catatan `NEXT_PUBLIC_SUPABASE_*` — jika app
   share sesi dg tampil.dev via Supabase, sesi Supabase TIDAK terpengaruh oleh
   rotasi `AUTH_SECRET`, hanya jalur local-auth NextAuth murni yang ter-reset).

---

## 4. `BARUMA_JWT_SECRET` (penandatanganan JWT auth lokal — PALING KRITIS)

**Dipakai untuk:** `signToken`/`verifyToken` di `src/lib/server/auth-server.ts`
— setiap `Bearer <jwt>` yang dipakai API client & programmatic caller.
Kredensial ini yang paling kritis dari seluruh daftar: dengan secret lama yang
bocor, siapa pun bisa **memalsukan JWT untuk user manapun** (termasuk admin,
lihat BAR-SEC-01 di `docs/SECURITY_ASSESSMENT_REPORT.md`).

1. **Generate nilai baru:** `openssl rand -base64 48` (lebih panjang dari
   `AUTH_SECRET` karena ini kunci HMAC untuk JWT — makin panjang makin baik).
2. **Update GH Actions secret:** `BARUMA_JWT_SECRET` → `Update`.
3. **Deploy ulang** (lihat langkah 4 di §2).
4. **Verifikasi:**
   - `curl -X POST https://baruma.tampil.dev/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"...","password":"..."}'`
     → pastikan `accessToken` baru diterbitkan tanpa error 500.
   - Coba pakai token JWT LAMA (dari sebelum rotasi, kalau masih tersimpan di
     suatu tempat pengujian) pada endpoint terproteksi → HARUS 401.
5. **Dampak — WAJIB DIUMUMKAN KE USER SEBELUM EKSEKUSI:** setiap token JWT
   yang diterbitkan sebelum rotasi (baik dari local-auth maupun dari klien
   programmatic yang menyimpan `accessToken`) **langsung invalid**. Semua
   pemegang token itu di-logout paksa dan harus login ulang. Sesi cookie
   Supabase SSO (jalur `.tampil.dev` bersama) TIDAK terpengaruh — hanya jalur
   local-JWT yang reset.

---

## 5. DeepSeek API Key

**Konteks arsitektur:** Baruma sendiri **tidak lagi memegang** key provider
LLM langsung — sejak migrasi ke Agent Lab (`docs/superpowers/plans/2026-07-21-
agent-lab-integration.md`), semua panggilan model lewat `AGENT_LAB_URL` +
`AGENT_LAB_KEY`/`AGENT_LAB_KEY_FLOORPLAN_ACTIONS` (lihat `deploy.yml`). Key
DeepSeek yang bocor via `set-secrets.mjs`/`.claude/settings.json` versi lama
adalah key dari **arsitektur lama** (Baruma pernah memanggil DeepSeek
langsung) — tapi key itu **masih valid di akun DeepSeek** sampai dicabut,
jadi tetap wajib dirotasi meski Baruma sendiri sudah tidak memakainya.

1. **Rotasi di provider:** [platform.deepseek.com](https://platform.deepseek.com)
   → `API keys` → cari key yang cocok dengan yang tercatat di laporan
   kebocoran → `Delete`/`Revoke`.
2. **Buat key baru** HANYA jika Agent Lab (repo `tampil.dev`) masih
   mengonfigurasi DeepSeek sebagai salah satu provider LLM-nya — cek
   `agent-lab/app/models.py`/config provider di repo tersebut. Jika ya,
   simpan key baru **di secret store Agent Lab/tampil.dev**, BUKAN di GH
   Actions secret Baruma (Baruma tidak punya env `DEEPSEEK_*` sama sekali).
3. **Verifikasi:** minta admin `tampil.dev`/Agent Lab mengonfirmasi provider
   DeepSeek merespons normal (health-check Agent Lab, atau uji satu panggilan
   `chatJSON` dari Baruma yang menembus Agent Lab dan lihat balasan valid).
4. **Dampak:** tidak ada dampak langsung ke Baruma production (Baruma tidak
   memanggil DeepSeek langsung lagi) — dampak hanya ke Agent Lab bila key
   baru belum sempat dikonfigurasi ulang di sana sebelum key lama dicabut
   (jalur model DeepSeek di Agent Lab akan gagal sampai key baru terpasang).

---

## 6. NVIDIA NIM API Key

**Konteks arsitektur:** sama seperti DeepSeek — dipakai untuk enrichment
narasi alternatif desain (`src/lib/server/enrich-alternatives.ts`, komentar
"Enrich narrative via NVIDIA NIM"), tapi panggilan sesungguhnya lewat Agent
Lab, bukan key langsung di Baruma.

1. **Rotasi di provider:** [build.nvidia.com](https://build.nvidia.com) (NVIDIA
   NIM / API Catalog) → halaman API key akun → cabut key lama yang cocok
   dengan laporan kebocoran, buat key baru.
2. **Update di Agent Lab** (repo `tampil.dev`), bukan di GH Actions secret
   Baruma — sama seperti §5.
3. **Verifikasi:** trigger `POST /api/v1/projects/[id]/alternatives/generate`
   di lingkungan uji → pastikan `after()` background job (enrichment) tidak
   memicu refund kredit karena kegagalan LLM (lihat log server untuk
   `[enrich-bg]` error, atau cek `payment/credits` ledger tidak menunjukkan
   refund tak terduga).
4. **Dampak:** kegagalan sementara enrichment (bukan fatal — alternatif
   dasar tetap tampil, hanya narasi AI-nya yang fallback ke versi
   deterministik) bila key baru belum terpasang di Agent Lab saat key lama
   sudah dicabut.

---

## 7. SSH Key Deploy (`vibecoding_ed25519` / `DEPLOY_SSH_KEY`)

**Dipakai untuk:** `appleboy/ssh-action` di `deploy.yml` login ke droplet.

1. **Generate keypair baru** (di mesin admin, BUKAN di droplet):
   ```bash
   ssh-keygen -t ed25519 -f ./baruma_deploy_new -C "baruma-deploy-$(date +%Y%m%d)" -N ""
   ```
2. **Pasang public key di droplet** (masih pakai akses lama untuk masuk):
   ```bash
   ssh root@<droplet-ip> "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys" < ./baruma_deploy_new.pub
   # atau, bila sekaligus mengeksekusi §8 (user non-root):
   ssh root@<droplet-ip> "mkdir -p /home/deploy/.ssh && cat >> /home/deploy/.ssh/authorized_keys && chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys" < ./baruma_deploy_new.pub
   ```
3. **Cabut key lama:** hapus baris yang cocok dengan `vibecoding_ed25519.pub`
   lama dari `~/.ssh/authorized_keys` di droplet (`nano ~/.ssh/authorized_keys`
   atau `sed -i '/<komentar-key-lama>/d' ~/.ssh/authorized_keys`).
4. **Update GH Actions secret:** `DEPLOY_SSH_KEY` → `Update` → tempel ISI
   FILE PRIVATE KEY baru (`cat ./baruma_deploy_new`, bukan `.pub`) — hapus
   file private key lokal setelah tersimpan di GitHub (`shred -u
   ./baruma_deploy_new` atau minimal `rm`).
5. **Verifikasi:** jalankan workflow `Deploy Baruma` manual → step `Deploy
   over SSH` harus sukses connect (bukan `ssh: handshake failed`).
6. **Dampak:** tidak ada downtime app — hanya jalur deploy CI/CD yang
   terpengaruh selama transisi. Pastikan key baru terpasang (langkah 2)
   SEBELUM key lama dicabut (langkah 3) supaya tidak ada window deploy gagal.

---

## 8. Hardening `deploy.yml` — user deploy non-root (leftover TODOS P0)

`deploy.yml` sudah mendukung `secrets.DEPLOY_USER || 'root'` (fallback ke
root bila secret kosong) — bagian yang tersisa adalah membuat user non-root
di droplet dan mengisi secret-nya:

1. **Buat user `deploy` di droplet** (via SSH root):
   ```bash
   ssh root@<droplet-ip>
   adduser --disabled-password --gecos "" deploy
   usermod -aG sudo deploy   # perlu sudo untuk: apt-get install nginx (idempotent, sekali saja), systemctl reload nginx, ln -sf ke /etc/nginx/sites-enabled
   ```
2. **Serahkan kepemilikan direktori app:**
   ```bash
   mkdir -p /opt/baruma
   chown -R deploy:deploy /opt/baruma
   ```
3. **Izinkan `deploy` menjalankan HANYA perintah nginx/systemctl tanpa
   password** (lebih aman daripada full sudo) — opsional tapi direkomendasikan:
   ```bash
   cat > /etc/sudoers.d/baruma-deploy << 'EOF'
   deploy ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /bin/systemctl reload nginx, /usr/bin/apt-get install -y nginx, /bin/ln -sf * /etc/nginx/sites-enabled/*, /bin/rm -f /etc/nginx/sites-enabled/default
   EOF
   ```
   (Sesuaikan path biner dengan `which nginx`/`which systemctl` di droplet
   aktual bila berbeda.)
4. **Pasang SSH key deploy** ke `/home/deploy/.ssh/authorized_keys` (lihat
   §7 langkah 2 — lakukan sekaligus dengan rotasi key bila memungkinkan).
5. **Instal pm2 & node untuk user `deploy`** bila corepack/pm2 sebelumnya
   hanya terpasang untuk root — cek `su - deploy -c "pm2 --version"`; bila
   gagal, ulangi `corepack enable && corepack prepare pnpm@10.32.1 --activate`
   sebagai user `deploy`.
6. **Set GH Actions secret `DEPLOY_USER`** = `deploy`.
7. **Verifikasi:** jalankan workflow `Deploy Baruma` manual → step `Deploy
   over SSH` login sebagai `deploy` (bukan `root`) — log awal skrip
   (`whoami` bisa ditambah sementara untuk cek) harus menunjukkan `deploy`.
   Pastikan build, migrate, pm2 reload, dan reload nginx semuanya tetap
   sukses dengan user baru ini.
8. **Dampak:** tidak ada downtime bila langkah di atas diverifikasi di
   staging/dry-run dulu. Risiko utama: lupa memberi izin sudo yang cukup
   untuk langkah nginx (`command -v nginx` idempotent check biasanya no-op
   setelah instalasi pertama, jadi risikonya kecil setelah verifikasi awal).

---

## 9. Pasang pemantau uptime eksternal (opsional, gratis) untuk `/api/health`

Setelah `GET /api/health` tersedia (WS-A), pasang UptimeRobot (gratis, tanpa
kartu kredit) agar tim mendapat notifikasi bila `db`/app down:

1. Daftar di [uptimerobot.com](https://uptimerobot.com) (gratis).
2. `Add New Monitor` → tipe `HTTP(s)` → URL `https://baruma.tampil.dev/api/health`
   → interval 5 menit.
3. `Add New Alert Contact` → email/Slack webhook tim.
4. **Catatan:** UptimeRobot hanya mengecek status HTTP 200/503 secara
   default — untuk memverifikasi isi body (`"ok":true`), gunakan fitur
   "Keyword monitoring" dengan keyword `"ok":true`.

---

## 10. Purge histori git (`git filter-repo`)

**PRASYARAT: semua kredensial di §1–§7 SUDAH DIROTASI.** Purge histori TANPA
rotasi hanya menyembunyikan bukti, bukan mencabut akses — kredensial lama
tetap berfungsi di provider sampai dicabut secara eksplisit.

File yang perlu di-purge (per `TODOS.md`):
- `set-secrets.mjs` (di history, sudah tidak tracked di HEAD)
- `.claude/settings.json` versi LAMA yang berisi key DeepSeek (versi HEAD saat
  ini SUDAH bersih — lihat catatan di bawah — tapi versi lama di history
  masih menyimpan key tsb)
- `scripts/test-prod-agent.mjs` (baru saja dihapus dari tracking di WS-A ini
  — berisi session token/JWT prod hidup; masih ada di history sejak commit
  yang menambahkannya)

> Catatan `.claude/settings.json`: diperiksa saat eksekusi WS-A (2026-08-23)
> — versi HEAD saat ini HANYA berisi daftar `permissions.allow` (izin
> command Claude Code), TIDAK ada secret apa pun. Tetap masuk daftar purge di
> bawah karena versi LAMA di history (sebelum dibersihkan) menyimpan key
> DeepSeek per catatan TODOS.md.

### 10.1 Instal `git-filter-repo`

```bash
# Debian/Ubuntu
sudo apt-get install -y git-filter-repo
# atau via pip
pip install git-filter-repo
```

### 10.2 Backup dulu (wajib)

```bash
cd /path/ke/clone/bersih/baruma
git clone --mirror https://github.com/rfq13/baruma.git baruma-backup-sebelum-purge.git
```
Simpan `baruma-backup-sebelum-purge.git` di lokasi aman offline sampai purge
dipastikan berhasil dan tidak ada masalah selama ≥1 minggu.

### 10.3 Jalankan purge pada clone BARU (bukan working copy harian)

```bash
git clone https://github.com/rfq13/baruma.git baruma-purge
cd baruma-purge
git filter-repo --path set-secrets.mjs --path .claude/settings.json --path scripts/test-prod-agent.mjs --invert-paths
```
`--invert-paths` berarti "hapus path yang disebut, pertahankan sisanya" —
`git filter-repo` menulis ulang SETIAP commit dalam history yang menyentuh
file-file itu (hash commit berubah, termasuk turunan setelahnya).

### 10.4 Verifikasi hasil purge

```bash
git log --all --full-history -- set-secrets.mjs .claude/settings.json scripts/test-prod-agent.mjs
# Harus KOSONG (tidak ada output) untuk ketiganya.
```

### 10.5 Force-push (DESTRUKTIF — koordinasi tim dulu)

```bash
git remote add origin https://github.com/rfq13/baruma.git   # filter-repo menghapus remote 'origin' demi keamanan
git push origin --force --all
git push origin --force --tags
```

**Caveat force-push:**
- **Setiap clone lokal lain (termasuk clone CI runner cache, clone anggota
  tim lain) menjadi divergen** — hash commit lama tidak lagi ada di remote.
  Siapa pun yang `git pull` biasa di clone lama akan mengalami konflik
  history yang membingungkan.
- **PR terbuka yang berbasis commit lama** kemungkinan perlu di-rebase ulang
  atau dibuat ulang dari branch baru hasil clone `baruma-purge`.
- **GitHub Actions cache** (dependency cache, dsb.) yang mereferensikan hash
  commit lama tetap aman (cache key biasanya berbasis lockfile hash, bukan
  commit hash) tapi ada baiknya di-invalidate manual sekali via
  `Actions → Caches` bila ragu.
- **Branch protection rules** pada `main` yang me-require status checks bisa
  memblokir force-push — nonaktifkan sementara `Require branches to be
  up to date` / izinkan force-push untuk admin selama proses ini, aktifkan
  kembali setelahnya.

### 10.6 Instruksi re-clone untuk SETIAP anggota tim

Kirim pesan ini ke semua kontributor setelah force-push sukses:

```
Histori git repo Baruma baru saja di-purge (hapus kredensial bocor dari
histori). WAJIB re-clone bersih — JANGAN git pull di clone lama:

  mv baruma baruma-OLD-JANGAN-DIPAKAI   # atau hapus setelah pastikan tak ada kerja belum di-push
  git clone https://github.com/rfq13/baruma.git
  cd baruma
  # pindahkan manual perubahan belum ter-push dari baruma-OLD-JANGAN-DIPAKAI/ jika ada,
  # via git diff / cherry-pick dari branch yang masih berbasis history lama —
  # BUKAN dengan menyalin .git secara langsung.
```

### 10.7 Verifikasi akhir

- [ ] `git clone https://github.com/rfq13/baruma.git` bersih dari mesin lain
      → `git log --all -- set-secrets.mjs .claude/settings.json
      scripts/test-prod-agent.mjs` kosong.
- [ ] Workflow `Deploy Baruma` tetap berjalan normal dari branch `main` yang
      baru (hash commit sudah berubah, tapi konten sama).
- [ ] Simpan `baruma-backup-sebelum-purge.git` selama masa observasi, lalu
      hapus/arsipkan offline setelah dipastikan tidak dibutuhkan.

---

## Ringkasan urutan eksekusi

1. §1 GitHub PAT
2. §2 Password Postgres
3. §3 `AUTH_SECRET`
4. §4 `BARUMA_JWT_SECRET` (umumkan dulu ke user — logout massal)
5. §5 DeepSeek key
6. §6 NVIDIA key
7. §7 SSH deploy key
8. §8 Hardening non-root deploy user
9. §9 (opsional) Pasang UptimeRobot
10. §10 Purge histori git filter-repo + force-push + re-clone tim

Setiap langkah independen — boleh dieksekusi terpisah di sesi berbeda, TAPI
§10 (purge history) harus paling akhir, setelah §1–§7 selesai.
