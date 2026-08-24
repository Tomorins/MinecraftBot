import { z } from 'zod'
import type { SkillDefinition } from './types.js'
import type { SkillResult, Vec3Like } from '../types.js'
import { distance, normalizeName, sleep } from '../core/utils.js'

const vectorSchema = z.object({ x: z.number(), y: z.number(), z: z.number() })

function failed(reason: string, recoverable = true, progress?: Record<string, unknown>): SkillResult {
  return { status: 'failed', reason, recoverable, ...(progress ? { progress } : {}) }
}

export function createBuiltinSkills(): SkillDefinition[] {
  const say: SkillDefinition = {
    name: 'say',
    description: 'Send a short message to Minecraft chat.',
    schema: z.object({ message: z.string().min(1).max(1000) }),
    resources: ['chat'],
    priority: 'user',
    async run(ctx, params) {
      await ctx.executor.chat(params.message)
      return { status: 'success', recoverable: false }
    }
  }

  const navigate: SkillDefinition = {
    name: 'navigate_to',
    description: 'Navigate to a known coordinate in the current dimension.',
    schema: z.object({ position: vectorSchema, range: z.number().min(0.5).max(16).default(1.5) }),
    resources: ['movement'],
    priority: 'normal',
    async run(ctx, params) {
      ctx.progress({ phase: 'navigating', detail: `Going to ${JSON.stringify(params.position)}` })
      const result = await ctx.executor.moveTo(params.position, params.range, { signal: ctx.signal })
      return result.ok ? { status: 'success', data: { position: ctx.executor.currentPosition() }, recoverable: false } : failed(result.reason ?? 'navigation_failed')
    }
  }

  const place: SkillDefinition = {
    name: 'place_block',
    description: 'Place one inventory block at an exact coordinate.',
    schema: z.object({ item: z.string().min(1), position: vectorSchema }),
    resources: ['movement', 'camera', 'main_hand', 'inventory'],
    priority: 'normal',
    async run(ctx, params) {
      const result = await ctx.executor.placeBlock(params.item, params.position, { signal: ctx.signal })
      return result.ok ? { status: 'success', recoverable: false } : failed(result.reason ?? 'place_failed')
    }
  }

  const placeNearby: SkillDefinition = {
    name: 'place_nearby',
    description: 'Place one block item in an empty position near the player and return its coordinate.',
    schema: z.object({ item: z.string().min(1), radius: z.number().int().min(1).max(4).default(2) }),
    resources: ['movement', 'camera', 'main_hand', 'inventory'],
    priority: 'normal',
    async run(ctx, params) {
      const origin = ctx.executor.currentPosition()
      for (let radius = 1; radius <= params.radius; radius += 1) {
        const candidates = [
          { x: origin.x + radius, y: origin.y, z: origin.z },
          { x: origin.x - radius, y: origin.y, z: origin.z },
          { x: origin.x, y: origin.y, z: origin.z + radius },
          { x: origin.x, y: origin.y, z: origin.z - radius }
        ].map(position => ({ x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) }))
        for (const position of candidates) {
          const result = await ctx.executor.placeBlock(params.item, position, { signal: ctx.signal, timeoutMs: 30_000 })
          if (result.ok) return { status: 'success', data: { position }, recoverable: false }
        }
      }
      return failed('no_nearby_placement_position')
    }
  }

  const equip: SkillDefinition = {
    name: 'equip_item',
    description: 'Equip an inventory item to a body or hand slot.',
    schema: z.object({ item: z.string().min(1), destination: z.enum(['hand', 'off-hand', 'head', 'torso', 'legs', 'feet']).default('hand') }),
    resources: ['inventory', 'main_hand'],
    priority: 'normal',
    async run(ctx, params) {
      const result = await ctx.executor.equipItem(params.item, params.destination, { signal: ctx.signal })
      return result.ok ? { status: 'success', recoverable: false } : failed(result.reason ?? 'equip_failed')
    }
  }

  const drop: SkillDefinition = {
    name: 'drop_item',
    description: 'Drop a bounded number of an inventory item.',
    schema: z.object({ item: z.string().min(1), count: z.number().int().min(1).max(64) }),
    resources: ['inventory', 'main_hand'],
    priority: 'user',
    async run(ctx, params) {
      const result = await ctx.executor.dropItem(params.item, params.count, { signal: ctx.signal })
      return result.ok ? { status: 'success', recoverable: false } : failed(result.reason ?? 'drop_failed')
    }
  }

  const activate: SkillDefinition = {
    name: 'activate_block',
    description: 'Approach and activate a block such as a lever, button, door or bed.',
    schema: z.object({ position: vectorSchema }),
    resources: ['movement', 'camera', 'main_hand'],
    priority: 'normal',
    async run(ctx, params) {
      const result = await ctx.executor.activateBlock(params.position, { signal: ctx.signal })
      return result.ok ? { status: 'success', recoverable: false } : failed(result.reason ?? 'activation_failed')
    }
  }

  const returnToMemory: SkillDefinition = {
    name: 'return_to_memory',
    description: 'Navigate to a remembered location by its memory key, for example a base or portal.',
    schema: z.object({ key: z.string().min(1), range: z.number().min(1).max(16).default(2) }),
    resources: ['movement'],
    priority: 'user',
    async run(ctx, params) {
      const memory = ctx.world().memories.find(item => item.kind === 'location' && (item.key === params.key || item.key.includes(params.key)) && item.position)
      if (!memory?.position) return failed('remembered_location_not_found')
      const result = await ctx.executor.moveTo(memory.position, params.range, { signal: ctx.signal })
      return result.ok ? { status: 'success', data: { key: memory.key, position: memory.position }, recoverable: false } : failed(result.reason ?? 'return_failed')
    }
  }

  const rememberLocation: SkillDefinition = {
    name: 'remember_location',
    description: 'Save the current or specified coordinate as a named long-term location.',
    schema: z.object({ key: z.string().min(1).max(100), position: vectorSchema.optional() }),
    resources: [],
    priority: 'user',
    async run(ctx, params) {
      ctx.rememberLocation(params.key, params.position)
      return { status: 'success', data: { key: params.key, position: params.position ?? ctx.executor.currentPosition() }, recoverable: false }
    }
  }

  const follow: SkillDefinition = {
    name: 'follow_player',
    description: 'Continuously follow a named player until cancelled or duration expires.',
    schema: z.object({ username: z.string().min(1), distance: z.number().min(1).max(12).default(2.5), durationSeconds: z.number().min(1).max(86400).default(3600) }),
    resources: ['movement'],
    priority: 'user',
    defaultTimeoutMs: 86_410_000,
    async run(ctx, params) {
      const local = new AbortController()
      const timer = setTimeout(() => local.abort(new Error('follow_duration_completed')), params.durationSeconds * 1000)
      const abort = () => local.abort(ctx.signal.reason)
      ctx.signal.addEventListener('abort', abort, { once: true })
      try {
        const result = await ctx.executor.followPlayer(params.username, params.distance, { signal: local.signal, timeoutMs: params.durationSeconds * 1000 + 1000 })
        if (local.signal.aborted && !ctx.signal.aborted) return { status: 'success', recoverable: false }
        return result.ok ? { status: 'success', recoverable: false } : failed(result.reason ?? 'follow_failed')
      } finally {
        clearTimeout(timer)
        ctx.signal.removeEventListener('abort', abort)
      }
    }
  }

  const collect: SkillDefinition = {
    name: 'collect_blocks',
    description: 'Find, mine and collect a target block until the requested inventory count is reached.',
    schema: z.object({
      blocks: z.array(z.string()).min(1),
      count: z.number().int().min(1).max(512),
      expectedItem: z.string().optional(),
      searchRadius: z.number().min(4).max(128).default(32)
    }),
    resources: ['movement', 'camera', 'main_hand', 'inventory'],
    priority: 'normal',
    defaultTimeoutMs: 900_000,
    async run(ctx, params) {
      const item = normalizeName(params.expectedItem ?? params.blocks[0] ?? '')
      const initial = ctx.executor.inventoryCount(item)
      let misses = 0
      while (ctx.executor.inventoryCount(item) - initial < params.count) {
        if (ctx.signal.aborted) throw ctx.signal.reason
        const collected = ctx.executor.inventoryCount(item) - initial
        ctx.progress({ phase: 'collecting', percent: Math.min(99, collected / params.count * 100), data: { collected, target: params.count } })
        const result = await ctx.executor.digNearest(params.blocks, params.searchRadius, { signal: ctx.signal, timeoutMs: 60_000 })
        if (!result.ok) {
          misses += 1
          if (misses >= 3) return failed(result.reason ?? 'resource_not_found', true, { collected, target: params.count })
          continue
        }
        misses = 0
        await sleep(250, ctx.signal)
      }
      return { status: 'success', data: { collected: ctx.executor.inventoryCount(item) - initial, item }, recoverable: false }
    }
  }

  const craft: SkillDefinition = {
    name: 'craft_item',
    description: 'Craft an exact item using the current inventory and a nearby crafting table when required.',
    schema: z.object({ item: z.string().min(1), count: z.number().int().min(1).max(256) }),
    resources: ['movement', 'camera', 'inventory', 'container_ui'],
    priority: 'normal',
    async run(ctx, params) {
      ctx.progress({ phase: 'crafting', detail: `${params.count} ${params.item}` })
      const before = ctx.executor.inventoryCount(params.item)
      const result = await ctx.executor.craftItem(params.item, params.count, { signal: ctx.signal })
      if (!result.ok) return failed(result.reason ?? 'craft_failed')
      return ctx.executor.inventoryCount(params.item) >= before + params.count
        ? { status: 'success', data: { item: params.item, count: params.count }, recoverable: false }
        : failed('craft_verification_failed')
    }
  }

  const smelt: SkillDefinition = {
    name: 'smelt_item',
    description: 'Smelt an inventory item in a nearby furnace using available fuel.',
    schema: z.object({ item: z.string().min(1), count: z.number().int().min(1).max(64) }),
    resources: ['movement', 'camera', 'inventory', 'container_ui'],
    priority: 'normal',
    defaultTimeoutMs: 900_000,
    async run(ctx, params) {
      const result = await ctx.executor.smeltItem(params.item, params.count, { signal: ctx.signal })
      return result.ok ? { status: 'success', recoverable: false } : failed(result.reason ?? 'smelt_failed')
    }
  }

  const fight: SkillDefinition = {
    name: 'fight_entity',
    description: 'Attack one hostile entity selected by entity id or nearest matching name.',
    schema: z.object({ entityId: z.number().int().optional(), name: z.string().optional() }).refine(value => value.entityId !== undefined || value.name, 'entityId or name is required'),
    resources: ['movement', 'camera', 'main_hand'],
    priority: 'combat',
    async run(ctx, params) {
      const entity = params.entityId !== undefined
        ? ctx.executor.nearbyEntities().find(value => value.id === params.entityId)
        : ctx.executor.nearbyEntities().find(value => normalizeName(value.name) === normalizeName(params.name ?? '') && value.hostile)
      if (!entity) return failed('target_entity_not_found')
      const result = await ctx.executor.attackEntity(entity.id, { signal: ctx.signal, timeoutMs: 45_000 })
      return result.ok ? { status: 'success', data: { entityId: entity.id }, recoverable: false } : failed(result.reason ?? 'combat_failed')
    }
  }

  const escape: SkillDefinition = {
    name: 'escape_threat',
    description: 'Emergency retreat away from nearby threats.',
    schema: z.object({ distance: z.number().min(6).max(64).default(18) }),
    resources: ['movement', 'camera'],
    priority: 'emergency',
    async run(ctx, params) {
      const origin = ctx.executor.currentPosition()
      const threats = ctx.executor.nearbyEntities().filter(entity => entity.hostile && entity.distance < 24)
      let dx = 1
      let dz = 1
      for (const threat of threats) {
        const magnitude = Math.max(1, distance(origin, threat.position))
        dx += (origin.x - threat.position.x) / magnitude
        dz += (origin.z - threat.position.z) / magnitude
      }
      const length = Math.max(0.001, Math.hypot(dx, dz))
      const target = { x: origin.x + dx / length * params.distance, y: origin.y, z: origin.z + dz / length * params.distance }
      const result = await ctx.executor.moveTo(target, 3, { signal: ctx.signal, timeoutMs: 30_000 })
      return result.ok ? { status: 'success', data: { target }, recoverable: false } : failed(result.reason ?? 'escape_failed')
    }
  }

  const eat: SkillDefinition = {
    name: 'eat_food',
    description: 'Eat a specified food item from inventory.',
    schema: z.object({ item: z.string().min(1) }),
    resources: ['main_hand', 'inventory'],
    priority: 'emergency',
    async run(ctx, params) {
      const result = await ctx.executor.consumeItem(params.item, { signal: ctx.signal })
      return result.ok ? { status: 'success', recoverable: false } : failed(result.reason ?? 'eat_failed')
    }
  }

  const deliver: SkillDefinition = {
    name: 'deliver_item',
    description: 'Find a player, approach them, look at them and drop an item nearby.',
    schema: z.object({ username: z.string().min(1), item: z.string().min(1), count: z.number().int().min(1).max(64) }),
    resources: ['movement', 'camera', 'inventory', 'main_hand'],
    priority: 'user',
    async run(ctx, params) {
      const player = ctx.executor.nearbyEntities().find(entity => entity.player && entity.name === params.username)
      if (!player) return failed('recipient_not_visible')
      const moved = await ctx.executor.moveTo(player.position, 2.5, { signal: ctx.signal })
      if (!moved.ok) return failed(moved.reason ?? 'recipient_unreachable')
      await ctx.executor.lookAt(player.position, { signal: ctx.signal })
      const dropped = await ctx.executor.dropItem(params.item, params.count, { signal: ctx.signal })
      return dropped.ok ? { status: 'success', data: { recipient: params.username }, recoverable: false } : failed(dropped.reason ?? 'delivery_failed')
    }
  }

  const store: SkillDefinition = {
    name: 'store_items',
    description: 'Deposit selected inventory items into a known chest.',
    schema: z.object({ position: vectorSchema, items: z.record(z.string(), z.number().int().min(1)) }),
    resources: ['movement', 'camera', 'inventory', 'container_ui'],
    priority: 'normal',
    async run(ctx, params) {
      const result = await ctx.executor.storeItems(params.position, params.items, { signal: ctx.signal })
      return result.ok ? { status: 'success', recoverable: false } : failed(result.reason ?? 'store_failed')
    }
  }

  const retrieve: SkillDefinition = {
    name: 'retrieve_items',
    description: 'Withdraw selected items from a known chest.',
    schema: z.object({ position: vectorSchema, items: z.record(z.string(), z.number().int().min(1)) }),
    resources: ['movement', 'camera', 'inventory', 'container_ui'],
    priority: 'normal',
    async run(ctx, params) {
      const result = await ctx.executor.retrieveItems(params.position, params.items, { signal: ctx.signal })
      return result.ok ? { status: 'success', recoverable: false } : failed(result.reason ?? 'retrieve_failed')
    }
  }

  const build: SkillDefinition = {
    name: 'build_blueprint',
    description: 'Place a bounded list of blocks at exact coordinates and verify each placement.',
    schema: z.object({ blocks: z.array(z.object({ item: z.string(), position: vectorSchema })).min(1).max(4096) }),
    resources: ['movement', 'camera', 'inventory', 'main_hand'],
    priority: 'normal',
    defaultTimeoutMs: 3_600_000,
    async run(ctx, params) {
      let placed = 0
      for (const block of params.blocks) {
        if (ctx.signal.aborted) throw ctx.signal.reason
        ctx.progress({ phase: 'building', percent: placed / params.blocks.length * 100, data: { placed, total: params.blocks.length } })
        const result = await ctx.executor.placeBlock(block.item, block.position, { signal: ctx.signal, timeoutMs: 45_000 })
        if (!result.ok) return failed(result.reason ?? 'placement_failed', true, { placed, total: params.blocks.length, failedBlock: block })
        placed += 1
      }
      return { status: 'success', data: { placed }, recoverable: false }
    }
  }

  const explore: SkillDefinition = {
    name: 'explore_area',
    description: 'Explore a bounded square around the current position using a spiral route.',
    schema: z.object({ radius: z.number().min(8).max(256).default(48), waypoints: z.number().int().min(4).max(64).default(12) }),
    resources: ['movement', 'camera'],
    priority: 'background',
    defaultTimeoutMs: 1_800_000,
    async run(ctx, params) {
      const origin = ctx.executor.currentPosition()
      for (let index = 1; index <= params.waypoints; index += 1) {
        const angle = index * 2.399963
        const radius = params.radius * Math.sqrt(index / params.waypoints)
        const target: Vec3Like = { x: origin.x + Math.cos(angle) * radius, y: origin.y, z: origin.z + Math.sin(angle) * radius }
        const result = await ctx.executor.moveTo(target, 4, { signal: ctx.signal, timeoutMs: 90_000 })
        if (!result.ok) ctx.progress({ phase: 'waypoint_skipped', ...(result.reason ? { detail: result.reason } : {}) })
        else ctx.progress({ phase: 'exploring', percent: index / params.waypoints * 100 })
      }
      return { status: 'success', recoverable: false }
    }
  }

  return [say, navigate, place, placeNearby, equip, drop, activate, rememberLocation, returnToMemory, follow, collect, craft, smelt, fight, escape, eat, deliver, store, retrieve, build, explore]
}
