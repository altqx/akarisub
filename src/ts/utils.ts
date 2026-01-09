/**
 * Utility functions for JASSUB.
 */

import type { SubtitleColorSpace, WebYCbCrColorSpace } from './types'

// =============================================================================
// Color Space Utilities
// =============================================================================

/** Map video color space to standard name */
export const webYCbCrMap: Record<string, WebYCbCrColorSpace> = {
  bt709: 'BT709',
  bt470bg: 'BT601', // BT.601 PAL
  smpte170m: 'BT601' // BT.601 NTSC
}

/** Color matrix conversion values for SVG filter */
export const colorMatrixConversionMap: Record<string, Record<string, string>> = {
  BT601: {
    BT709: '1.0863 -0.0723 -0.014 0 0 0.0965 0.8451 0.0584 0 0 -0.0141 -0.0277 1.0418'
  },
  BT709: {
    BT601: '0.9137 0.0784 0.0079 0 0 -0.1049 1.1722 -0.0671 0 0 0.0096 0.0322 0.9582'
  },
  FCC: {
    BT709: '1.0873 -0.0736 -0.0137 0 0 0.0974 0.8494 0.0531 0 0 -0.0127 -0.0251 1.0378',
    BT601: '1.001 -0.0008 -0.0002 0 0 0.0009 1.005 -0.006 0 0 0.0013 0.0027 0.996'
  },
  SMPTE240M: {
    BT709: '0.9993 0.0006 0.0001 0 0 -0.0004 0.9812 0.0192 0 0 -0.0034 -0.0114 1.0148',
    BT601: '0.913 0.0774 0.0096 0 0 -0.1051 1.1508 -0.0456 0 0 0.0063 0.0207 0.973'
  }
}

/** libass YCbCr color space index map */
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

/**
 * Generate SVG filter URL for color space conversion.
 */
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

// =============================================================================
// Canvas Utilities
// =============================================================================

/**
 * Compute canvas size with prescaling.
 */
export function computeCanvasSize(
  width: number,
  height: number,
  prescaleFactor: number,
  prescaleHeightLimit: number,
  maxRenderHeight: number
): { width: number; height: number } {
  const scalefactor = prescaleFactor <= 0 ? 1.0 : prescaleFactor
  const ratio = globalThis.devicePixelRatio || 1

  if (height <= 0 || width <= 0) {
    return { width: 0, height: 0 }
  }

  const sgn = scalefactor < 1 ? -1 : 1
  let newH = height * ratio

  if (sgn * newH * scalefactor <= sgn * prescaleHeightLimit) {
    newH *= scalefactor
  } else if (sgn * newH < sgn * prescaleHeightLimit) {
    newH = prescaleHeightLimit
  }

  if (maxRenderHeight > 0 && newH > maxRenderHeight) {
    newH = maxRenderHeight
  }

  width *= newH / height
  height = newH

  return { width, height }
}

/**
 * Get video position and size accounting for aspect ratio.
 */
export function getVideoPosition(
  video: HTMLVideoElement,
  videoWidth: number = video.videoWidth,
  videoHeight: number = video.videoHeight
): { width: number; height: number; x: number; y: number } {
  const videoRatio = videoWidth / videoHeight
  const { offsetWidth, offsetHeight } = video
  const elementRatio = offsetWidth / offsetHeight

  let width = offsetWidth
  let height = offsetHeight

  if (elementRatio > videoRatio) {
    width = Math.floor(offsetHeight * videoRatio)
  } else {
    height = Math.floor(offsetWidth / videoRatio)
  }

  const x = (offsetWidth - width) / 2
  const y = (offsetHeight - height) / 2

  return { width, height, x, y }
}

// =============================================================================
// Alpha Bug Fix
// =============================================================================

/**
 * Fix alpha bug in some browsers (transparent pixels rendered as non-black).
 */
export function fixAlpha(uint8: Uint8ClampedArray, hasAlphaBug: boolean): Uint8ClampedArray {
  if (hasAlphaBug) {
    for (let j = 3; j < uint8.length; j += 4) {
      uint8[j] = uint8[j] > 1 ? uint8[j] : 1
    }
  }
  return uint8
}

// =============================================================================
// ASS Parsing Utilities (for font detection)
// =============================================================================

interface ASSSection {
  name: string
  body: ASSBodyEntry[]
}

