import {
  AkariSubCanvasRenderer,
  type BrowserRendererPerformanceStats,
  type BrowserRendererType,
} from './ts/browser-renderer'
import type { ASSEvent, ASSStyle } from './ts/worker-types'

const LARGE_SUBTITLE_THRESHOLD = 500000

export interface AkariSubCompatOptions {
  video?: HTMLVideoElement
  canvas?: HTMLCanvasElement
  blendMode?: 'js' | 'wasm' | string
  asyncRender?: boolean
  offscreenRender?: boolean
  onDemandRender?: boolean
  targetFps?: number
  timeOffset?: number
  debug?: boolean
  prescaleFactor?: number
  prescaleHeightLimit?: number
  maxRenderHeight?: number
  dropAllAnimations?: boolean
  dropAllBlur?: boolean
  clampPos?: boolean
  subContent?: string
  subUrl?: string
  workerUrl?: string | URL
  wasmUrl?: string | URL
  fonts?: Array<Uint8Array | string>
  fallbackFonts?: string[]
  availableFonts?: Record<string, string | Uint8Array>
  useLocalFonts?: boolean
  libassMemoryLimit?: number
  libassGlyphLimit?: number
  renderer?: BrowserRendererType | 'auto'
  onCanvasFallback?: () => void
  renderAhead?: number
}

type LoadedFont = {
  name: string
  data: Uint8Array
}

type FontSource =
  | { kind: 'url'; url: string }
  | { kind: 'inline'; name: string; data: Uint8Array }

export default class AkariSub extends EventTarget {
  private renderer: AkariSubCanvasRenderer | null = null
  private readyPromise: Promise<void>
  private disposed = false
  private rendererVersion = 0
  private currentTrackContent?: string
  private fontSources: FontSource[] = []
  private defaultFont: string | null = null
  private manualCurrentTime = 0
  private manualPlaybackRate = 1
  private isPaused = true

  public timeOffset: number
  public debug: boolean
  public prescaleFactor: number
  public prescaleHeightLimit: number
  public maxRenderHeight: number
  public busy = false
  public renderAhead: number

  constructor(private options: AkariSubCompatOptions) {
    super()

    if (!options.video && !options.canvas) {
      throw this.destroy(new Error("Don't know where to render: you should give video or canvas in options."))
    }

    this.timeOffset = options.timeOffset ?? 0
    this.debug = !!options.debug
    this.prescaleFactor = options.prescaleFactor ?? 1
    this.prescaleHeightLimit = options.prescaleHeightLimit ?? 1080
    this.maxRenderHeight = options.maxRenderHeight ?? 0
    this.renderAhead = options.renderAhead ?? 0.008
    this.isPaused = options.video?.paused ?? true
    this.manualCurrentTime = options.video?.currentTime ?? 0
    this.manualPlaybackRate = options.video?.playbackRate ?? 1

    this.readyPromise = this.initializeRenderer(false)
  }

  get rendererType(): BrowserRendererType {
    return this.renderer?.rendererType ?? 'canvas2d'
  }

  get offscreenRender(): boolean {
    return this.renderer?.usesOffscreenCanvas ?? false
  }

  resize(): void {
    void this.run(async () => {
      await this.renderer?.syncCanvasToVideo()
      await this.renderAtCurrentTime(true)
    })
  }

  setVideo(video: HTMLVideoElement): void {
    this.options = {
      ...this.options,
      video,
    }
    this.manualCurrentTime = video.currentTime
    this.manualPlaybackRate = video.playbackRate
    this.isPaused = video.paused
    this.readyPromise = this.initializeRenderer(true)
  }

  runBenchmark(): void {
    console.warn('[akarisub] runBenchmark is not implemented in the Rust runtime')
  }

  setTrackByUrl(url: string): void {
    this.options = {
      ...this.options,
      subUrl: url,
      subContent: undefined,
    }

    void this.run(async () => {
      const trackContent = await this.resolveTrackContent()
      if (!trackContent) {
        await this.renderer?.clearTrack()
        this.currentTrackContent = undefined
        return
      }

      await this.loadTrack(trackContent, false)
    })
  }

