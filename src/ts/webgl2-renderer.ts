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

function isArrayBufferView(value: unknown): value is Uint8Array | Uint8ClampedArray {
  return value instanceof Uint8Array || value instanceof Uint8ClampedArray
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

  private _hbGpuShaders: {
    glsl: { vertex: string; fragment: string; drawFragment: string; paintFragment: string }
  } | null = null
  private _hbProgram: WebGLProgram | null = null
  private _hbVao: WebGLVertexArrayObject | null = null
  private _hbVbo: WebGLBuffer | null = null
  private _hbAtlasTex: WebGLTexture | null = null
  private _hbResolutionLoc: WebGLUniformLocation | null = null
  private _hbAtlasWidthLoc: WebGLUniformLocation | null = null

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
        } else if (imgData instanceof ArrayBuffer || isArrayBufferView(imgData)) {
          const uploadData = imgData instanceof ArrayBuffer ? new Uint8Array(imgData) : imgData
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, count, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, uploadData)
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

  setHbGpuShaders(shaders: {
    glsl: { vertex: string; fragment: string; drawFragment: string; paintFragment: string }
  }): void {
    this._hbGpuShaders = shaders
    if (!this._gl) return
    this._gl.deleteProgram(this._hbProgram)
    this._gl.deleteVertexArray(this._hbVao)
    this._gl.deleteBuffer(this._hbVbo)
    this._gl.deleteTexture(this._hbAtlasTex)
    this._hbProgram = null
    this._hbVao = null
    this._hbVbo = null
    this._hbAtlasTex = null
  }

  private _ensureHbProgram(): void {
    const gl = this._gl
    if (!gl || this._hbProgram || !this._hbGpuShaders) return

    const vertexShader = `#version 300 es
precision highp float;
in vec2 a_position;
in vec2 a_renderCoord;
in float a_glyphLoc;
in vec4 a_color;
uniform vec2 u_resolution;
out vec2 v_renderCoord;
flat out uint v_glyphLoc;
out vec4 v_color;
void main() {
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_renderCoord = a_renderCoord;
  v_glyphLoc = uint(max(a_glyphLoc, 0.0));
  v_color = a_color;
}`

    const fragmentShader = `#version 300 es
precision highp float;
precision highp int;
#define HB_GPU_ATLAS_2D
${this._hbGpuShaders.glsl.fragment}
${this._hbGpuShaders.glsl.drawFragment}
in vec2 v_renderCoord;
flat in uint v_glyphLoc;
in vec4 v_color;
out vec4 fragColor;
void main() {
  float cov = hb_gpu_draw(v_renderCoord, v_glyphLoc);
  fragColor = vec4(v_color.rgb * cov, v_color.a * cov);
}`

    const vert = compileShader(gl, gl.VERTEX_SHADER, vertexShader)
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader)
    const program = gl.createProgram()!
    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`WebGL2 hb-gpu link failed: ${gl.getProgramInfoLog(program)}`)
    }
    gl.deleteShader(vert)
    gl.deleteShader(frag)

    this._hbProgram = program
    this._hbResolutionLoc = gl.getUniformLocation(program, 'u_resolution')
    this._hbAtlasWidthLoc = gl.getUniformLocation(program, 'hb_gpu_atlas_width')

    this._hbVao = gl.createVertexArray()!
    this._hbVbo = gl.createBuffer()!
    gl.bindVertexArray(this._hbVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._hbVbo)
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW)

    const stride = 36
    const aPos = gl.getAttribLocation(program, 'a_position')
    const aTex = gl.getAttribLocation(program, 'a_renderCoord')
    const aLoc = gl.getAttribLocation(program, 'a_glyphLoc')
    const aCol = gl.getAttribLocation(program, 'a_color')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(aTex)
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, stride, 8)
    gl.enableVertexAttribArray(aLoc)
    gl.vertexAttribPointer(aLoc, 1, gl.FLOAT, false, stride, 16)
    gl.enableVertexAttribArray(aCol)
    gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, stride, 20)
    gl.bindVertexArray(null)

    this._hbAtlasTex = gl.createTexture()
  }

  renderHbGpuBlobs(glyphData: ArrayBuffer, atlasData: ArrayBuffer, width: number, height: number): void {
    const gl = this._gl
    if (!gl || !glyphData.byteLength || !atlasData.byteLength) {
      this.clear()
      return
    }

    this.updateSize(width, height)
    this._ensureHbProgram()
    if (!this._hbProgram || !this._hbVao || !this._hbVbo || !this._hbAtlasTex) return

    const meta = new Int32Array(glyphData)
    const glyphCount = (meta.length / 12) | 0
    if (glyphCount <= 0) {
      this.clear()
      return
    }

    const bitsToFloat = (bits: number): number => {
      const v = new DataView(new ArrayBuffer(4))
      v.setInt32(0, bits, true)
      return v.getFloat32(0, true)
    }

    const decodeColor = (packed: number): [number, number, number, number] => {
      const r = ((packed >>> 24) & 0xff) / 255
      const g = ((packed >>> 16) & 0xff) / 255
      const b = ((packed >>> 8) & 0xff) / 255
      const a = (255 - (packed & 0xff)) / 255
      return [r, g, b, a]
    }

    const vertexData = new Float32Array(glyphCount * 6 * 9)
    let ptr = 0
    const push = (px: number, py: number, tx: number, ty: number, loc: number, col: [number, number, number, number]): void => {
      vertexData[ptr++] = px
      vertexData[ptr++] = py
      vertexData[ptr++] = tx
      vertexData[ptr++] = ty
      vertexData[ptr++] = loc
      vertexData[ptr++] = col[0]
      vertexData[ptr++] = col[1]
      vertexData[ptr++] = col[2]
      vertexData[ptr++] = col[3]
    }

    for (let i = 0; i < glyphCount; i++) {
      const o = i * 12
      const atlasOffsetBytes = meta[o]
      const penX = bitsToFloat(meta[o + 2])
      const penY = bitsToFloat(meta[o + 3])
      const minX = meta[o + 4]
      const maxX = meta[o + 5]
      const minY = meta[o + 6]
      const maxY = meta[o + 7]
      const glyphLoc = atlasOffsetBytes / 8
      const color = decodeColor(meta[o + 9])

      const x0 = penX + minX
      const y0 = penY + minY
      const x1 = penX + maxX
      const y1 = penY + maxY

      push(x0, y0, minX, minY, glyphLoc, color)
      push(x1, y0, maxX, minY, glyphLoc, color)
      push(x0, y1, minX, maxY, glyphLoc, color)
      push(x1, y0, maxX, minY, glyphLoc, color)
      push(x1, y1, maxX, maxY, glyphLoc, color)
      push(x0, y1, minX, maxY, glyphLoc, color)
    }

    const raw16 = new Int16Array(atlasData)
    const texels = raw16.length / 4
    const atlasWidth = Math.max(64, Math.min(2048, Math.ceil(Math.sqrt(texels))))
    const atlasHeight = Math.max(1, Math.ceil(texels / atlasWidth))
    const padded = new Int16Array(atlasWidth * atlasHeight * 4)
    padded.set(raw16)

    gl.viewport(0, 0, this._lastCanvasWidth, this._lastCanvasHeight)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this._hbProgram)
    gl.uniform2f(this._hbResolutionLoc, this._lastCanvasWidth, this._lastCanvasHeight)
    gl.uniform1i(this._hbAtlasWidthLoc, atlasWidth)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this._hbAtlasTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16I, atlasWidth, atlasHeight, 0, gl.RGBA_INTEGER, gl.SHORT, padded)
    const atlasLoc = gl.getUniformLocation(this._hbProgram, 'hb_gpu_atlas')
    gl.uniform1i(atlasLoc, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, this._hbVbo)
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW)
    gl.bindVertexArray(this._hbVao)
    gl.drawArrays(gl.TRIANGLES, 0, glyphCount * 6)
    gl.bindVertexArray(null)
  }
}
