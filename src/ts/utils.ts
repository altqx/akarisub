export {
  webYCbCrMap,
  colorMatrixConversionMap,
  libassYCbCrMap,
  getColorSpaceFilterUrl,
  getColorMatrix3,
  IDENTITY_COLOR_MATRIX
} from './color-space'
export type { CanvasColorSpace, VideoColorProfile, VideoPrimaries, VideoTransfer, ColorMatrix3 } from './color-space'

/** Canvas pixel size after device-pixel-ratio and prescale limits. */
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

  // Canvas backing dimensions truncate fractions. Send the same integers to
  // the worker so checking a prepared canvas does not resize (and clear) it.
  return { width: Math.floor(width), height: Math.floor(height) }
}

/** Letterboxed video rectangle inside the element's layout box. */
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

/**
 * Fix alpha bug in some browsers (transparent pixels rendered as non-black).
 */
export function fixAlpha(uint8: Uint8ClampedArray, hasAlphaBug: boolean): Uint8ClampedArray {
  if (!hasAlphaBug) return uint8

  const len = uint8.length
  const len4 = len - (len % 16) // Process 4 pixels at a time (16 bytes)

  let j = 3
  for (; j < len4; j += 16) {
    if (uint8[j] < 2) uint8[j] = 1
    if (uint8[j + 4] < 2) uint8[j + 4] = 1
    if (uint8[j + 8] < 2) uint8[j + 8] = 1
    if (uint8[j + 12] < 2) uint8[j + 12] = 1
  }

  for (; j < len; j += 4) {
    if (uint8[j] < 2) uint8[j] = 1
  }

  return uint8
}

/** One key/value or comment line inside an {@linkcode ASSSection}. */
export interface ASSBodyEntry {
  /** Present for `;` comment lines. */
  type?: 'comment'
  /** ASS key such as `Dialogue` or `Format`. */
  key?: string
  /** Raw string, format columns, or a Format-keyed record. */
  value: string | string[] | Record<string, string>
}

/** A `[Section]` block from an ASS/SSA file. */
export interface ASSSection {
  /** Section title without brackets, for example `Events`. */
  name: string
  /** Ordered lines in this section. */
  body: ASSBodyEntry[]
}

