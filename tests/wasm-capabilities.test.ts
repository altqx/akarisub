import { describe, expect, test } from 'bun:test'
import { selectWasmBinary, supportsWasmSimd, supportsWasmThreads } from '../src/ts/wasm-capabilities'

describe('WASM binary selection', () => {
  test('prefers the pthread binary when threads are available', () => {
    const selected = selectWasmBinary({
      wasmUrl: '/akarisub.wasm',
      glueUrl: '/akarisub.js',
      modernWasmUrl: '/akarisub-simd.wasm',
      mtWasmUrl: '/akarisub-mt.wasm',
      mtGlueUrl: '/akarisub-mt.js'
    })

    if (supportsWasmThreads()) {
      expect(selected.wasmUrl).toBe('/akarisub-mt.wasm')
      expect(selected.glueUrl).toBe('/akarisub-mt.js')
      expect(selected.threads).toBe(true)
    } else if (supportsWasmSimd()) {
      expect(selected.wasmUrl).toBe('/akarisub-simd.wasm')
      expect(selected.threads).toBe(false)
      expect(selected.simd).toBe(true)
    } else {
      expect(selected.wasmUrl).toBe('/akarisub.wasm')
      expect(selected.threads).toBe(false)
    }
  })

  test('pthread support requires an explicit crossOriginIsolated page', () => {
    if (supportsWasmThreads()) {
      expect(crossOriginIsolated).toBe(true)
    } else {
      expect(typeof crossOriginIsolated === 'undefined' || !crossOriginIsolated).toBe(true)
    }
  })

  test('falls back to the default binary when no optional URLs are set', () => {
    const selected = selectWasmBinary({
      wasmUrl: '/akarisub.wasm',
      glueUrl: '/akarisub.js'
    })
    expect(selected.wasmUrl).toBe('/akarisub.wasm')
    expect(selected.glueUrl).toBe('/akarisub.js')
    expect(selected.simd).toBe(supportsWasmSimd())
    expect(selected.threads).toBe(false)
  })
})
