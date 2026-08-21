/**
 * AkariSub - JavaScript ASS/SSA Subtitle Renderer
 *
 * High-performance ASS/SSA subtitle renderer using libass compiled to WebAssembly.
 *
 * @packageDocumentation
 */

export { default } from './wrapper'
export { default as AkariSub } from './wrapper'

export type {
  ASSEvent,
  ASSStyle,
  AkariSubOptions,
  FrameTimeline,
  PerformanceStats,
  ASSEventCallback,
  ASSStyleCallback,
  PerformanceStatsCallback,
  ResetStatsCallback,
  RenderImage,
  RenderTimes,
  VideoFrameCallbackMetadata,
  SubtitleColorSpace,
  WebYCbCrColorSpace,
  EncryptedSubtitleContent
} from './ts/types'

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
  getWasmUrl,
  getWasmGlueUrl,
  getDefaultFontUrl,
  WebGPURenderer,
  isWebGPUSupported,
  WebGL2Renderer,
  isWebGL2Supported
} from './wrapper'
