import "rvfc-polyfill";
const P = {
  bt709: "BT709",
  bt470bg: "BT601",
  // BT.601 PAL
  smpte170m: "BT601"
  // BT.601 NTSC
}, B = {
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
}, N = [
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
function Y(i, e) {
  if (!i || !e || i === e) return null;
  const t = B[i]?.[e];
  return t ? `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feColorMatrix type='matrix' values='${t} 0 0 0 0 0 1 0'/></filter></svg>#f")` : null;
}
function I(i, e, t, s, a) {
  const r = t <= 0 ? 1 : t, l = globalThis.devicePixelRatio || 1;
  if (e <= 0 || i <= 0)
    return { width: 0, height: 0 };
  const o = r < 1 ? -1 : 1;
  let h = e * l;
  return o * h * r <= o * s ? h *= r : o * h < o * s && (h = s), a > 0 && h > a && (h = a), i *= h / e, e = h, { width: i, height: e };
}
function $(i, e = i.videoWidth, t = i.videoHeight) {
  const s = e / t, { offsetWidth: a, offsetHeight: r } = i, l = a / r;
  let o = a, h = r;
  l > s ? o = Math.floor(r * s) : h = Math.floor(a / s);
  const m = (a - o) / 2, w = (r - h) / 2;
  return { width: o, height: h, x: m, y: w };
}
function U(i, e) {
  if (e)
    for (let t = 3; t < i.length; t += 4)
      i[t] = i[t] > 1 ? i[t] : 1;
  return i;
}
function X(i, e = !1) {
  const t = [], s = i.split(/[\r\n]+/g);
  let a = null;
  for (let r = 0; r < s.length; r++) {
    const l = s[r].match(/^\[(.*)\]$/);
    if (l) {
      if (e && l[1].toLowerCase() === "events")
        break;
      a = null, t.push({
        name: l[1],
        body: []
      });
    } else {
      if (/^\s*$/.test(s[r]) || t.length === 0) continue;
      const o = t[t.length - 1].body;
      if (s[r][0] === ";")
        o.push({
          type: "comment",
          value: s[r].substring(1)
        });
      else {
        const h = s[r].split(":"), m = h[0];
        let w = h.slice(1).join(":").trim();
        if (a || m === "Format") {
          let v = w.split(",");
          if (a && v.length > a.length) {
            const R = v.slice(a.length - 1).join(",");
            v = v.slice(0, a.length - 1), v.push(R);
          }
          if (v = v.map((R) => R.trim()), a) {
            const R = {};
            for (let p = 0; p < v.length; p++)
              R[a[p]] = v[p];
            w = R;
          } else
            w = v;
        }
        m === "Format" && (a = w), o.push({ key: m, value: w });
      }
    }
  }
  return t;
}
const A = /\\blur(?:[0-9]+\.)?[0-9]+/gm;
function G(i) {
  return i.replace(A, "");
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
function z(i, e) {
  const t = [...H].sort((s, a) => s.w - a.w);
  for (const s of t)
    if (i <= s.w && e <= s.h)
      return s;
  return { w: Math.ceil(i / 100) * 100, h: Math.ceil(e / 100) * 100 };
}
function d(i, e) {
  return e && e.includes(".") ? i.toFixed(2).replace(/\.?0+$/, "") : Math.round(i);
}
function K(i) {
  const e = i.match(/PlayResX:\s*(\d+)/i), t = i.match(/PlayResY:\s*(\d+)/i), s = e ? parseInt(e[1], 10) : 1920, a = t ? parseInt(t[1], 10) : 1080, r = /\\pos\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g, l = /\\move\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g, o = /\\org\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g, h = /\\i?clip\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g;
  let m = 0, w = 0;
  const v = (_, n, f) => {
    let u;
    const T = new RegExp(_.source, "g");
    for (; (u = T.exec(i)) !== null; ) {
      for (const b of n)
        if (u[b]) {
          const C = Math.abs(parseFloat(u[b]));
          C > m && (m = C);
        }
      for (const b of f)
        if (u[b]) {
          const C = Math.abs(parseFloat(u[b]));
          C > w && (w = C);
        }
    }
  };
  if (v(r, [1], [2]), v(l, [1, 3], [2, 4]), v(o, [1], [2]), v(h, [1, 3], [2, 4]), m <= s && w <= a) return i;
  const R = z(m, w), p = s / R.w, y = a / R.h, L = Math.min(p, y), W = Math.max(p, y), S = 1;
  let F = i;
  const D = F.match(/(\[Events\][\s\S]*)/i);
  if (!D) return F;
  let c = D[1];
  return c = c.replace(
    r,
    (_, n, f) => `\\pos(${d(parseFloat(n) * p, n)},${d(parseFloat(f) * y, f)})`
  ), c = c.replace(
    /\\move\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?:\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+))?\s*\)/g,
    (_, n, f, u, T, b, C) => {
      const k = `\\move(${d(parseFloat(n) * p, n)},${d(parseFloat(f) * y, f)},${d(parseFloat(u) * p, u)},${d(parseFloat(T) * y, T)}`;
      return b ? `${k},${b},${C})` : `${k})`;
    }
  ), c = c.replace(
    o,
    (_, n, f) => `\\org(${d(parseFloat(n) * p, n)},${d(parseFloat(f) * y, f)})`
  ), c = c.replace(
    /\\(i?clip)\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g,
    (_, n, f, u, T, b) => `\\${n}(${d(parseFloat(f) * p, f)},${d(parseFloat(u) * y, u)},${d(parseFloat(T) * p, T)},${d(parseFloat(b) * y, b)})`
  ), c = c.replace(
    /\\fs([\d.]+)/g,
    (_, n) => `\\fs${d(parseFloat(n) * W, n)}`
  ), c = c.replace(
    /\\fscx([\d.]+)/g,
    (_, n) => `\\fscx${d(parseFloat(n) * S, n)}`
  ), c = c.replace(
    /\\xbord([\d.]+)/g,
    (_, n) => `\\xbord${d(parseFloat(n) * p, n)}`
  ), c = c.replace(
    /\\ybord([\d.]+)/g,
    (_, n) => `\\ybord${d(parseFloat(n) * y, n)}`
  ), c = c.replace(
    /\\xshad(-?[\d.]+)/g,
    (_, n) => `\\xshad${d(parseFloat(n) * p, n)}`
  ), c = c.replace(
    /\\yshad(-?[\d.]+)/g,
    (_, n) => `\\yshad${d(parseFloat(n) * y, n)}`
  ), ["fsp", "bord", "shad", "be", "blur"].forEach((_) => {
    const n = new RegExp(`\\\\${_}(-?[\\d.]+)`, "g");
    c = c.replace(
      n,
      (f, u) => `\\${_}${d(parseFloat(u) * L, u)}`
    );
  }), c = c.replace(
    /(\\i?clip\s*\([^,)]+m[^)]+\)|\\p[1-9][^}]*?)(?=[\\}]|$)/g,
    (_) => _.replace(/(-?[\d.]+)\s+(-?[\d.]+)/g, (n, f, u) => `${d(parseFloat(f) * p, f)} ${d(parseFloat(u) * y, u)}`)
  ), F.substring(0, D.index) + c;
}
let M = null, E = null, x = null;
async function O() {
  if (M !== null) return M;
  try {
    if (typeof WebAssembly != "object" || typeof WebAssembly.validate != "function")
      return M = !1, !1;
    const i = Uint8Array.of(
      0,
      97,
      115,
      109,
      1,
      0,
      0,
      0,
      1,
      5,
      1,
      96,
      0,
      1,
      123,
      3,
      2,
      1,
      0,
      10,
      22,
      1,
      20,
      0,
      253,
      12,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      11
    );
    let e = WebAssembly.validate(i);
    if (e)
      try {
        await WebAssembly.compile(i);
      } catch {
        e = !1;
      }
    return M = e, e;
  } catch {
    return M = !1, !1;
  }
}
async function V() {
  if (E !== null && x !== null)
    return { hasAlphaBug: E, hasBitmapBug: x };
  const i = document.createElement("canvas"), e = i.getContext("2d", { willReadFrequently: !0 });
  if (!e) throw new Error("Canvas rendering not supported");
  if (typeof ImageData.prototype.constructor == "function")
    try {
      new ImageData(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1);
    } catch {
      console.log("Detected that ImageData is not constructable despite browser saying so");
    }
  const t = document.createElement("canvas"), s = t.getContext("2d", { willReadFrequently: !0 });
  if (!s) throw new Error("Canvas rendering not supported");
  i.width = t.width = 1, i.height = t.height = 1, e.clearRect(0, 0, 1, 1), s.clearRect(0, 0, 1, 1);
  const a = s.getImageData(0, 0, 1, 1).data;
  e.putImageData(new ImageData(new Uint8ClampedArray([0, 255, 0, 0]), 1, 1), 0, 0), s.drawImage(i, 0, 0);
  const r = s.getImageData(0, 0, 1, 1).data;
  if (E = a[1] !== r[1], E && console.log("Detected a browser having issue with transparent pixels, applying workaround"), typeof createImageBitmap < "u") {
    const l = new Uint8ClampedArray([255, 0, 255, 0, 255]).subarray(1, 5);
    s.drawImage(await createImageBitmap(new ImageData(l, 1)), 0, 0);
    const { data: o } = s.getImageData(0, 0, 1, 1);
    x = !1;
    for (let h = 0; h < o.length; h++)
      if (Math.abs(l[h] - o[h]) > 15) {
        x = !0, console.log("Detected a browser having issue with partial bitmaps, applying workaround");
        break;
      }
  } else
    x = !1;
  return i.remove(), t.remove(), { hasAlphaBug: E, hasBitmapBug: x };
}
async function Q() {
  const [i, e] = await Promise.all([O(), V()]);
  return {
    supportsSIMD: i,
    ...e
  };
}
function Z() {
  return M;
}
function J() {
  return E;
}
function ee() {
  return x;
}
class g extends EventTarget {
  // Feature detection cache (static)
  static _supportsSIMD = null;
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
    this._loaded = new Promise((a) => {
      this._init = a;
    });
    const t = g._test();
    if (this._onDemandRender = "requestVideoFrameCallback" in HTMLVideoElement.prototype && (e.onDemandRender ?? !0), this._offscreenRender = "transferControlToOffscreen" in HTMLCanvasElement.prototype && !e.canvas && (e.offscreenRender ?? !0), this.timeOffset = e.timeOffset || 0, this._video = e.video, this._canvas = e.canvas, this._video && !this._canvas)
      this._canvasParent = document.createElement("div"), this._canvasParent.className = "JASSUB", this._canvasParent.style.position = "relative", this._canvas = this._createCanvas(), this._video.insertAdjacentElement("afterend", this._canvasParent);
    else if (!this._canvas)
      throw this.destroy(new Error("Don't know where to render: you should give video or canvas in options."));
    this._bufferCanvas = document.createElement("canvas");
    const s = this._bufferCanvas.getContext("2d");
    if (!s) throw this.destroy(new Error("Canvas rendering not supported"));
    this._bufferCtx = s, this._canvasctrl = this._offscreenRender ? this._canvas.transferControlToOffscreen() : this._canvas, this._ctx = this._offscreenRender ? null : this._canvasctrl.getContext("2d"), this._lastRenderTime = 0, this.debug = !!e.debug, this.prescaleFactor = e.prescaleFactor || 1, this.prescaleHeightLimit = e.prescaleHeightLimit || 1080, this.maxRenderHeight = e.maxRenderHeight || 0, this._boundResize = this.resize.bind(this), this._boundTimeUpdate = this._timeupdate.bind(this), this._boundSetRate = () => this.setRate(this._video.playbackRate), this._boundUpdateColorSpace = this._updateColorSpace.bind(this), this._video && this.setVideo(this._video), this._onDemandRender && (this.busy = !1, this._lastDemandTime = null), this._worker = new Worker(e.workerUrl || "jassub-worker.js"), this._worker.onmessage = (a) => this._onmessage(a), this._worker.onerror = (a) => this._error(a), t.then(() => {
      const a = e.wasmUrl ?? "jassub-worker.wasm", r = e.forceModernWasmUrl && e.modernWasmUrl || g._supportsSIMD && e.modernWasmUrl ? e.modernWasmUrl : a;
      this._worker.postMessage({
        target: "init",
        wasmUrl: r,
        fallbackWasmUrl: a,
        legacyWasmUrl: e.legacyWasmUrl ?? "jassub-worker.wasm.js",
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
        hasBitmapBug: g._hasBitmapBug
      }), this._offscreenRender && this.sendMessage("offscreenCanvas", {}, [this._canvasctrl]);
    });
  }
  // ==========================================================================
  // Static Methods
  // ==========================================================================
  static async _testSIMD() {
    if (g._supportsSIMD === null)
      try {
        if (typeof WebAssembly != "object" || typeof WebAssembly.validate != "function") {
          g._supportsSIMD = !1;
          return;
        }
        const e = Uint8Array.of(
          0,
          97,
          115,
          109,
          1,
          0,
          0,
          0,
          1,
          5,
          1,
          96,
          0,
          1,
          123,
          3,
          2,
          1,
          0,
          10,
          22,
          1,
          20,
          0,
          253,
          12,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          11
        );
        let t = WebAssembly.validate(e);
        if (t)
          try {
            await WebAssembly.compile(e);
          } catch {
            t = !1;
          }
        g._supportsSIMD = t;
      } catch {
        g._supportsSIMD = !1;
      }
  }
  static async _testImageBugs() {
    if (g._hasBitmapBug !== null) return;
    const e = document.createElement("canvas"), t = e.getContext("2d", { willReadFrequently: !0 });
    if (!t) throw new Error("Canvas rendering not supported");
    if (typeof ImageData.prototype.constructor == "function")
      try {
        new ImageData(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1);
      } catch {
        console.log("Detected that ImageData is not constructable despite browser saying so");
      }
    const s = document.createElement("canvas"), a = s.getContext("2d", { willReadFrequently: !0 });
    if (!a) throw new Error("Canvas rendering not supported");
    e.width = s.width = 1, e.height = s.height = 1, t.clearRect(0, 0, 1, 1), a.clearRect(0, 0, 1, 1);
    const r = a.getImageData(0, 0, 1, 1).data;
    t.putImageData(new ImageData(new Uint8ClampedArray([0, 255, 0, 0]), 1, 1), 0, 0), a.drawImage(e, 0, 0);
    const l = a.getImageData(0, 0, 1, 1).data;
    if (g._hasAlphaBug = r[1] !== l[1], g._hasAlphaBug && console.log("Detected a browser having issue with transparent pixels, applying workaround"), typeof createImageBitmap < "u") {
      const o = new Uint8ClampedArray([255, 0, 255, 0, 255]).subarray(1, 5);
      a.drawImage(await createImageBitmap(new ImageData(o, 1)), 0, 0);
      const { data: h } = a.getImageData(0, 0, 1, 1);
      g._hasBitmapBug = !1;
      for (let m = 0; m < h.length; m++)
        if (Math.abs(o[m] - h[m]) > 15) {
          g._hasBitmapBug = !0, console.log("Detected a browser having issue with partial bitmaps, applying workaround");
          break;
        }
    } else
      g._hasBitmapBug = !1;
    e.remove(), s.remove();
  }
  static async _test() {
    await g._testSIMD(), await g._testImageBugs();
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
  resize(e = 0, t = 0, s = 0, a = 0, r = this._video?.paused ?? !1) {
    if ((!e || !t) && this._video) {
      const l = $(this._video);
      let o;
      if (this._videoWidth) {
        const h = this._video.videoWidth / this._videoWidth, m = this._video.videoHeight / this._videoHeight;
        o = I(
          (l.width || 0) / h,
          (l.height || 0) / m,
          this.prescaleFactor,
          this.prescaleHeightLimit,
          this.maxRenderHeight
        );
      } else
        o = I(
          l.width || 0,
          l.height || 0,
          this.prescaleFactor,
          this.prescaleHeightLimit,
          this.maxRenderHeight
        );
      e = o.width, t = o.height, this._canvasParent && (s = l.y - (this._canvasParent.getBoundingClientRect().top - this._video.getBoundingClientRect().top), a = l.x), this._canvas.style.width = l.width + "px", this._canvas.style.height = l.height + "px";
    }
    this._canvas.style.top = s + "px", this._canvas.style.left = a + "px", r && this.busy === !1 ? this.busy = !0 : r = !1, this.sendMessage("canvas", {
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
      const a = s?.stats, r = {
        framesRendered: a.framesRendered ?? 0,
        framesDropped: a.framesDropped ?? 0,
        avgRenderTime: a.avgRenderTime ?? 0,
        maxRenderTime: a.maxRenderTime ?? 0,
        minRenderTime: a.minRenderTime ?? 0,
        lastRenderTime: a.lastRenderTime ?? 0,
        pendingRenders: a.pendingRenders ?? 0,
        totalEvents: a.totalEvents ?? 0,
        cacheHits: a.cacheHits ?? 0,
        cacheMisses: a.cacheMisses ?? 0,
        renderFps: a.avgRenderTime && a.avgRenderTime > 0 ? Math.round(1e3 / a.avgRenderTime) : 0,
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
        const s = t?.find((a) => a.fullName.toLowerCase() === e);
        s && s.blob().then((a) => {
          a.arrayBuffer().then((r) => {
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
        this._videoColorSpace = P[e.colorSpace.matrix] ?? null, e.close(), this.sendMessage("getColorSpace");
      } catch (e) {
        console.warn(e);
      }
    });
  }
  _verifyColorSpace(e) {
    const { subtitleColorSpace: t, videoColorSpace: s = this._videoColorSpace } = e;
    if (!t || !s || t === s) return;
    this._detachOffscreen();
    const a = B[t]?.[s];
    a && this._ctx && (this._ctx.filter = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feColorMatrix type='matrix' values='${a} 0 0 0 0 0 1 0'/></filter></svg>#f")`);
  }
  _render(e) {
    if (this._unbusy(), this.debug && (e.times.IPCTime = Date.now() - (e.times.JSRenderTime || 0)), (this._canvasctrl.width !== e.width || this._canvasctrl.height !== e.height) && (this._canvasctrl.width = e.width, this._canvasctrl.height = e.height, this._verifyColorSpace({ subtitleColorSpace: e.colorSpace })), !!this._ctx) {
      this._ctx.clearRect(0, 0, this._canvasctrl.width, this._canvasctrl.height);
      for (const t of e.images)
        if (t.image)
          if (e.asyncRender)
            this._ctx.drawImage(t.image, t.x, t.y), t.image.close();
          else {
            this._bufferCanvas.width = t.w, this._bufferCanvas.height = t.h;
            const s = new Uint8ClampedArray(t.image), a = U(s, g._hasAlphaBug ?? !1);
            this._bufferCtx.putImageData(
              new ImageData(a, t.w, t.h),
              0,
              0
            ), this._ctx.drawImage(this._bufferCanvas, t.x, t.y);
          }
      if (this.debug) {
        e.times.JSRenderTime = Date.now() - (e.times.JSRenderTime || 0) - (e.times.IPCTime || 0);
        let t = 0;
        const s = e.times.bitmaps || e.images.length;
        delete e.times.bitmaps;
        for (const a in e.times)
          t += e.times[a] || 0;
        console.log("Bitmaps: " + s + " Total: " + (t | 0) + "ms", e.times);
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
      const s = e.target, a = setTimeout(() => {
        l(new Error("Error: Timeout while trying to fetch " + s));
      }, 5e3), r = (o) => {
        o.data.target === s && (t(null, o.data), this._worker.removeEventListener("message", r), this._worker.removeEventListener("error", l), clearTimeout(a));
      }, l = (o) => {
        t(o instanceof Error ? o : o.error || new Error("Worker error")), this._worker.removeEventListener("message", r), this._worker.removeEventListener("error", l), clearTimeout(a);
      };
      this._worker.addEventListener("message", r), this._worker.addEventListener("error", l), this._worker.postMessage(e);
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
    return this._video && this._canvasParent && this._video.parentNode?.removeChild(this._canvasParent), this._destroyed = !0, this._removeListeners(), this.sendMessage("destroy"), this._worker?.terminate(), t;
  }
}
export {
  g as JASSUB,
  B as colorMatrixConversionMap,
  I as computeCanvasSize,
  g as default,
  G as dropBlur,
  U as fixAlpha,
  K as fixPlayRes,
  J as getAlphaBug,
  ee as getBitmapBug,
  Y as getColorSpaceFilterUrl,
  Z as getSIMDSupport,
  $ as getVideoPosition,
  N as libassYCbCrMap,
  X as parseAss,
  Q as runFeatureTests,
  V as testImageBugs,
  O as testSIMD,
  P as webYCbCrMap
};