  setTrack(content: string): void {
    this.options = {
      ...this.options,
      subContent: content,
      subUrl: undefined,
    }

    void this.run(async () => {
      await this.loadTrack(content, false)
    })
  }

  freeTrack(): void {
    void this.run(async () => {
      this.currentTrackContent = undefined
      await this.renderer?.clearTrack()
    })
  }

  setIsPaused(isPaused: boolean): void {
    this.isPaused = isPaused
    if (isPaused) {
      void this.run(async () => {
        await this.renderAtCurrentTime(true)
      })
    }
  }

  setRate(rate: number): void {
    this.manualPlaybackRate = rate
  }

  setCurrentTime(isPaused?: boolean, currentTime?: number, rate?: number): void {
    if (typeof isPaused === 'boolean') {
      this.isPaused = isPaused
    }
    if (typeof currentTime === 'number') {
      this.manualCurrentTime = currentTime
    }
    if (typeof rate === 'number') {
      this.manualPlaybackRate = rate
    }

    void this.run(async () => {
      await this.renderAtCurrentTime(true)
    })
  }

  createEvent(event: Partial<ASSEvent>): void {
    void this.run(async () => {
      await this.renderer?.createEvent(event)
      await this.renderAtCurrentTime(true)
    })
  }

  setEvent(event: Partial<ASSEvent>, index: number): void {
    void this.run(async () => {
      await this.renderer?.setEvent(index, event)
    })
  }

  removeEvent(index: number): void {
    void this.run(async () => {
      await this.renderer?.removeEvent(index)
    })
  }

  async getEvents(): Promise<ASSEvent[]> {
    await this.readyPromise
    return (await this.renderer?.getEvents()) ?? []
  }

  styleOverride(style: Partial<ASSStyle>): void {
    void this.run(async () => {
      const index = await this.renderer?.createStyle(style)
      if (typeof index === 'number') {
        await this.renderer?.styleOverride(index)
      }
    })
  }

  disableStyleOverride(): void {
    void this.run(async () => {
      await this.renderer?.disableStyleOverride()
    })
  }

  createStyle(style: Partial<ASSStyle>): void {
    void this.run(async () => {
      await this.renderer?.createStyle(style)
      await this.renderAtCurrentTime(true)
    })
  }

  setStyle(style: Partial<ASSStyle>, index: number): void {
    void this.run(async () => {
      await this.renderer?.setStyle(index, style)
    })
  }

  removeStyle(index: number): void {
    void this.run(async () => {
      await this.renderer?.removeStyle(index)
    })
  }

  async getStyles(): Promise<ASSStyle[]> {
    await this.readyPromise
    return (await this.renderer?.getStyles()) ?? []
  }

  addFont(font: string | Uint8Array): void {
    void this.run(async () => {
      const loaded = await this.resolveAdhocFont(font)
      if (!loaded) {
        return
      }

      if (typeof font === 'string') {
        this.fontSources.push({ kind: 'url', url: font })
      } else {
        this.fontSources.push({ kind: 'inline', name: loaded.name, data: loaded.data.slice() })
      }

      await this.renderer?.addFont(loaded.name, loaded.data)
      await this.renderAtCurrentTime(true)
    })
  }

  setDefaultFont(font: string): void {
    this.defaultFont = font
    void this.run(async () => {
      await this.renderer?.setDefaultFont(font)
      await this.renderAtCurrentTime(true)
    })
  }

  async getStats(): Promise<BrowserRendererPerformanceStats> {
    await this.readyPromise

    return (
      this.renderer?.getStats() ?? {
        framesRendered: 0,
        framesDropped: 0,
        avgRenderTime: 0,
        maxRenderTime: 0,
        minRenderTime: 0,
        lastRenderTime: 0,
        renderFps: 0,
        usingWorker: true,
        offscreenRender: false,
        onDemandRender: !!this.options.onDemandRender,
        pendingRenders: 0,
        totalEvents: 0,
        cacheHits: 0,
        cacheMisses: 0,
      }
    )
  }

