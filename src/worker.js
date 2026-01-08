/* eslint-disable no-extend-native */
// @ts-ignore
import WASM from 'wasm'

// polyfills for old or weird engines

if (!String.prototype.startsWith) {
  String.prototype.startsWith = function (s, p = 0) {
    return this.substring(p, s.length) === s
  }
}

if (!String.prototype.includes) {
  String.prototype.includes = function (s, p) {
    return this.indexOf(s, p) !== -1
  }
}

if (!Uint8Array.prototype.slice) {
  Uint8Array.prototype.slice = function (b, e) {
    return new Uint8Array(this.subarray(b, e))
  }
}

function toAbsoluteIndex(index, length) {
  const integer = index >> 0
  return integer < 0 ? Math.max(integer + length, 0) : Math.min(integer, length)
}

if (!Uint8Array.prototype.fill) {
  Int8Array.prototype.fill =
    Int16Array.prototype.fill =
    Int32Array.prototype.fill =
    Uint8Array.prototype.fill =
    Uint16Array.prototype.fill =
    Uint32Array.prototype.fill =
    Float32Array.prototype.fill =
    Float64Array.prototype.fill =
    Array.prototype.fill =
    function (value) {
      if (this == null) throw new TypeError('this is null or not defined')

      const O = Object(this)

      const length = O.length >>> 0

      const argumentsLength = arguments.length
      let index = toAbsoluteIndex(argumentsLength > 1 ? arguments[1] : undefined, length)
      const end = argumentsLength > 2 ? arguments[2] : undefined
      const endPos = end === undefined ? length : toAbsoluteIndex(end, length)
      while (endPos > index) O[index++] = value
      return O
    }
}

if (!Uint8Array.prototype.copyWithin) {
  Int8Array.prototype.copyWithin =
    Int16Array.prototype.copyWithin =
    Int32Array.prototype.copyWithin =
    Uint8Array.prototype.copyWithin =
    Uint16Array.prototype.copyWithin =
    Uint32Array.prototype.copyWithin =
    Float32Array.prototype.copyWithin =
    Float64Array.prototype.copyWithin =
    Array.prototype.copyWithin =
    function (target, start) {
      const O = Object(this)
      const len = O.length >>> 0

      let to = toAbsoluteIndex(target, len)
      let from = toAbsoluteIndex(start, len)
      const end = arguments.length > 2 ? arguments[2] : undefined
      let count = Math.min((end === undefined ? len : toAbsoluteIndex(end, len)) - from, len - to)
      let inc = 1
      if (from < to && to < from + count) {
        inc = -1
        from += count - 1
        to += count - 1
      }
      while (count-- > 0) {
        if (from in O) O[to] = O[from]
        else delete O[to]
        to += inc
        from += inc
      }
      return O
    }
}

if (!Date.now) Date.now = () => new Date().getTime()
// @ts-ignore
if (!('performance' in self)) self.performance = { now: () => Date.now() }

// implement console methods if they're missing
if (typeof console === 'undefined') {
  const msg = (command, a) => {
    postMessage({
      target: 'console',
      command,
      content: JSON.stringify(Array.prototype.slice.call(a))
    })
  }
  // @ts-ignore
  self.console = {
    log: function () {
      msg('log', arguments)
    },
    debug: function () {
      msg('debug', arguments)
    },
    info: function () {
      msg('info', arguments)
    },
    warn: function () {
      msg('warn', arguments)
    },
    error: function () {
      msg('error', arguments)
    }
  }
  console.log('Detected lack of console, overridden console')
}

let promiseSupported = typeof Promise !== 'undefined'

// some engines report that Promise resolve isn't a function... what?...
if (promiseSupported) {
  try {
    let res
    // eslint-disable-next-line no-new
    new Promise((resolve) => {
      res = resolve
    })
    res()
  } catch (error) {
    promiseSupported = false
  }
}

// very bad promise polyfill, it's absolutely minimal just to make emscripten work
// in engines that don't have promises, Promise should never be used otherwise
if (!promiseSupported) {
  // @ts-ignore
  self.Promise = function (cb) {
    let then = () => { }
    cb((a) => setTimeout(() => then(a), 0))
    return { then: (fn) => (then = fn) }
  }
}

const read_ = (url, ab) => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, false)
  xhr.responseType = ab ? 'arraybuffer' : 'text'
  xhr.send(null)
  return xhr.response
}
const readAsync = (url, load, err) => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, true)
  xhr.responseType = 'arraybuffer'
  xhr.onload = () => {
    if ((xhr.status === 200 || xhr.status === 0) && xhr.response) {
      return load(xhr.response)
    }
  }
  xhr.onerror = err
  xhr.send(null)
}

