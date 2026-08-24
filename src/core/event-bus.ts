import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { WorldEvent, WorldEventType } from '../types.js'

export class EventBus {
  private readonly emitter = new EventEmitter({ captureRejections: true })
  private readonly history: WorldEvent[] = []

  emit<T>(type: WorldEventType, data: T, priority: WorldEvent['priority'] = 'normal'): WorldEvent<T> {
    const event: WorldEvent<T> = {
      id: randomUUID(),
      type,
      timestamp: Date.now(),
      priority,
      data
    }
    this.history.push(event)
    if (this.history.length > 500) this.history.splice(0, this.history.length - 500)
    this.emitter.emit(type, event)
    this.emitter.emit('*', event)
    return event
  }

  on<T = unknown>(type: WorldEventType | '*', listener: (event: WorldEvent<T>) => void | Promise<void>): () => void {
    this.emitter.on(type, listener)
    return () => this.emitter.off(type, listener)
  }

  once<T = unknown>(type: WorldEventType, listener: (event: WorldEvent<T>) => void | Promise<void>): void {
    this.emitter.once(type, listener)
  }

  recent(limit = 30): WorldEvent[] {
    return this.history.slice(-limit)
  }

  clear(): void {
    this.history.length = 0
    this.emitter.removeAllListeners()
  }
}
