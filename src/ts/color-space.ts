import type { SubtitleColorSpace, WebYCbCrColorSpace } from './types'

/** Canvas `colorSpace` values used for subtitle compositing. */
export type CanvasColorSpace = 'srgb' | 'display-p3' | 'rec2020'

/** Video transfer function after mapping WebCodecs names. */
export type VideoTransfer = 'sdr' | 'pq' | 'hlg'

/** Video primaries after mapping WebCodecs names. */
export type VideoPrimaries = 'bt709' | 'bt2020' | 'smpte432' | 'unknown'

/** Video color metadata used to pick a canvas space and YCbCr matrix. */
export interface VideoColorProfile {
  matrix: WebYCbCrColorSpace | null
  primaries: VideoPrimaries
  transfer: VideoTransfer
  canvasColorSpace: CanvasColorSpace
  hdr: boolean
}

/** 3x3 row-major RGB matrix: `r' g' b'` coefficients, matching `feColorMatrix`. */
export type ColorMatrix3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
]

export const IDENTITY_COLOR_MATRIX: ColorMatrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** Map from HTMLVideoElement / VideoFrame matrix names to {@linkcode WebYCbCrColorSpace}. */
export const webYCbCrMap: Record<string, WebYCbCrColorSpace> = {
  bt709: 'BT709',
  bt601: 'BT601',
  bt470bg: 'BT601',
  smpte170m: 'BT601',
  bt2020: 'BT2020',
  'bt2020-ncl': 'BT2020',
  'bt2020-cl': 'BT2020'
}

const webPrimariesMap: Record<string, VideoPrimaries> = {
  bt709: 'bt709',
  bt2020: 'bt2020',
  smpte432: 'smpte432',
  smpte431: 'smpte432',
  p3: 'smpte432',
  'display-p3': 'smpte432'
}

const hdrTransfers = new Set(['pq', 'hlg', 'smpte2084', 'arib-std-b67'])

/** feColorMatrix values that convert a subtitle matrix into a video matrix. */
export const colorMatrixConversionMap: Record<string, Record<string, string>> = {
  BT601: {
    BT709: '1.0863 -0.0723 -0.014 0 0 0.0965 0.8451 0.0584 0 0 -0.0141 -0.0277 1.0418',
    BT2020: '1.0363 -0.0304 -0.0059 0 0 0.0411 0.8807 0.0782 0 0 -0.0185 -0.0362 1.0547'
  },
  BT709: {
    BT601: '0.9137 0.0784 0.0079 0 0 -0.1049 1.1722 -0.0671 0 0 0.0096 0.0322 0.9582',
    BT2020: '0.9499 0.0455 0.0046 0 0 -0.0542 1.0381 0.0161 0 0 -0.0030 -0.0099 1.0129'
  },
  BT2020: {
    BT601: '0.9637 0.0334 0.0029 0 0 -0.0463 1.1304 -0.0840 0 0 0.0153 0.0394 0.9453',
    BT709: '1.0501 -0.0461 -0.0040 0 0 0.0548 0.9607 -0.0155 0 0 0.0036 0.0093 0.9871'
  },
  FCC: {
    BT709: '1.0873 -0.0736 -0.0137 0 0 0.0974 0.8494 0.0531 0 0 -0.0127 -0.0251 1.0378',
    BT601: '1.001 -0.0008 -0.0002 0 0 0.0009 1.005 -0.006 0 0 0.0013 0.0027 0.996',
    BT2020: '1.0373 -0.0314 -0.0059 0 0 0.0421 0.8853 0.0726 0 0 -0.0171 -0.0336 1.0507'
  },
  SMPTE240M: {
    BT709: '0.9993 0.0006 0.0001 0 0 -0.0004 0.9812 0.0192 0 0 -0.0034 -0.0114 1.0148',
    BT601: '0.913 0.0774 0.0096 0 0 -0.1051 1.1508 -0.0456 0 0 0.0063 0.0207 0.973',
    BT2020: '0.9493 0.0451 0.0056 0 0 -0.0546 1.0183 0.0363 0 0 -0.0064 -0.0213 1.0277'
  }
}

