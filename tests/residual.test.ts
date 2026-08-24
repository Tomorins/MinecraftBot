import { describe, expect, it } from 'vitest'
import { GeometricFramePredictor, ResidualDetector, type CameraFrame } from '../src/vision/residual.js'

const identity = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function frame(width: number, height: number, value: number): CameraFrame {
  const color = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    color[index * 4] = value; color[index * 4 + 1] = value; color[index * 4 + 2] = value; color[index * 4 + 3] = 255
  }
  return { width, height, color, depth: new Float32Array(width * height).fill(0.5), viewProjection: identity, inverseViewProjection: identity, timestamp: 1 }
}

describe('residual vision', () => {
  it('predicts an identity camera transform and finds a changed region', () => {
    const previous = frame(20, 20, 20)
    const actual = frame(20, 20, 20)
    for (let y = 5; y < 10; y += 1) for (let x = 6; x < 12; x += 1) {
      const offset = (y * 20 + x) * 4
      actual.color[offset] = 200; actual.color[offset + 1] = 200; actual.color[offset + 2] = 200
    }
    const predicted = new GeometricFramePredictor().predict(previous, identity)
    const regions = new ResidualDetector(30, 10).detect(actual, predicted)
    expect(regions[0]).toMatchObject({ x: 6, y: 5, width: 6, height: 5, pixels: 30 })
  })

  it('filters known-change masks', () => {
    const previous = frame(10, 10, 0)
    const actual = frame(10, 10, 255)
    const predicted = new GeometricFramePredictor().predict(previous, identity)
    const regions = new ResidualDetector(10, 1).detect(actual, predicted, [{ x: 0, y: 0, width: 10, height: 10 }])
    expect(regions).toEqual([])
  })
})
