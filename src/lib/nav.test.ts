import { describe, it, expect } from "vitest"

import { APP_NAV_SECONDARY } from "./nav"

describe("APP_NAV_SECONDARY (WS-E §3)", () => {
  it("includes a 'Bantuan' entry pointing at /app/help", () => {
    const bantuan = APP_NAV_SECONDARY.find((item) => item.title === "Bantuan")
    expect(bantuan).toBeDefined()
    expect(bantuan?.href).toBe("/app/help")
  })
})
