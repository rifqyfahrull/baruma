import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

const PAGES = [
  { name: "landing", path: "/" },
  { name: "pricing", path: "/pricing" },
  { name: "login", path: "/login" },
  { name: "register", path: "/register" },
  { name: "dashboard", path: "/app/dashboard" },
  { name: "projects", path: "/app/projects" },
  { name: "wizard", path: "/app/projects/new" },
  { name: "brief", path: "/app/projects/proj-demo-8x8/brief" },
  { name: "alternatives", path: "/app/projects/proj-demo-8x8/alternatives" },
  { name: "editor", path: "/app/projects/proj-demo-8x8/editor" },
  { name: "preview-3d", path: "/app/projects/proj-demo-8x8/preview-3d" },
  { name: "materials", path: "/app/projects/proj-demo-8x8/materials" },
  { name: "furniture", path: "/app/projects/proj-demo-8x8/furniture" },
  { name: "rab", path: "/app/projects/proj-demo-8x8/rab" },
  { name: "exports", path: "/app/projects/proj-demo-8x8/exports" },
  { name: "review", path: "/app/projects/proj-demo-8x8/review" },
  { name: "billing", path: "/app/billing" },
]

for (const p of PAGES) {
  test(`a11y: ${p.name}`, async ({ page }) => {
    await page.goto(p.path)
    await page.waitForLoadState("networkidle")

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze()

    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    )

    if (blocking.length) {
      console.log(
        `A11Y[${p.name}] ` +
          JSON.stringify(
            blocking.map((v) => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.length,
              targets: v.nodes.slice(0, 4).map((n) => n.target.join(" ")),
            }))
          )
      )
    }

    expect(blocking, `${p.name}: serious/critical a11y violations`).toEqual([])
  })
}