let lastCurrentTime = 0
const rate = 1
let rafId = null
let nextIsRaf = false
let lastCurrentTimeReceivedAt = Date.now()
let targetFps = 24
let useLocalFonts = false
let blendMode = 'js'
let availableFonts = {}
const fontMap_ = {}
let fontId = 0
let debug
let clampPos = false

self.width = 0
self.height = 0

// Performance metrics for real-time monitoring
const metrics = {
  framesRendered: 0,
  framesDropped: 0,
  totalRenderTime: 0,
  maxRenderTime: 0,
  minRenderTime: Infinity,
  lastRenderTime: 0,
  renderStartTime: 0,
  pendingRenders: 0,
  totalEvents: 0,
  currentEventIndex: 0,
  cacheHits: 0,
  cacheMisses: 0
}

// Reset metrics
const resetMetrics = () => {
  metrics.framesRendered = 0
  metrics.framesDropped = 0
  metrics.totalRenderTime = 0
  metrics.maxRenderTime = 0
  metrics.minRenderTime = Infinity
  metrics.lastRenderTime = 0
  metrics.cacheHits = 0
  metrics.cacheMisses = 0
}

let asyncRender = false

self.addFont = ({ font }) => asyncWrite(font)

const findAvailableFonts = (font) => {
  font = font.trim().toLowerCase()

  if (font.startsWith('@')) font = font.substring(1)

  if (fontMap_[font]) return

  fontMap_[font] = true

  if (!availableFonts[font]) {
    if (useLocalFonts) postMessage({ target: 'getLocalFont', font })
  } else {
    asyncWrite(availableFonts[font])
  }
}

const asyncWrite = (font) => {
  if (typeof font === 'string') {
    readAsync(
      font,
      (fontData) => {
        allocFont(new Uint8Array(fontData))
      },
      console.error
    )
  } else {
    allocFont(font)
  }
}

// Debounced font reload to batch font additions
let pendingFontReload = null
const scheduleReloadFonts = () => {
  if (pendingFontReload) return
  pendingFontReload = setTimeout(() => {
    pendingFontReload = null
    if (jassubObj) jassubObj.reloadFonts()
  }, 16) // ~1 frame at 60fps
}

const allocFont = (uint8) => {
  const ptr = _malloc(uint8.byteLength)
  self.HEAPU8.set(uint8, ptr)
  jassubObj.addFont('font-' + fontId++, ptr, uint8.byteLength)
  scheduleReloadFonts() // Debounced instead of immediate reload
}

// Parses only the Styles section (not Events) to detect fonts faster.
const processAvailableFonts = (content) => {
  if (!availableFonts) return
  const sections = parseAss(content, true)

  for (let i = 0; i < sections.length; i++) {
    for (let j = 0; j < sections[i].body.length; j++) {
      if (sections[i].body[j].key === 'Style') {
        findAvailableFonts(sections[i].body[j].value.Fontname)
      }
    }
  }

  // Use matchAll for better performance on Events section
  const eventsMatch = content.match(/\[Events\][\s\S]*/i)
  if (eventsMatch) {
    const eventsContent = eventsMatch[0]
    const fnMatches = eventsContent.matchAll(/\\fn([^\\}]*?)[\\}]/g)
    for (const match of fnMatches) {
      findAvailableFonts(match[1])
    }
  }
}
/**
 * Set the subtitle track.
 * @param {!string} content the content of the subtitle file.
 */
self.setTrack = ({ content }) => {
  // Make sure that the fonts are loaded
  processAvailableFonts(content)

  if (clampPos) content = fixPlayRes(content)
  if (dropAllBlur) content = dropBlur(content)
  // Tell libass to render the new track
  jassubObj.createTrackMem(content)

  subtitleColorSpace = libassYCbCrMap[jassubObj.trackColorSpace]
  postMessage({ target: 'verifyColorSpace', subtitleColorSpace })
}

self.getColorSpace = () => postMessage({ target: 'verifyColorSpace', subtitleColorSpace })

/**
 * Remove subtitle track.
 */
self.freeTrack = () => {
  jassubObj.removeTrack()
}

/**
 * Set the subtitle track.
 * @param {!string} url the URL of the subtitle file.
 */
self.setTrackByUrl = ({ url }) => {
  self.setTrack({ content: read_(url) })
}

