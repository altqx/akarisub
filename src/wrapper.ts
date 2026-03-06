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
  type BrowserRendererOptions,
} from './ts/browser-renderer'
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
  WorkerErrorMessage,
  WorkerInitMessage,
  WorkerReadyMessage,
  WorkerRenderedCompositedFrameMessage,
  WorkerRenderedImageSlicesMessage,
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
  loadTrackFromUtf8(subtitleData: string): void
  clearTrack(): void
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