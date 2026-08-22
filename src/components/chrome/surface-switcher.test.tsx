import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"

const push = vi.fn()
const pathnameRef = { current: "/app/projects/p1/editor" }
const paramsRef: { current: { projectId?: string } } = { current: { projectId: "p1" } }

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => ({ push, refresh: vi.fn() }),
  useParams: () => paramsRef.current,
}))

import { SurfaceSwitcher } from "./surface-switcher"

afterEach(() => {
  cleanup()
  push.mockClear()
  pathnameRef.current = "/app/projects/p1/editor"
  paramsRef.current = { projectId: "p1" }
})

describe("SurfaceSwitcher — active segment reflects pathname", () => {
  it("marks 2D active on an /editor route", () => {
    pathnameRef.current = "/app/projects/p1/editor"
    render(<SurfaceSwitcher />)
    expect(screen.getByTestId("surface-switcher-2d").getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByTestId("surface-switcher-3d").getAttribute("aria-pressed")).toBe("false")
  })

  it("marks 3D active on a /preview-3d route", () => {
    pathnameRef.current = "/app/projects/p1/preview-3d"
    render(<SurfaceSwitcher />)
    expect(screen.getByTestId("surface-switcher-3d").getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByTestId("surface-switcher-2d").getAttribute("aria-pressed")).toBe("false")
  })
})

describe("SurfaceSwitcher — navigation targets", () => {
  it("navigates to the editor route when 2D is clicked from 3D", () => {
    pathnameRef.current = "/app/projects/p1/preview-3d"
    render(<SurfaceSwitcher />)
    fireEvent.click(screen.getByTestId("surface-switcher-2d"))
    expect(push).toHaveBeenCalledWith("/app/projects/p1/editor")
  })

  it("navigates to the preview-3d route when 3D is clicked from 2D", () => {
    pathnameRef.current = "/app/projects/p1/editor"
    render(<SurfaceSwitcher />)
    fireEvent.click(screen.getByTestId("surface-switcher-3d"))
    expect(push).toHaveBeenCalledWith("/app/projects/p1/preview-3d")
  })

  it("does not navigate when clicking the already-active segment", () => {
    pathnameRef.current = "/app/projects/p1/editor"
    render(<SurfaceSwitcher />)
    fireEvent.click(screen.getByTestId("surface-switcher-2d"))
    expect(push).not.toHaveBeenCalled()
  })

  it("uses the projectId prop over the route param when both are present", () => {
    paramsRef.current = { projectId: "from-route" }
    render(<SurfaceSwitcher projectId="from-prop" />)
    fireEvent.click(screen.getByTestId("surface-switcher-3d"))
    expect(push).toHaveBeenCalledWith("/app/projects/from-prop/preview-3d")
  })
})

describe("SurfaceSwitcher — accessible names", () => {
  it("exposes Indonesian aria-labels for both segments", () => {
    render(<SurfaceSwitcher />)
    expect(screen.getByLabelText("Buka editor 2D")).toBeTruthy()
    expect(screen.getByLabelText("Buka preview 3D")).toBeTruthy()
  })
})

describe("SurfaceSwitcher — no project context", () => {
  it("renders nothing when no projectId can be resolved", () => {
    paramsRef.current = {}
    const { container } = render(<SurfaceSwitcher />)
    expect(container.firstChild).toBeNull()
  })
})