  async resetStats(): Promise<void> {
    await this.readyPromise
    this.renderer?.resetStats()
  }

  async getEventCount(): Promise<number> {
    await this.readyPromise
    return this.renderer?.eventCount ?? 0
  }

  async getStyleCount(): Promise<number> {
    await this.readyPromise
    return this.renderer?.styleCount ?? 0
  }

  destroy(err?: Error | string): Error | undefined {
    const error = err ? this.toError(err) : undefined
    this.disposed = true

    const renderer = this.renderer
    this.renderer = null
    if (renderer) {
      void renderer.destroy()
    }

    return error
  }

  private async initializeRenderer(recreate: boolean): Promise<void> {
    const version = ++this.rendererVersion

    try {
      const trackContent = await this.resolveTrackContent()
      const renderer = await AkariSubCanvasRenderer.create({
        video: this.options.video,
        canvas: this.options.canvas,
        autoRender: true,
        onDemandRender: this.options.onDemandRender,
        targetFps: this.options.targetFps,
        renderer: this.options.renderer,
        offscreenRender: this.options.offscreenRender,
        onCanvasFallback: this.options.onCanvasFallback,
        prescaleFactor: this.prescaleFactor,
        prescaleHeightLimit: this.prescaleHeightLimit,
        maxRenderHeight: this.maxRenderHeight,
        fonts: {
          defaultFont: this.defaultFont,
          fallbackFonts: this.options.fallbackFonts,
        },
        cacheLimits:
          this.options.libassGlyphLimit != null || this.options.libassMemoryLimit != null
            ? {
                glyphLimit: this.options.libassGlyphLimit ?? 2048,
                bitmapCacheLimit: this.options.libassMemoryLimit ?? 128,
              }
            : undefined,
        workerOptions: {
          workerUrl: this.options.workerUrl,
          wasmUrl: normalizeUrl(this.options.wasmUrl),
        },
      })

      if (this.disposed || version !== this.rendererVersion) {
        await renderer.destroy()
        return
      }

      const fonts = await this.loadFonts(trackContent)
      for (const font of fonts) {
        await renderer.addFont(font.name, font.data)
      }

      if (this.defaultFont) {
        await renderer.setDefaultFont(this.defaultFont)
      }

      if (trackContent) {
        await this.loadTrack(trackContent, true, renderer)
      }

      const previous = this.renderer
      this.renderer = renderer
      if (previous) {
        await previous.destroy()
      }

      if (!this.disposed) {
        this.dispatchEvent(new Event('ready'))
      }
    } catch (error) {
      if (!this.disposed) {
        this.dispatchEvent(
          new CustomEvent('error', {
            detail: this.toError(error),
          })
        )
      }

      if (!recreate) {
        throw error
      }
    }
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    try {
      await this.readyPromise
      if (this.disposed) {
        return
      }

      await operation()
    } catch (error) {
      console.warn('[akarisub] compatibility operation failed', error)
    }
  }

  private async loadTrack(trackContent: string, initializing: boolean, renderer = this.renderer): Promise<void> {
    if (!renderer) {
      return
    }

    if (trackContent.length > LARGE_SUBTITLE_THRESHOLD) {
      this.dispatchEvent(new CustomEvent('partial_ready'))
    }

    const preparedTrack = this.preprocessTrackContent(trackContent)
    this.currentTrackContent = preparedTrack
    await renderer.loadTrackFromUtf8(preparedTrack)

    if (this.options.dropAllBlur) {
      const styles = await renderer.getStyles()
      await Promise.all(styles.map((_, index) => renderer.setStyle(index, { Blur: 0 })))
    }

    if (!initializing) {
      await this.renderAtCurrentTime(true, renderer)
    }
  }

