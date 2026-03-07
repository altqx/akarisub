declare module '../../pkg/akarisub' {
  export class AkariSubEngine {
    constructor()
    version(): string
  }

  export default function init(input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<void>
}

declare module '../../pkg-bundler/akarisub' {
  export class AkariSubEngine {
    constructor()
    version(): string
  }

  export function init(): void
  export default function initWasm(input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<void>
}