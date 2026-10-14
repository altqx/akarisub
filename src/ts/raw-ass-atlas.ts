import { roundTextureDim, textureArrayLayerCap } from './gpu-budget'

// Shared pieces of the worker's raw ASS_Image GPU compositors (WebGL2 and
// WebGPU). libass packs every mask of a frame into R8 pages
// (ass_frame_pack_atlas) and describes each quad with a 32-byte
// ASS_AtlasInstance that both renderers upload unchanged:
//   offset 0: dst_x, dst_y, w, h (int32); 16: atlas_x, atlas_y, page (int32);
//   28: color (uint32 RRGGBBAA, low byte = ASS transparency).

/** Ints written by akarisub_render_atlas_collect into its atlas header. */
export const RAW_ASS_ATLAS_HEADER_INTS = 9
/** sizeof(ASS_AtlasInstance). */
export const RAW_ASS_ATLAS_INSTANCE_BYTES = 32
export const RAW_ASS_ATLAS_INSTANCE_INTS = RAW_ASS_ATLAS_INSTANCE_BYTES / 4
/**
 * Largest page edge requested from libass. 8192 x 8192 R8 pages keep four
 * layers inside the GPU texture budget; libass sizes pages to the frame, so
 * typical frames use one much smaller page.
 */
export const RAW_ASS_ATLAS_MAX_SIZE = 8192
/** Hard layer limit for the atlas array; the byte budget usually binds first. */
export const RAW_ASS_ATLAS_MAX_PAGES = 256

/** One packed frame as reported by akarisub_render_atlas_collect. */
export interface RawASSAtlasFrame {
  instanceCount: number
  instancesPtr: number
  bufferPtr: number
  pageWidth: number
  pageHeight: number
  pages: number
  pixelsChanged: boolean
  instancesChanged: boolean
}

/**
 * Header status: 1 packed, 0 this libass has no frame atlas, -1 the pack
 * failed (the image rows were written for the per-image path instead).
 */
export interface RawASSAtlasHeader {
  status: number
  frame: RawASSAtlasFrame
}

/** Upload counters of the atlas path, for tests and debug output. */
export interface RawASSAtlasStats {
  pixelUploads: number
  instanceUploads: number
  textureAllocations: number
  contextLosses: number
  contextRestores: number
}

/** Decodes the 9-int header; `header` must be read after the WASM call returned. */
export const decodeAtlasHeader = (header: Int32Array): RawASSAtlasHeader => ({
  status: header[0],
  frame: {
    instanceCount: header[1],
    instancesPtr: header[2],
    bufferPtr: header[3],
    pageWidth: header[4],
    pageHeight: header[5],
    pages: header[6],
    pixelsChanged: header[7] !== 0,
    instancesChanged: header[8] !== 0
  }
})

/**
 * Page edge and page count to request from ass_frame_pack_atlas: bounded by
 * the GPU limits and by the texture budget for max-size pages, so any
 * successful pack can be uploaded. `maxSizeOverride` (tests) lowers the page
 * edge to force tiling and several pages.
 */
export const atlasPackLimits = (
  maxTextureSize: number,
  maxArrayLayers: number,
  maxSizeOverride: number = 0
): { maxSize: number; maxPages: number } => {
  let maxSize = Math.min(maxTextureSize || 2048, RAW_ASS_ATLAS_MAX_SIZE)
  if (maxSizeOverride > 0) maxSize = Math.max(16, Math.min(maxSize, maxSizeOverride))
  const maxPages = textureArrayLayerCap(maxSize, maxSize, 1, atlasLayerLimit(maxArrayLayers))
  return { maxSize, maxPages }
}

/** Array layers an R8 atlas texture may use on this device. */
export const atlasLayerLimit = (maxArrayLayers: number): number =>
  Math.min(maxArrayLayers || 256, RAW_ASS_ATLAS_MAX_PAGES)

export interface TextureExtent {
  width: number
  height: number
  layers: number
}

/**
 * Next allocation for a grow-only R8 array texture that must hold `needed`,
 * or null when `current` already does. Every dimension grows to the larger
 * of both (rounded like the other compositors) while that fits the texture
 * budget; otherwise the texture is sized for this frame only. Throws when
 * even that exceeds the budget. `maxDimension` caps the rounding at the
 * device's 2D texture limit.
 */
export const growAtlasTexture = (
  current: TextureExtent | null,
  needed: TextureExtent,
  layerLimit: number,
  maxDimension: number = Number.POSITIVE_INFINITY
): TextureExtent | null => {
  if (current && needed.width <= current.width && needed.height <= current.height && needed.layers <= current.layers) {
    return null
  }
  if (needed.width > maxDimension || needed.height > maxDimension || needed.layers > layerLimit) {
    throw new Error('Raw ASS atlas exceeds the GPU texture limits')
  }
  const round = (n: number): number => Math.min(roundTextureDim(n), maxDimension)
  let width = round(Math.max(needed.width, current?.width ?? 0))
  let height = round(Math.max(needed.height, current?.height ?? 0))
  let layers = Math.max(needed.layers, current?.layers ?? 0)
  if (textureArrayLayerCap(width, height, 1, layerLimit) < layers) {
    // Growing every dimension would exceed the budget: fit this frame only.
    width = round(needed.width)
    height = round(needed.height)
    layers = needed.layers
    if (textureArrayLayerCap(width, height, 1, layerLimit) < layers) {
      throw new Error('Raw ASS atlas exceeds the GPU texture budget')
    }
  }
  return { width, height, layers }
}

