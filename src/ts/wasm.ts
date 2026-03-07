type GeneratedWasmModule = typeof import('../../pkg-bundler/akarisub')

let wasmModule: GeneratedWasmModule | null = null
let wasmInitPromise: Promise<void> | null = null
let wasmModulePath: string | URL | undefined

export type WasmEngineModule = InstanceType<GeneratedWasmModule['AkariSubEngine']>

const DEFAULT_BROWSER_WASM_PATH = '/akarisub/akarisub_bg.wasm'
const DEFAULT_BROWSER_MODULE_PATH = '/akarisub/akarisub.js'

export async function initWasm(moduleOrPath?: string | URL): Promise<void> {
  if (wasmModule) return
  if (wasmInitPromise) return wasmInitPromise

  if (moduleOrPath) {
    wasmModulePath = moduleOrPath
  }

  wasmInitPromise = (async () => {
    const mod = await importWasmModule(resolveModuleUrl(wasmModulePath))
    const init = resolveInit(mod)

    if (init) {
      await init()
    }

    wasmModule = mod
  })()

  return wasmInitPromise
}

export function isWasmInitialized(): boolean {
  return wasmModule !== null
}

export async function createEngine(moduleOrPath?: string | URL): Promise<WasmEngineModule> {
  await initWasm(moduleOrPath)
  if (!wasmModule) {
    throw new Error('WASM module not initialized')
  }

  return new wasmModule.AkariSubEngine()
}

function resolveInit(mod: GeneratedWasmModule): (() => Promise<void> | void) | null {
  const defaultInit = (mod as typeof mod & { default?: unknown }).default
  if (typeof defaultInit === 'function') {
    return defaultInit as () => Promise<void> | void
  }

  if (typeof mod.init === 'function') {
    return mod.init
  }

  return null
}

async function importWasmModule(moduleUrl: string): Promise<GeneratedWasmModule> {
  return (await import(/* webpackIgnore: true */ moduleUrl)) as GeneratedWasmModule
}

function resolveModuleUrl(moduleOrPath?: string | URL): string {
  if (!moduleOrPath) {
    if (hasRuntimeLocation()) {
      return toRuntimeUrl(DEFAULT_BROWSER_WASM_PATH).href.replace(/_bg\.wasm$/, '.js')
    }

    return DEFAULT_BROWSER_MODULE_PATH
  }

  const url = toRuntimeUrl(moduleOrPath)
  if (url.pathname.endsWith('.js')) {
    return url.href
  }

  if (url.pathname.endsWith('_bg.wasm')) {
    url.pathname = url.pathname.replace(/_bg\.wasm$/, '.js')
    return url.href
  }

  if (url.pathname.endsWith('.wasm')) {
    url.pathname = url.pathname.replace(/\.wasm$/, '.js')
  }

  return url.href
}

function toRuntimeUrl(value: string | URL): URL {
  if (value instanceof URL) {
    return new URL(value.href)
  }

  return new URL(value, getRuntimeBaseHref())
}

function getRuntimeBaseHref(): string {
  if (typeof window !== 'undefined') {
    return window.location.href
  }

  if (typeof self !== 'undefined' && 'location' in self && self.location) {
    return self.location.href
  }

  return import.meta.url
}

function hasRuntimeLocation(): boolean {
  return typeof window !== 'undefined' || (typeof self !== 'undefined' && 'location' in self && Boolean(self.location))
}