  private async renderAtCurrentTime(force: boolean, renderer = this.renderer): Promise<void> {
    if (!renderer) {
      return
    }

    const baseTime = this.options.video ? this.options.video.currentTime : this.manualCurrentTime
    const playbackRate = this.options.video ? this.options.video.playbackRate : this.manualPlaybackRate
    const timestampMs = Math.round((baseTime + this.timeOffset + this.renderAhead * playbackRate) * 1000)

    this.busy = true
    try {
      await renderer.renderAt(timestampMs, force)
    } finally {
      this.busy = false
    }
  }

  private async resolveTrackContent(): Promise<string | undefined> {
    if (this.options.subContent) {
      return this.options.subContent
    }

    if (!this.options.subUrl) {
      return this.currentTrackContent
    }

    const response = await fetch(this.options.subUrl)
    if (!response.ok) {
      throw new Error(`Failed to load subtitle track: ${response.status}`)
    }

    return response.text()
  }

  private preprocessTrackContent(trackContent: string): string {
    let next = trackContent

    if (this.options.clampPos) {
      next = fixPlayRes(next)
    }

    if (this.options.dropAllAnimations) {
      next = next.replace(/\\t\([^)]*\)/g, '')
    }

    if (this.options.dropAllBlur) {
      next = next.replace(/\\blur[\d.]+/g, '')
      next = next.replace(/(^Style:[^\n]*(?:,[^\n]*){22},)[^,\n]*/gm, '$10')
    }

    return next
  }

  private async loadFonts(trackContent?: string): Promise<LoadedFont[]> {
    const fonts: LoadedFont[] = []
    const seen = new Set<string>()

    const pushFont = (font: LoadedFont | null) => {
      if (!font) {
        return
      }

      const key = `${font.name}:${font.data.byteLength}`
      if (seen.has(key)) {
        return
      }

      seen.add(key)
      fonts.push(font)
    }

    for (const font of this.options.fonts ?? []) {
      pushFont(await this.resolveAdhocFont(font))
    }

    for (const font of this.fontSources) {
      pushFont(await this.resolveFontSource(font))
    }

    const referencedFonts = new Set<string>()
    for (const family of this.options.fallbackFonts ?? []) {
      referencedFonts.add(family)
    }
    if (this.defaultFont) {
      referencedFonts.add(this.defaultFont)
    }

    if (trackContent) {
      for (const family of extractReferencedFontFamilies(trackContent)) {
        referencedFonts.add(family)
      }
    }

    for (const family of referencedFonts) {
      const lowerName = family.toLowerCase()
      const available = this.options.availableFonts?.[lowerName]
      if (available instanceof Uint8Array) {
        pushFont({
          name: `${sanitizeFontName(family)}.bin`,
          data: available,
        })
        continue
      }

      if (typeof available === 'string') {
        pushFont(await this.fetchFont(available, `${sanitizeFontName(family)}${extensionFromUrl(available)}`))
        continue
      }

      if (this.options.useLocalFonts) {
        pushFont(await this.loadLocalFont(family))
      }
    }

    return fonts
  }

  private async resolveAdhocFont(font: string | Uint8Array): Promise<LoadedFont | null> {
    if (typeof font === 'string') {
      return this.fetchFont(font, fileNameFromUrl(font))
    }

    return {
      name: `font-${this.fontSources.length + 1}.bin`,
      data: font,
    }
  }

  private async resolveFontSource(font: FontSource): Promise<LoadedFont | null> {
    if (font.kind === 'url') {
      return this.fetchFont(font.url, fileNameFromUrl(font.url))
    }

    return {
      name: font.name,
      data: font.data,
    }
  }

  private async fetchFont(url: string, fallbackName: string): Promise<LoadedFont | null> {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`font request failed: ${response.status}`)
      }

      return {
        name: fallbackName,
        data: new Uint8Array(await response.arrayBuffer()),
      }
    } catch (error) {
      console.warn('[akarisub] failed to preload font', url, error)
      return null
    }
  }

  private async loadLocalFont(name: string): Promise<LoadedFont | null> {
    const queryLocalFonts = (globalThis as typeof globalThis & {
      queryLocalFonts?: () => Promise<Array<{ family?: string; fullName?: string; postscriptName?: string; blob(): Promise<Blob> }>>
    }).queryLocalFonts

    if (!queryLocalFonts) {
      return null
    }

    try {
      const fonts = await queryLocalFonts()
      const lowerName = name.toLowerCase()
      const match = fonts.find((font) => {
        return [font.family, font.fullName, font.postscriptName].some((value) => value?.toLowerCase() === lowerName)
      })

      if (!match) {
        return null
      }

      const blob = await match.blob()
      return {
        name: `${sanitizeFontName(name)}.ttf`,
        data: new Uint8Array(await blob.arrayBuffer()),
      }
    } catch (error) {
      console.warn('[akarisub] local font access failed', name, error)
      return null
    }
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }
}

