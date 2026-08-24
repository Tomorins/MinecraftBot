import type { Plan, SkillResult, WorldContext } from '../types.js'

export interface SkillCatalogEntry {
  name: string
  description: string
  parameters: unknown
}

export interface PlanningInput {
  command: string
  owner: string
  context: WorldContext
  skills: SkillCatalogEntry[]
  exactKnowledge?: unknown
  guideKnowledge?: unknown
}

export interface RecoveryInput {
  originalGoal: string
  failedSkill: string
  failedParams: Record<string, unknown>
  result: SkillResult
  context: WorldContext
  skills: SkillCatalogEntry[]
  exactKnowledge?: unknown
}

export interface LLMProvider {
  plan(input: PlanningInput, signal?: AbortSignal): Promise<Plan>
  recover(input: RecoveryInput, signal?: AbortSignal): Promise<Plan>
  chat(message: string, context: WorldContext, signal?: AbortSignal): Promise<string>
  analyzeImage?(prompt: string, base64Image: string, mimeType: string, signal?: AbortSignal): Promise<string>
}
