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
let rate = 1
let rafId: number | null = null
let nextIsRaf = false
let lastCurrentTimeReceivedAt = Date.now()
let targetFps = 24
let useLocalFonts = false
let blendMode: 'js' | 'wasm' = 'wasm'
let availableFonts: Record<string, string | Uint8Array> = {}
const fontMap_: Record<string, boolean> = {}
let attachedFontId = 0  // For attached/preloaded fonts (higher priority)
let fallbackFontId = 0  // For fallback fonts (lower priority)
const pendingFallbackFonts: { data: Uint8Array; name: string }[] = []
let debug = false
let clampPos = false
let renderInFlight = false
let queuedRender: { time: number; force?: boolean | number } | null = null

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
  cacheMisses: 0
}

const resetMetrics = (): void => {
  metrics.framesRendered = 0
  metrics.framesDropped = 0
  metrics.totalRenderTime = 0
  metrics.maxRenderTime = 0
  metrics.minRenderTime = Infinity
  metrics.lastRenderTime = 0
  metrics.cacheHits = 0
  metrics.cacheMisses = 0
}

let asyncRender = false
let asyncRenderOptions = true
let offCanvas: OffscreenCanvas | null = null
let offCanvasCtx: OffscreenCanvasRenderingContext2D | null = null
let offscreenRender: boolean | 'hybrid' = false
let bufferCanvas: OffscreenCanvas | null = null
let bufferCtx: OffscreenCanvasRenderingContext2D | null = null
let akariSubHandle = 0
let subtitleColorSpace: SubtitleColorSpace = null
let dropAllBlur = false
let hasBitmapBug = false
let _Module: AkariSubModule | null = null

const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()

interface AkariSubApi {
  create: (width: number, height: number, fallbackFontPtr: number, debug: number) => number
  destroy: (handle: number) => void
  setDropAnimations: (handle: number, value: number) => void
  createTrackMem: (handle: number, contentPtr: number) => void
  removeTrack: (handle: number) => void
  resizeCanvas: (handle: number, width: number, height: number, videoWidth: number, videoHeight: number) => void
  addFont: (handle: number, namePtr: number, dataPtr: number, dataSize: number) => void
  reloadFonts: (handle: number) => void
  setDefaultFont: (handle: number, fontPtr: number) => void
  setFallbackFonts: (handle: number, fontsPtr: number) => void
  setMemoryLimits: (handle: number, glyphLimit: number, memoryLimit: number) => void
  getEventCount: (handle: number) => number
  allocEvent: (handle: number) => number
  removeEvent: (handle: number, index: number) => void
  getStyleCount: (handle: number) => number
  allocStyle: (handle: number) => number
  removeStyle: (handle: number, index: number) => void
  styleOverrideIndex: (handle: number, index: number) => void
  disableStyleOverride: (handle: number) => void
  renderBlend: (handle: number, time: number, force: number) => number
  renderImage: (handle: number, time: number, force: number) => number
  getChanged: (handle: number) => number
  getCount: (handle: number) => number
  getTime: (handle: number) => number
  getTrackColorSpace: (handle: number) => number
  eventGetInt: (handle: number, index: number, field: number) => number
  eventSetInt: (handle: number, index: number, field: number, value: number) => void
  eventGetStr: (handle: number, index: number, field: number) => number
  eventSetStr: (handle: number, index: number, field: number, valuePtr: number) => void
  styleGetNum: (handle: number, index: number, field: number) => number
  styleSetNum: (handle: number, index: number, field: number, value: number) => void
  styleGetStr: (handle: number, index: number, field: number) => number
  styleSetStr: (handle: number, index: number, field: number, valuePtr: number) => void
  rrX: (ptr: number) => number
  rrY: (ptr: number) => number
  rrW: (ptr: number) => number
  rrH: (ptr: number) => number
  rrImage: (ptr: number) => number
  rrNext: (ptr: number) => number
  rrCollect: (resultPtr: number, outPtr: number, maxItems: number) => number
  renderBlendCollect: (handle: number, time: number, force: number, outPtr: number, maxItems: number) => number
  renderImageCollect: (handle: number, time: number, force: number, outPtr: number, maxItems: number) => number
}

let akariSubApi: AkariSubApi | null = null

// Pre-allocated object pool for render results
const MAX_POOLED_IMAGES = 128
const RENDER_COLLECT_MAX_IMAGES = Math.max(MAX_POOLED_IMAGES, 4096)
const PREWARM_MAX_IMAGES = RENDER_COLLECT_MAX_IMAGES
const imagePool: RenderResultItem[] = new Array(MAX_POOLED_IMAGES)
let poolInitialized = false
const RR_META_STRIDE = 6
// Batch render-collect buffer: 3 header ints (changed, count, time) + 5 ints per image (x, y, w, h, image_ptr)
const RRC_HEADER_INTS = 3
const RRC_IMG_STRIDE = 5
let rrMetaPtr = 0
let rrMetaCapacity = 0
// Pre-allocated buffer for batch render-collect calls
let rrcBufPtr = 0
let rrcBufCapacity = 0
const frameImages: RenderResultItem[] = []
const frameArrayBuffers: ArrayBuffer[] = []
const frameBitmapPromises: Promise<ImageBitmap>[] = []

