/**
 * Template email transaksional — fungsi murni yang mengembalikan HTML inline-
 * style sederhana (id-ID), tanpa dependensi build-time (aman dipanggil dari
 * mana saja: route handler, cron). Dipakai oleh src/lib/server/email.ts's
 * caller-caller (register, webhook payment, cron maintenance).
 */

const BRAND_COLOR = "#0f172a"
const ACCENT_COLOR = "#2563eb"

function formatIDR(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
}

/** Kerangka HTML bersama — header brand + footer kecil, konsisten di semua template. */
function shell(title: string, bodyHtml: string): string {
  return `
<!DOCTYPE html>
<html lang="id-ID">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:${BRAND_COLOR};padding:20px 28px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.02em;">Baruma</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 16px;font-size:18px;color:#18181b;">${title}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;border-top:1px solid #e4e4e7;">
                <p style="margin:0;font-size:12px;color:#71717a;">
                  Email ini dikirim otomatis oleh Baruma. Jika Anda tidak
                  mengenali aktivitas ini, abaikan email ini.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim()
}

/** Dikirim setelah registrasi berhasil (POST /api/v1/auth/register). */
export function welcomeEmail(name: string): string {
  return shell(
    `Selamat datang, ${name}!`,
    `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3f3f46;">
      Akun Baruma Anda sudah aktif. Mulai dari brief lahan &amp; kebutuhan
      ruang, Baruma membantu menyusun alternatif denah, model 3D, dan RAB
      awal untuk rumah Anda.
    </p>
    <a href="https://baruma.tampil.dev/app/dashboard"
       style="display:inline-block;padding:10px 20px;background:${ACCENT_COLOR};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      Buka Dashboard
    </a>`
  )
}

/** Dikirim saat aktivasi plan berhasil (webhook payment, outcome "paid"). */
export function receiptEmail(input: {
  planName: string
  priceIdr: number
  periodEnd: string
  orderId: string
}): string {
  return shell(
    "Pembayaran berhasil — kuitansi",
    `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3f3f46;">
      Terima kasih. Pembayaran Anda untuk plan <strong>${input.planName}</strong>
      telah kami terima dan langganan Anda sudah aktif.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#18181b;margin-bottom:16px;">
      <tr>
        <td style="padding:6px 0;color:#71717a;">No. pesanan</td>
        <td style="padding:6px 0;text-align:right;font-weight:600;">${input.orderId}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#71717a;">Plan</td>
        <td style="padding:6px 0;text-align:right;font-weight:600;">${input.planName}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#71717a;">Nominal</td>
        <td style="padding:6px 0;text-align:right;font-weight:600;">${formatIDR(input.priceIdr)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#71717a;">Aktif sampai</td>
        <td style="padding:6px 0;text-align:right;font-weight:600;">${formatDate(input.periodEnd)}</td>
      </tr>
    </table>
    <a href="https://baruma.tampil.dev/app/billing"
       style="display:inline-block;padding:10px 20px;background:${ACCENT_COLOR};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      Lihat billing
    </a>`
  )
}

/** Dikirim H-7 (atau kurang) sebelum langganan berakhir (cron maintenance). */
export function renewalReminderEmail(input: {
  planName: string
  daysLeft: number
  periodEnd: string
}): string {
  const dayLabel = input.daysLeft <= 0 ? "hari ini" : `${input.daysLeft} hari lagi`
  return shell(
    "Langganan Anda akan segera berakhir",
    `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3f3f46;">
      Plan <strong>${input.planName}</strong> Anda berakhir <strong>${dayLabel}</strong>
      (${formatDate(input.periodEnd)}). Perpanjang sekarang supaya kredit AI
      dan fitur plan Anda tidak terputus.
    </p>
    <a href="https://baruma.tampil.dev/app/billing"
       style="display:inline-block;padding:10px 20px;background:${ACCENT_COLOR};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      Perpanjang sekarang
    </a>`
  )
}

/** Dikirim saat langganan resmi berakhir & profil diturunkan ke Free (cron maintenance). */
export function expiredEmail(input: { planName: string }): string {
  return shell(
    "Langganan Anda telah berakhir",
    `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3f3f46;">
      Plan <strong>${input.planName}</strong> Anda telah berakhir dan akun
      Anda kini kembali ke plan Free. Data &amp; proyek Anda tetap aman —
      upgrade kapan saja untuk mengaktifkan kembali fitur plan Anda.
    </p>
    <a href="https://baruma.tampil.dev/app/billing"
       style="display:inline-block;padding:10px 20px;background:${ACCENT_COLOR};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
      Upgrade plan
    </a>`
  )
}
