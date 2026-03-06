import type {
  AkariSubWorkerInboundMessage,
  AkariSubWorkerOutboundMessage,
  WorkerAckMessage,
  WorkerAttachOffscreenCanvasMessage,
  WorkerConfigureCanvasMessage,
  WorkerInitMessage,
  WorkerRenderedCompositedFrameMessage,
  WorkerRenderedImageSlicesMessage,
  WorkerRenderedOffscreenFrameMessage,
} from './worker-types'
import type { FontConfig, FrameMargins, FrameSize, ImageSliceFrameResult, CompositedFrameResult } from './renderer'

export interface WorkerClientCreateOptions extends Omit<WorkerOptions, 'type'> {
  worker?: Worker
  workerUrl?: string | URL
}

type AckAction = WorkerAckMessage['action']

export class AkariSubWorkerClient {
  private readonly worker: Worker
  private operationChain: Promise<unknown> = Promise.resolve()
  private disposed = false

  private constructor(worker: Worker) {
    this.worker = worker
  }

  static create(options: WorkerClientCreateOptions = {}): AkariSubWorkerClient {
    if (options.worker) {
      return new AkariSubWorkerClient(options.worker)
    }

    const worker = new Worker(options.workerUrl ?? new URL('./worker.js', import.meta.url), {
      ...options,
      type: 'module',
    })

    return new AkariSubWorkerClient(worker)
  }

  init(message: WorkerInitMessage): Promise<{ runtimeVersion: string; libassVersion: number }> {
    return this.enqueue(async () => {
      const response = await this.sendAndWait(
        message,
        (outbound): outbound is Extract<AkariSubWorkerOutboundMessage, { type: 'ready' }> => outbound.type === 'ready'
      )

      return {
        runtimeVersion: response.runtimeVersion,
        libassVersion: response.libassVersion,
      }
    })
  }

  configureCanvas(frame: FrameSize, storage?: FrameSize, margins?: FrameMargins): Promise<WorkerAckMessage> {
    const message: WorkerConfigureCanvasMessage = {
      type: 'configure-canvas',
      frame,
      storage,
      margins,
    }

    return this.waitForAck(message, 'configure-canvas')
  }

  setFonts(fonts: FontConfig): Promise<WorkerAckMessage> {
    return this.waitForAck({ type: 'set-fonts', fonts }, 'set-fonts')
  }

  setCacheLimits(glyphLimit: number, bitmapCacheLimit: number): Promise<WorkerAckMessage> {
    return this.waitForAck({ type: 'set-cache-limits', cacheLimits: { glyphLimit, bitmapCacheLimit } }, 'set-cache-limits')
  }

  addFont(name: string, data: Uint8Array): Promise<WorkerAckMessage> {
    return this.waitForAck({ type: 'add-font', name, data }, 'add-font', [data.buffer])
  }

  attachOffscreenCanvas(canvas: OffscreenCanvas, width: number, height: number): Promise<WorkerAckMessage> {
    const message: WorkerAttachOffscreenCanvasMessage = {
      type: 'attach-offscreen-canvas',
      canvas,
      width,
      height,
    }

    return this.waitForAck(message, 'attach-offscreen-canvas', [canvas])
  }

  loadTrack(subtitleData: string): Promise<WorkerAckMessage> {
    return this.waitForAck({ type: 'load-track', subtitleData }, 'load-track')
  }

  clearTrack(): Promise<WorkerAckMessage> {
    return this.waitForAck({ type: 'clear-track' }, 'clear-track')
  }

  clearFonts(): Promise<WorkerAckMessage> {
    return this.waitForAck({ type: 'clear-fonts' }, 'clear-fonts')
  }

  renderCompositedFrame(timestampMs: number, force = false): Promise<CompositedFrameResult | null> {
    return this.enqueue(async () => {
      const response = await this.sendAndWait(
        { type: 'render-composited-frame', timestampMs, force },
        (outbound): outbound is WorkerRenderedCompositedFrameMessage => outbound.type === 'rendered-composited-frame'
      )

      return response.frame
    })
  }

  renderImageSlices(timestampMs: number, force = false): Promise<ImageSliceFrameResult | null> {
    return this.enqueue(async () => {
      const response = await this.sendAndWait(
        { type: 'render-image-slices', timestampMs, force },
        (outbound): outbound is WorkerRenderedImageSlicesMessage => outbound.type === 'rendered-image-slices'
      )

      return response.frame
    })
  }

  renderOffscreenFrame(timestampMs: number, force = false): Promise<{ changed: number; timestampMs: number }> {
    return this.enqueue(async () => {
      const response = await this.sendAndWait(
        { type: 'render-offscreen-frame', timestampMs, force },
        (outbound): outbound is WorkerRenderedOffscreenFrameMessage => outbound.type === 'rendered-offscreen-frame'
      )

      return {
        changed: response.changed,
        timestampMs: response.timestampMs,
      }
    })
  }

  dispose(): Promise<void> {
    return this.enqueue(async () => {
      if (this.disposed) return

      await this.sendAndWait(
        { type: 'dispose' },
        (outbound): outbound is WorkerAckMessage => outbound.type === 'ack' && outbound.action === 'dispose'
      )

      this.worker.terminate()
      this.disposed = true
    })
  }

  terminate(): void {
    this.worker.terminate()
    this.disposed = true
  }

  private waitForAck(
    message: AkariSubWorkerInboundMessage,
    action: AckAction,
    transfer: Transferable[] = []
  ): Promise<WorkerAckMessage> {
    return this.enqueue(() =>
      this.sendAndWait(
        message,
        (outbound): outbound is WorkerAckMessage => outbound.type === 'ack' && outbound.action === action,
        transfer
      )
    )
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationChain.then(async () => {
      if (this.disposed) {
        throw new Error('AkariSubWorkerClient has been disposed')
      }

      return operation()
    })

    this.operationChain = run.catch(() => undefined)
    return run
  }

  private sendAndWait<T extends AkariSubWorkerOutboundMessage>(
    message: AkariSubWorkerInboundMessage,
    predicate: (message: AkariSubWorkerOutboundMessage) => message is T,
    transfer: Transferable[] = []
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const handleMessage = (event: MessageEvent<AkariSubWorkerOutboundMessage>) => {
        const outbound = event.data

        if (outbound.type === 'error') {
          cleanup()
          reject(new Error(outbound.error))
          return
        }

        if (!predicate(outbound)) {
          return
        }

        cleanup()
        resolve(outbound)
      }

      const handleError = (event: ErrorEvent) => {
        cleanup()
        reject(event.error instanceof Error ? event.error : new Error(event.message))
      }

      const cleanup = () => {
        this.worker.removeEventListener('message', handleMessage as EventListener)
        this.worker.removeEventListener('error', handleError)
      }

      this.worker.addEventListener('message', handleMessage as EventListener)
      this.worker.addEventListener('error', handleError)
      this.worker.postMessage(message, transfer)
    })
  }
}