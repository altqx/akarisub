import { describe, expect, test } from 'bun:test'
import { WebGL2Renderer } from '../src/ts/webgl2-renderer'

describe('WebGL2 context recovery', () => {
  test('prevents context loss and rebuilds resources after restoration', async () => {
    const listeners = new Map<string, EventListener>()
    const removed: string[] = []
    const gl = {
      viewportCalls: [] as number[][],
      viewport(...args: number[]) {
        this.viewportCalls.push(args)
      }
    }
    const canvas = {
      width: 0,
      height: 0,
      addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
      removeEventListener: (type: string) => removed.push(type)
    } as unknown as HTMLCanvasElement
    const renderer = new WebGL2Renderer() as any
    let lost = 0
    let restored = 0
    renderer.init = async () => undefined
    renderer._initGL = () => {
      renderer._gl = gl
      renderer._initialized = true
    }
    renderer.onContextLost = () => lost++
    renderer.onContextRestored = (error?: unknown) => {
      expect(error).toBeUndefined()
      restored++
    }

    await renderer.setCanvas(canvas, 16, 9)
    let prevented = false
    listeners.get('webglcontextlost')!({ preventDefault: () => (prevented = true) } as Event)
    expect(prevented).toBe(true)
    expect(lost).toBe(1)
    expect(renderer.initialized).toBe(false)

    listeners.get('webglcontextrestored')!(new Event('webglcontextrestored'))
    expect(restored).toBe(1)
    expect(renderer.initialized).toBe(true)
    expect(gl.viewportCalls.at(-1)).toEqual([0, 0, 16, 9])

    renderer._canvas = canvas
    renderer._gl = null
    renderer.destroy()
    expect(removed).toEqual(['webglcontextlost', 'webglcontextrestored'])
  })
})
