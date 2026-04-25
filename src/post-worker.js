/* eslint-disable no-global-assign, no-unused-vars, prefer-const */

// Emscripten MINIMAL_RUNTIME keeps heap views (`HEAPU8`, etc.) and `_malloc`/`_free` as local vars.
// The JS worker glue expects `Module._malloc` and `self.HEAPU8`/`self.HEAPU8C`.

const __akarisub_sync_heap = () => {
  try {
    if (typeof wasmMemory !== 'undefined') {
      self['wasmMemory'] = wasmMemory
      self['HEAPU8C'] = new Uint8ClampedArray(wasmMemory.buffer)
      // BigInt64 views required for filesystem operations (stat, readdir, seek)
      if (typeof BigInt64Array !== 'undefined') {
        self['HEAP64'] = new BigInt64Array(wasmMemory.buffer)
        self['HEAPU64'] = new BigUint64Array(wasmMemory.buffer)
      }
    }
    if (typeof HEAPU8 !== 'undefined') {
      self['HEAPU8'] = HEAPU8
    }
    // Sync HEAP64 from Emscripten's local variable if available
    if (typeof HEAP64 !== 'undefined') {
      self['HEAP64'] = HEAP64
    }
    if (typeof HEAPU64 !== 'undefined') {
      self['HEAPU64'] = HEAPU64
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
    Object.assign(Module, {
      '_malloc': _malloc,
      '_free': _free,
      '_akarisub_create': _akarisub_create,
      '_akarisub_destroy': _akarisub_destroy,
      '_akarisub_set_drop_animations': _akarisub_set_drop_animations,
      '_akarisub_create_track_mem': _akarisub_create_track_mem,
      '_akarisub_remove_track': _akarisub_remove_track,
      '_akarisub_resize_canvas': _akarisub_resize_canvas,
      '_akarisub_add_font': _akarisub_add_font,
      '_akarisub_reload_fonts': _akarisub_reload_fonts,
      '_akarisub_set_default_font': _akarisub_set_default_font,
      '_akarisub_set_fallback_fonts': _akarisub_set_fallback_fonts,
      '_akarisub_set_memory_limits': _akarisub_set_memory_limits,
      '_akarisub_get_event_count': _akarisub_get_event_count,
      '_akarisub_alloc_event': _akarisub_alloc_event,
      '_akarisub_remove_event': _akarisub_remove_event,
      '_akarisub_get_style_count': _akarisub_get_style_count,
      '_akarisub_alloc_style': _akarisub_alloc_style,
      '_akarisub_remove_style': _akarisub_remove_style,
      '_akarisub_style_override_index': _akarisub_style_override_index,
      '_akarisub_disable_style_override': _akarisub_disable_style_override,
      '_akarisub_get_track_color_space': _akarisub_get_track_color_space,
      '_akarisub_event_get_int': _akarisub_event_get_int,
      '_akarisub_event_set_int': _akarisub_event_set_int,
      '_akarisub_event_get_str': _akarisub_event_get_str,
      '_akarisub_event_set_str': _akarisub_event_set_str,
      '_akarisub_style_get_num': _akarisub_style_get_num,
      '_akarisub_style_set_num': _akarisub_style_set_num,
      '_akarisub_style_get_str': _akarisub_style_get_str,
      '_akarisub_style_set_str': _akarisub_style_set_str,
      '_akarisub_render_blend_collect': _akarisub_render_blend_collect,
      '_akarisub_render_image_collect': _akarisub_render_image_collect,
      '_akarisub_render_hb_gpu_collect': _akarisub_render_hb_gpu_collect,
      '_akarisub_hb_gpu_shader_source': _akarisub_hb_gpu_shader_source
    })
    if (typeof FS !== 'undefined') {
      Module['FS_createPath'] = FS.createPath
      Module['FS_createDataFile'] = FS.createDataFile
    }
    __akarisub_sync_heap()
    return __akarisub_ready()
  }
}
