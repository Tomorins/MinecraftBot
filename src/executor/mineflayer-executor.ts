import type { Bot } from 'mineflayer'
import { createRequire } from 'node:module'
import type * as PathfinderModule from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import type {
  ActionExecutor, ActionOptions, BlockObservation, EntityObservation, ExecutionResult, Vec3Like
} from '../types.js'
import { distance, normalizeName, sleep } from '../core/utils.js'

const FACES = [
  new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0),
  new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)
]

const require = createRequire(import.meta.url)
const { goals, Movements } = require('mineflayer-pathfinder') as typeof PathfinderModule

export class MineflayerExecutor implements ActionExecutor {
  private readonly movements: PathfinderModule.Movements

  constructor(
    private readonly bot: Bot,
    private readonly maxActionDistance: number,
    private readonly allowPvp: boolean,
    private readonly allowDropItems: boolean
  ) {
    this.movements = new Movements(bot)
    this.movements.allowSprinting = true
    this.movements.canOpenDoors = true
    this.movements.dontCreateFlow = true
    this.movements.dontMineUnderFallingBlock = true
    this.bot.pathfinder.setMovements(this.movements)
  }

  moveTo(position: Vec3Like, range = 1, options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('moveTo', options, async signal => {
      this.assertDistance(position)
      await this.goto(new goals.GoalNear(position.x, position.y, position.z, range), signal)
      if (distance(this.currentPosition(), position) > range + 1.5) throw new Error('destination_not_reached')
    })
  }

  followPlayer(username: string, followDistance = 2, options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('followPlayer', options, async signal => {
      const entity = this.bot.players[username]?.entity
      if (!entity) throw new Error('player_not_found')
      this.bot.pathfinder.setGoal(new goals.GoalFollow(entity, followDistance), true)
      const cancel = () => this.bot.pathfinder.stop()
      signal.addEventListener('abort', cancel, { once: true })
      try {
        while (!signal.aborted && this.bot.players[username]?.entity) await sleep(250, signal)
      } finally {
        signal.removeEventListener('abort', cancel)
        this.bot.pathfinder.stop()
      }
    })
  }

  async stop(): Promise<void> {
    this.bot.pathfinder.stop()
    this.bot.stopDigging()
    this.bot.clearControlStates()
    this.bot.deactivateItem()
  }

  lookAt(position: Vec3Like, options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('lookAt', options, () => this.bot.lookAt(this.vec(position), true))
  }

