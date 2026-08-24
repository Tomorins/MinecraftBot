import { describe, expect, it } from 'vitest'
import { MinecraftKnowledge } from '../src/knowledge/minecraft-knowledge.js'
import { GuideRag } from '../src/knowledge/rag.js'
import { MemoryStore } from '../src/memory/sqlite-memory.js'

describe('knowledge services', () => {
  it('loads exact recipes and expands a crafting graph', () => {
    const knowledge = new MinecraftKnowledge('1.21.4')
    const recipes = knowledge.getRecipesFor('stone_pickaxe')
    expect(recipes.length).toBeGreaterThan(0)
    expect(recipes[0]?.ingredients.some(item => item.item === 'stick')).toBe(true)
    const plan = knowledge.calculateCraftingPlan('stone_pickaxe', 1, { cobblestone: 3, stick: 2 })
    expect(plan.item).toBe('stone_pickaxe')
    expect(plan.children.every(child => child.available >= child.count)).toBe(true)
  })

  it('retrieves Chinese guide knowledge', () => {
    const store = new MemoryStore(':memory:')
    const rag = new GuideRag(store)
    rag.seedDefaults()
    const results = rag.search('下界传送门需要准备什么')
    expect(results[0]?.title).toBe('下界准备')
    store.close()
  })
})
