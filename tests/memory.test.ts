import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../src/memory/sqlite-memory.js'

describe('MemoryStore', () => {
  it('upserts and spatially queries memories', () => {
    const store = new MemoryStore(':memory:')
    store.upsertMemory({ kind: 'location', key: 'base', value: { label: 'home' }, position: { x: 10, y: 64, z: 10 }, dimension: 'overworld', confidence: 1 })
    store.upsertMemory({ kind: 'location', key: 'base', value: { label: 'updated' }, position: { x: 11, y: 64, z: 10 }, dimension: 'overworld', confidence: 1 })
    const memories = store.nearbyMemories('overworld', 0, 0, 30)
    expect(memories).toHaveLength(1)
    expect(memories[0]?.value).toEqual({ label: 'updated' })
    expect(memories[0]?.position?.x).toBe(11)
    store.close()
  })

  it('persists and restores active tasks', () => {
    const store = new MemoryStore(':memory:')
    store.saveTask({ id: 't1', goal: 'test', status: 'running', currentStep: 's1', createdAt: 1, updatedAt: 2 })
    expect(store.latestActiveTask()).toMatchObject({ id: 't1', goal: 'test', status: 'running', currentStep: 's1' })
    store.close()
  })

  it('upserts non-spatial memories whose dimension is absent', () => {
    const store = new MemoryStore(':memory:')
    store.upsertMemory({ kind: 'summary', key: 'owner_preferences', value: { first: true }, confidence: 1 })
    store.upsertMemory({ kind: 'summary', key: 'owner_preferences', value: { first: false }, confidence: 1 })
    expect(store.queryMemories('summary')).toHaveLength(1)
    expect(store.queryMemories('summary')[0]?.value).toEqual({ first: false })
    store.close()
  })
})
