/** Centralized query keys (PRD §12.1). */
export const queryKeys = {
  user: ["user"] as const,
  plans: ["plans"] as const,
  projects: ["projects"] as const,
  project: (projectId: string) => ["project", projectId] as const,
  brief: (projectId: string) => ["brief", projectId] as const,
  alternatives: (projectId: string) => ["alternatives", projectId] as const,
  rab: (projectId: string, finishing?: string) =>
    ["rab", projectId, finishing ?? "default"] as const,
  layout: (projectId: string) => ["layout", projectId] as const,
  interior: (projectId: string) => ["interior", projectId] as const,
  review: (projectId: string) => ["review", projectId] as const,
  shareLink: (projectId: string) => ["share-link", projectId] as const,

  assistant: (projectId: string) => ["assistant", projectId] as const,

  // assets
  uploadUrl: ["assets", "upload-url"] as const,
  ingestionJob: (jobId: string) => ["assets", "ingestion-job", jobId] as const,
  asset: (assetId: string) => ["assets", "asset", assetId] as const,
  myAssets: (category?: string, search?: string) =>
    ["assets", "my-library", category ?? "all", search ?? ""] as const,

  // AI Image Renderer (Fase 8 — docs/plan-integrasi-ai-renderer-2026-08.md)
  renders: (projectId: string) => ["renders", projectId] as const,
  render: (projectId: string, renderId: string) => ["renders", projectId, renderId] as const,

  // admin backoffice (Task 8)
  adminPlans: ["admin", "plans"] as const,
  adminSubscriptions: ["admin", "subscriptions"] as const,
  adminUsers: ["admin", "users"] as const,

  // templates (curated ready-made designs)
  templates: ["templates"] as const,
  template: (slug: string) => ["templates", slug] as const,
  adminTemplates: ["admin", "templates"] as const,

  // component presets (Studio Komponen)
  componentPresets: ["component-presets"] as const,
}