const colorMatrix3Cache = new Map<string, ColorMatrix3>()

/** libass `YCbCr Matrix` header values indexed by the libass enum. */
export const libassYCbCrMap: (SubtitleColorSpace | null)[] = [
  null,
  'BT601',
  null,
  'BT601',
  'BT601',
  'BT709',
  'BT709',
  'SMPTE240M',
  'SMPTE240M',
  'FCC',
  'FCC'
]

let supportedCanvasColorSpaces: Set<CanvasColorSpace> | null = null
let supportedCanvasPixelFormats: Set<string> | null = null
let hdrCanvasSupported: boolean | null = null

function parseColorMatrix3(values: string): ColorMatrix3 | null {
  const parts = values.trim().split(/\s+/)
  if (parts.length < 13) return null
  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isFinite(n))) return null
  return [nums[0], nums[1], nums[2], nums[5], nums[6], nums[7], nums[10], nums[11], nums[12]]
}

/** 3x3 RGB matrix that converts `subtitleColorSpace` into `videoColorSpace`. */
export function getColorMatrix3(
  subtitleColorSpace: SubtitleColorSpace,
  videoColorSpace: WebYCbCrColorSpace | null
): ColorMatrix3 {
  if (!subtitleColorSpace || !videoColorSpace || subtitleColorSpace === videoColorSpace) {
    return IDENTITY_COLOR_MATRIX
  }

  const key = `${subtitleColorSpace}>${videoColorSpace}`
  const cached = colorMatrix3Cache.get(key)
  if (cached) return cached

  const values = colorMatrixConversionMap[subtitleColorSpace]?.[videoColorSpace]
  const matrix = values ? parseColorMatrix3(values) : null
  const resolved = matrix ?? IDENTITY_COLOR_MATRIX
  colorMatrix3Cache.set(key, resolved)
  return resolved
}

/** SVG filter URL that converts `subtitleColorSpace` into `videoColorSpace`, or `null` when none is needed. */
export function getColorSpaceFilterUrl(
  subtitleColorSpace: SubtitleColorSpace,
  videoColorSpace: WebYCbCrColorSpace
): string | null {
  if (!subtitleColorSpace || !videoColorSpace) return null
  if (subtitleColorSpace === videoColorSpace) return null

  const matrix = colorMatrixConversionMap[subtitleColorSpace]?.[videoColorSpace]
  if (!matrix) return null

  return `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feColorMatrix type='matrix' values='${matrix} 0 0 0 0 0 1 0'/></filter></svg>#f")`
}

function probeCanvasColorSpaces(): void {
  if (supportedCanvasColorSpaces) return
  supportedCanvasColorSpaces = new Set<CanvasColorSpace>(['srgb'])
  supportedCanvasPixelFormats = new Set<string>(['uint8'])
  hdrCanvasSupported = false

  if (typeof document === 'undefined') return

  const candidates: CanvasColorSpace[] = ['display-p3', 'rec2020']
  for (const colorSpace of candidates) {
    try {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { colorSpace, alpha: true } as CanvasRenderingContext2DSettings)
      const resolved =
        ctx && 'getContextAttributes' in ctx
          ? (ctx.getContextAttributes() as CanvasRenderingContext2DSettings & { colorSpace?: string }).colorSpace
          : undefined
      if (ctx && (resolved === colorSpace || resolved == null)) {
        supportedCanvasColorSpaces.add(colorSpace)
      }
    } catch {
      // Browser rejected the color space.
    }
  }

  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', {
      colorSpace: 'display-p3',
      pixelFormat: 'float16',
      alpha: true
    } as CanvasRenderingContext2DSettings)
    const attrs =
      ctx && 'getContextAttributes' in ctx
        ? (ctx.getContextAttributes() as { pixelFormat?: string; colorType?: string })
        : null
    if (attrs?.pixelFormat === 'float16' || attrs?.colorType === 'float16') {
      supportedCanvasPixelFormats.add('float16')
      hdrCanvasSupported = true
    }
  } catch {
    // float16 canvases are still behind a flag in some engines.
  }
}

