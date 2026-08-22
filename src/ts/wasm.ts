/**
 * WASM glue and binary URL resolution.
 */

/** Get the bundled fallback font URL (always returns an absolute URL). */
export function getDefaultFontUrl(): string {
  try {
    return new URL('../../assets/default.woff2', import.meta.url).href
  } catch {
    if (typeof window !== 'undefined') {
      return new URL('/akarisub/default.woff2', window.location.origin).href
    }

    return '/akarisub/default.woff2'
  }
}

/** Get the WASM file URL (always returns an absolute URL). */
export function getWasmUrl(): string {
  try {
    return new URL('../../pkg/akarisub.wasm', import.meta.url).href
  } catch {
    if (typeof window !== 'undefined') {
      return new URL('/akarisub/akarisub.wasm', window.location.origin).href
    }

    return '/akarisub/akarisub.wasm'
  }
}

/** Get the WASM glue script URL (always returns an absolute URL). */
export function getWasmGlueUrl(): string {
  try {
    return new URL('../../pkg/akarisub.js', import.meta.url).href
  } catch {
    if (typeof window !== 'undefined') {
      return new URL('/akarisub/akarisub.js', window.location.origin).href
    }

    return '/akarisub/akarisub.js'
  }
}

/** Pthread SIMD WASM URL. Requires COOP/COEP (`crossOriginIsolated`). */
export function getMtWasmUrl(): string {
  try {
    return new URL('../../pkg/akarisub-mt.wasm', import.meta.url).href
  } catch {
    if (typeof window !== 'undefined') {
      return new URL('/akarisub/akarisub-mt.wasm', window.location.origin).href
    }

    return '/akarisub/akarisub-mt.wasm'
  }
}

/** Pthread SIMD WASM glue URL. */
export function getMtWasmGlueUrl(): string {
  try {
    return new URL('../../pkg/akarisub-mt.js', import.meta.url).href
  } catch {
    if (typeof window !== 'undefined') {
      return new URL('/akarisub/akarisub-mt.js', window.location.origin).href
    }

    return '/akarisub/akarisub-mt.js'
  }
}

/** Derive a glue URL from a WASM URL when the caller only provided wasmUrl. */
export function glueUrlFromWasmUrl(wasmUrl: string): string {
  const derivedUrl = new URL(wasmUrl, typeof location !== 'undefined' ? location.href : 'http://localhost/')
  derivedUrl.pathname = derivedUrl.pathname.replace(/\.wasm$/, '.js')
  return derivedUrl.href
}