/** Parse ASS/SSA text into named sections. Stops before `[Events]` when `stopAtEvents` is set. */
export function parseAss(content: string, stopAtEvents: boolean = false): ASSSection[] {
  const sections: ASSSection[] = []
  const lines = content.split(/[\r\n]+/g)
  const lineCount = lines.length
  let format: string[] | null = null
  let currentSection: ASSSection | null = null

  for (let i = 0; i < lineCount; i++) {
    const line = lines[i]
    if (!line || /^\s*$/.test(line)) continue

    const firstChar = line[0]

    if (firstChar === '[') {
      const m = line.match(/^\[(.*)\]$/)
      if (m) {
        if (stopAtEvents && m[1].toLowerCase() === 'events') {
          break
        }
        format = null
        currentSection = { name: m[1], body: [] }
        sections.push(currentSection)
        continue
      }
    }

    if (!currentSection) continue

    if (firstChar === ';') {
      currentSection.body.push({
        type: 'comment',
        value: line.substring(1)
      })
    } else {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue

      const key = line.substring(0, colonIdx)
      let value: string | string[] | Record<string, string> = line.substring(colonIdx + 1).trim()

      if (format || key === 'Format') {
        let valueArr = value.split(',')
        if (format && valueArr.length > format.length) {
          const lastPart = valueArr.slice(format.length - 1).join(',')
          valueArr = valueArr.slice(0, format.length - 1)
          valueArr.push(lastPart)
        }

        const arrLen = valueArr.length
        for (let j = 0; j < arrLen; j++) {
          valueArr[j] = valueArr[j].trim()
        }

        if (format) {
          const tmp: Record<string, string> = {}
          const formatLen = Math.min(format.length, arrLen)
          for (let j = 0; j < formatLen; j++) {
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

      currentSection.body.push({ key, value })
    }
  }

  return sections
}

const blurRegex = /\\blur(?:[0-9]+\.)?[0-9]+/gm

/** Strip `\\blur` override tags from an ASS document. */
export function dropBlur(subContent: string): string {
  return subContent.replace(blurRegex, '')
}

const commonResolutions = [
  { w: 7680, h: 4320 }, // 8K
  { w: 3840, h: 2160 }, // 4K UHD
  { w: 2560, h: 1440 }, // 1440p
  { w: 1920, h: 1080 }, // 1080p
  { w: 1280, h: 720 } // 720p
]

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

  eventsSection = eventsSection.replace(
    posRegex,
    (_m, x, y) => `\\pos(${formatValue(parseFloat(x) * xnsize, x)},${formatValue(parseFloat(y) * ynsize, y)})`
  )

  eventsSection = eventsSection.replace(
    /\\move\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?:\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+))?\s*\)/g,
    (_m, x1, y1, x2, y2, t1, t2) => {
      const res = `\\move(${formatValue(parseFloat(x1) * xnsize, x1)},${formatValue(parseFloat(y1) * ynsize, y1)},${formatValue(parseFloat(x2) * xnsize, x2)},${formatValue(parseFloat(y2) * ynsize, y2)}`
      return t1 ? `${res},${t1},${t2})` : `${res})`
    }
  )

  eventsSection = eventsSection.replace(
    orgRegex,
    (_m, x, y) => `\\org(${formatValue(parseFloat(x) * xnsize, x)},${formatValue(parseFloat(y) * ynsize, y)})`
  )

  eventsSection = eventsSection.replace(
    /\\(i?clip)\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g,
    (_m, type, x1, y1, x2, y2) =>
      `\\${type}(${formatValue(parseFloat(x1) * xnsize, x1)},${formatValue(parseFloat(y1) * ynsize, y1)},${formatValue(parseFloat(x2) * xnsize, x2)},${formatValue(parseFloat(y2) * ynsize, y2)})`
  )

  eventsSection = eventsSection.replace(/\\fs([\d.]+)/g, (_m, s) => `\\fs${formatValue(parseFloat(s) * val1, s)}`)
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
    eventsSection = eventsSection.replace(rgx, (_m, s) => `\\${tag}${formatValue(parseFloat(s) * val, s)}`)
  })

  eventsSection = eventsSection.replace(/(\\i?clip\s*\([^,)]+m[^)]+\)|\\p[1-9][^}]*?)(?=[\\}]|$)/g, (match) => {
    return match.replace(/(-?[\d.]+)\s+(-?[\d.]+)/g, (_m, x, y) => {
      return `${formatValue(parseFloat(x) * xnsize, x)} ${formatValue(parseFloat(y) * ynsize, y)}`
    })
  })

  return newContent.substring(0, eventsMatch.index!) + eventsSection
}

let _hasAlphaBug: boolean | null = null
let _hasBitmapBug: boolean | null = null

/** Probe canvas `ImageData` and `ImageBitmap` bugs used by the renderer workarounds. */
export async function testImageBugs(): Promise<{ hasAlphaBug: boolean; hasBitmapBug: boolean }> {
  if (_hasAlphaBug !== null && _hasBitmapBug !== null) {
    return { hasAlphaBug: _hasAlphaBug, hasBitmapBug: _hasBitmapBug }
  }

  const canvas1 = document.createElement('canvas')
  const ctx1 = canvas1.getContext('2d', { willReadFrequently: true })
  if (!ctx1) throw new Error('Canvas rendering not supported')

  if (typeof ImageData.prototype.constructor === 'function') {
    try {
      new ImageData(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1)
    } catch {
      console.log('Detected that ImageData is not constructable despite browser saying so')
    }
  }

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

/** Run canvas feature tests. Currently the same as {@linkcode testImageBugs}. */
export async function runFeatureTests(): Promise<{
  hasAlphaBug: boolean
  hasBitmapBug: boolean
}> {
  return testImageBugs()
}

/** Last {@linkcode testImageBugs} alpha-bug result, or `null` before the first probe. */
export function getAlphaBug(): boolean | null {
  return _hasAlphaBug
}

/** Last {@linkcode testImageBugs} partial-bitmap-bug result, or `null` before the first probe. */
export function getBitmapBug(): boolean | null {
  return _hasBitmapBug
}
