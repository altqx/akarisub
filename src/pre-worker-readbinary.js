/* eslint-disable no-unused-vars */

// MINIMAL_RUNTIME does not emit readBinary. The default pthread runtime does,
// so this file is only --pre-js'd into the single-thread worker.

function readBinary(url) {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, false)
  xhr.responseType = 'arraybuffer'
  if (xhr.overrideMimeType) {
    xhr.overrideMimeType('text/plain; charset=x-user-defined')
  }
  xhr.send(null)

  if (!((xhr.status >= 200 && xhr.status < 300) || xhr.status === 304 || xhr.status === 0)) {
    throw new Error(`Failed to load ${url}: ${xhr.status}`)
  }

  return new Uint8Array(xhr.response || [])
}
