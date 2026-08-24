import type {
  ActionExecutor, ActionOptions, BlockObservation, EntityObservation, ExecutionResult, Vec3Like
} from '../types.js'
import { normalizeName } from '../core/utils.js'

export class MockExecutor implements ActionExecutor {
  readonly actions: Array<{ name: string; args: unknown[] }> = []
  readonly inventory = new Map<string, number>()
  blocks: BlockObservation[] = []
  entities: EntityObservation[] = []
  position: Vec3Like = { x: 0, y: 64, z: 0 }
  failure?: { action: string; reason: string }

  private result<T>(name: string, args: unknown[], data?: T): Promise<ExecutionResult<T>> {
    this.actions.push({ name, args })
    if (this.failure?.action === name) return Promise.resolve({ ok: false, reason: this.failure.reason, durationMs: 0 })
    return Promise.resolve({ ok: true, ...(data === undefined ? {} : { data }), durationMs: 0 })
  }

  async moveTo(position: Vec3Like, range: number, options?: ActionOptions): Promise<ExecutionResult> {
    const result = await this.result('moveTo', [position, range, options])
    if (result.ok) this.position = { ...position }
    return result
  }
  followPlayer(username: string, distance: number, options?: ActionOptions): Promise<ExecutionResult> { return this.result('followPlayer', [username, distance, options]) }
  stop(): Promise<void> { this.actions.push({ name: 'stop', args: [] }); return Promise.resolve() }
  lookAt(position: Vec3Like, options?: ActionOptions): Promise<ExecutionResult> { return this.result('lookAt', [position, options]) }
  digBlock(position: Vec3Like, options?: ActionOptions): Promise<ExecutionResult> { return this.result('digBlock', [position, options]) }
  async digNearest(blockNames: string[], maxDistance: number, options?: ActionOptions): Promise<ExecutionResult<{ position: Vec3Like; name: string }>> {
    const block = this.blocks.find(item => blockNames.map(normalizeName).includes(item.name))
    if (!block) return { ok: false, reason: 'target_block_not_found', durationMs: 0 }
    const result = await this.result('digNearest', [blockNames, maxDistance, options], { position: block.position, name: block.name })
    if (result.ok) {
      this.blocks = this.blocks.filter(item => item !== block)
      this.inventory.set(block.name, (this.inventory.get(block.name) ?? 0) + 1)
    }
    return result
  }
  placeBlock(itemName: string, position: Vec3Like, options?: ActionOptions): Promise<ExecutionResult> { return this.result('placeBlock', [itemName, position, options]) }
  attackEntity(entityId: number, options?: ActionOptions): Promise<ExecutionResult> { return this.result('attackEntity', [entityId, options]) }
  async craftItem(itemName: string, count: number, options?: ActionOptions): Promise<ExecutionResult> {
    const result = await this.result('craftItem', [itemName, count, options])
    if (result.ok) this.inventory.set(normalizeName(itemName), this.inventoryCount(itemName) + count)
    return result
  }
  smeltItem(itemName: string, count: number, options?: ActionOptions): Promise<ExecutionResult> { return this.result('smeltItem', [itemName, count, options]) }
  equipItem(itemName: string, destination?: 'hand' | 'off-hand' | 'head' | 'torso' | 'legs' | 'feet', options?: ActionOptions): Promise<ExecutionResult> { return this.result('equipItem', [itemName, destination, options]) }
  consumeItem(itemName: string, options?: ActionOptions): Promise<ExecutionResult> { return this.result('consumeItem', [itemName, options]) }
  async dropItem(itemName: string, count: number, options?: ActionOptions): Promise<ExecutionResult> {
    const result = await this.result('dropItem', [itemName, count, options])
    if (result.ok) this.inventory.set(normalizeName(itemName), Math.max(0, this.inventoryCount(itemName) - count))
    return result
  }
  activateBlock(position: Vec3Like, options?: ActionOptions): Promise<ExecutionResult> { return this.result('activateBlock', [position, options]) }
  storeItems(position: Vec3Like, items: Record<string, number>, options?: ActionOptions): Promise<ExecutionResult> { return this.result('storeItems', [position, items, options]) }
  retrieveItems(position: Vec3Like, items: Record<string, number>, options?: ActionOptions): Promise<ExecutionResult> { return this.result('retrieveItems', [position, items, options]) }
  chat(message: string): Promise<void> { this.actions.push({ name: 'chat', args: [message] }); return Promise.resolve() }
  inventoryCount(itemName: string): number { return this.inventory.get(normalizeName(itemName)) ?? 0 }
  nearbyEntities(): EntityObservation[] { return [...this.entities] }
  currentPosition(): Vec3Like { return { ...this.position } }
  findBlocks(blockNames: string[], _maxDistance: number, count: number): BlockObservation[] {
    const normalized = blockNames.map(normalizeName)
    return this.blocks.filter(block => normalized.includes(block.name)).slice(0, count)
  }
}
