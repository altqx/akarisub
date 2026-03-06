export { default } from './compat'
export { initWasm, isWasmInitialized, createEngine } from './ts/wasm'
export {
  AkariSubRenderer,
  type CompositedFrameResult,
  type FontConfig,
  type FrameMargins,
  type FrameSize,
  type ImageSliceFrameResult,
  type RenderImageSlice
} from './ts/renderer'
export {
  AkariSubCanvasRenderer,
  AkariSubCanvasRenderer as AkariSubBrowserRenderer,
  type BrowserRendererPerformanceStats,
  type BrowserRendererOptions,
  type BrowserRendererSupport,
  type BrowserRendererType,
} from './ts/browser-renderer'
export type { ASSEvent, ASSStyle } from './ts/worker-types'
export { AkariSubWorkerClient, type WorkerClientCreateOptions } from './ts/worker-client'
export {
  AkariSubAsyncRenderer,
  AkariSubAsyncRenderer as AkariSubWorkerRenderer,
  type AsyncRendererCreateOptions,
  type AsyncRendererState,
} from './ts/async-renderer'
export type {
  AkariSubWorkerInboundMessage,
  AkariSubWorkerOutboundMessage,
  TransferableCompositedFrameResult,
  TransferableRenderImageSlice,
  WorkerAckMessage,
  WorkerCreatedEventMessage,
  WorkerCreatedStyleMessage,
  WorkerErrorMessage,
  WorkerEventsMessage,
  WorkerInitMessage,
  WorkerReadyMessage,
  WorkerRenderedCompositedFrameMessage,
  WorkerRenderedImageSlicesMessage,
  WorkerStylesMessage,
} from './ts/worker-types'

export type AkariSubRuntime = {
  version(): string
  libassVersion(): number
  hasTrack(): boolean
  eventCount(): number
  styleCount(): number
  trackColorSpace(): number | null
  setFrameSize(width: number, height: number): void
  setStorageSize(width: number, height: number): void
  setMargins(top: number, bottom: number, left: number, right: number): void
  setCacheLimits(glyphLimit: number, bitmapCacheLimit: number): void
  setFonts(defaultFont?: string | null, fallbackFontsCsv?: string | null, fontConfigPath?: string | null): void
  addFont(name: string, data: Uint8Array | number[]): void
  clearFonts(): void
  setDefaultFont(font?: string | null): void
  loadTrackFromUtf8(subtitleData: string): void
  clearTrack(): void
  createEvent(event: unknown): number
  setEvent(index: number, event: unknown): void
  removeEvent(index: number): void
  getEvents(): unknown[]
  createStyle(style: unknown): number
  setStyle(index: number, style: unknown): void
  removeStyle(index: number): void
  getStyles(): unknown[]
  styleOverride(index: number): void
  disableStyleOverride(): void
  renderFrame(timestampMs: number, force: boolean): {
    changed: number
    timestamp_ms: number
    image_count: number
  } | null
  renderCompositedFrame(timestampMs: number, force: boolean): {
    changed: number
    timestamp_ms: number
    width: number
    height: number
  } | null
  lastRenderImageCount(): number
  getLastRenderImage(index: number): {
    width: number
    height: number
    stride: number
    color: number
    x: number
    y: number
  } | null
  getLastRenderImagePixels(index: number): Uint8Array
  getLastCompositedFrame(): {
    changed: number
    timestamp_ms: number
    width: number
    height: number
  } | null
  getLastCompositedFramePixels(): Uint8Array
}