  digBlock(position: Vec3Like, options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('digBlock', options, async signal => {
      this.assertDistance(position)
      const block = this.bot.blockAt(this.vec(position))
      if (!block || block.name === 'air') throw new Error('block_not_found')
      if (!this.bot.canDigBlock(block)) {
        await this.goto(new goals.GoalBreakBlock(block.position, this.bot.world, { reach: 4.5 }), signal)
      }
      const bestTool = this.bot.pathfinder.bestHarvestTool(block)
      if (bestTool) await this.bot.equip(bestTool, 'hand')
      const cancel = () => this.bot.stopDigging()
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await this.bot.dig(block, true, 'raycast')
      } finally {
        signal.removeEventListener('abort', cancel)
      }
      if (this.bot.blockAt(block.position)?.name === block.name) throw new Error('block_not_broken')
    })
  }

  digNearest(blockNames: string[], maxDistance: number, options: ActionOptions = {}): Promise<ExecutionResult<{ position: Vec3Like; name: string }>> {
    return this.action('digNearest', options, async signal => {
      const found = this.findBlocks(blockNames, Math.min(maxDistance, this.maxActionDistance), 20)[0]
      if (!found) throw new Error('target_block_not_found')
      const result = await this.digBlock(found.position, { ...options, signal })
      if (!result.ok) throw new Error(result.reason ?? 'dig_failed')
      return { position: found.position, name: found.name }
    })
  }

  placeBlock(itemName: string, position: Vec3Like, options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('placeBlock', options, async signal => {
      this.assertDistance(position)
      const item = this.findInventoryItem(itemName)
      if (!item) throw new Error('item_not_in_inventory')
      const target = this.vec(position)
      if (this.bot.blockAt(target)?.name !== 'air') throw new Error('target_not_empty')
      await this.bot.equip(item, 'hand')
      for (const face of FACES) {
        const reference = this.bot.blockAt(target.minus(face))
        if (!reference || reference.boundingBox === 'empty') continue
        await this.goto(new goals.GoalPlaceBlock(target, this.bot.world, { range: 4.5, LOS: true, faces: FACES, facing: 'up' }), signal)
        await this.bot.placeBlock(reference, face)
        if (this.bot.blockAt(target)?.name === normalizeName(itemName)) return
      }
      throw new Error('no_valid_reference_block')
    })
  }

  attackEntity(entityId: number, options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('attackEntity', options, async signal => {
      const initial = this.bot.entities[entityId]
      if (!initial) throw new Error('entity_not_found')
      if (initial.type === 'player' && !this.allowPvp) throw new Error('pvp_disabled')
      const deadline = Date.now() + Math.min(options.timeoutMs ?? 20_000, 60_000)
      while (Date.now() < deadline && !signal.aborted) {
        const entity = this.bot.entities[entityId]
        if (!entity) return
        const range = this.bot.entity.position.distanceTo(entity.position)
        if (range > 3.2) await this.goto(new goals.GoalFollow(entity, 2.5), signal)
        await this.bot.lookAt(entity.position.offset(0, Math.max(0.5, entity.height * 0.6), 0), true)
        this.bot.attack(entity)
        await sleep(625, signal)
      }
      if (this.bot.entities[entityId]) throw new Error('combat_timeout')
    })
  }

  craftItem(itemName: string, count: number, options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('craftItem', options, async signal => {
      const definition = this.bot.registry.itemsByName[normalizeName(itemName)]
      if (!definition) throw new Error('unknown_item')
      let table = this.bot.findBlock({ matching: this.bot.registry.blocksByName.crafting_table?.id ?? -1, maxDistance: 32 })
      let recipes = this.bot.recipesFor(definition.id, null, 1, false)
      if (recipes.length === 0 && table) recipes = this.bot.recipesFor(definition.id, null, 1, table)
      if (recipes.length === 0) throw new Error(table ? 'missing_ingredients' : 'recipe_or_crafting_table_missing')
      const recipe = recipes[0]
      if (!recipe) throw new Error('recipe_not_found')
      if (table) await this.goto(new goals.GoalNear(table.position.x, table.position.y, table.position.z, 3), signal)
      const resultCount = Math.max(1, recipe.result.count)
      const operations = Math.ceil(count / resultCount)
      await this.bot.craft(recipe, operations, table ?? undefined)
      if (this.inventoryCount(itemName) < count) throw new Error('crafted_count_not_reached')
    })
  }

  smeltItem(itemName: string, count: number, options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('smeltItem', options, async signal => {
      const input = this.findInventoryItem(itemName)
      if (!input || input.count < count) throw new Error('smelting_input_missing')
      const furnaceId = this.bot.registry.blocksByName.furnace?.id
      const furnaceBlock = furnaceId === undefined ? null : this.bot.findBlock({ matching: furnaceId, maxDistance: 32 })
      if (!furnaceBlock) throw new Error('furnace_not_found')
      const fuel = ['coal', 'charcoal', 'coal_block', 'oak_planks', 'birch_planks', 'spruce_planks', 'oak_log']
        .map(name => this.findInventoryItem(name)).find(item => item !== undefined)
      if (!fuel) throw new Error('fuel_missing')
      await this.goto(new goals.GoalNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 3), signal)
      const furnace = await this.bot.openFurnace(furnaceBlock)
      try {
        await furnace.putInput(input.type, input.metadata, count)
        await furnace.putFuel(fuel.type, fuel.metadata, Math.min(fuel.count, Math.max(1, Math.ceil(count / 8))))
        const deadline = Date.now() + Math.max(30_000, count * 12_000)
        let collected = 0
        while (Date.now() < deadline && collected < count) {
          if (signal.aborted) throw signal.reason
          const output = furnace.outputItem()
          if (output) {
            collected += output.count
            await furnace.takeOutput()
          }
          if (collected < count) await sleep(500, signal)
        }
        if (collected < count) throw new Error('smelting_timeout')
      } finally {
        furnace.close()
      }
    }, Math.max(options.timeoutMs ?? 0, count * 12_000 + 30_000))
  }

  equipItem(itemName: string, destination: 'hand' | 'off-hand' | 'head' | 'torso' | 'legs' | 'feet' = 'hand', options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('equipItem', options, async () => {
      const item = this.findInventoryItem(itemName)
      if (!item) throw new Error('item_not_in_inventory')
      await this.bot.equip(item, destination)
    })
  }

  consumeItem(itemName: string, options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('consumeItem', options, async () => {
      const item = this.findInventoryItem(itemName)
      if (!item) throw new Error('food_not_in_inventory')
      await this.bot.equip(item, 'hand')
      await this.bot.consume()
    })
  }

  dropItem(itemName: string, count: number, options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('dropItem', options, async () => {
      if (!this.allowDropItems) throw new Error('dropping_items_disabled')
      const item = this.findInventoryItem(itemName)
      if (!item) throw new Error('item_not_in_inventory')
      await this.bot.toss(item.type, item.metadata, Math.min(count, item.count))
    })
  }

  activateBlock(position: Vec3Like, options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('activateBlock', options, async signal => {
      const block = this.bot.blockAt(this.vec(position))
      if (!block) throw new Error('block_not_found')
      await this.goto(new goals.GoalNear(position.x, position.y, position.z, 3), signal)
      await this.bot.activateBlock(block)
    })
  }

  storeItems(position: Vec3Like, items: Record<string, number>, options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('storeItems', options, async signal => {
      const block = this.bot.blockAt(this.vec(position))
      if (!block) throw new Error('container_not_found')
      await this.goto(new goals.GoalNear(position.x, position.y, position.z, 3), signal)
      const container = await this.bot.openChest(block)
      try {
        for (const [name, count] of Object.entries(items)) {
          const item = this.findInventoryItem(name)
          if (!item) continue
          await container.deposit(item.type, item.metadata, Math.min(count, item.count))
        }
      } finally {
        container.close()
      }
    })
  }

  retrieveItems(position: Vec3Like, items: Record<string, number>, options: ActionOptions = {}): Promise<ExecutionResult> {
    return this.action('retrieveItems', options, async signal => {
      const block = this.bot.blockAt(this.vec(position))
      if (!block) throw new Error('container_not_found')
      await this.goto(new goals.GoalNear(position.x, position.y, position.z, 3), signal)
      const container = await this.bot.openChest(block)
      try {
        for (const [name, count] of Object.entries(items)) {
          const definition = this.bot.registry.itemsByName[normalizeName(name)]
          if (!definition) throw new Error(`unknown_item:${name}`)
          await container.withdraw(definition.id, null, count)
        }
      } finally {
        container.close()
      }
    })
  }

  async chat(message: string): Promise<void> {
    const chunks = message.match(/.{1,240}/gu) ?? []
    for (const chunk of chunks) {
      this.bot.chat(chunk)
      await sleep(150)
    }
  }

  inventoryCount(itemName: string): number {
    const normalized = normalizeName(itemName)
    return this.bot.inventory.items().filter(item => item.name === normalized).reduce((sum, item) => sum + item.count, 0)
  }

  nearbyEntities(): EntityObservation[] {
    const origin = this.currentPosition()
    return Object.values(this.bot.entities).filter(entity => entity.id !== this.bot.entity.id).map(entity => ({
      id: entity.id,
      name: entity.username ?? entity.name ?? 'unknown',
      kind: entity.type ?? 'unknown',
      position: this.plain(entity.position),
      velocity: this.plain(entity.velocity),
      distance: distance(origin, entity.position),
      hostile: entity.kind === 'Hostile mobs',
      player: entity.type === 'player'
    })).sort((a, b) => a.distance - b.distance)
  }

  currentPosition(): Vec3Like {
    return this.plain(this.bot.entity.position)
  }

  findBlocks(blockNames: string[], maxDistance: number, count: number): BlockObservation[] {
    const namesById = new Map<number, string>()
    for (const name of blockNames.map(normalizeName)) {
      const block = this.bot.registry.blocksByName[name]
      if (block) namesById.set(block.id, name)
    }
    if (namesById.size === 0) return []
    return this.bot.findBlocks({ matching: [...namesById.keys()], maxDistance, count }).flatMap(position => {
      const block = this.bot.blockAt(position)
      return block ? [{
        name: block.name,
        position: this.plain(position),
        distance: distance(this.currentPosition(), position),
        category: 'resource' as const
      }] : []
    }).sort((a, b) => a.distance - b.distance)
  }

  private async action<T>(name: string, options: ActionOptions, operation: (signal: AbortSignal) => Promise<T>, overrideTimeout?: number): Promise<ExecutionResult<T>> {
    const started = Date.now()
    const controller = new AbortController()
    const abort = () => controller.abort(options.signal?.reason ?? new Error('cancelled'))
    options.signal?.addEventListener('abort', abort, { once: true })
    const timeoutMs = overrideTimeout ?? options.timeoutMs ?? 30_000
    const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
    try {
      const data = await operation(controller.signal)
      if (controller.signal.aborted) throw controller.signal.reason
      return { ok: true, ...(data === undefined ? {} : { data }), durationMs: Date.now() - started }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { ok: false, reason: options.signal?.aborted ? 'cancelled' : `${name}:${reason}`, durationMs: Date.now() - started }
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
    }
  }

  private async goto(goal: PathfinderModule.goals.Goal, signal: AbortSignal): Promise<void> {
    const cancel = () => this.bot.pathfinder.stop()
    signal.addEventListener('abort', cancel, { once: true })
    try {
      await this.bot.pathfinder.goto(goal)
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  }

  private assertDistance(position: Vec3Like): void {
    if (distance(this.currentPosition(), position) > this.maxActionDistance) throw new Error('target_exceeds_safety_distance')
  }

  private findInventoryItem(name: string) {
    const normalized = normalizeName(name)
    return this.bot.inventory.items().find(item => item.name === normalized)
  }

  private vec(position: Vec3Like): Vec3 {
    return new Vec3(position.x, position.y, position.z)
  }

  private plain(position: Vec3Like): Vec3Like {
    return { x: position.x, y: position.y, z: position.z }
  }
}
