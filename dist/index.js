const k = {
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
function Q(h, e) {
  if (!h || !e || h === e) return null;
  const t = W[h]?.[e];
  return t ? `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feColorMatrix type='matrix' values='${t} 0 0 0 0 0 1 0'/></filter></svg>#f")` : null;
}
function I(h, e, t, s, i) {
  const a = t <= 0 ? 1 : t, c = globalThis.devicePixelRatio || 1;
  if (e <= 0 || h <= 0)
    return { width: 0, height: 0 };
  const n = a < 1 ? -1 : 1;
  let r = e * c;
  return n * r * a <= n * s ? r *= a : n * r < n * s && (r = s), i > 0 && r > i && (r = i), h *= r / e, e = r, { width: h, height: e };
}
function L(h, e = h.videoWidth, t = h.videoHeight) {
  const s = e / t, { offsetWidth: i, offsetHeight: a } = h, c = i / a;
  let n = i, r = a;
  c > s ? n = Math.floor(a * s) : r = Math.floor(i / s);
  const o = (i - n) / 2, v = (a - r) / 2;
  return { width: n, height: r, x: o, y: v };
}
function z(h, e) {
  if (!e) return h;
  const t = h.length, s = t - t % 16;
  let i = 3;
  for (; i < s; i += 16)
    h[i] < 2 && (h[i] = 1), h[i + 4] < 2 && (h[i + 4] = 1), h[i + 8] < 2 && (h[i + 8] = 1), h[i + 12] < 2 && (h[i + 12] = 1);
  for (; i < t; i += 4)
    h[i] < 2 && (h[i] = 1);
  return h;
}
function J(h, e = !1) {
  const t = [], s = h.split(/[\r\n]+/g), i = s.length;
  let a = null, c = null;
  for (let n = 0; n < i; n++) {
    const r = s[n];
    if (!r || /^\s*$/.test(r)) continue;
    const o = r[0];
    if (o === "[") {
      const v = r.match(/^\[(.*)\]$/);
      if (v) {
        if (e && v[1].toLowerCase() === "events")
          break;
        a = null, c = { name: v[1], body: [] }, t.push(c);
        continue;
      }
    }
    if (c)
      if (o === ";")
        c.body.push({
          type: "comment",
          value: r.substring(1)
        });
      else {
        const v = r.indexOf(":");
        if (v === -1) continue;
        const w = r.substring(0, v);
        let x = r.substring(v + 1).trim();
        if (a || w === "Format") {
          let u = x.split(",");
          if (a && u.length > a.length) {
            const R = u.slice(a.length - 1).join(",");
            u = u.slice(0, a.length - 1), u.push(R);
          }
          const m = u.length;
          for (let R = 0; R < m; R++)
            u[R] = u[R].trim();
          if (a) {
            const R = {}, A = Math.min(a.length, m);
            for (let _ = 0; _ < A; _++)
              R[a[_]] = u[_];
            x = R;
          } else
            x = u;
        }
        w === "Format" && (a = x), c.body.push({ key: w, value: x });
      }
  }
  return t;
}
const O = /\\blur(?:[0-9]+\.)?[0-9]+/gm;
function K(h) {
  return h.replace(O, "");
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
function V(h, e) {
  const t = [...H].sort((s, i) => s.w - i.w);
  for (const s of t)
    if (h <= s.w && e <= s.h)
      return s;
  return { w: Math.ceil(h / 100) * 100, h: Math.ceil(e / 100) * 100 };
}
function b(h, e) {
  return e && e.includes(".") ? h.toFixed(2).replace(/\.?0+$/, "") : Math.round(h);
}
function Z(h) {
  const e = h.match(/PlayResX:\s*(\d+)/i), t = h.match(/PlayResY:\s*(\d+)/i), s = e ? parseInt(e[1], 10) : 1920, i = t ? parseInt(t[1], 10) : 1080, a = /\\pos\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g, c = /\\move\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g, n = /\\org\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g, r = /\\i?clip\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g;
  let o = 0, v = 0;
  const w = (g, l, f) => {
    let y;
    const T = new RegExp(g.source, "g");
    for (; (y = T.exec(h)) !== null; ) {
      for (const E of l)
        if (y[E]) {
          const D = Math.abs(parseFloat(y[E]));
          D > o && (o = D);
        }
      for (const E of f)
        if (y[E]) {
          const D = Math.abs(parseFloat(y[E]));
          D > v && (v = D);
        }
    }
  };
  if (w(a, [1], [2]), w(c, [1, 3], [2, 4]), w(n, [1], [2]), w(r, [1, 3], [2, 4]), o <= s && v <= i) return h;
  const x = V(o, v), u = s / x.w, m = i / x.h, R = Math.min(u, m), A = Math.max(u, m), _ = 1;
  let P = h;
  const p = P.match(/(\[Events\][\s\S]*)/i);
  if (!p) return P;
  let d = p[1];
  return d = d.replace(
    a,
    (g, l, f) => `\\pos(${b(parseFloat(l) * u, l)},${b(parseFloat(f) * m, f)})`
  ), d = d.replace(
    /\\move\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?:\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+))?\s*\)/g,
    (g, l, f, y, T, E, D) => {
      const U = `\\move(${b(parseFloat(l) * u, l)},${b(parseFloat(f) * m, f)},${b(parseFloat(y) * u, y)},${b(parseFloat(T) * m, T)}`;
      return E ? `${U},${E},${D})` : `${U})`;
    }
  ), d = d.replace(
    n,
    (g, l, f) => `\\org(${b(parseFloat(l) * u, l)},${b(parseFloat(f) * m, f)})`
  ), d = d.replace(
    /\\(i?clip)\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g,
    (g, l, f, y, T, E) => `\\${l}(${b(parseFloat(f) * u, f)},${b(parseFloat(y) * m, y)},${b(parseFloat(T) * u, T)},${b(parseFloat(E) * m, E)})`
  ), d = d.replace(/\\fs([\d.]+)/g, (g, l) => `\\fs${b(parseFloat(l) * A, l)}`), d = d.replace(
    /\\fscx([\d.]+)/g,
    (g, l) => `\\fscx${b(parseFloat(l) * _, l)}`
  ), d = d.replace(
    /\\xbord([\d.]+)/g,
    (g, l) => `\\xbord${b(parseFloat(l) * u, l)}`
  ), d = d.replace(
    /\\ybord([\d.]+)/g,
    (g, l) => `\\ybord${b(parseFloat(l) * m, l)}`
  ), d = d.replace(
    /\\xshad(-?[\d.]+)/g,
    (g, l) => `\\xshad${b(parseFloat(l) * u, l)}`
  ), d = d.replace(
    /\\yshad(-?[\d.]+)/g,
    (g, l) => `\\yshad${b(parseFloat(l) * m, l)}`
  ), ["fsp", "bord", "shad", "be", "blur"].forEach((g) => {
    const l = new RegExp(`\\\\${g}(-?[\\d.]+)`, "g");
    d = d.replace(l, (f, y) => `\\${g}${b(parseFloat(y) * R, y)}`);
  }), d = d.replace(/(\\i?clip\s*\([^,)]+m[^)]+\)|\\p[1-9][^}]*?)(?=[\\}]|$)/g, (g) => g.replace(/(-?[\d.]+)\s+(-?[\d.]+)/g, (l, f, y) => `${b(parseFloat(f) * u, f)} ${b(parseFloat(y) * m, y)}`)), P.substring(0, p.index) + d;
}
let S = null, F = null;
async function $() {
  if (S !== null && F !== null)
    return { hasAlphaBug: S, hasBitmapBug: F };
  const h = document.createElement("canvas"), e = h.getContext("2d", { willReadFrequently: !0 });
  if (!e) throw new Error("Canvas rendering not supported");
  if (typeof ImageData.prototype.constructor == "function")
    try {
      new ImageData(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1);
    } catch {
      console.log("Detected that ImageData is not constructable despite browser saying so");
    }
  const t = document.createElement("canvas"), s = t.getContext("2d", { willReadFrequently: !0 });
  if (!s) throw new Error("Canvas rendering not supported");
  h.width = t.width = 1, h.height = t.height = 1, e.clearRect(0, 0, 1, 1), s.clearRect(0, 0, 1, 1);
  const i = s.getImageData(0, 0, 1, 1).data;
  e.putImageData(new ImageData(new Uint8ClampedArray([0, 255, 0, 0]), 1, 1), 0, 0), s.drawImage(h, 0, 0);
  const a = s.getImageData(0, 0, 1, 1).data;
  if (S = i[1] !== a[1], S && console.log("Detected a browser having issue with transparent pixels, applying workaround"), typeof createImageBitmap < "u") {
    const c = new Uint8ClampedArray([255, 0, 255, 0, 255]).subarray(1, 5);
    s.drawImage(await createImageBitmap(new ImageData(c, 1)), 0, 0);
    const { data: n } = s.getImageData(0, 0, 1, 1);
    F = !1;
    for (let r = 0; r < n.length; r++)
      if (Math.abs(c[r] - n[r]) > 15) {
        F = !0, console.log("Detected a browser having issue with partial bitmaps, applying workaround");
        break;
      }
  } else
    F = !1;
  return h.remove(), t.remove(), { hasAlphaBug: S, hasBitmapBug: F };
}
async function ee() {
  return $();
}
function te() {
  return S;
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
  
  // Calculate texel coordinates
  let texCoordF = floor(input.fragCoord.xy - input.destXY);
  let texCoord = vec2i(texCoordF);
  
  // Bounds check
  let texSizeI = vec2i(input.texSize);
  if (texCoord.x < 0 || texCoord.y < 0 || texCoord.x >= texSizeI.x || texCoord.y >= texSizeI.y) {
    discard;
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
    const i = this.nextPowerOf2(Math.max(e, 64)), a = this.nextPowerOf2(Math.max(t, 64)), c = Math.min(this.nextPowerOf2(Math.max(s, 16)), M);
    this.textureArray = this.device.createTexture({
      size: [i, a, c],
      format: this.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    }), this.textureArrayView = this.textureArray.createView({ dimension: "2d-array" }), this.textureArrayWidth = i, this.textureArrayHeight = a, this.textureArraySize = c, this.bindGroupDirty = !0;
    const n = this.device.createCommandEncoder();
    for (let r = 0; r < c; r++) {
      const o = this.textureArray.createView({
        dimension: "2d",
        baseArrayLayer: r,
        arrayLayerCount: 1
      });
      n.beginRenderPass({
        colorAttachments: [
          {
            view: o,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store"
          }
        ]
      }).end();
    }
    this.device.queue.submit([n.finish()]);
  }
  ensureTextureArray(e, t, s) {
    const i = Math.min(s, M);
    if (e <= this.textureArrayWidth && t <= this.textureArrayHeight && i <= this.textureArraySize)
      return !1;
    const a = this.nextPowerOf2(Math.max(this.textureArrayWidth, e)), c = this.nextPowerOf2(Math.max(this.textureArrayHeight, t)), n = Math.min(
      this.nextPowerOf2(Math.max(this.textureArraySize, i, i + 16)),
      M
    );
    return this.createTextureArray(a, c, n), !0;
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
    const a = this.context.getCurrentTexture();
    if (a.width === 0 || a.height === 0) return;
    let c = 0, n = 0, r = 0;
    for (let _ = 0; _ < i; _++) {
      const { image: P } = e[_], p = P.width, d = P.height;
      p > 0 && d > 0 && (p > c && (c = p), d > n && (n = d), r++);
    }
    if (r === 0) {
      this.clear();
      return;
    }
    const o = Math.min(r, M);
    this.ensureTextureArray(c, n, o), this.updateBindGroup();
    const v = this.device, w = v.queue, x = this.textureArray, u = this.imageDataArray, m = a.createView();
    let R = 0, A = !0;
    for (; R < i; ) {
      let _ = 0;
      for (; R < i && _ < M; ) {
        const d = e[R++], C = d.image, g = C.width, l = C.height;
        if (g <= 0 || l <= 0) continue;
        w.copyExternalImageToTexture(
          { source: C, flipY: !1 },
          { texture: x, origin: [0, 0, _], premultipliedAlpha: !0 },
          { width: g, height: l }
        );
        const f = _ << 3;
        u[f] = d.x, u[f + 1] = d.y, u[f + 2] = g, u[f + 3] = l, u[f + 4] = g, u[f + 5] = l, u[f + 6] = _, _++;
      }
      if (_ === 0) continue;
      w.writeBuffer(this.imageDataBuffer, 0, u.buffer, 0, _ << 5);
      const P = v.createCommandEncoder(), p = P.beginRenderPass({
        colorAttachments: [
          {
            view: m,
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
    const a = e.length;
    if (a === 0) {
      this.clear();
      return;
    }
    const c = this.context.getCurrentTexture();
    if (c.width === 0 || c.height === 0) return;
    let n = 0, r = 0, o = 0;
    for (let p = 0; p < a; p++) {
      const { w: d, h: C } = e[p];
      d > 0 && C > 0 && (d > n && (n = d), C > r && (r = C), o++);
    }
    if (o === 0) {
      this.clear();
      return;
    }
    const v = Math.min(o, M);
    this.ensureTextureArray(n, r, v), this.updateBindGroup();
    const w = this.device, x = w.queue, u = this.textureArray, m = this.imageDataArray, R = this.format === "bgra8unorm", A = c.createView();
    let _ = 0, P = !0;
    for (; _ < a; ) {
      let p = 0;
      for (; _ < a && p < M; ) {
        const g = e[_++], l = g.w, f = g.h;
        if (l <= 0 || f <= 0) continue;
        const y = g.image;
        y instanceof ImageBitmap ? x.copyExternalImageToTexture(
          { source: y, flipY: !1 },
          { texture: u, origin: [0, 0, p], premultipliedAlpha: !0 },
          { width: l, height: f }
        ) : y instanceof ArrayBuffer && this.uploadTextureData(p, y, l, f, R);
        const T = p << 3;
        m[T] = g.x, m[T + 1] = g.y, m[T + 2] = l, m[T + 3] = f, m[T + 4] = l, m[T + 5] = f, m[T + 6] = p, p++;
      }
      if (p === 0) continue;
      x.writeBuffer(this.imageDataBuffer, 0, m.buffer, 0, p << 5);
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
  uploadTextureData(e, t, s, i, a) {
    const c = s * i * 4;
    if (a) {
      const n = this.ensureConversionBuffer(c), r = new Uint8Array(t);
      for (let o = 0; o < c; o += 4)
        n[o] = r[o + 2], n[o + 1] = r[o + 1], n[o + 2] = r[o], n[o + 3] = r[o + 3];
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
class B extends EventTarget {
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
  renderAhead;
  constructor(e) {
    if (super(), !globalThis.Worker)
      throw this.destroy(new Error("Worker not supported"));
    if (!e)
      throw this.destroy(new Error("No options provided"));
    this._loaded = new Promise((a) => {
      this._init = a;
    });
    const t = B._test();
    this._onDemandRender = "requestVideoFrameCallback" in HTMLVideoElement.prototype && (e.onDemandRender ?? !0), this._preferWebGPU = e.preferWebGPU !== !1, this._onWebGPUFallback = e.onWebGPUFallback;
    const s = this._preferWebGPU && !e.canvas && Y();
    if (this._offscreenRender = "transferControlToOffscreen" in HTMLCanvasElement.prototype && !e.canvas && !s && (e.offscreenRender ?? !0), this.timeOffset = e.timeOffset || 0, this._video = e.video, this._canvas = e.canvas, this._video && !this._canvas)
      this._canvasParent = document.createElement("div"), this._canvasParent.className = "JASSUB", this._canvasParent.style.position = "relative", this._canvas = this._createCanvas(), this._video.insertAdjacentElement("afterend", this._canvasParent);
    else if (!this._canvas)
      throw this.destroy(new Error("Don't know where to render: you should give video or canvas in options."));
    this._bufferCanvas = document.createElement("canvas");
    const i = this._bufferCanvas.getContext("2d");
    if (!i) throw this.destroy(new Error("Canvas rendering not supported"));
    this._bufferCtx = i, s ? this._initWebGPU() : this._offscreenRender || (this._ctx = this._canvas.getContext("2d")), this._canvasctrl = this._offscreenRender ? this._canvas.transferControlToOffscreen() : this._canvas, this._lastRenderTime = 0, this.debug = !!e.debug, this.prescaleFactor = e.prescaleFactor || 1, this.prescaleHeightLimit = e.prescaleHeightLimit || 1080, this.maxRenderHeight = e.maxRenderHeight || 0, this.renderAhead = e.renderAhead ?? 0, this._boundResize = this.resize.bind(this), this._boundTimeUpdate = this._timeupdate.bind(this), this._boundSetRate = () => this.setRate(this._video.playbackRate), this._boundUpdateColorSpace = this._updateColorSpace.bind(this), this._video && this.setVideo(this._video), this._onDemandRender && (this.busy = !1, this._lastDemandTime = null), this._worker = new Worker(e.workerUrl || "jassub-worker.js"), this._worker.onmessage = (a) => this._onmessage(a), this._worker.onerror = (a) => this._error(a), t.then(() => {
      this._worker.postMessage({
        target: "init",
        wasmUrl: e.wasmUrl ?? "jassub-worker.wasm",
        asyncRender: typeof createImageBitmap < "u" && (e.asyncRender ?? !0),
        onDemandRender: this._onDemandRender,
        width: this._canvasctrl.width || 0,
        height: this._canvasctrl.height || 0,
        blendMode: e.blendMode ?? "wasm",
        subUrl: e.subUrl,
        subContent: e.subContent || null,
        fonts: e.fonts || [],
        availableFonts: e.availableFonts || { "liberation sans": "./default.woff2" },
        fallbackFonts: e.fallbackFonts || ["liberation sans"],
        debug: this.debug,
        targetFps: e.targetFps || 24,
        dropAllAnimations: e.dropAllAnimations,
        dropAllBlur: e.dropAllBlur,
        clampPos: e.clampPos,
        libassMemoryLimit: e.libassMemoryLimit ?? 128,
        libassGlyphLimit: e.libassGlyphLimit ?? 2048,
        useLocalFonts: typeof globalThis.queryLocalFonts < "u" && (e.useLocalFonts ?? !0),
        hasBitmapBug: B._hasBitmapBug
      }), this._offscreenRender && this.sendMessage("offscreenCanvas", {}, [this._canvasctrl]);
    });
  }
  // ==========================================================================
  // Static Methods
  // ==========================================================================
  static async _testImageBugs() {
    if (B._hasBitmapBug !== null) return;
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
    const a = i.getImageData(0, 0, 1, 1).data;
    t.putImageData(new ImageData(new Uint8ClampedArray([0, 255, 0, 0]), 1, 1), 0, 0), i.drawImage(e, 0, 0);
    const c = i.getImageData(0, 0, 1, 1).data;
    if (B._hasAlphaBug = a[1] !== c[1], B._hasAlphaBug && console.log("Detected a browser having issue with transparent pixels, applying workaround"), typeof createImageBitmap < "u") {
      const n = new Uint8ClampedArray([255, 0, 255, 0, 255]).subarray(1, 5);
      i.drawImage(await createImageBitmap(new ImageData(n, 1)), 0, 0);
      const { data: r } = i.getImageData(0, 0, 1, 1);
      B._hasBitmapBug = !1;
      for (let o = 0; o < r.length; o++)
        if (Math.abs(n[o] - r[o]) > 15) {
          B._hasBitmapBug = !0, console.log("Detected a browser having issue with partial bitmaps, applying workaround");
          break;
        }
    } else
      B._hasBitmapBug = !1;
    e.remove(), s.remove();
  }
  static async _test() {
    await B._testImageBugs();
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
  resize(e = 0, t = 0, s = 0, i = 0, a = this._video?.paused ?? !1) {
    if ((!e || !t) && this._video) {
      const c = L(this._video);
      let n;
      if (this._videoWidth) {
        const r = this._video.videoWidth / this._videoWidth, o = this._video.videoHeight / this._videoHeight;
        n = I(
          (c.width || 0) / r,
          (c.height || 0) / o,
          this.prescaleFactor,
          this.prescaleHeightLimit,
          this.maxRenderHeight
        );
      } else
        n = I(
          c.width || 0,
          c.height || 0,
          this.prescaleFactor,
          this.prescaleHeightLimit,
          this.maxRenderHeight
        );
      e = n.width, t = n.height, this._canvasParent && (s = c.y - (this._canvasParent.getBoundingClientRect().top - this._video.getBoundingClientRect().top), i = c.x), this._canvas.style.width = c.width + "px", this._canvas.style.height = c.height + "px";
    }
    this._canvas.style.top = s + "px", this._canvas.style.left = i + "px", this._useWebGPU && this._webgpuRenderer && e > 0 && t > 0 && this._webgpuRenderer.updateSize(e, t), a && this.busy === !1 ? this.busy = !0 : a = !1, this.sendMessage("canvas", {
      width: e,
      height: t,
      videoWidth: this._videoWidth || this._video?.videoWidth || 0,
      videoHeight: this._videoHeight || this._video?.videoHeight || 0,
      force: a
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
    e instanceof HTMLVideoElement ? (this._removeListeners(), this._video = e, this._onDemandRender ? this._loaded.then(() => {
      !this._destroyed && this._video === e && e.requestVideoFrameCallback(this._handleRVFC.bind(this));
    }) : (this._playstate = e.paused, e.addEventListener("timeupdate", this._boundTimeUpdate, !1), e.addEventListener("progress", this._boundTimeUpdate, !1), e.addEventListener("waiting", this._boundTimeUpdate, !1), e.addEventListener("seeking", this._boundTimeUpdate, !1), e.addEventListener("playing", this._boundTimeUpdate, !1), e.addEventListener("ratechange", this._boundSetRate, !1), e.addEventListener("resize", this._boundResize, !1)), "VideoFrame" in window && (e.addEventListener("loadedmetadata", this._boundUpdateColorSpace, !1), e.readyState > 2 && this._updateColorSpace()), e.videoWidth > 0 && this.resize(), typeof ResizeObserver < "u" && (this._ro || (this._ro = new ResizeObserver(() => this.resize())), this._ro.observe(e))) : this._error(new Error("Video element invalid!"));
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
  async getEvents() {
    return (await this._fetchFromWorker({ target: "getEvents" })).events ?? [];
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
  async getStyles() {
    return (await this._fetchFromWorker({ target: "getStyles" })).styles ?? [];
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
  async getStats() {
    const t = (await this._fetchFromWorker({ target: "getStats" })).stats;
    return {
      framesRendered: t.framesRendered ?? 0,
      framesDropped: t.framesDropped ?? 0,
      avgRenderTime: t.avgRenderTime ?? 0,
      maxRenderTime: t.maxRenderTime ?? 0,
      minRenderTime: t.minRenderTime ?? 0,
      lastRenderTime: t.lastRenderTime ?? 0,
      pendingRenders: t.pendingRenders ?? 0,
      totalEvents: t.totalEvents ?? 0,
      cacheHits: t.cacheHits ?? 0,
      cacheMisses: t.cacheMisses ?? 0,
      renderFps: t.avgRenderTime && t.avgRenderTime > 0 ? Math.round(1e3 / t.avgRenderTime) : 0,
      usingWorker: !0,
      offscreenRender: this._offscreenRender,
      onDemandRender: this._onDemandRender
    };
  }
  /**
   * Reset performance statistics counters.
   */
  async resetStats() {
    await this._fetchFromWorker({ target: "resetStats" });
  }
  /**
   * Get event count
   */
  async getEventCount() {
    return (await this._fetchFromWorker({ target: "getEventCount" })).count;
  }
  /**
   * Get style count
   */
  async getStyleCount() {
    return (await this._fetchFromWorker({ target: "getStyleCount" })).count;
  }
  // ==========================================================================
  // Private Methods
  // ==========================================================================
  _sendLocalFont(e) {
    try {
      globalThis.queryLocalFonts().then((t) => {
        const s = t?.find((i) => i.fullName.toLowerCase() === e);
        s && s.blob().then((i) => {
          i.arrayBuffer().then((a) => {
            this.addFont(new Uint8Array(a));
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
    if (this._destroyed) return;
    const s = this._video?.playbackRate ?? 1, a = {
      mediaTime: t.mediaTime + this.renderAhead * s,
      width: t.width,
      height: t.height
    };
    this.busy ? this._lastDemandTime = a : (this.busy = !0, this._demandRender(a)), this._video.requestVideoFrameCallback(this._handleRVFC.bind(this));
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
        this._videoColorSpace = k[e.colorSpace.matrix] ?? null, e.close(), this.sendMessage("getColorSpace");
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
    const a = this._ctx, c = e.images, n = c.length;
    if (a.clearRect(0, 0, t, s), e.asyncRender)
      for (let r = 0; r < n; r++) {
        const o = c[r];
        o.image && (a.drawImage(o.image, o.x, o.y), o.image.close());
      }
    else {
      const r = this._bufferCanvas, o = this._bufferCtx, v = B._hasAlphaBug ?? !1;
      for (let w = 0; w < n; w++) {
        const x = c[w];
        if (x.image) {
          const u = x.w, m = x.h;
          (r.width !== u || r.height !== m) && (r.width = u, r.height = m);
          const R = new Uint8ClampedArray(x.image), A = z(R, v);
          o.putImageData(new ImageData(A, u, m), 0, 0), a.drawImage(r, x.x, x.y);
        }
      }
    }
    if (this.debug) {
      e.times.JSRenderTime = Date.now() - (e.times.JSRenderTime || 0) - (e.times.IPCTime || 0);
      let r = 0;
      const o = e.times.bitmaps || n;
      delete e.times.bitmaps;
      for (const v in e.times)
        r += e.times[v] || 0;
      console.log("Bitmaps: " + o + " Total: " + (r | 0) + "ms", e.times);
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
   * Handler for partial_ready message from worker.
   * Emitted early for large subtitle files to allow playback to start
   * while font loading and track parsing continues.
   */
  _partial_ready() {
    this.dispatchEvent(new CustomEvent("partial_ready"));
  }
  /**
   * Send data and execute function in the worker.
   */
  async sendMessage(e, t = {}, s) {
    await this._loaded, s ? this._worker.postMessage({ target: e, transferable: s, ...t }, [...s]) : this._worker.postMessage({ target: e, ...t });
  }
  _fetchFromWorker(e) {
    return new Promise((t, s) => {
      try {
        const i = e.target, a = setTimeout(() => {
          r(), s(new Error("Error: Timeout while trying to fetch " + i));
        }, 5e3), c = (o) => {
          o.data.target === i && (r(), t(o.data));
        }, n = (o) => {
          r(), s(o instanceof Error ? o : o.error || new Error("Worker error"));
        }, r = () => {
          this._worker.removeEventListener("message", c), this._worker.removeEventListener("error", n), clearTimeout(a);
        };
        this._worker.addEventListener("message", c), this._worker.addEventListener("error", n), this._worker.postMessage(e);
      } catch (i) {
        s(i);
      }
    });
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
  B as JASSUB,
  X as WebGPURenderer,
  W as colorMatrixConversionMap,
  I as computeCanvasSize,
  B as default,
  K as dropBlur,
  z as fixAlpha,
  Z as fixPlayRes,
  te as getAlphaBug,
  se as getBitmapBug,
  Q as getColorSpaceFilterUrl,
  L as getVideoPosition,
  Y as isWebGPUSupported,
  j as libassYCbCrMap,
  J as parseAss,
  ee as runFeatureTests,
  $ as testImageBugs,
  k as webYCbCrMap
};
