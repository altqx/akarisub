/** Inclusive Unicode codepoint range. */
export type UnicodeRange = readonly [start: number, end: number]

/** OpenType-style script tags used for font subset matching. */
export type UnicodeScript =
  | 'arab'
  | 'armn'
  | 'beng'
  | 'cyrl'
  | 'deva'
  | 'ethi'
  | 'geor'
  | 'grek'
  | 'hang'
  | 'hani'
  | 'hebr'
  | 'hira'
  | 'kana'
  | 'khmr'
  | 'lao'
  | 'latn'
  | 'mymr'
  | 'taml'
  | 'thai'

type ScriptRange = readonly [start: number, end: number, script: UnicodeScript]

/**
 * Compact coverage for scripts that dominate subtitle font payload.
 * Ranges are inclusive and sorted by start for binary search.
 */
const SCRIPT_RANGES: readonly ScriptRange[] = [
  [0x0000, 0x024f, 'latn'],
  [0x0370, 0x03ff, 'grek'],
  [0x0400, 0x04ff, 'cyrl'],
  [0x0500, 0x052f, 'cyrl'],
  [0x0530, 0x058f, 'armn'],
  [0x0590, 0x05ff, 'hebr'],
  [0x0600, 0x06ff, 'arab'],
  [0x0750, 0x077f, 'arab'],
  [0x08a0, 0x08ff, 'arab'],
  [0x0900, 0x097f, 'deva'],
  [0x0980, 0x09ff, 'beng'],
  [0x0b80, 0x0bff, 'taml'],
  [0x0e00, 0x0e7f, 'thai'],
  [0x0e80, 0x0eff, 'lao'],
  [0x1000, 0x109f, 'mymr'],
  [0x10a0, 0x10ff, 'geor'],
  [0x1100, 0x11ff, 'hang'],
  [0x1200, 0x137f, 'ethi'],
  [0x13a0, 0x13ff, 'ethi'],
  [0x1780, 0x17ff, 'khmr'],
  [0x1ab0, 0x1aff, 'latn'],
  [0x1c80, 0x1c8f, 'cyrl'],
  [0x1e00, 0x1eff, 'latn'],
  [0x2c60, 0x2c7f, 'latn'],
  [0x2de0, 0x2dff, 'cyrl'],
  [0x2e80, 0x2eff, 'hani'],
  [0x2f00, 0x2fdf, 'hani'],
  [0x3000, 0x303f, 'hani'],
  [0x3040, 0x309f, 'hira'],
  [0x30a0, 0x30ff, 'kana'],
  [0x3100, 0x312f, 'hani'],
  [0x3130, 0x318f, 'hang'],
  [0x31a0, 0x31bf, 'hani'],
  [0x31f0, 0x31ff, 'kana'],
  [0x3400, 0x4dbf, 'hani'],
  [0x4e00, 0x9fff, 'hani'],
  [0xa640, 0xa69f, 'cyrl'],
  [0xa720, 0xa7ff, 'latn'],
  [0xab30, 0xab6f, 'latn'],
  [0xac00, 0xd7af, 'hang'],
  [0xf900, 0xfaff, 'hani'],
  [0xfb50, 0xfdff, 'arab'],
  [0xfe70, 0xfeff, 'arab'],
  [0xff65, 0xff9f, 'kana'],
  [0x20000, 0x2a6df, 'hani'],
  [0x2a700, 0x2b73f, 'hani'],
  [0x2b740, 0x2b81f, 'hani'],
  [0x2b820, 0x2ceaf, 'hani']
]

const SCRIPT_ALIAS_TABLE: Record<string, readonly UnicodeScript[]> = {
  latin: ['latn'],
  latn: ['latn'],
  cyrillic: ['cyrl'],
  cyrl: ['cyrl'],
  greek: ['grek'],
  grek: ['grek'],
  arabic: ['arab'],
  arab: ['arab'],
  hebrew: ['hebr'],
  hebr: ['hebr'],
  armenian: ['armn'],
  armn: ['armn'],
  georgian: ['geor'],
  geor: ['geor'],
  ethiopic: ['ethi'],
  ethi: ['ethi'],
  devanagari: ['deva'],
  deva: ['deva'],
  bengali: ['beng'],
  beng: ['beng'],
  tamil: ['taml'],
  taml: ['taml'],
  thai: ['thai'],
  lao: ['lao'],
  khmer: ['khmr'],
  khmr: ['khmr'],
  myanmar: ['mymr'],
  burmese: ['mymr'],
  mymr: ['mymr'],
  hiragana: ['hira'],
  hira: ['hira'],
  katakana: ['kana'],
  kana: ['kana'],
  hangul: ['hang'],
  hang: ['hang'],
  han: ['hani'],
  hani: ['hani'],
  kanji: ['hani'],
  cjk: ['hani', 'hira', 'kana', 'hang'],
  jp: ['hira', 'kana', 'hani'],
  ja: ['hira', 'kana', 'hani'],
  japanese: ['hira', 'kana', 'hani'],
  kr: ['hang', 'hani'],
  ko: ['hang', 'hani'],
  korean: ['hang', 'hani'],
  cn: ['hani'],
  zh: ['hani'],
  chinese: ['hani'],
  sc: ['hani'],
  tc: ['hani']
}