/** Canvas color spaces this document can actually construct. */
export function getSupportedCanvasColorSpaces(): readonly CanvasColorSpace[] {
  probeCanvasColorSpaces()
  return [...supportedCanvasColorSpaces!]
}

/** True when a float16 / HDR 2D canvas can be created. */
export function supportsHdrCanvas(): boolean {
  probeCanvasColorSpaces()
  return hdrCanvasSupported === true
}

function pickSupportedCanvasColorSpace(preferred: CanvasColorSpace[]): CanvasColorSpace {
  probeCanvasColorSpaces()
  for (const space of preferred) {
    if (supportedCanvasColorSpaces!.has(space)) return space
  }
  return 'srgb'
}

/** Map WebCodecs / VideoFrame color-space fields onto AkariSub names. */
export function mapVideoMatrix(matrix?: string | null): WebYCbCrColorSpace | null {
  if (!matrix) return null
  return webYCbCrMap[matrix] ?? null
}

/** Map WebCodecs primaries onto {@linkcode VideoPrimaries}. */
export function mapVideoPrimaries(primaries?: string | null): VideoPrimaries {
  if (!primaries) return 'unknown'
  return webPrimariesMap[primaries] ?? 'unknown'
}

/** Map WebCodecs transfer characteristics onto {@linkcode VideoTransfer}. */
export function mapVideoTransfer(transfer?: string | null): VideoTransfer {
  if (!transfer) return 'sdr'
  if (hdrTransfers.has(transfer)) return transfer === 'hlg' || transfer === 'arib-std-b67' ? 'hlg' : 'pq'
  return 'sdr'
}

function preferredCanvasSpaces(primaries: VideoPrimaries, hdr: boolean): CanvasColorSpace[] {
  if (primaries === 'bt2020') return hdr ? ['rec2020', 'display-p3', 'srgb'] : ['rec2020', 'display-p3', 'srgb']
  if (primaries === 'smpte432') return ['display-p3', 'srgb']
  if (hdr) return ['display-p3', 'srgb']
  return ['srgb']
}

/** Choose the widest canvas color space that this browser can back. */
export function selectCanvasColorSpace(
  primaries: VideoPrimaries,
  hdr: boolean,
  override?: CanvasColorSpace | 'auto'
): CanvasColorSpace {
  if (override && override !== 'auto') {
    return pickSupportedCanvasColorSpace([override, ...preferredCanvasSpaces(primaries, hdr)])
  }
  return pickSupportedCanvasColorSpace(preferredCanvasSpaces(primaries, hdr))
}

/** Build a {@linkcode VideoColorProfile} from a VideoFrame-like color-space object. */
export function profileFromVideoFrameColorSpace(
  colorSpace: { matrix?: string | null; primaries?: string | null; transfer?: string | null } | null | undefined,
  canvasColorSpaceOverride?: CanvasColorSpace | 'auto'
): VideoColorProfile {
  const matrix = mapVideoMatrix(colorSpace?.matrix)
  const primaries = mapVideoPrimaries(colorSpace?.primaries)
  const transfer = mapVideoTransfer(colorSpace?.transfer)
  const hdr = transfer !== 'sdr'
  return {
    matrix,
    primaries,
    transfer,
    canvasColorSpace: selectCanvasColorSpace(primaries, hdr, canvasColorSpaceOverride),
    hdr
  }
}

