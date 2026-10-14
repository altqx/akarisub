import { describe, expect, test } from 'bun:test'
import { MAX_GPU_TEXTURE_ARRAY_BYTES } from '../src/ts/gpu-budget'
import {
  GPUUploadSource,
  RAW_ASS_ATLAS_INSTANCE_INTS,
  assertAtlasInHeap,
  atlasInstancePixels,
  atlasLayerLimit,
  atlasPackLimits,
  decodeAtlasHeader,
  growAtlasTexture,
  growInstanceCapacity,
  rawAssByteUnitTable,
  writeLayerInstance
} from '../src/ts/raw-ass-atlas'

describe('raw ASS atlas header', () => {
  test('decodes the nine ints written by akarisub_render_atlas_collect', () => {
    const header = Int32Array.from([1, 49, 4096, 8192, 640, 360, 2, 0, 1])
    expect(decodeAtlasHeader(header)).toEqual({
      status: 1,
      frame: {
        instanceCount: 49,
        instancesPtr: 4096,
        bufferPtr: 8192,
        pageWidth: 640,
        pageHeight: 360,
        pages: 2,
        pixelsChanged: false,
        instancesChanged: true
      }
    })
    expect(decodeAtlasHeader(Int32Array.from([-1, 0, 0, 0, 0, 0, 0, 0, 0])).status).toBe(-1)
  })
})

describe('raw ASS atlas pack limits', () => {
  test('caps the page edge at 8192 and the pages at the texture budget', () => {
    // 8192^2 R8 pages: four fit in 256 MiB.
    expect(atlasPackLimits(16384, 2048)).toEqual({ maxSize: 8192, maxPages: 4 })
    expect(atlasPackLimits(8192, 256)).toEqual({ maxSize: 8192, maxPages: 4 })
    // Small GPUs: the device limit wins.
    expect(atlasPackLimits(4096, 256)).toEqual({ maxSize: 4096, maxPages: 16 })
    expect(atlasPackLimits(2048, 8)).toEqual({ maxSize: 2048, maxPages: 8 })
  })

  test('every pack it allows fits the texture budget', () => {
    for (const [size, layers] of [
      [16384, 2048],
      [8192, 256],
      [4096, 256],
      [2048, 256]
    ]) {
      const { maxSize, maxPages } = atlasPackLimits(size, layers)
      expect(maxSize * maxSize * maxPages).toBeLessThanOrEqual(MAX_GPU_TEXTURE_ARRAY_BYTES)
      expect(maxPages).toBeGreaterThan(0)
    }
  })

  test('honors the test page-edge override, never below 16', () => {
    expect(atlasPackLimits(8192, 256, 256)).toEqual({ maxSize: 256, maxPages: 256 })
    expect(atlasPackLimits(8192, 256, 4).maxSize).toBe(16)
    expect(atlasPackLimits(1024, 256, 4096).maxSize).toBe(1024)
  })

  test('falls back to WebGL2 minimums when limits are unknown', () => {
    expect(atlasPackLimits(0, 0)).toEqual({ maxSize: 2048, maxPages: 64 })
    expect(atlasLayerLimit(0)).toBe(256)
    expect(atlasLayerLimit(2048)).toBe(256)
    expect(atlasLayerLimit(12)).toBe(12)
  })
})

describe('raw ASS atlas texture growth', () => {
  test('allocates rounded to 64 and keeps a texture that already fits', () => {
    expect(growAtlasTexture(null, { width: 300, height: 100, layers: 1 }, 256)).toEqual({
      width: 320,
      height: 128,
      layers: 1
    })
    expect(
      growAtlasTexture({ width: 320, height: 128, layers: 2 }, { width: 320, height: 64, layers: 2 }, 256)
    ).toBeNull()
  })

  test('grows every dimension to the larger of both', () => {
    expect(
      growAtlasTexture({ width: 640, height: 128, layers: 1 }, { width: 100, height: 400, layers: 3 }, 256)
    ).toEqual({
      width: 640,
      height: 448,
      layers: 3
    })
  })

  test('sizes for the frame alone when growing everything would exceed the budget', () => {
    // 8192x8192 x4 is the whole budget; 8192x64 x40 fits, the union does not.
    expect(
      growAtlasTexture({ width: 8192, height: 8192, layers: 4 }, { width: 8192, height: 64, layers: 40 }, 256)
    ).toEqual({
      width: 8192,
      height: 64,
      layers: 40
    })
  })

  test('throws when the frame alone exceeds the budget or the device limits', () => {
    expect(() => growAtlasTexture(null, { width: 8192, height: 8192, layers: 5 }, 256)).toThrow('budget')
    expect(() => growAtlasTexture(null, { width: 64, height: 64, layers: 9 }, 8)).toThrow('limits')
    expect(() => growAtlasTexture(null, { width: 9000, height: 64, layers: 1 }, 256, 8192)).toThrow('limits')
  })

  test('does not round past the device dimension limit', () => {
    expect(growAtlasTexture(null, { width: 4000, height: 10, layers: 1 }, 256, 4000)).toEqual({
      width: 4000,
      height: 64,
      layers: 1
    })
  })
})

