/**
 * TextureCache - GPU Texture Management with LRU Eviction
 * 
 * Manages GPU textures for timeline layers with automatic caching,
 * source-key validation, and LRU (Least Recently Used) eviction.
 */

interface CachedTexture {
  texture: GPUTexture
  view: GPUTextureView
  lastUsed: number
  width: number
  height: number
  sourceKey?: string
}

type TextureSource = HTMLImageElement | ImageBitmap | HTMLCanvasElement | OffscreenCanvas

export class TextureCache {
  private cache: Map<string, CachedTexture> = new Map()
  private device: GPUDevice
  private maxCacheSize: number

  constructor(device: GPUDevice, maxCacheSize: number = 100) {
    this.device = device
    this.maxCacheSize = maxCacheSize
  }

  /**
   * Load an image into a GPU texture, using cache if available
   */
  loadImage(id: string, source: TextureSource, sourceKey?: string): GPUTexture {
    const key =
      sourceKey ??
      (typeof (source as any)?.src === 'string' ? (source as any).src : undefined)
    // Check cache first, but verify the cached texture matches the source
    if (this.cache.has(id)) {
      const cached = this.cache.get(id)!
      const width = Math.max(1, Math.floor((source as any).width || 1))
      const height = Math.max(1, Math.floor((source as any).height || 1))

      // If cached texture dimensions match source, reuse it.
      if (cached.width === width && cached.height === height) {
        cached.lastUsed = Date.now()

        // If source key differs (e.g. canvas updated), update contents in-place.
        if (cached.sourceKey !== key) {
          this.device.queue.copyExternalImageToTexture(
            { source: source as any },
            { texture: cached.texture },
            { width, height, depthOrArrayLayers: 1 }
          )
          cached.sourceKey = key
        }

        return cached.texture
      }

      // Dimensions changed, destroy and recreate.
      cached.texture.destroy()
      this.cache.delete(id)
    }

    // Evict old textures if cache is full
    this.evictLRU()

    // Create new texture
    const texture = this.createTextureFromImage(source)
    const view = texture.createView()

    this.cache.set(id, {
      texture,
      view,
      lastUsed: Date.now(),
      width: source.width,
      height: source.height,
      sourceKey: key
    })

    return texture
  }

  /**
   * Get a cached texture view
   */
  getView(id: string): GPUTextureView | null {
    const cached = this.cache.get(id)
    if (cached) {
      cached.lastUsed = Date.now()
      return cached.view
    }
    return null
  }

  /**
   * Create a GPU texture from an image source
   */
  private createTextureFromImage(
    source: TextureSource
  ): GPUTexture {
    // Ensure width and height are valid numbers
    const width = Math.max(1, Math.floor((source as any).width || 1))
    const height = Math.max(1, Math.floor((source as any).height || 1))
    
    const texture = this.device.createTexture({
      size: {
        width: width,
        height: height,
        depthOrArrayLayers: 1
      },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT
    })

    // Copy image data to texture
    this.device.queue.copyExternalImageToTexture(
      { source: source as any },
      { texture },
      {
        width: width,
        height: height,
        depthOrArrayLayers: 1
      }
    )

    return texture
  }

  /**
   * Release a cached texture
   */
  release(id: string): void {
    this.evict(id)
  }

  /**
   * Evict least recently used texture when cache is full
   */
  private evictLRU(): void {
    if (this.cache.size < this.maxCacheSize) {
      return
    }

    let oldestId: string | null = null
    let oldestTime = Infinity

    // Find the least recently used texture
    for (const [id, cached] of this.cache) {
      if (cached.lastUsed < oldestTime) {
        oldestTime = cached.lastUsed
        oldestId = id
      }
    }

    // Evict if found
    if (oldestId) {
      const cached = this.cache.get(oldestId)!
      cached.texture.destroy()
      this.cache.delete(oldestId)
      console.log(`[TextureCache] Evicted texture: ${oldestId}`)
    } else {
      console.warn('[TextureCache] Cache full but no textures can be evicted')
    }
  }

  /**
   * Check if a texture is cached
   */
  has(id: string): boolean {
    return this.cache.has(id)
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      activeTextures: this.cache.size,
      totalRefCount: this.cache.size
    }
  }

  /**
   * Clean up all textures
   */
  cleanup(): void {
    for (const [id, cached] of this.cache) {
      cached.texture.destroy()
    }
    this.cache.clear()
    console.log('[TextureCache] Cleaned up all textures')
  }

  /**
   * Force evict a specific texture
   */
  evict(id: string): boolean {
    const cached = this.cache.get(id)
    if (cached) {
      cached.texture.destroy()
      this.cache.delete(id)
      return true
    }
    return false
  }

  /**
   * Update max cache size
   */
  setMaxCacheSize(size: number): void {
    this.maxCacheSize = size
    // Evict excess textures if needed
    while (this.cache.size > this.maxCacheSize) {
      this.evictLRU()
    }
  }
}
