import { z } from 'zod'

export const planStepSchema = z.object({
  id: z.string().min(1),
  skill: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  dependsOn: z.array(z.string()).default([]),
  onFailure: z.enum(['retry', 'replan', 'abort']).default('replan')
})

export const planSchema = z.object({
  goal: z.string().min(1),
  reply: z.string().default(''),
  steps: z.array(planStepSchema).max(100).default([]),
  assumptions: z.array(z.string()).default([])
})

export const chatSchema = z.object({ reply: z.string() })
