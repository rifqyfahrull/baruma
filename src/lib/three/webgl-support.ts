/**
 * Pre-flight check untuk WebGL — dipanggil SEBELUM mount `<Canvas>` (r3f),
 * bukan sesudah. `Canvas`'s internal `configure()` (r3f 9.x) memanggil
 * `new THREE.WebGLRenderer()` di dalam `async function run() { ... }` yang
 * TIDAK di-await/di-catch — kegagalan context (GPU process crash, driver
 * software-only, WebGL di-disable via kebijakan/flag) jadi unhandled promise
 * rejection yang TIDAK BISA ditangkap React error boundary manapun (termasuk
 * error boundary internal r3f, yang hanya membungkus children DI DALAM canvas
 * — canvas itu sendiri tak pernah sempat ter-mount). Hasilnya: layar kosong
 * tanpa penjelasan, plus warning `THREE.WebGLRenderer` berulang tiap re-render
 * (efek `useIsomorphicLayoutEffect` tanpa deps array).
 *
 * Cek ini murah & sinkron (bikin canvas 1×1 di memori, coba `getContext`,
 * lepas context-nya, buang canvas) — hasil di-cache per sesi karena kapabilitas
 * WebGL browser tidak berubah selama halaman terbuka.
 */
let cached: boolean | null = null

export function isWebGLAvailable(): boolean {
  if (cached !== null) return cached
  if (typeof document === "undefined") {
    // SSR: pemanggil di repo ini semuanya client-only (dynamic ssr:false /
    // "use client" di belakang IntersectionObserver) — jangan cache tebakan
    // server supaya render client pertama tetap mengecek ulang.
    return false
  }
  try {
    const canvas = document.createElement("canvas")
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
    cached = !!gl
    // Lepas context segera — browser membatasi jumlah context WebGL hidup
    // sekaligus (~8–16); cek ini tak boleh diam-diam memakan satu slot.
    ;(gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext()
  } catch {
    cached = false
  }
  return cached
}

/** Test-only: reset cache modul supaya tiap test bisa mensimulasikan hasil beda. */
export function __resetWebGLAvailabilityCacheForTests(): void {
  cached = null
}
