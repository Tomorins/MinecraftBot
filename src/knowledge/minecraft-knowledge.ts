import minecraftData from 'minecraft-data'
import { normalizeName } from '../core/utils.js'

type McData = ReturnType<typeof minecraftData>
type Recipe = McData['recipes'][number][number]
type RecipeItem = number | null | [] | [number | null] | [number | null, number] | { id: number | null; metadata?: number; count?: number }

export interface IngredientRequirement {
  item: string
  count: number
}

export interface ExactRecipe {
  output: string
  outputCount: number
  ingredients: IngredientRequirement[]
  requiresCraftingTable: boolean
}

export interface CraftingPlanNode {
  item: string
  count: number
  available: number
  craftOperations: number
  recipe?: ExactRecipe
  children: CraftingPlanNode[]
}

const SMELTING_OUTPUTS: Record<string, string[]> = {
  iron_ingot: ['raw_iron', 'iron_ore', 'deepslate_iron_ore'],
  gold_ingot: ['raw_gold', 'gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'],
  copper_ingot: ['raw_copper', 'copper_ore', 'deepslate_copper_ore'],
  glass: ['sand', 'red_sand'], stone: ['cobblestone'], smooth_stone: ['stone'],
  brick: ['clay_ball'], nether_brick: ['netherrack'], netherite_scrap: ['ancient_debris'],
  green_dye: ['cactus'], sponge: ['wet_sponge'], popped_chorus_fruit: ['chorus_fruit'],
  dried_kelp: ['kelp'], baked_potato: ['potato'], cooked_beef: ['beef'],
  cooked_porkchop: ['porkchop'], cooked_chicken: ['chicken'], cooked_mutton: ['mutton'],
  cooked_rabbit: ['rabbit'], cooked_cod: ['cod'], cooked_salmon: ['salmon'],
  charcoal: ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log']
}

export class MinecraftKnowledge {
  readonly data: McData

  constructor(version: string) {
    const data = minecraftData(version)
    if (!data) throw new Error(`Unsupported Minecraft version: ${version}`)
    this.data = data
  }

  getItem(name: string): McData['itemsArray'][number] | undefined {
    return this.data.itemsByName[normalizeName(name)]
  }

  getBlock(name: string): McData['blocksArray'][number] | undefined {
    return this.data.blocksByName[normalizeName(name)]
  }

  getEntity(name: string): McData['entitiesArray'][number] | undefined {
    return this.data.entitiesByName[normalizeName(name)]
  }

  getFood(name: string): McData['foodsArray'][number] | undefined {
    const item = this.getItem(name)
    return item ? this.data.foods[item.id] : undefined
  }

  getRecipesFor(name: string): ExactRecipe[] {
    const item = this.getItem(name)
    if (!item) return []
    const recipes = this.data.recipes[item.id] ?? []
    return recipes.map(recipe => this.normalizeRecipe(name, recipe)).filter((recipe): recipe is ExactRecipe => recipe !== undefined)
  }

  getSmeltingInputsFor(output: string): string[] {
    return [...(SMELTING_OUTPUTS[normalizeName(output)] ?? [])]
  }

  calculateCraftingPlan(target: string, count: number, inventory: Record<string, number>): CraftingPlanNode {
    return this.planNode(normalizeName(target), count, new Map(Object.entries(inventory).map(([name, amount]) => [normalizeName(name), amount])), new Set())
  }

  describe(name: string): Record<string, unknown> | undefined {
    const normalized = normalizeName(name)
    const item = this.getItem(normalized)
    const block = this.getBlock(normalized)
    const entity = this.getEntity(normalized)
    if (block) return {
      kind: 'block', name: block.name, displayName: block.displayName, hardness: block.hardness,
      diggable: block.diggable, boundingBox: block.boundingBox, material: block.material,
      harvestTools: block.harvestTools ?? null, drops: block.drops
    }
    if (entity) return {
      kind: 'entity', name: entity.name, displayName: entity.displayName, category: entity.category,
      type: entity.type, width: entity.width, height: entity.height
    }
    if (item) return {
      kind: 'item', name: item.name, displayName: item.displayName, stackSize: item.stackSize,
      maxDurability: item.maxDurability ?? null, food: this.getFood(normalized) ?? null
    }
    return undefined
  }

  private planNode(itemName: string, requested: number, inventory: Map<string, number>, visiting: Set<string>): CraftingPlanNode {
    const available = Math.min(requested, inventory.get(itemName) ?? 0)
    inventory.set(itemName, Math.max(0, (inventory.get(itemName) ?? 0) - available))
    const missing = requested - available
    if (missing === 0) return { item: itemName, count: requested, available, craftOperations: 0, children: [] }
    if (visiting.has(itemName)) return { item: itemName, count: requested, available, craftOperations: 0, children: [] }
    const recipe = this.selectRecipe(itemName, inventory)
    if (!recipe) return { item: itemName, count: requested, available, craftOperations: 0, children: [] }

    const operations = Math.ceil(missing / recipe.outputCount)
    const nextVisiting = new Set(visiting).add(itemName)
    const children = recipe.ingredients.map(ingredient =>
      this.planNode(ingredient.item, ingredient.count * operations, inventory, nextVisiting)
    )
    return { item: itemName, count: requested, available, craftOperations: operations, recipe, children }
  }

  private selectRecipe(itemName: string, inventory: Map<string, number>): ExactRecipe | undefined {
    return this.getRecipesFor(itemName)
      .map(recipe => ({ recipe, cost: recipe.ingredients.reduce((sum, ingredient) => sum + Math.max(0, ingredient.count - (inventory.get(ingredient.item) ?? 0)), 0) }))
      .sort((a, b) => a.cost - b.cost)[0]?.recipe
  }

  private normalizeRecipe(outputName: string, recipe: Recipe): ExactRecipe | undefined {
    const entries = ('ingredients' in recipe
      ? [...recipe.ingredients]
      : recipe.inShape.flat()) as RecipeItem[]
    const counts = new Map<string, number>()
    for (const entry of entries) {
      const id = this.recipeItemId(entry)
      if (id === null) continue
      const item = this.data.items[id]
      if (!item) continue
      counts.set(item.name, (counts.get(item.name) ?? 0) + this.recipeItemCount(entry))
    }
    const resultCount = this.recipeItemCount(recipe.result as RecipeItem)
    if (counts.size === 0) return undefined
    const requiresCraftingTable = 'inShape' in recipe
      ? recipe.inShape.length > 2 || recipe.inShape.some(row => row.length > 2)
      : recipe.ingredients.length > 4
    return {
      output: normalizeName(outputName),
      outputCount: resultCount,
      ingredients: [...counts.entries()].map(([item, count]) => ({ item, count })),
      requiresCraftingTable
    }
  }

  private recipeItemId(value: RecipeItem): number | null {
    if (typeof value === 'number' || value === null) return value
    if (Array.isArray(value)) return typeof value[0] === 'number' ? value[0] : null
    return typeof value.id === 'number' ? value.id : null
  }

  private recipeItemCount(value: RecipeItem): number {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value.count ?? 1
    return 1
  }
}
