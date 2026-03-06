/// <reference lib="webworker" />

import { AkariSubRenderer } from './renderer'
import type {
  AkariSubWorkerInboundMessage,
  AkariSubWorkerOutboundMessage,
  WorkerAckMessage,
  WorkerInitMessage,
} from './worker-types'

declare const self: DedicatedWorkerGlobalScope

let renderer: AkariSubRenderer | null = null
let offscreenCanvas: OffscreenCanvas | null = null
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null

const ensureRenderer = (): AkariSubRenderer => {
  if (!renderer) {
    throw new Error('AkariSubRenderer has not been initialized')
  }

  return renderer
}

const stateSnapshot = () => {
  const activeRenderer = ensureRenderer()

  return {
    hasTrack: activeRenderer.hasTrack,
    eventCount: activeRenderer.eventCount,
    styleCount: activeRenderer.styleCount,
    trackColorSpace: activeRenderer.trackColorSpace,
  }
}

const post = (message: AkariSubWorkerOutboundMessage, transfer: Transferable[] = []): void => {
  self.postMessage(message, transfer)
}

const postAck = (action: WorkerAckMessage['action']): void => {
  post({
    type: 'ack',
    action,
    ...stateSnapshot(),
  })
}

const applyInit = (activeRenderer: AkariSubRenderer, data: WorkerInitMessage): void => {
  activeRenderer.configureCanvas(data.frame, data.storage)
  if (offscreenCanvas) {
    offscreenCanvas.width = data.frame.width
    offscreenCanvas.height = data.frame.height
  }
  if (data.margins) {
    activeRenderer.setMargins(data.margins)
  }
  if (data.cacheLimits) {
    activeRenderer.setCacheLimits(data.cacheLimits.glyphLimit, data.cacheLimits.bitmapCacheLimit)
  }
  if (data.fonts) {
    activeRenderer.setFonts(data.fonts)
  }
}