const getCurrentTime = () => {
  const diff = (Date.now() - lastCurrentTimeReceivedAt) / 1000
  if (_isPaused) {
    return lastCurrentTime
  } else {
    if (diff > 5) {
      console.error("Didn\'t received currentTime > 5 seconds. Assuming video was paused.")
      setIsPaused(true)
    }
    return lastCurrentTime + diff * rate
  }
}
const setCurrentTime = (currentTime) => {
  lastCurrentTime = currentTime
  lastCurrentTimeReceivedAt = Date.now()
  if (!rafId) {
    if (nextIsRaf) {
      rafId = requestAnimationFrame(renderLoop)
    } else {
      renderLoop()

      // Give onmessage chance to receive all queued messages
      setTimeout(() => {
        nextIsRaf = false
      }, 20)
    }
  }
}

let _isPaused = true
const setIsPaused = (isPaused) => {
  if (isPaused !== _isPaused) {
    _isPaused = isPaused
    if (isPaused) {
      if (rafId) {
        clearTimeout(rafId)
        rafId = null
      }
    } else {
      lastCurrentTimeReceivedAt = Date.now()
      rafId = requestAnimationFrame(renderLoop)
    }
  }
}

const a = 'BT601'
const b = 'BT709'
const c = 'SMPTE240M'
const d = 'FCC'

const libassYCbCrMap = [null, a, null, a, a, b, b, c, c, d, d]

const render = (time, force) => {
  const times = {}
  const renderStartTime = performance.now()
  metrics.renderStartTime = renderStartTime
  metrics.pendingRenders++

  const renderResult =
    blendMode === 'wasm' ? jassubObj.renderBlend(time, force || 0) : jassubObj.renderImage(time, force || 0)

  // Update metrics
  const renderEndTime = performance.now()
  const renderDuration = renderEndTime - renderStartTime
  metrics.lastRenderTime = renderDuration
  metrics.totalRenderTime += renderDuration
  metrics.maxRenderTime = Math.max(metrics.maxRenderTime, renderDuration)
  if (renderDuration > 0) {
    metrics.minRenderTime = Math.min(metrics.minRenderTime, renderDuration)
  }

  if (jassubObj.changed !== 0 || force) {
    metrics.framesRendered++
    metrics.cacheMisses++
  } else {
    metrics.cacheHits++
  }

  // Update event count from WASM
  if (jassubObj && jassubObj.getEventCount) {
    metrics.totalEvents = jassubObj.getEventCount()
  }

  if (debug) {
    const decodeEndTime = performance.now()
    const renderEndTime = jassubObj.time
    times.WASMRenderTime = renderEndTime - renderStartTime
    times.WASMBitmapDecodeTime = decodeEndTime - renderEndTime
    // performance.now is relative to the creation of the scope, since this time MIGHT be used to calculate a time difference
    // on the main thread, we need absolute time, not relative
    times.JSRenderTime = Date.now()
  }
  if (jassubObj.changed !== 0 || force) {
    const images = []
    const buffers = []
    if (!renderResult) return paintImages({ images, buffers, times })
    if (asyncRender) {
      const promises = []
      for (let result = renderResult, i = 0; i < jassubObj.count; result = result.next, ++i) {
        const reassigned = {
          w: result.w,
          h: result.h,
          x: result.x,
          y: result.y
        }
        const pointer = result.image
        const data = hasBitmapBug
          ? self.HEAPU8C.slice(pointer, pointer + reassigned.w * reassigned.h * 4)
          : self.HEAPU8C.subarray(pointer, pointer + reassigned.w * reassigned.h * 4)
        promises.push(createImageBitmap(new ImageData(data, reassigned.w, reassigned.h)))
        images.push(reassigned)
      }
      // use callback to not rely on async/await
      Promise.all(promises).then((bitmaps) => {
        for (let i = 0; i < images.length; i++) {
          images[i].image = bitmaps[i]
        }
        if (debug) times.JSBitmapGenerationTime = Date.now() - times.JSRenderTime
        paintImages({ images, buffers: bitmaps, times })
      })
    } else {
      for (let image = renderResult, i = 0; i < jassubObj.count; image = image.next, ++i) {
        const reassigned = {
          w: image.w,
          h: image.h,
          x: image.x,
          y: image.y,
          image: image.image
        }
        if (!offCanvasCtx) {
          const buf = self.wasmMemory.buffer.slice(image.image, image.image + image.w * image.h * 4)
          buffers.push(buf)
          reassigned.image = buf
        }
        images.push(reassigned)
      }
      paintImages({ images, buffers, times })
    }
  } else {
    postMessage({
      target: 'unbusy'
    })
  }
}

