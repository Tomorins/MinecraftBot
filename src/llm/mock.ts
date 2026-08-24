import type { LLMProvider, PlanningInput, RecoveryInput } from './provider.js'
import type { Plan, WorldContext } from '../types.js'

export class MockLLMProvider implements LLMProvider {
  async plan(input: PlanningInput): Promise<Plan> {
    const command = input.command.trim()
    const follow = command.match(/(?:跟随|跟着|follow)\s*([A-Za-z0-9_]*)/i)
    if (follow) return {
      goal: command,
      reply: '好，我会跟着你。',
      steps: [{ id: 'follow', skill: 'follow_player', params: { username: follow[1] || input.owner, distance: 2.5, durationSeconds: 3600 }, dependsOn: [], onFailure: 'replan' }],
      assumptions: []
    }
    const coordinates = command.match(/(-?\d+(?:\.\d+)?)\s*[,， ]\s*(-?\d+(?:\.\d+)?)\s*[,， ]\s*(-?\d+(?:\.\d+)?)/)
    if (coordinates) return {
      goal: command,
      reply: '好，我正在过去。',
      steps: [{ id: 'navigate', skill: 'navigate_to', params: { position: { x: Number(coordinates[1]), y: Number(coordinates[2]), z: Number(coordinates[3]) }, range: 2 }, dependsOn: [], onFailure: 'replan' }],
      assumptions: []
    }
    if (/石镐|stone pickaxe/i.test(command)) return this.stonePickaxePlan(input.owner)
    return { goal: command, reply: `收到：${command}`, steps: [], assumptions: ['mock planner only supports follow, coordinates and stone pickaxe'] }
  }

  async recover(input: RecoveryInput): Promise<Plan> {
    return { goal: input.originalGoal, reply: `任务遇到问题：${input.result.reason ?? '未知错误'}，我先停止并等待指示。`, steps: [], assumptions: [] }
  }

  async chat(message: string, _context: WorldContext): Promise<string> {
    return `收到：${message}`
  }

  private stonePickaxePlan(owner: string): Plan {
    return {
      goal: '制作一把石镐并交付',
      reply: '好，我去制作一把石镐并交给你。',
      steps: [
        { id: 'logs', skill: 'collect_blocks', params: { blocks: ['oak_log'], expectedItem: 'oak_log', count: 3, searchRadius: 32 }, dependsOn: [], onFailure: 'replan' },
        { id: 'planks', skill: 'craft_item', params: { item: 'oak_planks', count: 8 }, dependsOn: ['logs'], onFailure: 'replan' },
        { id: 'sticks', skill: 'craft_item', params: { item: 'stick', count: 2 }, dependsOn: ['planks'], onFailure: 'replan' },
        { id: 'table', skill: 'craft_item', params: { item: 'crafting_table', count: 1 }, dependsOn: ['planks'], onFailure: 'replan' },
        { id: 'place_table', skill: 'place_nearby', params: { item: 'crafting_table', radius: 2 }, dependsOn: ['table'], onFailure: 'replan' },
        { id: 'wood_pick', skill: 'craft_item', params: { item: 'wooden_pickaxe', count: 1 }, dependsOn: ['sticks', 'place_table'], onFailure: 'replan' },
        { id: 'stone', skill: 'collect_blocks', params: { blocks: ['stone'], expectedItem: 'cobblestone', count: 3, searchRadius: 32 }, dependsOn: ['wood_pick'], onFailure: 'replan' },
        { id: 'stone_pick', skill: 'craft_item', params: { item: 'stone_pickaxe', count: 1 }, dependsOn: ['stone'], onFailure: 'replan' },
        { id: 'deliver', skill: 'deliver_item', params: { username: owner, item: 'stone_pickaxe', count: 1 }, dependsOn: ['stone_pick'], onFailure: 'replan' }
      ],
      assumptions: ['附近存在树木和石头', '工作台会被放置或附近已有工作台']
    }
  }
}
