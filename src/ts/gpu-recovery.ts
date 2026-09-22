import type { RenderImage, RendererRecoveryReason } from './types'
import type { WebGPURenderer } from './webgpu-renderer'
import type { WebGL2Renderer } from './webgl2-renderer'

export type GPURenderer = WebGPURenderer | WebGL2Renderer
export interface GPUCanvasFrameSnapshot {
  canvas: HTMLCanvasElement
  sequence: number
  colorManaged: boolean
}
export interface GPURawFrameSnapshot {
  images: RenderImage[]
  width: number
  height: number
  sequence: number
  colorManaged: false
}
export type GPUFrameSnapshot = GPUCanvasFrameSnapshot | GPURawFrameSnapshot

export interface GPURecoveryHost {
  current(): GPURenderer | null
  use(renderer: GPURenderer | null): void
  begin(reason: RendererRecoveryReason): void
  replay(renderer: GPURenderer): Promise<void>
  recovered(reason: RendererRecoveryReason): void
  fallback(reason: RendererRecoveryReason, error: unknown): void
  discard(snapshot: GPUFrameSnapshot): void
}

/** Owns successful frame retention and the complete loss/replay/fallback lifetime. */
export class GPURecovery {
  private retained: GPUFrameSnapshot | null = null
  private nextSequence = 1
  private destroyed = false
  private generation = 0
  private operation: { renderer: GPURenderer; reason: RendererRecoveryReason; restoring: boolean } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(private readonly host: GPURecoveryHost) {}

  get snapshot(): GPUFrameSnapshot | null {
    return this.retained
  }
  sequence(): number {
    return this.nextSequence++
  }

  commit(snapshot: GPUFrameSnapshot | null): void {
    if (!snapshot || snapshot === this.retained) return
    if (this.destroyed || (this.retained && snapshot.sequence < this.retained.sequence)) {
      this.host.discard(snapshot)
      return
    }
    const previous = this.retained
    this.retained = snapshot
    if (previous) this.host.discard(previous)
  }

  materialize(original: GPUFrameSnapshot, materialized: GPUCanvasFrameSnapshot): void {
    if (this.retained === original) this.commit(materialized)
    else this.host.discard(materialized)
  }

  retainAfter(completion: boolean | Promise<boolean>, snapshot: GPUFrameSnapshot | null): boolean | Promise<boolean> {
    if (!snapshot) return completion
    const settled = (painted: boolean): boolean => {
      if (painted) this.commit(snapshot)
      else this.host.discard(snapshot)
      return painted
    }
    if (typeof completion === 'boolean') return settled(completion)
    return completion.then(settled, (error) => {
      this.host.discard(snapshot)
      throw error
    })
  }

  begin(renderer: GPURenderer, reason: RendererRecoveryReason): boolean {
    if (this.destroyed || this.host.current() !== renderer || this.operation) return false
    this.operation = { renderer, reason, restoring: false }
    this.generation++
    this.host.begin(reason)
    return true
  }

  async replace(
    renderer: GPURenderer,
    create: () => GPURenderer,
    initialize: (replacement: GPURenderer, isCurrent: () => boolean) => Promise<void>
  ): Promise<void> {
    if (!this.begin(renderer, 'device-lost')) return
    const generation = this.generation
    const current = () => !this.destroyed && generation === this.generation && this.operation != null
    let replacement: GPURenderer | null = null
    try {
      renderer.destroy()
      replacement = create()
      await initialize(replacement, current)
      if (!current()) {
        replacement.destroy()
        return
      }
      this.host.use(replacement)
      await this.restore(replacement)
    } catch (error) {
      if (replacement && this.host.current() !== replacement) replacement.destroy()
      if (current()) this.fail(renderer, error)
    }
  }

  waitForRestore(renderer: GPURenderer, timeoutMs = 3000): void {
    if (!this.begin(renderer, 'context-lost')) return
    const generation = this.generation
    this.timer = setTimeout(() => {
      if (generation === this.generation)
        this.fail(renderer, new Error('Timed out waiting for WebGL2 context restoration'))
    }, timeoutMs)
  }

  async restore(renderer: GPURenderer): Promise<void> {
    const operation = this.operation
    if (this.destroyed || !operation || operation.restoring || this.host.current() !== renderer) return
    operation.restoring = true
    const generation = this.generation
    this.clearTimer()
    try {
      await this.host.replay(renderer)
      if (this.destroyed || generation !== this.generation || this.host.current() !== renderer) return
      this.operation = null
      this.host.recovered(operation.reason)
    } catch (error) {
      if (generation === this.generation) this.fail(renderer, error)
    }
  }

  fail(renderer: GPURenderer, error: unknown): void {
    const operation = this.operation
    if (this.destroyed || !operation) return
    if (this.host.current() !== renderer && operation.renderer !== renderer) return
    this.clearTimer()
    try {
      renderer.destroy()
    } catch {
      /* Lost devices can reject cleanup. */
    }
    // A failed replacement must not leave a second live renderer behind.
    const current = this.host.current()
    if (current && current !== renderer && current !== operation.renderer) {
      try {
        current.destroy()
      } catch {
        /* Lost replacement. */
      }
    }
    this.host.use(null)
    this.operation = null
    this.generation++
    this.host.fallback(operation.reason, error)
  }

  destroy(): void {
    this.destroyed = true
    this.generation++
    this.clearTimer()
    this.operation = null
    const snapshot = this.retained
    this.retained = null
    if (snapshot) this.host.discard(snapshot)
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