self.demand = ({ time }) => {
  lastCurrentTime = time
  render(time)
}

const renderLoop = (force) => {
  rafId = 0
  render(getCurrentTime(), force)
  if (!_isPaused) {
    rafId = requestAnimationFrame(renderLoop)
  }
}

const paintImages = ({ times, images, buffers }) => {
  metrics.pendingRenders--

  const resultObject = {
    target: 'render',
    asyncRender,
    images,
    times,
    width: self.width,
    height: self.height,
    colorSpace: subtitleColorSpace
  }

  if (offscreenRender) {
    if (offCanvas.height !== self.height || offCanvas.width !== self.width) {
      offCanvas.width = self.width
      offCanvas.height = self.height
    }
    offCanvasCtx.clearRect(0, 0, self.width, self.height)
    for (const image of images) {
      if (image.image) {
        if (asyncRender) {
          offCanvasCtx.drawImage(image.image, image.x, image.y)
          image.image.close()
        } else {
          bufferCanvas.width = image.w
          bufferCanvas.height = image.h
          bufferCtx.putImageData(
            new ImageData(self.HEAPU8C.subarray(image.image, image.image + image.w * image.h * 4), image.w, image.h),
            0,
            0
          )
          offCanvasCtx.drawImage(bufferCanvas, image.x, image.y)
        }
      }
    }
    if (offscreenRender === 'hybrid') {
      if (!images.length) return postMessage(resultObject)
      if (debug) times.bitmaps = images.length
      try {
        const image = offCanvas.transferToImageBitmap()
        resultObject.images = [{ image, x: 0, y: 0 }]
        resultObject.asyncRender = true
        postMessage(resultObject, [image])
      } catch (e) {
        postMessage({ target: 'unbusy' })
      }
    } else {
      if (debug) {
        times.JSRenderTime = Date.now() - times.JSRenderTime - (times.JSBitmapGenerationTime || 0)
        let total = 0
        for (const key in times) total += times[key]
        console.log('Bitmaps: ' + images.length + ' Total: ' + (total | 0) + 'ms', times)
      }
      postMessage({ target: 'unbusy' })
    }
  } else {
    postMessage(resultObject, buffers)
  }
}

/**
 * Parse the content of an .ass file.
 * @param {!string} content the content of the file
 * @param {boolean} stopAtEvents if true, stop parsing when [Events] section is reached
 */
const parseAss = (content, stopAtEvents = false) => {
  let m, format, lastPart, parts, key, value, tmp, i, j, body
  const sections = []
  const lines = content.split(/[\r\n]+/g)
  for (i = 0; i < lines.length; i++) {
    m = lines[i].match(/^\[(.*)\]$/)
    if (m) {
      // Early termination for font detection performance
      if (stopAtEvents && m[1].toLowerCase() === 'events') {
        break
      }
      format = null
      sections.push({
        name: m[1],
        body: []
      })
    } else {
      if (/^\s*$/.test(lines[i])) continue
      if (sections.length === 0) continue
      body = sections[sections.length - 1].body
      if (lines[i][0] === ';') {
        body.push({
          type: 'comment',
          value: lines[i].substring(1)
        })
      } else {
        parts = lines[i].split(':')
        key = parts[0]
        value = parts.slice(1).join(':').trim()
        if (format || key === 'Format') {
          value = value.split(',')
          if (format && value.length > format.length) {
            lastPart = value.slice(format.length - 1).join(',')
            value = value.slice(0, format.length - 1)
            value.push(lastPart)
          }
          value = value.map((s) => {
            return s.trim()
          })
          if (format) {
            tmp = {}
            for (j = 0; j < value.length; j++) {
              tmp[format[j]] = value[j]
            }
            value = tmp
          }
        }
        if (key === 'Format') {
          format = value
        }
        body.push({
          key,
          value
        })
      }
    }
  }

  return sections
}

const blurRegex = /\\blur(?:[0-9]+\.)?[0-9]+/gm

const dropBlur = (subContent) => {
  return subContent.replace(blurRegex, '')
}

// Common video resolutions to detect source resolution
const commonResolutions = [
  { w: 7680, h: 4320 }, // 8K
  { w: 3840, h: 2160 }, // 4K UHD
  { w: 2560, h: 1440 }, // 1440p
  { w: 1920, h: 1080 }, // 1080p
  { w: 1280, h: 720 },  // 720p
]

