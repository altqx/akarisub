/* eslint-disable no-global-assign, no-unused-vars, prefer-const, no-extend-native */
/* global out, err, wasmMemory */

function assert(c, m) {
  if (!c) throw m
}

let asm = null

// WASI syscall stubs for fontconfig compatibility
// These are needed when FILESYSTEM=0 but fontconfig/libass makes filesystem calls
// We provide stub implementations that gracefully fail
var SYSCALLS = {
  buffers: [null, [], []],
  printChar: function(stream, curr) {
    var buffer = SYSCALLS.buffers[stream]
    if (curr === 0 || curr === 10) {
      (stream === 1 ? console.log : console.error)(
        buffer.map(c => String.fromCharCode(c)).join('')
      )
      buffer.length = 0
    } else {
      buffer.push(curr)
    }
  },
  varargs: undefined,
  get: function() {
    // This would normally read varargs from the stack
    // For stubbed syscalls, we return 0
    return 0
  },
  getStr: function(ptr) {
    // We need to read strings from WASM memory
    // This will be set up properly when memory is initialized
    if (typeof UTF8ToString === 'function') {
      return UTF8ToString(ptr)
    }
    // Fallback for early calls
    return ''
  },
  get64: function(low, high) {
    return low
  },
  // Resolve a path relative to a directory file descriptor
  // When dirfd is AT_FDCWD (-100), use path as-is
  calculateAt: function(dirfd, path) {
    // AT_FDCWD = -100, just return the path as-is
    // For our stub, we just return the path since there's no real filesystem
    return path
  },
  // Check file access permissions - always return -1 (ENOENT) since we have no filesystem
  doAccess: function(path, amode) {
    return -2 // -ENOENT (No such file or directory)
  },
  // Create directory - always return -1 (EROFS) since we have no filesystem
  doMkdir: function(path, mode) {
    return -30 // -EROFS (read-only filesystem)
  },
  // Read symbolic link - always return -1 (ENOENT) since we have no filesystem  
  doReadlink: function(path, buf, bufsize) {
    return -2 // -ENOENT (No such file or directory)
  },
  // Stat syscall - return error
  doStat: function(func, path, buf) {
    return -2 // -ENOENT
  },
  // Open syscall - return error  
  doOpen: function(path, flags, mode) {
    return -2 // -ENOENT
  }
}

out = (text) => {
  // Suppress expected fontconfig warnings when running without filesystem
  if (text === 'JASSUB: No usable fontconfig configuration file found, using fallback.' ||
      text.startsWith('Unable to revert mtime:') ||
      text.trim() === '') {
    console.debug(text)
  } else {
    console.log(text)
  }
}

err = (text) => {
  // Suppress expected fontconfig errors when running without filesystem
  if (text === 'Fontconfig error: Cannot load default config file: No such file: (null)' ||
      text === 'Fontconfig error: Cannot load default config file: File not found' ||
      text === 'Fontconfig error: No writable cache directories' ||
      text.includes('/var/cache/fontconfig') ||
      text.includes('/.cache/fontconfig') ||
      text.includes('/.local/share/fonts')) {
    console.debug(text)
  } else {
    console.error(text)
  }
}

var updateMemoryViews = typeof updateMemoryViews === 'function' ? updateMemoryViews : function () {}

// patch EMS function to include Uint8Clamped, but call old function too
updateMemoryViews = ((_super) => {
  return () => {
    if (typeof _super === 'function') _super()
    self.wasmMemory = wasmMemory
    self.HEAPU8C = new Uint8ClampedArray(wasmMemory.buffer)
    self.HEAPU8 = new Uint8Array(wasmMemory.buffer)
  }
})(updateMemoryViews)
