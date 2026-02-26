import type { RenderImage } from './types'

const MAX_IMAGES_PER_BATCH = 256
const MAX_TEXTURE_ARRAY_LAYERS = 256

// GLSL Vertex Shader (GLSL ES 3.00)
const VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec4 a_destRect;
in vec4 a_texInfo;

uniform vec2 u_resolution;

out vec2 v_uv;
flat out int v_texIndex;
flat out vec2 v_texSize;

vec2 quadPos(int id) {
  if (id == 0) return vec2(0.0, 0.0);
  if (id == 1) return vec2(1.0, 0.0);
  if (id == 2) return vec2(0.0, 1.0);
  if (id == 3) return vec2(1.0, 0.0);
  if (id == 4) return vec2(1.0, 1.0);
  return vec2(0.0, 1.0);
}

void main() {
  vec2 qp = quadPos(gl_VertexID);
  vec2 pixelPos = a_destRect.xy + qp * a_destRect.zw;

  // Convert CSS pixel coords (y=0 top) to GL clip space (y=1 top)
  vec2 clip = (pixelPos / u_resolution) * 2.0 - 1.0;
  clip.y = -clip.y;

  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = qp;
  v_texIndex = int(a_texInfo.z);
  v_texSize = a_texInfo.xy;
}
`

// GLSL Fragment Shader (GLSL ES 3.00)
const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray u_texArray;
uniform ivec2 u_texArraySize;

in vec2 v_uv;
flat in int v_texIndex;
flat in vec2 v_texSize;

out vec4 fragColor;

void main() {
  vec2 normalizedCoord = v_uv * v_texSize / vec2(u_texArraySize);
  vec4 color = texture(u_texArray, vec3(normalizedCoord, float(v_texIndex)));
  // Premultiplied alpha output (matches WebGPU renderer behaviour)
  fragColor = vec4(color.rgb * color.a, color.a);
}
`

/**
 * Check if WebGL2 is supported in the current browser.
 */
export function isWebGL2Supported(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return canvas.getContext('webgl2') !== null
  } catch {
    return false
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`WebGL2 shader compilation failed: ${info}`)
  }
  return shader
}

/**
 * High-performance WebGL2 subtitle renderer for AkariSub.
 */
export class WebGL2Renderer {
  private _gl: WebGL2RenderingContext | null = null
  private _canvas: HTMLCanvasElement | null = null
  private _program: WebGLProgram | null = null
  private _vao: WebGLVertexArrayObject | null = null
  private _instanceBuffer: WebGLBuffer | null = null
  private _texArray: WebGLTexture | null = null

  private _texWidth = 0
  private _texHeight = 0
  private _texLayers = 0

  private _resolutionLoc: WebGLUniformLocation | null = null
  private _texArraySizeLoc: WebGLUniformLocation | null = null
  private readonly _instanceData: Float32Array

  private _lastCanvasWidth = 0
  private _lastCanvasHeight = 0
  private _initialized = false
  private _initPromise: Promise<void> | null = null

  constructor() {
    this._instanceData = new Float32Array(MAX_IMAGES_PER_BATCH * 8)
  }

  async init(): Promise<void> {
    if (this._initPromise) return this._initPromise
    this._initPromise = this._checkSupport()
    return this._initPromise
  }

  private async _checkSupport(): Promise<void> {
    if (typeof document === 'undefined') throw new Error('WebGL2 requires a DOM environment')
    const canvas = document.createElement('canvas')
    if (!canvas.getContext('webgl2')) throw new Error('WebGL2 not supported')
  }