/**
 * Detect the likely source resolution based on max position values.
 * @param {number} maxX - Maximum X position found
 * @param {number} maxY - Maximum Y position found
 * @returns {{w: number, h: number}} - Detected source resolution
 */
const detectSourceResolution = (maxX, maxY) => {
  const sorted = [...commonResolutions].sort((a, b) => a.w - b.w)
  for (const res of sorted) {
    if (maxX <= res.w && maxY <= res.h) {
      return res
    }
  }
  return { w: Math.ceil(maxX / 100) * 100, h: Math.ceil(maxY / 100) * 100 }
}

const formatValue = (value, original) => {
  const hasDecimal = original && original.includes('.')
  return hasDecimal ? value.toFixed(2).replace(/\.?0+$/, '') : Math.round(value)
}

/**
 * Scale override tags in Events from detected source resolution to PlayRes.
 * Only scales tags within override blocks {...} in the Events section.
 * @param {string} subContent - The subtitle content
 * @returns {string} - The modified subtitle content with scaled values
 */
const fixPlayRes = (subContent) => {
  const playResXMatch = subContent.match(/PlayResX:\s*(\d+)/i)
  const playResYMatch = subContent.match(/PlayResY:\s*(\d+)/i)

  const playResX = playResXMatch ? parseInt(playResXMatch[1], 10) : 1920
  const playResY = playResYMatch ? parseInt(playResYMatch[1], 10) : 1080

  const posRegex = /\\pos\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g
  const moveRegex = /\\move\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g
  const orgRegex = /\\org\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g
  const clipRectRegex = /\\i?clip\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g

  let maxX = 0
  let maxY = 0

  const findMax = (regex, xIndices, yIndices) => {
    let match
    const regexCopy = new RegExp(regex.source, 'g')
    while ((match = regexCopy.exec(subContent)) !== null) {
      for (const i of xIndices) {
        if (match[i]) {
          const x = Math.abs(parseFloat(match[i]))
          if (x > maxX) maxX = x
        }
      }
      for (const i of yIndices) {
        if (match[i]) {
          const y = Math.abs(parseFloat(match[i]))
          if (y > maxY) maxY = y
        }
      }
    }
  }

  findMax(posRegex, [1], [2])
  findMax(moveRegex, [1, 3], [2, 4])
  findMax(orgRegex, [1], [2])
  findMax(clipRectRegex, [1, 3], [2, 4])

  if (maxX <= playResX && maxY <= playResY) return subContent

  const sourceRes = detectSourceResolution(maxX, maxY)
  const xnsize = playResX / sourceRes.w
  const ynsize = playResY / sourceRes.h

  const val = Math.min(xnsize, ynsize)
  const val1 = Math.max(xnsize, ynsize)
  const valFscx = 1.0

  let newContent = subContent

  // const stylesMatch = newContent.match(/(\[V4\+? Styles\][\s\S]*?)(?=\[|$)/i)
  // if (stylesMatch) {
  //   let stylesSection = stylesMatch[1]
  //   const lines = stylesSection.split(/\r?\n/)
  //   const formatLine = lines.find(l => l.startsWith('Format:'))
  //   if (formatLine) {
  //     const parts = formatLine.split(':')[1].split(',').map(p => p.trim())
  //     const indices = {
  //       fs: parts.indexOf('Fontsize'),
  //       ml: parts.indexOf('MarginL'),
  //       mr: parts.indexOf('MarginR'),
  //       mv: parts.indexOf('MarginV'),
  //       ol: parts.indexOf('Outline'),
  //       sh: parts.indexOf('Shadow'),
  //       sp: parts.indexOf('Spacing')
  //     }

  //     stylesSection = lines.map(line => {
  //       if (!line.startsWith('Style:')) return line
  //       const data = line.split(':')
  //       const values = data[1].split(',')
  //       if (indices.fs !== -1) values[indices.fs] = formatValue(parseFloat(values[indices.fs]) * val, values[indices.fs])
  //       if (indices.ml !== -1) values[indices.ml] = Math.round(parseFloat(values[indices.ml]) * xnsize)
  //       if (indices.mr !== -1) values[indices.mr] = Math.round(parseFloat(values[indices.mr]) * xnsize)
  //       if (indices.mv !== -1) values[indices.mv] = Math.round(parseFloat(values[indices.mv]) * ynsize)
  //       if (indices.ol !== -1) values[indices.ol] = formatValue(parseFloat(values[indices.ol]) * val, values[indices.ol])
  //       if (indices.sh !== -1) values[indices.sh] = formatValue(parseFloat(values[indices.sh]) * val, values[indices.sh])
  //       if (indices.sp !== -1) values[indices.sp] = formatValue(parseFloat(values[indices.sp]) * val, values[indices.sp])
  //       return `${data[0]}:${values.join(',')}`
  //     }).join('\n')

  //     newContent = newContent.replace(stylesMatch[1], stylesSection)
  //   }
  // }

  const eventsMatch = newContent.match(/(\[Events\][\s\S]*)/i)
  if (!eventsMatch) return newContent

  let eventsSection = eventsMatch[1]

  eventsSection = eventsSection.replace(posRegex, (m, x, y) => `\\pos(${formatValue(x * xnsize, x)},${formatValue(y * ynsize, y)})`)
  eventsSection = eventsSection.replace(/\\move\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?:\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+))?\s*\)/g, (m, x1, y1, x2, y2, t1, t2) => {
    const res = `\\move(${formatValue(x1 * xnsize, x1)},${formatValue(y1 * ynsize, y1)},${formatValue(x2 * xnsize, x2)},${formatValue(y2 * ynsize, y2)}`
    return t1 ? `${res},${t1},${t2})` : `${res})`
  })
  eventsSection = eventsSection.replace(orgRegex, (m, x, y) => `\\org(${formatValue(x * xnsize, x)},${formatValue(y * ynsize, y)})`)
  eventsSection = eventsSection.replace(/\\(i?clip)\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g, (m, type, x1, y1, x2, y2) =>
    `\\${type}(${formatValue(x1 * xnsize, x1)},${formatValue(y1 * ynsize, y1)},${formatValue(x2 * xnsize, x2)},${formatValue(y2 * ynsize, y2)})`)

  eventsSection = eventsSection.replace(/\\fs([\d.]+)/g, (m, s) => `\\fs${formatValue(parseFloat(s) * val1, s)}`)
  eventsSection = eventsSection.replace(/\\fscx([\d.]+)/g, (m, s) => `\\fscx${formatValue(parseFloat(s) * valFscx, s)}`)
  eventsSection = eventsSection.replace(/\\xbord([\d.]+)/g, (m, s) => `\\xbord${formatValue(parseFloat(s) * xnsize, s)}`)
  eventsSection = eventsSection.replace(/\\ybord([\d.]+)/g, (m, s) => `\\ybord${formatValue(parseFloat(s) * ynsize, s)}`)
  eventsSection = eventsSection.replace(/\\xshad(-?[\d.]+)/g, (m, s) => `\\xshad${formatValue(parseFloat(s) * xnsize, s)}`)
  eventsSection = eventsSection.replace(/\\yshad(-?[\d.]+)/g, (m, s) => `\\yshad${formatValue(parseFloat(s) * ynsize, s)}`)

  const minTags = ['fsp', 'bord', 'shad', 'be', 'blur']
  minTags.forEach(tag => {
    const rgx = new RegExp(`\\\\${tag}(-?[\\d.]+)`, 'g')
    eventsSection = eventsSection.replace(rgx, (m, s) => `\\${tag}${formatValue(parseFloat(s) * val, s)}`)
  })

  eventsSection = eventsSection.replace(/(\\i?clip\s*\([^,)]+m[^)]+\)|\\p[1-9][^}]*?)(?=[\\}]|$)/g, (match) => {
    return match.replace(/(-?[\d.]+)\s+(-?[\d.]+)/g, (m, x, y) => {
      return `${formatValue(parseFloat(x) * xnsize, x)} ${formatValue(parseFloat(y) * ynsize, y)}`
    })
  })

  return newContent.substring(0, eventsMatch.index) + eventsSection
}

