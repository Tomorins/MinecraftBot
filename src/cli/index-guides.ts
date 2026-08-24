import { join } from 'node:path'
import { config } from '../config.js'
import { MemoryStore } from '../memory/sqlite-memory.js'
import { GuideRag } from '../knowledge/rag.js'

const directory = process.argv[2]
if (!directory) {
  console.error('Usage: pnpm knowledge:index <markdown-or-text-directory>')
  process.exitCode = 1
} else {
  const memory = new MemoryStore(join(config.runtime.dataDir, 'memory.db'))
  try {
    const count = new GuideRag(memory).indexDirectory(directory)
    console.log(`Indexed ${count} guide documents.`)
  } finally {
    memory.close()
  }
}
