/**
 * Peredam noise console three.js yang SUDAH DIKETAHUI tidak actionable.
 *
 * r3f (@react-three/fiber ≤ 9.x) masih membuat `new THREE.Clock()` per
 * <Canvas> — three r184 menandainya deprecated (ganti THREE.Timer) dan
 * memperingatkan DI KONSTRUKTOR, jadi setiap mount canvas (termasuk preview
 * kartu library yang di-gate viewport) menambah satu warning; sesi normal bisa
 * menumpuk ribuan dan menutupi warning yang penting. Itu urusan internal r3f
 * (akan hilang saat mereka migrasi ke Timer), bukan kode kita.
 *
 * Memakai hook RESMI three (`setConsoleFunction`) — bukan monkey-patch
 * console global — dan hanya menelan pesan yang persis dikenal; sisanya
 * diteruskan apa adanya.
 */
import { getConsoleFunction, setConsoleFunction } from "three"

const KNOWN_NOISE_PREFIXES = [
  "THREE.Clock: This module has been deprecated",
]

let installed = false

export function silenceKnownThreeNoise(): void {
  if (installed || typeof window === "undefined") return
  installed = true
  // Router lain sudah terpasang (mis. devtools) — jangan timpa.
  if (getConsoleFunction()) return
  setConsoleFunction((level: string, message: unknown, ...rest: unknown[]) => {
    if (
      level === "warn" &&
      typeof message === "string" &&
      KNOWN_NOISE_PREFIXES.some((p) => message.startsWith(p))
    ) {
      return
    }
    const fn =
      level === "error" ? console.error
      : level === "warn" ? console.warn
      : level === "info" ? console.info
      : console.log
    fn(message, ...rest)
  })
}
