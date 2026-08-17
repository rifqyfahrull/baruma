/**
 * Normalize an arbitrary GLB's bounding box to a furniture footprint:
 * uniform scale to fit within w×d×h, centered on x/z, base resting on y=0.
 * Pure math — no three.js import — so it is unit-testable in isolation.
 */
export function computeFitTransform(
  bbox: { size: [number, number, number]; center: [number, number, number] },
  target: { w: number; d: number; h: number }
): { scale: number; position: [number, number, number] } {
  const [sx, sy, sz] = bbox.size
  const eps = 1e-6
  const ratios: number[] = []
  if (sx > eps) ratios.push(target.w / sx)
  if (sy > eps) ratios.push(target.h / sy)
  if (sz > eps) ratios.push(target.d / sz)
  const scale = ratios.length ? Math.min(...ratios) : 1

  const [cx, cy, cz] = bbox.center
  return {
    scale,
    position: [-cx * scale, (sy / 2 - cy) * scale, -cz * scale],
  }
}

/**
 * Orientation-aware variant of computeFitTransform: tries both yaw 0° and 90°
 * (90° swaps the roles of the model's x/z sizes against the target's w/d) and
 * keeps whichever orientation yields the LARGER uniform fit scale. This rescues
 * models authored "sideways" (e.g. a car whose length runs along X while the
 * slot is deep along Z) from being shrunk by the wrong footprint axis.
 *
 * The returned position already accounts for the rotation: applying
 * translate(position) ∘ rotateY(rotationY) ∘ scale(scale) to the raw model
 * centers it on x/z and rests its base on y=0. Ties prefer rotationY 0.
 * Pure math — no three.js import — so it is unit-testable in isolation.
 */
export function computeFitTransformOriented(
  bbox: { size: [number, number, number]; center: [number, number, number] },
  target: { w: number; d: number; h: number }
): { scale: number; position: [number, number, number]; rotationY: number } {
  const [sx, sy, sz] = bbox.size
  const eps = 1e-6

  // min-ratio fit for a given footprint assignment (which model axis spans w vs d)
  const fitScale = (footprintW: number, footprintD: number): number => {
    const ratios: number[] = []
    if (footprintW > eps) ratios.push(target.w / footprintW)
    if (sy > eps) ratios.push(target.h / sy)
    if (footprintD > eps) ratios.push(target.d / footprintD)
    return ratios.length ? Math.min(...ratios) : 1
  }

  const scale0 = fitScale(sx, sz) // yaw 0°: model x → w, model z → d
  const scale90 = fitScale(sz, sx) // yaw 90°: model z → w, model x → d
  const [cx, cy, cz] = bbox.center

  if (scale90 > scale0) {
    // rotateY(+90°) maps a point (x, y, z) to (z, y, -x); offset the rotated
    // center back to the origin on x/z and drop the base onto y=0.
    return {
      scale: scale90,
      rotationY: Math.PI / 2,
      position: [-cz * scale90, (sy / 2 - cy) * scale90, cx * scale90],
    }
  }
  return {
    scale: scale0,
    rotationY: 0,
    position: [-cx * scale0, (sy / 2 - cy) * scale0, -cz * scale0],
  }
}
