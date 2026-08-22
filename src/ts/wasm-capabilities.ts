/**
 * Runtime WASM feature probes used to pick a SIMD or pthread binary.
 *
 * The SIMD module bytes are the same 8-instruction smoke test JASSUB uses:
 * a wasm module whose only function returns an i8x16 splat.
 */

const SIMD_MODULE = Uint8Array.of(
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
)

let simdSupported: boolean | null = null
let threadsSupported: boolean | null = null

/** True when this engine accepts WASM SIMD (`v128`) instructions. */
export function supportsWasmSimd(): boolean {
  if (simdSupported !== null) return simdSupported
  try {
    simdSupported = WebAssembly.validate(SIMD_MODULE)
  } catch {
    simdSupported = false
  }
  return simdSupported
}

/** True when SharedArrayBuffer + Atomics are usable (COOP/COEP isolated pages). */
export function supportsWasmThreads(): boolean {
  if (threadsSupported !== null) return threadsSupported
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
  threadsSupported =
    isolated &&
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof Atomics !== 'undefined' &&
    typeof WebAssembly !== 'undefined'
  return threadsSupported
}

export interface WasmBinarySelection {
  wasmUrl: string
  glueUrl?: string
  simd: boolean
  threads: boolean
}

export interface WasmBinaryOptions {
  wasmUrl: string
  glueUrl?: string
  modernWasmUrl?: string
  modernGlueUrl?: string
  mtWasmUrl?: string
  mtGlueUrl?: string
}

/**
 * Prefer the pthread SIMD binary on isolated pages, then a SIMD-only modern
 * binary, then the default worker WASM.
 */
export function selectWasmBinary(options: WasmBinaryOptions): WasmBinarySelection {
  const simd = supportsWasmSimd()
  const threads = supportsWasmThreads()

  if (threads && options.mtWasmUrl) {
    return {
      wasmUrl: options.mtWasmUrl,
      glueUrl: options.mtGlueUrl,
      simd,
      threads: true
    }
  }

  if (simd && options.modernWasmUrl) {
    return {
      wasmUrl: options.modernWasmUrl,
      glueUrl: options.modernGlueUrl,
      simd: true,
      threads: false
    }
  }

  return {
    wasmUrl: options.wasmUrl,
    glueUrl: options.glueUrl,
    simd,
    threads: false
  }
}
