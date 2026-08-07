import { describe, expect, test } from 'bun:test'
import { WebGPURenderer } from '../src/ts/webgpu-renderer'

describe('WebGPU bitmap uploads', () => {
  test('configures, renders, and releases prepared-frame WebGPU canvases', () => {
    const configured: unknown[] = []
    let unconfigured = 0
    const context = {
      configure: (options: unknown) => configured.push(options),
      unconfigure: () => unconfigured++
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: (type: string) => (type === 'webgpu' ? context : null)
    } as unknown as HTMLCanvasElement
    const bitmap = { width: 16, height: 9 } as ImageBitmap
    const renderer = new WebGPURenderer() as any
    renderer.device = { label: 'device' }
    renderer.pipeline = { label: 'pipeline' }
    const renders: unknown[][] = []
    renderer.renderBitmapsToContext = (...args: unknown[]) => {
      renders.push(args)
      return true
    }

    expect(renderer.renderBitmapToCanvas(canvas, bitmap, 16, 9)).toBe(true)
    expect(canvas.width).toBe(16)
    expect(canvas.height).toBe(9)
    expect(configured).toEqual([{ device: renderer.device, format: 'bgra8unorm', alphaMode: 'premultiplied' }])
    expect(renders).toEqual([[[{ image: bitmap, x: 0, y: 0 }], context, 16, 9]])

    renderer.releaseCanvas(canvas)
    expect(unconfigured).toBe(1)
    expect(renderer.stageContexts.size).toBe(0)
  })

  test('falls back to RGBA writeTexture when Chromium rejects an external image', () => {
    const writes: Array<{ destination: unknown; data: Uint8Array; layout: unknown; size: unknown }> = []
    const draws: unknown[] = []
    const originalOffscreenCanvas = globalThis.OffscreenCanvas
    const originalWarn = console.warn

    class TestOffscreenCanvas {
      width: number
      height: number

      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }

      getContext() {
        return {
          clearRect: () => undefined,
          drawImage: (image: unknown) => draws.push(image),
          getImageData: () => ({ data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]) })
        }
      }
    }

    try {
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        value: TestOffscreenCanvas
      })
      console.warn = () => undefined
      const renderer = new WebGPURenderer() as any
      renderer.device = {
        queue: {
          copyExternalImageToTexture: () => {
            throw new TypeError('Failed to copy content from external image')
          },
          writeTexture: (destination: unknown, data: Uint8Array, layout: unknown, size: unknown) =>
            writes.push({ destination, data, layout, size })
        }
      }
      renderer.textureArray = { label: 'subtitle texture' }
      const bitmap = { width: 2, height: 1 }

      expect(renderer.uploadImageBitmap(2, bitmap, 2, 1)).toBe(true)
      expect(draws).toEqual([bitmap])
      expect([...writes[0].data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      expect(writes[0].destination).toEqual({
        texture: renderer.textureArray,
        origin: [0, 0, 2]
      })
      expect(writes[0].layout).toEqual({ bytesPerRow: 8 })
      expect(writes[0].size).toEqual({ width: 2, height: 1 })
    } finally {
      console.warn = originalWarn
      if (originalOffscreenCanvas === undefined) {
        Reflect.deleteProperty(globalThis, 'OffscreenCanvas')
      } else {
        Object.defineProperty(globalThis, 'OffscreenCanvas', {
          configurable: true,
          value: originalOffscreenCanvas
        })
      }
    }
  })
})
