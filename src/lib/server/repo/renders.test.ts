// @vitest-environment node
/**
 * Unit test untuk repo renders.ts — create+get mapping, owner-scoping
 * (anti-IDOR), dynamic update (termasuk guard fromStatuses), findCachedRender.
 * `query` di-mock; tak butuh DATABASE_URL (pola assets-list.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const query = vi.fn()
vi.mock("@/lib/server/db", () => ({ query: (...a: unknown[]) => query(...a) }))

import {
  createRenderJob,
  getRenderJob,
  getRenderJobById,
  updateRenderJob,
  listRenderJobs,
  findCachedRender,
} from "./renders"

function lastSql(): string {
  return String(query.mock.calls.at(-1)?.[0] ?? "")
}
function lastParams(): unknown[] {
  return (query.mock.calls.at(-1)?.[1] ?? []) as unknown[]
}

/** Baris render_jobs mentah (snake_case) sesuai kolom di 0039_ai_renders.sql +
 *  0043_ai_render_scene_intel.sql (target/room_id/camera_pose). */
function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rnd-abc123",
    owner_id: "user-1",
    project_id: "proj-1",
    status: "queued",
    mode: "cepat",
    preset: "tropis-siang",
    shot_id: "iso-siang",
    seed: 42,
    credits_spent: 1,
    provider: "mock",
    provider_request_id: null,
    params_hash: "hash-abc",
    input_keys: { beauty: "renders/user-1/proj-1/beauty.png" },
    output_key: null,
    watermarked: false,
    error_message: null,
    created_at: "2026-08-22T00:00:00.000Z",
    updated_at: "2026-08-22T00:00:00.000Z",
    target: "exterior",
    room_id: null,
    camera_pose: null,
    ...overrides,
  }
}

beforeEach(() => {
  query.mockReset()
})

