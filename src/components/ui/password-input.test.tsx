import { describe, it, expect, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

import { PasswordInput } from "@/components/ui/password-input"

afterEach(cleanup)

describe("PasswordInput", () => {
  it("renders as type='password' by default", () => {
    render(<PasswordInput placeholder="Masukkan password" />)
    const input = screen.getByPlaceholderText("Masukkan password")
    expect(input.getAttribute("type")).toBe("password")
  })

  it("toggles to type='text' when reveal button is clicked", () => {
    render(<PasswordInput placeholder="Masukkan password" />)
    const input = screen.getByPlaceholderText("Masukkan password")
    const toggleBtn = screen.getByRole("button", { name: "Tampilkan password" })

    expect(input.getAttribute("type")).toBe("password")
    fireEvent.click(toggleBtn)
    expect(input.getAttribute("type")).toBe("text")
  })

  it("toggles back to type='password' on second click", () => {
    render(<PasswordInput placeholder="Masukkan password" />)
    const input = screen.getByPlaceholderText("Masukkan password")
    const toggleBtn = screen.getByRole("button", { name: "Tampilkan password" })

    fireEvent.click(toggleBtn)
    expect(input.getAttribute("type")).toBe("text")

    const hideBtn = screen.getByRole("button", { name: "Sembunyikan password" })
    fireEvent.click(hideBtn)
    expect(input.getAttribute("type")).toBe("password")
  })

  it("toggle button is type='button' so it does not submit a form", () => {
    render(
      <form onSubmit={(e) => e.preventDefault()}>
        <PasswordInput placeholder="Masukkan password" />
      </form>
    )
    const toggleBtn = screen.getByRole("button", { name: "Tampilkan password" })
    expect(toggleBtn.getAttribute("type")).toBe("button")
  })

  it("toggle button has correct aria-pressed state", () => {
    render(<PasswordInput placeholder="Masukkan password" />)
    const toggleBtn = screen.getByRole("button", { name: "Tampilkan password" })

    expect(toggleBtn.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(toggleBtn)
    const hideBtnAfter = screen.getByRole("button", { name: "Sembunyikan password" })
    expect(hideBtnAfter.getAttribute("aria-pressed")).toBe("true")
  })

  it("forwards additional props (value, onChange) to the underlying input", () => {
    let changed = false
    render(
      <PasswordInput
        placeholder="Masukkan password"
        value="secret"
        readOnly
        onChange={() => {
          changed = true
        }}
      />
    )
    const input = screen.getByPlaceholderText("Masukkan password") as HTMLInputElement
    expect(input.value).toBe("secret")
    fireEvent.change(input, { target: { value: "newsecret" } })
    expect(changed).toBe(true)
  })
})
