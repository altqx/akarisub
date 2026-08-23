import type { FontBytes, FontFamilySource, FontSubsetSource } from './types'
import {
  collectUnicodeScriptsFromAss,
  codepointsOverlapRanges,
  expandScriptList,
  mergeScriptSets,
  parseUnicodeRange,
  scriptsOverlap,
  type UnicodeRange
} from './unicode-scripts'

export type { FontFamilySource, FontSubsetSource }

export type AvailableFontsMap = Record<string, FontFamilySource>

const isFontBytes = (value: unknown): value is FontBytes => {
  return typeof value === 'string' || value instanceof Uint8Array
}

export const isFontSubsetSource = (value: unknown): value is FontSubsetSource => {
  return value != null && typeof value === 'object' && 'src' in value && isFontBytes((value as FontSubsetSource).src)
}

/** Normalize a family entry to a list of subset descriptors. */
export const normalizeFontFamilySource = (value: unknown): FontSubsetSource[] => {
  if (isFontBytes(value)) return [{ src: value }]
  if (Array.isArray(value)) {
    const subsets: FontSubsetSource[] = []
    for (const item of value) {
      if (isFontBytes(item) || isFontSubsetSource(item)) {
        subsets.push(...normalizeFontFamilySource(item))
      }
    }
    return subsets
  }
  if (isFontSubsetSource(value)) return [{ ...value }]
  return []
}

export const fontFamilyHasSubsets = (value: unknown): boolean => {
  const subsets = normalizeFontFamilySource(value)
  return subsets.some((subset) => subset.unicodeRange != null || (subset.scripts != null && subset.scripts.length > 0))
}

export const subsetIdentity = (family: string, index: number, subset: FontSubsetSource): string => {
  const src = subset.src
  if (typeof src === 'string') return `${family}#${index}:${src}`
  return `${family}#${index}:bytes:${src.byteLength}:${src.byteOffset ?? 0}`
}

export type FontSubsetMatch = {
  family: string
  index: number
  subset: FontSubsetSource
  identity: string
}

const subsetHasConstraints = (subset: FontSubsetSource): boolean => {
  return subset.unicodeRange != null || (subset.scripts != null && subset.scripts.length > 0)
}

/**
 * A subset with no range/script constraints is the whole font and always
 * loads. Constrained slices load when they overlap `neededScripts` or
 * `text`.
 */
export const subsetMatchesNeed = (
  subset: FontSubsetSource,
  neededScripts: ReadonlySet<string>,
  text?: string
): boolean => {
  if (!subsetHasConstraints(subset)) return true

  const offeredScripts = expandScriptList(subset.scripts)
  if (scriptsOverlap(neededScripts, offeredScripts)) return true

  if (subset.unicodeRange) {
    const ranges = parseUnicodeRange(subset.unicodeRange)
    if (text && codepointsOverlapRanges(text, ranges)) return true
    if (!text && unicodeRangesCoverScripts(ranges, neededScripts)) return true
  }

  return false
}

const SCRIPT_PROBE_CODEPOINTS: Record<string, number> = {
  latn: 0x41,
  cyrl: 0x0410,
  grek: 0x0391,
  arab: 0x0627,
  hebr: 0x05d0,
  armn: 0x0531,
  geor: 0x10d0,
  ethi: 0x1200,
  deva: 0x0905,
  beng: 0x0985,
  taml: 0x0b85,
  thai: 0x0e01,
  lao: 0x0e81,
  khmr: 0x1780,
  mymr: 0x1000,
  hira: 0x3042,
  kana: 0x30a2,
  hang: 0xac00,
  hani: 0x4e00
}

const unicodeRangesCoverScripts = (ranges: readonly UnicodeRange[], neededScripts: ReadonlySet<string>): boolean => {
  if (ranges.length === 0 || neededScripts.size === 0) return false
  for (const script of neededScripts) {
    const codepoint = SCRIPT_PROBE_CODEPOINTS[script]
    if (codepoint == null) continue
    for (const [start, end] of ranges) {
      if (codepoint >= start && codepoint <= end) return true
    }
  }
  return false
}

/**
 * Pick the slices of `family` that should be fetched for the current
 * scripts/text. Unconstrained sources always match.
 */
export const matchFontSubsets = (
  family: string,
  source: unknown,
  neededScripts: ReadonlySet<string>,
  text?: string
): FontSubsetMatch[] => {
  const subsets = normalizeFontFamilySource(source)
  const matches: FontSubsetMatch[] = []
  for (const [index, subset] of subsets.entries()) {
    if (!subsetMatchesNeed(subset, neededScripts, text)) continue
    matches.push({
      family,
      index,
      subset,
      identity: subsetIdentity(family, index, subset)
    })
  }
  return matches
}

export const collectNeededScripts = (
  text: string,
  previous: ReadonlySet<string> = new Set(['latn'])
): Set<string> => {
  const scripts = new Set<string>(previous)
  mergeScriptSets(scripts, collectUnicodeScriptsFromAss(text))
  return scripts
}