function normalizeUrl(url: string | URL | undefined): string | undefined {
  if (!url) {
    return undefined
  }

  return typeof url === 'string' ? url : url.toString()
}

function extractReferencedFontFamilies(content: string): string[] {
  const families = new Set<string>()

  for (const match of content.matchAll(/^Style:[^,]*,([^,\n]+)/gm)) {
    const family = match[1]?.trim()
    if (family) {
      families.add(family)
    }
  }

  for (const match of content.matchAll(/\\fn([^\\}]*?)[\\}]/g)) {
    const family = match[1]?.trim()
    if (family) {
      families.add(family)
    }
  }

  return [...families]
}

function fileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin)
    const segment = parsed.pathname.split('/').pop()
    return segment && segment.length > 0 ? decodeURIComponent(segment) : 'font.bin'
  } catch {
    const segment = url.split('/').pop()
    return segment && segment.length > 0 ? decodeURIComponent(segment) : 'font.bin'
  }
}

function extensionFromUrl(url: string): string {
  const fileName = fileNameFromUrl(url)
  const index = fileName.lastIndexOf('.')
  return index >= 0 ? fileName.slice(index) : '.bin'
}

const commonResolutions = [
  { w: 7680, h: 4320 },
  { w: 3840, h: 2160 },
  { w: 2560, h: 1440 },
  { w: 1920, h: 1080 },
  { w: 1280, h: 720 },
]

function detectSourceResolution(maxX: number, maxY: number): { w: number; h: number } {
  const sorted = [...commonResolutions].sort((a, b) => a.w - b.w)

  for (const resolution of sorted) {
    if (maxX <= resolution.w && maxY <= resolution.h) {
      return resolution
    }
  }

  return {
    w: Math.ceil(maxX / 100) * 100,
    h: Math.ceil(maxY / 100) * 100,
  }
}

function formatScaledValue(value: number, original?: string): string | number {
  return original?.includes('.') ? value.toFixed(2).replace(/\.?0+$/, '') : Math.round(value)
}

