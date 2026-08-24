import { createServer, type Server } from 'node:http'
import { EventBus } from '../core/event-bus.js'
import { logger } from '../logger.js'

export class Metrics {
  private readonly counters = new Map<string, number>()
  private connected = false
  private startedAt = Date.now()
  private server?: Server

  constructor(events: EventBus) {
    events.on('*', event => this.increment(`event_${event.type}`))
    events.on('skill_completed', () => this.increment('skills_completed'))
    events.on('skill_failed', () => this.increment('skills_failed'))
    events.on('damage', () => this.increment('damage_events'))
    events.on('death', () => this.increment('deaths'))
  }

  setConnected(value: boolean): void { this.connected = value }
  increment(name: string, amount = 1): void { this.counters.set(name, (this.counters.get(name) ?? 0) + amount) }

  snapshot(): Record<string, unknown> {
    return { connected: this.connected, uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000), counters: Object.fromEntries(this.counters) }
  }

  listen(port = 3008, host = '127.0.0.1'): void {
    this.server = createServer((request, response) => {
      if (request.url !== '/health' && request.url !== '/metrics') {
        response.writeHead(404).end('Not found')
        return
      }
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(this.snapshot()))
    })
    this.server.on('error', error => logger.warn({ error }, 'health server unavailable'))
    this.server.listen(port, host)
  }

  close(): Promise<void> {
    return new Promise(resolve => this.server ? this.server.close(() => resolve()) : resolve())
  }
}
