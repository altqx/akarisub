/**
 * AkariSub — ASS/SSA subtitle renderer for the browser.
 *
 * Renders libass subtitles with a WebAssembly worker and an optional WebGPU or
 * WebGL2 compositor.
 *
 * @example
 * ```ts
 * import AkariSub from '@altq/akarisub'
 *
 * const renderer = new AkariSub({
 *   video: document.querySelector('video')!,
 *   subUrl: '/subtitles/example.ass'
 * })
 *
 * renderer.destroy()
 * ```
 *
 * @module
 */

export { default } from './wrapper'
export { default as AkariSub } from './wrapper'

export type {
  ASSEvent,
  ASSStyle,
  AkariSubOptions,
  CueEvent,
  FontBytes,
  FontFamilySource,
  FontSubsetSource,
  FrameTimeline,
  PerformanceStats,
  PerformanceWarning,
  PreloadedTrack,
  PreloadTrackSource,
  PresentVideoFrameOptions,
  RenderEvent,
  RendererChangeEvent,
  RendererType,
  StreamingTrackFormat,
  StreamingTrackOptions,
  ASSEventCallback,
  ASSStyleCallback,
  PerformanceStatsCallback,
  ResetStatsCallback,
  RenderImage,
  RenderTimes,
  VideoFrameCallbackMetadata,
  VideoFrameLike,
  SubtitleColorSpace,
  WebYCbCrColorSpace,
  EncryptedSubtitleContent
} from './ts/types'
export type { CanvasColorSpace, VideoColorProfile, VideoPrimaries, VideoTransfer } from './ts/color-space'

export type { ASSSection, ASSBodyEntry } from './ts/utils'

export {
  webYCbCrMap,
  colorMatrixConversionMap,
  libassYCbCrMap,
  computeCanvasSize,
  getVideoPosition,
  fixAlpha,
  parseAss,
  dropBlur,
  fixPlayRes,
  testImageBugs,
  runFeatureTests,
  getAlphaBug,
  getBitmapBug,
  getColorSpaceFilterUrl,
  getColorMatrix3,
  colorMatrix3ColumnMajor,
  getWasmUrl,
  getWasmGlueUrl,
  getMtWasmUrl,
  getMtWasmGlueUrl,
  getDefaultFontUrl,
  supportsWasmSimd,
  supportsWasmThreads,
  WebGPURenderer,
  isWebGPUSupported,
  WebGL2Renderer,
  isWebGL2Supported,
  VIDEO_FRAME_TIMESTAMP_SECONDS,
  frameTimelineFromTimestamps,
  frameTimelineFromVideoFrames,
  isVideoFrameLike,
  isWebCodecsVideoFrameSupported,
  videoFrameCallbackMetadata,
  videoFrameColorSpace,
  videoFrameMediaTime
} from './wrapper'

export {
  collectUnicodeScripts,
  collectUnicodeScriptsFromAss,
  expandScriptAlias,
  parseUnicodeRange,
  stripAssOverrides
} from './ts/unicode-scripts'

export {
  collectNeededScripts,
  matchFontSubsets,
  normalizeFontFamilySource
} from './ts/font-subsets'

export { parseStreamingTrackOptions } from './ts/streaming'