describe('raw ASS instance helpers', () => {
  test('instance buffer capacity is grow-only and at least 64 records', () => {
    expect(growInstanceCapacity(0, 32)).toBe(64 * 32)
    expect(growInstanceCapacity(2048, 2048)).toBe(2048)
    expect(growInstanceCapacity(2048, 2080)).toBe(4096)
    expect(growInstanceCapacity(2048, 10000)).toBe(10000)
  })

  test('rejects packs that end past the heap view', () => {
    const frame = {
      instanceCount: 3,
      instancesPtr: 256,
      bufferPtr: 1024,
      pageWidth: 64,
      pageHeight: 32,
      pages: 2,
      pixelsChanged: true,
      instancesChanged: true
    }
    expect(() => assertAtlasInHeap(frame, 1024 + 64 * 32 * 2)).not.toThrow()
    expect(() => assertAtlasInHeap(frame, 1024 + 64 * 32 * 2 - 1)).toThrow(RangeError)
    expect(() => assertAtlasInHeap({ ...frame, instancesPtr: 8192 }, 8192 + 95)).toThrow(RangeError)
    expect(() => assertAtlasInHeap({ ...frame, instanceCount: 0 }, 0)).not.toThrow()
  })

  test('sums w * h over packed instances', () => {
    const instances = new Int32Array(3 * RAW_ASS_ATLAS_INSTANCE_INTS)
    writeLayerInstance(instances, 0, 1, 2, 10, 20, 0, 0)
    writeLayerInstance(instances, 1, 1, 2, 3, 4, 1, 0)
    writeLayerInstance(instances, 2, 1, 2, 100, 100, 2, 0)
    expect(atlasInstancePixels(instances, 2)).toBe(212)
    expect(atlasInstancePixels(instances, 3)).toBe(10212)
  })

  test('layer instances use the ASS_AtlasInstance layout and keep the uint32 color bits', () => {
    const instances = new Int32Array(2 * RAW_ASS_ATLAS_INSTANCE_INTS)
    writeLayerInstance(instances, 1, -5, 7, 30, 40, 3, 0xff8000c0)
    expect(Array.from(instances.subarray(8))).toEqual([-5, 7, 30, 40, 0, 0, 3, 0xff8000c0 | 0])
    expect(new Uint32Array(instances.buffer)[15]).toBe(0xff8000c0)
  })

  test('byte table holds the float32 values the per-image path uploads', () => {
    const table = rawAssByteUnitTable()
    const perImage = new Float32Array(1)
    for (let i = 0; i < 256; i++) {
      perImage[0] = i / 255
      expect(table[i]).toBe(perImage[0])
    }
    expect(table[0]).toBe(0)
    expect(table[255]).toBe(1)
  })
})

describe('GPU upload source', () => {
  test('passes plain ArrayBuffer memory through without copying', () => {
    const source = new GPUUploadSource()
    const heap = new ArrayBuffer(64)
    const calls: Array<[ArrayBuffer | SharedArrayBuffer, number]> = []
    source.upload(heap, 16, 8, (data, offset) => calls.push([data, offset]))
    expect(calls).toEqual([[heap, 16]])
    expect(source.stagedUploads).toBe(0)
  })

  test('passes shared memory directly while the browser accepts it', () => {
    const source = new GPUUploadSource()
    const heap = new SharedArrayBuffer(64)
    const calls: Array<[ArrayBuffer | SharedArrayBuffer, number]> = []
    source.upload(heap, 16, 8, (data, offset) => calls.push([data, offset]))
    expect(calls).toEqual([[heap, 16]])
    expect(source.sharedUploads).toBe(1)
    expect(source.sharedRejected).toBe(false)
  })

  test('switches to a staging copy after a TypeError on shared memory', () => {
    const source = new GPUUploadSource()
    const heap = new SharedArrayBuffer(64)
    new Uint8Array(heap).set([1, 2, 3, 4, 5, 6, 7, 8], 16)
    const received: number[][] = []
    const write = (data: ArrayBuffer | SharedArrayBuffer, offset: number): void => {
      if (data instanceof SharedArrayBuffer) throw new TypeError('SharedArrayBuffer is not allowed')
      received.push(Array.from(new Uint8Array(data, offset, 8)))
    }
    source.upload(heap, 16, 8, write)
    expect(source.sharedRejected).toBe(true)
    // Later uploads skip the direct attempt.
    new Uint8Array(heap).set([9, 9, 9, 9, 9, 9, 9, 9], 16)
    source.upload(heap, 16, 8, write)
    expect(received).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8],
      [9, 9, 9, 9, 9, 9, 9, 9]
    ])
    expect(source.stagedUploads).toBe(2)
  })

  test('rethrows errors that are not about the shared source', () => {
    const source = new GPUUploadSource()
    expect(() =>
      source.upload(new SharedArrayBuffer(8), 0, 8, () => {
        throw new RangeError('out of range')
      })
    ).toThrow(RangeError)
    expect(source.sharedRejected).toBe(false)
  })

  test('forceStaging copies even where shared memory is accepted', () => {
    const source = new GPUUploadSource()
    source.forceStaging = true
    const heap = new SharedArrayBuffer(70000)
    let seen: ArrayBuffer | SharedArrayBuffer | null = null
    source.upload(heap, 100, 69000, (data, offset) => {
      seen = data
      expect(offset).toBe(0)
    })
    expect(seen).not.toBe(heap)
    expect(seen! instanceof ArrayBuffer).toBe(true)
    expect((seen! as ArrayBuffer).byteLength).toBeGreaterThanOrEqual(69000)
  })
})
