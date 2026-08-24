import type { PerceptionSnapshot, SceneSummary, TaskRecord, WorldContext } from '../types.js'
import { MemoryStore } from '../memory/sqlite-memory.js'

export class WorldModel {
  private snapshotValue: PerceptionSnapshot | undefined
  private currentTaskValue: TaskRecord | undefined

  constructor(private readonly memory: MemoryStore) {}

  update(snapshot: PerceptionSnapshot): WorldContext {
    this.snapshotValue = snapshot
    const scene = this.summarize(snapshot)
    this.rememberImportantPlaces(snapshot)
    const nearby = this.memory.nearbyMemories(
      snapshot.self.dimension,
      snapshot.self.position.x,
      snapshot.self.position.z,
      256,
      20
    )
    const important = this.memory.queryMemories('location', 20)
    const memories = [...new Map([...nearby, ...important].map(memory => [memory.id, memory])).values()].slice(0, 30)
    return {
      snapshot,
      scene,
      ...(this.currentTaskValue ? { currentTask: this.currentTaskValue } : {}),
      memories
    }
  }

  context(): WorldContext {
    if (!this.snapshotValue) throw new Error('World model has no perception snapshot yet')
    return this.update(this.snapshotValue)
  }

  setCurrentTask(task?: TaskRecord): void {
    this.currentTaskValue = task
    if (task) this.memory.saveTask(task)
  }

  currentTask(): TaskRecord | undefined {
    return this.currentTaskValue
  }

  restoreActiveTask(): TaskRecord | undefined {
    const task = this.memory.latestActiveTask()
    this.currentTaskValue = task
    return task
  }

  rememberLocation(key: string, position?: { x: number; y: number; z: number }): void {
    if (!this.snapshotValue) throw new Error('Cannot remember a location before perception is initialized')
    const target = position ?? this.snapshotValue.self.position
    this.memory.upsertMemory({
      kind: 'location',
      key,
      value: { label: key, recordedBy: 'skill' },
      position: target,
      dimension: this.snapshotValue.self.dimension,
      confidence: 1
    })
  }

  private summarize(snapshot: PerceptionSnapshot): SceneSummary {
    const threats = snapshot.entities.filter(entity => entity.hostile).sort((a, b) => a.distance - b.distance).slice(0, 10)
    const resourceMap = new Map<string, { count: number; nearest: number }>()
    for (const block of snapshot.blocks.filter(item => item.category === 'resource')) {
      const value = resourceMap.get(block.name) ?? { count: 0, nearest: Number.POSITIVE_INFINITY }
      value.count += 1
      value.nearest = Math.min(value.nearest, block.distance)
      resourceMap.set(block.name, value)
    }
    const resources = [...resourceMap.entries()]
      .map(([name, value]) => ({ name, visibleCount: value.count, nearestDistance: value.nearest }))
      .sort((a, b) => a.nearestDistance - b.nearestDistance)

    const y = snapshot.self.position.y
    const locationType = snapshot.self.dimension.includes('nether')
      ? 'nether'
      : snapshot.self.dimension.includes('end')
        ? 'the_end'
        : y < 55
          ? 'underground'
          : 'surface'

    return {
      locationType,
      threats,
      resources,
      hazards: snapshot.blocks.filter(block => block.category === 'hazard').slice(0, 20),
      stations: snapshot.blocks.filter(block => block.category === 'station').slice(0, 20)
    }
  }

  private rememberImportantPlaces(snapshot: PerceptionSnapshot): void {
    for (const block of snapshot.blocks) {
      if (block.category !== 'station' && block.name !== 'nether_portal') continue
      const coordinateKey = `${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`
      this.memory.upsertMemory({
        kind: 'location',
        key: `${block.name}:${coordinateKey}`,
        value: { type: block.name },
        position: block.position,
        dimension: snapshot.self.dimension,
        confidence: 1
      })
    }
  }
}
