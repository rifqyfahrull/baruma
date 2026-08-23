# Runbook: Restore Database dari Backup

Backup harian dibuat otomatis oleh `scripts/backup-db.mjs` (dipicu cron di
droplet, lihat `.github/workflows/deploy.yml`) — format custom `pg_dump`,
di-gzip, disimpan di object storage S3-compatible di bawah key
`backups/db/<YYYY-MM-DD>.dump.gz`, retensi 14 hari (backup lebih tua
otomatis dihapus setiap kali cron jalan — lihat `scripts/backup-db-lib.mjs`
untuk logika retensi, diuji di `src/lib/server/backup-db-lib.test.ts`).

Dokumen ini adalah prosedur restore + pengingat uji rutin.

---

## Kapan dipakai

- Korupsi data akibat bug aplikasi (mis. migrasi salah, penulisan massal keliru).
- Kehilangan data akibat kesalahan operator (`DELETE` tanpa `WHERE` dsb.).
- Disaster recovery penuh (droplet/DB hilang total).

**Restore MENIMPA data saat ini** — untuk investigasi tanpa risiko, restore
ke database/instance TERPISAH dulu (lihat §2 opsi B), baru putuskan apakah
perlu menimpa produksi.

---

## 1. Unduh backup dari object storage

Backup disimpan di bucket yang sama dengan aset (`STORAGE_BUCKET`), key
`backups/db/<tanggal>.dump.gz`. Tanpa AWS CLI terpasang, unduh via `curl`
dengan signed URL, atau tulis skrip satu-baris pakai `aws4fetch` (pola yang
sama seperti `scripts/backup-db.mjs`):

```bash
node -e '
import("aws4fetch").then(async ({ AwsClient }) => {
  const client = new AwsClient({
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
    region: process.env.STORAGE_REGION || "auto",
    service: "s3",
  })
  const url = `${process.env.STORAGE_ENDPOINT}/${process.env.STORAGE_BUCKET}/backups/db/2026-08-23.dump.gz`
  const res = await client.fetch(url, { method: "GET" })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const fs = await import("node:fs")
  fs.writeFileSync("restore.dump.gz", Buffer.from(await res.arrayBuffer()))
  console.log("saved restore.dump.gz")
})
'
```
(Jalankan dari root repo dengan `STORAGE_*` env sudah di-export, atau
`.env.local` yang berisi nilainya sudah ada di cwd.)

Ganti tanggal pada URL sesuai backup yang ingin dipulihkan. Daftar backup
yang tersedia bisa dicek lewat dashboard provider storage, atau via
`ListObjectsV2` (lihat `listBackupObjects()` di `scripts/backup-db.mjs`
sebagai referensi implementasi).

## 2. Ekstrak dan restore

```bash
gunzip -k restore.dump.gz   # -k = keep original .gz, hasilkan restore.dump
```

### Opsi A — Restore MENIMPA database produksi saat ini (destruktif)

```bash
# WAJIB backup keadaan saat ini dulu sebagai jaring pengaman ekstra:
node scripts/backup-db.mjs   # atau pg_dump manual ke file terpisah

pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" restore.dump
```
- `--clean --if-exists`: drop objek yang ada sebelum recreate (idempotent,
  tidak error kalau objek belum ada).
- `--no-owner`: jangan coba set OWNER TO (role di backup bisa beda dengan
  role tujuan restore).

### Opsi B — Restore ke database TERPISAH untuk investigasi (aman, disarankan lebih dulu)

```bash
createdb -h <host> -U <role> baruma_restore_check
pg_restore --no-owner --dbname="postgres://<role>:<pass>@<host>:5432/baruma_restore_check" restore.dump
psql "postgres://<role>:<pass>@<host>:5432/baruma_restore_check" -c "select count(*) from profiles;"
# ...validasi data sesuai kebutuhan, baru putuskan lanjut ke Opsi A bila perlu.
dropdb -h <host> -U <role> baruma_restore_check   # bersihkan setelah selesai
```

## 3. Setelah restore ke produksi (Opsi A)

1. Jalankan `node scripts/migrate.mjs` — pastikan `schema_migrations` di
   backup yang di-restore konsisten dengan migrasi terbaru (idempotent by
   design, aman dijalankan ulang).
2. Restart app: `pm2 reload baruma` (di droplet).
3. Verifikasi `GET /api/health` → `"ok":true`.
4. Smoke-test manual: login, buka satu project, cek data terlihat benar.
5. Umumkan ke tim/user bila ada data yang hilang antara waktu backup dan
   waktu insiden (window data-loss = usia backup yang dipakai).

---

## 4. Pengingat uji restore rutin (KUARTALAN)

Backup yang tidak pernah diuji restore-nya adalah backup yang tidak bisa
dipercaya. **Setiap kuartal** (Jan/Apr/Jul/Okt — set pengingat kalender):

- [ ] Unduh backup terbaru dari storage (§1).
- [ ] Restore ke database sementara terpisah (§2 Opsi B).
- [ ] Validasi jumlah baris tabel inti (`profiles`, `projects`,
      `subscriptions`) masuk akal dibanding produksi saat ini.
- [ ] Catat hasil (berhasil/gagal + durasi) di sini atau di channel tim —
      kalau restore pernah gagal diam-diam, ini satu-satunya cara ketahuan
      sebelum benar-benar dibutuhkan saat insiden nyata.
- [ ] Hapus database sementara (`dropdb`) setelah selesai.

| Kuartal | Tanggal uji | Hasil | Catatan |
| --- | --- | --- | --- |
| (isi setelah uji pertama) | | | |
