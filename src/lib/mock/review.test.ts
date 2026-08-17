import { describe, expect, it } from "vitest"

/**
 * Bug: ensureReview() (src/lib/mock/index.ts) meng-cache Review permanen di
 * db.reviews[projectId] dan saveLayout() tidak pernah menginvalidasinya —
 * tab "Review & catatan" terus menampilkan warning lama (mis. overlap yang
 * sudah diperbaiki user) walau layout.validation terkini sudah bersih.
 *
 * Fix: ensureReview membandingkan stempel revisi review dengan
 * db.layoutRevisions terkini; kalau berbeda, ia meregenerasi warnings/
 * aiSummary dari layout terbaru TAPI mempertahankan field stateful
 * (comments, checklist, resolvedWarningIds yang masih relevan).
 */
describe("mock review cache invalidation (saveLayout → getReview)", () => {
  it("review pertama berisi warning overlap dari layout ber-overlap", async () => {
    const { getLayoutDocument, saveLayout, getReview, DEMO_PROJECT_ID } = await import(
      "@/lib/mock"
    )

    const doc = await getLayoutDocument(DEMO_PROJECT_ID)
    expect(doc).not.toBeNull()

    const overlappingLayout = structuredClone(doc!.layout)
    overlappingLayout.validation = {
      passed: false,
      issues: [
        {
          id: "test-overlap-1",
          level: "warning",
          category: "spatial",
          message: "Carport dan Ruang tamu bertumpuk",
        },
      ],
    }
    await saveLayout(DEMO_PROJECT_ID, {
      layout: overlappingLayout,
      expectedRevision: doc!.revision,
    })

    const review = await getReview(DEMO_PROJECT_ID)
    expect(review).not.toBeNull()
    expect(
      review!.warnings.some((w) => w.message.includes("Carport dan Ruang tamu bertumpuk"))
    ).toBe(true)
  })

  it("setelah saveLayout dengan layout bersih, getReview TIDAK lagi mengembalikan warning overlap — tapi comments/checklist user tetap bertahan", async () => {
    const {
      getLayoutDocument,
      saveLayout,
      getReview,
      addComment,
      setChecklistStatus,
      toggleWarningResolved,
      DEMO_PROJECT_ID,
    } = await import("@/lib/mock")

    // 1) Seed layout ber-overlap dan biarkan review pertama tercache.
    const doc = await getLayoutDocument(DEMO_PROJECT_ID)
    const overlappingLayout = structuredClone(doc!.layout)
    overlappingLayout.validation = {
      passed: false,
      issues: [
        {
          id: "test-overlap-1",
          level: "warning",
          category: "spatial",
          message: "Carport dan Ruang tamu bertumpuk",
        },
      ],
    }
    const savedOverlap = await saveLayout(DEMO_PROJECT_ID, {
      layout: overlappingLayout,
      expectedRevision: doc!.revision,
    })

    const reviewBefore = await getReview(DEMO_PROJECT_ID)
    const overlapWarning = reviewBefore!.warnings.find((w) =>
      w.message.includes("bertumpuk")
    )
    expect(overlapWarning).toBeDefined()

    // 2) User berinteraksi dengan review: comment, checklist, tandai warning
    //    selesai — field stateful ini TIDAK BOLEH hilang saat layout berubah.
    await addComment(DEMO_PROJECT_ID, "Sudah dicek, tunggu approval kontraktor", "Reviewer")
    await setChecklistStatus(DEMO_PROJECT_ID, "arsitek", "reviewed")
    await toggleWarningResolved(DEMO_PROJECT_ID, overlapWarning!.id)

    // 3) User memperbaiki overlap di editor lalu autosave — layout.validation
    //    sekarang bersih.
    const cleanLayout = structuredClone(savedOverlap.layout)
    cleanLayout.validation = { passed: true, issues: [] }
    await saveLayout(DEMO_PROJECT_ID, {
      layout: cleanLayout,
      expectedRevision: savedOverlap.revision,
    })

    // 4) Review harus regenerasi warnings dari layout terbaru (overlap
    //    hilang) tapi tetap membawa comment & status checklist milik user.
    const reviewAfter = await getReview(DEMO_PROJECT_ID)
    expect(reviewAfter).not.toBeNull()
    expect(
      reviewAfter!.warnings.some((w) => w.message.includes("bertumpuk"))
    ).toBe(false)

    expect(
      reviewAfter!.comments.some(
        (c) => c.body === "Sudah dicek, tunggu approval kontraktor"
      )
    ).toBe(true)
    expect(
      reviewAfter!.checklist.find((c) => c.role === "arsitek")?.status
    ).toBe("reviewed")

    // resolvedWarningIds yang menunjuk warning yang sudah tak ada lagi
    // (overlap yang sudah beres) disaring — tidak ada gunanya menyimpan id
    // basi.
    expect(reviewAfter!.resolvedWarningIds).not.toContain(overlapWarning!.id)
  })
})
