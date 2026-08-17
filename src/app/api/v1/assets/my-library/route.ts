import { requireUser } from "@/lib/server/auth-server"
import { ok, handleError } from "@/lib/server/response"
import { listUserAssets } from "@/lib/server/repo/assets"

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request)
    const { searchParams } = new URL(request.url)
    const category = searchParams.get("category") ?? undefined
    const search = searchParams.get("search") ?? undefined
    const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined
    const offset = searchParams.get("offset") ? Number(searchParams.get("offset")) : undefined

    const { rows, total } = await listUserAssets(userId, { category, search, limit, offset })
    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      modelUrl: r.model_url,
      thumbnailUrl: r.thumbnail_url ?? undefined,
      sourceName: r.source_name ?? undefined,
      sourceUrl: r.source_url ?? undefined,
      fileSizeBytes: r.file_size_bytes ? Number(r.file_size_bytes) : undefined,
      widthM: r.width_m ? Number(r.width_m) : undefined,
      depthM: r.depth_m ? Number(r.depth_m) : undefined,
      heightM: r.height_m ? Number(r.height_m) : undefined,
      priceIDR: r.price_idr ? Number(r.price_idr) : undefined,
      performance: r.performance_json ?? undefined,
      status: r.status,
      // Aset katalog GLOBAL (is_public milik owner) tampil di library semua
      // user tapi TIDAK boleh diedit/di-rename — hanya pemiliknya. Server sudah
      // memfilter user_id di jalur tulis; flag ini agar UI menyembunyikan aksi
      // edit untuk aset yang bukan milik pemanggil.
      editable: r.user_id === userId,
    }))

    return ok({ items, total })
  } catch (e) {
    return handleError(e)
  }
}