function fixPlayRes(subContent: string): string {
  const playResXMatch = subContent.match(/PlayResX:\s*(\d+)/i)
  const playResYMatch = subContent.match(/PlayResY:\s*(\d+)/i)

  const playResX = playResXMatch ? parseInt(playResXMatch[1], 10) : 1920
  const playResY = playResYMatch ? parseInt(playResYMatch[1], 10) : 1080

  const posRegex = /\\pos\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g
  const moveRegex = /\\move\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g
  const orgRegex = /\\org\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g
  const clipRectRegex = /\\i?clip\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g

  let maxX = 0
  let maxY = 0

  const findMax = (regex: RegExp, xIndices: number[], yIndices: number[]) => {
    const regexCopy = new RegExp(regex.source, 'g')
    let match: RegExpExecArray | null

    while ((match = regexCopy.exec(subContent)) !== null) {
      for (const index of xIndices) {
        const value = match[index]
        if (!value) {
          continue
        }
        maxX = Math.max(maxX, Math.abs(parseFloat(value)))
      }

      for (const index of yIndices) {
        const value = match[index]
        if (!value) {
          continue
        }
        maxY = Math.max(maxY, Math.abs(parseFloat(value)))
      }
    }
  }

  findMax(posRegex, [1], [2])
  findMax(moveRegex, [1, 3], [2, 4])
  findMax(orgRegex, [1], [2])
  findMax(clipRectRegex, [1, 3], [2, 4])

  if (maxX <= playResX && maxY <= playResY) {
    return subContent
  }

  const sourceResolution = detectSourceResolution(maxX, maxY)
  const scaleX = playResX / sourceResolution.w
  const scaleY = playResY / sourceResolution.h
  const minScale = Math.min(scaleX, scaleY)
  const maxScale = Math.max(scaleX, scaleY)

  const eventsMatch = subContent.match(/(\[Events\][\s\S]*)/i)
  if (!eventsMatch || eventsMatch.index == null) {
    return subContent
  }

  let eventsSection = eventsMatch[1]

  eventsSection = eventsSection.replace(
    posRegex,
    (_match, x, y) => `\\pos(${formatScaledValue(parseFloat(x) * scaleX, x)},${formatScaledValue(parseFloat(y) * scaleY, y)})`
  )

  eventsSection = eventsSection.replace(
    /\\move\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?:\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+))?\s*\)/g,
    (_match, x1, y1, x2, y2, t1, t2) => {
      const scaled = `\\move(${formatScaledValue(parseFloat(x1) * scaleX, x1)},${formatScaledValue(parseFloat(y1) * scaleY, y1)},${formatScaledValue(parseFloat(x2) * scaleX, x2)},${formatScaledValue(parseFloat(y2) * scaleY, y2)}`
      return t1 ? `${scaled},${t1},${t2})` : `${scaled})`
    }
  )

  eventsSection = eventsSection.replace(
    orgRegex,
    (_match, x, y) => `\\org(${formatScaledValue(parseFloat(x) * scaleX, x)},${formatScaledValue(parseFloat(y) * scaleY, y)})`
  )

  eventsSection = eventsSection.replace(
    /\\(i?clip)\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g,
    (_match, type, x1, y1, x2, y2) =>
      `\\${type}(${formatScaledValue(parseFloat(x1) * scaleX, x1)},${formatScaledValue(parseFloat(y1) * scaleY, y1)},${formatScaledValue(parseFloat(x2) * scaleX, x2)},${formatScaledValue(parseFloat(y2) * scaleY, y2)})`
  )

  eventsSection = eventsSection.replace(/\\fs([\d.]+)/g, (_match, size) => `\\fs${formatScaledValue(parseFloat(size) * maxScale, size)}`)
  eventsSection = eventsSection.replace(/\\xbord([\d.]+)/g, (_match, size) => `\\xbord${formatScaledValue(parseFloat(size) * scaleX, size)}`)
  eventsSection = eventsSection.replace(/\\ybord([\d.]+)/g, (_match, size) => `\\ybord${formatScaledValue(parseFloat(size) * scaleY, size)}`)
  eventsSection = eventsSection.replace(/\\xshad(-?[\d.]+)/g, (_match, size) => `\\xshad${formatScaledValue(parseFloat(size) * scaleX, size)}`)
  eventsSection = eventsSection.replace(/\\yshad(-?[\d.]+)/g, (_match, size) => `\\yshad${formatScaledValue(parseFloat(size) * scaleY, size)}`)

  for (const tag of ['fsp', 'bord', 'shad', 'be', 'blur']) {
    const regex = new RegExp(`\\\\${tag}(-?[\\d.]+)`, 'g')
    eventsSection = eventsSection.replace(regex, (_match, size) => `\\${tag}${formatScaledValue(parseFloat(size) * minScale, size)}`)
  }

  eventsSection = eventsSection.replace(/(\\i?clip\s*\([^,)]+m[^)]+\)|\\p[1-9][^}]*?)(?=[\\}]|$)/g, (match) => {
    return match.replace(/(-?[\d.]+)\s+(-?[\d.]+)/g, (_point, x, y) => {
      return `${formatScaledValue(parseFloat(x) * scaleX, x)} ${formatScaledValue(parseFloat(y) * scaleY, y)}`
    })
  })

  return subContent.substring(0, eventsMatch.index) + eventsSection
}

function sanitizeFontName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}