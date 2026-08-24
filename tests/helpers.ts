import type { PerceptionSnapshot, WorldContext } from '../src/types.js'

export function snapshot(overrides: Partial<PerceptionSnapshot> = {}): PerceptionSnapshot {
  return {
    timestamp: Date.now(),
    self: {
      username: 'AI_Player', position: { x: 0, y: 64, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      yaw: 0, pitch: 0, health: 20, food: 20, oxygen: 20, dimension: 'overworld', gameMode: 'survival',
      onGround: true, isSleeping: false, effects: []
    },
    inventory: [], entities: [], blocks: [], timeOfDay: 1000, isRaining: false, recentEvents: [],
    ...overrides
  }
}

export function worldContext(value = snapshot()): WorldContext {
  return {
    snapshot: value,
    scene: { locationType: 'surface', threats: [], resources: [], hazards: [], stations: [] },
    memories: []
  }
}
