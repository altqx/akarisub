/** Largest texture-array allocation any compositor may request. */
export const MAX_GPU_TEXTURE_ARRAY_BYTES = 256 * 1024 * 1024

/** Round up to a multiple of 64, matching the renderers' allocation granularity. */
export const roundTextureDim = (n: number): number => (Math.max(n, 64) + 63) & ~63

/**
 * Layers that fit the byte budget when every layer is `width` x `height`
 * (rounded as allocated). Zero means even one layer is over budget and the
 * caller must refuse the frame before allocating.
 */
export const textureArrayLayerCap = (
  width: number,
  height: number,
  bytesPerPixel: number,
  hardLayerLimit: number
): number => {
  const layerBytes = roundTextureDim(width) * roundTextureDim(height) * bytesPerPixel
  if (!Number.isFinite(layerBytes) || layerBytes <= 0) return 0
  return Math.min(hardLayerLimit, Math.floor(MAX_GPU_TEXTURE_ARRAY_BYTES / layerBytes))
}
