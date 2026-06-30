/**
 * AkariSub Worker - TypeScript implementation.
 * Runs in a Web Worker to offload subtitle rendering from the main thread.
 */

/// <reference lib="webworker" />

// @ts-ignore - WASM module is aliased during build
import WASM from 'wasm'

import type {
  ASSEvent,
  ASSStyle,
  AkariSubModule,
  EncryptedSubtitleContent,
  RawASSImage,
  SubtitleColorSpace,
  WorkerInboundMessage
} from './types'
import { parseAss, dropBlur, fixPlayRes, libassYCbCrMap } from './utils'

// =============================================================================
// Worker State
// =============================================================================

interface WorkerMetrics {
  framesRendered: number
  framesDropped: number
  totalRenderTime: number
  maxRenderTime: number
  minRenderTime: number
  lastRenderTime: number
  renderStartTime: number
  pendingRenders: number
  totalEvents: number
  currentEventIndex: number
  cacheHits: number
  cacheMisses: number
  lastImageCount: number
  lastImagePixels: number
}

declare const self: DedicatedWorkerGlobalScope & {
  width: number
  height: number
  HEAPU8: Uint8Array
  HEAPU8C: Uint8ClampedArray
  wasmMemory: WebAssembly.Memory
  [key: string]: any
}

let lastCurrentTime = 0
let lastRenderedRequestTime = Number.NaN
let lastRenderedRequestWidth = 0
let lastRenderedRequestHeight = 0
let rate = 1
let rafId: number | null = null
let nextIsRaf = false
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
let lastCurrentTimeReceivedAt = nowMs()
let targetFps = 24
let onDemandRenderMode = false
let rawAssImageGpuEnabled = false
let useLocalFonts = false
let useFontconfigProvider = true
let blendMode: 'js' | 'wasm' = 'wasm'
let availableFonts: Record<string, string | Uint8Array> = {}
const fontMap_: Record<string, boolean> = {}
let attachedFontId = 0 // For attached/preloaded fonts (higher priority)
let fallbackFontId = 0 // For fallback fonts (lower priority)
const pendingFallbackFonts: { data: Uint8Array; name: string }[] = []
let debug = false
let clampPos = false
let renderInFlight = false
const MAX_QUEUED_RENDERS = 3
const queuedRenders: Array<{ time: number; force: 0 | 1 }> = []

self.width = 0
self.height = 0

// Performance metrics
const metrics: WorkerMetrics = {
  framesRendered: 0,
  framesDropped: 0,
  totalRenderTime: 0,
  maxRenderTime: 0,
  minRenderTime: Infinity,
  lastRenderTime: 0,
  renderStartTime: 0,
  pendingRenders: 0,
  totalEvents: 0,
  currentEventIndex: 0,
  cacheHits: 0,
  cacheMisses: 0,
  lastImageCount: 0,
  lastImagePixels: 0
}

const resetMetrics = (): void => {
  metrics.framesRendered = 0
  metrics.framesDropped = 0
  metrics.totalRenderTime = 0
  metrics.maxRenderTime = 0
  metrics.minRenderTime = Infinity
  metrics.lastRenderTime = 0
  metrics.lastImageCount = 0
  metrics.lastImagePixels = 0
  metrics.cacheHits = 0
  metrics.cacheMisses = 0
}

let asyncRender = false
let asyncRenderOptions = true
let offCanvas: OffscreenCanvas | null = null
let offCanvasCtx: OffscreenCanvasRenderingContext2D | null = null
let offscreenRender: boolean | 'hybrid' = false
let rawAssWebGL2Renderer: RawASSImageWebGL2Renderer | null = null
let bufferCanvas: OffscreenCanvas | null = null
let bufferCtx: OffscreenCanvasRenderingContext2D | null = null
let akariSubHandle = 0
let subtitleColorSpace: SubtitleColorSpace = null
let dropAllBlur = false
let fullTrackWarmupEnabled = false
let hasBitmapBug = false
let _Module: AkariSubModule | null = null
let forceNextDemandRender = false

const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()

interface AkariSubApi {
  create: (width: number, height: number, fallbackFontPtr: number, debug: number) => number
  destroy: (handle: number) => void
  setDropAnimations: (handle: number, value: number) => void
  setAdaptiveBlendLayouts: (handle: number, value: number) => void
  createTrackMem: (handle: number, contentPtr: number) => void
  removeTrack: (handle: number) => void
  resizeCanvas: (handle: number, width: number, height: number, videoWidth: number, videoHeight: number) => void
  addFont: (handle: number, namePtr: number, dataPtr: number, dataSize: number) => void
  reloadFonts: (handle: number) => void
  setDefaultFont: (handle: number, fontPtr: number) => void
  setFallbackFonts: (handle: number, fontsPtr: number) => void
  setUseFontconfigProvider: (handle: number, enabled: number) => void
  setMemoryLimits: (handle: number, glyphLimit: number, memoryLimit: number) => void
  getEventCount: (handle: number) => number
  allocEvent: (handle: number) => number
  removeEvent: (handle: number, index: number) => void
  getStyleCount: (handle: number) => number
  allocStyle: (handle: number) => number
  removeStyle: (handle: number, index: number) => void
  styleOverrideIndex: (handle: number, index: number) => void
  disableStyleOverride: (handle: number) => void
  getTrackColorSpace: (handle: number) => number
  eventGetInt: (handle: number, index: number, field: number) => number
  eventSetInt: (handle: number, index: number, field: number, value: number) => void
  eventGetStr: (handle: number, index: number, field: number) => number
  eventSetStr: (handle: number, index: number, field: number, valuePtr: number) => void
  styleGetNum: (handle: number, index: number, field: number) => number
  styleSetNum: (handle: number, index: number, field: number, value: number) => void
  styleGetStr: (handle: number, index: number, field: number) => number
  styleSetStr: (handle: number, index: number, field: number, valuePtr: number) => void
  getEventTimeRange: (handle: number, outPtr: number) => number
  getEmptyWindow: (handle: number, tm: number, outPtr: number) => number
  renderBlendCollect: (handle: number, time: number, force: number, outPtr: number, maxItems: number) => number
  renderImageCollect: (handle: number, time: number, force: number, outPtr: number, maxItems: number) => number
  renderRawCollect: (handle: number, time: number, force: number, outPtr: number, maxItems: number) => number
}

let akariSubApi: AkariSubApi | null = null

// Pre-allocated object pool for render results
const MAX_POOLED_IMAGES = 128
const RENDER_COLLECT_MAX_IMAGES = Math.max(MAX_POOLED_IMAGES, 4096)
const PREWARM_MAX_IMAGES = RENDER_COLLECT_MAX_IMAGES
const WARMUP_AHEAD_SECONDS = 30
const WARMUP_STEP_SECONDS = 0.5
const WARMUP_TICK_MS = 40
const ENABLE_RUNTIME_WARMUP = false
const FULL_WARMUP_CAP_SECONDS = 30
const FULL_WARMUP_STEP_SECONDS = 1
const FULL_WARMUP_YIELD_EVERY = 24
const ASS_TIME_SCALE = 1000
const imagePool: RenderResultItem[] = []
let poolInitialized = false
// Batch render-collect buffer: 3 header ints (changed, count, time) + metadata per image.
// RGBA paths use 5 ints per image (x, y, w, h, image_ptr); raw ASS_Image
// GPU path uses 8 ints (dst_x, dst_y, w, h, bitmap_ptr, color, stride, type).
const RRC_HEADER_INTS = 3
const RRC_IMG_STRIDE = 5
const RAW_RRC_IMG_STRIDE = 8
// Pre-allocated buffer for batch render-collect calls
let rrcBufPtr = 0
let rrcBufCapacity = 0
// Cached views over the render-collect buffer; refreshed when the wasm memory
// grows (buffer identity changes) or the buffer is reallocated/resized.
let rrcHeaderView: Int32Array | null = null
let rrcMetaView: Int32Array | null = null
let rrcViewsBuffer: ArrayBufferLike | null = null
let rrcViewsPtr = 0
let rrcViewsCapacity = 0
const frameImages: RenderResultItem[] = []
const frameRawAssImages: RawASSImage[] = []
const frameArrayBuffers: ArrayBuffer[] = []
const frameBitmapPromises: Promise<ImageBitmap>[] = []
let warmupTimer: ReturnType<typeof setTimeout> | null = null
let warmupCursorTime = 0
let warmupEndTime = 0
let warmupEnabled = false
let firstTrackEventStartTime: number | null = null
let fullTrackWarmupPromise: Promise<void> | null = null
let fullTrackWarmupStarted = false
let blockingFullTrackWarmup = false
let fullTrackWarmupStepSeconds = FULL_WARMUP_STEP_SECONDS
let protectedTrackContent = false

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface RenderResultItem {
  w: number
  h: number
  x: number
  y: number
  image: number | ImageBitmap | Uint8ClampedArray
}

const RAW_ASS_MAX_TEXTURE_ARRAY_LAYERS = 128
const RAW_ASS_INSTANCE_FLOATS = 12

const RAW_ASS_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec4 a_destRect;
in vec4 a_texInfo;
in vec4 a_color;

uniform vec2 u_resolution;

out vec2 v_destXY;
flat out int v_texIndex;
flat out vec2 v_texSize;
flat out vec4 v_color;

vec2 quadPos(int id) {
  if (id == 0) return vec2(0.0, 0.0);
  if (id == 1) return vec2(1.0, 0.0);
  if (id == 2) return vec2(0.0, 1.0);
  if (id == 3) return vec2(1.0, 0.0);
  if (id == 4) return vec2(1.0, 1.0);
  return vec2(0.0, 1.0);
}

