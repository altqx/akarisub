type RenderImageInput = {
  x: number
  y: number
  w: number
  h: number
  image: Uint8Array | ArrayBuffer | ImageBitmap
}

const MAX_IMAGES_PER_BATCH = 256
const MAX_TEXTURE_ARRAY_LAYERS = 256

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
  vec2 clip = (pixelPos / u_resolution) * 2.0 - 1.0;
  clip.y = -clip.y;

  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = qp;
  v_texIndex = int(a_texInfo.z);
  v_texSize = a_texInfo.xy;
}
`

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
  fragColor = vec4(color.rgb * color.a, color.a);
}
`

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
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error('Failed to allocate WebGL2 shader')
  }

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`WebGL2 shader compilation failed: ${info}`)
  }

  return shader
}

export class WebGL2Renderer {
  private gl: WebGL2RenderingContext | null = null
  private canvas: HTMLCanvasElement | null = null
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private instanceBuffer: WebGLBuffer | null = null
  private textureArray: WebGLTexture | null = null
  private resolutionLoc: WebGLUniformLocation | null = null
  private texArraySizeLoc: WebGLUniformLocation | null = null
  private readonly instanceData = new Float32Array(MAX_IMAGES_PER_BATCH * 8)
  private texWidth = 0
  private texHeight = 0
  private texLayers = 0
  private lastCanvasWidth = 0
  private lastCanvasHeight = 0
  private initialized = false
  private initPromise: Promise<void> | null = null

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise

    this.initPromise = Promise.resolve().then(() => {
      if (!isWebGL2Supported()) {
        throw new Error('WebGL2 not supported')
      }
    })

