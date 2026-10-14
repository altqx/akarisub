import { describe, expect, test } from 'bun:test'
import AkariSub from '../src/ts/akarisub'

// The worker posts rawAssGpuFailed when worker WebGPU recovery gives up. The
// transferred canvas keeps its WebGPU context, so only a new canvas can be
// drawn to.
const failedRenderer = (overrides: Record<string, unknown>) => {
  const renderer = Object.create(AkariSub.prototype) as any
  const replaced: string[] = []
  const warnings: unknown[] = []
  Object.assign(renderer, {
    _destroyed: false,
    _offscreenRender: true,
    _ctx: false,
    _rendererType: 'canvas2d',
    _replaceOwnedOverlayCanvas: (mode: string) => replaced.push(mode),
    _emitPerformanceWarning: (warning: unknown) => warnings.push(warning),
    ...overrides
  })
  renderer._onmessage({ data: { target: 'rawAssGpuFailed' } } as MessageEvent)
  return { replaced, warnings }
}

describe('worker WebGPU failure on the main thread', () => {
  test('replaces an owned overlay canvas so the worker can bind WebGL2', () => {
    const { replaced, warnings } = failedRenderer({ _canvasParent: {} })
    expect(replaced).toEqual(['offscreen'])
    expect(warnings).toEqual([{ kind: 'renderer-recovery', reason: 'device-lost', rendererType: 'canvas2d' }])
  })

  test('reports a caller-owned canvas that cannot be replaced', () => {
    const originalWarn = console.warn
    const logged: unknown[][] = []
    console.warn = (...args: unknown[]) => logged.push(args)
    try {
      const { replaced, warnings } = failedRenderer({ _canvasParent: undefined })
      expect(replaced).toEqual([])
      expect(warnings).toHaveLength(1)
      expect(logged).toHaveLength(1)
    } finally {
      console.warn = originalWarn
    }
  })

  test('ignores the message after destroy', () => {
    const { replaced, warnings } = failedRenderer({ _canvasParent: {}, _destroyed: true })
    expect(replaced).toEqual([])
    expect(warnings).toEqual([])
  })
})
