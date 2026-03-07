let wasmModule: typeof import('../../pkg-bundler/akarisub') | null = null
let wasmInitPromise: Promise<void> | null = null
let wasmModulePath: string | URL | undefined

export type WasmEngineModule = InstanceType<(typeof import('../../pkg-bundler/akarisub'))['AkariSubEngine']>

export async function initWasm(moduleOrPath?: string | URL): Promise<void> {
  if (wasmModule) return
  if (wasmInitPromise) return wasmInitPromise

  if (moduleOrPath) {
    wasmModulePath = moduleOrPath
  }

  wasmInitPromise = (async () => {
    const mod = await import('../../pkg-bundler/akarisub')
    const init = resolveInit(mod)

    if (init) {
      await init(wasmModulePath)
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

function resolveInit(mod: typeof import('../../pkg-bundler/akarisub')): ((moduleOrPath?: string | URL) => Promise<void> | void) | null {
  const defaultInit = (mod as typeof mod & { default?: unknown }).default
  if (typeof defaultInit === 'function') {
    return defaultInit as (moduleOrPath?: string | URL) => Promise<void> | void
  }

  if (typeof mod.init === 'function') {
    return () => mod.init()
  }

  return null
}