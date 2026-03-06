declare module '../../pkg/akarisub' {
  export class AkariSubEngine {
    constructor()
    version(): string
  }

  export default function init(input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<void>
}