import Link from "next/link"
import { Keyboard, Mail, MessageCircleQuestion } from "lucide-react"

import { PageHeader } from "@/components/shared/page-header"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/** Placeholder sampai email support resmi ditetapkan — lihat .env.example. */
const DEFAULT_SUPPORT_EMAIL = "support@baruma.id"

/**
 * Halaman Bantuan (WS-E §3) — FAQ inti journey + shortcut keyboard nyata +
 * kontak. Isi HANYA fakta yang bisa diverifikasi di kode (biaya kredit dari
 * src/app/api/v1/projects/[id]/{agent,alternatives/generate,brief/assistant,
 * editor/assistant}/route.ts, format export dari EXPORT_META di
 * src/lib/constants/index.ts, batas plan dari plan-defaults.ts, shortcut dari
 * src/app/app/projects/[projectId]/editor/page.tsx + command-menu.tsx) —
 * TIDAK ada fitur yang diiklankan tapi belum ada di kode.
 */
export default function HelpPage() {
  const supportEmail =
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || DEFAULT_SUPPORT_EMAIL

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Bantuan"
        description="Pertanyaan umum, pintasan keyboard, dan cara menghubungi kami."
      />

      <section id="faq" className="space-y-4">
        <div className="flex items-center gap-2">
          <MessageCircleQuestion className="size-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">
            Pertanyaan umum
          </h2>
        </div>

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="kredit">
            <AccordionTrigger>
              Apa itu kredit, dan aksi apa saja yang memakainya?
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <p>
                Kredit dipakai HANYA saat Baruma benar-benar memanggil AI.
                Aksi yang berhasil memotong 1 kredit; bila prosesnya gagal,
                kredit itu otomatis dikembalikan. Aksi lain (perhitungan
                deterministik, tanpa AI) selalu gratis.
              </p>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Aksi</TableHead>
                      <TableHead>Biaya</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Pesan ke asisten AI (Brief, Editor 2D, Alternatif)</TableCell>
                      <TableCell>1 kredit</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Generate ulang alternatif layout</TableCell>
                      <TableCell>1 kredit</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Audit &amp; validasi layout (Cek)</TableCell>
                      <TableCell>Gratis</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Hitung/edit RAB, review &amp; komentar</TableCell>
                      <TableCell>Gratis</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Semua export (PDF, Excel, DXF, GLB, ZIP)</TableCell>
                      <TableCell>Gratis*</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                *Beberapa format export (DXF, ZIP All) hanya tersedia di plan
                Pro/Studio — lihat pertanyaan &quot;Format apa saja yang bisa
                diekspor&quot; di bawah, bukan biaya kredit tambahan.
              </p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="share">
            <AccordionTrigger>
              Bagaimana cara membagikan project ke kontraktor?
            </AccordionTrigger>
            <AccordionContent className="space-y-2">
              <p>
                Buka project, klik nama project di bar tengah atas, lalu pilih
                &quot;Bagikan…&quot;. Baruma membuat tautan publik yang bisa
                dibuka siapa pun TANPA login — penerima melihat denah, 3D, RAB,
                dan bisa mengirim komentar dengan nama mereka sendiri. Salin
                tautannya atau kirim langsung lewat WhatsApp dari dialog yang
                sama.
              </p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="disclaimer">
            <AccordionTrigger>
              Apa arti label &quot;draft&quot; dan disclaimer di RAB/gambar kerja?
            </AccordionTrigger>
            <AccordionContent className="space-y-2">
              <p>
                Semua hasil Baruma (denah, RAB, gambar kerja) adalah{" "}
                <strong>draft awal untuk diskusi</strong>, bukan dokumen final
                yang siap dipakai membangun. Perhitungan struktur memakai
                pendekatan sederhana (gravity-only) — setiap gambar kerja
                mencantumkan peringatan wajib: &quot;Perhitungan pendekatan —
                wajib diverifikasi insinyur struktur berlisensi sebelum
                konstruksi (persyaratan PBG).&quot; Status &quot;Kesiapan&quot;
                pada tiap project (Konsep Siap / Siap Diskusi Kontraktor /
                Perlu Review Engineer / Disetujui Engineer) menunjukkan
                seberapa matang desain itu untuk dieksekusi.
              </p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="export">
            <AccordionTrigger>
              Format apa saja yang bisa diekspor, dan untuk siapa?
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Format</TableHead>
                      <TableHead>Untuk siapa</TableHead>
                      <TableHead>Plan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Contractor Pack (PDF)</TableCell>
                      <TableCell>Kontraktor &amp; tukang</TableCell>
                      <TableCell>Semua plan</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Interior Pack (PDF)</TableCell>
                      <TableCell>Vendor interior</TableCell>
                      <TableCell>Semua plan</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Gambar Kerja (PDF)</TableCell>
                      <TableCell>Kontraktor &amp; tukang</TableCell>
                      <TableCell>Semua plan</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>RAB (Excel)</TableCell>
                      <TableCell>Kontraktor &amp; QS</TableCell>
                      <TableCell>Semua plan</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>GLB 3D</TableCell>
                      <TableCell>Klien &amp; tim</TableCell>
                      <TableCell>Semua plan</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>DXF CAD</TableCell>
                      <TableCell>Drafter / arsitek</TableCell>
                      <TableCell>Pro / Studio</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>ZIP semua file</TableCell>
                      <TableCell>Semua pihak</TableCell>
                      <TableCell>Pro / Studio</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>IFC BIM Basic</TableCell>
                      <TableCell>Konsultan BIM/MEP</TableCell>
                      <TableCell>Segera hadir</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <p>
                Plan Free menambahkan watermark diagonal pada dokumen PDF yang
                diekspor. Upgrade ke Pro untuk export tanpa watermark.
              </p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="engineer">
            <AccordionTrigger>
              Kenapa saya tetap perlu engineer berlisensi?
            </AccordionTrigger>
            <AccordionContent className="space-y-2">
              <p>
                Baruma menghitung struktur, sanitasi, dan listrik dengan
                pendekatan otomatis yang cukup untuk tahap konsep — tapi belum
                memperhitungkan semua kondisi lapangan (mis. beban gempa/angin
                detail, kondisi tanah aktual). Insinyur berlisensi wajib
                meninjau desain sebelum konstruksi, dan biasanya juga
                dibutuhkan untuk pengajuan PBG (Persetujuan Bangunan Gedung)
                ke pemerintah daerah.
              </p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="billing">
            <AccordionTrigger>
              Bagaimana cara upgrade atau berhenti berlangganan?
            </AccordionTrigger>
            <AccordionContent className="space-y-2">
              <p>
                Upgrade: buka halaman{" "}
                <Link href="/app/billing" className="text-primary underline">
                  Billing
                </Link>
                , pilih paket, lalu selesaikan pembayaran. Langganan bersifat
                manual-renew — TIDAK ada tagihan otomatis berulang. Untuk
                berhenti, cukup jangan perpanjang sebelum masa aktif habis;
                akun otomatis kembali ke plan Free saat periode berakhir, dan
                project/kredit yang tersisa tetap tersimpan.
              </p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="plans">
            <AccordionTrigger>Apa batasan tiap plan?</AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plan</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Kredit/bulan</TableHead>
                      <TableHead>Export</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Free</TableCell>
                      <TableCell>1 project aktif</TableCell>
                      <TableCell>10</TableCell>
                      <TableCell>Ber-watermark, tanpa DXF/IFC</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Pro</TableCell>
                      <TableCell>Tanpa batas</TableCell>
                      <TableCell>100</TableCell>
                      <TableCell>Tanpa watermark, + DXF</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Studio</TableCell>
                      <TableCell>Hingga 50 project</TableCell>
                      <TableCell>500</TableCell>
                      <TableCell>Semua fitur Pro</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      <section id="shortcuts" className="space-y-4">
        <div className="flex items-center gap-2">
          <Keyboard className="size-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">
            Pintasan keyboard
          </h2>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pintasan</TableHead>
                <TableHead>Aksi</TableHead>
                <TableHead>Berlaku di</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">Ctrl/⌘</kbd>
                  {" + "}
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">Z</kbd>
                </TableCell>
                <TableCell>Undo</TableCell>
                <TableCell>Editor 2D</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">Ctrl/⌘</kbd>
                  {" + Shift + "}
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">Z</kbd>
                  {" atau "}
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">Ctrl/⌘</kbd>
                  {" + "}
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">Y</kbd>
                </TableCell>
                <TableCell>Redo</TableCell>
                <TableCell>Editor 2D</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">Delete</kbd>
                  {" / "}
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">Backspace</kbd>
                </TableCell>
                <TableCell>Hapus objek terpilih</TableCell>
                <TableCell>Editor 2D</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">V</kbd>
                </TableCell>
                <TableCell>Ganti ke alat pilih (select)</TableCell>
                <TableCell>Editor 2D</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">Esc</kbd>
                </TableCell>
                <TableCell>Batalkan seleksi, atau keluar dari mode fokus</TableCell>
                <TableCell>Editor 2D &amp; Preview 3D</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">Ctrl/⌘</kbd>
                  {" + "}
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">K</kbd>
                </TableCell>
                <TableCell>Buka command palette (cari halaman/project)</TableCell>
                <TableCell>Semua halaman app</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </section>

      <section id="kontak" className="space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="size-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">Kontak</h2>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Butuh bantuan lebih lanjut?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Kirim email ke{" "}
              <a href={`mailto:${supportEmail}`} className="text-primary underline">
                {supportEmail}
              </a>{" "}
              — sertakan nama project dan tangkapan layar bila relevan supaya
              lebih cepat dibantu.
            </p>
            <p>Kami biasanya membalas dalam 1–2 hari kerja.</p>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