interface ASSBodyEntry {
  type?: 'comment'
  key?: string
  value: string | string[] | Record<string, string>
}

/**
 * Parse ASS file content.
 * @param content - ASS file content
 * @param stopAtEvents - Stop parsing when [Events] section is reached (for font detection)
 */
export function parseAss(content: string, stopAtEvents: boolean = false): ASSSection[] {
  const sections: ASSSection[] = []
  const lines = content.split(/[\r\n]+/g)
  let format: string[] | null = null

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\[(.*)\]$/)
    if (m) {
      // Early termination for font detection performance
      if (stopAtEvents && m[1].toLowerCase() === 'events') {
        break
      }
      format = null
      sections.push({
        name: m[1],
        body: []
      })
    } else {
      if (/^\s*$/.test(lines[i])) continue
      if (sections.length === 0) continue

      const body = sections[sections.length - 1].body

      if (lines[i][0] === ';') {
        body.push({
          type: 'comment',
          value: lines[i].substring(1)
        })
      } else {
        const parts = lines[i].split(':')
        const key = parts[0]
        let value: string | string[] | Record<string, string> = parts.slice(1).join(':').trim()

        if (format || key === 'Format') {
          let valueArr = value.split(',')
          if (format && valueArr.length > format.length) {
            const lastPart = valueArr.slice(format.length - 1).join(',')
            valueArr = valueArr.slice(0, format.length - 1)
            valueArr.push(lastPart)
          }
          valueArr = valueArr.map((s) => s.trim())

          if (format) {
            const tmp: Record<string, string> = {}
            for (let j = 0; j < valueArr.length; j++) {
              tmp[format[j]] = valueArr[j]
            }
            value = tmp
          } else {
            value = valueArr
          }
        }

        if (key === 'Format') {
          format = value as string[]
        }

        body.push({ key, value })
      }
    }
  }

  return sections
}

// =============================================================================
// ASS Content Transformation Utilities
// =============================================================================

const blurRegex = /\\blur(?:[0-9]+\.)?[0-9]+/gm

/**
 * Remove all blur tags from subtitle content.
 */
export function dropBlur(subContent: string): string {
  return subContent.replace(blurRegex, '')
}

// Common video resolutions to detect source resolution
const commonResolutions = [
  { w: 7680, h: 4320 }, // 8K
  { w: 3840, h: 2160 }, // 4K UHD
  { w: 2560, h: 1440 }, // 1440p
  { w: 1920, h: 1080 }, // 1080p
  { w: 1280, h: 720 } // 720p
]

/**
 * Detect the likely source resolution based on max position values.
 */
function detectSourceResolution(maxX: number, maxY: number): { w: number; h: number } {
  const sorted = [...commonResolutions].sort((a, b) => a.w - b.w)
  for (const res of sorted) {
    if (maxX <= res.w && maxY <= res.h) {
      return res
    }
  }
  return { w: Math.ceil(maxX / 100) * 100, h: Math.ceil(maxY / 100) * 100 }
}

function formatValue(value: number, original?: string): string | number {
  const hasDecimal = original && original.includes('.')
  return hasDecimal ? value.toFixed(2).replace(/\.?0+$/, '') : Math.round(value)
}

/**
 * Scale override tags in Events from detected source resolution to PlayRes.
 * Only scales tags within override blocks {...} in the Events section.
 */
