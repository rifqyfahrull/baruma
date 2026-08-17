// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

beforeAll(() => { process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test" })

vi.mock("@/lib/server/db", () => ({ query: vi.fn(), getClient: vi.fn() }))

import { listMessages, appendMessage, claimTurn, completeTurn, setMessageStatus } from "./assistant"
import * as db from "@/lib/server/db"

describe("repo/assistant", () => {
  beforeEach(() => {
    vi.mocked(db.query).mockReset()
    vi.mocked(db.getClient).mockReset()
  })
  it("listMessages orders by created_at and maps rows", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{
        id: "m1", project_id: "p1", mode: "floorplan", role: "assistant",
        content: "hi", actions: [{ type: "deleteRoom", roomId: "r1" }],
        action_labels: ["Hapus ruang"], status: "proposed", created_at: "2026-06-29T00:00:00Z",
      }],
      rowCount: 1,
    } as never)

    const out = await listMessages("p1")
    const [sql] = vi.mocked(db.query).mock.calls.at(-1) as [string, unknown[]]
    expect(sql).toContain("ORDER BY created_at")
    expect(out[0]).toMatchObject({ id: "m1", mode: "floorplan", status: "proposed" })
    expect(out[0].actionLabels).toEqual(["Hapus ruang"])
  })

  it("appendMessage inserts and returns the mapped row", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{
        id: "m2", project_id: "p1", mode: "interior", role: "user",
        content: "tambah sofa", actions: null, action_labels: null,
        status: null, created_at: "2026-06-29T00:00:01Z",
      }],
      rowCount: 1,
    } as never)
    const out = await appendMessage("p1", { mode: "interior", role: "user", content: "tambah sofa" })
    const [sql] = vi.mocked(db.query).mock.calls.at(-1) as [string, unknown[]]
    expect(sql).toContain("INSERT INTO assistant_messages")
    expect(out.id).toBe("m2")
    expect(out.status).toBeNull()
  })

  it("appendMessage menyimpan plannerNote dan memetakannya kembali (opsi B 2-agent)", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{
        id: "m3", project_id: "p1", mode: "floorplan", role: "assistant",
        content: "hi", planner_note: "1. Buat koridor 1 m di tengah.", actions: null,
        action_labels: null, status: "proposed", created_at: "2026-06-29T00:00:02Z",
      }],
      rowCount: 1,
    } as never)
    const out = await appendMessage("p1", {
      mode: "floorplan", role: "assistant", content: "hi", plannerNote: "1. Buat koridor 1 m di tengah.",
    })
    const [sql, params] = vi.mocked(db.query).mock.calls.at(-1) as [string, unknown[]]
    expect(sql).toContain("planner_note")
    expect(params).toContain("1. Buat koridor 1 m di tengah.")
    expect(out.plannerNote).toBe("1. Buat koridor 1 m di tengah.")
  })

  it("completeTurn menyimpan plannerNote pada insert reply", async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("INSERT INTO assistant_messages")) {
        return {
          rows: [{
            id: "a2", project_id: "p1", mode: "floorplan", surface: "editor", turn_id: "t1",
            client_request_id: null, request_state: null, processing_started_at: null,
            role: "assistant", content: "ok", planner_note: "rencana", actions: null,
            action_labels: null, status: "proposed", created_at: "2026-07-12T00:00:01Z",
          }], rowCount: 1,
        }
      }
      return { rows: [], rowCount: 1 }
    })
    const client = { query, release: vi.fn() }
    vi.mocked(db.getClient).mockResolvedValue(client as never)

    const reply = await completeTurn({
      id: "u1", projectId: "p1", mode: "floorplan", surface: "editor", turnId: "t1",
      requestState: "pending", role: "user", content: "q", createdAt: "2026-07-12T00:00:00Z",
    }, { mode: "floorplan", surface: "editor", content: "ok", plannerNote: "rencana" })

    expect(reply.plannerNote).toBe("rencana")
    const insertCall = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO assistant_messages"))
    expect(insertCall?.[1]).toContain("rencana")
  })

  it("setMessageStatus guards by project_id", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    await setMessageStatus("p1", "m1", "applied")
    const [sql, params] = vi.mocked(db.query).mock.calls.at(-1) as [string, unknown[]]
    expect(sql).toContain("UPDATE assistant_messages SET status")
    expect(params).toEqual(["m1", "p1", "applied"])
  })

  it("claims a new request as one pending user turn", async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{
        id: "m-new", project_id: "p1", mode: "brief", surface: "brief",
        turn_id: "turn-1", client_request_id: "req-12345678", request_state: "pending",
        processing_started_at: "2026-07-12T00:00:00Z", role: "user", content: "halo",
        actions: null, action_labels: null, status: null, created_at: "2026-07-12T00:00:00Z",
      }],
      rowCount: 1,
    } as never)

    const result = await claimTurn({
      projectId: "p1", clientRequestId: "req-12345678", mode: "brief", surface: "brief", content: "halo",
    })
    expect(result.kind).toBe("claimed")
    expect(result.message).toMatchObject({ turnId: "turn-1", requestState: "pending" })
  })

  it("returns the existing reply for a completed duplicate request", async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({ rows: [
        {
          id: "u1", project_id: "p1", mode: "brief", surface: "brief", turn_id: "t1",
          client_request_id: "req-duplicate", request_state: "completed", role: "user",
          content: "halo", actions: null, action_labels: null, status: null, created_at: "2026-07-12T00:00:00Z",
        },
        {
          id: "a1", project_id: "p1", mode: "brief", surface: "brief", turn_id: "t1",
          client_request_id: "req-duplicate", request_state: null, role: "assistant",
          content: "hai", actions: null, action_labels: null, status: null, created_at: "2026-07-12T00:00:01Z",
        },
      ], rowCount: 2 } as never)

    const result = await claimTurn({
      projectId: "p1", clientRequestId: "req-duplicate", mode: "brief", surface: "brief", content: "halo",
    })
    expect(result.kind).toBe("completed")
    if (result.kind === "completed") expect(result.reply?.content).toBe("hai")
  })

  it("completes a paired turn in one transaction", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO assistant_messages")) {
        return { rows: [{
          id: "a1", project_id: "p1", mode: "brief", surface: "brief", turn_id: "t1",
          client_request_id: "req-1", request_state: null, processing_started_at: null,
          role: "assistant", content: "jawaban", actions: null, action_labels: null,
          status: null, created_at: "2026-07-12T00:00:01Z",
        }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    })
    const client = { query, release: vi.fn() }
    vi.mocked(db.getClient).mockResolvedValue(client as never)

    const reply = await completeTurn({
      id: "u1", projectId: "p1", mode: "brief", surface: "brief", turnId: "t1",
      clientRequestId: "req-1", requestState: "pending", role: "user", content: "q",
      createdAt: "2026-07-12T00:00:00Z",
    }, { mode: "brief", surface: "brief", content: "jawaban" })

    expect(reply.content).toBe("jawaban")
    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0])).toEqual([
      "BEGIN", "INSERT", "UPDATE", "COMMIT",
    ])
    expect(client.release).toHaveBeenCalledOnce()
  })
})