interface RenderResultItem {
  w: number
  h: number
  x: number
  y: number
  image: number | ImageBitmap | ArrayBuffer
}

const initPool = (): void => {
  if (poolInitialized) return
  for (let i = 0; i < MAX_POOLED_IMAGES; i++) {
    imagePool[i] = { w: 0, h: 0, x: 0, y: 0, image: 0 }
  }
  poolInitialized = true
}

const getPooledItem = (index: number): RenderResultItem => {
  if (index < MAX_POOLED_IMAGES) {
    return imagePool[index]
  }
  return { w: 0, h: 0, x: 0, y: 0, image: 0 }
}

const ensureRenderMetaBuffer = (imageCount: number): void => {
  if (!_Module || imageCount <= 0) return
  if (rrMetaCapacity >= imageCount && rrMetaPtr) return

  const nextCapacity = Math.max(imageCount, rrMetaCapacity * 2 || 64)
  const nextSizeBytes = nextCapacity * RR_META_STRIDE * Int32Array.BYTES_PER_ELEMENT

  if (rrMetaPtr) {
    _Module._free(rrMetaPtr)
    rrMetaPtr = 0
    rrMetaCapacity = 0
  }

  rrMetaPtr = _Module._malloc(nextSizeBytes)
  if (!rrMetaPtr) {
    rrMetaCapacity = 0
    throw new Error('Failed to allocate render metadata buffer')
  }

  rrMetaCapacity = nextCapacity
}

/**
 * Ensure the batch render-collect buffer is large enough.
 * Layout: [changed, count, time, (x, y, w, h, image_ptr) * N]
 * = 3 + 5*N ints
 */
