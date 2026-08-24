import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { MemoryStore } from '../memory/sqlite-memory.js'

export interface RagResult {
  id: string
  title: string
  content: string
  tags: string[]
  score: number
}

export class GuideRag {
  constructor(private readonly memory: MemoryStore, private readonly dimensions = 512) {}

  add(title: string, content: string, tags: string[] = [], id: string = randomUUID()): string {
    this.memory.putRagDocument({ id, title, content, tags, embedding: this.embed(`${title}\n${tags.join(' ')}\n${content}`) })
    return id
  }

  indexDirectory(directory: string): number {
    let count = 0
    const walk = (path: string) => {
      for (const name of readdirSync(path)) {
        const absolute = join(path, name)
        if (statSync(absolute).isDirectory()) walk(absolute)
        else if (['.md', '.txt'].includes(extname(name).toLowerCase())) {
          this.add(name, readFileSync(absolute, 'utf8'), [extname(name).slice(1)], createHash('sha256').update(absolute).digest('hex'))
          count += 1
        }
      }
    }
    walk(directory)
    return count
  }

  search(query: string, limit = 5, minScore = 0.05): RagResult[] {
    const queryVector = this.embed(query)
    return this.memory.getRagDocuments()
      .map(document => ({ ...document, score: this.cosine(queryVector, document.embedding) }))
      .filter(document => document.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ embedding: _, ...document }) => document)
  }

  seedDefaults(): void {
    const defaults = [
      ['基础生存', '出生后优先收集木头，制作工作台和木镐，再获取圆石升级石制工具。夜晚前准备食物、火把和安全空间。', ['生存', '新手']],
      ['采矿安全', '洞穴探索时持续照明，保留返回路径标记。听到敌对生物或发现岩浆时先处理危险，不要垂直向下挖掘。', ['采矿', '安全']],
      ['战斗撤退', '血量较低、食物不足、武器损坏或敌人数量过多时优先撤退。利用高差、门和狭窄通道限制敌人。', ['战斗', '安全']],
      ['下界准备', '进入下界前准备铁质以上装备、食物、方块、打火石和远程武器，并记录传送门坐标。', ['下界', '探索']],
      ['物品管理', '贵重物品及时存入已记录的箱子；远行前留出背包空间，并携带备用工具、食物和照明。', ['背包', '基地']]
    ] as const
    const existing = new Set(this.memory.getRagDocuments().map(document => document.id))
    for (const [title, content, tags] of defaults) {
      const id = `builtin:${createHash('sha1').update(title).digest('hex')}`
      if (!existing.has(id)) this.add(title, content, [...tags], id)
    }
  }

  private embed(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0)
    const normalized = text.toLowerCase().normalize('NFKC')
    const latin = normalized.match(/[a-z0-9_]+/g) ?? []
    const chinese = [...normalized.replace(/[^\p{Script=Han}]/gu, '')]
    const tokens = [...latin, ...chinese, ...chinese.slice(0, -1).map((char, index) => char + chinese[index + 1])]
    for (const token of tokens) {
      const hash = createHash('sha1').update(token).digest()
      const index = hash.readUInt32BE(0) % this.dimensions
      vector[index] = (vector[index] ?? 0) + (hash[4]! % 2 === 0 ? 1 : -1)
    }
    const norm = Math.hypot(...vector) || 1
    return vector.map(value => value / norm)
  }

  private cosine(a: number[], b: number[]): number {
    let sum = 0
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) sum += (a[index] ?? 0) * (b[index] ?? 0)
    return sum
  }
}