    return this.initPromise
  }

  async setCanvas(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    await this.init()
    if (width <= 0 || height <= 0) return

    this.canvas = canvas
    this.canvas.width = width
    this.canvas.height = height
    this.initGL()
    this.gl?.viewport(0, 0, width, height)
    this.lastCanvasWidth = width
    this.lastCanvasHeight = height
  }

  updateSize(width: number, height: number): void {
    if (!this.gl || !this.canvas || width <= 0 || height <= 0) return
    if (width === this.lastCanvasWidth && height === this.lastCanvasHeight) return

    this.canvas.width = width
    this.canvas.height = height
    this.gl.viewport(0, 0, width, height)
    this.lastCanvasWidth = width
    this.lastCanvasHeight = height
  }

  render(images: RenderImageInput[], _canvasWidth: number, _canvasHeight: number): void {
    if (!this.gl || !this.initialized) return

    const len = images.length
    if (len === 0) {
      this.clear()
      return
    }

    let maxW = 0
    let maxH = 0
    for (let index = 0; index < len; index++) {
      const { w, h } = images[index]
      if (w > maxW) maxW = w
      if (h > maxH) maxH = h
    }

    this.ensureTextureArray(maxW, maxH, Math.min(len, MAX_TEXTURE_ARRAY_LAYERS))

    const gl = this.gl
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.uniform2f(this.resolutionLoc, this.lastCanvasWidth, this.lastCanvasHeight)
    gl.uniform2i(this.texArraySizeLoc, this.texWidth, this.texHeight)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureArray)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

    let imageIndex = 0
    while (imageIndex < len) {
      let count = 0
      while (imageIndex < len && count < MAX_TEXTURE_ARRAY_LAYERS) {
        const image = images[imageIndex++]
        const { w, h } = image
        if (w <= 0 || h <= 0) continue

        if (image.image instanceof ImageBitmap) {
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, count, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, image.image)
        } else if (image.image instanceof Uint8Array) {
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, count, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, image.image)
        } else {
          gl.texSubImage3D(
            gl.TEXTURE_2D_ARRAY,
            0,
            0,
            0,
            count,
            w,
            h,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            new Uint8Array(image.image)
          )
        }

        const offset = count << 3
        this.instanceData[offset] = image.x
        this.instanceData[offset + 1] = image.y
        this.instanceData[offset + 2] = w
        this.instanceData[offset + 3] = h
        this.instanceData[offset + 4] = w
        this.instanceData[offset + 5] = h
        this.instanceData[offset + 6] = count
        this.instanceData[offset + 7] = 0
        count++
      }

      if (count === 0) continue

      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData, 0, count << 3)
      gl.bindVertexArray(this.vao)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count)
      gl.bindVertexArray(null)
    }
  }

  clear(): void {
    if (!this.gl) return
    this.gl.clearColor(0, 0, 0, 0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)
  }

  destroy(): void {
    if (this.gl) {
      this.gl.deleteProgram(this.program)
      this.gl.deleteVertexArray(this.vao)
      this.gl.deleteBuffer(this.instanceBuffer)
      this.gl.deleteTexture(this.textureArray)
    }

    this.gl = null
    this.canvas = null
    this.program = null
    this.vao = null
    this.instanceBuffer = null
    this.textureArray = null
    this.resolutionLoc = null
    this.texArraySizeLoc = null
    this.initialized = false
    this.initPromise = null
    this.texWidth = 0
    this.texHeight = 0
    this.texLayers = 0
  }

  private initGL(): void {
    if (!this.canvas) {
      throw new Error('Canvas not set before WebGL2 initialization')
    }

    if (this.gl) return

    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
    })

    if (!gl) {
      throw new Error('Failed to create WebGL2 context')
    }

    this.gl = gl

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!program) {
      throw new Error('Failed to create WebGL2 program')
    }

    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`WebGL2 program link failed: ${gl.getProgramInfoLog(program)}`)
    }

    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)

    this.program = program
    this.resolutionLoc = gl.getUniformLocation(program, 'u_resolution')
    this.texArraySizeLoc = gl.getUniformLocation(program, 'u_texArraySize')

    const vao = gl.createVertexArray()
    const instanceBuffer = gl.createBuffer()
    const textureArray = gl.createTexture()
    if (!vao || !instanceBuffer || !textureArray) {
      throw new Error('Failed to allocate WebGL2 resources')
    }

    this.vao = vao
    this.instanceBuffer = instanceBuffer
    this.textureArray = textureArray

    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, MAX_IMAGES_PER_BATCH * 32, gl.DYNAMIC_DRAW)

    const aDestRect = gl.getAttribLocation(program, 'a_destRect')
    gl.enableVertexAttribArray(aDestRect)
    gl.vertexAttribPointer(aDestRect, 4, gl.FLOAT, false, 32, 0)
    gl.vertexAttribDivisor(aDestRect, 1)

    const aTexInfo = gl.getAttribLocation(program, 'a_texInfo')
    gl.enableVertexAttribArray(aTexInfo)
    gl.vertexAttribPointer(aTexInfo, 4, gl.FLOAT, false, 32, 16)
    gl.vertexAttribDivisor(aTexInfo, 1)

    gl.bindVertexArray(null)

    this.allocateTextureArray(256, 256, 32)

    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    this.initialized = true
  }

  private nextPowerOf2(value: number): number {
    let next = Math.max(1, value)
    next--
    next |= next >> 1
    next |= next >> 2
    next |= next >> 4
    next |= next >> 8
    next |= next >> 16
    return next + 1
  }

  private allocateTextureArray(width: number, height: number, layers: number): void {
    const gl = this.gl
    if (!gl || !this.textureArray) return

    const nextWidth = this.nextPowerOf2(Math.max(width, 64))
    const nextHeight = this.nextPowerOf2(Math.max(height, 64))
    const nextLayers = Math.min(this.nextPowerOf2(Math.max(layers, 16)), MAX_TEXTURE_ARRAY_LAYERS)

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureArray)
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, nextWidth, nextHeight, nextLayers, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.texWidth = nextWidth
    this.texHeight = nextHeight
    this.texLayers = nextLayers
  }

  private ensureTextureArray(maxWidth: number, maxHeight: number, count: number): void {
    const nextCount = Math.min(count, MAX_TEXTURE_ARRAY_LAYERS)
    if (maxWidth <= this.texWidth && maxHeight <= this.texHeight && nextCount <= this.texLayers) {
      return
    }

    const width = this.nextPowerOf2(Math.max(this.texWidth, maxWidth))
    const height = this.nextPowerOf2(Math.max(this.texHeight, maxHeight))
    const layers = Math.min(this.nextPowerOf2(Math.max(this.texLayers, nextCount, nextCount + 16)), MAX_TEXTURE_ARRAY_LAYERS)
    this.allocateTextureArray(width, height, layers)
  }
}