import { describe, expect, test } from 'bun:test'
import {
  collectUnicodeScripts,
  collectUnicodeScriptsFromAss,
  expandScriptAlias,
  parseUnicodeRange,
  stripAssOverrides
} from '../src/ts/unicode-scripts'
import {
  collectNeededScripts,
  fontFamilyHasSubsets,
  matchFontSubsets,
  normalizeFontFamilySource,
  subsetMatchesNeed
} from '../src/ts/font-subsets'

describe('unicode-range parsing', () => {
  test('parses closed ranges, singles, and wildcards', () => {
    expect(parseUnicodeRange('U+0000-00FF, U+3040-309F')).toEqual([
      [0x0000, 0x00ff],
      [0x3040, 0x309f]
    ])
    expect(parseUnicodeRange('U+20B4')).toEqual([[0x20b4, 0x20b4]])
    expect(parseUnicodeRange('U+00??')).toEqual([[0x0000, 0x00ff]])
  })
})

describe('script detection', () => {
  test('maps CJK and aliases', () => {
    expect([...collectUnicodeScripts('Hello')]).toEqual(['latn'])
    expect(collectUnicodeScripts('こんにちは').has('hira')).toBe(true)
    expect(collectUnicodeScripts('カタカナ').has('kana')).toBe(true)
    expect(collectUnicodeScripts('字幕').has('hani')).toBe(true)
    expect(collectUnicodeScripts('한글').has('hang')).toBe(true)
    expect(expandScriptAlias('cjk').sort()).toEqual(['hang', 'hani', 'hira', 'kana'])
    expect(expandScriptAlias('jp')).toEqual(['hira', 'kana', 'hani'])
  })

  test('ignores ASS override tags when collecting scripts', () => {
    expect(stripAssOverrides('{\\an8\\fnArial}字幕')).toBe('字幕')
    expect(collectUnicodeScriptsFromAss('{\\an8}字幕').has('hani')).toBe(true)
    expect(collectUnicodeScriptsFromAss('{\\an8}字幕').has('latn')).toBe(false)
  })
})

describe('font subset matching', () => {
  test('treats a URL as a single unconstrained source', () => {
    expect(normalizeFontFamilySource('/fonts/noto.woff2')).toEqual([{ src: '/fonts/noto.woff2' }])
    expect(fontFamilyHasSubsets('/fonts/noto.woff2')).toBe(false)
    expect(
      fontFamilyHasSubsets([
        { src: '/latin.woff2', unicodeRange: 'U+0000-00FF' },
        { src: '/han.woff2', scripts: ['hani'] }
      ])
    ).toBe(true)
  })

  test('loads only slices that overlap the current scripts', () => {
    const family = [
      { src: '/latin.woff2', unicodeRange: 'U+0000-00FF' },
      { src: '/hira.woff2', scripts: ['hira'] },
      { src: '/han.woff2', scripts: ['hani'] },
      { src: '/hang.woff2', scripts: ['hang'] }
    ]
    const latinOnly = collectNeededScripts('Hello')
    expect(matchFontSubsets('noto', family, latinOnly).map((item) => item.subset.src)).toEqual(['/latin.woff2'])

    const japanese = collectNeededScripts('Hello こんにちは字幕', latinOnly)
    expect(matchFontSubsets('noto', family, japanese, 'Hello こんにちは字幕').map((item) => item.subset.src)).toEqual([
      '/latin.woff2',
      '/hira.woff2',
      '/han.woff2'
    ])
  })

  test('unconstrained sources always match', () => {
    expect(subsetMatchesNeed({ src: '/full.woff2' }, new Set(['latn']))).toBe(true)
  })
})
