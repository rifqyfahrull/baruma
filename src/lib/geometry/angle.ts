/** Wrap a degree value into [0,360); optionally snap to the nearest `snapStep`. */
export function normalizeAngle(deg: number, snapStep?: number): number {
  let d = ((deg % 360) + 360) % 360
  if (snapStep && snapStep > 0) d = (Math.round(d / snapStep) * snapStep) % 360
  return d
}