const ensureRenderCollectBuffer = (maxImages: number): void => {
  if (!_Module || maxImages <= 0) return
  const totalInts = RRC_HEADER_INTS + RRC_IMG_STRIDE * maxImages
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

self.setTrack = ({ content }: { content: string }): void => {
  processAvailableFonts(content)

  if (clampPos) content = fixPlayRes(content)
  if (dropAllBlur) content = dropBlur(content)

  const api = requireApi()
  const handle = requireHandle()
  withCString(content, (contentPtr) => {
    api.createTrackMem(handle, contentPtr)
  })
  subtitleColorSpace = libassYCbCrMap[api.getTrackColorSpace(handle)]
  postMessage({ target: 'verifyColorSpace', subtitleColorSpace })
}

self.getColorSpace = (): void => {
  postMessage({ target: 'verifyColorSpace', subtitleColorSpace })
}

self.freeTrack = (): void => {
  const api = requireApi()
  const handle = requireHandle()
  api.removeTrack(handle)
}

self.setTrackByUrl = ({ url }: { url: string }): void => {
  self.setTrack({ content: read_(url) as string })
}

// =============================================================================
// Time Management
// =============================================================================

let _isPaused = true

const getCurrentTime = (): number => {
  const diff = (Date.now() - lastCurrentTimeReceivedAt) / 1000
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
  lastCurrentTimeReceivedAt = Date.now()
  if (!rafId) {
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
  if (isPaused !== _isPaused) {
    _isPaused = isPaused
    if (isPaused) {
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    } else {
      lastCurrentTimeReceivedAt = Date.now()
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
  if (renderInFlight || !queuedRender) return
  const next = queuedRender
  queuedRender = null
  render(next.time, next.force)
}

const completeRenderCycle = (): void => {
  renderInFlight = false
  flushQueuedRender()
}

const render = (time: number, force?: boolean | number): void => {
  if (renderInFlight) {
    if (queuedRender) {
      queuedRender.time = time
      if (force) queuedRender.force = 1
    } else {
      queuedRender = { time, force: force ? 1 : undefined }
    }
    metrics.framesDropped++
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
  ensureRenderCollectBuffer(RENDER_COLLECT_MAX_IMAGES)

  const written =
    blendMode === 'wasm'
      ? api.renderBlendCollect(handle, time, forceInt, rrcBufPtr, rrcBufCapacity)
      : api.renderImageCollect(handle, time, forceInt, rrcBufPtr, rrcBufCapacity)

  const headerView = new Int32Array(self.wasmMemory.buffer, rrcBufPtr, RRC_HEADER_INTS)
  const changed = headerView[0]
  const imageCount = headerView[1]

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
    metrics.cacheHits++
  }

  metrics.totalEvents = api.getEventCount(handle)

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

    if (written === 0) return paintImages({ images, buffers, times })

    const imgDataOffset = rrcBufPtr + RRC_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT
    const meta = new Int32Array(self.wasmMemory.buffer, imgDataOffset, written * RRC_IMG_STRIDE)

    const useAsyncBitmapPath = asyncRender && offscreenRender !== true

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
        const rawData = self.HEAPU8C.slice(pointer, pointer + byteLength)

        const imageData = new ImageData(rawData as Uint8ClampedArray<ArrayBuffer>, item.w, item.h)

        promises[i] = asyncRenderOptions
          ? createImageBitmap(imageData, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
          : createImageBitmap(imageData)
        images[i] = item
      }

      Promise.all(promises).then((bitmaps) => {
        for (let i = 0; i < written; i++) {
          images[i].image = bitmaps[i]
        }
        if (debug) times.JSBitmapGenerationTime = Date.now() - (times.JSRenderTime || 0)
        paintImages({ images, buffers: bitmaps, times })
      }).catch(() => {
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
      for (let i = 0; i < written; ++i) {
        const metaOffset = i * RRC_IMG_STRIDE
        const item = getPooledItem(i)
        item.x = meta[metaOffset]
        item.y = meta[metaOffset + 1]
        item.w = meta[metaOffset + 2]
        item.h = meta[metaOffset + 3]
        item.image = meta[metaOffset + 4]

        if (!offCanvasCtx) {
          const imagePtr = item.image as number
          const buf = self.wasmMemory.buffer.slice(imagePtr, imagePtr + item.w * item.h * 4)
          buffers.push(buf)
          item.image = buf
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
  render(time)
}

const renderLoop = (force?: boolean | number): void => {
  rafId = null
  render(getCurrentTime(), force)
  if (!_isPaused) {
    rafId = requestAnimationFrame(renderLoop)
  }
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

    if (asyncRender) {
      // Batch draw all images
      for (let i = 0; i < imageCount; i++) {
        const img = images[i]
        if (img.image) {
          offCanvasCtx!.drawImage(img.image as ImageBitmap, img.x, img.y)
            ; (img.image as ImageBitmap).close()
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

          bufferCtx!.putImageData(
            new ImageData(
              new Uint8ClampedArray(
                rawData.buffer,
                rawData.byteOffset,
                rawData.byteLength
              ) as Uint8ClampedArray<ArrayBuffer>,
              imgW,
              imgH
            ),
            0,
            0
          )
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
const requestAnimationFrame = self.requestAnimationFrame ? self.requestAnimationFrame.bind(self) : ((): ((func: () => void) => number) => {
  let nextRAF = 0
  return (func: () => void): number => {
    const now = Date.now()
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
  if (typeof data.initialTime === 'number' && Number.isFinite(data.initialTime)) {
    lastCurrentTime = data.initialTime
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
      createTrackMem: Module._akarisub_create_track_mem,
      removeTrack: Module._akarisub_remove_track,
      resizeCanvas: Module._akarisub_resize_canvas,
      addFont: Module._akarisub_add_font,
      reloadFonts: Module._akarisub_reload_fonts,
      setDefaultFont: Module._akarisub_set_default_font,
      setFallbackFonts: Module._akarisub_set_fallback_fonts,
      setMemoryLimits: Module._akarisub_set_memory_limits,
      getEventCount: Module._akarisub_get_event_count,
      allocEvent: Module._akarisub_alloc_event,
      removeEvent: Module._akarisub_remove_event,
      getStyleCount: Module._akarisub_get_style_count,
      allocStyle: Module._akarisub_alloc_style,
      removeStyle: Module._akarisub_remove_style,
      styleOverrideIndex: Module._akarisub_style_override_index,
      disableStyleOverride: Module._akarisub_disable_style_override,
      renderBlend: Module._akarisub_render_blend,
      renderImage: Module._akarisub_render_image,
      getChanged: Module._akarisub_get_changed,
      getCount: Module._akarisub_get_count,
      getTime: Module._akarisub_get_time,
      getTrackColorSpace: Module._akarisub_get_track_color_space,
      eventGetInt: Module._akarisub_event_get_int,
      eventSetInt: Module._akarisub_event_set_int,
      eventGetStr: Module._akarisub_event_get_str,
      eventSetStr: Module._akarisub_event_set_str,
      styleGetNum: Module._akarisub_style_get_num,
      styleSetNum: Module._akarisub_style_set_num,
      styleGetStr: Module._akarisub_style_get_str,
      styleSetStr: Module._akarisub_style_set_str,
      rrX: Module._akarisub_render_result_x,
      rrY: Module._akarisub_render_result_y,
      rrW: Module._akarisub_render_result_w,
      rrH: Module._akarisub_render_result_h,
      rrImage: Module._akarisub_render_result_image,
      rrNext: Module._akarisub_render_result_next,
      rrCollect: Module._akarisub_render_result_collect,
      renderBlendCollect: Module._akarisub_render_blend_collect,
      renderImageCollect: Module._akarisub_render_image_collect
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
          await createImageBitmap(testData, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
            .catch(() => {
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
    if (!subContent) subContent = read_(data.subUrl) as string

    // For large files, emit partial_ready early to allow playback to start
    // while font loading and track parsing continues in the background
    const isLargeSubtitle = subContent.length > 500000
    if (isLargeSubtitle) {
      postMessage({ target: 'partial_ready' })
      if (debug) console.log('[AkariSub] Large subtitle detected, emitting partial_ready early')
    }

    processAvailableFonts(subContent)
    if (clampPos) subContent = fixPlayRes(subContent)
    if (dropAllBlur) subContent = dropBlur(subContent)

    // Check if we have preloaded fonts (Uint8Array)
    const hasPreloadedFonts = (data.fonts || []).some((font: string | Uint8Array) => typeof font !== 'string')

    // Write attached/preloaded fonts to filesystem
    for (const font of data.fonts || []) {
      if (typeof font === 'string') {
        asyncWrite(font, false)
      } else {
        writeFontToFSImmediate(font, false)
      }
    }

    if (hasPreloadedFonts) {
      if (debug) console.log('[AkariSub] Reloading fonts after writing', 'preloaded', 'fonts to FS')
      requireApi().reloadFonts(requireHandle())
      if (debug) console.log('[AkariSub] Font reload complete')
    }

    processAvailableFonts(subContent)

    withCString(subContent, (subPtr) => {
      requireApi().createTrackMem(requireHandle(), subPtr)
    })
    subtitleColorSpace = libassYCbCrMap[requireApi().getTrackColorSpace(requireHandle())]
    requireApi().setDropAnimations(requireHandle(), data.dropAllAnimations || 0)

    if (data.libassMemoryLimit > 0 || data.libassGlyphLimit > 0) {
      requireApi().setMemoryLimits(requireHandle(), data.libassGlyphLimit || 0, data.libassMemoryLimit || 0)
    }

    initPool()
    ensureRenderCollectBuffer(PREWARM_MAX_IMAGES)

    try {
      prewarmRenderer(lastCurrentTime)
    } catch (e) {
      if (debug) console.warn('[AkariSub] Prewarm render failed, continuing:', e)
    }

    postMessage({ target: 'ready' })
    postMessage({ target: 'verifyColorSpace', subtitleColorSpace })
  }

  loadWasm(data.wasmUrl).then(onWasmLoaded).catch((e) => {
    console.error('[AkariSub] WASM loading failed:', e)
    postMessage({ target: 'error', error: 'WASM loading failed: ' + (e && e.message ? e.message : String(e)) })
  })
}

// =============================================================================
// Canvas Management
// =============================================================================

self.offscreenCanvas = ({ transferable }: { transferable: [OffscreenCanvas] }): void => {
  offCanvas = transferable[0]
  offCanvasCtx = offCanvas.getContext('2d')
  if (!asyncRender) {
    bufferCanvas = new OffscreenCanvas(self.height, self.width)
    bufferCtx = bufferCanvas.getContext('2d', { desynchronized: true })
  }
  offscreenRender = true
}

self.detachOffscreen = (): void => {
  offCanvas = new OffscreenCanvas(self.height, self.width)
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
  if (_Module) {
    if (rrMetaPtr) {
      _Module._free(rrMetaPtr)
      rrMetaPtr = 0
      rrMetaCapacity = 0
    }
    if (rrcBufPtr) {
      _Module._free(rrcBufPtr)
      rrcBufPtr = 0
      rrcBufCapacity = 0
    }
  }
  if (akariSubHandle) {
    requireApi().destroy(akariSubHandle)
    akariSubHandle = 0
  }
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
}

self.getEvents = (): void => {
  const events: ASSEvent[] = []
  const api = requireApi()
  const count = api.getEventCount(requireHandle())
  for (let i = 0; i < count; i++) {
    events.push({ ...readEvent(i), _index: i })
  }
  postMessage({ target: 'getEvents', events })
}

self.setEvent = ({ event, index }: { event: Partial<ASSEvent>; index: number }): void => {
  applyEventFields(index, event)
}

self.removeEvent = ({ index }: { index: number }): void => {
  requireApi().removeEvent(requireHandle(), index)
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
      pendingRenders: Math.max(0, metrics.pendingRenders),
      totalEvents: metrics.totalEvents,
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

onmessage = ({ data }: MessageEvent): void => {
  if (self[data.target]) {
    self[data.target](data)
  } else {
    throw new Error('Unknown event target ' + data.target)
  }
}