  private _initGL(): void {
    if (!this._canvas) throw new Error('Canvas not set before _initGL')
    if (this._gl) return // already initialised

    const gl = this._canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false })
    if (!gl) throw new Error('Failed to create WebGL2 context')
    this._gl = gl

    // Compile and link program
    const vert = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()!
    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`WebGL2 program link failed: ${gl.getProgramInfoLog(program)}`)
    }
    gl.deleteShader(vert)
    gl.deleteShader(frag)
    this._program = program

    this._resolutionLoc = gl.getUniformLocation(program, 'u_resolution')
    this._texArraySizeLoc = gl.getUniformLocation(program, 'u_texArraySize')

    // VAO + instance VBO
    this._vao = gl.createVertexArray()!
    gl.bindVertexArray(this._vao)

    this._instanceBuffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer)
    // Size: MAX_IMAGES * 8 floats * 4 bytes
    gl.bufferData(gl.ARRAY_BUFFER, MAX_IMAGES_PER_BATCH * 32, gl.DYNAMIC_DRAW)

    // stride = 32 bytes (8 × float)
    const aDestRect = gl.getAttribLocation(program, 'a_destRect')
    gl.enableVertexAttribArray(aDestRect)
    gl.vertexAttribPointer(aDestRect, 4, gl.FLOAT, false, 32, 0)
    gl.vertexAttribDivisor(aDestRect, 1)

    const aTexInfo = gl.getAttribLocation(program, 'a_texInfo')
    gl.enableVertexAttribArray(aTexInfo)
    gl.vertexAttribPointer(aTexInfo, 4, gl.FLOAT, false, 32, 16)
    gl.vertexAttribDivisor(aTexInfo, 1)

    gl.bindVertexArray(null)

    // Texture array
    this._texArray = gl.createTexture()!
    this._allocateTextureArray(256, 256, 32)

    // Premultiplied-alpha blending
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    this._initialized = true
  }

  // ==========================================================================
  // Texture management
  // ==========================================================================

  private _nextPow2(n: number): number {
    n--; n |= n >> 1; n |= n >> 2; n |= n >> 4; n |= n >> 8; n |= n >> 16; return n + 1
  }

  private _allocateTextureArray(width: number, height: number, layers: number): void {
    const gl = this._gl!
    const w = this._nextPow2(Math.max(width, 64))
    const h = this._nextPow2(Math.max(height, 64))
    const l = Math.min(this._nextPow2(Math.max(layers, 16)), MAX_TEXTURE_ARRAY_LAYERS)

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._texArray)
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, w, h, l, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this._texWidth = w
    this._texHeight = h
    this._texLayers = l
  }

  private _ensureTextureArray(maxW: number, maxH: number, count: number): void {
    const c = Math.min(count, MAX_TEXTURE_ARRAY_LAYERS)
    if (maxW <= this._texWidth && maxH <= this._texHeight && c <= this._texLayers) return
    const newW = this._nextPow2(Math.max(this._texWidth, maxW))
    const newH = this._nextPow2(Math.max(this._texHeight, maxH))
    const newL = Math.min(
      this._nextPow2(Math.max(this._texLayers, c, c + 16)),
      MAX_TEXTURE_ARRAY_LAYERS
    )
    this._allocateTextureArray(newW, newH, newL)
  }

  // ==========================================================================
  // Public interface
  // ==========================================================================

  async setCanvas(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    await this.init()
    if (width <= 0 || height <= 0) return
    this._canvas = canvas
    canvas.width = width
    canvas.height = height
    this._initGL()
    this._gl!.viewport(0, 0, width, height)
    this._lastCanvasWidth = width
    this._lastCanvasHeight = height
  }

  updateSize(width: number, height: number): void {
    if (!this._gl || !this._canvas || width <= 0 || height <= 0) return
    if (width === this._lastCanvasWidth && height === this._lastCanvasHeight) return
    this._canvas.width = width
    this._canvas.height = height
    this._gl.viewport(0, 0, width, height)
    this._lastCanvasWidth = width
    this._lastCanvasHeight = height
  }

  /**
   * Render from ImageBitmaps (async render mode)
   */
  renderBitmaps(
    images: { image: ImageBitmap; x: number; y: number }[],
    _canvasWidth: number,
    _canvasHeight: number
  ): void {
    if (!this._gl || !this._initialized) return

    const len = images.length
    if (len === 0) {
      this.clear()
      return
    }

    let maxW = 0, maxH = 0
    for (let i = 0; i < len; i++) {
      const { image } = images[i]
      if (image.width > maxW) maxW = image.width
      if (image.height > maxH) maxH = image.height
    }

    this._ensureTextureArray(maxW, maxH, Math.min(len, MAX_TEXTURE_ARRAY_LAYERS))

    const gl = this._gl
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this._program)
    gl.uniform2f(this._resolutionLoc, this._lastCanvasWidth, this._lastCanvasHeight)
    gl.uniform2i(this._texArraySizeLoc, this._texWidth, this._texHeight)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._texArray)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

    const instanceData = this._instanceData
    let imageIndex = 0

    while (imageIndex < len) {
      let count = 0
      while (imageIndex < len && count < MAX_TEXTURE_ARRAY_LAYERS) {
        const img = images[imageIndex++]
        const w = img.image.width, h = img.image.height
        if (w <= 0 || h <= 0) continue
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, count, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, img.image)
        const off = count << 3
        instanceData[off] = img.x
        instanceData[off + 1] = img.y
        instanceData[off + 2] = w
        instanceData[off + 3] = h
        instanceData[off + 4] = w
        instanceData[off + 5] = h
        instanceData[off + 6] = count
        instanceData[off + 7] = 0
        count++
      }
      if (count === 0) continue
      gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData, 0, count << 3)
      gl.bindVertexArray(this._vao)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count)
      gl.bindVertexArray(null)
    }
  }

  /**
   * Render from raw ArrayBuffer data (non-async render mode)
   */
  render(
    images: RenderImage[],
    _canvasWidth: number,
    _canvasHeight: number
  ): void {
    if (!this._gl || !this._initialized) return

    const len = images.length
    if (len === 0) {
      this.clear()
      return
    }

    let maxW = 0, maxH = 0
    for (let i = 0; i < len; i++) {
      const { w, h } = images[i]
      if (w > maxW) maxW = w
      if (h > maxH) maxH = h
    }

    this._ensureTextureArray(maxW, maxH, Math.min(len, MAX_TEXTURE_ARRAY_LAYERS))

    const gl = this._gl
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this._program)
    gl.uniform2f(this._resolutionLoc, this._lastCanvasWidth, this._lastCanvasHeight)
    gl.uniform2i(this._texArraySizeLoc, this._texWidth, this._texHeight)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._texArray)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

    const instanceData = this._instanceData
    let imageIndex = 0

    while (imageIndex < len) {
      let count = 0
      while (imageIndex < len && count < MAX_TEXTURE_ARRAY_LAYERS) {
        const img = images[imageIndex++]
        const w = img.w, h = img.h
        if (w <= 0 || h <= 0) continue
        const imgData = img.image
        if (imgData instanceof ImageBitmap) {
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, count, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, imgData)
        } else if (imgData instanceof ArrayBuffer) {
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, count, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(imgData))
        }
        const off = count << 3
        instanceData[off] = img.x
        instanceData[off + 1] = img.y
        instanceData[off + 2] = w
        instanceData[off + 3] = h
        instanceData[off + 4] = w
        instanceData[off + 5] = h
        instanceData[off + 6] = count
        instanceData[off + 7] = 0
        count++
      }
      if (count === 0) continue
      gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData, 0, count << 3)
      gl.bindVertexArray(this._vao)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count)
      gl.bindVertexArray(null)
    }
  }

  clear(): void {
    if (!this._gl) return
    this._gl.clearColor(0, 0, 0, 0)
    this._gl.clear(this._gl.COLOR_BUFFER_BIT)
  }

  get initialized(): boolean {
    return this._initialized
  }

  destroy(): void {
    const gl = this._gl
    if (gl) {
      gl.deleteProgram(this._program)
      gl.deleteVertexArray(this._vao)
      gl.deleteBuffer(this._instanceBuffer)
      gl.deleteTexture(this._texArray)
    }
    this._gl = null
    this._program = null
    this._vao = null
    this._instanceBuffer = null
    this._texArray = null
    this._canvas = null
    this._initialized = false
    this._initPromise = null
  }
}
