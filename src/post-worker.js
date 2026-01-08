/* eslint-disable no-global-assign, no-unused-vars, prefer-const */

// Emscripten MINIMAL_RUNTIME keeps heap views (`HEAPU8`, etc.) and `_malloc`/`_free` as local vars.
// The JS worker glue expects `Module._malloc` and `self.HEAPU8`/`self.HEAPU8C`.

const __jassub_sync_heap = () => {
  try {
    if (typeof wasmMemory !== 'undefined') {
      self.wasmMemory = wasmMemory
      self.HEAPU8C = new Uint8ClampedArray(wasmMemory.buffer)
    }
    if (typeof HEAPU8 !== 'undefined') {
      self.HEAPU8 = HEAPU8
    }
  } catch (_) {
    // older engines or differing builds may not have all symbols.
  }
}

// Keep self.HEAP* in sync on memory growth.
if (typeof updateGlobalBufferAndViews === 'function') {
  const __jassub_updateGlobalBufferAndViews = updateGlobalBufferAndViews
  // eslint-disable-next-line no-global-assign
  updateGlobalBufferAndViews = (b) => {
    __jassub_updateGlobalBufferAndViews(b)
    __jassub_sync_heap()
  }
}

// Expose `_malloc`/`_free` and initial heap views when the module becomes ready.
const __jassub_ready = typeof ready === 'function' ? ready : null
if (__jassub_ready) {
  // eslint-disable-next-line no-global-assign
  ready = () => {
    Module._malloc = _malloc
    Module._free = _free
    __jassub_sync_heap()
    return __jassub_ready()
  }
}