describe("createRenderJob", () => {
  it("INSERT dgn kolom eksplisit + RETURNING, hasil di-mapping ke camelCase", async () => {
    query.mockResolvedValueOnce({ rows: [makeRow()] })

    const job = await createRenderJob("rnd-abc123", "user-1", {
      projectId: "proj-1",
      mode: "cepat",
      preset: "tropis-siang",
      shotId: "iso-siang",
      seed: 42,
      creditsSpent: 1,
      provider: "mock",
      paramsHash: "hash-abc",
      inputKeys: { beauty: "renders/user-1/proj-1/beauty.png" },
    })

    expect(lastSql()).toMatch(/INSERT INTO render_jobs/)
    expect(lastSql()).toMatch(/RETURNING/)
    // Status default 'queued' harus ikut terkirim meski tak dipassing caller.
    expect(lastParams()).toContain("queued")

    expect(job).toEqual({
      id: "rnd-abc123",
      ownerId: "user-1",
      projectId: "proj-1",
      status: "queued",
      mode: "cepat",
      preset: "tropis-siang",
      shotId: "iso-siang",
      seed: 42,
      creditsSpent: 1,
      provider: "mock",
      providerRequestId: undefined,
      paramsHash: "hash-abc",
      inputKeys: { beauty: "renders/user-1/proj-1/beauty.png" },
      outputKey: undefined,
      watermarked: false,
      errorMessage: undefined,
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      target: "exterior",
      roomId: undefined,
      cameraPose: undefined,
    })
  })

  it("watermarked=true (plan free) ikut terkirim sebagai parameter INSERT", async () => {
    query.mockResolvedValueOnce({ rows: [makeRow({ watermarked: true })] })

    await createRenderJob("rnd-abc123", "user-1", {
      projectId: "proj-1",
      mode: "cepat",
      preset: "tropis-siang",
      shotId: "iso-siang",
      seed: 42,
      creditsSpent: 1,
      provider: "mock",
      paramsHash: "hash-abc",
      inputKeys: { beauty: "renders/user-1/proj-1/beauty.png" },
      watermarked: true,
    })

    expect(lastParams()).toContain(true)
  })

  it("watermarked default false saat tak dipassing caller", async () => {
    query.mockResolvedValueOnce({ rows: [makeRow()] })

    await createRenderJob("rnd-abc123", "user-1", {
      projectId: "proj-1",
      mode: "cepat",
      preset: "tropis-siang",
      shotId: "iso-siang",
      seed: 42,
      creditsSpent: 1,
      provider: "mock",
      paramsHash: "hash-abc",
      inputKeys: { beauty: "renders/user-1/proj-1/beauty.png" },
    })

    // watermarked bukan param terakhir lagi sejak camera_pose ditambahkan
    // (0043) di ujung daftar INSERT — cek posisi eksplisitnya.
    expect(lastParams().at(-2)).toBe(false)
  })

  it("cameraPose diberikan -> kolom camera_pose ikut INSERT sbg JSON.stringify", async () => {
    const cameraPose = { position: [1, 2, 3], target: [0, 0, 0], fov: 50 }
    query.mockResolvedValueOnce({
      rows: [makeRow({ camera_pose: cameraPose })],
    })

    await createRenderJob("rnd-abc123", "user-1", {
      projectId: "proj-1",
      mode: "cepat",
      preset: "tropis-siang",
      shotId: "iso-siang",
      seed: 42,
      creditsSpent: 1,
      provider: "mock",
      paramsHash: "hash-abc",
      inputKeys: { beauty: "renders/user-1/proj-1/beauty.png" },
      cameraPose,
    })

    expect(lastSql()).toMatch(/camera_pose/)
    expect(lastParams()).toContain(JSON.stringify(cameraPose))
  })

  it("cameraPose tak diberikan -> kolom camera_pose null", async () => {
    query.mockResolvedValueOnce({ rows: [makeRow()] })

    await createRenderJob("rnd-abc123", "user-1", {
      projectId: "proj-1",
      mode: "cepat",
      preset: "tropis-siang",
      shotId: "iso-siang",
      seed: 42,
      creditsSpent: 1,
      provider: "mock",
      paramsHash: "hash-abc",
      inputKeys: { beauty: "renders/user-1/proj-1/beauty.png" },
    })

    expect(lastSql()).toMatch(/camera_pose/)
    expect(lastParams()).toContain(null)
  })

  it("target TIDAK disisipkan eksplisit (DEFAULT 'exterior' di DB yang menangani)", async () => {
    query.mockResolvedValueOnce({ rows: [makeRow()] })

    await createRenderJob("rnd-abc123", "user-1", {
      projectId: "proj-1",
      mode: "cepat",
      preset: "tropis-siang",
      shotId: "iso-siang",
      seed: 42,
      creditsSpent: 1,
      provider: "mock",
      paramsHash: "hash-abc",
      inputKeys: { beauty: "renders/user-1/proj-1/beauty.png" },
    })

    // Hanya periksa daftar kolom INSERT (sebelum VALUES) — RETURNING boleh
    // (dan memang) berisi `target` lewat COLS, itu bukan yang diperiksa di sini.
    const insertCols = lastSql().slice(0, lastSql().indexOf("VALUES"))
    expect(insertCols).not.toMatch(/\btarget\b/)
  })

  it("target+roomId diberikan (Fase B interior) -> kolom target & room_id ikut INSERT via placeholder dinamis", async () => {
    query.mockResolvedValueOnce({
      rows: [makeRow({ target: "interior", room_id: "r1" })],
    })

    const job = await createRenderJob("rnd-abc123", "user-1", {
      projectId: "proj-1",
      mode: "cepat",
      preset: "tropis-siang",
      shotId: "iso-siang",
      seed: 42,
      creditsSpent: 1,
      provider: "mock",
      paramsHash: "hash-abc",
      inputKeys: { beauty: "renders/user-1/proj-1/beauty.png" },
      target: "interior",
      roomId: "r1",
    })

    const insertCols = lastSql().slice(0, lastSql().indexOf("VALUES"))
    expect(insertCols).toMatch(/\btarget\b/)
    expect(insertCols).toMatch(/\broom_id\b/)
    expect(lastParams()).toContain("interior")
    expect(lastParams()).toContain("r1")
    expect(job.target).toBe("interior")
    expect(job.roomId).toBe("r1")
  })
})

describe("getRenderJob — owner-scoped (anti-IDOR)", () => {
  it("mengembalikan job saat ownerId cocok", async () => {
    query.mockResolvedValueOnce({ rows: [makeRow()] })
    const job = await getRenderJob("rnd-abc123", "user-1")
    expect(job?.id).toBe("rnd-abc123")
    expect(lastSql()).toMatch(/WHERE id = \$1 AND owner_id = \$2/)
    expect(lastParams()).toEqual(["rnd-abc123", "user-1"])
  })

  it("owner salah -> null (WHERE tak pernah menyingkirkan owner_id dari klausa)", async () => {
    // Simulasikan DB sungguhan: baris tak match owner lain -> 0 rows.
    query.mockResolvedValueOnce({ rows: [] })
    const job = await getRenderJob("rnd-abc123", "user-lain")
    expect(job).toBeNull()
    expect(lastParams()).toEqual(["rnd-abc123", "user-lain"])
  })

  it("memetakan target/room_id/camera_pose (0043) ke camelCase", async () => {
    const cameraPose = { position: [1, 2, 3] }
    query.mockResolvedValueOnce({
      rows: [makeRow({ target: "interior", room_id: "room-1", camera_pose: cameraPose })],
    })
    const job = await getRenderJob("rnd-abc123", "user-1")
    expect(job?.target).toBe("interior")
    expect(job?.roomId).toBe("room-1")
    expect(job?.cameraPose).toEqual(cameraPose)
  })

  it("room_id/camera_pose null -> roomId/cameraPose undefined; target default 'exterior'", async () => {
    query.mockResolvedValueOnce({ rows: [makeRow()] })
    const job = await getRenderJob("rnd-abc123", "user-1")
    expect(job?.target).toBe("exterior")
    expect(job?.roomId).toBeUndefined()
    expect(job?.cameraPose).toBeUndefined()
  })
})