const requestAnimationFrame = (() => {
  // similar to Browser.requestAnimationFrame
  let nextRAF = 0
  return (func) => {
    // try to keep target fps (30fps) between calls to here
    const now = Date.now()
    if (nextRAF === 0) {
      nextRAF = now + 1000 / targetFps
    } else {
      while (now + 2 >= nextRAF) {
        // fudge a little, to avoid timer jitter causing us to do lots of delay:0
        nextRAF += 1000 / targetFps
      }
    }
    const delay = Math.max(nextRAF - now, 0)
    return setTimeout(func, delay)
    // return setTimeout(func, 1);
  }
})()

const _applyKeys = (input, output) => {
  for (const v of Object.keys(input)) {
    output[v] = input[v]
  }
}
let offCanvas
let offCanvasCtx
let offscreenRender
let bufferCanvas
let bufferCtx
let jassubObj
let subtitleColorSpace
let dropAllBlur
let _malloc
let hasBitmapBug

self.init = async (data) => {
  hasBitmapBug = data.hasBitmapBug
  try {
    const wasmProbe = Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00)
    const module = await WebAssembly.compile(wasmProbe)
    const instance = await WebAssembly.instantiate(module)
    if (!(module instanceof WebAssembly.Module) || !(instance instanceof WebAssembly.Instance))
      throw new Error('WASM not supported')
  } catch (e) {
    console.warn(e)
    // load WASM2JS code if WASM is unsupported
    // eslint-disable-next-line no-eval
    eval(read_(data.legacyWasmUrl))
  }

  const _fetch = self.fetch
  const setWasmUrl = (wasmUrl) => {
    // @ts-ignore
    if (WebAssembly.instantiateStreaming) {
      self.fetch = (_) => _fetch(wasmUrl)
    }
  }

  const loadWasm = (wasmUrl) => {
    setWasmUrl(wasmUrl)
    return WASM({
      wasm: !WebAssembly.instantiateStreaming && read_(wasmUrl, true)
    })
  }

  const onWasmLoaded = (/** @type {EmscriptenModule} */ Module) => {
    _malloc = Module._malloc
    self.width = data.width
    self.height = data.height
    blendMode = data.blendMode
    asyncRender = data.asyncRender
    // Force fallback if engine does not support 'lossy' mode.
    // We only use createImageBitmap in the worker and historic WebKit versions supported
    // the API in the normal but not the worker scope, so we can't check this earlier.
    if (asyncRender && typeof createImageBitmap === 'undefined') {
      asyncRender = false
      console.error("'createImageBitmap' needed for 'asyncRender' unsupported!")
    }

    availableFonts = data.availableFonts
    debug = data.debug
    targetFps = data.targetFps || targetFps
    useLocalFonts = data.useLocalFonts
    dropAllBlur = data.dropAllBlur
    clampPos = data.clampPos

    const fallbackFont = data.fallbackFont.toLowerCase()
    jassubObj = new Module.JASSUB(self.width, self.height, fallbackFont || null, debug)

    if (fallbackFont) findAvailableFonts(fallbackFont)

    let subContent = data.subContent
    if (!subContent) subContent = read_(data.subUrl)

    processAvailableFonts(subContent)
    if (clampPos) subContent = fixPlayRes(subContent)
    if (dropAllBlur) subContent = dropBlur(subContent)

    for (const font of data.fonts || []) asyncWrite(font)

    jassubObj.createTrackMem(subContent)

    subtitleColorSpace = libassYCbCrMap[jassubObj.trackColorSpace]

    jassubObj.setDropAnimations(data.dropAllAnimations || 0)

    if (data.libassMemoryLimit > 0 || data.libassGlyphLimit > 0) {
      jassubObj.setMemoryLimits(data.libassGlyphLimit || 0, data.libassMemoryLimit || 0)
    }

    postMessage({ target: 'ready' })
    postMessage({ target: 'verifyColorSpace', subtitleColorSpace })
  }

  loadWasm(data.wasmUrl)
    .then(onWasmLoaded)
    .catch((e) => {
      if (data.fallbackWasmUrl && data.fallbackWasmUrl !== data.wasmUrl) {
        console.warn('Failed to load selected WASM, falling back', e)
        return loadWasm(data.fallbackWasmUrl).then(onWasmLoaded)
      }
      throw e
    })
}

