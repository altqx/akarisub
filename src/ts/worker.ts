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
      renderer = await AkariSubRenderer.create()
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

    case 'load-track': {
      const activeRenderer = ensureRenderer()
      activeRenderer.loadTrackFromUtf8(data.subtitleData)
      postAck('load-track')
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

    case 'dispose': {
      const activeRenderer = ensureRenderer()
      activeRenderer.clearTrack()
      activeRenderer.clearFonts()
      renderer = null
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