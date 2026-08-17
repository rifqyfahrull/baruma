/**
 * Setup global untuk test DOM (vitest `setupFiles`).
 *
 * MASALAH YANG DIPERBAIKI — Node >= 25 mengekspos global `localStorage` /
 * `sessionStorage` BAWAAN (Web Storage eksperimental) yang hanya berfungsi
 * bila proses dijalankan dengan `--localstorage-file <path>`. Tanpa flag itu,
 * mengaksesnya memicu warning `--localstorage-file was provided without a
 * valid path` dan menghasilkan objek TANPA method (`setItem`/`clear` undefined).
 *
 * Environment jsdom milik vitest tidak menimpa global tersebut, sehingga
 * `window.localStorage` di dalam test jatuh ke stub Node yang rusak — bukan ke
 * `Storage` milik jsdom (jsdom 29 sendiri sehat: ia menyediakan `Storage`
 * lengkap). Akibatnya seluruh test yang menyentuh localStorage gagal dengan
 * "window.localStorage.clear is not a function".
 *
 * Perbaikan: pasang implementasi Storage in-memory HANYA bila storage yang ada
 * memang rusak. Di runtime yang sehat (Node tanpa Web Storage, atau dengan
 * flag yang benar) implementasi asli jsdom dibiarkan utuh — polyfill ini tidak
 * boleh menutupi bug sungguhan.
 */

class MemoryStorage implements Storage {
  #map = new Map<string, string>()

  get length(): number {
    return this.#map.size
  }

  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.#map.get(String(key)) ?? null
  }

  setItem(key: string, value: string): void {
    this.#map.set(String(key), String(value))
  }

  removeItem(key: string): void {
    this.#map.delete(String(key))
  }

  clear(): void {
    this.#map.clear()
  }

  [name: string]: unknown
}

/** Storage dianggap rusak bila method wajibnya bukan fungsi. */
function isBroken(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== "object") return true
  const s = candidate as Partial<Storage>
  return (
    typeof s.setItem !== "function" ||
    typeof s.getItem !== "function" ||
    typeof s.clear !== "function"
  )
}

function installIfBroken(name: "localStorage" | "sessionStorage") {
  // Baca lewat try/catch: pada Node 25 akses getter bawaan bisa melempar
  // ketika file storage tidak valid.
  let current: unknown
  try {
    current = (globalThis as Record<string, unknown>)[name]
  } catch {
    current = undefined
  }
  if (!isBroken(current)) return

  const storage = new MemoryStorage()
  const descriptor: PropertyDescriptor = {
    value: storage,
    writable: true,
    configurable: true,
    enumerable: true,
  }
  Object.defineProperty(globalThis, name, descriptor)
  if (typeof window !== "undefined" && window !== (globalThis as unknown)) {
    Object.defineProperty(window, name, descriptor)
  }
}

installIfBroken("localStorage")
installIfBroken("sessionStorage")
