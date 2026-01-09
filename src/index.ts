/**
 * JASSUB - JavaScript ASS/SSA Subtitle Renderer
 *
 * High-performance ASS/SSA subtitle renderer using libass compiled to WebAssembly.
 *
 * @packageDocumentation
 */

// Main JASSUB class (default export for backwards compatibility)
export { default } from './ts/jassub'
export { default as JASSUB } from './ts/jassub'

// Type exports
export type {
  ASSEvent,
  ASSStyle,
  JASSUBOptions,
  PerformanceStats,
  ASSEventCallback,
  ASSStyleCallback,
  PerformanceStatsCallback,
  ResetStatsCallback,
  RenderImage,
  RenderTimes,
  VideoFrameCallbackMetadata,
  SubtitleColorSpace,
  WebYCbCrColorSpace
} from './ts/types'

// Utility exports (for advanced usage)
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
  testSIMD,
  testImageBugs,
  runFeatureTests,
  getSIMDSupport,
  getAlphaBug,
  getBitmapBug,
  getColorSpaceFilterUrl
} from './ts/utils'