void main() {
  vec2 qp = quadPos(gl_VertexID);
  vec2 pixelPos = a_destRect.xy + qp * a_destRect.zw;
  vec2 clip = (pixelPos / u_resolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_destXY = a_destRect.xy;
  v_texIndex = int(a_texInfo.z);
  v_texSize = a_destRect.zw;
  v_color = a_color;
}
`

const RAW_ASS_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray u_maskArray;
uniform vec2 u_resolution;

in vec2 v_destXY;
flat in int v_texIndex;
flat in vec2 v_texSize;
flat in vec4 v_color;

out vec4 fragColor;

void main() {
  vec2 fragPos = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  ivec2 texCoord = ivec2(floor(fragPos - v_destXY));
  ivec2 texSizeI = ivec2(v_texSize);
  if (texCoord.x < 0 || texCoord.y < 0 || texCoord.x >= texSizeI.x || texCoord.y >= texSizeI.y) {
    discard;
  }
  float coverage = texelFetch(u_maskArray, ivec3(texCoord, v_texIndex), 0).r;
  float alpha = coverage * v_color.a;
  fragColor = vec4(v_color.rgb * alpha, alpha);
}
`

function compileRawAssShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Failed to create WebGL2 shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Raw ASS WebGL2 shader compilation failed: ${info}`)
  }
  return shader
}

class RawASSImageWebGL2Renderer {
  private _canvas: OffscreenCanvas | null = null
  private _gl: WebGL2RenderingContext | null = null
  private _program: WebGLProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _instanceBuffer: WebGLBuffer | null = null
  private _maskArray: WebGLTexture | null = null
  private _resolutionLoc: WebGLUniformLocation | null = null
  private _texWidth = 0
  private _texHeight = 0
  private _texLayers = 0
  private _lastWidth = 0
  private _lastHeight = 0
  private readonly _instanceData = new Float32Array(RAW_ASS_MAX_TEXTURE_ARRAY_LAYERS * RAW_ASS_INSTANCE_FLOATS)
  private _maskScratch = new Uint8Array(0)

  init(canvas: OffscreenCanvas, width: number, height: number): boolean {
    this._canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
      stencil: false,
      desynchronized: true,
      powerPreference: 'high-performance'
    }) as WebGL2RenderingContext | null
    if (!gl) return false
    this._gl = gl

    const vert = compileRawAssShader(gl, gl.VERTEX_SHADER, RAW_ASS_VERTEX_SHADER)
    const frag = compileRawAssShader(gl, gl.FRAGMENT_SHADER, RAW_ASS_FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!program) throw new Error('Failed to create WebGL2 program')
    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    gl.deleteShader(vert)
    gl.deleteShader(frag)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Raw ASS WebGL2 program link failed: ${gl.getProgramInfoLog(program)}`)
    }
    this._program = program
    this._resolutionLoc = gl.getUniformLocation(program, 'u_resolution')

    this._vao = gl.createVertexArray()
    this._instanceBuffer = gl.createBuffer()
    if (!this._vao || !this._instanceBuffer) throw new Error('Failed to create WebGL2 buffers')
    gl.bindVertexArray(this._vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, this._instanceData.byteLength, gl.DYNAMIC_DRAW)

    const stride = RAW_ASS_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT
    const aDestRect = gl.getAttribLocation(program, 'a_destRect')
    gl.enableVertexAttribArray(aDestRect)
    gl.vertexAttribPointer(aDestRect, 4, gl.FLOAT, false, stride, 0)
    gl.vertexAttribDivisor(aDestRect, 1)

    const aTexInfo = gl.getAttribLocation(program, 'a_texInfo')
    gl.enableVertexAttribArray(aTexInfo)
    gl.vertexAttribPointer(aTexInfo, 4, gl.FLOAT, false, stride, 4 * Float32Array.BYTES_PER_ELEMENT)
    gl.vertexAttribDivisor(aTexInfo, 1)

    const aColor = gl.getAttribLocation(program, 'a_color')
    gl.enableVertexAttribArray(aColor)
    gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, stride, 8 * Float32Array.BYTES_PER_ELEMENT)
    gl.vertexAttribDivisor(aColor, 1)
    gl.bindVertexArray(null)

    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    this._allocateTextureArray(256, 256, RAW_ASS_MAX_TEXTURE_ARRAY_LAYERS)
    this.updateSize(width, height)
    return true
  }

  private _roundDim(n: number): number {
    return (Math.max(n, 64) + 63) & ~63
  }

  private _roundLayers(n: number): number {
    return Math.min((Math.max(n, 8) + 7) & ~7, RAW_ASS_MAX_TEXTURE_ARRAY_LAYERS)
  }

  private _allocateTextureArray(width: number, height: number, layers: number): void {
    const gl = this._gl!
    const w = this._roundDim(width)
    const h = this._roundDim(height)
    const l = this._roundLayers(layers)
    if (this._maskArray) gl.deleteTexture(this._maskArray)
    this._maskArray = gl.createTexture()
    if (!this._maskArray) throw new Error('Failed to create WebGL2 mask texture array')
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._maskArray)
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, w, h, l, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this._texWidth = w
    this._texHeight = h
    this._texLayers = l
  }

  private _ensureTextureArray(maxW: number, maxH: number, count: number): void {
    const c = Math.min(count, RAW_ASS_MAX_TEXTURE_ARRAY_LAYERS)
    if (maxW <= this._texWidth && maxH <= this._texHeight && c <= this._texLayers) return
    this._allocateTextureArray(
      Math.max(this._texWidth, maxW),
      Math.max(this._texHeight, maxH),
      Math.max(this._texLayers, c)
    )
  }

  updateSize(width: number, height: number): void {
    if (!this._gl || !this._canvas || width <= 0 || height <= 0) return
    if (this._lastWidth === width && this._lastHeight === height) return
    this._canvas.width = width
    this._canvas.height = height
    this._gl.viewport(0, 0, width, height)
    this._lastWidth = width
    this._lastHeight = height
  }

  private _uploadMaskRegion(w: number, h: number, stride: number, ptr: number, layer: number, heap: Uint8Array): void {
    const gl = this._gl!
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, stride > 0 ? stride : w)
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, w, h, 1, gl.RED, gl.UNSIGNED_BYTE, heap, ptr)
  }

  private _uploadMask(img: RawASSImage, layer: number, heap: Uint8Array): void {
    this._uploadMaskRegion(img.w, img.h, img.stride, img.bitmap, layer, heap)
  }

  renderRawAssImages(images: RawASSImage[], heap: Uint8Array, width: number, height: number): void {
    if (!this._gl || !this._program || !this._maskArray || !this._instanceBuffer || !this._vao) return
    this.updateSize(width, height)
    let maxW = 0
    let maxH = 0
    for (const img of images) {
      if (img.w > maxW) maxW = img.w
      if (img.h > maxH) maxH = img.h
    }
    this._ensureTextureArray(maxW, maxH, Math.min(images.length, RAW_ASS_MAX_TEXTURE_ARRAY_LAYERS))

    const gl = this._gl
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!images.length) return
    gl.useProgram(this._program)
    gl.uniform2f(this._resolutionLoc, width, height)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._maskArray)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    let imageIndex = 0
    while (imageIndex < images.length) {
      let count = 0
      while (imageIndex < images.length && count < RAW_ASS_MAX_TEXTURE_ARRAY_LAYERS) {
        const img = images[imageIndex++]
        if (img.w <= 0 || img.h <= 0 || img.bitmap <= 0) continue
        const color = img.color >>> 0
        const opacity = (255 - (color & 0xff)) / 255
        if (opacity <= 0) continue
        this._uploadMask(img, count, heap)
        const off = count * RAW_ASS_INSTANCE_FLOATS
        this._instanceData[off] = img.dst_x
        this._instanceData[off + 1] = img.dst_y
        this._instanceData[off + 2] = img.w
        this._instanceData[off + 3] = img.h
        this._instanceData[off + 4] = img.w
        this._instanceData[off + 5] = img.h
        this._instanceData[off + 6] = count
        this._instanceData[off + 7] = 0
        this._instanceData[off + 8] = ((color >>> 24) & 0xff) / 255
        this._instanceData[off + 9] = ((color >>> 16) & 0xff) / 255
        this._instanceData[off + 10] = ((color >>> 8) & 0xff) / 255
        this._instanceData[off + 11] = opacity
        count++
      }
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0)
      if (count === 0) continue
      gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, this._instanceData.subarray(0, count * RAW_ASS_INSTANCE_FLOATS), gl.DYNAMIC_DRAW)
      gl.bindVertexArray(this._vao)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count)
      gl.bindVertexArray(null)
    }
  }

  renderRawAssMetadata(meta: Int32Array, imageCount: number, heap: Uint8Array, width: number, height: number): number {
    if (!this._gl || !this._program || !this._maskArray || !this._instanceBuffer || !this._vao) return 0
    this.updateSize(width, height)

    let maxW = 0
    let maxH = 0
    let validImages = 0
    for (let i = 0; i < imageCount; i++) {
      const off = i * RAW_RRC_IMG_STRIDE
      const w = meta[off + 2]
      const h = meta[off + 3]
      const ptr = meta[off + 4]
      if (w <= 0 || h <= 0 || ptr <= 0) continue
      const color = meta[off + 5] >>> 0
      if (255 - (color & 0xff) <= 0) continue
      if (w > maxW) maxW = w
      if (h > maxH) maxH = h
      validImages++
    }

    this._ensureTextureArray(maxW, maxH, Math.min(validImages, RAW_ASS_MAX_TEXTURE_ARRAY_LAYERS))

    const gl = this._gl
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (validImages === 0) return 0

    gl.useProgram(this._program)
    gl.uniform2f(this._resolutionLoc, width, height)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._maskArray)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    let imageIndex = 0
    let pixels = 0
    while (imageIndex < imageCount) {
      let count = 0
      while (imageIndex < imageCount && count < RAW_ASS_MAX_TEXTURE_ARRAY_LAYERS) {
        const metaOffset = imageIndex++ * RAW_RRC_IMG_STRIDE
        const w = meta[metaOffset + 2]
        const h = meta[metaOffset + 3]
        const ptr = meta[metaOffset + 4]
        if (w <= 0 || h <= 0 || ptr <= 0) continue
        const color = meta[metaOffset + 5] >>> 0
        const opacity = (255 - (color & 0xff)) / 255
        if (opacity <= 0) continue

        const stride = meta[metaOffset + 6]
        this._uploadMaskRegion(w, h, stride, ptr, count, heap)

        const off = count * RAW_ASS_INSTANCE_FLOATS
        this._instanceData[off] = meta[metaOffset]
        this._instanceData[off + 1] = meta[metaOffset + 1]
        this._instanceData[off + 2] = w
        this._instanceData[off + 3] = h
        this._instanceData[off + 4] = w
        this._instanceData[off + 5] = h
        this._instanceData[off + 6] = count
        this._instanceData[off + 7] = 0
        this._instanceData[off + 8] = ((color >>> 24) & 0xff) / 255
        this._instanceData[off + 9] = ((color >>> 16) & 0xff) / 255
        this._instanceData[off + 10] = ((color >>> 8) & 0xff) / 255
        this._instanceData[off + 11] = opacity
        pixels += w * h
        count++
      }
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0)
      if (count === 0) continue
      gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, this._instanceData.subarray(0, count * RAW_ASS_INSTANCE_FLOATS), gl.DYNAMIC_DRAW)
      gl.bindVertexArray(this._vao)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count)
      gl.bindVertexArray(null)
    }

    return pixels
  }

  destroy(): void {
    const gl = this._gl
    if (gl) {
      gl.deleteProgram(this._program)
      gl.deleteVertexArray(this._vao)
      gl.deleteBuffer(this._instanceBuffer)
      gl.deleteTexture(this._maskArray)
    }
    this._canvas = null
    this._gl = null
    this._program = null
    this._vao = null
    this._instanceBuffer = null
    this._maskArray = null
  }
}

const initPool = (): void => {
  if (poolInitialized) return
  for (let i = 0; i < MAX_POOLED_IMAGES; i++) {
    imagePool[i] = { w: 0, h: 0, x: 0, y: 0, image: 0 }
  }
  poolInitialized = true
}

const getPooledItem = (index: number): RenderResultItem => {
  let item = imagePool[index]
  if (!item) {
    // Grow the pool on demand so frames with many images reuse items too
    item = { w: 0, h: 0, x: 0, y: 0, image: 0 }
    imagePool[index] = item
  }
  return item
}

