import type { z } from 'zod'
import type {
  ActionExecutor, ResourceName, SkillPriority, SkillProgress, SkillResult, Vec3Like, WorldContext
} from '../types.js'

export interface SkillContext {
  executor: ActionExecutor
  signal: AbortSignal
  world: () => WorldContext
  rememberLocation: (key: string, position?: Vec3Like) => void
  progress: (progress: Omit<SkillProgress, 'skill'>) => void
}

export interface SkillDefinition<T extends Record<string, unknown> = any> {
  name: string
  description: string
  schema: z.ZodType<T>
  resources: ResourceName[]
  priority: SkillPriority
  defaultTimeoutMs?: number
  run(context: SkillContext, params: T): Promise<SkillResult>
}

export interface SkillHandle {
  id: string
  name: string
  priority: SkillPriority
  resources: ResourceName[]
  startedAt: number
  result: Promise<SkillResult>
  cancel(reason?: string): void
}
