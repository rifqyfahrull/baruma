/**
 * Fungsi PURE yang menerjemahkan `ComponentPatternSpec` → daftar persegi
 * (koordinat meter, viewBox 0,0 → widthM,heightM) untuk preview SVG 2D di
 * Studio Komponen (component-studio.tsx). Dipisah dari komponen React agar
 * bisa dites tanpa DOM/jsdom, dan memakai resolver yang SAMA dengan geometri
 * 3D sungguhan (`lib/three/component-pattern.ts`) — pratinjau tak pernah
 * menyimpang dari apa yang benar-benar dirender.
 *
 * TANPA three.js/R3F di sini maupun di pemanggilnya — murni SVG, supaya
 * bundle Studio tetap ringan (lihat AGENTS.md batas anti-berat).
 */
import type { ComponentPatternSpec } from "@/types"
import {
  patternBarOffsets,
  resolveBarWidthM,
  resolveOrientation,
  resolvePitchM,
  wantsFrame,
} from "@/lib/three/component-pattern"

export type PreviewRect = { x: number; y: number; w: number; h: number }

/**
 * Bilah + (opsional) bingkai untuk envelope `widthM × heightM`. Fallback
 * (orientasi/pitch/lebar bilah) dipakai bila `pattern` absen/parsial — sama
 * seperti jalur 3D, sehingga preview tetap masuk akal bahkan sebelum user
 * menyentuh field apa pun.
 */
export function componentPatternPreviewRects(params: {
  pattern?: ComponentPatternSpec
  widthM: number
  heightM: number
  fallbackOrientation?: NonNullable<ComponentPatternSpec["orientation"]>
  fallbackPitchM?: number
  fallbackBarWidthM?: number
}): PreviewRect[] {
  const { pattern, widthM, heightM } = params
  if (!(widthM > 0) || !(heightM > 0)) return []

  const orientation = resolveOrientation(pattern, params.fallbackOrientation ?? "v")
  const pitchM = resolvePitchM(pattern, params.fallbackPitchM ?? 0.25)
  const barWidthM = Math.min(
    resolveBarWidthM(pattern, params.fallbackBarWidthM ?? 0.08),
    widthM / 2,
    heightM / 2
  )
  const rhythm = pattern?.rhythm

  const rects: PreviewRect[] = []

  if (orientation === "v" || orientation === "grid" || orientation === "cross") {
    for (const o of patternBarOffsets(widthM, pitchM, rhythm)) {
      rects.push({ x: widthM / 2 + o - barWidthM / 2, y: 0, w: barWidthM, h: heightM })
    }
  }
  if (orientation === "h" || orientation === "grid" || orientation === "cross") {
    for (const o of patternBarOffsets(heightM, pitchM, rhythm)) {
      rects.push({ x: 0, y: heightM / 2 + o - barWidthM / 2, w: widthM, h: barWidthM })
    }
  }

  if (wantsFrame(pattern)) {
    const t = barWidthM
    rects.push(
      { x: 0, y: 0, w: widthM, h: t },
      { x: 0, y: heightM - t, w: widthM, h: t },
      { x: 0, y: 0, w: t, h: heightM },
      { x: widthM - t, y: 0, w: t, h: heightM }
    )
  }

  return rects
}
