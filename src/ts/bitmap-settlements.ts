export interface ClosableBitmap {
  close(): void
}

export type BitmapFailureAction =
  { kind: 'retryWithoutOptions' } | { kind: 'finishDemand' } | { kind: 'failPreparedFrame'; prepareId: number }

export const bitmapFailureAction = (
  bitmapOptionsEnabled: boolean,
  prepareId: number | null | undefined
): BitmapFailureAction => {
  if (bitmapOptionsEnabled) return { kind: 'retryWithoutOptions' }
  return prepareId == null ? { kind: 'finishDemand' } : { kind: 'failPreparedFrame', prepareId }
}

export const collectSettledBitmaps = <T extends ClosableBitmap>(
  results: readonly PromiseSettledResult<T>[]
): T[] | null => {
  const bitmaps: T[] = []
  let failed = false

  for (const result of results) {
    if (result.status === 'fulfilled') {
      bitmaps.push(result.value)
    } else {
      failed = true
    }
  }

  if (!failed) return bitmaps

  for (const bitmap of bitmaps) bitmap.close()
  return null
}
