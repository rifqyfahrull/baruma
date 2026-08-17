/**
 * S3-compatible object storage for user asset uploads (RustFS / R2 / MinIO /
 * any S3-compatible provider). Server-only. Generates signed URLs for direct
 * client-side upload (PUT) and serves assets via public/signed GET URLs.
 *
 * Configure via env:
 *   STORAGE_ENDPOINT — S3-compatible endpoint, e.g. https://storage.tampil.dev
 *   STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY / STORAGE_BUCKET
 *   STORAGE_PUBLIC_URL — public base URL for the bucket (or CDN), optional
 *   STORAGE_REGION — region (defaults to "auto")
 */
import { AwsClient } from "aws4fetch"

function getStorageClient(): AwsClient {
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "storage credentials not configured (STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY)",
    )
  }
  return new AwsClient({
    accessKeyId,
    secretAccessKey,
    region: process.env.STORAGE_REGION || "auto",
    service: "s3",
  })
}

function storageEndpoint(): string {
  const endpoint = process.env.STORAGE_ENDPOINT
  if (!endpoint) throw new Error("STORAGE_ENDPOINT not configured")
  return endpoint
}

function bucket(): string {
  const b = process.env.STORAGE_BUCKET
  if (!b) throw new Error("STORAGE_BUCKET not configured")
  return b
}

export function storageEnabled(): boolean {
  return !!(
    process.env.STORAGE_ACCESS_KEY_ID &&
    process.env.STORAGE_SECRET_ACCESS_KEY &&
    process.env.STORAGE_BUCKET &&
    process.env.STORAGE_ENDPOINT
  )
}

/** Generate a pre-signed PUT URL for direct browser upload. */
export async function createSignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 900,
): Promise<string> {
  void expiresInSeconds
  const client = getStorageClient()
  const url = new URL(`${storageEndpoint()}/${bucket()}/${key}`)
  const signed = await client.sign(
    new Request(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "x-amz-acl": "private",
      },
    }),
    { aws: { signQuery: true } as Record<string, unknown>, headers: {} },
  )
  return signed.url
}

/** Generate a pre-signed GET URL (server-side use — the bucket is private). */
export async function createSignedGetUrl(key: string): Promise<string> {
  const client = getStorageClient()
  const url = new URL(`${storageEndpoint()}/${bucket()}/${key}`)
  const signed = await client.sign(new Request(url, { method: "GET" }), {
    aws: { signQuery: true } as Record<string, unknown>,
    headers: {},
  })
  return signed.url
}

/** Build the public GET URL for an uploaded asset. Without STORAGE_PUBLIC_URL
 *  the bucket stays private and assets are served through the app's
 *  same-origin proxy (/api/v1/assets/file/<key>) — no bucket CORS/public
 *  access needed. */
export function assetPublicUrl(key: string): string {
  const pub = process.env.STORAGE_PUBLIC_URL
  if (pub) return `${pub.replace(/\/$/, "")}/${key}`
  return `/api/v1/assets/file/${key}`
}

/**
 * Nama file AMAN untuk key S3. Karakter di luar `[A-Za-z0-9._-]` (spasi, `+`,
 * `(`, `&`, dst.) memicu **SignatureDoesNotMatch (403)** pada sebagian backend
 * S3-compatible: mereka meng-canonicalize path (mis. `+`) berbeda dari yang
 * dipakai aws4fetch saat menandatangani, sehingga signature tak cocok dan
 * upload gagal (route proxy lalu membalas 502). Contoh nyata:
 * `Washing+Machine+AEG.glb` → 403. Bersihkan sebelum menjadi bagian key.
 */
export function safeAssetFilename(filename: string): string {
  const dot = filename.lastIndexOf(".")
  const rawBase = dot > 0 ? filename.slice(0, dot) : filename
  const rawExt = dot > 0 ? filename.slice(dot + 1) : ""
  const base =
    rawBase
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "model"
  const ext = rawExt.replace(/[^A-Za-z0-9]+/g, "").toLowerCase()
  return ext ? `${base}.${ext}` : base
}

/** Build a unique storage key for a user upload (filename disanitasi — lihat safeAssetFilename). */
export function assetKey(userId: string, projectId: string, filename: string): string {
  const ts = Date.now()
  return `uploads/${userId}/${projectId}/${ts}-${safeAssetFilename(filename)}`
}
