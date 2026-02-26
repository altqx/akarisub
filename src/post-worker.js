/* eslint-disable no-global-assign, no-unused-vars, prefer-const */

// Emscripten MINIMAL_RUNTIME keeps heap views (`HEAPU8`, etc.) and `_malloc`/`_free` as local vars.
// The JS worker glue expects `Module._malloc` and `self.HEAPU8`/`self.HEAPU8C`.

const __akarisub_sync_heap = () => {
  try {
    if (typeof wasmMemory !== 'undefined') {
      self.wasmMemory = wasmMemory
      self.HEAPU8C = new Uint8ClampedArray(wasmMemory.buffer)
      // BigInt64 views required for filesystem operations (stat, readdir, seek)
      if (typeof BigInt64Array !== 'undefined') {
        self.HEAP64 = new BigInt64Array(wasmMemory.buffer)
        self.HEAPU64 = new BigUint64Array(wasmMemory.buffer)
      }
    }
    if (typeof HEAPU8 !== 'undefined') {
      self.HEAPU8 = HEAPU8
    }
    // Sync HEAP64 from Emscripten's local variable if available
    if (typeof HEAP64 !== 'undefined') {
      self.HEAP64 = HEAP64
    }
    if (typeof HEAPU64 !== 'undefined') {
      self.HEAPU64 = HEAPU64
    }
  } catch (_) {
    // older engines or differing builds may not have all symbols.
  }
}

// Keep self.HEAP* in sync on memory growth.
if (typeof updateGlobalBufferAndViews === 'function') {
  const __akarisub_updateGlobalBufferAndViews = updateGlobalBufferAndViews
  // eslint-disable-next-line no-global-assign
  updateGlobalBufferAndViews = (b) => {
    __akarisub_updateGlobalBufferAndViews(b)
    __akarisub_sync_heap()
  }
}

// Emscripten 4.x uses updateMemoryViews instead of updateGlobalBufferAndViews
if (typeof updateMemoryViews === 'function') {
  const __akarisub_updateMemoryViews = updateMemoryViews
  // eslint-disable-next-line no-global-assign
  updateMemoryViews = () => {
    __akarisub_updateMemoryViews()
    __akarisub_sync_heap()
  }
}

// Expose `_malloc`/`_free`, FS functions, and initial heap views when the module becomes ready.
const __akarisub_ready = typeof ready === 'function' ? ready : null
if (__akarisub_ready) {
  // eslint-disable-next-line no-global-assign
  ready = () => {
    Module._malloc = _malloc
    Module._free = _free
    if (typeof FS !== 'undefined') {
      Module.FS_createPath = FS.createPath
      Module.FS_createDataFile = FS.createDataFile
    }
    __akarisub_sync_heap()
    return __akarisub_ready()
  }
}
