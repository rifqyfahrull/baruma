/**
 * Validasi env saat boot server — dipanggil dari `register()` di
 * src/instrumentation.ts, yang Next menjalankan SEKALI sebelum server siap
 * menerima request (lihat node_modules/next/dist/docs/.../instrumentation.md).
 *
 * Kenapa ini penting: tanpa validasi ini, deploy dengan `DATABASE_URL` hilang
 * (mis. secret GitHub Actions kosong/typo) diam-diam JATUH KE memory-fallback
 * (lihat src/lib/data/source.ts) — app tampak jalan tapi setiap data hilang
 * saat proses restart, tanpa peringatan apa pun. Di produksi, kita ingin
 * CRASH KERAS dengan pesan jelas saat deploy, bukan kegagalan senyap yang
 * baru ketahuan user melapor "data saya hilang".
 *
 * `validateProductionEnv` adalah FUNGSI MURNI (input env → daftar pesan
 * error) supaya gampang diuji tanpa perlu memanipulasi process.env global —
 * lihat env-check.test.ts.
 */

export type EnvLike = Record<string, string | undefined>

type RequiredVar = {
  key: string
  label: string
}

const REQUIRED_VARS: RequiredVar[] = [
  { key: "DATABASE_URL", label: "DATABASE_URL (koneksi Postgres)" },
  { key: "BARUMA_JWT_SECRET", label: "BARUMA_JWT_SECRET (penandatanganan token auth)" },
  { key: "AUTH_SECRET", label: "AUTH_SECRET (sesi NextAuth)" },
]

/**
 * Mengembalikan daftar pesan error (Indonesia) untuk setiap pelanggaran
 * konfigurasi produksi. Array kosong = env valid, boleh boot.
 *
 * Hanya dipanggil dengan efek (throw) saat `NODE_ENV === "production"` —
 * pemanggil (instrumentation.ts) yang memutuskan kapan menegakkan ini;
 * fungsi ini sendiri tidak peduli NODE_ENV, murni mengecek nilai yang diberi.
 */
export function validateProductionEnv(env: EnvLike): string[] {
  const errors: string[] = []

  for (const { key, label } of REQUIRED_VARS) {
    const value = env[key]
    if (!value || value.trim().length === 0) {
      errors.push(`${label} kosong/tidak diset`)
    }
  }

  // NEXT_PUBLIC_DATA_SOURCE="mock" berarti app memakai data in-memory palsu
  // (lihat src/lib/data/source.ts) — tidak boleh pernah terjadi di produksi,
  // sekalipun semua secret di atas terisi, karena berarti seseorang lupa
  // set "http" (atau env ini justru sengaja/tak sengaja di-override).
  if (env.NEXT_PUBLIC_DATA_SOURCE === "mock") {
    errors.push(
      'NEXT_PUBLIC_DATA_SOURCE="mock" — produksi WAJIB "http", bukan data palsu in-memory'
    )
  }

  return errors
}

/**
 * Dipanggil dari instrumentation.ts saat boot. Di produksi dengan pelanggaran
 * → throw (crash loud, proses berhenti, pm2 tidak menganggap server siap).
 * Di non-produksi → console.warn saja (dev/test boleh jalan tanpa semua secret).
 */
export function assertProductionEnv(env: EnvLike = process.env): void {
  if (env.NODE_ENV !== "production") {
    const errors = validateProductionEnv(env)
    if (errors.length > 0) {
      console.warn(
        `[env-check] (non-produksi, tidak menghentikan boot) ${errors.length} variabel env belum lengkap untuk produksi:\n` +
          errors.map((e) => `  - ${e}`).join("\n")
      )
    }
    return
  }

  const errors = validateProductionEnv(env)
  if (errors.length > 0) {
    throw new Error(
      `[env-check] Boot produksi DIBATALKAN — konfigurasi env tidak valid:\n` +
        errors.map((e) => `  - ${e}`).join("\n") +
        "\n\nPerbaiki secret GitHub Actions terkait di deploy.yml lalu deploy ulang. " +
        "App TIDAK boleh jalan diam-diam dengan konfigurasi ini (mis. jatuh ke memory-fallback)."
    )
  }
}
