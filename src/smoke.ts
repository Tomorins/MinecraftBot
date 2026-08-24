import { EventBus } from './core/event-bus.js'
import { MockExecutor } from './executor/mock-executor.js'
import { SkillRuntime } from './skills/runtime.js'
import { createBuiltinSkills } from './skills/builtin.js'
import type { WorldContext } from './types.js'

const executor = new MockExecutor()
executor.blocks = [1, 2, 3].map(index => ({
  name: 'cobblestone', position: { x: index, y: 64, z: 0 }, distance: index, category: 'resource'
}))
const context: WorldContext = {
  snapshot: {
    timestamp: Date.now(),
    self: { username: 'AI_Player', position: { x: 0, y: 64, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, health: 20, food: 20, oxygen: 20, dimension: 'overworld', gameMode: 'survival', onGround: true, isSleeping: false, effects: [] },
    inventory: [], entities: [], blocks: [], timeOfDay: 0, isRaining: false, recentEvents: []
  },
  scene: { locationType: 'surface', threats: [], resources: [], hazards: [], stations: [] },
  memories: []
}
const runtime = new SkillRuntime(executor, () => context, new EventBus(), 5000)
runtime.registerAll(createBuiltinSkills())
const result = await runtime.run('collect_blocks', { blocks: ['cobblestone'], expectedItem: 'cobblestone', count: 3, searchRadius: 16 }).result
if (result.status !== 'success') throw new Error(`Smoke test failed: ${result.reason}`)
console.log(JSON.stringify({ ok: true, collected: executor.inventoryCount('cobblestone'), registeredSkills: runtime.catalog().length }))
