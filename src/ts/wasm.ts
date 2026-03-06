let wasmModule: typeof import('../../pkg/akarisub') | null = null
let wasmInitPromise: Promise<void> | null = null
let wasmModulePath: string | URL | undefined

export type WasmEngineModule = InstanceType<(typeof import('../../pkg/akarisub'))['AkariSubEngine']>

export async function initWasm(moduleOrPath?: string | URL): Promise<void> {
  if (wasmModule) return
  if (wasmInitPromise) return wasmInitPromise

  if (moduleOrPath) {
    wasmModulePath = moduleOrPath
  }

  wasmInitPromise = (async () => {
    const mod = await import('../../pkg/akarisub')
    await mod.default(wasmModulePath)
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