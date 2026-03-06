let wasmModule: typeof import('../../pkg/akarisub') | null = null
let wasmInitPromise: Promise<void> | null = null

export type WasmEngineModule = InstanceType<(typeof import('../../pkg/akarisub'))['AkariSubEngine']>

export async function initWasm(): Promise<void> {
  if (wasmModule) return
  if (wasmInitPromise) return wasmInitPromise

  wasmInitPromise = (async () => {
    const mod = await import('../../pkg/akarisub')
    await mod.default()
    wasmModule = mod
  })()

  return wasmInitPromise
}

export function isWasmInitialized(): boolean {
  return wasmModule !== null
}

export async function createEngine(): Promise<WasmEngineModule> {
  await initWasm()
  if (!wasmModule) {
    throw new Error('WASM module not initialized')
  }

  return new wasmModule.AkariSubEngine()
}