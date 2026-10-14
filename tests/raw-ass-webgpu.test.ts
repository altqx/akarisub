import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { RawASSImageWebGPURenderer, isWorkerWebGPUSupported } from '../src/ts/raw-ass-webgpu'
import type { RawASSAtlasFrame } from '../src/ts/raw-ass-atlas'

type Call = { name: string; args: any[] }

interface FakeDevice {
  calls: Call[]
  pipeline: any
  loseNow: (info?: Partial<GPUDeviceLostInfo>) => void
  destroyed: boolean
  device: any
}

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const fakeDevice = (options: { rejectShared?: boolean } = {}): FakeDevice => {
  const calls: Call[] = []
  const lost = deferred<GPUDeviceLostInfo>()
  const fake: FakeDevice = {
    calls,
    pipeline: null,
    destroyed: false,
    loseNow: (info) => lost.resolve({ reason: 'unknown', message: 'test', ...info } as GPUDeviceLostInfo),
    device: null
  }
  const checkShared = (data: unknown) => {
    if (options.rejectShared && data instanceof SharedArrayBuffer) throw new TypeError('shared source rejected')
  }
  fake.device = {
    lost: lost.promise,
    limits: { maxTextureDimension2D: 8192, maxTextureArrayLayers: 256 },
    queue: {
      writeBuffer: (...args: any[]) => {
        checkShared(args[2])
        calls.push({ name: 'writeBuffer', args })
      },
      writeTexture: (...args: any[]) => {
        checkShared(args[1])
        // Snapshot like the real queue: staged copies are reused afterwards.
        const [dst, data, layout, size] = args
        const bytes = new Uint8Array(data as ArrayBufferLike).slice(layout.offset, layout.offset + 4)
        calls.push({ name: 'writeTexture', args: [dst, data, layout, size, Array.from(bytes)] })
      },
      submit: (buffers: unknown[]) => calls.push({ name: 'submit', args: [buffers.length] }),
      onSubmittedWorkDone: async () => undefined
    },
    createBuffer: (desc: GPUBufferDescriptor) => {
      calls.push({ name: 'createBuffer', args: [desc] })
      return {
        size: desc.size,
        usage: desc.usage,
        destroy: () => calls.push({ name: 'destroyBuffer', args: [desc.size] })
      }
    },
    createTexture: (desc: GPUTextureDescriptor) => {
      calls.push({ name: 'createTexture', args: [desc] })
      return {
        desc,
        createView: (view: unknown) => ({ view }),
        destroy: () => calls.push({ name: 'destroyTexture', args: [] })
      }
    },
    createBindGroupLayout: () => ({}),
    createBindGroup: () => ({}),
    createPipelineLayout: () => ({}),
    createShaderModule: (desc: GPUShaderModuleDescriptor) => ({ code: desc.code }),
    createRenderPipelineAsync: async (desc: GPURenderPipelineDescriptor) => {
      fake.pipeline = desc
      return { pipeline: true }
    },
    createCommandEncoder: () => ({
      beginRenderPass: (desc: GPURenderPassDescriptor) => {
        const attachment = (desc.colorAttachments as GPURenderPassColorAttachment[])[0]
        calls.push({ name: 'pass', args: [attachment.loadOp] })
        return {
          setPipeline: () => undefined,
          setBindGroup: () => undefined,
          setVertexBuffer: () => undefined,
          draw: (vertices: number, instances: number) => calls.push({ name: 'draw', args: [vertices, instances] }),
          end: () => undefined
        }
      },
      finish: () => ({})
    }),
    destroy: () => {
      fake.destroyed = true
      lost.resolve({ reason: 'destroyed', message: '' } as GPUDeviceLostInfo)
    }
  }
  return fake
}

const fakeCanvas = () => {
  const configs: GPUCanvasConfiguration[] = []
  let contextRequests = 0
  const canvas = {
    width: 0,
    height: 0,
    configs,
    get contextRequests() {
      return contextRequests
    },
    getContext: (kind: string) => {
      contextRequests++
      if (kind !== 'webgpu') return null
      return {
        configure: (config: GPUCanvasConfiguration) => configs.push(config),
        unconfigure: () => undefined,
        getCurrentTexture: () => ({ width: canvas.width, height: canvas.height, createView: () => ({}) })
      }
    }
  }
  return canvas
}

