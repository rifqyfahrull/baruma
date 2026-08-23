/**
 * Image-based textures (real photos/motifs from the asset bank) — the
 * counterpart of textures.ts's procedural maps. Files live in object storage
 * (source of truth) and are synced to `public/textures/` at deploy by
 * scripts/sync-catalog-models.mjs, so at runtime they are plain same-origin
 * static assets.
 *
 * Memoized per URL; SSR/test-safe (returns null without a DOM, so importing
 * this module in node/vitest never touches the network or window).
 */
import { RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from "three"

// Dua tingkat cache: base Texture per URL (satu load+decode per foto), lalu
// varian repeat sebagai clone yang BERBAGI image — tanpa ini, band fasad ×
// repeat proporsional per-dimensi men-decode foto yang sama berkali-kali.
const baseCache = new Map<string, Texture>()
const variantCache = new Map<string, Texture | null>()
let loader: TextureLoader | null = null

function baseTextureFor(url: string): Texture {
  let base = baseCache.get(url)
  if (!base) {
    loader ??= new TextureLoader()
    base = loader.load(url, (loadedTex) => {
      // Trigger WebGL update on all variant clones once image data arrives
      for (const [k, v] of variantCache.entries()) {
        if (k.startsWith(`${url}@`) && v) {
          v.image = loadedTex.image
          v.needsUpdate = true
        }
      }
    })
    base.wrapS = RepeatWrapping
    base.wrapT = RepeatWrapping
    base.anisotropy = 4
    base.colorSpace = SRGBColorSpace
    baseCache.set(url, base)
  }
  return base
}

export function imageTextureFor(
  url: string,
  repeat = 2,
  repeatY?: number,
): Texture | null {
  if (typeof document === "undefined") return null
  const ry = repeatY ?? repeat
  const key = `${url}@${repeat}@${ry}`
  const hit = variantCache.get(key)
  if (hit !== undefined) return hit
  const base = baseTextureFor(url)
  const texture = base.clone()
  texture.repeat.set(repeat, ry)
  if (texture.image) {
    texture.needsUpdate = true
  }
  variantCache.set(key, texture)
  return texture
}
