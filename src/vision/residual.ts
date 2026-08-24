export interface CameraFrame {
  width: number
  height: number
  /** RGBA bytes, width * height * 4. */
  color: Uint8Array
  /** Normalized device depth in [0,1], width * height. */
  depth: Float32Array
  /** Row-major 4x4 view-projection matrix. */
  viewProjection: Float64Array
  /** Row-major inverse of viewProjection. */
  inverseViewProjection: Float64Array
  timestamp: number
}

export interface PredictedFrame {
  width: number
  height: number
  color: Uint8Array
  valid: Uint8Array
  depth: Float32Array
}

export interface MaskRegion { x: number; y: number; width: number; height: number }

export interface ResidualRegion extends MaskRegion {
  pixels: number
  meanDifference: number
  maxDifference: number
}

export class GeometricFramePredictor {
  predict(previous: CameraFrame, currentViewProjection: Float64Array): PredictedFrame {
    const { width, height } = previous
    const color = new Uint8Array(width * height * 4)
    const valid = new Uint8Array(width * height)
    const depth = new Float32Array(width * height)
    depth.fill(Number.POSITIVE_INFINITY)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceIndex = y * width + x
        const sourceDepth = previous.depth[sourceIndex]
        if (sourceDepth === undefined || sourceDepth <= 0 || sourceDepth >= 1) continue
        const ndc = [
          (x + 0.5) / width * 2 - 1,
          1 - (y + 0.5) / height * 2,
          sourceDepth * 2 - 1,
          1
        ] as const
        const world = multiply(previous.inverseViewProjection, ndc)
        if (Math.abs(world[3]) < 1e-9) continue
        const worldNormalized: [number, number, number, number] = [world[0] / world[3], world[1] / world[3], world[2] / world[3], 1]
        const projected = multiply(currentViewProjection, worldNormalized)
        if (projected[3] <= 0 || Math.abs(projected[3]) < 1e-9) continue
        const px = projected[0] / projected[3]
        const py = projected[1] / projected[3]
        const pz = projected[2] / projected[3] * 0.5 + 0.5
        if (px < -1 || px > 1 || py < -1 || py > 1 || pz <= 0 || pz >= 1) continue
        const targetX = Math.min(width - 1, Math.max(0, Math.floor((px + 1) * 0.5 * width)))
        const targetY = Math.min(height - 1, Math.max(0, Math.floor((1 - py) * 0.5 * height)))
        const targetIndex = targetY * width + targetX
        if (pz >= (depth[targetIndex] ?? Number.POSITIVE_INFINITY)) continue
        depth[targetIndex] = pz
        valid[targetIndex] = 1
        const sourceColor = sourceIndex * 4
        const targetColor = targetIndex * 4
        color[targetColor] = previous.color[sourceColor] ?? 0
        color[targetColor + 1] = previous.color[sourceColor + 1] ?? 0
        color[targetColor + 2] = previous.color[sourceColor + 2] ?? 0
        color[targetColor + 3] = previous.color[sourceColor + 3] ?? 255
      }
    }
    return { width, height, color, valid, depth }
  }
}

export class ResidualDetector {
  constructor(private readonly threshold: number, private readonly minRegionPixels: number) {}

  detect(actual: CameraFrame, predicted: PredictedFrame, masks: MaskRegion[] = []): ResidualRegion[] {
    if (actual.width !== predicted.width || actual.height !== predicted.height) throw new Error('Frame dimensions do not match')
    const { width, height } = actual
    const changed = new Uint8Array(width * height)
    const differences = new Float32Array(width * height)
    for (let index = 0; index < width * height; index += 1) {
      if (!predicted.valid[index]) continue
      const x = index % width
      const y = Math.floor(index / width)
      if (masks.some(mask => x >= mask.x && x < mask.x + mask.width && y >= mask.y && y < mask.y + mask.height)) continue
      const offset = index * 4
      const difference = (
        Math.abs((actual.color[offset] ?? 0) - (predicted.color[offset] ?? 0)) +
        Math.abs((actual.color[offset + 1] ?? 0) - (predicted.color[offset + 1] ?? 0)) +
        Math.abs((actual.color[offset + 2] ?? 0) - (predicted.color[offset + 2] ?? 0))
      ) / 3
      differences[index] = difference
      if (difference >= this.threshold) changed[index] = 1
    }
    return this.components(changed, differences, width, height)
  }

  private components(changed: Uint8Array, differences: Float32Array, width: number, height: number): ResidualRegion[] {
    const visited = new Uint8Array(changed.length)
    const regions: ResidualRegion[] = []
    const queue = new Int32Array(changed.length)
    for (let start = 0; start < changed.length; start += 1) {
      if (!changed[start] || visited[start]) continue
      let head = 0
      let tail = 0
      queue[tail++] = start
      visited[start] = 1
      let minX = width
      let minY = height
      let maxX = 0
      let maxY = 0
      let pixels = 0
      let sum = 0
      let maxDifference = 0
      while (head < tail) {
        const index = queue[head++]!
        const x = index % width
        const y = Math.floor(index / width)
        minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        minY = Math.min(minY, y); maxY = Math.max(maxY, y)
        pixels += 1
        const difference = differences[index] ?? 0
        sum += difference
        maxDifference = Math.max(maxDifference, difference)
        const neighbors = [index - 1, index + 1, index - width, index + width]
        for (const neighbor of neighbors) {
          if (neighbor < 0 || neighbor >= changed.length || visited[neighbor] || !changed[neighbor]) continue
          const nx = neighbor % width
          if (Math.abs(nx - x) > 1) continue
          visited[neighbor] = 1
          queue[tail++] = neighbor
        }
      }
      if (pixels >= this.minRegionPixels) regions.push({
        x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1,
        pixels, meanDifference: sum / pixels, maxDifference
      })
    }
    return regions.sort((a, b) => b.pixels - a.pixels)
  }
}

function multiply(matrix: Float64Array, vector: readonly number[]): [number, number, number, number] {
  return [0, 1, 2, 3].map(row =>
    (matrix[row * 4] ?? 0) * (vector[0] ?? 0) +
    (matrix[row * 4 + 1] ?? 0) * (vector[1] ?? 0) +
    (matrix[row * 4 + 2] ?? 0) * (vector[2] ?? 0) +
    (matrix[row * 4 + 3] ?? 0) * (vector[3] ?? 0)
  ) as [number, number, number, number]
}
