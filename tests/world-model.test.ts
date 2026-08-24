import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../src/memory/sqlite-memory.js'
import { WorldModel } from '../src/world/world-model.js'
import { snapshot } from './helpers.js'

describe('WorldModel', () => {
  it('summarizes threats, resources and stations', () => {
    const store = new MemoryStore(':memory:')
    const model = new WorldModel(store)
    const context = model.update(snapshot({
      entities: [{ id: 1, name: 'zombie', kind: 'mob', position: { x: 3, y: 64, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, distance: 3, hostile: true, player: false }],
      blocks: [
        { name: 'iron_ore', position: { x: 2, y: 63, z: 0 }, distance: 2.2, category: 'resource' },
        { name: 'crafting_table', position: { x: 1, y: 64, z: 0 }, distance: 1, category: 'station' }
      ]
    }))
    expect(context.scene.threats[0]?.name).toBe('zombie')
    expect(context.scene.resources[0]).toMatchObject({ name: 'iron_ore', visibleCount: 1 })
    expect(store.queryMemories('location')[0]?.key).toContain('crafting_table')
    model.rememberLocation('base')
    expect(model.context().memories.some(memory => memory.key === 'base')).toBe(true)
    store.close()
  })
})
