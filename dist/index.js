const L = {
  bt709: "BT709",
  bt470bg: "BT601",
  // BT.601 PAL
  smpte170m: "BT601"
  // BT.601 NTSC
}, W = {
  BT601: {
    BT709: "1.0863 -0.0723 -0.014 0 0 0.0965 0.8451 0.0584 0 0 -0.0141 -0.0277 1.0418"
  },
  BT709: {
    BT601: "0.9137 0.0784 0.0079 0 0 -0.1049 1.1722 -0.0671 0 0 0.0096 0.0322 0.9582"
  },
  FCC: {
    BT709: "1.0873 -0.0736 -0.0137 0 0 0.0974 0.8494 0.0531 0 0 -0.0127 -0.0251 1.0378",
    BT601: "1.001 -0.0008 -0.0002 0 0 0.0009 1.005 -0.006 0 0 0.0013 0.0027 0.996"
  },
  SMPTE240M: {
    BT709: "0.9993 0.0006 0.0001 0 0 -0.0004 0.9812 0.0192 0 0 -0.0034 -0.0114 1.0148",
    BT601: "0.913 0.0774 0.0096 0 0 -0.1051 1.1508 -0.0456 0 0 0.0063 0.0207 0.973"
  }
}, j = [
  null,
  "BT601",
  null,
  "BT601",
  "BT601",
  "BT709",
  "BT709",
  "SMPTE240M",
  "SMPTE240M",
  "FCC",
  "FCC"
];
function Q(c, e) {
  if (!c || !e || c === e) return null;
  const t = W[c]?.[e];
  return t ? `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feColorMatrix type='matrix' values='${t} 0 0 0 0 0 1 0'/></filter></svg>#f")` : null;
}
function S(c, e, t, s, i) {
  const r = t <= 0 ? 1 : t, o = globalThis.devicePixelRatio || 1;
  if (e <= 0 || c <= 0)
    return { width: 0, height: 0 };
  const n = r < 1 ? -1 : 1;
  let a = e * o;
  return n * a * r <= n * s ? a *= r : n * a < n * s && (a = s), i > 0 && a > i && (a = i), c *= a / e, e = a, { width: c, height: e };
}
function k(c, e = c.videoWidth, t = c.videoHeight) {
  const s = e / t, { offsetWidth: i, offsetHeight: r } = c, o = i / r;
  let n = i, a = r;
  o > s ? n = Math.floor(r * s) : a = Math.floor(i / s);
  const l = (i - n) / 2, v = (r - a) / 2;
  return { width: n, height: a, x: l, y: v };
}
function z(c, e) {
  if (!e) return c;
  const t = c.length, s = t - t % 16;
  let i = 3;
  for (; i < s; i += 16)
    c[i] < 2 && (c[i] = 1), c[i + 4] < 2 && (c[i + 4] = 1), c[i + 8] < 2 && (c[i + 8] = 1), c[i + 12] < 2 && (c[i + 12] = 1);
  for (; i < t; i += 4)
    c[i] < 2 && (c[i] = 1);
  return c;
}
function J(c, e = !1) {
  const t = [], s = c.split(/[\r\n]+/g), i = s.length;
  let r = null, o = null;
  for (let n = 0; n < i; n++) {
    const a = s[n];
    if (!a || /^\s*$/.test(a)) continue;
    const l = a[0];
    if (l === "[") {
      const v = a.match(/^\[(.*)\]$/);
      if (v) {
        if (e && v[1].toLowerCase() === "events")
          break;
        r = null, o = { name: v[1], body: [] }, t.push(o);
        continue;
      }
    }
    if (o)
      if (l === ";")
        o.body.push({
          type: "comment",
          value: a.substring(1)
        });
      else {
        const v = a.indexOf(":");
        if (v === -1) continue;
        const w = a.substring(0, v);
        let x = a.substring(v + 1).trim();
        if (r || w === "Format") {
          let u = x.split(",");
          if (r && u.length > r.length) {
            const R = u.slice(r.length - 1).join(",");
            u = u.slice(0, r.length - 1), u.push(R);
          }
          const g = u.length;
          for (let R = 0; R < g; R++)
            u[R] = u[R].trim();
          if (r) {
            const R = {}, A = Math.min(r.length, g);
            for (let _ = 0; _ < A; _++)
              R[r[_]] = u[_];
            x = R;
          } else
            x = u;
        }
        w === "Format" && (r = x), o.body.push({ key: w, value: x });
      }
  }
  return t;
}
const O = /\\blur(?:[0-9]+\.)?[0-9]+/gm;
function K(c) {
  return c.replace(O, "");
}
const H = [
  { w: 7680, h: 4320 },
  // 8K
  { w: 3840, h: 2160 },
  // 4K UHD
  { w: 2560, h: 1440 },
  // 1440p
  { w: 1920, h: 1080 },
  // 1080p
  { w: 1280, h: 720 }
  // 720p
];
function V(c, e) {
  const t = [...H].sort((s, i) => s.w - i.w);
  for (const s of t)
    if (c <= s.w && e <= s.h)
      return s;
  return { w: Math.ceil(c / 100) * 100, h: Math.ceil(e / 100) * 100 };
}
function b(c, e) {
  return e && e.includes(".") ? c.toFixed(2).replace(/\.?0+$/, "") : Math.round(c);
}
function Z(c) {
  const e = c.match(/PlayResX:\s*(\d+)/i), t = c.match(/PlayResY:\s*(\d+)/i), s = e ? parseInt(e[1], 10) : 1920, i = t ? parseInt(t[1], 10) : 1080, r = /\\pos\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g, o = /\\move\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g, n = /\\org\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g, a = /\\i?clip\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g;
  let l = 0, v = 0;
  const w = (m, h, f) => {
    let y;
    const T = new RegExp(m.source, "g");
    for (; (y = T.exec(c)) !== null; ) {
      for (const B of h)
        if (y[B]) {
          const D = Math.abs(parseFloat(y[B]));
          D > l && (l = D);
        }
      for (const B of f)
        if (y[B]) {
          const D = Math.abs(parseFloat(y[B]));
          D > v && (v = D);
        }
    }
  };
  if (w(r, [1], [2]), w(o, [1, 3], [2, 4]), w(n, [1], [2]), w(a, [1, 3], [2, 4]), l <= s && v <= i) return c;
  const x = V(l, v), u = s / x.w, g = i / x.h, R = Math.min(u, g), A = Math.max(u, g), _ = 1;
  let P = c;
  const p = P.match(/(\[Events\][\s\S]*)/i);
  if (!p) return P;
  let d = p[1];
  return d = d.replace(
    r,
    (m, h, f) => `\\pos(${b(parseFloat(h) * u, h)},${b(parseFloat(f) * g, f)})`
  ), d = d.replace(
    /\\move\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?:\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+))?\s*\)/g,
    (m, h, f, y, T, B, D) => {
      const I = `\\move(${b(parseFloat(h) * u, h)},${b(parseFloat(f) * g, f)},${b(parseFloat(y) * u, y)},${b(parseFloat(T) * g, T)}`;
      return B ? `${I},${B},${D})` : `${I})`;
    }
  ), d = d.replace(
    n,
    (m, h, f) => `\\org(${b(parseFloat(h) * u, h)},${b(parseFloat(f) * g, f)})`
  ), d = d.replace(
    /\\(i?clip)\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g,
    (m, h, f, y, T, B) => `\\${h}(${b(parseFloat(f) * u, f)},${b(parseFloat(y) * g, y)},${b(parseFloat(T) * u, T)},${b(parseFloat(B) * g, B)})`
  ), d = d.replace(/\\fs([\d.]+)/g, (m, h) => `\\fs${b(parseFloat(h) * A, h)}`), d = d.replace(
    /\\fscx([\d.]+)/g,
    (m, h) => `\\fscx${b(parseFloat(h) * _, h)}`
  ), d = d.replace(
    /\\xbord([\d.]+)/g,
    (m, h) => `\\xbord${b(parseFloat(h) * u, h)}`
  ), d = d.replace(
    /\\ybord([\d.]+)/g,
    (m, h) => `\\ybord${b(parseFloat(h) * g, h)}`
  ), d = d.replace(
    /\\xshad(-?[\d.]+)/g,
    (m, h) => `\\xshad${b(parseFloat(h) * u, h)}`
  ), d = d.replace(
    /\\yshad(-?[\d.]+)/g,
    (m, h) => `\\yshad${b(parseFloat(h) * g, h)}`
  ), ["fsp", "bord", "shad", "be", "blur"].forEach((m) => {
    const h = new RegExp(`\\\\${m}(-?[\\d.]+)`, "g");
    d = d.replace(h, (f, y) => `\\${m}${b(parseFloat(y) * R, y)}`);
  }), d = d.replace(/(\\i?clip\s*\([^,)]+m[^)]+\)|\\p[1-9][^}]*?)(?=[\\}]|$)/g, (m) => m.replace(/(-?[\d.]+)\s+(-?[\d.]+)/g, (h, f, y) => `${b(parseFloat(f) * u, f)} ${b(parseFloat(y) * g, y)}`)), P.substring(0, p.index) + d;
}
let U = null, F = null;
async function $() {
  if (U !== null && F !== null)
    return { hasAlphaBug: U, hasBitmapBug: F };
  const c = document.createElement("canvas"), e = c.getContext("2d", { willReadFrequently: !0 });
  if (!e) throw new Error("Canvas rendering not supported");
  if (typeof ImageData.prototype.constructor == "function")
    try {
      new ImageData(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1);
    } catch {
      console.log("Detected that ImageData is not constructable despite browser saying so");
    }
  const t = document.createElement("canvas"), s = t.getContext("2d", { willReadFrequently: !0 });
  if (!s) throw new Error("Canvas rendering not supported");
  c.width = t.width = 1, c.height = t.height = 1, e.clearRect(0, 0, 1, 1), s.clearRect(0, 0, 1, 1);
  const i = s.getImageData(0, 0, 1, 1).data;
  e.putImageData(new ImageData(new Uint8ClampedArray([0, 255, 0, 0]), 1, 1), 0, 0), s.drawImage(c, 0, 0);
  const r = s.getImageData(0, 0, 1, 1).data;
  if (U = i[1] !== r[1], U && console.log("Detected a browser having issue with transparent pixels, applying workaround"), typeof createImageBitmap < "u") {
    const o = new Uint8ClampedArray([255, 0, 255, 0, 255]).subarray(1, 5);
    s.drawImage(await createImageBitmap(new ImageData(o, 1)), 0, 0);
    const { data: n } = s.getImageData(0, 0, 1, 1);
    F = !1;
    for (let a = 0; a < n.length; a++)
      if (Math.abs(o[a] - n[a]) > 15) {
        F = !0, console.log("Detected a browser having issue with partial bitmaps, applying workaround");
        break;
      }
  } else
    F = !1;
  return c.remove(), t.remove(), { hasAlphaBug: U, hasBitmapBug: F };
}
async function ee() {
  return $();
}
function te() {
  return U;
}
function se() {
  return F;
}
const G = 256, M = 256, q = (
  /* wgsl */
  `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) instanceIndex: u32,
  @location(1) @interpolate(flat) destXY: vec2f,
  @location(2) @interpolate(flat) texSize: vec2f,
}

struct Uniforms {
  resolution: vec2f,
}

struct ImageData {
  destRect: vec4f,   // x, y, w, h
  texInfo: vec4f,    // texW, texH, texIndex, 0
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> imageData: array<ImageData>;

// Quad vertices (two triangles)
const QUAD_POSITIONS = array<vec2f, 6>(
  vec2f(0.0, 0.0),
  vec2f(1.0, 0.0),
  vec2f(0.0, 1.0),
  vec2f(1.0, 0.0),
  vec2f(1.0, 1.0),
  vec2f(0.0, 1.0)
);

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var output: VertexOutput;
  
  let data = imageData[instanceIndex];
  let quadPos = QUAD_POSITIONS[vertexIndex];
  let wh = data.destRect.zw;
  
  // Calculate pixel position
  let pixelPos = data.destRect.xy + quadPos * wh;
  
  // Convert to clip space (-1 to 1)
  var clipPos = (pixelPos / uniforms.resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;
  
  output.position = vec4f(clipPos, 0.0, 1.0);
  output.instanceIndex = instanceIndex;
  output.destXY = data.destRect.xy;
  output.texSize = data.texInfo.xy;
  
  return output;
}
`
), N = (
  /* wgsl */
  `
@group(0) @binding(2) var texArray: texture_2d_array<f32>;

struct ImageData {
  destRect: vec4f,
  texInfo: vec4f,
}

@group(0) @binding(1) var<storage, read> imageData: array<ImageData>;

struct FragmentInput {
  @builtin(position) fragCoord: vec4f,
  @location(0) @interpolate(flat) instanceIndex: u32,
  @location(1) @interpolate(flat) destXY: vec2f,
  @location(2) @interpolate(flat) texSize: vec2f,
}

@fragment
fn fragmentMain(input: FragmentInput) -> @location(0) vec4f {
  let data = imageData[input.instanceIndex];
  let texIndex = u32(data.texInfo.z);
  
  // Calculate integer texel coordinates
  let texCoord = vec2i(floor(input.fragCoord.xy - input.destXY));
  
  // Bounds check
  let texSizeI = vec2i(input.texSize);
  if (texCoord.x < 0 || texCoord.y < 0 || texCoord.x >= texSizeI.x || texCoord.y >= texSizeI.y) {
    return vec4f(0.0);
  }
  
  // Load from texture array
  let color = textureLoad(texArray, texCoord, texIndex, 0);
  
  // Premultiplied alpha output
  return vec4f(color.rgb * color.a, color.a);
}
`
);
function Y() {
  return typeof navigator < "u" && "gpu" in navigator;
}
class X {
  device = null;
  context = null;
  pipeline = null;
  bindGroupLayout = null;
  uniformBuffer = null;
  imageDataBuffer = null;
  // Texture array for batched rendering
  textureArray = null;
  textureArrayView = null;
  textureArraySize = 0;
  textureArrayWidth = 0;
  textureArrayHeight = 0;
  pendingDestroyTextures = [];
  // Pre-allocated typed arrays (reused every frame - ZERO allocations in hot path)
  imageDataArray;
  resolutionArray = new Float32Array(2);
  // Reusable conversion buffer for RGBA->BGRA (grows as needed, never shrinks)
  conversionBuffer = null;
  conversionBufferSize = 0;
  // Bind group (recreated only when texture array changes)
  bindGroup = null;
  bindGroupDirty = !0;
  // Track canvas size to avoid redundant updates
  lastCanvasWidth = 0;
  lastCanvasHeight = 0;
  format = "bgra8unorm";
  _canvas = null;
  _initPromise = null;
  _initialized = !1;
  constructor() {
    this.imageDataArray = new Float32Array(G * 8);
  }
  async init() {
    return this._initPromise ? this._initPromise : (this._initPromise = this._initDevice(), this._initPromise);
  }
  async _initDevice() {
    if (!navigator.gpu)
      throw new Error("WebGPU not supported");
    const e = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance"
    });
    if (!e)
      throw new Error("No WebGPU adapter found");
    this.device = await e.requestDevice(), this.format = navigator.gpu.getPreferredCanvasFormat();
    const t = this.device.createShaderModule({ code: q }), s = this.device.createShaderModule({ code: N });
    this.uniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    }), this.imageDataBuffer = this.device.createBuffer({
      size: G * 8 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }), this.createTextureArray(256, 256, 32), this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float", viewDimension: "2d-array" }
        }
      ]
    });
    const i = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout]
    });
    this.pipeline = this.device.createRenderPipeline({
      layout: i,
      vertex: { module: t, entryPoint: "vertexMain" },
      fragment: {
        module: s,
        entryPoint: "fragmentMain",
        targets: [
          {
            format: this.format,
            blend: {
              color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
            }
          }
        ]
      },
      primitive: { topology: "triangle-list" }
    }), this._initialized = !0;
  }
  // Round up to next power of 2 for GPU-friendly sizes
  nextPowerOf2(e) {
    return e--, e |= e >> 1, e |= e >> 2, e |= e >> 4, e |= e >> 8, e |= e >> 16, e + 1;
  }
  createTextureArray(e, t, s) {
    this.textureArray && this.pendingDestroyTextures.push(this.textureArray);
    const i = this.nextPowerOf2(Math.max(e, 64)), r = this.nextPowerOf2(Math.max(t, 64)), o = Math.min(this.nextPowerOf2(Math.max(s, 16)), M);
    this.textureArray = this.device.createTexture({
      size: [i, r, o],
      format: this.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    }), this.textureArrayView = this.textureArray.createView({ dimension: "2d-array" }), this.textureArrayWidth = i, this.textureArrayHeight = r, this.textureArraySize = o, this.bindGroupDirty = !0;
  }
  ensureTextureArray(e, t, s) {
    const i = Math.min(s, M);
    if (e <= this.textureArrayWidth && t <= this.textureArrayHeight && i <= this.textureArraySize)
      return !1;
    const r = this.nextPowerOf2(Math.max(this.textureArrayWidth, e)), o = this.nextPowerOf2(Math.max(this.textureArrayHeight, t)), n = Math.min(
      this.nextPowerOf2(Math.max(this.textureArraySize, i, i + 16)),
      M
    );
    return this.createTextureArray(r, o, n), !0;
  }
  updateBindGroup() {
    !this.bindGroupDirty || !this.device || !this.bindGroupLayout || (this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.imageDataBuffer } },
        { binding: 2, resource: this.textureArrayView }
      ]
    }), this.bindGroupDirty = !1);
  }
  ensureConversionBuffer(e) {
    return this.conversionBufferSize < e && (this.conversionBufferSize = Math.max(e, this.conversionBufferSize * 1.5 | 0, 65536), this.conversionBuffer = new Uint8Array(this.conversionBufferSize)), this.conversionBuffer;
  }
  async setCanvas(e, t, s) {
    if (await this.init(), !this.device) throw new Error("WebGPU device not initialized");
    if (!(t <= 0 || s <= 0)) {
      if (this._canvas = e, e.width = t, e.height = s, !this.context) {
        if (this.context = e.getContext("webgpu"), !this.context) throw new Error("Could not get WebGPU context");
        this.context.configure({
          device: this.device,
          format: this.format,
          alphaMode: "premultiplied"
        });
      }
      this.resolutionArray[0] = t, this.resolutionArray[1] = s, this.device.queue.writeBuffer(this.uniformBuffer, 0, this.resolutionArray), this.lastCanvasWidth = t, this.lastCanvasHeight = s;
    }
  }
  updateSize(e, t) {
    !this.device || !this._canvas || e <= 0 || t <= 0 || e === this.lastCanvasWidth && t === this.lastCanvasHeight || (this._canvas.width = e, this._canvas.height = t, this.resolutionArray[0] = e, this.resolutionArray[1] = t, this.device.queue.writeBuffer(this.uniformBuffer, 0, this.resolutionArray), this.lastCanvasWidth = e, this.lastCanvasHeight = t);
  }
  /**
   * Render ImageBitmaps (async render mode)
   * Handles batching when image count exceeds MAX_TEXTURE_ARRAY_LAYERS
   */
  renderBitmaps(e, t, s) {
    if (!this.device || !this.context || !this.pipeline) return;
    const i = e.length;
    if (i === 0) {
      this.clear();
      return;
    }
    const r = this.context.getCurrentTexture();
    if (r.width === 0 || r.height === 0) return;
    let o = 0, n = 0, a = 0;
    for (let _ = 0; _ < i; _++) {
      const { image: P } = e[_], p = P.width, d = P.height;
      p > 0 && d > 0 && (p > o && (o = p), d > n && (n = d), a++);
    }
    if (a === 0) {
      this.clear();
      return;
    }
    const l = Math.min(a, M);
    this.ensureTextureArray(o, n, l), this.updateBindGroup();
    const v = this.device, w = v.queue, x = this.textureArray, u = this.imageDataArray, g = r.createView();
    let R = 0, A = !0;
    for (; R < i; ) {
      let _ = 0;
      for (; R < i && _ < M; ) {
        const d = e[R++], C = d.image, m = C.width, h = C.height;
        if (m <= 0 || h <= 0) continue;
        w.copyExternalImageToTexture(
          { source: C, flipY: !1 },
          { texture: x, origin: [0, 0, _], premultipliedAlpha: !0 },
          { width: m, height: h }
        );
        const f = _ << 3;
        u[f] = d.x, u[f + 1] = d.y, u[f + 2] = m, u[f + 3] = h, u[f + 4] = m, u[f + 5] = h, u[f + 6] = _, _++;
      }
      if (_ === 0) continue;
      w.writeBuffer(this.imageDataBuffer, 0, u.buffer, 0, _ << 5);
      const P = v.createCommandEncoder(), p = P.beginRenderPass({
        colorAttachments: [
          {
            view: g,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: A ? "clear" : "load",
            storeOp: "store"
          }
        ]
      });
      p.setPipeline(this.pipeline), p.setBindGroup(0, this.bindGroup), p.draw(6, _), p.end(), w.submit([P.finish()]), A = !1;
    }
    this.cleanupPendingTextures();
  }
  /**
   * Render from raw ArrayBuffer data (non-async render mode)
   * Handles batching when image count exceeds MAX_TEXTURE_ARRAY_LAYERS
   */
  render(e, t, s, i) {
    if (!this.device || !this.context || !this.pipeline) return;
    const r = e.length;
    if (r === 0) {
      this.clear();
      return;
    }
    const o = this.context.getCurrentTexture();
    if (o.width === 0 || o.height === 0) return;
    let n = 0, a = 0, l = 0;
    for (let p = 0; p < r; p++) {
      const { w: d, h: C } = e[p];
      d > 0 && C > 0 && (d > n && (n = d), C > a && (a = C), l++);
    }
    if (l === 0) {
      this.clear();
      return;
    }
    const v = Math.min(l, M);
    this.ensureTextureArray(n, a, v), this.updateBindGroup();
    const w = this.device, x = w.queue, u = this.textureArray, g = this.imageDataArray, R = this.format === "bgra8unorm", A = o.createView();
    let _ = 0, P = !0;
    for (; _ < r; ) {
      let p = 0;
      for (; _ < r && p < M; ) {
        const m = e[_++], h = m.w, f = m.h;
        if (h <= 0 || f <= 0) continue;
        const y = m.image;
        y instanceof ImageBitmap ? x.copyExternalImageToTexture(
          { source: y, flipY: !1 },
          { texture: u, origin: [0, 0, p], premultipliedAlpha: !0 },
          { width: h, height: f }
        ) : y instanceof ArrayBuffer && this.uploadTextureData(p, y, h, f, R);
        const T = p << 3;
        g[T] = m.x, g[T + 1] = m.y, g[T + 2] = h, g[T + 3] = f, g[T + 4] = h, g[T + 5] = f, g[T + 6] = p, p++;
      }
      if (p === 0) continue;
      x.writeBuffer(this.imageDataBuffer, 0, g.buffer, 0, p << 5);
      const d = w.createCommandEncoder(), C = d.beginRenderPass({
        colorAttachments: [
          {
            view: A,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: P ? "clear" : "load",
            storeOp: "store"
          }
        ]
      });
      C.setPipeline(this.pipeline), C.setBindGroup(0, this.bindGroup), C.draw(6, p), C.end(), x.submit([d.finish()]), P = !1;
    }
    this.cleanupPendingTextures();
  }
  uploadTextureData(e, t, s, i, r) {
    const o = s * i * 4;
    if (r) {
      const n = this.ensureConversionBuffer(o), a = new Uint8Array(t);
      for (let l = 0; l < o; l += 4)
        n[l] = a[l + 2], n[l + 1] = a[l + 1], n[l + 2] = a[l], n[l + 3] = a[l + 3];
      this.device.queue.writeTexture(
        { texture: this.textureArray, origin: [0, 0, e] },
        n.buffer,
        { bytesPerRow: s * 4 },
        { width: s, height: i }
      );
    } else
      this.device.queue.writeTexture(
        { texture: this.textureArray, origin: [0, 0, e] },
        t,
        { bytesPerRow: s * 4 },
        { width: s, height: i }
      );
  }
  cleanupPendingTextures() {
    const e = this.pendingDestroyTextures, t = e.length;
    if (t !== 0) {
      for (let s = 0; s < t; s++)
        e[s].destroy();
      e.length = 0;
    }
  }
  clear() {
    if (!(!this.device || !this.context))
      try {
        const e = this.context.getCurrentTexture();
        if (e.width === 0 || e.height === 0) return;
        const t = this.device.createCommandEncoder();
        t.beginRenderPass({
          colorAttachments: [
            {
              view: e.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store"
            }
          ]
        }).end(), this.device.queue.submit([t.finish()]);
      } catch {
      }
  }
  get initialized() {
    return this._initialized;
  }
  destroy() {
    this.cleanupPendingTextures(), this.textureArray?.destroy(), this.textureArray = null, this.textureArrayView = null, this.uniformBuffer?.destroy(), this.imageDataBuffer?.destroy(), this.bindGroup = null, this.conversionBuffer = null, this.conversionBufferSize = 0, this.device?.destroy(), this.device = null, this.context = null, this._canvas = null, this._initialized = !1, this._initPromise = null;
  }
}
class E extends EventTarget {
  // Feature detection cache (static)
  static _hasAlphaBug = null;
  static _hasBitmapBug = null;
  // Instance properties
  _loaded;
  _init;
  _onDemandRender;
  _offscreenRender;
  _video;
  _videoWidth = 0;
  _videoHeight = 0;
  _videoColorSpace = null;
  _canvas;
  _canvasParent;
  _bufferCanvas;
  _bufferCtx;
  _canvasctrl;
  _ctx = null;
  _lastRenderTime = 0;
  _playstate = !0;
  _destroyed = !1;
  _ro;
  _worker;
  _lastDemandTime = null;
  // Bound methods for event listeners
  _boundResize;
  _boundTimeUpdate;
  _boundSetRate;
  _boundUpdateColorSpace;
  // WebGPU renderer
  _webgpuRenderer = null;
  _useWebGPU = !1;
  _preferWebGPU = !0;
  _onWebGPUFallback;
  // Cached render data to reduce allocations
  _lastRenderWidth = 0;
  _lastRenderHeight = 0;
  // Public properties
  timeOffset;
  debug;
  prescaleFactor;
  prescaleHeightLimit;
  maxRenderHeight;
  busy = !1;
  constructor(e) {
    if (super(), !globalThis.Worker)
      throw this.destroy(new Error("Worker not supported"));
    if (!e)
      throw this.destroy(new Error("No options provided"));
    this._loaded = new Promise((r) => {
      this._init = r;
    });
    const t = E._test();
    this._onDemandRender = "requestVideoFrameCallback" in HTMLVideoElement.prototype && (e.onDemandRender ?? !0), this._preferWebGPU = e.preferWebGPU !== !1, this._onWebGPUFallback = e.onWebGPUFallback;
    const s = this._preferWebGPU && !e.canvas && Y();
    if (this._offscreenRender = "transferControlToOffscreen" in HTMLCanvasElement.prototype && !e.canvas && !s && (e.offscreenRender ?? !0), this.timeOffset = e.timeOffset || 0, this._video = e.video, this._canvas = e.canvas, this._video && !this._canvas)
      this._canvasParent = document.createElement("div"), this._canvasParent.className = "JASSUB", this._canvasParent.style.position = "relative", this._canvas = this._createCanvas(), this._video.insertAdjacentElement("afterend", this._canvasParent);
    else if (!this._canvas)
      throw this.destroy(new Error("Don't know where to render: you should give video or canvas in options."));
    this._bufferCanvas = document.createElement("canvas");
    const i = this._bufferCanvas.getContext("2d");
    if (!i) throw this.destroy(new Error("Canvas rendering not supported"));
    this._bufferCtx = i, s ? this._initWebGPU() : this._offscreenRender || (this._ctx = this._canvas.getContext("2d")), this._canvasctrl = this._offscreenRender ? this._canvas.transferControlToOffscreen() : this._canvas, this._lastRenderTime = 0, this.debug = !!e.debug, this.prescaleFactor = e.prescaleFactor || 1, this.prescaleHeightLimit = e.prescaleHeightLimit || 1080, this.maxRenderHeight = e.maxRenderHeight || 0, this._boundResize = this.resize.bind(this), this._boundTimeUpdate = this._timeupdate.bind(this), this._boundSetRate = () => this.setRate(this._video.playbackRate), this._boundUpdateColorSpace = this._updateColorSpace.bind(this), this._video && this.setVideo(this._video), this._onDemandRender && (this.busy = !1, this._lastDemandTime = null), this._worker = new Worker(e.workerUrl || "jassub-worker.js"), this._worker.onmessage = (r) => this._onmessage(r), this._worker.onerror = (r) => this._error(r), t.then(() => {
      this._worker.postMessage({
        target: "init",
        wasmUrl: e.wasmUrl ?? "jassub-worker.wasm",
        asyncRender: typeof createImageBitmap < "u" && (e.asyncRender ?? !0),
        onDemandRender: this._onDemandRender,
        width: this._canvasctrl.width || 0,
        height: this._canvasctrl.height || 0,
        blendMode: e.blendMode || "js",
        subUrl: e.subUrl,
        subContent: e.subContent || null,
        fonts: e.fonts || [],
        availableFonts: e.availableFonts || { "liberation sans": "./default.woff2" },
        fallbackFont: e.fallbackFont || "liberation sans",
        debug: this.debug,
        targetFps: e.targetFps || 24,
        dropAllAnimations: e.dropAllAnimations,
        dropAllBlur: e.dropAllBlur,
        clampPos: e.clampPos,
        libassMemoryLimit: e.libassMemoryLimit ?? 128,
        libassGlyphLimit: e.libassGlyphLimit ?? 2048,
        useLocalFonts: typeof globalThis.queryLocalFonts < "u" && (e.useLocalFonts ?? !0),
        hasBitmapBug: E._hasBitmapBug
      }), this._offscreenRender && this.sendMessage("offscreenCanvas", {}, [this._canvasctrl]);
    });
  }
  // ==========================================================================
  // Static Methods
  // ==========================================================================
  static async _testImageBugs() {
    if (E._hasBitmapBug !== null) return;
    const e = document.createElement("canvas"), t = e.getContext("2d", { willReadFrequently: !0 });
    if (!t) throw new Error("Canvas rendering not supported");
    if (typeof ImageData.prototype.constructor == "function")
      try {
        new ImageData(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1);
      } catch {
        console.log("Detected that ImageData is not constructable despite browser saying so");
      }
    const s = document.createElement("canvas"), i = s.getContext("2d", { willReadFrequently: !0 });
    if (!i) throw new Error("Canvas rendering not supported");
    e.width = s.width = 1, e.height = s.height = 1, t.clearRect(0, 0, 1, 1), i.clearRect(0, 0, 1, 1);
    const r = i.getImageData(0, 0, 1, 1).data;
    t.putImageData(new ImageData(new Uint8ClampedArray([0, 255, 0, 0]), 1, 1), 0, 0), i.drawImage(e, 0, 0);
    const o = i.getImageData(0, 0, 1, 1).data;
    if (E._hasAlphaBug = r[1] !== o[1], E._hasAlphaBug && console.log("Detected a browser having issue with transparent pixels, applying workaround"), typeof createImageBitmap < "u") {
      const n = new Uint8ClampedArray([255, 0, 255, 0, 255]).subarray(1, 5);
      i.drawImage(await createImageBitmap(new ImageData(n, 1)), 0, 0);
      const { data: a } = i.getImageData(0, 0, 1, 1);
      E._hasBitmapBug = !1;
      for (let l = 0; l < a.length; l++)
        if (Math.abs(n[l] - a[l]) > 15) {
          E._hasBitmapBug = !0, console.log("Detected a browser having issue with partial bitmaps, applying workaround");
          break;
        }
    } else
      E._hasBitmapBug = !1;
    e.remove(), s.remove();
  }
  static async _test() {
    await E._testImageBugs();
  }
  // ==========================================================================
  // WebGPU Management
  // ==========================================================================
  /** Initialize WebGPU renderer. */
  async _initWebGPU() {
    try {
      if (this._webgpuRenderer = new X(), await this._webgpuRenderer.init(), !this._canvas) return;
      const e = Math.max(1, this._canvas.width || 1), t = Math.max(1, this._canvas.height || 1);
      await this._webgpuRenderer.setCanvas(this._canvas, e, t), this._useWebGPU = !0, console.log("[JASSUB] Using WebGPU renderer");
    } catch (e) {
      console.warn("[JASSUB] WebGPU init failed, falling back to Canvas2D:", e), this._webgpuRenderer?.destroy(), this._webgpuRenderer = null, this._useWebGPU = !1, !this._offscreenRender && !this._ctx && (this._ctx = this._canvas.getContext("2d")), this._onWebGPUFallback?.();
    }
  }
  /** Check if WebGPU is being used */
  get isUsingWebGPU() {
    return this._useWebGPU;
  }
  // ==========================================================================
  // Canvas Management
  // ==========================================================================
  _createCanvas() {
    return this._canvas = document.createElement("canvas"), this._canvas.style.display = "block", this._canvas.style.position = "absolute", this._canvas.style.pointerEvents = "none", this._canvasParent.appendChild(this._canvas), this._canvas;
  }
  /**
   * Resize the canvas to given parameters. Auto-generated if values are omitted.
   */
  resize(e = 0, t = 0, s = 0, i = 0, r = this._video?.paused ?? !1) {
    if ((!e || !t) && this._video) {
      const o = k(this._video);
      let n;
      if (this._videoWidth) {
        const a = this._video.videoWidth / this._videoWidth, l = this._video.videoHeight / this._videoHeight;
        n = S(
          (o.width || 0) / a,
          (o.height || 0) / l,
          this.prescaleFactor,
          this.prescaleHeightLimit,
          this.maxRenderHeight
        );
      } else
        n = S(
          o.width || 0,
          o.height || 0,
          this.prescaleFactor,
          this.prescaleHeightLimit,
          this.maxRenderHeight
        );
      e = n.width, t = n.height, this._canvasParent && (s = o.y - (this._canvasParent.getBoundingClientRect().top - this._video.getBoundingClientRect().top), i = o.x), this._canvas.style.width = o.width + "px", this._canvas.style.height = o.height + "px";
    }
    this._canvas.style.top = s + "px", this._canvas.style.left = i + "px", this._useWebGPU && this._webgpuRenderer && e > 0 && t > 0 && this._webgpuRenderer.updateSize(e, t), r && this.busy === !1 ? this.busy = !0 : r = !1, this.sendMessage("canvas", {
      width: e,
      height: t,
      videoWidth: this._videoWidth || this._video?.videoWidth || 0,
      videoHeight: this._videoHeight || this._video?.videoHeight || 0,
      force: r
    });
  }
  // ==========================================================================
  // Video Management
  // ==========================================================================
  _timeupdate(e) {
    const s = {
      seeking: !0,
      waiting: !0,
      playing: !1
    }[e.type];
    s != null && (this._playstate = s), this.setCurrentTime(this._video.paused || this._playstate, this._video.currentTime + this.timeOffset);
  }
  /**
   * Change the video to use as target for event listeners.
   */
  setVideo(e) {
    e instanceof HTMLVideoElement ? (this._removeListeners(), this._video = e, this._onDemandRender ? e.requestVideoFrameCallback(this._handleRVFC.bind(this)) : (this._playstate = e.paused, e.addEventListener("timeupdate", this._boundTimeUpdate, !1), e.addEventListener("progress", this._boundTimeUpdate, !1), e.addEventListener("waiting", this._boundTimeUpdate, !1), e.addEventListener("seeking", this._boundTimeUpdate, !1), e.addEventListener("playing", this._boundTimeUpdate, !1), e.addEventListener("ratechange", this._boundSetRate, !1), e.addEventListener("resize", this._boundResize, !1)), "VideoFrame" in window && (e.addEventListener("loadedmetadata", this._boundUpdateColorSpace, !1), e.readyState > 2 && this._updateColorSpace()), e.videoWidth > 0 && this.resize(), typeof ResizeObserver < "u" && (this._ro || (this._ro = new ResizeObserver(() => this.resize())), this._ro.observe(e))) : this._error(new Error("Video element invalid!"));
  }
  /**
   * Run a benchmark on the worker.
   */
  runBenchmark() {
    this.sendMessage("runBenchmark");
  }
  // ==========================================================================
  // Track Management
  // ==========================================================================
  /**
   * Overwrites the current subtitle content by URL.
   */
  setTrackByUrl(e) {
    this.sendMessage("setTrackByUrl", { url: e }), this._reAttachOffscreen(), this._ctx && (this._ctx.filter = "none");
  }
  /**
   * Overwrites the current subtitle content.
   */
  setTrack(e) {
    this.sendMessage("setTrack", { content: e }), this._reAttachOffscreen(), this._ctx && (this._ctx.filter = "none");
  }
  /**
   * Free currently used subtitle track.
   */
  freeTrack() {
    this.sendMessage("freeTrack");
  }
  // ==========================================================================
  // Playback Control
  // ==========================================================================
  /**
   * Sets the playback state of the media.
   */
  setIsPaused(e) {
    this.sendMessage("video", { isPaused: e });
  }
  /**
   * Sets the playback rate of the media.
   */
  setRate(e) {
    this.sendMessage("video", { rate: e });
  }
  /**
   * Sets the current time, playback state and rate of the subtitles.
   */
  setCurrentTime(e, t, s) {
    this.sendMessage("video", {
      isPaused: e,
      currentTime: t,
      rate: s,
      colorSpace: this._videoColorSpace
    });
  }
  // ==========================================================================
  // Event Management
  // ==========================================================================
  /**
   * Create a new ASS event directly.
   */
  createEvent(e) {
    this.sendMessage("createEvent", { event: e });
  }
  /**
   * Overwrite the data of the event with the specified index.
   */
  setEvent(e, t) {
    this.sendMessage("setEvent", { event: e, index: t });
  }
  /**
   * Remove the event with the specified index.
   */
  removeEvent(e) {
    this.sendMessage("removeEvent", { index: e });
  }
  /**
   * Get all ASS events.
   */
  getEvents(e) {
    this._fetchFromWorker({ target: "getEvents" }, (t, s) => {
      e(t, s?.events ?? []);
    });
  }
  // ==========================================================================
  // Style Management
  // ==========================================================================
  /**
   * Set a style override.
   */
  styleOverride(e) {
    this.sendMessage("styleOverride", { style: e });
  }
  /**
   * Disable style override.
   */
  disableStyleOverride() {
    this.sendMessage("disableStyleOverride");
  }
  /**
   * Create a new ASS style directly.
   */
  createStyle(e) {
    this.sendMessage("createStyle", { style: e });
  }
  /**
   * Overwrite the data of the style with the specified index.
   */
  setStyle(e, t) {
    this.sendMessage("setStyle", { style: e, index: t });
  }
  /**
   * Remove the style with the specified index.
   */
  removeStyle(e) {
    this.sendMessage("removeStyle", { index: e });
  }
  /**
   * Get all ASS styles.
   */
  getStyles(e) {
    this._fetchFromWorker({ target: "getStyles" }, (t, s) => {
      e(t, s?.styles ?? []);
    });
  }
  // ==========================================================================
  // Font Management
  // ==========================================================================
  /**
   * Adds a font to the renderer.
   */
  addFont(e) {
    this.sendMessage("addFont", { font: e });
  }
  /**
   * Changes the font family of the default font.
   */
  setDefaultFont(e) {
    this.sendMessage("defaultFont", { font: e });
  }
  // ==========================================================================
  // Performance Stats
  // ==========================================================================
  /**
   * Get real-time performance statistics.
   */
  getStats(e) {
    this._fetchFromWorker({ target: "getStats" }, (t, s) => {
      if (t) return e(t, null);
      const i = s?.stats, r = {
        framesRendered: i.framesRendered ?? 0,
        framesDropped: i.framesDropped ?? 0,
        avgRenderTime: i.avgRenderTime ?? 0,
        maxRenderTime: i.maxRenderTime ?? 0,
        minRenderTime: i.minRenderTime ?? 0,
        lastRenderTime: i.lastRenderTime ?? 0,
        pendingRenders: i.pendingRenders ?? 0,
        totalEvents: i.totalEvents ?? 0,
        cacheHits: i.cacheHits ?? 0,
        cacheMisses: i.cacheMisses ?? 0,
        renderFps: i.avgRenderTime && i.avgRenderTime > 0 ? Math.round(1e3 / i.avgRenderTime) : 0,
        usingWorker: !0,
        offscreenRender: this._offscreenRender,
        onDemandRender: this._onDemandRender
      };
      e(null, r);
    });
  }
  /**
   * Reset performance statistics counters.
   */
  resetStats(e) {
    this._fetchFromWorker({ target: "resetStats" }, (t) => {
      e && e(t);
    });
  }
  // ==========================================================================
  // Private Methods
  // ==========================================================================
  _sendLocalFont(e) {
    try {
      globalThis.queryLocalFonts().then((t) => {
        const s = t?.find((i) => i.fullName.toLowerCase() === e);
        s && s.blob().then((i) => {
          i.arrayBuffer().then((r) => {
            this.addFont(new Uint8Array(r));
          });
        });
      });
    } catch (t) {
      console.warn("Local fonts API:", t);
    }
  }
  _getLocalFont(e) {
    try {
      navigator?.permissions?.query ? navigator.permissions.query({ name: "local-fonts" }).then((t) => {
        t.state === "granted" && this._sendLocalFont(e.font);
      }) : this._sendLocalFont(e.font);
    } catch (t) {
      console.warn("Local fonts API:", t);
    }
  }
  _unbusy() {
    this._lastDemandTime ? this._demandRender(this._lastDemandTime) : this.busy = !1;
  }
  _handleRVFC(e, t) {
    this._destroyed || (this.busy ? this._lastDemandTime = { mediaTime: t.mediaTime, width: t.width, height: t.height } : (this.busy = !0, this._demandRender({ mediaTime: t.mediaTime, width: t.width, height: t.height })), this._video.requestVideoFrameCallback(this._handleRVFC.bind(this)));
  }
  _demandRender(e) {
    this._lastDemandTime = null, (e.width !== this._videoWidth || e.height !== this._videoHeight) && (this._videoWidth = e.width, this._videoHeight = e.height, this.resize()), this.sendMessage("demand", { time: e.mediaTime + this.timeOffset });
  }
  _detachOffscreen() {
    !this._offscreenRender || this._ctx || (this._canvas.remove(), this._createCanvas(), this._canvasctrl = this._canvas, this._ctx = this._canvasctrl.getContext("2d"), this.sendMessage("detachOffscreen"), this.busy = !1, this.resize(0, 0, 0, 0, !0));
  }
  _reAttachOffscreen() {
    !this._offscreenRender || !this._ctx || (this._canvas.remove(), this._createCanvas(), this._canvasctrl = this._canvas.transferControlToOffscreen(), this._ctx = !1, this.sendMessage("offscreenCanvas", {}, [this._canvasctrl]), this.resize(0, 0, 0, 0, !0));
  }
  _updateColorSpace() {
    this._video.requestVideoFrameCallback(() => {
      try {
        const e = new globalThis.VideoFrame(this._video);
        this._videoColorSpace = L[e.colorSpace.matrix] ?? null, e.close(), this.sendMessage("getColorSpace");
      } catch (e) {
        console.warn(e);
      }
    });
  }
  _verifyColorSpace(e) {
    const { subtitleColorSpace: t, videoColorSpace: s = this._videoColorSpace } = e;
    if (!t || !s || t === s) return;
    this._detachOffscreen();
    const i = W[t]?.[s];
    i && this._ctx && (this._ctx.filter = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feColorMatrix type='matrix' values='${i} 0 0 0 0 0 1 0'/></filter></svg>#f")`);
  }
  _render(e) {
    this._unbusy();
    const t = e.width, s = e.height;
    if (this.debug && (e.times.IPCTime = Date.now() - (e.times.JSRenderTime || 0)), (this._canvasctrl.width !== t || this._canvasctrl.height !== s) && (this._canvasctrl.width = t, this._canvasctrl.height = s, this._lastRenderWidth = t, this._lastRenderHeight = s, this._useWebGPU && this._webgpuRenderer && this._webgpuRenderer.updateSize(t, s), this._verifyColorSpace({ subtitleColorSpace: e.colorSpace })), this._useWebGPU && this._webgpuRenderer) {
      this._renderWebGPU(e);
      return;
    }
    if (!this._ctx) return;
    const r = this._ctx, o = e.images, n = o.length;
    if (r.clearRect(0, 0, t, s), e.asyncRender)
      for (let a = 0; a < n; a++) {
        const l = o[a];
        l.image && (r.drawImage(l.image, l.x, l.y), l.image.close());
      }
    else {
      const a = this._bufferCanvas, l = this._bufferCtx, v = E._hasAlphaBug ?? !1;
      for (let w = 0; w < n; w++) {
        const x = o[w];
        if (x.image) {
          const u = x.w, g = x.h;
          (a.width !== u || a.height !== g) && (a.width = u, a.height = g);
          const R = new Uint8ClampedArray(x.image), A = z(R, v);
          l.putImageData(new ImageData(A, u, g), 0, 0), r.drawImage(a, x.x, x.y);
        }
      }
    }
    if (this.debug) {
      e.times.JSRenderTime = Date.now() - (e.times.JSRenderTime || 0) - (e.times.IPCTime || 0);
      let a = 0;
      const l = e.times.bitmaps || n;
      delete e.times.bitmaps;
      for (const v in e.times)
        a += e.times[v] || 0;
      console.log("Bitmaps: " + l + " Total: " + (a | 0) + "ms", e.times);
    }
  }
  _renderWebGPU(e) {
    if (this._webgpuRenderer) {
      if (e.images.length === 0) {
        this._webgpuRenderer.clear();
        return;
      }
      if (e.asyncRender) {
        const t = e.images.filter((s) => s.image instanceof ImageBitmap).map((s) => ({
          image: s.image,
          x: s.x,
          y: s.y
        }));
        this._webgpuRenderer.renderBitmaps(t, this._canvasctrl.width, this._canvasctrl.height);
        for (const s of e.images)
          s.image instanceof ImageBitmap && s.image.close();
      } else
        this._webgpuRenderer.render(e.images, this._canvasctrl.width, this._canvasctrl.height);
      if (this.debug) {
        e.times.JSRenderTime = Date.now() - (e.times.JSRenderTime || 0) - (e.times.IPCTime || 0);
        let t = 0;
        const s = e.times.bitmaps || e.images.length;
        delete e.times.bitmaps;
        for (const i in e.times)
          t += e.times[i] || 0;
        console.log("[WebGPU] Bitmaps: " + s + " Total: " + (t | 0) + "ms", e.times);
      }
    }
  }
  _ready() {
    this._init(), this.dispatchEvent(new CustomEvent("ready"));
  }
  /**
   * Send data and execute function in the worker.
   */
  async sendMessage(e, t = {}, s) {
    await this._loaded, s ? this._worker.postMessage({ target: e, transferable: s, ...t }, [...s]) : this._worker.postMessage({ target: e, ...t });
  }
  _fetchFromWorker(e, t) {
    try {
      const s = e.target, i = setTimeout(() => {
        o(new Error("Error: Timeout while trying to fetch " + s));
      }, 5e3), r = (n) => {
        n.data.target === s && (t(null, n.data), this._worker.removeEventListener("message", r), this._worker.removeEventListener("error", o), clearTimeout(i));
      }, o = (n) => {
        t(n instanceof Error ? n : n.error || new Error("Worker error")), this._worker.removeEventListener("message", r), this._worker.removeEventListener("error", o), clearTimeout(i);
      };
      this._worker.addEventListener("message", r), this._worker.addEventListener("error", o), this._worker.postMessage(e);
    } catch (s) {
      this._error(s);
    }
  }
  _console(e) {
    console[e.command].apply(console, JSON.parse(e.content));
  }
  _onmessage(e) {
    const t = this["_" + e.data.target];
    t && t.call(this, e.data);
  }
  _error(e) {
    const t = e instanceof Error ? e : e instanceof ErrorEvent ? e.error || new Error(e.message) : new Error(String(e)), s = e instanceof Event ? new ErrorEvent(e.type, e) : new ErrorEvent("error", { error: t });
    return this.dispatchEvent(s), console.error(t), t;
  }
  _removeListeners() {
    this._video && (this._ro && this._ro.unobserve(this._video), this._ctx && (this._ctx.filter = "none"), this._video.removeEventListener("timeupdate", this._boundTimeUpdate), this._video.removeEventListener("progress", this._boundTimeUpdate), this._video.removeEventListener("waiting", this._boundTimeUpdate), this._video.removeEventListener("seeking", this._boundTimeUpdate), this._video.removeEventListener("playing", this._boundTimeUpdate), this._video.removeEventListener("ratechange", this._boundSetRate), this._video.removeEventListener("resize", this._boundResize), this._video.removeEventListener("loadedmetadata", this._boundUpdateColorSpace));
  }
  /**
   * Destroy the object, worker, listeners and all data.
   */
  destroy(e) {
    const t = e ? this._error(e) : void 0;
    return this._video && this._canvasParent && this._video.parentNode?.removeChild(this._canvasParent), this._webgpuRenderer && (this._webgpuRenderer.destroy(), this._webgpuRenderer = null, this._useWebGPU = !1), this._destroyed = !0, this._removeListeners(), this.sendMessage("destroy"), this._worker?.terminate(), t;
  }
}
export {
  E as JASSUB,
  X as WebGPURenderer,
  W as colorMatrixConversionMap,
  S as computeCanvasSize,
  E as default,
  K as dropBlur,
  z as fixAlpha,
  Z as fixPlayRes,
  te as getAlphaBug,
  se as getBitmapBug,
  Q as getColorSpaceFilterUrl,
  k as getVideoPosition,
  Y as isWebGPUSupported,
  j as libassYCbCrMap,
  J as parseAss,
  ee as runFeatureTests,
  $ as testImageBugs,
  L as webYCbCrMap
};
