export interface FontReloadScheduler {
  /** Coalesce font writes into one reload after delayMs. */
  schedule(): void
  /** Run a pending reload now; does nothing when no reload is pending. */
  flush(): void
}

export const createFontReloadScheduler = (reload: () => void, delayMs = 16): FontReloadScheduler => {
  let pending: ReturnType<typeof setTimeout> | null = null
  return {
    schedule: () => {
      if (pending) return
      pending = setTimeout(() => {
        pending = null
        reload()
      }, delayMs)
    },
    flush: () => {
      if (!pending) return
      clearTimeout(pending)
      pending = null
      reload()
    }
  }
}