export function fixPlayRes(subContent: string): string {
  const playResXMatch = subContent.match(/PlayResX:\s*(\d+)/i)
  const playResYMatch = subContent.match(/PlayResY:\s*(\d+)/i)

  const playResX = playResXMatch ? parseInt(playResXMatch[1], 10) : 1920
  const playResY = playResYMatch ? parseInt(playResYMatch[1], 10) : 1080

  const posRegex = /\\pos\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g
  const moveRegex = /\\move\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g
  const orgRegex = /\\org\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g
  const clipRectRegex = /\\i?clip\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g

  let maxX = 0
  let maxY = 0

  const findMax = (regex: RegExp, xIndices: number[], yIndices: number[]) => {
    let match: RegExpExecArray | null
    const regexCopy = new RegExp(regex.source, 'g')
    while ((match = regexCopy.exec(subContent)) !== null) {
      for (const i of xIndices) {
        if (match[i]) {
          const x = Math.abs(parseFloat(match[i]))
          if (x > maxX) maxX = x
        }
      }
      for (const i of yIndices) {
        if (match[i]) {
          const y = Math.abs(parseFloat(match[i]))
          if (y > maxY) maxY = y
        }
      }
    }
  }

  findMax(posRegex, [1], [2])
  findMax(moveRegex, [1, 3], [2, 4])
  findMax(orgRegex, [1], [2])
  findMax(clipRectRegex, [1, 3], [2, 4])

  if (maxX <= playResX && maxY <= playResY) return subContent

  const sourceRes = detectSourceResolution(maxX, maxY)
  const xnsize = playResX / sourceRes.w
  const ynsize = playResY / sourceRes.h

  const val = Math.min(xnsize, ynsize)
  const val1 = Math.max(xnsize, ynsize)
  const valFscx = 1.0

  let newContent = subContent

  const eventsMatch = newContent.match(/(\[Events\][\s\S]*)/i)
  if (!eventsMatch) return newContent

  let eventsSection = eventsMatch[1]

  eventsSection = eventsSection.replace(posRegex, (_m, x, y) =>
    `\\pos(${formatValue(parseFloat(x) * xnsize, x)},${formatValue(parseFloat(y) * ynsize, y)})`
  )

  eventsSection = eventsSection.replace(
    /\\move\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?:\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+))?\s*\)/g,
    (_m, x1, y1, x2, y2, t1, t2) => {
      const res = `\\move(${formatValue(parseFloat(x1) * xnsize, x1)},${formatValue(parseFloat(y1) * ynsize, y1)},${formatValue(parseFloat(x2) * xnsize, x2)},${formatValue(parseFloat(y2) * ynsize, y2)}`
      return t1 ? `${res},${t1},${t2})` : `${res})`
    }
  )

  eventsSection = eventsSection.replace(orgRegex, (_m, x, y) =>
    `\\org(${formatValue(parseFloat(x) * xnsize, x)},${formatValue(parseFloat(y) * ynsize, y)})`
  )

  eventsSection = eventsSection.replace(
    /\\(i?clip)\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g,
    (_m, type, x1, y1, x2, y2) =>
      `\\${type}(${formatValue(parseFloat(x1) * xnsize, x1)},${formatValue(parseFloat(y1) * ynsize, y1)},${formatValue(parseFloat(x2) * xnsize, x2)},${formatValue(parseFloat(y2) * ynsize, y2)})`
  )

  eventsSection = eventsSection.replace(
    /\\fs([\d.]+)/g,
    (_m, s) => `\\fs${formatValue(parseFloat(s) * val1, s)}`
  )
  eventsSection = eventsSection.replace(
    /\\fscx([\d.]+)/g,
    (_m, s) => `\\fscx${formatValue(parseFloat(s) * valFscx, s)}`
  )
  eventsSection = eventsSection.replace(
    /\\xbord([\d.]+)/g,
    (_m, s) => `\\xbord${formatValue(parseFloat(s) * xnsize, s)}`
  )
  eventsSection = eventsSection.replace(
    /\\ybord([\d.]+)/g,
    (_m, s) => `\\ybord${formatValue(parseFloat(s) * ynsize, s)}`
  )
  eventsSection = eventsSection.replace(
    /\\xshad(-?[\d.]+)/g,
    (_m, s) => `\\xshad${formatValue(parseFloat(s) * xnsize, s)}`
  )
  eventsSection = eventsSection.replace(
    /\\yshad(-?[\d.]+)/g,
    (_m, s) => `\\yshad${formatValue(parseFloat(s) * ynsize, s)}`
  )

  const minTags = ['fsp', 'bord', 'shad', 'be', 'blur']
  minTags.forEach((tag) => {
    const rgx = new RegExp(`\\\\${tag}(-?[\\d.]+)`, 'g')
    eventsSection = eventsSection.replace(
      rgx,
      (_m, s) => `\\${tag}${formatValue(parseFloat(s) * val, s)}`
    )
  })

  eventsSection = eventsSection.replace(
    /(\\i?clip\s*\([^,)]+m[^)]+\)|\\p[1-9][^}]*?)(?=[\\}]|$)/g,
    (match) => {
      return match.replace(/(-?[\d.]+)\s+(-?[\d.]+)/g, (_m, x, y) => {
        return `${formatValue(parseFloat(x) * xnsize, x)} ${formatValue(parseFloat(y) * ynsize, y)}`
      })
    }
  )

  return newContent.substring(0, eventsMatch.index!) + eventsSection
}

