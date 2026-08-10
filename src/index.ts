/**
 * AkariSub - JavaScript ASS/SSA Subtitle Renderer
 *
 * High-performance ASS/SSA subtitle renderer using libass compiled to WebAssembly.
 *
 * @packageDocumentation
 */

export { default } from './ts/akarisub'
export { default as AkariSub } from './ts/akarisub'

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
  getColorSpaceFilterUrl
} from './ts/utils'

export { WebGPURenderer, isWebGPUSupported } from './ts/webgpu-renderer'

export { WebGL2Renderer, isWebGL2Supported } from './ts/webgl2-renderer'
