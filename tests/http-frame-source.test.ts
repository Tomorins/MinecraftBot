import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { HttpFrameSource } from '../src/vision/http-frame-source.js'

const servers: Array<ReturnType<typeof createServer>> = []
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))))

describe('HttpFrameSource', () => {
  it('decodes synchronized RGBA, little-endian depth, matrices and masks', async () => {
    const color = Buffer.from([1, 2, 3, 255, 4, 5, 6, 255])
    const depth = Buffer.alloc(8)
    depth.writeFloatLE(0.25, 0)
    depth.writeFloatLE(0.75, 4)
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        width: 2, height: 1, colorBase64: color.toString('base64'), depthBase64: depth.toString('base64'),
        viewProjection: identity, inverseViewProjection: identity, imageBase64: 'cG5n', mimeType: 'image/png',
        masks: [{ x: 0, y: 0, width: 1, height: 1 }], timestamp: 123
      }))
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server has no TCP address')
    const source = new HttpFrameSource(`http://127.0.0.1:${address.port}`)
    const frame = await source.capture()
    expect([...frame.color]).toEqual([...color])
    expect([...frame.depth]).toEqual([0.25, 0.75])
    expect(frame.timestamp).toBe(123)
    expect(await source.knownChangeMasks()).toEqual([{ x: 0, y: 0, width: 1, height: 1 }])
    expect(await source.encodeRegion(frame, { x: 0, y: 0, width: 1, height: 1, pixels: 1, meanDifference: 1, maxDifference: 1 })).toEqual({ base64: 'cG5n', mimeType: 'image/png' })
  })
})
