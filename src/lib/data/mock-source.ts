import * as mock from "@/lib/mock"
import type { DataSource } from "./source"

/**
 * Implementasi mock in-memory dari DataSource. File ini HANYA boleh diimpor
 * lewat `await import()` dari data/index.ts — impor statis akan menyeret
 * seluruh @/lib/mock (~570 KB) ke bundle awal setiap halaman.
 */
export const mockSource: DataSource = {
  getCurrentUser: mock.getCurrentUser,
  updateProfile: mock.updateProfile,
  getPlans: mock.getPlans,
  listProjects: mock.listProjects,
  getProject: mock.getProject,
  createProject: mock.createProject,
  deleteProject: mock.deleteProject,
  updateProject: mock.updateProject,
  getProjectCapabilities: mock.getProjectCapabilities,
  getBrief: mock.getBrief,
  updateBrief: mock.updateBrief,
  askBriefAssistant: mock.askBriefAssistant,
  listAssistantMessages: mock.listAssistantMessages,
  sendProjectAgentMessage: mock.sendProjectAgentMessage,
  sendAssistantMessage: mock.sendAssistantMessage,
  setAssistantMessageStatus: mock.setAssistantMessageStatus,
  generateAlternatives: mock.generateAlternatives,
  getAlternatives: mock.getAlternatives,
  selectAlternative: mock.selectAlternative,
  getRAB: mock.getRAB,
  saveRAB: mock.saveRAB,
  resetRAB: mock.resetRAB,
  getLayout: mock.getLayout,
  getLayoutDocument: mock.getLayoutDocument,
  saveLayout: mock.saveLayout,
  getInterior: mock.getInterior,
  saveInterior: mock.saveInterior,
  getReview: mock.getReview,
  addComment: mock.addComment,
  toggleCommentResolved: mock.toggleCommentResolved,
  setChecklistStatus: mock.setChecklistStatus,
  toggleWarningResolved: mock.toggleWarningResolved,

  // assets
  requestUploadUrl: mock.requestUploadUrl,
  createIngestionJob: mock.createIngestionJob,
  getIngestionJob: mock.getIngestionJob,
  updateAssetMetadata: mock.updateAssetMetadata,
  attachAssetToSlot: mock.attachAssetToSlot,
  detachAssetFromSlot: mock.detachAssetFromSlot,
  listMyAssets: mock.listMyAssets,

  // AI Image Renderer (Fase 8)
  requestRenderUploadUrl: mock.requestRenderUploadUrl,
  createRender: mock.createRender,
  listRenders: mock.listRenders,
  getRender: mock.getRender,

  // admin backoffice (Task 8)
  getAdminPlans: mock.getAdminPlans,
  updatePlan: mock.updatePlan,
  getAdminSubscriptions: mock.getAdminSubscriptions,
  getAdminUsers: mock.getAdminUsers,
  updateUserRole: mock.updateUserRole,
  updateUserPlan: mock.updateUserPlan,
  adjustUserCredits: mock.adjustUserCredits,
  createPhantomLogin: mock.createPhantomLogin,

  // templates
  getTemplates: mock.getTemplates,
  getTemplate: mock.getTemplate,
  getAdminTemplates: mock.getAdminTemplates,
  createTemplate: mock.createTemplate,
  updateTemplate: mock.updateTemplate,
  deleteTemplate: mock.deleteTemplate,

  // component presets (Studio Komponen)
  listComponentPresets: mock.listComponentPresets,
  saveComponentPreset: mock.saveComponentPreset,
  deleteComponentPreset: mock.deleteComponentPreset,
}
