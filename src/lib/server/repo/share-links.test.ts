// @vitest-environment node
/**
 * Share-links repo — memory-fallback paths (no DATABASE_URL). The public
 * project/brief/layout join (`getSharedProjectByToken`) has NO memory
 * fallback (see the file's header comment) — only the link-row lifecycle
 * (create/reuse/revoke/lookup) is exercised here.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest"

import {
  clearShareLinksFallback,
  createOrReuseShareLink,
  getActiveShareLink,
  getShareLinkByToken,
  getSharedProjectByToken,
  revokeShareLinks,
} from "./share-links"

beforeAll(() => {
  delete process.env.DATABASE_URL
})

beforeEach(() => {
  clearShareLinksFallback()
})

describe("createOrReuseShareLink (memory fallback)", () => {
  it("creates a new link with an id/token when none exists", async () => {
    const link = await createOrReuseShareLink("proj-1")
    expect(link.projectId).toBe("proj-1")
    expect(link.id).toMatch(/^shr-/)
    expect(link.token).toHaveLength(21)
    expect(link.revokedAt).toBeNull()
  })

  it("is idempotent — reuses the active link on a second call", async () => {
    const first = await createOrReuseShareLink("proj-1")
    const second = await createOrReuseShareLink("proj-1")
    expect(second.id).toBe(first.id)
    expect(second.token).toBe(first.token)
  })

  it("mints a fresh link after the previous one was revoked", async () => {
    const first = await createOrReuseShareLink("proj-1")
    await revokeShareLinks("proj-1")
    const second = await createOrReuseShareLink("proj-1")
    expect(second.id).not.toBe(first.id)
    expect(second.token).not.toBe(first.token)
  })

  it("different projects get independent links", async () => {
    const a = await createOrReuseShareLink("proj-a")
    const b = await createOrReuseShareLink("proj-b")
    expect(a.token).not.toBe(b.token)
  })
})

describe("getActiveShareLink / getShareLinkByToken (memory fallback)", () => {
  it("returns null when no link exists for the project", async () => {
    expect(await getActiveShareLink("proj-none")).toBeNull()
  })

  it("resolves an active link's token back to the link row", async () => {
    const created = await createOrReuseShareLink("proj-1")
    const found = await getShareLinkByToken(created.token)
    expect(found?.projectId).toBe("proj-1")
  })

  it("returns null for a revoked token (matches the DB path's WHERE revoked_at IS NULL)", async () => {
    const created = await createOrReuseShareLink("proj-1")
    await revokeShareLinks("proj-1")
    expect(await getShareLinkByToken(created.token)).toBeNull()
  })

  it("returns null for an unknown token", async () => {
    expect(await getShareLinkByToken("does-not-exist")).toBeNull()
  })
})

describe("revokeShareLinks (memory fallback)", () => {
  it("is a no-op when the project has no link", async () => {
    await expect(revokeShareLinks("proj-none")).resolves.toBeUndefined()
  })

  it("only revokes the target project's link, not others'", async () => {
    const a = await createOrReuseShareLink("proj-a")
    await createOrReuseShareLink("proj-b")
    await revokeShareLinks("proj-a")
    expect(await getShareLinkByToken(a.token)).toBeNull()
    expect(await getActiveShareLink("proj-b")).not.toBeNull()
  })
})

describe("getSharedProjectByToken (memory fallback — DB-only join, see file header)", () => {
  it("always returns null without DATABASE_URL (no in-memory projects/briefs/layouts to join against)", async () => {
    const link = await createOrReuseShareLink("proj-1")
    expect(await getSharedProjectByToken(link.token)).toBeNull()
  })
})
