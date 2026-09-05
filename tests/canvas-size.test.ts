import { describe, expect, test } from 'bun:test'
import AkariSub from '../src/ts/akarisub'
import { computeCanvasSize } from '../src/ts/utils'

const withPixelRatio = (ratio: number, run: () => void): void => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio')
  try {
    Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: ratio })
    run()
  } finally {
    if (original) Object.defineProperty(globalThis, 'devicePixelRatio', original)
    else Reflect.deleteProperty(globalThis, 'devicePixelRatio')
  }
}

describe('subtitle canvas pixel dimensions', () => {
  test('quantizes fractional device scaling to the canvas backing dimensions', () => {
    withPixelRatio(1.25, () => {
      expect(computeCanvasSize(854, 480, 1, 1080, 0)).toEqual({ width: 1067, height: 600 })
    })
  })

  test('quantizes after prescaling and preserves zero-sized canvases', () => {
    withPixelRatio(1, () => {
      expect(computeCanvasSize(100, 57, 0.5, 20, 0)).toEqual({ width: 50, height: 28 })
      expect(computeCanvasSize(0, 57, 1, 1080, 0)).toEqual({ width: 0, height: 0 })
      expect(computeCanvasSize(1920, 1080, 1, 1080, 720)).toEqual({ width: 1280, height: 720 })
    })
  })

  test('sends identical integer sizes to the canvas, GPU and worker on repeated explicit resize', () => {
    const renderer = Object.create(AkariSub.prototype) as any
    let width = 0
    let height = 0
    let epochs = 0
    const canvas = {
      style: {},
      get width() {
        return width
      },
      set width(value: number) {
        width = Math.trunc(value)
      },
      get height() {
        return height
      },
      set height(value: number) {
        height = Math.trunc(value)
      }
    }
    const messages: any[] = []
    const gpuSizes: number[][] = []
    Object.assign(renderer, {
      _canvas: canvas,
      _canvasctrl: canvas,
      _stagedCanvases: new Set(),
      _gpuRenderer: { updateSize: (w: number, h: number) => gpuSizes.push([w, h]) },
      _videoWidth: 1920,
      _videoHeight: 1080,
      _bumpRenderEpoch: () => epochs++,
      sendMessage: (target: string, data: unknown) => messages.push({ target, data })
    })

    // Fractional sizes observed with Windows display scaling/browser zoom.
    renderer.resize(1569.287640094757, 883.0136204957962, 2.5, 3.25, false)
    renderer.resize(1569.287640094757, 883.0136204957962, 2.5, 3.25, false)

    expect(epochs).toBe(1)
    expect([canvas.width, canvas.height]).toEqual([1569, 883])
    expect(gpuSizes).toEqual([
      [1569, 883],
      [1569, 883]
    ])
    expect(messages).toEqual(
      [0, 1].map(() => ({
        target: 'canvas',
        data: { width: 1569, height: 883, videoWidth: 1920, videoHeight: 1080, force: false }
      }))
    )
    expect(canvas.style).toEqual({ top: '2.5px', left: '3.25px' })
  })
})