self.offscreenCanvas = ({ transferable }) => {
  offCanvas = transferable[0]
  offCanvasCtx = offCanvas.getContext('2d')
  if (!asyncRender) {
    bufferCanvas = new OffscreenCanvas(self.height, self.width)
    bufferCtx = bufferCanvas.getContext('2d', { desynchronized: true })
  }
  offscreenRender = true
}

self.detachOffscreen = () => {
  offCanvas = new OffscreenCanvas(self.height, self.width)
  offCanvasCtx = offCanvas.getContext('2d', { desynchronized: true })
  offscreenRender = 'hybrid'
}

self.canvas = ({ width, height, videoWidth, videoHeight, force }) => {
  if (width == null) throw new Error('Invalid canvas size specified')
  self.width = width
  self.height = height
  if (jassubObj) jassubObj.resizeCanvas(width, height, videoWidth, videoHeight)
  if (force) render(lastCurrentTime, true)
}

self.video = ({ currentTime, isPaused, rate }) => {
  if (currentTime != null) setCurrentTime(currentTime)
  if (isPaused != null) setIsPaused(isPaused)
  rate = rate || rate
}

self.destroy = () => {
  jassubObj.quitLibrary()
}

self.createEvent = ({ event }) => {
  _applyKeys(event, jassubObj.getEvent(jassubObj.allocEvent()))
}

