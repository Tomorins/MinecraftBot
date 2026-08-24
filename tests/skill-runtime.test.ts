import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EventBus } from '../src/core/event-bus.js'
import { MockExecutor } from '../src/executor/mock-executor.js'
import { createBuiltinSkills } from '../src/skills/builtin.js'
import { SkillRuntime } from '../src/skills/runtime.js'
import type { SkillDefinition } from '../src/skills/types.js'
import { sleep } from '../src/core/utils.js'
import { worldContext } from './helpers.js'

describe('SkillRuntime', () => {
  it('runs and verifies a collection skill', async () => {
    const executor = new MockExecutor()
    executor.blocks = [1, 2, 3].map(index => ({ name: 'cobblestone', position: { x: index, y: 64, z: 0 }, distance: index, category: 'resource' as const }))
    const runtime = new SkillRuntime(executor, worldContext, new EventBus(), 5000)
    runtime.registerAll(createBuiltinSkills())
    const result = await runtime.run('collect_blocks', { blocks: ['cobblestone'], count: 3, expectedItem: 'cobblestone', searchRadius: 16 }).result
    expect(result.status).toBe('success')
    expect(executor.inventoryCount('cobblestone')).toBe(3)
  })

  it('lets emergency work preempt normal movement', async () => {
    const executor = new MockExecutor()
    const slow: SkillDefinition = {
      name: 'slow', description: 'slow', schema: z.object({}), resources: ['movement'], priority: 'normal',
      async run(ctx) { await sleep(5000, ctx.signal); return { status: 'success', recoverable: false } }
    }
    const emergency: SkillDefinition = {
      name: 'emergency', description: 'emergency', schema: z.object({}), resources: ['movement'], priority: 'emergency',
      async run() { return { status: 'success', recoverable: false } }
    }
    const runtime = new SkillRuntime(executor, worldContext, new EventBus(), 10_000)
    runtime.registerAll([slow, emergency])
    const slowHandle = runtime.run('slow', {})
    const emergencyResult = await runtime.run('emergency', {}).result
    expect(emergencyResult.status).toBe('success')
    expect((await slowHandle.result).status).toBe('cancelled')
  })
})
