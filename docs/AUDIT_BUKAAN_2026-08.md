# Audit Bukaan Pintu/Jendela — Temuan DB Produksi (2026-08-01)

Audit `design_layouts` di DB `baruma` terhadap aturan
[domain-knowledge-pintu.md](../domain-knowledge/domain-knowledge-pintu.md) §1:

> Sisakan clearance minimal 10–15 cm dari engsel pintu ke dinding/sudut terdekat
> agar daun pintu bisa membuka penuh 90°.
> Kusen pintu idealnya tidak diletakkan persis di sudut ruangan.

Reproduksi: `node scripts/audit-openings.mjs` (read-only, tidak menulis ke DB).

## Ringkasan

**37 dari 198 bukaan (19%) bermasalah, tersebar di 16 denah.**

| Jenis pelanggaran | Jumlah |
| --- | --- |
| `mepet_ujung` (< 15 cm dari ujung dinding) | 35 |
| `menumpang_pertemuan_tembok` (separuh daun di ruang lain) | 4 |
| `selebar_penuh_dinding` (bukaan = 100% dinding) | 3 |
| `keluar_dinding` (menjorok, sisa negatif) | 1 |

Semua ini **data warisan**: lahir dari generator & jalur LLM sebelum commit
`3125b38` menegakkan clearance. Kode saat ini tidak bisa lagi menghasilkannya.

## Pola, bukan cacat acak

Dua pola terulang di banyak proyek aset — satu kesalahan template yang
direplikasi:

1. **Pintu utama `Ruang tamu:n`, `positionM: 0.5`, lebar 0.9 m → sisa 5 cm.**
   Muncul identik di 12 proyek aset (`rumah-2-lantai`, `rumah-3-kamar`, `casa`,
   `farmhouse`, `tipe-36`, `tipe-60`, `modern-box`, `minimalis-modern`,
   `atap-miring`, `mungil`, `sederhana`, …).
2. **Pintu `Taman belakang:n`, `positionM: 1.2`, lebar 2.4 m → sisa persis 0.**
   Tepi pintu tepat di sudut. Muncul di 9 proyek aset.

Karena sumbernya template yang sama, memperbaiki generator/seed template lebih
hemat daripada menambal 21 baris data satu per satu.

## Kasus yang mustahil secara fisik

Ini bukan sekadar "kurang ideal" — geometrinya tidak bisa dibangun:

| Proyek | Bukaan | Masalah |
| --- | --- | --- |
| `proj-modern-tropis-1` | `a-door-entry` (Ruang Tamu:s) | sisa **−0.10 m** — pintu menjorok keluar dinding |
| `proj-asset-rumah-mungil` | Dapur:s, jendela 2.4 m | dinding **2.4 m** — bukaan selebar seluruh dinding |
| `proj-asset-rumah-mungil` | Kamar mandi:s, jendela 1.8 m | dinding **1.8 m** — idem |
| `proj-asset-rumah-mungil` | Taman belakang:n, pintu 1.8 m | dinding **1.8 m** — idem |

## Proyek pengguna nyata

Bukan hanya aset demo:

- **`proj-sKeE6zh-` (Rumah Qyfa) — 8 dari 19 bukaan bermasalah.** Terparah:
  `Kamar 2:e` sisa **1 cm**, `Void:s` sisa 4 cm, `Balkon:s` sisa 0.
  Catatan: data DB sudah **berbeda** dari fixture test
  `src/lib/three/__fixtures__/rumah-qyfa-layout.json` (fixture = snapshot lama,
  sudah dikoreksi di `3125b38`).
- **`proj-modern-tropis-1` — 3 bermasalah**, termasuk satu `keluar_dinding`.
- **`proj-jo48M6h4` — 1** (`Carport:s` sisa 12 cm).

## Status & langkah lanjut

**Belum ada data DB yang diubah** — sesuai keputusan owner: audit dulu.

Opsi koreksi, dari paling sempit:

1. **Hanya yang mustahil fisik** (4 bukaan di atas) — dampak visual paling
   nyata, risiko paling kecil.
2. **Perbaiki sumber template aset** — menghapus akar 21 pelanggaran berulang;
   data lama tetap perlu migration terpisah.
3. **Migration koreksi menyeluruh (0024)** — hitung ulang 37 posisi ke titik
   sah terdekat via `freeDoorPosition`, ukuran & jenis tidak diubah.

Catatan penting untuk opsi mana pun: menggeser bukaan yang
`menumpang_pertemuan_tembok` **memindahkan bukaan itu ke ruang lain**, artinya
mengubah ruang mana yang mendapat cahaya. Itu keputusan desain, bukan koreksi
mekanis — perlu ditinjau per kasus.

Semua tabel Baruma dimiliki role `baruma_app`; migration yang dijalankan sebagai
`postgres` akan membuat objek baru dimiliki `postgres` dan memicu 500
("permission denied"). Sertakan `ALTER TABLE … OWNER TO baruma_app` bila ada DDL.
