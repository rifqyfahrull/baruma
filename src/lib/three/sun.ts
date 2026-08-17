/**
 * Sun direction helper for the exterior 3D preview.
 *
 * Converts a sky position expressed as azimuth/elevation (degrees) into a
 * cartesian direction vector in three.js world space (y-UP). Used both for
 * drei `<Sky sunPosition>` (a direction) and for placing the sun
 * `directionalLight` (scale the unit vector by a distance).
 *
 * Convention:
 *  - elevation 0° = on the horizon, 90° = straight up (zenith)
 *  - azimuth 0° faces +z, 90° faces +x (clockwise around the y axis)
 */
export function sunPosition(
  azimuthDeg: number,
  elevationDeg: number,
  radius = 1
): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  const cosEl = Math.cos(el)
  const x = radius * cosEl * Math.sin(az)
  const y = radius * Math.sin(el)
  const z = radius * cosEl * Math.cos(az)
  return [x, y, z]
}