/** Grow-only byte capacity for the instance buffer. */
export const growInstanceCapacity = (current: number, neededBytes: number): number =>
  neededBytes <= current ? current : Math.max(neededBytes, current * 2, 64 * RAW_ASS_ATLAS_INSTANCE_BYTES)

/**
 * Throws a RangeError when a packed frame's pages or instance records lie
 * outside a heap view of `heapLength` bytes, e.g. one taken before WASM
 * memory grew. Renderers check this before any upload: WebGL2 turns an
 * out-of-range source offset into a GL error instead of an exception, so the
 * GPU copy would be marked current while it still held the previous frame.
 */
export const assertAtlasInHeap = (frame: RawASSAtlasFrame, heapLength: number): void => {
  if (frame.instanceCount <= 0) return
  const pixelsEnd = frame.bufferPtr + frame.pageWidth * frame.pageHeight * frame.pages
  const instancesEnd = frame.instancesPtr + frame.instanceCount * RAW_ASS_ATLAS_INSTANCE_BYTES
  if (pixelsEnd > heapLength || instancesEnd > heapLength) {
    throw new RangeError(`Raw ASS atlas ends at byte ${Math.max(pixelsEnd, instancesEnd)}, past the ${heapLength}-byte heap view`)
  }
}

/** Mask pixels covered by `count` packed instances (w * h summed). */
export const atlasInstancePixels = (instances: Int32Array, count: number): number => {
  let pixels = 0
  const end = Math.min(count * RAW_ASS_ATLAS_INSTANCE_INTS, instances.length)
  for (let i = 0; i < end; i += RAW_ASS_ATLAS_INSTANCE_INTS) {
    pixels += instances[i + 2] * instances[i + 3]
  }
  return pixels
}

/**
 * The float32 value of each channel byte as the per-image WebGL2 path
 * uploads it (`byte / 255` stored in a Float32Array). Atlas shaders look
 * channels up in this table instead of dividing on the GPU, whose division
 * may round differently, so every path feeds the blend identical values.
 */
export const rawAssByteUnitTable = (): Float32Array => {
  const table = new Float32Array(256)
  for (let i = 0; i < 256; i++) table[i] = i / 255
  return table
}

/**
 * Writes one ASS_AtlasInstance record for an image drawn from its own array
 * layer (atlas origin 0,0); the per-image fallback of the WebGPU renderer
 * reuses the atlas pipeline this way.
 */
export const writeLayerInstance = (
  out: Int32Array,
  index: number,
  dstX: number,
  dstY: number,
  w: number,
  h: number,
  layer: number,
  color: number
): void => {
  const off = index * RAW_ASS_ATLAS_INSTANCE_INTS
  out[off] = dstX
  out[off + 1] = dstY
  out[off + 2] = w
  out[off + 3] = h
  out[off + 4] = 0
  out[off + 5] = 0
  out[off + 6] = layer
  // Same bits as the uint32 color; Int32Array stores them unchanged.
  out[off + 7] = color | 0
}

const isSharedBuffer = (buffer: ArrayBufferLike): buffer is SharedArrayBuffer =>
  typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer

/**
 * Feeds WASM memory to GPUQueue.writeBuffer / writeTexture. The pthread
 * (-mt) build backs HEAPU8 with a SharedArrayBuffer, which the WebGPU spec
 * accepts (AllowSharedBufferSource) but some implementations reject with a
 * TypeError. The first rejected shared upload switches to copying through a
 * grow-only ArrayBuffer; plain ArrayBuffer memory is always passed directly.
 */
export class GPUUploadSource {
  /** Copy shared memory even where the browser accepts it (tests). */
  forceStaging = false
  private _sharedRejected = false
  private _staging: ArrayBuffer | null = null
  /** Uploads that went through the staging copy. */
  stagedUploads = 0
  /** Uploads passed straight from shared memory. */
  sharedUploads = 0

  get sharedRejected(): boolean {
    return this._sharedRejected
  }

  /**
   * Calls `write(data, offset)` with `length` bytes of `buffer` at `offset`,
   * either in place or from the staging copy (then at offset 0).
   */
  upload(
    buffer: ArrayBufferLike,
    offset: number,
    length: number,
    write: (data: ArrayBuffer | SharedArrayBuffer, offset: number) => void
  ): void {
    if (!isSharedBuffer(buffer)) {
      write(buffer as ArrayBuffer, offset)
      return
    }
    if (!this._sharedRejected && !this.forceStaging) {
      try {
        write(buffer, offset)
        this.sharedUploads++
        return
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
        this._sharedRejected = true
      }
    }
    if (!this._staging || this._staging.byteLength < length) {
      this._staging = new ArrayBuffer(Math.max(length, (this._staging?.byteLength ?? 0) * 2, 64 * 1024))
    }
    new Uint8Array(this._staging, 0, length).set(new Uint8Array(buffer, offset, length))
    this.stagedUploads++
    write(this._staging, 0)
  }
}
