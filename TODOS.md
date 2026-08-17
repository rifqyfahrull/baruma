# TODOS — Pekerjaan Tertunda Baruma

> Sumber kebenaran tunggal untuk pekerjaan yang belum selesai / sengaja ditunda.
> Dibuat 2026-08-09. Update saat item ditutup.

---

## 🔴 P0 — Keamanan (WAJIB, sebagian butuh aksi manual)

Detail lengkap + exploit di `.gstack/security-reports/2026-08-09-cso-comprehensive.json`.

- [ ] **Rotasi SEMUA kredensial yang bocor** (hanya bisa dilakukan pemilik akun; masih valid sampai dicabut):
  - GitHub PAT `ghp_cnf5…` · password DB Postgres prod · `AUTH_SECRET` · **`BARUMA_JWT_SECRET`** (bisa forge JWT siapa pun) · DeepSeek key · NVIDIA key · SSH key `vibecoding_ed25519`.
  - Sumber bocor: `set-secrets.mjs` (commit `14195b8`, untracked tapi masih di history) + `.claude/settings.json` (key DeepSeek — sudah dihapus dari HEAD, masih di history).
- [ ] **Purge history**: `git filter-repo --path set-secrets.mjs --path .claude/settings.json --invert-paths` lalu force-push. (Rotasi tetap wajib walau history dipurge.)
- [x] ~~SSRF unauth `faucet-check/chat`~~ **SELESAI** (commit `a2a2de4`): requireAdmin + allowlist host + env key tak dikirim ke baseUrl pemanggil.
- [x] ~~Disclosure unauth `faucet-check/asset-workflow`~~ **SELESAI** (`a2a2de4`): requireAdmin + berhenti echo host/nama DB.
- [~] **Hardening `deploy.yml`** — SEBAGIAN (`a2a2de4`): action di-pin SHA, token via http.extraheader (tak persist di config), user non-root via secret DEPLOY_USER. SISA manual: buat user deploy non-root + deploy key read-only di droplet, lalu set secret DEPLOY_USER.
- [x] ~~Rate-limit login/register + faucet~~ **SELESAI** (`a2a2de4`): in-memory fixed-window (login IP+akun, register, faucet). MCP rate-limit = keputusan produk, belum dipasang.

## 🟡 P1 — Gap fasad tertunda (butuh perubahan struktural, di-scope terpisah)

Konteks lengkap di `ANALISA_FASAD_RUMAH_DEPAN.md` §0.

- [x] ~~Cantilever massing~~ **Track A + Track B SELESAI**: MVP overhang_slab (`ddc2878`) + massing sungguhan `Floor.offsetM` (CB1–CB4: `35c983a`/`a97dedb`/`19f6340`/`5e6014e`) — lantai atas menjorok di 3D + tampak/potongan + footprint/RAB sadar-offset, UI kontrol geser X/Y + indikator denah, validasi struktural.
- [x] ~~Jendela bulat / porthole~~ **Track A + Track B SELESAI**: MVP torus+disc (`999845c`) + lubang membulat oktagon (corner-fill wall-box) + validasi ukuran (`70fa93a`). Pendekatan additive aman (tanpa rewrite pemotongan-dinding).

## 🟢 P2 — Kebersihan kode / teknis

- [ ] **Hapus dead code `InteriorWorkspace` / `InteriorRoomScene`** — halaman interior tinggal `redirect()` stub; komponen tak lagi dirender setelah pemisahan `interior-controls.tsx` + `furniture-color.ts`. (Lihat [[baruma-bundle-baseline]].)
- [ ] **`xlsx@0.18.5`** (SheetJS) punya CVE prototype-pollution/ReDoS historis. App hanya menulis (tidak parse untrusted), jadi risiko rendah — pertimbangkan pindah ke build resmi `cdn.sheetjs.com`.
- [ ] **Test merah pre-existing**: `src/components/layout/floating-panel.test.tsx` (13 gagal) — sudah gagal sebelum semua perubahan sesi ini (terverifikasi via `git stash`). Perlu diselidiki terpisah.
- [ ] **CSP penuh** — `next.config.ts` baru memasang header aman non-CSP + CSP minimal (`frame-ancestors`/`object-src`). CSP `script-src` ketat perlu dites report-only (Next + R3F pakai inline script) sebelum di-enforce.

## 📦 Belum di-commit (working tree)

Perubahan lintas sesi yang belum masuk git — sarankan dipecah jadi commit logis:
- **perf**: optimasi bundle (lazy 3D asset, split mock, lazy export, dll) — *sudah di-commit `149a717`*.
- ~~security/feat(facade)/docs~~ — **sudah di-commit** sebagai `83242d7` (satu commit gabungan, ter-push).
