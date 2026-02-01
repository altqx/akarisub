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
let attachedFontId = 0  // For attached/preloaded fonts (higher priority)
let fallbackFontId = 0  // For fallback fonts (lower priority)
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
let hasBitmapBug = false
let _Module: JASSUBModule | null = null

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
    if (jassubObj) jassubObj.reloadFonts()
  }, 16)
}

/**
 * Add a font as an embedded font via ass_add_font.
 * Embedded fonts have higher priority than fontconfig fonts in libass.
 */
const addFontAsEmbedded = (uint8: Uint8Array, name: string): void => {
  if (!_Module || !jassubObj) {
    if (debug) console.warn('[JASSUB] Cannot add embedded font, module or jassubObj not ready:', name)
    return
  }

  try {
    // Allocate memory in WASM heap and copy font data
    const ptr = _Module._malloc(uint8.length)
    if (!ptr) {
      console.warn('[JASSUB] Failed to allocate memory for embedded font:', name)
      return
    }

    // Copy font data to WASM heap
    self.HEAPU8.set(uint8, ptr)

    // Call jassubObj.addFont which calls ass_add_font and frees the memory
    jassubObj.addFont(name, ptr, uint8.length)

    if (debug) console.log('[JASSUB] Added embedded font:', name, 'size:', uint8.length)
  } catch (e) {
    console.warn('[JASSUB] Failed to add embedded font:', name, e)
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
      if (debug) console.log('[JASSUB] Wrote font to FS:', fontDir + '/' + fontFileName, 'size:', uint8.length)
    } catch (e) {
      console.warn('Failed to write font to filesystem:', fontDir + '/' + fontFileName, e)
    }

    if (!isFallback) {
      addFontAsEmbedded(uint8, fontFileName)
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
          ),
          { premultiplyAlpha: 'none' }
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

  const onWasmLoaded = async (Module: JASSUBModule): Promise<void> => {
    _Module = Module // Store module reference for FS access

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
      const encoder = new TextEncoder()
      const fontsConfData = encoder.encode(fontsConf)
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

    availableFonts = data.availableFonts
    debug = data.debug
    targetFps = data.targetFps || targetFps
    useLocalFonts = data.useLocalFonts
    dropAllBlur = data.dropAllBlur
    clampPos = data.clampPos

    // Normalize fallback fonts to lowercase and deduplicate
    const fallbackFonts: string[] = []
    if (data.fallbackFonts && data.fallbackFonts.length > 0) {
      for (const font of data.fallbackFonts) {
        const lowerFont = font.toLowerCase()
        if (lowerFont && !fallbackFonts.includes(lowerFont)) {
          fallbackFonts.push(lowerFont)
        }
      }
    }

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
                  if (debug) console.log('[JASSUB] Loaded fallback font async:', fontKey)
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
            console.warn('[JASSUB] Fallback font loading timeout, continuing with available fonts')
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
          console.log('[JASSUB] All fallback fonts loaded successfully')
        }
      }
    }

    await loadFallbackFontsAsync()

    const primaryFallback = fallbackFonts.length > 0 ? fallbackFonts[0] : null
    jassubObj = new Module.JASSUB(self.width, self.height, primaryFallback, debug)

    if (fallbackFonts.length > 0) {
      jassubObj.setFallbackFonts(fallbackFonts.join(','))
    }

    let subContent = data.subContent
    if (!subContent) subContent = read_(data.subUrl) as string

    // For large files, emit partial_ready early to allow playback to start
    // while font loading and track parsing continues in the background
    const isLargeSubtitle = subContent.length > 500000
    if (isLargeSubtitle) {
      postMessage({ target: 'partial_ready' })
      if (debug) console.log('[JASSUB] Large subtitle detected, emitting partial_ready early')
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
      if (debug) console.log('[JASSUB] Reloading fonts after writing', 'preloaded', 'fonts to FS')
      jassubObj.reloadFonts()
      if (debug) console.log('[JASSUB] Font reload complete')
    }

    processAvailableFonts(subContent)

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
    ; (output as any)[v] = input[v]
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

self.getEventCount = (): void => {
  const count = jassubObj ? jassubObj.getEventCount() : 0
  postMessage({ target: 'getEventCount', count })
}

self.getStyleCount = (): void => {
  const count = jassubObj ? jassubObj.getStyleCount() : 0
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
