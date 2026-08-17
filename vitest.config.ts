import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: false,
    // Menambal Web Storage bawaan Node >= 25 yang rusak tanpa
    // `--localstorage-file` (lihat setup-dom.ts). No-op di runtime sehat.
    setupFiles: ["./src/test-utils/setup-dom.ts"],
  },
})