let devices: FakeDevice[] = []
let adapterAvailable = true
const saved = new Map<string, PropertyDescriptor | undefined>()
const install = (target: object, name: string, value: unknown) => {
  const key = `${target === navigator ? 'navigator.' : ''}${name}`
  if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(target, name))
  Object.defineProperty(target, name, { configurable: true, writable: true, value })
}

beforeEach(() => {
  devices = []
  adapterAvailable = true
  install(navigator, 'gpu', {
    requestAdapter: async () =>
      adapterAvailable
        ? {
            requestDevice: async () => {
              const fake = fakeDevice(nextDeviceOptions)
              devices.push(fake)
              return fake.device
            }
          }
        : null,
    getPreferredCanvasFormat: () => 'bgra8unorm'
  })
  install(globalThis, 'GPUBufferUsage', { MAP_READ: 1, COPY_DST: 8, COPY_SRC: 4, VERTEX: 32, UNIFORM: 64 })
  install(globalThis, 'GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 })
  install(globalThis, 'GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 })
  nextDeviceOptions = {}
})

afterEach(() => {
  for (const [key, descriptor] of saved) {
    const [target, name] = key.startsWith('navigator.') ? [navigator, key.slice(10)] : [globalThis, key]
    if (descriptor) Object.defineProperty(target, name, descriptor)
    else delete (target as any)[name]
  }
  saved.clear()
})

let nextDeviceOptions: { rejectShared?: boolean } = {}

const frame = (overrides: Partial<RawASSAtlasFrame> = {}): RawASSAtlasFrame => ({
  instanceCount: 3,
  instancesPtr: 256,
  bufferPtr: 1024,
  pageWidth: 64,
  pageHeight: 32,
  pages: 2,
  pixelsChanged: true,
  instancesChanged: true,
  ...overrides
})

const heapWithInstances = (buffer: ArrayBufferLike = new ArrayBuffer(1024 + 64 * 32 * 2)) => {
  const heap = new Uint8Array(buffer)
  const ints = new Int32Array(buffer, 256, 24)
  for (let i = 0; i < 3; i++) ints.set([i * 10, 5, 4, 2, 0, 0, 0, 0xffffff00 | 0], i * 8)
  heap.set([7, 8, 9, 10], 1024)
  return heap
}

const named = (device: FakeDevice, name: string) => device.calls.filter((c) => c.name === name)

const initRenderer = async () => {
  const renderer = new RawASSImageWebGPURenderer()
  const canvas = fakeCanvas()
  const ok = await renderer.init(canvas as unknown as OffscreenCanvas, 640, 360, 'display-p3', true)
  return { renderer, canvas, ok }
}

describe('worker WebGPU raw ASS renderer', () => {
  test('reports missing WebGPU without binding the canvas', async () => {
    install(navigator, 'gpu', undefined)
    expect(isWorkerWebGPUSupported()).toBe(false)
    const { ok, canvas } = await initRenderer()
    expect(ok).toBe(false)
    expect(canvas.contextRequests).toBe(0)
  })

  test('leaves the canvas free when no adapter is available', async () => {
    adapterAvailable = false
    const { ok, canvas } = await initRenderer()
    expect(ok).toBe(false)
    expect(canvas.contextRequests).toBe(0)
  })

  test('leaves the canvas free when a probe canvas loses the device', async () => {
    let probes = 0
    install(
      globalThis,
      'OffscreenCanvas',
      class {
        getContext() {
          return {
            configure: () => {
              probes++
              devices.at(-1)!.loseNow({ reason: 'destroyed' as GPUDeviceLostReason })
            },
            unconfigure: () => undefined,
            getCurrentTexture: () => ({ createView: () => ({}) })
          }
        }
      }
    )
    const { ok, canvas } = await initRenderer()
    expect(ok).toBe(false)
    expect(probes).toBe(1)
    expect(canvas.contextRequests).toBe(0)
    expect(devices[0].destroyed).toBe(true)
  })

  test('binds the canvas when the probe canvas presents', async () => {
    install(
      globalThis,
      'OffscreenCanvas',
      class {
        getContext() {
          return {
            configure: () => undefined,
            unconfigure: () => undefined,
            getCurrentTexture: () => ({ createView: () => ({}) })
          }
        }
      }
    )
    const { ok, renderer, canvas } = await initRenderer()
    expect(ok).toBe(true)
    expect(canvas.contextRequests).toBe(1)
    renderer.destroy()
  })

  test('builds the instance pipeline and premultiplied canvas configuration', async () => {
    const { renderer, canvas, ok } = await initRenderer()
    expect(ok).toBe(true)
    const pipeline = devices[0].pipeline as GPURenderPipelineDescriptor
    expect(pipeline.vertex.buffers).toEqual([
      {
        arrayStride: 32,
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'sint32x4' },
          { shaderLocation: 1, offset: 16, format: 'sint32x3' },
          { shaderLocation: 2, offset: 28, format: 'uint32' }
        ]
      }
    ])
    const target = (pipeline.fragment!.targets as GPUColorTargetState[])[0]
    expect(target.blend).toEqual({
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
    })
    expect(target.format).toBe('bgra8unorm')
    const config = canvas.configs[0] as GPUCanvasConfiguration & { colorSpace?: string }
    expect(config.alphaMode).toBe('premultiplied')
    expect(config.colorSpace).toBe('display-p3')
    expect(config.toneMapping).toEqual({ mode: 'extended' })
    expect(canvas.width).toBe(640)
    expect(canvas.height).toBe(360)
    expect(renderer.atlasLimits()).toEqual({ maxSize: 8192, maxPages: 4 })
    // The byte table goes into the uniform buffer once, after the resolution.
    const table = named(devices[0], 'writeBuffer')[0]
    expect(table.args[1]).toBe(16)
    expect((table.args[2] as Float32Array).length).toBe(256)
    renderer.destroy()
  })

  test('writes pages and instances straight from the heap only when they changed', async () => {
    const { renderer, ok } = await initRenderer()
    expect(ok).toBe(true)
    const device = devices[0]
    const heap = heapWithInstances()
    device.calls.length = 0

    expect(renderer.renderAtlas(frame(), heap, 640, 360)).toBe(3 * 8)
    const [texture] = named(device, 'writeTexture')
    expect(texture.args[1]).toBe(heap.buffer)
    expect(texture.args[2]).toEqual({ offset: 1024, bytesPerRow: 64, rowsPerImage: 32 })
    expect(texture.args[3]).toEqual({ width: 64, height: 32, depthOrArrayLayers: 2 })
    const created = named(device, 'createTexture')[0].args[0] as GPUTextureDescriptor
    expect(created.format).toBe('r8unorm')
    expect(created.size).toEqual({ width: 64, height: 64, depthOrArrayLayers: 2 })
    const instanceWrites = named(device, 'writeBuffer').filter((c) => c.args[2] === heap.buffer)
    expect(instanceWrites.map((c) => c.args.slice(1))).toEqual([[0, heap.buffer, 256, 96]])
    expect(named(device, 'draw').map((c) => c.args)).toEqual([[6, 3]])

    // Unchanged frame: no queue writes, same single draw.
    device.calls.length = 0
    renderer.renderAtlas(frame({ pixelsChanged: false, instancesChanged: false }), heap, 640, 360)
    expect(named(device, 'writeTexture')).toHaveLength(0)
    expect(named(device, 'writeBuffer')).toHaveLength(0)
    expect(named(device, 'draw').map((c) => c.args)).toEqual([[6, 3]])

    // Integer \move: instances only.
    device.calls.length = 0
    renderer.renderAtlas(frame({ pixelsChanged: false, instancesChanged: true }), heap, 640, 360)
    expect(named(device, 'writeTexture')).toHaveLength(0)
    expect(named(device, 'writeBuffer')).toHaveLength(1)

    // A pack that was not drawn still reaches the GPU with the next draw.
    renderer.noteUndrawnAtlas(frame({ pixelsChanged: true, instancesChanged: false }))
    device.calls.length = 0
    renderer.renderAtlas(frame({ pixelsChanged: false, instancesChanged: false }), heap, 640, 360)
    expect(named(device, 'writeTexture')).toHaveLength(1)
    expect(named(device, 'writeBuffer')).toHaveLength(0)
    expect(renderer.atlasStats).toMatchObject({ pixelUploads: 2, instanceUploads: 2, textureAllocations: 1 })
    renderer.destroy()
  })

  test('rejects a pack outside the heap view before writing anything', async () => {
    const { renderer } = await initRenderer()
    const device = devices[0]
    const heap = heapWithInstances()
    renderer.renderAtlas(frame(), heap, 640, 360)
    device.calls.length = 0
    // A view taken before WASM memory grew: the new pack lies beyond it.
    const stale = heap.subarray(0, 4096)
    expect(() => renderer.renderAtlas(frame(), stale, 640, 360)).toThrow(RangeError)
    expect(named(device, 'writeTexture')).toHaveLength(0)
    expect(named(device, 'writeBuffer')).toHaveLength(0)
    expect(named(device, 'submit')).toHaveLength(0)
    expect(renderer.atlasStats).toMatchObject({ pixelUploads: 1, instanceUploads: 1 })
    renderer.destroy()
  })

  test('an empty frame clears the canvas without drawing', async () => {
    const { renderer } = await initRenderer()
    const device = devices[0]
    device.calls.length = 0
    expect(renderer.renderAtlas(frame({ instanceCount: 0 }), heapWithInstances(), 640, 360)).toBe(0)
    expect(named(device, 'pass').map((c) => c.args[0])).toEqual(['clear'])
    expect(named(device, 'draw')).toHaveLength(0)
    renderer.destroy()
  })

  test('replaces a lost device, reports the loss and re-uploads everything', async () => {
    const { renderer, canvas } = await initRenderer()
    const heap = heapWithInstances()
    renderer.renderAtlas(frame(), heap, 640, 360)
    const events: string[] = []
    const restored = deferred<void>()
    renderer.onContextLost = () => events.push('lost')
    renderer.onContextRestored = () => {
      events.push('restored')
      restored.resolve()
    }

    devices[0].loseNow()
    await Promise.resolve()
    expect(events).toEqual(['lost'])
    expect(renderer.contextLost).toBe(true)
    expect(renderer.atlasAvailable).toBe(false)
    expect(() => renderer.renderAtlas(frame(), heap, 640, 360)).toThrow('not available')

    await restored.promise
    expect(events).toEqual(['lost', 'restored'])
    expect(devices).toHaveLength(2)
    expect(canvas.configs.at(-1)!.device).toBe(devices[1].device)
    expect(renderer.atlasStats).toMatchObject({ contextLosses: 1, contextRestores: 1 })

    // libass reports the same pack as unchanged, but the new device is empty.
    renderer.renderAtlas(frame({ pixelsChanged: false, instancesChanged: false }), heap, 640, 360)
    expect(named(devices[1], 'writeTexture')).toHaveLength(1)
    expect(named(devices[1], 'writeBuffer').filter((c) => c.args[2] === heap.buffer)).toHaveLength(1)
    renderer.destroy()
  })

  test('stops recreating devices that are lost right after creation', async () => {
    const { renderer } = await initRenderer()
    let failures = 0
    renderer.onFailed = () => failures++
    const restores: number[] = []
    let next = deferred<void>()
    renderer.onContextRestored = () => {
      restores.push(devices.length)
      next.resolve()
    }
    for (let i = 0; i < 2; i++) {
      devices.at(-1)!.loseNow()
      await next.promise
      next = deferred<void>()
    }
    devices.at(-1)!.loseNow()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(restores).toEqual([2, 3])
    expect(devices).toHaveLength(3)
    expect(renderer.failed).toBe(true)
    expect(renderer.contextLost).toBe(true)
    expect(renderer.atlasStats).toMatchObject({ contextLosses: 3, contextRestores: 2 })
    expect(failures).toBe(1)
    renderer.destroy()
  })

  test('reports failure once every recovery attempt finds no adapter', async () => {
    const { renderer } = await initRenderer()
    const failed = deferred<void>()
    let failures = 0
    renderer.onFailed = () => {
      failures++
      failed.resolve()
    }
    let restored = false
    renderer.onContextRestored = () => {
      restored = true
    }
    adapterAvailable = false
    devices[0].loseNow()
    await failed.promise
    expect(failures).toBe(1)
    expect(restored).toBe(false)
    expect(renderer.failed).toBe(true)
    expect(renderer.contextLost).toBe(true)
    expect(devices).toHaveLength(1)
    renderer.destroy()
  })

  test('destroy does not trigger recovery', async () => {
    const { renderer } = await initRenderer()
    let lost = false
    renderer.onContextLost = () => {
      lost = true
    }
    renderer.destroy()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(devices[0].destroyed).toBe(true)
    expect(lost).toBe(false)
    expect(devices).toHaveLength(1)
  })

  test('stages shared memory when the queue rejects it', async () => {
    nextDeviceOptions = { rejectShared: true }
    const { renderer } = await initRenderer()
    const device = devices[0]
    const heap = heapWithInstances(new SharedArrayBuffer(1024 + 64 * 32 * 2))
    device.calls.length = 0
    renderer.renderAtlas(frame(), heap, 640, 360)
    const [texture] = named(device, 'writeTexture')
    expect(texture.args[1]).toBeInstanceOf(ArrayBuffer)
    expect(texture.args[2].offset).toBe(0)
    expect(texture.args[4]).toEqual([7, 8, 9, 10])
    const instances = named(device, 'writeBuffer').find((c) => c.args.length === 5)!
    expect(instances.args[2]).toBeInstanceOf(ArrayBuffer)
    expect(instances.args.slice(3)).toEqual([0, 96])
    expect(renderer.uploads.sharedRejected).toBe(true)
    renderer.destroy()
  })

  test('draws frames that did not pack one array layer per image', async () => {
    const { renderer } = await initRenderer()
    const device = devices[0]
    const heap = new Uint8Array(4096)
    heap.set([1, 2, 3], 2000)
    // x, y, w, h, ptr, color, stride, pad
    const meta = Int32Array.from([
      10,
      20,
      3,
      2,
      2000,
      0x112233ff | 0,
      8,
      0, // fully transparent: skipped
      10,
      20,
      3,
      2,
      2000,
      0x11223300,
      8,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // empty: skipped
      30,
      40,
      5,
      4,
      3000,
      0x44556680,
      0,
      0
    ])
    device.calls.length = 0
    expect(renderer.renderRawAssMetadata(meta, 4, heap, 640, 360)).toBe(3 * 2 + 5 * 4)
    const writes = named(device, 'writeTexture')
    expect(writes.map((c) => [c.args[0].origin, c.args[2], c.args[3]])).toEqual([
      [
        { x: 0, y: 0, z: 0 },
        { offset: 2000, bytesPerRow: 8, rowsPerImage: 2 },
        { width: 3, height: 2, depthOrArrayLayers: 1 }
      ],
      [
        { x: 0, y: 0, z: 1 },
        { offset: 3000, bytesPerRow: 5, rowsPerImage: 4 },
        { width: 5, height: 4, depthOrArrayLayers: 1 }
      ]
    ])
    const instances = named(device, 'writeBuffer').find((c) => c.args.length === 5)!
    expect(Array.from(new Int32Array(instances.args[2], 0, 16))).toEqual([
      10, 20, 3, 2, 0, 0, 0, 0x11223300, 30, 40, 5, 4, 0, 0, 1, 0x44556680
    ])
    expect(named(device, 'pass').map((c) => c.args[0])).toEqual(['clear'])
    expect(named(device, 'draw').map((c) => c.args)).toEqual([[6, 2]])

    // The atlas copy was overwritten: the next pack re-uploads in full.
    device.calls.length = 0
    renderer.renderAtlas(frame({ pixelsChanged: false, instancesChanged: false }), heapWithInstances(), 640, 360)
    expect(named(device, 'writeTexture')).toHaveLength(1)
    renderer.destroy()
  })
})
