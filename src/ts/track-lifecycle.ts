import type { EncryptedSubtitleContent, PreloadTrackSource } from './types'
import { isAbortError } from './asset-loader'

type TrackContent = string | Uint8Array
export interface TrackLoader {
  load(
    url: string,
    signal: AbortSignal,
    isCurrent: () => boolean,
    partial?: (text: string) => void,
    announcePartial?: boolean
  ): Promise<{ content: string; emittedPartialReady: boolean }>
  decrypt(content: EncryptedSubtitleContent): Promise<Uint8Array>
  prepare(content: string | Uint8Array | ArrayBuffer): TrackContent
  scanFonts(content: TrackContent): void
  waitFonts(): Promise<void>
  flushFonts(): void
  changed(generation: number): void
  protect(encrypted: boolean): void
  install(content: TrackContent, encrypted: boolean, requestId?: number): void
  partial(content: string): boolean
  removePartial(): void
}

const canceled = () => new DOMException('The operation was aborted.', 'AbortError')

/** Owns active loads, preloads and plaintext through supersession and activation. */
export class TrackLifecycle {
  private version = 0
  private active: AbortController | null = null
  private preloadOperation: AbortController | null = null
  private nextId = 1
  private stored: { id: number; content: TrackContent; encrypted: boolean } | null = null
  private destroyed = false
  constructor(private readonly loader: TrackLoader) {}

  get generation(): number {
    return this.version
  }

  invalidate(): number {
    this.active?.abort()
    this.active = null
    this.loader.changed(++this.version)
    return this.version
  }

  set(content: string | Uint8Array | ArrayBuffer): void {
    this.ensureAlive()
    this.invalidate()
    const prepared = this.loader.prepare(content)
    this.loader.scanFonts(prepared)
    this.loader.install(prepared, false)
  }

  async setEncrypted(content: EncryptedSubtitleContent): Promise<void> {
    this.ensureAlive()
    const generation = this.invalidate()
    this.loader.protect(true)
    const decrypted = await this.loader.decrypt(content)
    try {
      if (this.destroyed || generation !== this.version) return
      this.loader.install(decrypted, true)
    } finally {
      decrypted.fill(0)
    }
  }

  async setUrl(url: string): Promise<void> {
    this.ensureAlive()
    const generation = this.invalidate()
    const controller = (this.active = new AbortController())
    const current = () => !this.destroyed && generation === this.version
    this.loader.protect(false)
    let publishedPartial = false
    try {
      const loaded = await this.loader.load(url, controller.signal, current, (text) => {
        if (current()) publishedPartial = this.loader.partial(text)
      })
      if (!current()) return
      const content = this.loader.prepare(loaded.content)
      this.loader.scanFonts(content)
      this.loader.install(content, false)
    } catch (error) {
      if (!current() || isAbortError(error)) return
      if (publishedPartial) this.loader.removePartial()
      throw error
    } finally {
      if (this.active === controller) this.active = null
    }
  }

  /** Startup loads share cancellation with later track replacement. */
  async initialUrl(url: string): Promise<{ content: string; emittedPartialReady: boolean }> {
    this.ensureAlive()
    this.active?.abort()
    const controller = (this.active = new AbortController()),
      generation = this.version
    try {
      return await this.loader.load(url, controller.signal, () => !this.destroyed && generation === this.version)
    } finally {
      if (this.active === controller) this.active = null
    }
  }

  async preload(source: PreloadTrackSource): Promise<number> {
    this.ensureAlive()
    this.preloadOperation?.abort()
    const controller = (this.preloadOperation = new AbortController())
    const current = () => !this.destroyed && this.preloadOperation === controller && !controller.signal.aborted
    const encrypted = source.kind === 'encrypted'
    let content: TrackContent | undefined
    let retained = false
    try {
      if (source.kind === 'url') {
        const loaded = await this.loader.load(source.url, controller.signal, current, undefined, false)
        content = this.loader.prepare(loaded.content)
      } else if (source.kind === 'encrypted') {
        content = await this.loader.decrypt(source.content)
      } else content = this.loader.prepare(source.content)
      if (!current()) throw canceled()
      this.loader.scanFonts(content)
      await this.waitForFonts(controller.signal)
      if (!current()) throw canceled()
      this.loader.flushFonts()
      this.clearStored()
      const id = this.nextId++
      this.stored = { id, content, encrypted }
      retained = true
      return id
    } catch (error) {
      if (this.preloadOperation === controller) this.clearStored()
      if (!current() || isAbortError(error)) throw new Error('The preload was cancelled')
      throw error
    } finally {
      if (!retained && encrypted && content instanceof Uint8Array) content.fill(0)
      if (this.preloadOperation === controller) this.preloadOperation = null
    }
  }

  activate(id: number | undefined, requestId: number): number {
    this.ensureAlive()
    const pending = this.stored
    if (!pending || (id != null && pending.id !== id)) {
      throw new Error(pending ? 'That preloaded track is no longer available' : 'No preloaded track is ready')
    }
    this.invalidate()
    this.stored = null
    try {
      this.loader.install(pending.content, pending.encrypted, requestId)
    } finally {
      if (pending.encrypted && pending.content instanceof Uint8Array) pending.content.fill(0)
    }
    return pending.id
  }

  destroy(): void {
    this.destroyed = true
    this.preloadOperation?.abort()
    this.preloadOperation = null
    this.clearStored()
    this.invalidate()
  }

  private clearStored(): void {
    if (this.stored?.encrypted && this.stored.content instanceof Uint8Array) this.stored.content.fill(0)
    this.stored = null
  }

  private ensureAlive(): void {
    if (this.destroyed) throw new Error('Track lifecycle was destroyed')
  }

  private waitForFonts(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener('abort', abort)
        reject(canceled())
      }
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener('abort', abort, { once: true })
      this.loader.waitFonts().then(
        () => {
          signal.removeEventListener('abort', abort)
          resolve()
        },
        (error) => {
          signal.removeEventListener('abort', abort)
          reject(error)
        }
      )
    })
  }
}
