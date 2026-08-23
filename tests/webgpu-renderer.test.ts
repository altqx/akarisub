import { describe, expect, test } from 'bun:test'
import { WebGPURenderer } from '../src/ts/webgpu-renderer'

describe('WebGPU bitmap uploads', () => {
  test('reports device.lost and marks the renderer unavailable', async () => {
    let resolveLost!: (info: GPUDeviceLostInfo) => void
    const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
      resolveLost = resolve
    })
    const buffer = { destroy: () => undefined }
    const texture = {
      createView: () => ({}),
      destroy: () => undefined
    }
    const device = {
      lost,
      queue: {
        writeBuffer: () => undefined,
        submit: () => undefined
      },
      createShaderModule: () => ({}),
      createBuffer: () => buffer,
      createTexture: () => texture,
      createBindGroupLayout: () => ({}),
      createPipelineLayout: () => ({}),
      createRenderPipeline: () => ({}),
      createCommandEncoder: () => ({
        beginRenderPass: () => ({ end: () => undefined }),
        finish: () => ({})
      }),
      destroy: () => undefined
    }
    const gpu = {
      requestAdapter: async () => ({ requestDevice: async () => device }),
      getPreferredCanvasFormat: () => 'bgra8unorm'
    }
    const globals = ['GPUBufferUsage', 'GPUShaderStage', 'GPUTextureUsage'] as const
    const globalDescriptors = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
    const gpuDescriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu')

    try {
      Object.defineProperty(navigator, 'gpu', { configurable: true, value: gpu })
      Object.defineProperty(globalThis, 'GPUBufferUsage', {
        configurable: true,
        value: { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 }
      })
      Object.defineProperty(globalThis, 'GPUShaderStage', {
        configurable: true,
        value: { VERTEX: 1, FRAGMENT: 2 }
      })
      Object.defineProperty(globalThis, 'GPUTextureUsage', {
        configurable: true,
        value: { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 }
      })

      const renderer = new WebGPURenderer()
      let lossInfo: GPUDeviceLostInfo | undefined
      renderer.onDeviceLost = (info) => {
        lossInfo = info
      }
      await renderer.init()
      expect(renderer.initialized).toBe(true)

      const info = { reason: 'unknown', message: 'test device loss' } as GPUDeviceLostInfo
      resolveLost(info)
      await Promise.resolve()
      await Promise.resolve()

      expect(lossInfo).toBe(info)
      expect(renderer.initialized).toBe(false)
      renderer.destroy()
    } finally {
      if (gpuDescriptor) Object.defineProperty(navigator, 'gpu', gpuDescriptor)
      else Reflect.deleteProperty(navigator, 'gpu')
      globals.forEach((name, index) => {
        const descriptor = globalDescriptors[index]
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      })
    }
  })

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