/**
 * Ensure the batch render-collect buffer is large enough.
 * Layout: [changed, count, time, (x, y, w, h, image_ptr) * N]
 * = 3 + 5*N ints
 */
const ensureRenderCollectBuffer = (maxImages: number, imageStride: number = RRC_IMG_STRIDE): void => {
  if (!_Module || maxImages <= 0) return
  const totalInts = RRC_HEADER_INTS + imageStride * maxImages
  if (rrcBufCapacity >= totalInts && rrcBufPtr) return

  const nextCapacity = Math.max(totalInts, (rrcBufCapacity || 64) * 2)
  const nextSizeBytes = nextCapacity * Int32Array.BYTES_PER_ELEMENT

  if (rrcBufPtr) {
    _Module._free(rrcBufPtr)
    rrcBufPtr = 0
    rrcBufCapacity = 0
  }

  rrcBufPtr = _Module._malloc(nextSizeBytes)
  if (!rrcBufPtr) {
    rrcBufCapacity = 0
    throw new Error('Failed to allocate render-collect buffer')
  }

  rrcBufCapacity = nextCapacity
}

const refreshRrcViews = (): void => {
  const buffer = self.wasmMemory.buffer
  if (rrcHeaderView && rrcViewsBuffer === buffer && rrcViewsPtr === rrcBufPtr && rrcViewsCapacity === rrcBufCapacity) {
    return
  }
  rrcHeaderView = new Int32Array(buffer, rrcBufPtr, RRC_HEADER_INTS)
  rrcMetaView = new Int32Array(
    buffer,
    rrcBufPtr + RRC_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT,
    rrcBufCapacity - RRC_HEADER_INTS
  )
  rrcViewsBuffer = buffer
  rrcViewsPtr = rrcBufPtr
  rrcViewsCapacity = rrcBufCapacity
}

const prewarmRenderer = (time: number): void => {
  if (!akariSubHandle) return

  const api = requireApi()
  const handle = requireHandle()
  ensureRenderCollectBuffer(PREWARM_MAX_IMAGES)

  if (blendMode === 'wasm') {
    api.renderBlendCollect(handle, time, 0, rrcBufPtr, rrcBufCapacity)
  } else {
    api.renderImageCollect(handle, time, 0, rrcBufPtr, rrcBufCapacity)
  }
}

const syncTotalEventsMetric = (): void => {
  metrics.totalEvents = akariSubHandle ? requireApi().getEventCount(akariSubHandle) : 0
}

const getTrackEventTimeRange = (): { start: number; end: number } | null => {
  if (!akariSubHandle || !_Module) return null

  const api = requireApi()
  const handle = requireHandle()
  const outPtr = _Module._malloc(2 * Int32Array.BYTES_PER_ELEMENT)
  if (!outPtr) return null

  try {
    if (!api.getEventTimeRange(handle, outPtr)) return null

    const view = new Int32Array(self.wasmMemory.buffer, outPtr, 2)
    const start = Math.max(0, view[0] / ASS_TIME_SCALE)
    const end = Math.max(start, view[1] / ASS_TIME_SCALE)
    return { start, end }
  } finally {
    _Module._free(outPtr)
  }
}

const getFirstEventStartTime = (): number | null => {
  return getTrackEventTimeRange()?.start ?? null
}

let emptyWindowFrom = -1
let emptyWindowUntil = -1

const invalidateEmptyWindow = (): void => {
  emptyWindowFrom = -1
  emptyWindowUntil = -1
  lastRenderedRequestTime = Number.NaN
}

const computeEmptyWindow = (time: number): void => {
  if (!akariSubHandle || !_Module) return

  const outPtr = _Module._malloc(Int32Array.BYTES_PER_ELEMENT)
  if (!outPtr) return

  try {
    if (!requireApi().getEmptyWindow(requireHandle(), time, outPtr)) return

    const nextStart = new Int32Array(self.wasmMemory.buffer, outPtr, 1)[0]
    emptyWindowFrom = time
    emptyWindowUntil = nextStart < 0 ? Number.POSITIVE_INFINITY : nextStart / ASS_TIME_SCALE
  } finally {
    _Module._free(outPtr)
  }
}

const prewarmEntireTrack = async (): Promise<void> => {
  if (!akariSubHandle) return

  const range = getTrackEventTimeRange()
  if (!range) return

  const cappedEnd = Math.min(range.end, range.start + FULL_WARMUP_CAP_SECONDS)

  let ticks = 0

  for (let time = range.start; time <= cappedEnd; time += fullTrackWarmupStepSeconds) {
    if (!akariSubHandle) return

    if (onDemandRenderMode && (renderInFlight || queuedRenders.length > 0 || metrics.pendingRenders > 0)) {
      await sleep(0)
      continue
    }

    prewarmRenderer(time)
    ticks++

    if (onDemandRenderMode || ticks % FULL_WARMUP_YIELD_EVERY === 0) {
      await sleep(0)
    }
  }

  prewarmRenderer(cappedEnd)
}

const getWarmupAnchorTime = (fallbackTime: number): number => {
  if (firstTrackEventStartTime == null) return fallbackTime
  if (fallbackTime < firstTrackEventStartTime) return firstTrackEventStartTime
  return fallbackTime
}

const stopWarmup = (): void => {
  warmupEnabled = false
  if (warmupTimer) {
    clearTimeout(warmupTimer)
    warmupTimer = null
  }
}

const scheduleFullTrackWarmup = (): void => {
  if (!fullTrackWarmupEnabled || fullTrackWarmupStarted || fullTrackWarmupPromise || !akariSubHandle) return
  fullTrackWarmupStarted = true

  fullTrackWarmupPromise = (async () => {
    await sleep(0)

    try {
      await prewarmEntireTrack()
    } catch (e) {
      if (debug) console.warn('[AkariSub] Full track warmup failed, continuing:', e)
    }

    try {
      if (akariSubHandle) {
        prewarmRenderer(getCurrentTime())
      }
    } catch (e) {
      if (debug) console.warn('[AkariSub] Post-warmup re-prime failed, continuing:', e)
    }
  })().finally(() => {
    fullTrackWarmupPromise = null
  })
}

const scheduleWarmupTick = (): void => {
  if (!warmupEnabled || warmupTimer) return
  warmupTimer = setTimeout(runWarmupTick, WARMUP_TICK_MS)
}

const startWarmupWindow = (fromTime: number): void => {
  if (!ENABLE_RUNTIME_WARMUP) return
  if (!akariSubHandle || !Number.isFinite(fromTime)) return
  warmupCursorTime = fromTime
  warmupEndTime = fromTime + WARMUP_AHEAD_SECONDS
  warmupEnabled = true
  scheduleWarmupTick()
}

const runWarmupTick = (): void => {
  warmupTimer = null

  if (!warmupEnabled || !akariSubHandle) {
    warmupEnabled = false
    return
  }

  if (warmupCursorTime >= warmupEndTime) {
    warmupEnabled = false
    return
  }

  if (renderInFlight || queuedRenders.length > 0 || metrics.pendingRenders > 0) {
    scheduleWarmupTick()
    return
  }

  try {
    const now = getCurrentTime()
    if (warmupCursorTime < now) {
      warmupCursorTime = now
    }

    prewarmRenderer(warmupCursorTime)
    warmupCursorTime += WARMUP_STEP_SECONDS
  } catch (e) {
    if (debug) console.warn('[AkariSub] Warmup tick failed, continuing:', e)
    warmupCursorTime += WARMUP_STEP_SECONDS
  }

  scheduleWarmupTick()
}

const EVENT_INT_FIELDS: Record<string, number> = {
  Start: 0,
  Duration: 1,
  ReadOrder: 2,
  Layer: 3,
  Style: 4,
  MarginL: 5,
  MarginR: 6,
  MarginV: 7
}

const EVENT_STR_FIELDS: Record<string, number> = {
  Name: 0,
  Effect: 1,
  Text: 2
}

const STYLE_NUM_FIELDS: Record<string, number> = {
  FontSize: 0,
  PrimaryColour: 1,
  SecondaryColour: 2,
  OutlineColour: 3,
  BackColour: 4,
  Bold: 5,
  Italic: 6,
  Underline: 7,
  StrikeOut: 8,
  ScaleX: 9,
  ScaleY: 10,
  Spacing: 11,
  Angle: 12,
  BorderStyle: 13,
  Outline: 14,
  Shadow: 15,
  Alignment: 16,
  MarginL: 17,
  MarginR: 18,
  MarginV: 19,
  Encoding: 20,
  treat_fontname_as_pattern: 21,
  Blur: 22,
  Justify: 23
}

const STYLE_STR_FIELDS: Record<string, number> = {
  Name: 0,
  FontName: 1
}

const encodeString = (input: string): Uint8Array => {
  return TEXT_ENCODER.encode(input)
}

const allocString = (input: string): number => {
  if (!_Module) return 0
  const bytes = encodeString(input)
  const ptr = _Module._malloc(bytes.length + 1)
  if (!ptr) return 0
  self.HEAPU8.set(bytes, ptr)
  self.HEAPU8[ptr + bytes.length] = 0
  return ptr
}

const readCString = (ptr: number): string => {
  if (!ptr) return ''
  let end = ptr
  const heap = self.HEAPU8
  while (heap[end] !== 0) end++
  return TEXT_DECODER.decode(heap.subarray(ptr, end))
}

const withCString = <T>(input: string, callback: (ptr: number) => T): T => {
  const ptr = allocString(input)
  try {
    return callback(ptr)
  } finally {
    if (ptr && _Module) _Module._free(ptr)
  }
}

const toUint8Array = (content: Uint8Array | ArrayBuffer): Uint8Array => {
  return content instanceof Uint8Array ? content : new Uint8Array(content)
}

const isBinaryContent = (content: string | Uint8Array | ArrayBuffer): content is Uint8Array | ArrayBuffer => {
  return content instanceof Uint8Array || content instanceof ArrayBuffer
}

const withCBytes = <T>(input: Uint8Array, callback: (ptr: number) => T): T => {
  if (!_Module) throw new Error('AkariSub module is not initialized')

  const ptr = _Module._malloc(input.length + 1)
  if (!ptr) throw new Error('Failed to allocate subtitle content')

  try {
    self.HEAPU8.set(input, ptr)
    self.HEAPU8[ptr + input.length] = 0
    return callback(ptr)
  } finally {
    self.HEAPU8.fill(0, ptr, ptr + input.length + 1)
    _Module._free(ptr)
  }
}

