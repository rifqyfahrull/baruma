import type { DataSource } from "./source"
import { httpSource } from "./http"

const forced = process.env.NEXT_PUBLIC_DATA_SOURCE
const useHttp =
  forced === "http" || (forced !== "mock" && !!process.env.NEXT_PUBLIC_API_URL)

// Mock source di-load LAZY (proxy per-method) — impor statis akan membundel
// seluruh @/lib/mock (~570 KB) ke initial JS semua halaman, padahal mode http
// tidak pernah menyentuhnya dan mode mock baru butuh saat call pertama.
// Semua member DataSource adalah method async, jadi proxy ini transparan.
let mockPromise: Promise<DataSource> | null = null
const loadMock = () =>
  (mockPromise ??= import("./mock-source").then((m) => m.mockSource))

const lazyMockSource = new Proxy({} as DataSource, {
  get(_target, prop: keyof DataSource) {
    return async (...args: unknown[]) => {
      const source = await loadMock()
      const fn = source[prop] as (...a: unknown[]) => unknown
      return fn(...args)
    }
  },
})

/** Active data source — in-memory mock by default, real HTTP API when configured. */
export const data: DataSource = useHttp ? httpSource : lazyMockSource

export type { DataSource } from "./source"
