/**
 * JASSUB Worker - TypeScript implementation.
 * Runs in a Web Worker to offload subtitle rendering from the main thread.
 */

/// <reference lib="webworker" />

// @ts-ignore - WASM module is aliased during build
import WASM from 'wasm'

import type {
  ASSEvent,
  ASSStyle,
  JASSUBModule,
  JASSUBWasmObject,
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
let fontId = 0
let debug = false
let clampPos = false

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
let offCanvas: OffscreenCanvas | null = null
let offCanvasCtx: OffscreenCanvasRenderingContext2D | null = null
let offscreenRender: boolean | 'hybrid' = false
let bufferCanvas: OffscreenCanvas | null = null
let bufferCtx: OffscreenCanvasRenderingContext2D | null = null
let jassubObj: JASSUBWasmObject | null = null
let subtitleColorSpace: SubtitleColorSpace = null
let dropAllBlur = false
let _malloc: (size: number) => number
let hasBitmapBug = false

// Pre-allocated object pool for render results
const MAX_POOLED_IMAGES = 128
const imagePool: RenderResultItem[] = new Array(MAX_POOLED_IMAGES)
let poolInitialized = false

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

// =============================================================================
// Font Management
// =============================================================================

self.addFont = ({ font }: { font: string | Uint8Array }) => asyncWrite(font)

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

const asyncWrite = (font: string | Uint8Array): void => {
  if (typeof font === 'string') {
    readAsync(
      font,
      (fontData) => {
        allocFont(new Uint8Array(fontData))
      },
      console.error
    )
  } else {
    allocFont(font)
  }
}

// Debounced font reload
let pendingFontReload: ReturnType<typeof setTimeout> | null = null
const scheduleReloadFonts = (): void => {
  if (pendingFontReload) return
  pendingFontReload = setTimeout(() => {
    pendingFontReload = null
    if (jassubObj) jassubObj.reloadFonts()
  }, 16)
}

const allocFont = (uint8: Uint8Array): void => {
  const ptr = _malloc(uint8.byteLength)
  self.HEAPU8.set(uint8, ptr)
  jassubObj!.addFont('font-' + fontId++, ptr, uint8.byteLength)
  scheduleReloadFonts()
}

const processAvailableFonts = (content: string): void => {
  if (!availableFonts) return
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

  jassubObj!.createTrackMem(content)
  subtitleColorSpace = libassYCbCrMap[jassubObj!.trackColorSpace]
  postMessage({ target: 'verifyColorSpace', subtitleColorSpace })
}

self.getColorSpace = (): void => {
  postMessage({ target: 'verifyColorSpace', subtitleColorSpace })
}

self.freeTrack = (): void => {
  jassubObj!.removeTrack()
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
        clearTimeout(rafId)
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

const render = (time: number, force?: boolean | number): void => {
  initPool() // Ensure pool is ready

  const times: RenderTimes = {}
  const renderStartTime = performance.now()
  metrics.renderStartTime = renderStartTime
  metrics.pendingRenders++

  const renderResult =
    blendMode === 'wasm' ? jassubObj!.renderBlend(time, force ? 1 : 0) : jassubObj!.renderImage(time, force ? 1 : 0)

  // Update metrics
  const renderEndTime = performance.now()
  const renderDuration = renderEndTime - renderStartTime
  metrics.lastRenderTime = renderDuration
  metrics.totalRenderTime += renderDuration
  metrics.maxRenderTime = Math.max(metrics.maxRenderTime, renderDuration)
  if (renderDuration > 0) {
    metrics.minRenderTime = Math.min(metrics.minRenderTime, renderDuration)
  }

  if (jassubObj!.changed !== 0 || force) {
    metrics.framesRendered++
    metrics.cacheMisses++
  } else {
    metrics.cacheHits++
  }

  if (jassubObj && jassubObj.getEventCount) {
    metrics.totalEvents = jassubObj.getEventCount()
  }

  if (debug) {
    const decodeEndTime = performance.now()
    const renderEndTimeWasm = jassubObj!.time
    times.WASMRenderTime = renderEndTimeWasm - renderStartTime
    times.WASMBitmapDecodeTime = decodeEndTime - renderEndTimeWasm
    times.JSRenderTime = Date.now()
  }

  if (jassubObj!.changed !== 0 || force) {
    const imageCount = jassubObj!.count
    const images: RenderResultItem[] = new Array(imageCount)
    const buffers: ArrayBuffer[] = []

    if (!renderResult) return paintImages({ images: [], buffers, times })

    if (asyncRender) {
      const promises: Promise<ImageBitmap>[] = new Array(imageCount)
      let result = renderResult

      for (let i = 0; i < imageCount; result = result.next!, ++i) {
        const item = getPooledItem(i)
        item.w = result.w
        item.h = result.h
        item.x = result.x
        item.y = result.y
        item.image = 0

        const pointer = result.image
        const byteLength = item.w * item.h * 4

        // Avoid slice when possible
        const rawData = hasBitmapBug
          ? self.HEAPU8C.slice(pointer, pointer + byteLength)
          : self.HEAPU8C.subarray(pointer, pointer + byteLength)

        promises[i] = createImageBitmap(
          new ImageData(
            new Uint8ClampedArray(
              rawData.buffer,
              rawData.byteOffset,
              rawData.byteLength
            ) as Uint8ClampedArray<ArrayBuffer>,
            item.w,
            item.h
          )
        )
        images[i] = item
      }

      Promise.all(promises).then((bitmaps) => {
        for (let i = 0; i < imageCount; i++) {
          images[i].image = bitmaps[i]
        }
        if (debug) times.JSBitmapGenerationTime = Date.now() - (times.JSRenderTime || 0)
        paintImages({ images, buffers: bitmaps, times })
      })
    } else {
      let result = renderResult
      for (let i = 0; i < imageCount; result = result.next!, ++i) {
        const item = getPooledItem(i)
        item.w = result.w
        item.h = result.h
        item.x = result.x
        item.y = result.y
        item.image = result.image

        if (!offCanvasCtx) {
          const buf = self.wasmMemory.buffer.slice(result.image, result.image + result.w * result.h * 4)
          buffers.push(buf)
          item.image = buf
        }
        images[i] = item
      }
      paintImages({ images, buffers, times })
    }
  } else {
    postMessage({ target: 'unbusy' })
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
      if (!imageCount) return postMessage(resultObject)
      if (debug) times.bitmaps = imageCount
      try {
        const bitmap = offCanvas!.transferToImageBitmap()
        const result = {
          ...resultObject,
          images: [{ image: bitmap, x: 0, y: 0 }],
          asyncRender: true
        }
        postMessage(result, [bitmap])
      } catch {
        postMessage({ target: 'unbusy' })
      }
    } else {
      if (debug) {
        times.JSRenderTime = Date.now() - (times.JSRenderTime || 0) - (times.JSBitmapGenerationTime || 0)
        let total = 0
        for (const key in times) total += (times as any)[key] || 0
        console.log('Bitmaps: ' + imageCount + ' Total: ' + (total | 0) + 'ms', times)
      }
      postMessage({ target: 'unbusy' })
    }
  } else {
    postMessage(resultObject, buffers as Transferable[])
  }
}

// Custom requestAnimationFrame for worker
const requestAnimationFrame = ((): ((func: () => void) => number) => {
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

// =============================================================================
// WASM Initialization
// =============================================================================

self.init = async (data: any): Promise<void> => {
  hasBitmapBug = data.hasBitmapBug

  const _fetch = self.fetch
  const setWasmUrl = (wasmUrl: string): void => {
    if ((WebAssembly as any).instantiateStreaming) {
      self.fetch = (_: any) => _fetch(wasmUrl)
    }
  }

  const loadWasm = (wasmUrl: string): Promise<JASSUBModule> => {
    setWasmUrl(wasmUrl)
    return WASM({
      wasm: !(WebAssembly as any).instantiateStreaming ? (read_(wasmUrl, true) as ArrayBuffer) : undefined
    })
  }

  const onWasmLoaded = (Module: JASSUBModule): void => {
    _malloc = Module._malloc
    self.width = data.width
    self.height = data.height
    blendMode = data.blendMode
    asyncRender = data.asyncRender

    if (asyncRender && typeof createImageBitmap === 'undefined') {
      asyncRender = false
      console.error("'createImageBitmap' needed for 'asyncRender' unsupported!")
    }

    availableFonts = data.availableFonts
    debug = data.debug
    targetFps = data.targetFps || targetFps
    useLocalFonts = data.useLocalFonts
    dropAllBlur = data.dropAllBlur
    clampPos = data.clampPos

    const fallbackFont = data.fallbackFont.toLowerCase()
    jassubObj = new Module.JASSUB(self.width, self.height, fallbackFont || null, debug)

    if (fallbackFont) findAvailableFonts(fallbackFont)

    let subContent = data.subContent
    if (!subContent) subContent = read_(data.subUrl) as string

    processAvailableFonts(subContent)
    if (clampPos) subContent = fixPlayRes(subContent)
    if (dropAllBlur) subContent = dropBlur(subContent)

    for (const font of data.fonts || []) asyncWrite(font)

    jassubObj.createTrackMem(subContent)
    subtitleColorSpace = libassYCbCrMap[jassubObj.trackColorSpace]
    jassubObj.setDropAnimations(data.dropAllAnimations || 0)

    if (data.libassMemoryLimit > 0 || data.libassGlyphLimit > 0) {
      jassubObj.setMemoryLimits(data.libassGlyphLimit || 0, data.libassMemoryLimit || 0)
    }

    postMessage({ target: 'ready' })
    postMessage({ target: 'verifyColorSpace', subtitleColorSpace })
  }

  loadWasm(data.wasmUrl).then(onWasmLoaded)
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
  if (jassubObj) jassubObj.resizeCanvas(width, height, videoWidth, videoHeight)
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
  jassubObj!.quitLibrary()
}

// =============================================================================
// Event Management
// =============================================================================

const _applyKeys = <T extends object>(input: Partial<T>, output: T): void => {
  for (const v of Object.keys(input) as (keyof T)[]) {
    ;(output as any)[v] = input[v]
  }
}

self.createEvent = ({ event }: { event: Partial<ASSEvent> }): void => {
  _applyKeys(event, jassubObj!.getEvent(jassubObj!.allocEvent()))
}

self.getEvents = (): void => {
  const events: ASSEvent[] = []
  for (let i = 0; i < jassubObj!.getEventCount(); i++) {
    const { Start, Duration, ReadOrder, Layer, Style, MarginL, MarginR, MarginV, Name, Text, Effect } =
      jassubObj!.getEvent(i)
    events.push({
      Start,
      Duration,
      ReadOrder,
      Layer,
      Style,
      MarginL,
      MarginR,
      MarginV,
      Name,
      Text,
      Effect,
      _index: i
    })
  }
  postMessage({ target: 'getEvents', events })
}

self.setEvent = ({ event, index }: { event: Partial<ASSEvent>; index: number }): void => {
  _applyKeys(event, jassubObj!.getEvent(index))
}

self.removeEvent = ({ index }: { index: number }): void => {
  jassubObj!.removeEvent(index)
}

// =============================================================================
// Style Management
// =============================================================================

self.createStyle = ({ style }: { style: Partial<ASSStyle> }): any => {
  const alloc = jassubObj!.getStyle(jassubObj!.allocStyle())
  _applyKeys(style, alloc)
  return alloc
}

self.getStyles = (): void => {
  const styles: ASSStyle[] = []
  for (let i = 0; i < jassubObj!.getStyleCount(); i++) {
    const {
      Name,
      FontName,
      FontSize,
      PrimaryColour,
      SecondaryColour,
      OutlineColour,
      BackColour,
      Bold,
      Italic,
      Underline,
      StrikeOut,
      ScaleX,
      ScaleY,
      Spacing,
      Angle,
      BorderStyle,
      Outline,
      Shadow,
      Alignment,
      MarginL,
      MarginR,
      MarginV,
      Encoding,
      treat_fontname_as_pattern,
      Blur,
      Justify
    } = jassubObj!.getStyle(i)
    styles.push({
      Name,
      FontName,
      FontSize,
      PrimaryColour,
      SecondaryColour,
      OutlineColour,
      BackColour,
      Bold,
      Italic,
      Underline,
      StrikeOut,
      ScaleX,
      ScaleY,
      Spacing,
      Angle,
      BorderStyle,
      Outline,
      Shadow,
      Alignment,
      MarginL,
      MarginR,
      MarginV,
      Encoding,
      treat_fontname_as_pattern,
      Blur,
      Justify
    })
  }
  postMessage({ target: 'getStyles', time: Date.now(), styles })
}

self.setStyle = ({ style, index }: { style: Partial<ASSStyle>; index: number }): void => {
  _applyKeys(style, jassubObj!.getStyle(index))
}

self.removeStyle = ({ index }: { index: number }): void => {
  jassubObj!.removeStyle(index)
}

self.styleOverride = (data: { style: Partial<ASSStyle> }): void => {
  jassubObj!.styleOverride(self.createStyle(data))
}

self.disableStyleOverride = (): void => {
  jassubObj!.disableStyleOverride()
}

self.defaultFont = ({ font }: { font: string }): void => {
  jassubObj!.setDefaultFont(font)
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