const decryptV2Payload = async (encrypted: ArrayBuffer, contentKey: CryptoKey): Promise<Uint8Array> => {
  const data = new Uint8Array(encrypted)
  const keyIdSize = 8
  const nonceSize = 12
  const headerSize = 1 + keyIdSize + nonceSize

  if (data.length < headerSize + 16) {
    throw new Error('Ciphertext too short for v2 subtitle payload')
  }

  if (data[0] !== 2) {
    throw new Error('Unsupported encrypted subtitle protocol version')
  }

  const header = data.subarray(0, 1 + keyIdSize)
  const nonce = data.subarray(1 + keyIdSize, headerSize)
  const ciphertext = data.subarray(headerSize)
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce.buffer.slice(nonce.byteOffset, nonce.byteOffset + nonce.byteLength),
      additionalData: header.buffer.slice(header.byteOffset, header.byteOffset + header.byteLength),
      tagLength: 128
    },
    contentKey,
    ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength)
  )

  return new Uint8Array(decrypted)
}

const decryptSubtitleContent = async (content: EncryptedSubtitleContent): Promise<Uint8Array> => {
  if (content.encrypted) {
    return decryptV2Payload(content.encrypted, content.contentKey)
  }

  const chunks = content.encryptedChunks || []
  if (chunks.length === 0) {
    throw new Error('Encrypted subtitle content is empty')
  }

  const decryptedChunks = await Promise.all(chunks.map((chunk) => decryptV2Payload(chunk, content.contentKey)))
  const totalLength = decryptedChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of decryptedChunks) {
    result.set(chunk, offset)
    chunk.fill(0)
    offset += chunk.length
  }

  return result
}

const createTrackFromBytes = (content: Uint8Array): void => {
  const api = requireApi()
  const handle = requireHandle()
  withCBytes(content, (contentPtr) => {
    api.createTrackMem(handle, contentPtr)
  })
}

const createTrackFromString = (content: string): void => {
  const api = requireApi()
  const handle = requireHandle()
  withCString(content, (contentPtr) => {
    api.createTrackMem(handle, contentPtr)
  })
}

const requireApi = (): AkariSubApi => {
  if (!akariSubApi) throw new Error('AkariSub API is not initialized')
  return akariSubApi
}

const requireHandle = (): number => {
  if (!akariSubHandle) throw new Error('AkariSub instance is not initialized')
  return akariSubHandle
}

// =============================================================================
// Font Management
// =============================================================================

// Fonts added via addFont are explicitly requested, so they should be attached (high priority)
self.addFont = ({ font }: { font: string | Uint8Array }) => asyncWrite(font, false)

const findAvailableFonts = (font: string): void => {
  font = font.trim().toLowerCase()
  if (font.startsWith('@')) font = font.substring(1)
  if (fontMap_[font]) return

  fontMap_[font] = true

  if (!availableFonts[font]) {
    if (useLocalFonts) postMessage({ target: 'getLocalFont', font })
  } else {
    asyncWrite(availableFonts[font])
  }
}

const asyncWrite = (font: string | Uint8Array, isFallback: boolean = true): void => {
  if (typeof font === 'string') {
    readAsync(
      font,
      (fontData) => {
        writeFontToFS(new Uint8Array(fontData), isFallback)
      },
      console.error
    )
  } else {
    writeFontToFS(font, isFallback)
  }
}

// Synchronous font loading for critical fonts (fallback fonts)
const syncWrite = (font: string | Uint8Array, isFallback: boolean = true): void => {
  if (typeof font === 'string') {
    const fontData = read_(font, true) as ArrayBuffer
    if (fontData) {
      writeFontToFSImmediate(new Uint8Array(fontData), isFallback)
    }
  } else {
    writeFontToFSImmediate(font, isFallback)
  }
}

// Debounced font reload
let pendingFontReload: ReturnType<typeof setTimeout> | null = null
const scheduleReloadFonts = (): void => {
  if (pendingFontReload) return
  pendingFontReload = setTimeout(() => {
    pendingFontReload = null
    if (akariSubHandle) {
      const api = requireApi()
      api.reloadFonts(akariSubHandle)
    }
  }, 16)
}

/**
 * Add a font as an embedded font via ass_add_font.
 * Embedded fonts have higher priority than fontconfig fonts in libass.
 */
const addFontAsEmbedded = (uint8: Uint8Array, name: string): void => {
  if (!_Module || !akariSubHandle) {
    if (debug) console.warn('[AkariSub] Cannot add embedded font, module or AkariSub not ready:', name)
    return
  }

  try {
    const api = requireApi()
    // Allocate memory in WASM heap and copy font data
    const ptr = _Module._malloc(uint8.length)
    if (!ptr) {
      console.warn('[AkariSub] Failed to allocate memory for embedded font:', name)
      return
    }

    // Copy font data to WASM heap
    self.HEAPU8.set(uint8, ptr)

    withCString(name, (namePtr) => {
      api.addFont(akariSubHandle, namePtr, ptr, uint8.length)
    })

    if (debug) console.log('[AkariSub] Added embedded font:', name, 'size:', uint8.length)
  } catch (e) {
    console.warn('[AkariSub] Failed to add embedded font:', name, e)
  }
}

/**
 * Write a font to the virtual filesystem so fontconfig can index it.
 * Fonts are written to separate directories based on priority:
 * - /fonts/attached: For attached/preloaded fonts (highest priority)
 * - /fonts/fallback: For fallback fonts
 */
const writeFontToFS = (uint8: Uint8Array, isFallback: boolean = true): void => {
  const fontDir = isFallback ? '/fonts/fallback' : '/fonts/attached'
  const fontFileName = isFallback ? 'fallback-' + fallbackFontId++ : 'attached-' + attachedFontId++

  if (_Module) {
    try {
      _Module.FS_createDataFile(fontDir, fontFileName, uint8, true, true, true)
    } catch (e) {
      console.warn('Failed to write font to filesystem:', fontDir + '/' + fontFileName, e)
    }

    if (!isFallback) {
      addFontAsEmbedded(uint8, fontFileName)
    } else if (akariSubHandle) {
      addFontAsEmbedded(uint8, fontFileName)
    } else {
      pendingFallbackFonts.push({ data: uint8, name: fontFileName })
    }
  }
  scheduleReloadFonts()
}

/**
 * Immediate font write without debounced reload (for synchronous loading).
 */
const writeFontToFSImmediate = (uint8: Uint8Array, isFallback: boolean = true): void => {
  const fontDir = isFallback ? '/fonts/fallback' : '/fonts/attached'
  const fontFileName = isFallback ? 'fallback-' + fallbackFontId++ : 'attached-' + attachedFontId++

  if (_Module) {
    try {
      _Module.FS_createDataFile(fontDir, fontFileName, uint8, true, true, true)
      if (debug) console.log('[AkariSub] Wrote font to FS:', fontDir + '/' + fontFileName, 'size:', uint8.length)
    } catch (e) {
      console.warn('Failed to write font to filesystem:', fontDir + '/' + fontFileName, e)
    }

    if (!isFallback) {
      addFontAsEmbedded(uint8, fontFileName)
    } else if (akariSubHandle) {
      addFontAsEmbedded(uint8, fontFileName)
    } else {
      pendingFallbackFonts.push({ data: uint8, name: fontFileName })
    }
  }
}

const processAvailableFonts = (content: string): void => {
  if (!availableFonts) return
  const isLargeFile = content.length > 500000

  if (isLargeFile) {
    // Extract only the styles section for large files
    const stylesMatch = content.match(/\[V4\+?\s*Styles?\][^\[]*(?=\[|$)/i)
    if (stylesMatch) {
      const stylesSection = stylesMatch[0]
      // Parse only the styles section
      const styleFontMatches = stylesSection.matchAll(/^Style:[^,]*,([^,]+)/gm)
      for (const match of styleFontMatches) {
        findAvailableFonts(match[1].trim())
      }
    }

    // For Events section in large files, limit to first 1000 \fn tags
    const eventsMatch = content.match(/\[Events\][\s\S]*/i)
    if (eventsMatch) {
      const eventsContent = eventsMatch[0]
      const fnMatches = eventsContent.matchAll(/\\fn([^\\}]*?)[\\}]/g)
      let count = 0
      for (const match of fnMatches) {
        findAvailableFonts(match[1])
        if (++count >= 1000) break
      }
    }
  } else {
    // Original behavior for small files
    const sections = parseAss(content, true)

    for (let i = 0; i < sections.length; i++) {
      for (let j = 0; j < sections[i].body.length; j++) {
        const entry = sections[i].body[j]
        if (entry.key === 'Style' && typeof entry.value === 'object' && !Array.isArray(entry.value)) {
          findAvailableFonts((entry.value as Record<string, string>).Fontname)
        }
      }
    }

    // Use matchAll for Events section
    const eventsMatch = content.match(/\[Events\][\s\S]*/i)
    if (eventsMatch) {
      const eventsContent = eventsMatch[0]
      const fnMatches = eventsContent.matchAll(/\\fn([^\\}]*?)[\\}]/g)
      for (const match of fnMatches) {
        findAvailableFonts(match[1])
      }
    }
  }
}

// =============================================================================
// Network Utilities
// =============================================================================

const read_ = (url: string, ab?: boolean): string | ArrayBuffer => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, false)
  xhr.responseType = ab ? 'arraybuffer' : 'text'
  xhr.send(null)
  return xhr.response
}

const readAsync = (url: string, load: (data: ArrayBuffer) => void, err: (e: any) => void): void => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, true)
  xhr.responseType = 'arraybuffer'
  xhr.onload = () => {
    if ((xhr.status === 200 || xhr.status === 0) && xhr.response) {
      return load(xhr.response)
    }
  }
  xhr.onerror = err
  xhr.send(null)
}

// =============================================================================
// Track Management
// =============================================================================

const finishTrackLoad = (): void => {
  const api = requireApi()
  const handle = requireHandle()
  syncTotalEventsMetric()
  firstTrackEventStartTime = getFirstEventStartTime()
  subtitleColorSpace = libassYCbCrMap[api.getTrackColorSpace(handle)]
  forceNextDemandRender = true
  postMessage({ target: 'verifyColorSpace', subtitleColorSpace })
  postMessage({ target: 'trackReady' })
}

self.setTrack = ({ content }: { content: string | Uint8Array | ArrayBuffer }): void => {
  stopWarmup()
  fullTrackWarmupPromise = null
  fullTrackWarmupStarted = false
  protectedTrackContent = false

  if (isBinaryContent(content)) {
    createTrackFromBytes(toUint8Array(content))
    finishTrackLoad()
    return
  }

  processAvailableFonts(content)

  if (clampPos) content = fixPlayRes(content)
  if (dropAllBlur) content = dropBlur(content)

  createTrackFromString(content)
  finishTrackLoad()
}

self.setEncryptedTrack = async ({ content }: { content: EncryptedSubtitleContent }): Promise<void> => {
  stopWarmup()
  fullTrackWarmupPromise = null
  fullTrackWarmupStarted = false
  protectedTrackContent = true

  const decrypted = await decryptSubtitleContent(content)
  try {
    createTrackFromBytes(decrypted)
  } finally {
    decrypted.fill(0)
  }
  finishTrackLoad()
}

self.getColorSpace = (): void => {
  postMessage({ target: 'verifyColorSpace', subtitleColorSpace })
}

