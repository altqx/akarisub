/* eslint-disable no-global-assign, no-unused-vars, prefer-const */
/* global out, err, wasmMemory */

function assert(c, m) {
  if (!c) throw m
}

let asm = null

// Suppress expected fontconfig warnings/errors in console
out = (text) => {
  if (text === 'JASSUB: No usable fontconfig configuration file found, using fallback.' ||
      text.startsWith('Unable to revert mtime:') ||
      text.trim() === '') {
    console.debug(text)
  } else {
    console.log(text)
  }
}

err = (text) => {
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