const SDR_PROFILE: VideoColorProfile = {
  matrix: null,
  primaries: 'unknown',
  transfer: 'sdr',
  canvasColorSpace: 'srgb',
  hdr: false
}

/** SDR sRGB profile used before the first video frame is inspected. */
export function defaultVideoColorProfile(): VideoColorProfile {
  return SDR_PROFILE
}

/** DOM libs still omit `rec2020` from `PredefinedColorSpace`; assign it as a string. */
function assignCanvasColorSpace(target: { colorSpace?: string }, colorSpace: CanvasColorSpace): void {
  if (colorSpace !== 'srgb') target.colorSpace = colorSpace
}

/** 2D context attributes that request WCG and, when available, HDR. */
export function canvas2dContextSettings(options: {
  colorSpace?: CanvasColorSpace
  hdr?: boolean
  alpha?: boolean
  willReadFrequently?: boolean
}): CanvasRenderingContext2DSettings {
  probeCanvasColorSpaces()
  const settings: CanvasRenderingContext2DSettings & { pixelFormat?: string } = {
    alpha: options.alpha ?? true
  }
  if (options.willReadFrequently) settings.willReadFrequently = true
  if (options.colorSpace) assignCanvasColorSpace(settings, options.colorSpace)
  if (options.hdr && supportedCanvasPixelFormats?.has('float16')) {
    settings.pixelFormat = 'float16'
    assignCanvasColorSpace(settings, options.colorSpace && options.colorSpace !== 'srgb' ? options.colorSpace : 'display-p3')
  }
  return settings
}

/** ImageData options that tag subtitle pixels as sRGB. */
export function subtitleImageDataSettings(): ImageDataSettings | undefined {
  try {
    new ImageData(new Uint8ClampedArray(4), 1, 1, { colorSpace: 'srgb' })
    return { colorSpace: 'srgb' }
  } catch {
    return undefined
  }
}

/** Create sRGB-tagged ImageData so WCG canvases convert from authored ASS RGB. */
export function createSubtitleImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number
): ImageData {
  const settings = subtitleImageDataSettings()
  return settings ? new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height, settings) : new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height)
}

/** WebGPU canvas configuration extras for WCG / HDR swap chains. */
export function webgpuCanvasConfiguration(options: {
  colorSpace: CanvasColorSpace
  hdr: boolean
}): { colorSpace?: PredefinedColorSpace | 'rec2020'; toneMapping?: { mode: 'standard' | 'extended' } } {
  const config: {
    colorSpace?: PredefinedColorSpace | 'rec2020'
    toneMapping?: { mode: 'standard' | 'extended' }
  } = {}
  if (options.colorSpace !== 'srgb') {
    config.colorSpace = options.colorSpace
  }
  if (options.hdr) {
    config.toneMapping = { mode: 'extended' }
  }
  return config
}

/** Apply WebGL2 drawing-buffer / unpack color spaces. No-ops when the engine lacks the setters. */
export function applyWebGL2ColorSpace(
  gl: WebGL2RenderingContext,
  colorSpace: CanvasColorSpace
): void {
  const glColor: { drawingBufferColorSpace?: string; unpackColorSpace?: string } = gl
  try {
    if ('drawingBufferColorSpace' in gl) {
      glColor.drawingBufferColorSpace = colorSpace
    }
    if ('unpackColorSpace' in gl) {
      glColor.unpackColorSpace = 'srgb'
    }
  } catch {
    // Some WebGL implementations reject rec2020 even when the field exists.
  }
}

/** True when two video profiles would produce the same compositor setup. */
export function videoColorProfilesEqual(
  a: VideoColorProfile | null | undefined,
  b: VideoColorProfile | null | undefined
): boolean {
  if (!a || !b) return a === b
  return (
    a.matrix === b.matrix &&
    a.primaries === b.primaries &&
    a.transfer === b.transfer &&
    a.canvasColorSpace === b.canvasColorSpace &&
    a.hdr === b.hdr
  )
}
