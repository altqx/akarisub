import { describe, expect, test } from 'bun:test'
import {
  IDENTITY_COLOR_MATRIX,
  colorMatrixConversionMap,
  getColorMatrix3,
  getColorSpaceFilterUrl,
  libassYCbCrMap,
  mapVideoMatrix,
  mapVideoPrimaries,
  mapVideoTransfer,
  profileFromVideoFrameColorSpace,
  selectCanvasColorSpace,
  webYCbCrMap
} from '../src/ts/color-space'

describe('video color-space mapping', () => {
  test('maps BT.601 / BT.709 / BT.2020 matrices', () => {
    expect(mapVideoMatrix('bt709')).toBe('BT709')
    expect(mapVideoMatrix('bt470bg')).toBe('BT601')
    expect(mapVideoMatrix('smpte170m')).toBe('BT601')
    expect(mapVideoMatrix('bt2020-ncl')).toBe('BT2020')
    expect(mapVideoMatrix('bt2020-cl')).toBe('BT2020')
    expect(mapVideoMatrix('unknown')).toBeNull()
  })

  test('maps primaries and HDR transfers', () => {
    expect(mapVideoPrimaries('bt2020')).toBe('bt2020')
    expect(mapVideoPrimaries('smpte432')).toBe('smpte432')
    expect(mapVideoPrimaries('bt709')).toBe('bt709')
    expect(mapVideoTransfer('pq')).toBe('pq')
    expect(mapVideoTransfer('hlg')).toBe('hlg')
    expect(mapVideoTransfer('smpte2084')).toBe('pq')
    expect(mapVideoTransfer('bt709')).toBe('sdr')
  })

  test('builds an HDR Rec.2020 profile from a VideoFrame color space', () => {
    const profile = profileFromVideoFrameColorSpace({
      matrix: 'bt2020-ncl',
      primaries: 'bt2020',
      transfer: 'pq'
    })
    expect(profile.matrix).toBe('BT2020')
    expect(profile.primaries).toBe('bt2020')
    expect(profile.transfer).toBe('pq')
    expect(profile.hdr).toBe(true)
    expect(['srgb', 'display-p3', 'rec2020']).toContain(profile.canvasColorSpace)
  })

  test('keeps SDR BT.709 on sRGB when no WCG canvas is required', () => {
    expect(selectCanvasColorSpace('bt709', false)).toBe('srgb')
  })
})

describe('YCbCr conversion matrices', () => {
  test('keeps the existing BT.601 / BT.709 filter strings', () => {
    expect(colorMatrixConversionMap.BT601.BT709).toContain('1.0863')
    expect(colorMatrixConversionMap.BT709.BT601).toContain('0.9137')
  })

  test('converts between BT.2020 and BT.709', () => {
    const to2020 = getColorMatrix3('BT709', 'BT2020')
    const to709 = getColorMatrix3('BT2020', 'BT709')
    expect(to2020).not.toEqual(IDENTITY_COLOR_MATRIX)
    expect(to709).not.toEqual(IDENTITY_COLOR_MATRIX)
    expect(getColorMatrix3('BT709', 'BT709')).toEqual(IDENTITY_COLOR_MATRIX)
    expect(getColorSpaceFilterUrl('BT709', 'BT2020')).toContain('feColorMatrix')
    expect(getColorSpaceFilterUrl('BT709', 'BT709')).toBeNull()
  })

  test('indexes libass YCbCr header values', () => {
    expect(libassYCbCrMap[5]).toBe('BT709')
    expect(libassYCbCrMap[3]).toBe('BT601')
    expect(webYCbCrMap.bt2020).toBe('BT2020')
  })
})