const handleMessage = async (data: AkariSubWorkerInboundMessage): Promise<void> => {
  switch (data.type) {
    case 'init': {
      renderer = await AkariSubRenderer.createWithWasmUrl(data.wasmUrl)
      applyInit(renderer, data)
      post({
        type: 'ready',
        runtimeVersion: renderer.runtimeVersion,
        libassVersion: renderer.libassVersion,
      })
      return
    }

    case 'configure-canvas': {
      const activeRenderer = ensureRenderer()
      activeRenderer.configureCanvas(data.frame, data.storage)
      if (data.margins) {
        activeRenderer.setMargins(data.margins)
      }
      postAck('configure-canvas')
      return
    }

    case 'set-fonts': {
      const activeRenderer = ensureRenderer()
      activeRenderer.setFonts(data.fonts)
      postAck('set-fonts')
      return
    }

    case 'set-cache-limits': {
      const activeRenderer = ensureRenderer()
      activeRenderer.setCacheLimits(data.cacheLimits.glyphLimit, data.cacheLimits.bitmapCacheLimit)
      postAck('set-cache-limits')
      return
    }

    case 'add-font': {
      const activeRenderer = ensureRenderer()
      activeRenderer.addFont(data.name, data.data)
      postAck('add-font')
      return
    }

    case 'attach-offscreen-canvas': {
      offscreenCanvas = data.canvas
      offscreenCanvas.width = data.width
      offscreenCanvas.height = data.height
      offscreenCtx = offscreenCanvas.getContext('2d', { alpha: true, desynchronized: true })
      if (!offscreenCtx) {
        throw new Error('2D OffscreenCanvas rendering is not supported')
      }
      postAck('attach-offscreen-canvas')
      return
    }

    case 'load-track': {
      const activeRenderer = ensureRenderer()
      activeRenderer.loadTrackFromUtf8(data.subtitleData)
      postAck('load-track')
      return
    }

    case 'set-default-font': {
      const activeRenderer = ensureRenderer()
      activeRenderer.setDefaultFont(data.font)
      postAck('set-default-font')
      return
    }

    case 'create-event': {
      const activeRenderer = ensureRenderer()
      const index = activeRenderer.createEvent(data.event)
      post({ type: 'created-event', index })
      return
    }

    case 'set-event': {
      const activeRenderer = ensureRenderer()
      activeRenderer.setEvent(data.index, data.event)
      postAck('set-event')
      return
    }

    case 'remove-event': {
      const activeRenderer = ensureRenderer()
      activeRenderer.removeEvent(data.index)
      postAck('remove-event')
      return
    }

    case 'get-events': {
      const activeRenderer = ensureRenderer()
      post({ type: 'events', events: activeRenderer.getEvents() })
      return
    }

    case 'create-style': {
      const activeRenderer = ensureRenderer()
      const index = activeRenderer.createStyle(data.style)
      post({ type: 'created-style', index })
      return
    }

    case 'set-style': {
      const activeRenderer = ensureRenderer()
      activeRenderer.setStyle(data.index, data.style)
      postAck('set-style')
      return
    }

    case 'remove-style': {
      const activeRenderer = ensureRenderer()
      activeRenderer.removeStyle(data.index)
      postAck('remove-style')
      return
    }

    case 'get-styles': {
      const activeRenderer = ensureRenderer()
      post({ type: 'styles', styles: activeRenderer.getStyles() })
      return
    }

    case 'style-override': {
      const activeRenderer = ensureRenderer()
      activeRenderer.styleOverride(data.index)
      postAck('style-override')
      return
    }

    case 'disable-style-override': {
      const activeRenderer = ensureRenderer()
      activeRenderer.disableStyleOverride()
      postAck('disable-style-override')
      return
    }

    case 'clear-track': {
      const activeRenderer = ensureRenderer()
      activeRenderer.clearTrack()
      postAck('clear-track')
      return
    }

    case 'clear-fonts': {
      const activeRenderer = ensureRenderer()
      activeRenderer.clearFonts()
      postAck('clear-fonts')
      return
    }

    case 'render-composited-frame': {
      const activeRenderer = ensureRenderer()
      const frame = activeRenderer.renderCompositedFrame(data.timestampMs, data.force ?? false)
      const transfer = frame ? [frame.pixels.buffer] : []
      post({ type: 'rendered-composited-frame', frame }, transfer)
      return
    }

    case 'render-image-slices': {
      const activeRenderer = ensureRenderer()
      const frame = activeRenderer.renderImageSlices(data.timestampMs, data.force ?? false)
      const transfer = frame ? frame.images.map((image) => image.pixels.buffer) : []
      post({ type: 'rendered-image-slices', frame }, transfer)
      return
    }

    case 'render-offscreen-frame': {
      const activeRenderer = ensureRenderer()
      if (!offscreenCanvas || !offscreenCtx) {
        throw new Error('OffscreenCanvas has not been attached')
      }

      const frame = activeRenderer.renderCompositedFrame(data.timestampMs, data.force ?? false)
      if (frame) {
        if (offscreenCanvas.width !== frame.width) offscreenCanvas.width = frame.width
        if (offscreenCanvas.height !== frame.height) offscreenCanvas.height = frame.height

        if (frame.changed !== 0 || data.force) {
          const imageData = new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height)
          offscreenCtx.clearRect(0, 0, frame.width, frame.height)
          offscreenCtx.putImageData(imageData, 0, 0)
        }

        post({
          type: 'rendered-offscreen-frame',
          changed: frame.changed,
          timestampMs: frame.timestampMs,
        })
        return
      }

      post({
        type: 'rendered-offscreen-frame',
        changed: 0,
        timestampMs: data.timestampMs,
      })
      return
    }

    case 'dispose': {
      const activeRenderer = ensureRenderer()
      activeRenderer.clearTrack()
      activeRenderer.clearFonts()
      renderer = null
      offscreenCanvas = null
      offscreenCtx = null
      post({
        type: 'ack',
        action: 'dispose',
        hasTrack: false,
        eventCount: 0,
        styleCount: 0,
        trackColorSpace: null,
      })
      return
    }
  }
}

self.onmessage = (event: MessageEvent<AkariSubWorkerInboundMessage>) => {
  void handleMessage(event.data).catch((error: unknown) => {
    post({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
      requestType: event.data?.type,
    })
  })
}