describe("getRenderJobById — unscoped (dipakai webhook, digerbangi token bukan ownerId)", () => {
  it("mengembalikan job tanpa filter owner_id", async () => {
    query.mockResolvedValueOnce({ rows: [makeRow()] })
    const job = await getRenderJobById("rnd-abc123")
    expect(job?.id).toBe("rnd-abc123")
    // WHERE clause hanya `id = $1` — tanpa AND owner_id (unscoped, beda dgn
    // getRenderJob). `owner_id` tetap muncul di SELECT list (COLS) sbg kolom
    // yang dikembalikan, itu bukan bagian filter WHERE.
    expect(lastSql()).toMatch(/WHERE id = \$1$/)
    expect(lastParams()).toEqual(["rnd-abc123"])
  })

  it("tak ditemukan -> null", async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const job = await getRenderJobById("rnd-tak-ada")
    expect(job).toBeNull()
  })
})

describe("updateRenderJob — dynamic SET builder", () => {
  it("hanya field yang diisi yang masuk SET", async () => {
    query.mockResolvedValueOnce({ rows: [makeRow({ status: "succeeded", output_key: "renders/out.png" })] })
    const job = await updateRenderJob("rnd-abc123", { status: "succeeded", outputKey: "renders/out.png" })

    // SET clause harus berisi hanya kedua field yang diisi (kolom lain di
    // RETURNING boleh muncul; yang diperiksa adalah klausa SET-nya sendiri).
    expect(lastSql()).toMatch(/SET status = \$1, output_key = \$2 WHERE/)
    expect(lastParams()).toEqual(["succeeded", "renders/out.png", "rnd-abc123"])
    expect(job?.status).toBe("succeeded")
    expect(job?.outputKey).toBe("renders/out.png")
  })

  it("patch kosong -> null tanpa memanggil query (tak ada UPDATE tanpa SET)", async () => {
    const job = await updateRenderJob("rnd-abc123", {})
    expect(job).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it("fromStatuses menambah guard AND status = ANY($..) dan transisi berhasil bila status cocok", async () => {
    query.mockResolvedValueOnce({ rows: [makeRow({ status: "succeeded" })] })
    const job = await updateRenderJob(
      "rnd-abc123",
      { status: "succeeded" },
      { fromStatuses: ["submitted", "processing"] }
    )

    expect(lastSql()).toMatch(/WHERE id = \$2 AND status = ANY\(\$3\)/)
    expect(lastParams()).toEqual(["succeeded", "rnd-abc123", ["submitted", "processing"]])
    expect(job?.status).toBe("succeeded")
  })

  it("guard fromStatuses tak cocok (race webhook vs rekonsiliasi) -> 0 baris -> null", async () => {
    // DB sungguhan: WHERE ... AND status = ANY(...) tak match row (status sudah
    // berubah duluan) -> RETURNING kosong.
    query.mockResolvedValueOnce({ rows: [] })
    const job = await updateRenderJob(
      "rnd-abc123",
      { status: "failed" },
      { fromStatuses: ["submitted"] }
    )
    expect(job).toBeNull()
  })
})

describe("listRenderJobs", () => {
  it("scoped ke project+owner, urut created_at DESC, limit default 50", async () => {
    query.mockResolvedValueOnce({ rows: [makeRow(), makeRow({ id: "rnd-def456" })] })
    const jobs = await listRenderJobs("proj-1", "user-1")

    expect(lastSql()).toMatch(/WHERE project_id = \$1 AND owner_id = \$2/)
    expect(lastSql()).toMatch(/ORDER BY created_at DESC/)
    expect(lastParams()).toEqual(["proj-1", "user-1", 50])
    expect(jobs).toHaveLength(2)
    expect(jobs[0].id).toBe("rnd-abc123")
  })

  it("limit custom diteruskan sebagai param", async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await listRenderJobs("proj-1", "user-1", 10)
    expect(lastParams()).toEqual(["proj-1", "user-1", 10])
  })
})

describe("findCachedRender", () => {
  it("hit: mengembalikan job succeeded terbaru dgn params_hash sama", async () => {
    query.mockResolvedValueOnce({ rows: [makeRow({ status: "succeeded" })] })
    const job = await findCachedRender("user-1", "hash-abc")

    expect(lastSql()).toMatch(/status = 'succeeded'/)
    expect(lastSql()).toMatch(/ORDER BY created_at DESC/)
    expect(lastSql()).toMatch(/LIMIT 1/)
    expect(lastParams()).toEqual(["user-1", "hash-abc"])
    expect(job?.status).toBe("succeeded")
  })

  it("miss: tak ada baris cocok -> null", async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const job = await findCachedRender("user-1", "hash-tak-ada")
    expect(job).toBeNull()
  })
})
