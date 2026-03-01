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

// Expose `_malloc`/`_free`, FS functions, all akarisub C exports, and initial heap views
// when the module becomes ready.
const __akarisub_ready = typeof ready === 'function' ? ready : null
if (__akarisub_ready) {
  // eslint-disable-next-line no-global-assign
  ready = () => {
    Module._malloc = _malloc
    Module._free = _free
    Module._akarisub_create = _akarisub_create
    Module._akarisub_destroy = _akarisub_destroy
    Module._akarisub_set_drop_animations = _akarisub_set_drop_animations
    Module._akarisub_create_track_mem = _akarisub_create_track_mem
    Module._akarisub_remove_track = _akarisub_remove_track
    Module._akarisub_resize_canvas = _akarisub_resize_canvas
    Module._akarisub_add_font = _akarisub_add_font
    Module._akarisub_reload_fonts = _akarisub_reload_fonts
    Module._akarisub_set_default_font = _akarisub_set_default_font
    Module._akarisub_set_fallback_fonts = _akarisub_set_fallback_fonts
    Module._akarisub_set_memory_limits = _akarisub_set_memory_limits
    Module._akarisub_get_event_count = _akarisub_get_event_count
    Module._akarisub_alloc_event = _akarisub_alloc_event
    Module._akarisub_remove_event = _akarisub_remove_event
    Module._akarisub_get_style_count = _akarisub_get_style_count
    Module._akarisub_alloc_style = _akarisub_alloc_style
    Module._akarisub_remove_style = _akarisub_remove_style
    Module._akarisub_style_override_index = _akarisub_style_override_index
    Module._akarisub_disable_style_override = _akarisub_disable_style_override
    Module._akarisub_render_blend = _akarisub_render_blend
    Module._akarisub_render_image = _akarisub_render_image
    Module._akarisub_get_changed = _akarisub_get_changed
    Module._akarisub_get_count = _akarisub_get_count
    Module._akarisub_get_time = _akarisub_get_time
    Module._akarisub_get_track_color_space = _akarisub_get_track_color_space
    Module._akarisub_event_get_int = _akarisub_event_get_int
    Module._akarisub_event_set_int = _akarisub_event_set_int
    Module._akarisub_event_get_str = _akarisub_event_get_str
    Module._akarisub_event_set_str = _akarisub_event_set_str
    Module._akarisub_style_get_num = _akarisub_style_get_num
    Module._akarisub_style_set_num = _akarisub_style_set_num
    Module._akarisub_style_get_str = _akarisub_style_get_str
    Module._akarisub_style_set_str = _akarisub_style_set_str
    Module._akarisub_render_result_x = _akarisub_render_result_x
    Module._akarisub_render_result_y = _akarisub_render_result_y
    Module._akarisub_render_result_w = _akarisub_render_result_w
    Module._akarisub_render_result_h = _akarisub_render_result_h
    Module._akarisub_render_result_image = _akarisub_render_result_image
    Module._akarisub_render_result_next = _akarisub_render_result_next
    Module._akarisub_render_result_collect = _akarisub_render_result_collect
    Module._akarisub_render_blend_collect = _akarisub_render_blend_collect
    Module._akarisub_render_image_collect = _akarisub_render_image_collect
    if (typeof FS !== 'undefined') {
      Module.FS_createPath = FS.createPath
      Module.FS_createDataFile = FS.createDataFile
    }
    __akarisub_sync_heap()
    return __akarisub_ready()
  }
}
