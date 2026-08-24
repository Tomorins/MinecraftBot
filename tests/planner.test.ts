import { describe, expect, it } from 'vitest'
import { EventBus } from '../src/core/event-bus.js'
import { MockExecutor } from '../src/executor/mock-executor.js'
import { GuideRag } from '../src/knowledge/rag.js'
import { MinecraftKnowledge } from '../src/knowledge/minecraft-knowledge.js'
import type { LLMProvider } from '../src/llm/provider.js'
import { MemoryStore } from '../src/memory/sqlite-memory.js'
import { Planner } from '../src/planner/planner.js'
import { createBuiltinSkills } from '../src/skills/builtin.js'
import { SkillRuntime } from '../src/skills/runtime.js'
import type { Plan, WorldContext } from '../src/types.js'
import { WorldModel } from '../src/world/world-model.js'
import { snapshot } from './helpers.js'

class FixedProvider implements LLMProvider {
  plan(): Promise<Plan> { return Promise.resolve({ goal: 'go', reply: 'moving', assumptions: [], steps: [{ id: 'go', skill: 'navigate_to', params: { position: { x: 5, y: 64, z: 7 }, range: 1 }, dependsOn: [], onFailure: 'abort' }] }) }
  recover(): Promise<Plan> { return Promise.resolve({ goal: 'stop', reply: '', assumptions: [], steps: [] }) }
  chat(_message: string, _context: WorldContext): Promise<string> { return Promise.resolve('ok') }
}

describe('Planner', () => {
  it('validates and executes a structured skill plan', async () => {
    const memory = new MemoryStore(':memory:')
    const world = new WorldModel(memory)
    world.update(snapshot())
    const executor = new MockExecutor()
    const runtime = new SkillRuntime(executor, () => world.context(), new EventBus(), 5000)
    runtime.registerAll(createBuiltinSkills())
    const rag = new GuideRag(memory)
    const planner = new Planner(new FixedProvider(), runtime, world, memory, new MinecraftKnowledge('1.21.4'), rag, 'FuQiang', 20)
    const task = await planner.submit('去指定坐标')
    expect(task.status).toBe('completed')
    expect(executor.currentPosition()).toEqual({ x: 5, y: 64, z: 7 })
    expect(executor.actions.some(action => action.name === 'chat')).toBe(true)
    memory.close()
  })
})
