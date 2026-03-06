import { createEngine, type WasmEngineModule } from './wasm'

export interface FrameSize {
  width: number
  height: number
}

export interface FrameMargins {
  top: number
  bottom: number
  left: number
  right: number
}

export interface FontConfig {
  defaultFont?: string | null
  fallbackFonts?: string[]
  fontConfigPath?: string | null
}

export interface CompositedFrameResult {
  changed: number
  timestampMs: number
  width: number
  height: number
  pixels: Uint8Array
}

export interface RenderImageSlice {
  width: number
  height: number
  stride: number
  color: number
  x: number
  y: number
  pixels: Uint8Array
}

export interface ImageSliceFrameResult {
  changed: number
  timestampMs: number
  images: RenderImageSlice[]
}

export class AkariSubRenderer {
  private readonly engine: WasmEngineModule

  private constructor(engine: WasmEngineModule) {
    this.engine = engine
  }

  static async create(): Promise<AkariSubRenderer> {
    const engine = await createEngine()
    return new AkariSubRenderer(engine)
  }

  get runtimeVersion(): string {
    return this.engine.version()
  }

  get libassVersion(): number {
    return this.engine.libassVersion()
  }

  get hasTrack(): boolean {
    return this.engine.hasTrack()
  }

  get eventCount(): number {
    return this.engine.eventCount()
  }

  get styleCount(): number {
    return this.engine.styleCount()
  }

  get trackColorSpace(): number | null {
    return this.engine.trackColorSpace() ?? null
  }

  configureCanvas(frame: FrameSize, storage: FrameSize = frame): void {
    this.engine.setFrameSize(frame.width, frame.height)
    this.engine.setStorageSize(storage.width, storage.height)
  }

  setMargins(margins: FrameMargins): void {
    this.engine.setMargins(margins.top, margins.bottom, margins.left, margins.right)
  }

  setCacheLimits(glyphLimit: number, bitmapCacheLimit: number): void {
    this.engine.setCacheLimits(glyphLimit, bitmapCacheLimit)
  }

  setFonts(config: FontConfig = {}): void {
    this.engine.setFonts(config.defaultFont ?? null, config.fallbackFonts?.join(',') ?? null, config.fontConfigPath ?? null)
  }

  addFont(name: string, data: Uint8Array): void {
    this.engine.addFont(name, data)
  }

  clearFonts(): void {
    this.engine.clearFonts()
  }

  loadTrackFromUtf8(subtitleData: string): void {
    this.engine.loadTrackFromUtf8(subtitleData)
  }

  clearTrack(): void {
    this.engine.clearTrack()
  }

  renderImageSlices(timestampMs: number, force = false): ImageSliceFrameResult | null {
    const frame = this.engine.renderFrame(BigInt(Math.trunc(timestampMs)), force)
    if (!frame) return null

    const imageCount = this.engine.lastRenderImageCount()
    const images: RenderImageSlice[] = []

    for (let index = 0; index < imageCount; index++) {
      const image = this.engine.getLastRenderImage(index)
      if (!image) continue

      images.push({
        width: image.width,
        height: image.height,
        stride: image.stride,
        color: image.color,
        x: image.x,
        y: image.y,
        pixels: this.engine.getLastRenderImagePixels(index)
      })
    }

    return {
      changed: frame.changed,
      timestampMs: Number(frame.timestamp_ms),
      images
    }
  }

  renderCompositedFrame(timestampMs: number, force = false): CompositedFrameResult | null {
    const frame = this.engine.renderCompositedFrame(BigInt(Math.trunc(timestampMs)), force)
    if (!frame) return null

    return {
      changed: frame.changed,
      timestampMs: Number(frame.timestamp_ms),
      width: frame.width,
      height: frame.height,
      pixels: this.engine.getLastCompositedFramePixels()
    }
  }
}