self.getEvents = () => {
  const events = []
  for (let i = 0; i < jassubObj.getEventCount(); i++) {
    const { Start, Duration, ReadOrder, Layer, Style, MarginL, MarginR, MarginV, Name, Text, Effect } =
      jassubObj.getEvent(i)
    events.push({
      Start,
      Duration,
      ReadOrder,
      Layer,
      Style,
      MarginL,
      MarginR,
      MarginV,
      Name,
      Text,
      Effect
    })
  }
  postMessage({
    target: 'getEvents',
    events
  })
}

self.setEvent = ({ event, index }) => {
  _applyKeys(event, jassubObj.getEvent(index))
}

self.removeEvent = ({ index }) => {
  jassubObj.removeEvent(index)
}

self.createStyle = ({ style }) => {
  const alloc = jassubObj.getStyle(jassubObj.allocStyle())
  _applyKeys(style, alloc)
  return alloc
}

self.getStyles = () => {
  const styles = []
  for (let i = 0; i < jassubObj.getStyleCount(); i++) {
    // eslint-disable-next-line camelcase
    const {
      Name,
      FontName,
      FontSize,
      PrimaryColour,
      SecondaryColour,
      OutlineColour,
      BackColour,
      Bold,
      Italic,
      Underline,
      StrikeOut,
      ScaleX,
      ScaleY,
      Spacing,
      Angle,
      BorderStyle,
      Outline,
      Shadow,
      Alignment,
      MarginL,
      MarginR,
      MarginV,
      Encoding,
      treat_fontname_as_pattern,
      Blur,
      Justify
    } = jassubObj.getStyle(i)
    // eslint-disable-next-line camelcase
    styles.push({
      Name,
      FontName,
      FontSize,
      PrimaryColour,
      SecondaryColour,
      OutlineColour,
      BackColour,
      Bold,
      Italic,
      Underline,
      StrikeOut,
      ScaleX,
      ScaleY,
      Spacing,
      Angle,
      BorderStyle,
      Outline,
      Shadow,
      Alignment,
      MarginL,
      MarginR,
      MarginV,
      Encoding,
      treat_fontname_as_pattern,
      Blur,
      Justify
    })
  }
  postMessage({
    target: 'getStyles',
    time: Date.now(),
    styles
  })
}

self.setStyle = ({ style, index }) => {
  _applyKeys(style, jassubObj.getStyle(index))
}

self.removeStyle = ({ index }) => {
  jassubObj.removeStyle(index)
}

self.styleOverride = (data) => {
  jassubObj.styleOverride(self.createStyle(data))
}

self.disableStyleOverride = () => {
  jassubObj.disableStyleOverride()
}

self.defaultFont = ({ font }) => {
  jassubObj.setDefaultFont(font)
}

// Performance metrics API
self.getStats = () => {
  const avgRenderTime = metrics.framesRendered > 0 ? metrics.totalRenderTime / metrics.framesRendered : 0

  postMessage({
    target: 'getStats',
    stats: {
      framesRendered: metrics.framesRendered,
      framesDropped: metrics.framesDropped,
      avgRenderTime: Math.round(avgRenderTime * 100) / 100,
      maxRenderTime: Math.round(metrics.maxRenderTime * 100) / 100,
      minRenderTime: metrics.minRenderTime === Infinity ? 0 : Math.round(metrics.minRenderTime * 100) / 100,
      lastRenderTime: Math.round(metrics.lastRenderTime * 100) / 100,
      pendingRenders: Math.max(0, metrics.pendingRenders),
      totalEvents: metrics.totalEvents,
      cacheHits: metrics.cacheHits,
      cacheMisses: metrics.cacheMisses
    }
  })
}

self.resetStats = () => {
  resetMetrics()
  postMessage({ target: 'resetStats', success: true })
}

onmessage = ({ data }) => {
  if (self[data.target]) {
    self[data.target](data)
  } else {
    throw new Error('Unknown event target ' + data.target)
  }
}
