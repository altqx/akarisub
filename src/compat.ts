import { AkariSubCanvasRenderer, type BrowserRendererPerformanceStats, type BrowserRendererType } from './ts/browser-renderer'

export interface AkariSubCompatOptions {
  video: HTMLVideoElement
  subContent?: string
  subUrl?: string
  workerUrl?: string | URL
  wasmUrl?: string | URL
  blendMode?: string
  fonts?: Array<Uint8Array | string>
  fallbackFonts?: string[]
  availableFonts?: Record<string, string>
  useLocalFonts?: boolean
  clampPos?: boolean
  debug?: boolean
  offscreenRender?: boolean
  renderer?: BrowserRendererType | 'auto'
  onCanvasFallback?: () => void
}

type LoadedFont = {
  name: string
  data: Uint8Array
}

export default class AkariSub extends EventTarget {
  private renderer: AkariSubCanvasRenderer | null = null
  private readonly readyPromise: Promise<void>
  private disposed = false

  get rendererType(): BrowserRendererType {
    return this.renderer?.rendererType ?? 'canvas2d'
  }

  get offscreenRender(): boolean {
    return this.renderer?.usesOffscreenCanvas ?? false
  }

  constructor(private readonly options: AkariSubCompatOptions) {
    super()
    this.readyPromise = this.initialize()
  }

  freeTrack(): void {
    void this.run(async () => {
      await this.renderer?.clearTrack()
    })
  }

  setTrack(subContent: string): void {
    void this.run(async () => {
      await this.renderer?.loadTrackFromUtf8(subContent)
    })
  }

  resize(): void {
    void this.run(async () => {
      await this.renderer?.syncCanvasToVideo()
    })
  }

  destroy(): void {
    this.disposed = true
    const renderer = this.renderer
    this.renderer = null
    if (renderer) {
      void renderer.destroy()
    }
  }

  async getEventCount(): Promise<number> {
    await this.readyPromise
    return this.renderer?.eventCount ?? 0
  }

  async getStyleCount(): Promise<number> {
    await this.readyPromise
    return this.renderer?.styleCount ?? 0
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
        onDemandRender: false,
        pendingRenders: 0,
        totalEvents: 0,
        cacheHits: 0,
        cacheMisses: 0,
      }
    )
  }

  private async initialize(): Promise<void> {
    try {
      const renderer = await AkariSubCanvasRenderer.create({
        video: this.options.video,
        autoRender: true,
        renderer: this.options.renderer,
        offscreenRender: this.options.offscreenRender,
        onCanvasFallback: this.options.onCanvasFallback,
        fonts: {
          fallbackFonts: this.options.fallbackFonts,
        },
      })

      if (this.disposed) {
        await renderer.destroy()
        return
      }

      this.renderer = renderer

      const fonts = await this.loadFonts()
      for (const font of fonts) {
        await renderer.addFont(font.name, font.data)
      }

      const trackContent = await this.resolveTrackContent()
      if (trackContent) {
        await renderer.loadTrackFromUtf8(trackContent)
      }

      if (!this.disposed) {
        this.dispatchEvent(new Event('ready'))
      }
    } catch (error) {
      if (!this.disposed) {
        this.dispatchEvent(
          new CustomEvent('error', {
            detail: error instanceof Error ? error : new Error(String(error)),
          })
        )
      }

      throw error
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

  private async resolveTrackContent(): Promise<string | undefined> {
    if (this.options.subContent) {
      return this.options.subContent
    }

    if (!this.options.subUrl) {
      return undefined
    }

    const response = await fetch(this.options.subUrl)
    if (!response.ok) {
      throw new Error(`Failed to load subtitle track: ${response.status}`)
    }

    return response.text()
  }

  private async loadFonts(): Promise<LoadedFont[]> {
    const fonts: LoadedFont[] = []
    const seen = new Set<string>()
    let inlineIndex = 0

    for (const font of this.options.fonts ?? []) {
      if (typeof font === 'string') {
        const loaded = await this.fetchFont(font, fileNameFromUrl(font))
        if (loaded && !seen.has(loaded.name)) {
          seen.add(loaded.name)
          fonts.push(loaded)
        }
        continue
      }

      inlineIndex += 1
      fonts.push({
        name: `font-${inlineIndex}.bin`,
        data: font,
      })
    }

    for (const family of this.options.fallbackFonts ?? []) {
      const url = this.options.availableFonts?.[family.toLowerCase()]
      if (!url) {
        continue
      }

      const loaded = await this.fetchFont(url, `${sanitizeFontName(family)}${extensionFromUrl(url)}`)
      if (loaded && !seen.has(loaded.name)) {
        seen.add(loaded.name)
        fonts.push(loaded)
      }
    }

    return fonts
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

function sanitizeFontName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}