const HEX = '[0-9A-Fa-f?]+'
const UNICODE_RANGE_TOKEN = new RegExp(`U\\+(${HEX})(?:-(${HEX}))?`, 'g')

const parseHexNibbleRange = (token: string): UnicodeRange => {
  const startChars: string[] = []
  const endChars: string[] = []
  for (const ch of token.toUpperCase()) {
    if (ch === '?') {
      startChars.push('0')
      endChars.push('F')
    } else {
      startChars.push(ch)
      endChars.push(ch)
    }
  }
  return [Number.parseInt(startChars.join(''), 16), Number.parseInt(endChars.join(''), 16)]
}

/** Expand CSS `unicode-range` into inclusive codepoint ranges. */
export const parseUnicodeRange = (value: string): UnicodeRange[] => {
  const ranges: UnicodeRange[] = []
  UNICODE_RANGE_TOKEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = UNICODE_RANGE_TOKEN.exec(value))) {
    const startToken = match[1]
    const endToken = match[2]
    if (endToken) {
      const start = Number.parseInt(startToken.replace(/\?/g, '0'), 16)
      const end = Number.parseInt(endToken.replace(/\?/g, 'F'), 16)
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        ranges.push([start, end])
      }
      continue
    }
    const [start, end] = parseHexNibbleRange(startToken)
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      ranges.push([start, end])
    }
  }
  return ranges
}

const scriptAt = (codepoint: number): UnicodeScript | null => {
  let low = 0
  let high = SCRIPT_RANGES.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const [start, end, script] = SCRIPT_RANGES[mid]
    if (codepoint < start) {
      high = mid - 1
      continue
    }
    if (codepoint > end) {
      low = mid + 1
      continue
    }
    return script
  }
  return null
}

/** Resolve a user-facing script alias (`cjk`, `jp`, `latin`) to OpenType tags. */
export const expandScriptAlias = (value: string): UnicodeScript[] => {
  const key = value.trim().toLowerCase()
  const mapped = SCRIPT_ALIAS_TABLE[key]
  return mapped ? [...mapped] : []
}

export const expandScriptList = (values: readonly string[] | undefined): Set<UnicodeScript> => {
  const scripts = new Set<UnicodeScript>()
  if (!values) return scripts
  for (const value of values) {
    for (const script of expandScriptAlias(value)) scripts.add(script)
  }
  return scripts
}

/** Drop ASS override blocks so `{\an8}` does not count as Latin text. */
export const stripAssOverrides = (text: string): string => {
  return text.replace(/\{[^}]*\}/g, '')
}

export const forEachCodepoint = (text: string, visit: (codepoint: number) => void | boolean): void => {
  for (const char of text) {
    const codepoint = char.codePointAt(0)
    if (codepoint == null) continue
    if (visit(codepoint) === false) return
  }
}

/** Collect OpenType script tags present in `text`. */
export const collectUnicodeScripts = (text: string): Set<UnicodeScript> => {
  const scripts = new Set<UnicodeScript>()
  forEachCodepoint(text, (codepoint) => {
    const script = scriptAt(codepoint)
    if (script) scripts.add(script)
  })
  return scripts
}

export const collectUnicodeScriptsFromAss = (text: string): Set<UnicodeScript> => {
  return collectUnicodeScripts(stripAssOverrides(text))
}

export const codepointsOverlapRanges = (text: string, ranges: readonly UnicodeRange[]): boolean => {
  if (ranges.length === 0) return false
  let overlap = false
  forEachCodepoint(text, (codepoint) => {
    for (const [start, end] of ranges) {
      if (codepoint >= start && codepoint <= end) {
        overlap = true
        return false
      }
    }
  })
  return overlap
}

export const scriptsOverlap = (
  needed: ReadonlySet<string>,
  offered: ReadonlySet<string> | readonly string[] | undefined
): boolean => {
  if (!offered) return false
  if (offered instanceof Set) {
    for (const script of offered) {
      if (needed.has(script)) return true
    }
    return false
  }
  for (const script of offered) {
    if (needed.has(script)) return true
  }
  return false
}

export const mergeScriptSets = (into: Set<string>, from: Iterable<string>): void => {
  for (const script of from) into.add(script)
}