self.freeTrack = (): void => {
  stopWarmup()
  fullTrackWarmupPromise = null
  firstTrackEventStartTime = null
  protectedTrackContent = false
  const api = requireApi()
  const handle = requireHandle()
  api.removeTrack(handle)
  syncTotalEventsMetric()
}

self.setTrackByUrl = ({ url }: { url: string }): void => {
  self.setTrack({ content: read_(url) as string })
}

// =============================================================================
// Time Management
// =============================================================================

let _isPaused = true

const getCurrentTime = (): number => {
  const diff = (nowMs() - lastCurrentTimeReceivedAt) / 1000
  if (_isPaused) {
    return lastCurrentTime
  } else {
    if (diff > 5) {
      console.error("Didn't receive currentTime > 5 seconds. Assuming video was paused.")
      setIsPaused(true)
    }
    return lastCurrentTime + diff * rate
  }
}

const setCurrentTime = (currentTime: number): void => {
  lastCurrentTime = currentTime
  lastCurrentTimeReceivedAt = nowMs()

  if (onDemandRenderMode) {
    return
  }

  if (!rafId) {
    if (_isPaused) {
      renderLoop()
      return
    }

    if (nextIsRaf) {
      rafId = requestAnimationFrame(renderLoop)
    } else {
      renderLoop()
      nextIsRaf = true
      setTimeout(() => {
        nextIsRaf = false
      }, 20)
    }
  }
}

const setIsPaused = (isPaused: boolean): void => {
  if (onDemandRenderMode) {
    _isPaused = isPaused
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    return
  }

  if (isPaused !== _isPaused) {
    _isPaused = isPaused
    if (isPaused) {
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    } else {
      lastCurrentTimeReceivedAt = nowMs()
      rafId = requestAnimationFrame(renderLoop)
    }
  }
}

// =============================================================================
// Rendering
// =============================================================================

interface RenderTimes {
  WASMRenderTime?: number
  WASMBitmapDecodeTime?: number
  JSRenderTime?: number
  JSBitmapGenerationTime?: number
  bitmaps?: number
}

const flushQueuedRender = (): void => {
  if (renderInFlight || queuedRenders.length === 0) return

  if (queuedRenders.length > 1) {
    const dropped = queuedRenders.length - 1
    metrics.framesDropped += dropped
    const latest = queuedRenders[queuedRenders.length - 1]
    queuedRenders.length = 0
    queuedRenders.push(latest)
  }

  const next = queuedRenders.shift()
  if (!next) return
  render(next.time, next.force)
}

const completeRenderCycle = (): void => {
  renderInFlight = false
  const hadQueuedRender = queuedRenders.length > 0
  flushQueuedRender()
  if (!hadQueuedRender && !renderInFlight) scheduleFullTrackWarmup()
}

