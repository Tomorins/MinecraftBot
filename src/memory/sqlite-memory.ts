import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { MemoryRecord, Plan, TaskRecord, WorldEvent } from '../types.js'

interface MemoryRow {
  id: string
  kind: MemoryRecord['kind']
  key: string
  value_json: string
  x: number | null
  y: number | null
  z: number | null
  dimension: string | null
  created_at: number
  updated_at: number
  confidence: number
}

interface TaskRow {
  id: string
  goal: string
  status: TaskRecord['status']
  current_step: string | null
  plan_json: string | null
  result_json: string | null
  created_at: number
  updated_at: number
}

export class MemoryStore {
  private readonly db: DatabaseSync

  constructor(path: string) {
    const absolute = path === ':memory:' ? path : resolve(path)
    if (absolute !== ':memory:') mkdirSync(dirname(absolute), { recursive: true })
    this.db = new DatabaseSync(absolute)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        x REAL,
        y REAL,
        z REAL,
        dimension TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        confidence REAL NOT NULL DEFAULT 1,
        UNIQUE(kind, key, dimension)
      );
      CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
      CREATE INDEX IF NOT EXISTS idx_memories_position ON memories(dimension, x, z);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        current_step TEXT,
        plan_json TEXT,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        priority TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_time ON events(timestamp DESC);

      CREATE TABLE IF NOT EXISTS rag_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
  }

  upsertMemory(input: Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): MemoryRecord {
    const now = Date.now()
    const id = input.id ?? randomUUID()
    const existing = this.db.prepare(
      'SELECT id, created_at FROM memories WHERE kind = ? AND key = ? AND dimension = ?'
    ).get(input.kind, input.key, input.dimension ?? '') as { id: string; created_at: number } | undefined
    const record: MemoryRecord = {
      id: existing?.id ?? id,
      kind: input.kind,
      key: input.key,
      value: input.value,
      ...(input.position ? { position: input.position } : {}),
      ...(input.dimension ? { dimension: input.dimension } : {}),
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
      confidence: input.confidence
    }
    this.db.prepare(`
      INSERT INTO memories (id, kind, key, value_json, x, y, z, dimension, created_at, updated_at, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kind, key, dimension) DO UPDATE SET
        value_json=excluded.value_json, x=excluded.x, y=excluded.y, z=excluded.z,
        updated_at=excluded.updated_at, confidence=excluded.confidence
    `).run(
      record.id, record.kind, record.key, JSON.stringify(record.value),
      record.position?.x ?? null, record.position?.y ?? null, record.position?.z ?? null,
      record.dimension ?? '', record.createdAt, record.updatedAt, record.confidence
    )
    return record
  }

  queryMemories(kind?: MemoryRecord['kind'], limit = 50): MemoryRecord[] {
    const rows = (kind
      ? this.db.prepare('SELECT * FROM memories WHERE kind = ? ORDER BY updated_at DESC LIMIT ?').all(kind, limit)
      : this.db.prepare('SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?').all(limit)) as unknown as MemoryRow[]
    return rows.map(row => this.memoryFromRow(row))
  }

  nearbyMemories(dimension: string, x: number, z: number, radius: number, limit = 30): MemoryRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE dimension = ? AND x IS NOT NULL AND z IS NOT NULL
        AND ((x - ?) * (x - ?) + (z - ?) * (z - ?)) <= ?
      ORDER BY ((x - ?) * (x - ?) + (z - ?) * (z - ?)) ASC LIMIT ?
    `).all(dimension, x, x, z, z, radius * radius, x, x, z, z, limit) as unknown as MemoryRow[]
    return rows.map(row => this.memoryFromRow(row))
  }

  saveTask(task: TaskRecord): void {
    this.db.prepare(`
      INSERT INTO tasks (id, goal, status, current_step, plan_json, result_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, current_step=excluded.current_step,
        plan_json=excluded.plan_json, result_json=excluded.result_json, updated_at=excluded.updated_at
    `).run(
      task.id, task.goal, task.status, task.currentStep ?? null,
      task.plan ? JSON.stringify(task.plan) : null,
      task.result === undefined ? null : JSON.stringify(task.result),
      task.createdAt, task.updatedAt
    )
  }

  latestActiveTask(): TaskRecord | undefined {
    const row = this.db.prepare(
      "SELECT * FROM tasks WHERE status IN ('pending','running') ORDER BY updated_at DESC LIMIT 1"
    ).get() as unknown as TaskRow | undefined
    return row ? this.taskFromRow(row) : undefined
  }

  appendEvent(event: WorldEvent): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO events (id, type, priority, timestamp, data_json) VALUES (?, ?, ?, ?, ?)'
    ).run(event.id, event.type, event.priority, event.timestamp, JSON.stringify(event.data))
    this.db.prepare('DELETE FROM events WHERE timestamp < ?').run(Date.now() - 7 * 24 * 60 * 60 * 1000)
  }

  putRagDocument(document: { id: string; title: string; content: string; tags: string[]; embedding: number[] }): void {
    this.db.prepare(`
      INSERT INTO rag_documents (id, title, content, tags_json, embedding_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content,
        tags_json=excluded.tags_json, embedding_json=excluded.embedding_json, updated_at=excluded.updated_at
    `).run(document.id, document.title, document.content, JSON.stringify(document.tags), JSON.stringify(document.embedding), Date.now())
  }

  getRagDocuments(): Array<{ id: string; title: string; content: string; tags: string[]; embedding: number[] }> {
    const rows = this.db.prepare('SELECT id, title, content, tags_json, embedding_json FROM rag_documents').all() as unknown as Array<{
      id: string; title: string; content: string; tags_json: string; embedding_json: string
    }>
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      content: row.content,
      tags: JSON.parse(row.tags_json) as string[],
      embedding: JSON.parse(row.embedding_json) as number[]
    }))
  }

  close(): void {
    this.db.close()
  }

  private memoryFromRow(row: MemoryRow): MemoryRecord {
    return {
      id: row.id,
      kind: row.kind,
      key: row.key,
      value: JSON.parse(row.value_json) as unknown,
      ...(row.x !== null && row.y !== null && row.z !== null ? { position: { x: row.x, y: row.y, z: row.z } } : {}),
      ...(row.dimension ? { dimension: row.dimension } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      confidence: row.confidence
    }
  }

  private taskFromRow(row: TaskRow): TaskRecord {
    return {
      id: row.id,
      goal: row.goal,
      status: row.status,
      ...(row.current_step ? { currentStep: row.current_step } : {}),
      ...(row.plan_json ? { plan: JSON.parse(row.plan_json) as Plan } : {}),
      ...(row.result_json ? { result: JSON.parse(row.result_json) as unknown } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
