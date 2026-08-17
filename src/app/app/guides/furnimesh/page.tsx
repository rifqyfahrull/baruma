import { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, Upload, CheckCircle, AlertTriangle, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Panduan FurniMesh — Baruma",
  description: "Cara mendapatkan model 3D furniture dari FurniMesh dan menguploadnya ke platform Baruma.",
}

const CATEGORY_TIPS = [
  {
    category: "TV",
    tips: [
      "Foto TV dari depan, pastikan layar terlihat jelas",
      "Hindari pantulan cahaya di layar",
      "Background polos lebih baik",
      "Download sebagai GLB",
      "Model harus flat (tipis), bukan kotak tebal",
    ],
  },
  {
    category: "Sofa",
    tips: [
      "Foto dari sudut yang menunjukkan bentuk 3D",
      "Pastikan kaki sofa terlihat",
      "Background kontras dengan warna sofa",
      "Download sebagai GLB",
      "Model harus floor-standing (alas di lantai)",
    ],
  },
  {
    category: "Meja Kopi",
    tips: [
      "Foto dari atas atau sudut 45 derajat",
      "Pastikan permukaan meja terlihat",
      "Background bersih",
      "Download sebagai GLB",
      "Tinggi meja rendah (25–65cm)",
    ],
  },
]

export default function FurniMeshGuidePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Button variant="ghost" size="sm" asChild className="mb-6">
        <Link href="/app/dashboard">
          <ArrowLeft /> Kembali ke Dashboard
        </Link>
      </Button>

      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Panduan FurniMesh</h1>
          <p className="mt-2 text-muted-foreground">
            FurniMesh adalah tool eksternal yang bisa kamu gunakan untuk membuat model 3D furniture dari foto.
            Platform ini tidak berafiliasi resmi dengan FurniMesh — kami menyediakan panduan ini untuk memudahkan kamu.
          </p>
        </div>

        {/* What is FurniMesh */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="size-5 text-blue-500" />
              Apa itu FurniMesh?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              FurniMesh adalah platform online yang bisa mengubah foto furniture menjadi model 3D.
              Kamu bisa menggunakannya untuk:
            </p>
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              <li>Generate model 3D dari foto furniture kamu</li>
              <li>Download model dalam format GLB, OBJ, SKP, atau BLEND</li>
              <li>Browse katalog model furniture</li>
              <li>Convert antar format 3D</li>
            </ul>
          </CardContent>
        </Card>

        {/* Step-by-step */}
        <Card>
          <CardHeader>
            <CardTitle>Workflow yang Direkomendasikan</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4 text-sm">
              {[
                "Siapkan foto furniture yang jelas dan fokus.",
                "Gunakan background polos jika memungkinkan.",
                "Generate model 3D di FurniMesh.",
                "Download file GLB (format paling cocok untuk web).",
                "Kembali ke platform Baruma.",
                "Klik placeholder yang sesuai (TV, Sofa, Meja Kopi).",
                "Upload file GLB yang sudah di-download.",
                "Konfirmasi ukuran dan hak penggunaan.",
                "Pilih mode material (Pertahankan Original / Sesuaikan Style Project).",
                "Pasang model ke placeholder.",
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <Badge variant="secondary" className="mt-0.5 shrink-0">
                    {i + 1}
                  </Badge>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {/* Model Quality Checklist */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="size-5 text-green-500" />
              Checklist Kualitas Model
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {[
                "Format: GLB (binary glTF)",
                "Ukuran file: maksimal 100MB, ideal &lt;10MB",
                "Model memiliki mesh yang valid (bisa dibuka di viewer 3D)",
                "Dimensi realistis (ukuran furniture sebenarnya)",
                "Material/texture tidak corrupt",
                "Tidak ada mesh yang hilang atau rusak",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <CheckCircle className="mt-0.5 size-4 shrink-0 text-green-500" />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Category-Specific Tips */}
        <Card>
          <CardHeader>
            <CardTitle>Tips per Kategori</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {CATEGORY_TIPS.map((cat) => (
              <div key={cat.category}>
                <h3 className="mb-2 font-semibold">{cat.category}</h3>
                <ul className="space-y-1.5">
                  {cat.tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary" />
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* License */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" />
              Tanggung Jawab Lisensi
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Sebelum mengupload model apa pun, pastikan kamu memiliki hak untuk menggunakannya di project kamu.
              Platform ini menyimpan model yang diupload secara private secara default.
            </p>
            <p className="font-medium text-destructive">
              Jangan upload file yang tidak diizinkan untuk kamu gunakan.
            </p>
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              <li>Model yang kamu upload disimpan private (hanya kamu yang bisa akses)</li>
              <li>Kamu bertanggung jawab penuh atas lisensi model yang diupload</li>
              <li>Platform tidak mengklaim kepemilikan model kamu</li>
              <li>FurniMesh adalah tool eksternal — kami bukan partner resmi</li>
            </ul>
          </CardContent>
        </Card>

        {/* Troubleshooting */}
        <Card>
          <CardHeader>
            <CardTitle>Troubleshooting</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm">
              {[
                {
                  problem: "File GLB tidak bisa dibuka di platform",
                  solution: "Pastikan file tidak corrupt. Coba download ulang dari FurniMesh. Format harus binary glTF (.glb), bukan .gltf terpisah.",
                },
                {
                  problem: "Model terlalu besar / lambat",
                  solution: "Ukuran file ideal &lt;10MB. Jika lebih besar, coba optimasi model di FurniMesh sebelum download.",
                },
                {
                  problem: "Ukuran model tidak sesuai",
                  solution: "Saat upload, kamu akan diminta mengisi ukuran sebenarnya (lebar, kedalaman, tinggi). Platform akan menyesuaikan skala otomatis.",
                },
                {
                  problem: "Material tidak cocok dengan style project",
                  solution: "Pilih mode 'Sesuaikan Style Project' saat upload. Platform akan otomatis mapping material ke Design DNA project kamu.",
                },
              ].map((item, i) => (
                <li key={i} className="rounded-md bg-muted/50 p-3">
                  <p className="font-medium">{item.problem}</p>
                  <p className="mt-1 text-muted-foreground">{item.solution}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* CTA */}
        <div className="rounded-lg border bg-muted/30 p-6 text-center">
          <p className="font-semibold">Sudah punya model GLB dari FurniMesh?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Buka project kamu, klik placeholder furniture, dan upload modelnya.
          </p>
          <Button className="mt-4" asChild>
            <Link href="/app/dashboard">
              <Upload /> Buka Project Saya
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
