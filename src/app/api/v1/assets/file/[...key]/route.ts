import { requireUser, ForbiddenError } from "@/lib/server/auth-server"
import { requirePlanFeature } from "@/lib/server/entitlements"
import { err, handleError } from "@/lib/server/response"
import {
  storageEnabled,
  createSignedGetUrl,
  createSignedUploadUrl,
} from "@/lib/server/storage"

/**
 * Same-origin proxy for GLB assets in the private R2 bucket.
 * GET streams the object back (no bucket CORS/public access required);
 * PUT streams a browser upload to R2 with server-side signing.
 *
 * AUTHORIZATION (perbaikan keamanan 2026-07-12): bucket PRIVAT, dan proxy ini
 * adalah SATU-SATUNYA gerbang ke sana — jadi ia WAJIB menegakkan otorisasi
 * sendiri (middleware tidak mencakup /api). Aturan:
 *  - `uploads/<userId>/…` = aset PRIVAT milik <userId>; hanya boleh dibaca/
 *    ditulis oleh <userId> itu (dicek dari kunci — 0 aset publik di prefix ini).
 *  - `asset-library/…` = katalog GLOBAL publik; boleh dibaca user login mana
 *    pun, TIDAK boleh ditulis lewat proxy (tak ada penanaman ke katalog).
 */

const MAX_BYTES = 100 * 1024 * 1024
// GLB aset + thumbnail WebP katalog global. Thumbnail hanya di prefix
// asset-library/<src>/thumbnails/<name>.webp (publik, read-only via proxy).
export const ASSET_FILE_KEY_RE =
  /^(?:uploads\/[\w-]+\/[\w-]+\/\d+-[^/]+\.glb|asset-library\/[\w-]+\/(?:buildings|furniture)\/[\w.-]+\.glb|asset-library\/[\w-]+\/thumbnails\/[\w.-]+\.webp)$/

/** Content-type dari ekstensi key. */
function assetContentType(key: string): string {
  return key.endsWith(".webp") ? "image/webp" : "model/gltf-binary"
}

export function joinAssetFileKey(parts: string[]): string | null {
  const key = parts.map(decodeURIComponent).join("/")
  return ASSET_FILE_KEY_RE.test(key) ? key : null
}

/** userId pemilik untuk kunci `uploads/<userId>/…`; null utk katalog publik. */
export function assetKeyOwnerId(key: string): string | null {
  if (!key.startsWith("uploads/")) return null
  return key.split("/")[1] ?? null
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ key: string[] }> }
): Promise<Response> {
  try {
    if (!storageEnabled()) return err(503, "Object storage belum dikonfigurasi")
    const { key: parts } = await ctx.params
    const key = joinAssetFileKey(parts)
    if (!key) return err(400, "Key asset tidak valid")

    // Bucket privat: wajib login. Aset upload = hanya pemiliknya; katalog
    // asset-library boleh dibaca user login mana pun.
    const { userId } = await requireUser(request)
    const owner = assetKeyOwnerId(key)
    if (owner !== null && owner !== userId) {
      throw new ForbiddenError("Bukan aset milik Anda")
    }

    const signed = await createSignedGetUrl(key)
    const upstream = await fetch(signed)
    if (!upstream.ok || !upstream.body) return err(404, "Asset tidak ditemukan")

    // Aset privat (uploads/) TIDAK boleh di-cache proxy/CDN bersama; hanya
    // katalog global publik yang boleh public+immutable.
    const cacheControl =
      owner === null
        ? "public, max-age=31536000, immutable"
        : "private, max-age=3600"

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": assetContentType(key),
        "cache-control": cacheControl,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ key: string[] }> }
): Promise<Response> {
  try {
    if (!storageEnabled()) return err(503, "Object storage belum dikonfigurasi")
    const { key: parts } = await ctx.params
    const key = joinAssetFileKey(parts)
    if (!key) return err(400, "Key asset tidak valid")

    // Tulis WAJIB terautentikasi + berlisensi (paritas dgn upload-url route);
    // hanya boleh menulis ke prefix uploads/ MILIK pemanggil. Katalog global
    // (asset-library/) tak boleh ditulis lewat proxy.
    const { userId } = await requireUser(request)
    await requirePlanFeature(userId, "glbUpload")
    const owner = assetKeyOwnerId(key)
    if (owner === null) throw new ForbiddenError("Katalog global tidak bisa ditulis")
    if (owner !== userId) throw new ForbiddenError("Bukan prefix aset milik Anda")

    const len = Number(request.headers.get("content-length") ?? "0")
    if (len > MAX_BYTES) return err(413, "Ukuran file maksimal 100MB")

    const body = await request.arrayBuffer()
    if (body.byteLength === 0) return err(400, "File kosong")
    if (body.byteLength > MAX_BYTES) return err(413, "Ukuran file maksimal 100MB")

    const signed = await createSignedUploadUrl(key, "model/gltf-binary")
    const upstream = await fetch(signed, {
      method: "PUT",
      // Must match the headers included in the signature (see createSignedUploadUrl).
      headers: { "content-type": "model/gltf-binary", "x-amz-acl": "private" },
      body,
    })
    if (!upstream.ok) return err(502, `Gagal menyimpan ke storage (${upstream.status})`)

    return new Response(null, { status: 204 })
  } catch (e) {
    return handleError(e)
  }
}