const render = (time: number, force?: boolean | number): void => {
  if (renderInFlight) {
    const queuedItem = { time, force: force ? (1 as const) : (0 as const) }

    if (queuedItem.force) {
      queuedRenders.length = 0
    } else {
      const lastQueued = queuedRenders[queuedRenders.length - 1]
      if (lastQueued && Math.abs(lastQueued.time - queuedItem.time) > 0.25) {
        queuedRenders.length = 0
      }
    }

    if (queuedRenders.length >= MAX_QUEUED_RENDERS) {
      queuedRenders.shift()
      metrics.framesDropped++
    }
    queuedRenders.push(queuedItem)
    return
  }

  // Repeated manual renders at the exact same media time and canvas size are
  // deterministic. Skip the WASM call and reuse the existing canvas contents;
  // this matches players/benchmark harnesses that repaint paused frames.
  if (
    !force &&
    time === lastRenderedRequestTime &&
    self.width === lastRenderedRequestWidth &&
    self.height === lastRenderedRequestHeight
  ) {
    metrics.cacheHits++
    postMessage({ target: 'unbusy' })
    return
  }

  lastRenderedRequestTime = time
  lastRenderedRequestWidth = self.width
  lastRenderedRequestHeight = self.height

  // Inside a known-empty window the output cannot change: skip the WASM call
  if (!force && emptyWindowFrom >= 0 && time >= emptyWindowFrom && time < emptyWindowUntil) {
    metrics.cacheHits++
    postMessage({ target: 'unbusy' })
    return
  }

  renderInFlight = true
  initPool() // Ensure pool is ready

  const times: RenderTimes = {}
  const renderStartTime = performance.now()
  metrics.renderStartTime = renderStartTime
  metrics.pendingRenders++

  const api = requireApi()
  const handle = requireHandle()
  const forceInt = force ? 1 : 0

  // Use the batch render-collect API: single WASM call does render + metadata + image data extraction.
  const useRawAssImagePath = !!rawAssWebGL2Renderer && offscreenRender === true
  const imageStride = useRawAssImagePath ? RAW_RRC_IMG_STRIDE : RRC_IMG_STRIDE
  ensureRenderCollectBuffer(RENDER_COLLECT_MAX_IMAGES, imageStride)

  const written = useRawAssImagePath
    ? api.renderRawCollect(handle, time, forceInt, rrcBufPtr, rrcBufCapacity)
    : blendMode === 'wasm'
      ? api.renderBlendCollect(handle, time, forceInt, rrcBufPtr, rrcBufCapacity)
      : api.renderImageCollect(handle, time, forceInt, rrcBufPtr, rrcBufCapacity)

  // Refresh after the WASM call: rendering may have grown the memory
  refreshRrcViews()
  const headerView = rrcHeaderView!
  const changed = headerView[0]

  // Frame produced no images: ask how long renders can be skipped.
  if (headerView[1] === 0 && (emptyWindowFrom < 0 || time < emptyWindowFrom || time >= emptyWindowUntil)) {
    computeEmptyWindow(time)
  }

  // Update metrics
  const renderEndTime = performance.now()
  const renderDuration = renderEndTime - renderStartTime
  metrics.lastRenderTime = renderDuration
  metrics.totalRenderTime += renderDuration
  metrics.maxRenderTime = Math.max(metrics.maxRenderTime, renderDuration)
  if (renderDuration > 0) {
    metrics.minRenderTime = Math.min(metrics.minRenderTime, renderDuration)
  }

  if (changed !== 0 || force) {
    metrics.framesRendered++
    metrics.cacheMisses++
  } else {
    metrics.lastImageCount = 0
    metrics.lastImagePixels = 0
    metrics.cacheHits++
  }

  if (debug) {
    const decodeEndTime = performance.now()
    const renderEndTimeWasm = headerView[2]
    times.WASMRenderTime = renderEndTimeWasm - renderStartTime
    times.WASMBitmapDecodeTime = decodeEndTime - renderEndTimeWasm
    times.JSRenderTime = Date.now()
  }

  if (changed !== 0 || force) {
    const images = frameImages
    const buffers = frameArrayBuffers
    images.length = 0
    buffers.length = 0

    const meta = rrcMetaView!
    metrics.lastImageCount = written
    metrics.lastImagePixels = 0
    const stride = useRawAssImagePath ? RAW_RRC_IMG_STRIDE : RRC_IMG_STRIDE
    for (let i = 0; i < written; ++i) {
      const metaOffset = i * stride
      metrics.lastImagePixels += Math.max(0, meta[metaOffset + 2]) * Math.max(0, meta[metaOffset + 3])
    }

    if (useRawAssImagePath) {
      return paintRawAssImages({ meta, count: written, times })
    }

    if (written === 0) return paintImages({ images, buffers, times })

    const useAsyncBitmapPath = asyncRender

    if (useAsyncBitmapPath) {
      const promises = frameBitmapPromises
      promises.length = written

      for (let i = 0; i < written; ++i) {
        const metaOffset = i * RRC_IMG_STRIDE
        const item = getPooledItem(i)
        item.x = meta[metaOffset]
        item.y = meta[metaOffset + 1]
        item.w = meta[metaOffset + 2]
        item.h = meta[metaOffset + 3]
        item.image = 0

        const pointer = meta[metaOffset + 4]
        const byteLength = item.w * item.h * 4
        let rawData = new Uint8ClampedArray(self.wasmMemory.buffer, pointer, byteLength)
        if (hasBitmapBug) {
          // Browsers with the partial-bitmap bug mis-render ImageData backed
          // by a view into a larger buffer; give them a standalone copy.
          rawData = rawData.slice()
        }

        const imageData = new ImageData(rawData as Uint8ClampedArray<ArrayBuffer>, item.w, item.h)

        promises[i] = asyncRenderOptions
          ? createImageBitmap(imageData, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
          : createImageBitmap(imageData)
        images[i] = item
      }

      Promise.all(promises)
        .then((bitmaps) => {
          for (let i = 0; i < written; i++) {
            images[i].image = bitmaps[i]
          }
          if (debug) times.JSBitmapGenerationTime = Date.now() - (times.JSRenderTime || 0)
          paintImages({ images, buffers: bitmaps, times })
        })
        .catch(() => {
          if (asyncRenderOptions) {
            asyncRenderOptions = false
            console.warn('[AkariSub] createImageBitmap options not supported, disabling')
            metrics.pendingRenders--
            completeRenderCycle()
            render(time, force)
          } else {
            metrics.pendingRenders--
            postMessage({ target: 'unbusy' })
            completeRenderCycle()
          }
        })
    } else {
      // When posting to the main thread, copy all image pixels into one
      // transferable buffer instead of allocating/transferring one per image.
      let copyTarget: Uint8ClampedArray<ArrayBuffer> | null = null
      let copyOffset = 0
      if (!offCanvasCtx) {
        let totalBytes = 0
        for (let i = 0; i < written; ++i) {
          const metaOffset = i * RRC_IMG_STRIDE
          totalBytes += meta[metaOffset + 2] * meta[metaOffset + 3] * 4
        }
        copyTarget = new Uint8ClampedArray(totalBytes)
        buffers.push(copyTarget.buffer)
      }

      for (let i = 0; i < written; ++i) {
        const metaOffset = i * RRC_IMG_STRIDE
        const item = getPooledItem(i)
        item.x = meta[metaOffset]
        item.y = meta[metaOffset + 1]
        item.w = meta[metaOffset + 2]
        item.h = meta[metaOffset + 3]
        item.image = meta[metaOffset + 4]

        if (copyTarget) {
          const imagePtr = item.image as number
          const byteLength = item.w * item.h * 4
          const copiedData = copyTarget.subarray(copyOffset, copyOffset + byteLength)
          copiedData.set(self.HEAPU8C.subarray(imagePtr, imagePtr + byteLength))
          item.image = copiedData
          copyOffset += byteLength
        }
        images[i] = item
      }
      paintImages({ images, buffers, times })
    }
  } else {
    metrics.pendingRenders--
    postMessage({ target: 'unbusy' })
    completeRenderCycle()
  }
}

self.demand = ({ time }: { time: number }): void => {
  lastCurrentTime = time
  lastCurrentTimeReceivedAt = nowMs()
  const force = forceNextDemandRender ? 1 : 0
  forceNextDemandRender = false
  render(time, force)
}

const renderLoop = (force?: boolean | number): void => {
  rafId = null
  render(getCurrentTime(), force)
  if (!_isPaused) {
    rafId = requestAnimationFrame(renderLoop)
  }
}

const paintRawAssImages = ({ times, meta, count }: { times: RenderTimes; meta: Int32Array; count: number }): void => {
  metrics.pendingRenders--
  const width = self.width
  const height = self.height
  const renderStart = performance.now()
  try {
    const pixels = rawAssWebGL2Renderer!.renderRawAssMetadata(meta, count, self.HEAPU8, width, height)
    if (debug) {
      times.JSRenderTime = performance.now() - renderStart
      times.bitmaps = count
      ;(times as RenderTimes & { rawPixels?: number }).rawPixels = pixels
      let total = 0
      for (const key in times) {
        if (key !== 'bitmaps' && key !== 'rawPixels') total += (times as any)[key] || 0
      }
      console.log(`[WEBGL2-RAW-ASS] Bitmaps: ${count} Pixels: ${pixels} Total: ${total | 0}ms`, times)
    }
  } catch (error) {
    console.error('[AkariSub] Raw ASS_Image WebGL2 render failed:', error)
  }
  postMessage({ target: 'unbusy' })
  completeRenderCycle()
}

const paintImages = ({
  times,
  images,
  buffers
}: {
  times: RenderTimes
  images: RenderResultItem[]
  buffers: (ArrayBuffer | ImageBitmap)[]
}): void => {
  metrics.pendingRenders--

  const width = self.width
  const height = self.height
  const imageCount = images.length

  const resultObject = {
    target: 'render',
    asyncRender,
    images,
    times,
    width,
    height,
    colorSpace: subtitleColorSpace
  }

  if (offscreenRender) {
    // Only resize canvas when dimensions actually change
    if (offCanvas!.height !== height || offCanvas!.width !== width) {
      offCanvas!.width = width
      offCanvas!.height = height
    }
    offCanvasCtx!.clearRect(0, 0, width, height)

    const firstImage = imageCount > 0 ? images[0].image : null
    const hasImageBitmapInputs = typeof ImageBitmap !== 'undefined' && firstImage instanceof ImageBitmap

    if (hasImageBitmapInputs) {
      // Batch draw all ImageBitmaps. This is much faster than rebuilding ImageData
      // from WASM-backed RGBA pointers and works for both plain offscreenRender=true
      // and hybrid offscreen rendering.
      for (let i = 0; i < imageCount; i++) {
        const img = images[i]
        if (img.image) {
          offCanvasCtx!.drawImage(img.image as ImageBitmap, img.x, img.y)
          ;(img.image as ImageBitmap).close()
        }
      }
    } else {
      // Non-async path with buffer canvas
      for (let i = 0; i < imageCount; i++) {
        const img = images[i]
        if (img.image) {
          const imgW = img.w
          const imgH = img.h

          // Only resize buffer canvas when needed
          if (bufferCanvas!.width !== imgW || bufferCanvas!.height !== imgH) {
            bufferCanvas!.width = imgW
            bufferCanvas!.height = imgH
          }

          const pointer = img.image as number
          const byteLength = imgW * imgH * 4
          const rawData = self.HEAPU8C.subarray(pointer, pointer + byteLength)

          bufferCtx!.putImageData(new ImageData(rawData as Uint8ClampedArray<ArrayBuffer>, imgW, imgH), 0, 0)
          offCanvasCtx!.drawImage(bufferCanvas!, img.x, img.y)
        }
      }
    }

    if (offscreenRender === 'hybrid') {
      if (!imageCount) {
        postMessage(resultObject)
        completeRenderCycle()
        return
      }
      if (debug) times.bitmaps = imageCount
      try {
        const bitmap = offCanvas!.transferToImageBitmap()
        const result = {
          ...resultObject,
          images: [{ image: bitmap, x: 0, y: 0 }],
          asyncRender: true
        }
        postMessage(result, [bitmap])
        completeRenderCycle()
      } catch {
        postMessage({ target: 'unbusy' })
        completeRenderCycle()
      }
    } else {
      if (debug) {
        times.JSRenderTime = Date.now() - (times.JSRenderTime || 0) - (times.JSBitmapGenerationTime || 0)
        let total = 0
        for (const key in times) total += (times as any)[key] || 0
        console.log('Bitmaps: ' + imageCount + ' Total: ' + (total | 0) + 'ms', times)
      }
      postMessage({ target: 'unbusy' })
      completeRenderCycle()
    }
  } else {
    postMessage(resultObject, buffers as Transferable[])
    completeRenderCycle()
  }
}

// Custom requestAnimationFrame for worker
const requestAnimationFrame = self.requestAnimationFrame
  ? self.requestAnimationFrame.bind(self)
  : ((): ((func: () => void) => number) => {
      let nextRAF = 0
      return (func: () => void): number => {
        const now = nowMs()
        if (nextRAF === 0) {
          nextRAF = now + 1000 / targetFps
        } else {
          while (now + 2 >= nextRAF) {
            nextRAF += 1000 / targetFps
          }
        }
        const delay = Math.max(nextRAF - now, 0)
        return setTimeout(func, delay) as unknown as number
      }
    })()

const cancelAnimationFrame = self.cancelAnimationFrame ? self.cancelAnimationFrame.bind(self) : clearTimeout

// =============================================================================
// WASM Initialization
// =============================================================================

self.init = async (data: any): Promise<void> => {
  hasBitmapBug = data.hasBitmapBug
  fullTrackWarmupEnabled = !!data.fullTrackWarmup
  _isPaused = data.initialIsPaused ?? true
  if (typeof data.initialPlaybackRate === 'number' && Number.isFinite(data.initialPlaybackRate)) {
    rate = data.initialPlaybackRate
  }

  if (typeof data.initialTime === 'number' && Number.isFinite(data.initialTime)) {
    lastCurrentTime = data.initialTime
    if (
      !_isPaused &&
      typeof data.initialTimeSnapshotAtMs === 'number' &&
      Number.isFinite(data.initialTimeSnapshotAtMs)
    ) {
      lastCurrentTimeReceivedAt = nowMs() - Math.max(0, Date.now() - data.initialTimeSnapshotAtMs)
    } else {
      lastCurrentTimeReceivedAt = nowMs()
    }
  }

  const _fetch = self.fetch
  const setWasmUrl = (wasmUrl: string): void => {
    if ((WebAssembly as any).instantiateStreaming) {
      self.fetch = (_: any) => _fetch(wasmUrl)
    }
  }

  const restoreFetch = (): void => {
    self.fetch = _fetch
  }

  const loadWasm = (wasmUrl: string): Promise<AkariSubModule> => {
    setWasmUrl(wasmUrl)
    return WASM({
      wasm: !(WebAssembly as any).instantiateStreaming ? (read_(wasmUrl, true) as ArrayBuffer) : undefined
    }).finally(restoreFetch)
  }

  const onWasmLoaded = async (Module: AkariSubModule): Promise<void> => {
    _Module = Module // Store module reference for FS access

    akariSubApi = {
      create: Module._akarisub_create,
      destroy: Module._akarisub_destroy,
      setDropAnimations: Module._akarisub_set_drop_animations,
      setAdaptiveBlendLayouts: Module._akarisub_set_adaptive_blend_layouts,
      createTrackMem: Module._akarisub_create_track_mem,
      removeTrack: Module._akarisub_remove_track,
      resizeCanvas: Module._akarisub_resize_canvas,
      addFont: Module._akarisub_add_font,
      reloadFonts: Module._akarisub_reload_fonts,
      setDefaultFont: Module._akarisub_set_default_font,
      setFallbackFonts: Module._akarisub_set_fallback_fonts,
      setUseFontconfigProvider: Module._akarisub_set_use_fontconfig_provider,
      setMemoryLimits: Module._akarisub_set_memory_limits,
      getEventCount: Module._akarisub_get_event_count,
      allocEvent: Module._akarisub_alloc_event,
      removeEvent: Module._akarisub_remove_event,
      getStyleCount: Module._akarisub_get_style_count,
      allocStyle: Module._akarisub_alloc_style,
      removeStyle: Module._akarisub_remove_style,
      styleOverrideIndex: Module._akarisub_style_override_index,
      disableStyleOverride: Module._akarisub_disable_style_override,
      getTrackColorSpace: Module._akarisub_get_track_color_space,
      eventGetInt: Module._akarisub_event_get_int,
      eventSetInt: Module._akarisub_event_set_int,
      eventGetStr: Module._akarisub_event_get_str,
      eventSetStr: Module._akarisub_event_set_str,
      styleGetNum: Module._akarisub_style_get_num,
      styleSetNum: Module._akarisub_style_set_num,
      styleGetStr: Module._akarisub_style_get_str,
      styleSetStr: Module._akarisub_style_set_str,
      getEventTimeRange: Module._akarisub_get_event_time_range,
      getEmptyWindow: Module._akarisub_get_empty_window,
      renderBlendCollect: Module._akarisub_render_blend_collect,
      renderImageCollect: Module._akarisub_render_image_collect,
      renderRawCollect: Module._akarisub_render_raw_collect
    }

    // Normalize fallback fonts and deduplicate
    const fallbackFonts: string[] = []
    const fallbackFontKeys = new Set<string>()
    if (data.fallbackFonts && data.fallbackFonts.length > 0) {
      for (const font of data.fallbackFonts) {
        const originalFont = font.trim()
        const key = originalFont.toLowerCase()
        if (key && !fallbackFontKeys.has(key)) {
          fallbackFontKeys.add(key)
          fallbackFonts.push(originalFont)
        }
      }
    }

    try {
      Module.FS_createPath('/', 'fonts', true, true)
      Module.FS_createPath('/fonts', 'attached', true, true)
      Module.FS_createPath('/fonts', 'fallback', true, true)
      Module.FS_createPath('/', 'fontconfig', true, true)
      Module.FS_createPath('/', 'assets', true, true)
      Module.FS_createPath('/', 'etc', true, true)
      Module.FS_createPath('/etc', 'fonts', true, true)

      const fontsConf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
        <!-- Font directories listed in priority order -->
        <dir>/fonts/attached</dir>
        <dir>/fonts</dir>
        <dir>/fonts/fallback</dir>
        <match target="pattern">
                <test qual="any" name="family">
                        <string>mono</string>
                </test>
                <edit name="family" mode="assign" binding="same">
                        <string>monospace</string>
                </edit>
        </match>
        <match target="pattern">
                <test qual="any" name="family">
                        <string>sans serif</string>
                </test>
                <edit name="family" mode="assign" binding="same">
                        <string>sans-serif</string>
                </edit>
        </match>
        <match target="pattern">
                <test qual="any" name="family">
                        <string>sans</string>
                </test>
                <edit name="family" mode="assign" binding="same">
                        <string>sans-serif</string>
                </edit>
        </match>
        <cachedir>/fontconfig</cachedir>
        <config>
                <rescan>
                        <int>0</int>
                </rescan>
        </config>
</fontconfig>
`
      const fontsConfData = TEXT_ENCODER.encode(fontsConf)
      Module.FS_createDataFile('/assets', 'fonts.conf', fontsConfData, true, false, false)
      Module.FS_createDataFile('/etc/fonts', 'fonts.conf', fontsConfData, true, false, false)
    } catch (e) {
      console.warn('Failed to create font directories or fonts.conf:', e)
    }

    self.width = data.width
    self.height = data.height
    onDemandRenderMode = !!data.onDemandRender
    rawAssImageGpuEnabled = !!data.rawAssImageGpu
    blendMode = data.blendMode
    asyncRender = data.asyncRender

    if (asyncRender && typeof createImageBitmap === 'undefined') {
      asyncRender = false
      console.error("'createImageBitmap' needed for 'asyncRender' unsupported!")
    }

    if (asyncRender) {
      try {
        const testCanvas = new OffscreenCanvas(1, 1)
        const testCtx = testCanvas.getContext('2d')
        if (testCtx) {
          const testData = testCtx.getImageData(0, 0, 1, 1)
          await createImageBitmap(testData, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch(() => {
            asyncRenderOptions = false
            console.warn('[AkariSub] createImageBitmap options not supported (Safari?), rendering without options')
          })
        }
      } catch {
        asyncRenderOptions = false
      }
    }

    availableFonts = data.availableFonts
    debug = data.debug
    targetFps = data.targetFps || targetFps
    useLocalFonts = data.useLocalFonts
    useFontconfigProvider = data.useFontconfigProvider
    dropAllBlur = data.dropAllBlur
    clampPos = data.clampPos

    // Load fallback fonts asynchronously to avoid blocking worker thread
    // This is critical for mobile devices where sync XHR can cause timeouts
    const loadFallbackFontsAsync = async (): Promise<void> => {
      const fontPromises: Promise<void>[] = []

      for (const font of fallbackFonts) {
        const fontLower = font.trim().toLowerCase()
        const fontKey = fontLower.startsWith('@') ? fontLower.substring(1) : fontLower
        if (availableFonts && availableFonts[fontKey]) {
          const fontUrl = availableFonts[fontKey]
          if (typeof fontUrl === 'string') {
            // Async fetch for URL-based fonts
            const promise = new Promise<void>((resolve) => {
              readAsync(
                fontUrl,
                (fontData: ArrayBuffer) => {
                  writeFontToFSImmediate(new Uint8Array(fontData), true)
                  fontMap_[fontKey] = true
                  if (debug) console.log('[AkariSub] Loaded fallback font async:', fontKey)
                  resolve()
                },
                (e) => {
                  console.error('Failed to load fallback font:', fontKey, e)
                  resolve() // Don't fail initialization if a single font fails
                }
              )
            })
            fontPromises.push(promise)
          } else {
            // Font data directly provided - synchronous write is OK here
            writeFontToFSImmediate(fontUrl, true)
            fontMap_[fontKey] = true
          }
        }
      }

      // Wait for all fonts to load (with 30s timeout to prevent blocking forever)
      if (fontPromises.length > 0) {
        let timeoutId: ReturnType<typeof setTimeout> | null = null
        let timedOut = false
        const timeoutPromise = new Promise<void>((resolve) => {
          timeoutId = setTimeout(() => {
            timedOut = true
            console.warn('[AkariSub] Fallback font loading timeout, continuing with available fonts')
            resolve()
          }, 30000)
        })
        await Promise.race([
          Promise.all(fontPromises).then(() => {
            if (timeoutId !== null) clearTimeout(timeoutId)
          }),
          timeoutPromise
        ])
        if (!timedOut && debug) {
          console.log('[AkariSub] All fallback fonts loaded successfully')
        }
      }
    }

    await loadFallbackFontsAsync()

    const primaryFallback = fallbackFonts.length > 0 ? fallbackFonts[0] : null
    akariSubHandle = withCString(primaryFallback || '', (fontPtr) => {
      return requireApi().create(self.width, self.height, fontPtr, debug ? 1 : 0)
    })
    requireApi().setUseFontconfigProvider(akariSubHandle, useFontconfigProvider ? 1 : 0)

    if (pendingFallbackFonts.length > 0) {
      for (const { data: fontData, name: fontName } of pendingFallbackFonts) {
        addFontAsEmbedded(fontData, fontName)
      }
      pendingFallbackFonts.length = 0
      requireApi().reloadFonts(akariSubHandle)
    }

    if (fallbackFonts.length > 0) {
      withCString(fallbackFonts.join(','), (fontsPtr) => {
        requireApi().setFallbackFonts(requireHandle(), fontsPtr)
      })
    }

    let subContent = data.subContent
    let decryptedSubContent: Uint8Array | null = null

    if (data.encryptedSubContent) {
      protectedTrackContent = true
      decryptedSubContent = await decryptSubtitleContent(data.encryptedSubContent)
      subContent = decryptedSubContent
    } else {
      protectedTrackContent = false
      if (!subContent) subContent = read_(data.subUrl) as string
    }

    // For large files, emit partial_ready early to allow playback to start
    // while font loading and track parsing continues in the background
    const isLargeSubtitle =
      typeof subContent === 'string' ? subContent.length > 500000 : toUint8Array(subContent).byteLength > 500000
    if (isLargeSubtitle) {
      postMessage({ target: 'partial_ready' })
      if (debug) console.log('[AkariSub] Large subtitle detected, emitting partial_ready early')
    }

    if (typeof subContent === 'string') {
      processAvailableFonts(subContent)
      if (clampPos) subContent = fixPlayRes(subContent)
      if (dropAllBlur) subContent = dropBlur(subContent)
    } else if (debug && (clampPos || dropAllBlur)) {
      console.warn('[AkariSub] Text rewrite options are skipped for protected binary subtitle content')
    }

    // Load attached/preloaded fonts before ready to avoid runtime font churn during first playback.
    let hasAttachedFonts = false
    const attachedFontPromises: Promise<void>[] = []

    for (const font of data.fonts || []) {
      if (typeof font === 'string') {
        const promise = new Promise<void>((resolve) => {
          readAsync(
            font,
            (fontData: ArrayBuffer) => {
              writeFontToFSImmediate(new Uint8Array(fontData), false)
              hasAttachedFonts = true
              if (debug) console.log('[AkariSub] Loaded attached font async:', font)
              resolve()
            },
            (e) => {
              console.error('Failed to load attached font:', font, e)
              resolve()
            }
          )
        })
        attachedFontPromises.push(promise)
      } else {
        writeFontToFSImmediate(font, false)
        hasAttachedFonts = true
      }
    }

    if (attachedFontPromises.length > 0) {
      let attachedTimeoutId: ReturnType<typeof setTimeout> | null = null
      let attachedTimedOut = false
      const attachedTimeoutPromise = new Promise<void>((resolve) => {
        attachedTimeoutId = setTimeout(() => {
          attachedTimedOut = true
          console.warn('[AkariSub] Attached font loading timeout, continuing with available fonts')
          resolve()
        }, 30000)
      })

      await Promise.race([
        Promise.all(attachedFontPromises).then(() => {
          if (attachedTimeoutId !== null) clearTimeout(attachedTimeoutId)
        }),
        attachedTimeoutPromise
      ])

      if (!attachedTimedOut && debug) {
        console.log('[AkariSub] Attached font loading complete')
      }
    }

    if (hasAttachedFonts) {
      if (debug) console.log('[AkariSub] Reloading fonts after writing attached fonts to FS')
      requireApi().reloadFonts(requireHandle())
      if (debug) console.log('[AkariSub] Font reload complete')
    }

    if (typeof subContent === 'string') {
      createTrackFromString(subContent)
    } else {
      try {
        createTrackFromBytes(toUint8Array(subContent))
      } finally {
        decryptedSubContent?.fill(0)
      }
    }
    syncTotalEventsMetric()
    firstTrackEventStartTime = getFirstEventStartTime()
    subtitleColorSpace = libassYCbCrMap[requireApi().getTrackColorSpace(requireHandle())]
    requireApi().setDropAnimations(requireHandle(), data.dropAllAnimations || 0)
    requireApi().setAdaptiveBlendLayouts(requireHandle(), data.adaptiveBlendLayouts ? 1 : 0)
    blockingFullTrackWarmup = data.blockingFullTrackWarmup
    fullTrackWarmupStepSeconds = data.fullTrackWarmupStep > 0 ? data.fullTrackWarmupStep : FULL_WARMUP_STEP_SECONDS

    if (data.libassMemoryLimit > 0 || data.libassGlyphLimit > 0) {
      requireApi().setMemoryLimits(requireHandle(), data.libassGlyphLimit || 0, data.libassMemoryLimit || 0)
    }

    initPool()
    ensureRenderCollectBuffer(PREWARM_MAX_IMAGES)

    try {
      prewarmRenderer(getCurrentTime())
    } catch (e) {
      if (debug) console.warn('[AkariSub] Prewarm render failed, continuing:', e)
    }

    if (blockingFullTrackWarmup && fullTrackWarmupEnabled && !fullTrackWarmupStarted) {
      fullTrackWarmupStarted = true
      try {
        await prewarmEntireTrack()
      } catch (e) {
        if (debug) console.warn('[AkariSub] Full track warmup failed, continuing:', e)
      }
      try {
        prewarmRenderer(getCurrentTime())
      } catch (e) {
        if (debug) console.warn('[AkariSub] Post-warmup re-prime failed, continuing:', e)
      }
    }

    forceNextDemandRender = true

    postMessage({ target: 'ready' })
    postMessage({ target: 'verifyColorSpace', subtitleColorSpace })
  }

  loadWasm(data.wasmUrl)
    .then(onWasmLoaded)
    .catch((e) => {
      console.error('[AkariSub] WASM loading failed:', e)
      postMessage({ target: 'error', error: 'WASM loading failed: ' + (e && e.message ? e.message : String(e)) })
    })
}

// =============================================================================
// Canvas Management
// =============================================================================

self.offscreenCanvas = ({
  transferable,
  rawAssImageGpu
}: {
  transferable: [OffscreenCanvas]
  rawAssImageGpu?: boolean
}): void => {
  offCanvas = transferable[0]
  rawAssWebGL2Renderer = null

  const useRawAssImageGpu = rawAssImageGpu ?? rawAssImageGpuEnabled
  if (useRawAssImageGpu) {
    try {
      const renderer = new RawASSImageWebGL2Renderer()
      if (renderer.init(offCanvas, self.width, self.height)) {
        rawAssWebGL2Renderer = renderer
        offCanvasCtx = null
        bufferCanvas = null
        bufferCtx = null
        offscreenRender = true
        if (debug) console.log('[AkariSub] Using worker WebGL2 raw ASS_Image renderer')
        return
      }
    } catch (error) {
      rawAssWebGL2Renderer = null
      if (debug) console.warn('[AkariSub] Worker WebGL2 raw ASS_Image renderer unavailable:', error)
    }
  }

  offCanvasCtx = offCanvas.getContext('2d', { desynchronized: true })
  // Plain offscreen rendering draws raw WASM image pointers through a reusable
  // buffer canvas. Create it regardless of asyncRender because the render path
  // deliberately disables per-image ImageBitmap creation for offscreenRender=true.
  bufferCanvas = new OffscreenCanvas(self.width, self.height)
  bufferCtx = bufferCanvas.getContext('2d', { desynchronized: true })
  offscreenRender = true
}

self.detachOffscreen = (): void => {
  rawAssWebGL2Renderer?.destroy()
  rawAssWebGL2Renderer = null
  offCanvas = new OffscreenCanvas(self.width, self.height)
  offCanvasCtx = offCanvas.getContext('2d', { desynchronized: true })
  offscreenRender = 'hybrid'
}

self.canvas = ({
  width,
  height,
  videoWidth,
  videoHeight,
  force
}: {
  width: number
  height: number
  videoWidth: number
  videoHeight: number
  force?: boolean
}): void => {
  if (width == null) throw new Error('Invalid canvas size specified')
  self.width = width
  self.height = height
  if (akariSubHandle) requireApi().resizeCanvas(akariSubHandle, width, height, videoWidth, videoHeight)
  if (force) render(lastCurrentTime, true)
}

self.video = ({
  currentTime,
  isPaused,
  rate: newRate
}: {
  currentTime?: number
  isPaused?: boolean
  rate?: number
}): void => {
  if (currentTime != null) setCurrentTime(currentTime)
  if (isPaused != null) setIsPaused(isPaused)
  if (newRate != null) rate = newRate
}

self.destroy = (): void => {
  stopWarmup()
  fullTrackWarmupPromise = null
  firstTrackEventStartTime = null

  rawAssWebGL2Renderer?.destroy()
  rawAssWebGL2Renderer = null

  if (_Module) {
    if (rrcBufPtr) {
      _Module._free(rrcBufPtr)
      rrcBufPtr = 0
      rrcBufCapacity = 0
      rrcHeaderView = null
      rrcMetaView = null
      rrcViewsBuffer = null
      rrcViewsPtr = 0
      rrcViewsCapacity = 0
    }
  }
  if (akariSubHandle) {
    requireApi().destroy(akariSubHandle)
    akariSubHandle = 0
  }
  metrics.totalEvents = 0
}

self.setAsyncRender = ({ value }: { value: boolean }): void => {
  asyncRender = value && typeof createImageBitmap !== 'undefined'
}

// =============================================================================
// Event Management
// =============================================================================

const applyEventFields = (index: number, event: Partial<ASSEvent>): void => {
  const api = requireApi()
  const handle = requireHandle()
  for (const key of Object.keys(event) as (keyof ASSEvent)[]) {
    const value = event[key]
    if (value == null || key === '_index') continue

    if (key in EVENT_INT_FIELDS) {
      api.eventSetInt(handle, index, EVENT_INT_FIELDS[key as string], Number(value))
      continue
    }

    if (key in EVENT_STR_FIELDS) {
      withCString(String(value), (ptr) => {
        api.eventSetStr(handle, index, EVENT_STR_FIELDS[key as string], ptr)
      })
    }
  }
}

const readEvent = (index: number): ASSEvent => {
  const api = requireApi()
  const handle = requireHandle()
  return {
    Start: api.eventGetInt(handle, index, EVENT_INT_FIELDS.Start),
    Duration: api.eventGetInt(handle, index, EVENT_INT_FIELDS.Duration),
    ReadOrder: api.eventGetInt(handle, index, EVENT_INT_FIELDS.ReadOrder),
    Layer: api.eventGetInt(handle, index, EVENT_INT_FIELDS.Layer),
    Style: String(api.eventGetInt(handle, index, EVENT_INT_FIELDS.Style)),
    MarginL: api.eventGetInt(handle, index, EVENT_INT_FIELDS.MarginL),
    MarginR: api.eventGetInt(handle, index, EVENT_INT_FIELDS.MarginR),
    MarginV: api.eventGetInt(handle, index, EVENT_INT_FIELDS.MarginV),
    Name: readCString(api.eventGetStr(handle, index, EVENT_STR_FIELDS.Name)),
    Text: readCString(api.eventGetStr(handle, index, EVENT_STR_FIELDS.Text)),
    Effect: readCString(api.eventGetStr(handle, index, EVENT_STR_FIELDS.Effect))
  }
}

const applyStyleFields = (index: number, style: Partial<ASSStyle>): void => {
  const api = requireApi()
  const handle = requireHandle()
  for (const key of Object.keys(style) as (keyof ASSStyle)[]) {
    const value = style[key]
    if (value == null) continue

    if (key in STYLE_NUM_FIELDS) {
      api.styleSetNum(handle, index, STYLE_NUM_FIELDS[key as string], Number(value))
      continue
    }

    if (key in STYLE_STR_FIELDS) {
      withCString(String(value), (ptr) => {
        api.styleSetStr(handle, index, STYLE_STR_FIELDS[key as string], ptr)
      })
    }
  }
}

const readStyle = (index: number): ASSStyle => {
  const api = requireApi()
  const handle = requireHandle()
  return {
    Name: readCString(api.styleGetStr(handle, index, STYLE_STR_FIELDS.Name)),
    FontName: readCString(api.styleGetStr(handle, index, STYLE_STR_FIELDS.FontName)),
    FontSize: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.FontSize),
    PrimaryColour: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.PrimaryColour),
    SecondaryColour: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.SecondaryColour),
    OutlineColour: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.OutlineColour),
    BackColour: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.BackColour),
    Bold: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.Bold),
    Italic: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.Italic),
    Underline: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.Underline),
    StrikeOut: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.StrikeOut),
    ScaleX: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.ScaleX),
    ScaleY: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.ScaleY),
    Spacing: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.Spacing),
    Angle: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.Angle),
    BorderStyle: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.BorderStyle),
    Outline: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.Outline),
    Shadow: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.Shadow),
    Alignment: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.Alignment),
    MarginL: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.MarginL),
    MarginR: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.MarginR),
    MarginV: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.MarginV),
    Encoding: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.Encoding),
    treat_fontname_as_pattern: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.treat_fontname_as_pattern),
    Blur: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.Blur),
    Justify: api.styleGetNum(handle, index, STYLE_NUM_FIELDS.Justify)
  }
}

self.createEvent = ({ event }: { event: Partial<ASSEvent> }): void => {
  const index = requireApi().allocEvent(requireHandle())
  if (index >= 0) applyEventFields(index, event)
  syncTotalEventsMetric()
}

self.getEvents = (): void => {
  const events: ASSEvent[] = []
  const api = requireApi()
  const count = api.getEventCount(requireHandle())
  for (let i = 0; i < count; i++) {
    const event = { ...readEvent(i), _index: i }
    if (protectedTrackContent) {
      event.Name = ''
      event.Effect = ''
      event.Text = ''
    }
    events.push(event)
  }
  postMessage({ target: 'getEvents', events })
}

self.setEvent = ({ event, index }: { event: Partial<ASSEvent>; index: number }): void => {
  applyEventFields(index, event)
}

self.removeEvent = ({ index }: { index: number }): void => {
  requireApi().removeEvent(requireHandle(), index)
  syncTotalEventsMetric()
}

// =============================================================================
// Style Management
// =============================================================================

self.createStyle = ({ style }: { style: Partial<ASSStyle> }): any => {
  const index = requireApi().allocStyle(requireHandle())
  if (index >= 0) applyStyleFields(index, style)
  return index
}

self.getStyles = (): void => {
  const styles: ASSStyle[] = []
  const api = requireApi()
  const count = api.getStyleCount(requireHandle())
  for (let i = 0; i < count; i++) {
    styles.push(readStyle(i))
  }
  postMessage({ target: 'getStyles', time: Date.now(), styles })
}

self.setStyle = ({ style, index }: { style: Partial<ASSStyle>; index: number }): void => {
  applyStyleFields(index, style)
}

self.removeStyle = ({ index }: { index: number }): void => {
  requireApi().removeStyle(requireHandle(), index)
}

self.styleOverride = (data: { style: Partial<ASSStyle> }): void => {
  const index = self.createStyle(data)
  if (typeof index === 'number' && index >= 0) {
    requireApi().styleOverrideIndex(requireHandle(), index)
  }
}

self.disableStyleOverride = (): void => {
  requireApi().disableStyleOverride(requireHandle())
}

self.defaultFont = ({ font }: { font: string }): void => {
  withCString(font, (fontPtr) => {
    requireApi().setDefaultFont(requireHandle(), fontPtr)
  })
}

// =============================================================================
// Performance Metrics
// =============================================================================

self.getStats = (): void => {
  const avgRenderTime = metrics.framesRendered > 0 ? metrics.totalRenderTime / metrics.framesRendered : 0

  postMessage({
    target: 'getStats',
    stats: {
      framesRendered: metrics.framesRendered,
      framesDropped: metrics.framesDropped,
      avgRenderTime: Math.round(avgRenderTime * 100) / 100,
      maxRenderTime: Math.round(metrics.maxRenderTime * 100) / 100,
      minRenderTime: metrics.minRenderTime === Infinity ? 0 : Math.round(metrics.minRenderTime * 100) / 100,
      lastRenderTime: Math.round(metrics.lastRenderTime * 100) / 100,
      lastImageCount: metrics.lastImageCount,
      lastImagePixels: metrics.lastImagePixels,
      pendingRenders: Math.max(0, metrics.pendingRenders),
      totalEvents: metrics.totalEvents,
      usingWorker: true,
      offscreenRender: !!offscreenRender,
      rawAssImageGpu: !!rawAssWebGL2Renderer,
      workerRenderer: rawAssWebGL2Renderer
        ? 'webgl2-raw-ass'
        : offscreenRender === 'hybrid'
          ? 'hybrid'
          : offscreenRender
            ? 'canvas2d'
            : 'main-thread',
      onDemandRender: onDemandRenderMode,
      cacheHits: metrics.cacheHits,
      cacheMisses: metrics.cacheMisses
    }
  })
}

self.resetStats = (): void => {
  resetMetrics()
  postMessage({ target: 'resetStats', success: true })
}

self.getEventCount = (): void => {
  const count = akariSubHandle ? requireApi().getEventCount(akariSubHandle) : 0
  postMessage({ target: 'getEventCount', count })
}

self.getStyleCount = (): void => {
  const count = akariSubHandle ? requireApi().getStyleCount(akariSubHandle) : 0
  postMessage({ target: 'getStyleCount', count })
}

// =============================================================================
// Message Handler
// =============================================================================

const RENDER_SAFE_TARGETS = new Set([
  'demand',
  'video',
  'getEvents',
  'getStyles',
  'getStats',
  'resetStats',
  'getEventCount',
  'getStyleCount',
  'getColorSpace'
])

onmessage = ({ data }: MessageEvent): void => {
  if (!self[data.target]) {
    throw new Error('Unknown event target ' + data.target)
  }

  if (!RENDER_SAFE_TARGETS.has(data.target)) {
    invalidateEmptyWindow()
  }

  Promise.resolve(self[data.target](data)).catch((error) => {
    postMessage({
      target: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  })
}
