import type {
  CompositedFrameResult,
  FontConfig,
  FrameMargins,
  FrameSize,
  ImageSliceFrameResult,
} from './renderer'
import { AkariSubWorkerClient, type WorkerClientCreateOptions } from './worker-client'
import type { ASSEvent, ASSStyle } from './worker-types'

export interface AsyncRendererCreateOptions extends WorkerClientCreateOptions {
  frame: FrameSize
  storage?: FrameSize
  margins?: FrameMargins
  fonts?: FontConfig
  wasmUrl?: string
  cacheLimits?: {
    glyphLimit: number
    bitmapCacheLimit: number
  }
}

export interface AsyncRendererState {
  runtimeVersion: string
  libassVersion: number
  hasTrack: boolean
  eventCount: number
  styleCount: number
  trackColorSpace: number | null
}

export class AkariSubAsyncRenderer {
  private readonly client: AkariSubWorkerClient
  private state: AsyncRendererState

  private constructor(client: AkariSubWorkerClient, state: AsyncRendererState) {
    this.client = client
    this.state = state
  }

  static async create(options: AsyncRendererCreateOptions): Promise<AkariSubAsyncRenderer> {
    const client = AkariSubWorkerClient.create(options)
    const ready = await client.init({
      type: 'init',
      frame: options.frame,
      storage: options.storage,
      margins: options.margins,
      fonts: options.fonts,
      wasmUrl: options.wasmUrl,
      cacheLimits: options.cacheLimits,
    })

    return new AkariSubAsyncRenderer(client, {
      runtimeVersion: ready.runtimeVersion,
      libassVersion: ready.libassVersion,
      hasTrack: false,
      eventCount: 0,
      styleCount: 0,
      trackColorSpace: null,
    })
  }

  get runtimeVersion(): string {
    return this.state.runtimeVersion
  }

  get libassVersion(): number {
    return this.state.libassVersion
  }

  get hasTrack(): boolean {
    return this.state.hasTrack
  }

  get eventCount(): number {
    return this.state.eventCount
  }

  get styleCount(): number {
    return this.state.styleCount
  }

  get trackColorSpace(): number | null {
    return this.state.trackColorSpace
  }

  async configureCanvas(frame: FrameSize, storage?: FrameSize, margins?: FrameMargins): Promise<void> {
    const ack = await this.client.configureCanvas(frame, storage, margins)
    this.applyAck(ack)
  }

  async setFonts(fonts: FontConfig): Promise<void> {
    const ack = await this.client.setFonts(fonts)
    this.applyAck(ack)
  }

  async setCacheLimits(glyphLimit: number, bitmapCacheLimit: number): Promise<void> {
    const ack = await this.client.setCacheLimits(glyphLimit, bitmapCacheLimit)
    this.applyAck(ack)
  }

  async addFont(name: string, data: Uint8Array): Promise<void> {
    const ack = await this.client.addFont(name, data)
    this.applyAck(ack)
  }

  async attachOffscreenCanvas(canvas: OffscreenCanvas, width: number, height: number): Promise<void> {
    const ack = await this.client.attachOffscreenCanvas(canvas, width, height)
    this.applyAck(ack)
  }

  async loadTrackFromUtf8(subtitleData: string): Promise<void> {
    const ack = await this.client.loadTrack(subtitleData)
    this.applyAck(ack)
  }

  async setDefaultFont(font: string | null): Promise<void> {
    const ack = await this.client.setDefaultFont(font)
    this.applyAck(ack)
  }

  async createEvent(event: Partial<ASSEvent>): Promise<number> {
    const index = await this.client.createEvent(event)
    this.state = {
      ...this.state,
      hasTrack: true,
      eventCount: Math.max(this.state.eventCount, index + 1),
    }
    return index
  }

  async setEvent(index: number, event: Partial<ASSEvent>): Promise<void> {
    const ack = await this.client.setEvent(index, event)
    this.applyAck(ack)
  }

  async removeEvent(index: number): Promise<void> {
    const ack = await this.client.removeEvent(index)
    this.applyAck(ack)
  }

  getEvents(): Promise<ASSEvent[]> {
    return this.client.getEvents()
  }

  async createStyle(style: Partial<ASSStyle>): Promise<number> {
    const index = await this.client.createStyle(style)
    this.state = {
      ...this.state,
      hasTrack: true,
      styleCount: Math.max(this.state.styleCount, index + 1),
    }
    return index
  }

  async setStyle(index: number, style: Partial<ASSStyle>): Promise<void> {
    const ack = await this.client.setStyle(index, style)
    this.applyAck(ack)
  }

  async removeStyle(index: number): Promise<void> {
    const ack = await this.client.removeStyle(index)
    this.applyAck(ack)
  }

  getStyles(): Promise<ASSStyle[]> {
    return this.client.getStyles()
  }

  async styleOverride(index: number): Promise<void> {
    const ack = await this.client.styleOverride(index)
    this.applyAck(ack)
  }

  async disableStyleOverride(): Promise<void> {
    const ack = await this.client.disableStyleOverride()
    this.applyAck(ack)
  }

  async clearTrack(): Promise<void> {
    const ack = await this.client.clearTrack()
    this.applyAck(ack)
  }

  async clearFonts(): Promise<void> {
    const ack = await this.client.clearFonts()
    this.applyAck(ack)
  }

  renderCompositedFrame(timestampMs: number, force = false): Promise<CompositedFrameResult | null> {
    return this.client.renderCompositedFrame(timestampMs, force)
  }

  renderImageSlices(timestampMs: number, force = false): Promise<ImageSliceFrameResult | null> {
    return this.client.renderImageSlices(timestampMs, force)
  }

  renderOffscreenFrame(timestampMs: number, force = false): Promise<{ changed: number; timestampMs: number }> {
    return this.client.renderOffscreenFrame(timestampMs, force)
  }

  async dispose(): Promise<void> {
    await this.client.dispose()
    this.state = {
      ...this.state,
      hasTrack: false,
      eventCount: 0,
      styleCount: 0,
      trackColorSpace: null,
    }
  }

  terminate(): void {
    this.client.terminate()
    this.state = {
      ...this.state,
      hasTrack: false,
      eventCount: 0,
      styleCount: 0,
      trackColorSpace: null,
    }
  }

  private applyAck(ack: { hasTrack: boolean; eventCount: number; styleCount: number; trackColorSpace: number | null }): void {
    this.state = {
      ...this.state,
      hasTrack: ack.hasTrack,
      eventCount: ack.eventCount,
      styleCount: ack.styleCount,
      trackColorSpace: ack.trackColorSpace,
    }
  }
}