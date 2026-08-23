/**
 * Kuitansi PDF sederhana (A5) untuk satu transaksi — tombol unduh di baris
 * "Riwayat transaksi" (/app/billing). `jsPDF` di-import LAZY di dalam fungsi
 * (bukan di top-level module) supaya modul ini ringan sampai user benar-benar
 * mengklik unduh, sama seperti pola src/lib/exports/generate.ts.
 */
import type { TransactionRow } from "@/types"

const idr = (n: number): string =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n)

function formatDate(iso: string | null): string {
  if (!iso) return "-"
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
}

/** Bangun Blob PDF kuitansi A5 untuk satu baris riwayat transaksi. */
export async function buildReceiptPdf(row: TransactionRow): Promise<Blob> {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5" })

  const marginX = 14
  let y = 18

  doc.setFontSize(16)
  doc.setFont("helvetica", "bold")
  doc.text("Baruma", marginX, y)
  doc.setFontSize(10)
  doc.setFont("helvetica", "normal")
  doc.text("Kuitansi pembayaran", marginX, (y += 6))

  y += 6
  doc.setDrawColor(200)
  doc.line(marginX, y, 148 - marginX, y)
  y += 8

  const rows: Array<[string, string]> = [
    ["No. pesanan", row.providerOrderId ?? row.id],
    ["Plan", row.planName],
    ["Nominal", idr(row.priceIdr)],
    ["Tanggal transaksi", formatDate(row.createdAt)],
    ["Periode aktif s/d", formatDate(row.currentPeriodEnd)],
    ["Status", row.status === "active" ? "LUNAS" : row.status],
  ]

  doc.setFontSize(11)
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "normal")
    doc.text(label, marginX, y)
    doc.setFont("helvetica", "bold")
    doc.text(value, 148 - marginX, y, { align: "right" })
    y += 8
  }

  y += 6
  doc.setDrawColor(200)
  doc.line(marginX, y, 148 - marginX, y)
  y += 10

  doc.setFontSize(18)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(22, 163, 74)
  doc.text("LUNAS", 74, y, { align: "center" })
  doc.setTextColor(0, 0, 0)

  y += 14
  doc.setFontSize(8)
  doc.setFont("helvetica", "normal")
  doc.text(
    "Kuitansi ini dibuat otomatis oleh Baruma sebagai bukti pembayaran.",
    74,
    y,
    { align: "center" }
  )

  return doc.output("blob")
}

/** Nama file unduhan untuk satu baris riwayat transaksi. */
export function receiptFilename(row: TransactionRow): string {
  const order = (row.providerOrderId ?? row.id).replace(/[^a-zA-Z0-9-]+/g, "-")
  return `kuitansi-baruma-${order}.pdf`
}
