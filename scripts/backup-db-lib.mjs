/**
 * Bagian MURNI (tanpa I/O) dari backup-db.mjs — dipisah supaya bisa diuji
 * dengan vitest tanpa menyentuh Postgres/S3 sungguhan. Lihat
 * src/lib/server/backup-db-lib.test.ts.
 */

const KEY_PREFIX = "backups/db"

/** `YYYY-MM-DD` UTC dari sebuah Date — dipakai sebagai nama file backup. */
export function dateStamp(date) {
  return date.toISOString().slice(0, 10)
}

/** Key S3 untuk backup pada tanggal tertentu: `backups/db/<YYYY-MM-DD>.dump.gz`. */
export function backupKeyFor(date) {
  return `${KEY_PREFIX}/${dateStamp(date)}.dump.gz`
}

/**
 * Dari daftar objek S3 (`{key, lastModified: Date}`) di bawah prefix backup,
 * kembalikan key yang HARUS DIHAPUS: lebih tua dari `retentionDays` dari
 * `now`, DAN berada di bawah `backups/db/` (defensif — abaikan objek lain
 * seandainya prefix listing pernah keliru scope), DAN diakhiri `.dump.gz`
 * (jangan pernah hapus objek lain yang kebetulan nyasar di prefix yang sama).
 */
export function keysToDelete(objects, now, retentionDays) {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000
  return objects
    .filter(
      (o) =>
        o.key.startsWith(`${KEY_PREFIX}/`) &&
        o.key.endsWith(".dump.gz") &&
        o.lastModified.getTime() < cutoff
    )
    .map((o) => o.key)
}

export const BACKUP_KEY_PREFIX = KEY_PREFIX
