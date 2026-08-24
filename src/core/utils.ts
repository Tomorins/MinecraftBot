import type { Vec3Like } from '../types.js'

export function distance(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason ?? new Error('Aborted'))
    }, { once: true })
  })
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/^minecraft:/, '')
}

export function safeJson(value: unknown, maxLength = 20_000): string {
  const json = JSON.stringify(value)
  return json.length <= maxLength ? json : `${json.slice(0, maxLength)}…`
}