// =============================================================================
// Feature Detection
// =============================================================================

let _supportsSIMD: boolean | null = null
let _hasAlphaBug: boolean | null = null
let _hasBitmapBug: boolean | null = null

/**
 * Test WASM SIMD support.
 */
export async function testSIMD(): Promise<boolean> {
  if (_supportsSIMD !== null) return _supportsSIMD

  try {
    if (typeof WebAssembly !== 'object' || typeof WebAssembly.validate !== 'function') {
      _supportsSIMD = false
      return false
    }

    const simdProbe = Uint8Array.of(
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, 0x03,
      0x02, 0x01, 0x00, 0x0a, 0x16, 0x01, 0x14, 0x00,
      0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x0b
    )

    let supports = WebAssembly.validate(simdProbe)
    if (supports) {
      try {
        await WebAssembly.compile(simdProbe)
      } catch {
        supports = false
      }
    }

    _supportsSIMD = supports
    return supports
  } catch {
    _supportsSIMD = false
    return false
  }
}

/**
 * Test for browser image bugs.
 */
export async function testImageBugs(): Promise<{ hasAlphaBug: boolean; hasBitmapBug: boolean }> {
  if (_hasAlphaBug !== null && _hasBitmapBug !== null) {
    return { hasAlphaBug: _hasAlphaBug, hasBitmapBug: _hasBitmapBug }
  }

  const canvas1 = document.createElement('canvas')
  const ctx1 = canvas1.getContext('2d', { willReadFrequently: true })
  if (!ctx1) throw new Error('Canvas rendering not supported')

  // Test ImageData constructor
  if (typeof ImageData.prototype.constructor === 'function') {
    try {
      new ImageData(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1)
    } catch {
      console.log('Detected that ImageData is not constructable despite browser saying so')
      // Polyfill would go here if needed
    }
  }

  // Test for alpha bug
  const canvas2 = document.createElement('canvas')
  const ctx2 = canvas2.getContext('2d', { willReadFrequently: true })
  if (!ctx2) throw new Error('Canvas rendering not supported')

  canvas1.width = canvas2.width = 1
  canvas1.height = canvas2.height = 1
  ctx1.clearRect(0, 0, 1, 1)
  ctx2.clearRect(0, 0, 1, 1)

  const prePut = ctx2.getImageData(0, 0, 1, 1).data
  ctx1.putImageData(new ImageData(new Uint8ClampedArray([0, 255, 0, 0]), 1, 1), 0, 0)
  ctx2.drawImage(canvas1, 0, 0)
  const postPut = ctx2.getImageData(0, 0, 1, 1).data

  _hasAlphaBug = prePut[1] !== postPut[1]
  if (_hasAlphaBug) {
    console.log('Detected a browser having issue with transparent pixels, applying workaround')
  }

  // Test for bitmap bug
  if (typeof createImageBitmap !== 'undefined') {
    const subarray = new Uint8ClampedArray([255, 0, 255, 0, 255]).subarray(1, 5)
    ctx2.drawImage(await createImageBitmap(new ImageData(subarray, 1)), 0, 0)
    const { data } = ctx2.getImageData(0, 0, 1, 1)
    _hasBitmapBug = false

    for (let i = 0; i < data.length; i++) {
      if (Math.abs(subarray[i] - data[i]) > 15) {
        _hasBitmapBug = true
        console.log('Detected a browser having issue with partial bitmaps, applying workaround')
        break
      }
    }
  } else {
    _hasBitmapBug = false
  }

  canvas1.remove()
  canvas2.remove()

  return { hasAlphaBug: _hasAlphaBug, hasBitmapBug: _hasBitmapBug }
}

/**
 * Run all feature detection tests.
 */
export async function runFeatureTests(): Promise<{
  supportsSIMD: boolean
  hasAlphaBug: boolean
  hasBitmapBug: boolean
}> {
  const [supportsSIMD, imageBugs] = await Promise.all([testSIMD(), testImageBugs()])
  return {
    supportsSIMD,
    ...imageBugs
  }
}

/** Get cached SIMD support value */
export function getSIMDSupport(): boolean | null {
  return _supportsSIMD
}

/** Get cached alpha bug value */
export function getAlphaBug(): boolean | null {
  return _hasAlphaBug
}

/** Get cached bitmap bug value */
export function getBitmapBug(): boolean | null {
  return _hasBitmapBug
}
