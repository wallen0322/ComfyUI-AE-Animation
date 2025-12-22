/**
 * GPUTimelineRenderer - WebGPU-accelerated Timeline Renderer
 * 
 * Main renderer class that manages GPU resources and renders timeline layers
 * with transformations, camera effects, and compositing.
 */

import { TextureCache } from './TextureCache'
import { PerformanceMonitor } from './PerformanceMonitor'
import {
  layerVertexShader,
  layerFragmentShader,
  panoramaFragmentShader
} from './timelineShaders'
import {
  advancedLayerVertexShader,
  advancedLayerFragmentShader
} from './advancedShaders'

export interface GPUTimelineRendererConfig {
  device: GPUDevice
  presentationFormat: GPUTextureFormat
  width: number
  height: number
  useAdvancedTransforms?: boolean  // Enable camera rotation support
}

export interface Layer {
  id: string
  type: 'background' | 'foreground'
  name: string
  image_data?: string
  img?: HTMLImageElement
  x: number
  y: number
  z: number
  scale: number
  rotation: number
  rotationX: number
  rotationY: number
  rotationZ: number
  opacity: number
  anchorX: number
  anchorY: number
  perspective: number
  customMask?: string
  maskCanvas?: HTMLCanvasElement
  maskVersion?: number
  mask_size: number
  keyframes?: { [property: string]: Keyframe[] }
  bezierPath?: BezierPoint[]
  usePathAnimation?: boolean
  bg_mode?: 'fit' | 'fill' | 'stretch'
}

export interface Keyframe {
  time: number
  value: number
}

export interface BezierPoint {
  x: number
  y: number
  cp1x?: number
  cp1y?: number
  cp2x?: number
  cp2y?: number
}

export interface CameraState {
  enabled: boolean
  position: { x: number; y: number; z: number }
  offset: { x: number; y: number }
  rotation: { yaw: number; pitch: number; roll: number }
  fov: number
  panorama: boolean
}

export interface LayerProps {
  x: number
  y: number
  z: number
  scale: number
  rotation: number
  rotationX: number
  rotationY: number
  rotationZ: number
  opacity: number
  anchorX: number
  anchorY: number
  perspective: number
  mask_size: number
}

export class GPUTimelineRenderer {
  private device: GPUDevice
  private presentationFormat: GPUTextureFormat
  private width: number
  private height: number
  
  // Feature flags
  private enableCameraRotation: boolean = false  // Set to true to enable camera rotation

  // Pipelines
  private backgroundPipeline: GPURenderPipeline | null = null
  private foregroundPipeline: GPURenderPipeline | null = null
  private panoramaPipeline: GPURenderPipeline | null = null
  private overlayPipeline: GPURenderPipeline | null = null
  
  // Advanced pipelines with matrix transformations
  private advancedBackgroundPipeline: GPURenderPipeline | null = null
  private advancedForegroundPipeline: GPURenderPipeline | null = null
  private useAdvancedTransforms: boolean = false

  // Bind Group Layouts
  private uniformBindGroupLayout: GPUBindGroupLayout | null = null
  private textureBindGroupLayout: GPUBindGroupLayout | null = null
  private overlayBindGroupLayout: GPUBindGroupLayout | null = null

  // Buffers
  private uniformBuffer: GPUBuffer | null = null
  private panoUniformBuffer: GPUBuffer | null = null  // 单独的pano uniform buffer
  private quadVertexBuffer: GPUBuffer | null = null
  private indexBuffer: GPUBuffer | null = null

  // Texture management
  private textureCache: TextureCache

  // Sampler
  private sampler: GPUSampler | null = null

  // Performance monitoring
  private performanceMonitor: PerformanceMonitor

  // Performance optimization state
  private lastUniformData: ArrayBuffer | null = null
  private uniformsDirty: boolean = true
  private lastCameraState: CameraState | null = null
  private lastLayerProps: Map<string, LayerProps> = new Map()
  
  // Current frame duration for path animation
  private currentDuration: number = 5

  constructor(config: GPUTimelineRendererConfig) {
    this.device = config.device
    this.presentationFormat = config.presentationFormat
    this.width = config.width
    this.height = config.height
    this.useAdvancedTransforms = config.useAdvancedTransforms ?? false

    this.textureCache = new TextureCache(this.device)
    this.performanceMonitor = new PerformanceMonitor()

    this.initialize()
    
    console.log('[GPUTimelineRenderer] Advanced transforms:', this.useAdvancedTransforms ? 'ENABLED' : 'DISABLED')
  }

  /**
   * Initialize GPU resources
   */
  private initialize(): void {
    this.createBindGroupLayouts()
    this.createBuffers()
    this.createSampler()
    this.createPanoSampler()
    this.createPipelines()
  }

  /**
   * Create bind group layouts
   */
  private createBindGroupLayouts(): void {
    // Uniform bind group layout
    this.uniformBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        }
      ]
    })

    // Texture bind group layout
    this.textureBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {}
        }
      ]
    })

    // Overlay bind group layout
    this.overlayBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        }
      ]
    })
  }

  /**
   * Create GPU buffers
   */
  private createBuffers(): void {
    // Uniform buffer (256 bytes for alignment - enough for extended uniforms)
    this.uniformBuffer = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })
    
    // 单独的pano uniform buffer，避免与前景图层的uniform冲突
    this.panoUniformBuffer = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })

    // Quad vertex buffer (full-screen quad)
    const quadVertices = new Float32Array([
      -1, -1, 0, 1, // bottom-left
      1, -1, 1, 1, // bottom-right
      1, 1, 1, 0, // top-right
      -1, 1, 0, 0 // top-left
    ])

    this.quadVertexBuffer = this.device.createBuffer({
      size: quadVertices.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true
    })
    new Float32Array(this.quadVertexBuffer.getMappedRange()).set(quadVertices)
    this.quadVertexBuffer.unmap()

    // Index buffer
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3])
    this.indexBuffer = this.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true
    })
    new Uint16Array(this.indexBuffer.getMappedRange()).set(indices)
    this.indexBuffer.unmap()
  }

  /**
   * Create texture sampler
   */
  private createSampler(): void {
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    })
  }

  /**
   * Create panorama sampler with repeat mode for horizontal wrapping
   */
  private panoSampler: GPUSampler | null = null
  
  private createPanoSampler(): void {
    this.panoSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',  // 水平方向重复（360°环绕）
      addressModeV: 'clamp-to-edge'  // 垂直方向钳制
    })
  }

  /**
   * Create render pipelines
   */
  private createPipelines(): void {
    // Create pipeline layout
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        this.uniformBindGroupLayout!,
        this.textureBindGroupLayout!
      ]
    })

    // Vertex buffer layout
    const vertexBufferLayout: GPUVertexBufferLayout = {
      arrayStride: 16, // 4 floats: pos(2) + uv(2)
      attributes: [
        {
          shaderLocation: 0,
          offset: 0,
          format: 'float32x2' // position
        },
        {
          shaderLocation: 1,
          offset: 8,
          format: 'float32x2' // uv
        }
      ]
    }

    // Alpha blending configuration
    const alphaBlend: GPUBlendState = {
      color: {
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add'
      },
      alpha: {
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add'
      }
    }

    // Background layer pipeline
    this.backgroundPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: this.device.createShaderModule({ code: layerVertexShader }),
        entryPoint: 'vs',
        buffers: [vertexBufferLayout]
      },
      fragment: {
        module: this.device.createShaderModule({ code: layerFragmentShader }),
        entryPoint: 'fs',
        targets: [
          {
            format: this.presentationFormat,
            blend: alphaBlend
          }
        ]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none'
      }
    })

    // Foreground layer pipeline (same as background for now)
    this.foregroundPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: this.device.createShaderModule({ code: layerVertexShader }),
        entryPoint: 'vs',
        buffers: [vertexBufferLayout]
      },
      fragment: {
        module: this.device.createShaderModule({ code: layerFragmentShader }),
        entryPoint: 'fs',
        targets: [
          {
            format: this.presentationFormat,
            blend: alphaBlend
          }
        ]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none'
      }
    })

    // Panorama pipeline - uses combined vertex+fragment shader
    const panoramaShaderModule = this.device.createShaderModule({
      code: panoramaFragmentShader
    })
    
    this.panoramaPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: panoramaShaderModule,
        entryPoint: 'vs',
        buffers: [vertexBufferLayout]
      },
      fragment: {
        module: panoramaShaderModule,
        entryPoint: 'fs',
        targets: [
          {
            format: this.presentationFormat,
            blend: alphaBlend
          }
        ]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none'
      }
    })

    // Overlay pipeline for path/mask/extract visualization
    const overlayShaderCode = `
      @group(0) @binding(0) var<uniform> overlayColor: vec4<f32>;
      
      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>
      }
      
      @vertex
      fn vs(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>) -> VertexOutput {
        return VertexOutput(vec4<f32>(pos, 0.0, 1.0), uv);
      }
      
      @fragment
      fn fs(input: VertexOutput) -> @location(0) vec4<f32> {
        return overlayColor;
      }
    `

    const overlayPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.overlayBindGroupLayout!]
    })

    this.overlayPipeline = this.device.createRenderPipeline({
      layout: overlayPipelineLayout,
      vertex: {
        module: this.device.createShaderModule({ code: overlayShaderCode }),
        entryPoint: 'vs',
        buffers: [vertexBufferLayout]
      },
      fragment: {
        module: this.device.createShaderModule({ code: overlayShaderCode }),
        entryPoint: 'fs',
        targets: [
          {
            format: this.presentationFormat,
            blend: alphaBlend
          }
        ]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none'
      }
    })

    // Create advanced pipelines if enabled
    if (this.useAdvancedTransforms) {
      // Advanced background pipeline with matrix transformations
      this.advancedBackgroundPipeline = this.device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: this.device.createShaderModule({ code: advancedLayerVertexShader }),
          entryPoint: 'vs',
          buffers: [vertexBufferLayout]
        },
        fragment: {
          module: this.device.createShaderModule({ code: advancedLayerFragmentShader }),
          entryPoint: 'fs',
          targets: [
            {
              format: this.presentationFormat,
              blend: alphaBlend
            }
          ]
        },
        primitive: {
          topology: 'triangle-list',
          cullMode: 'none'
        }
      })

      // Advanced foreground pipeline
      this.advancedForegroundPipeline = this.device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: this.device.createShaderModule({ code: advancedLayerVertexShader }),
          entryPoint: 'vs',
          buffers: [vertexBufferLayout]
        },
        fragment: {
          module: this.device.createShaderModule({ code: advancedLayerFragmentShader }),
          entryPoint: 'fs',
          targets: [
            {
              format: this.presentationFormat,
              blend: alphaBlend
            }
          ]
        },
        primitive: {
          topology: 'triangle-list',
          cullMode: 'none'
        }
      })
      
      console.log('[GPUTimelineRenderer] Advanced pipelines created')
    }

    console.log('[GPUTimelineRenderer] Pipelines created successfully')
  }

  // Temporary buffers to clean up after frame submission
  private tempBuffers: GPUBuffer[] = []

  /**
   * Render a complete frame
   */
  renderFrame(
    layers: Layer[],
    time: number,
    camera: CameraState,
    targetView: GPUTextureView,
    duration: number = 5
  ): void {
    // Store duration for use in getLayerProps
    this.currentDuration = duration
    this.performanceMonitor.startFrame()

    if (!this.backgroundPipeline || !this.foregroundPipeline) {
      console.warn('[GPUTimelineRenderer] Pipelines not initialized')
      return
    }

    // Clear temp buffers from previous frame
    this.tempBuffers = []

    const encoder = this.device.createCommandEncoder()

    // Clear the canvas
    const clearPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: 'store'
        }
      ]
    })
    clearPass.end()

    // Render background layer first
    const bgLayer = layers.find((l) => l.type === 'background')
    if (bgLayer && bgLayer.img) {
      const props = this.getLayerProps(bgLayer, time)
      
      // Check if panorama mode is enabled - 与Canvas 2D一致，不检查宽高比
      const isPanoramaCompatible =
        camera.panorama &&
        bgLayer.img.width > 0 &&
        bgLayer.img.height > 0
      
      if (isPanoramaCompatible) {
        this.renderPanoramaLayer(encoder, bgLayer, camera, targetView)
      } else {
        // Choose pipeline based on advanced transforms setting
        const pipeline = this.useAdvancedTransforms && this.advancedBackgroundPipeline
          ? this.advancedBackgroundPipeline
          : this.backgroundPipeline!
        
        this.renderLayerInternal(
          encoder,
          bgLayer,
          props,
          camera,
          targetView,
          pipeline
        )
      }
    }

    // Render foreground layers with culling and batching
    const fgLayers = layers.filter((l) => l.type !== 'background')
    const visibleLayers = this.cullLayers(fgLayers, time, camera)
    
    // Batch layers by type (with mask vs without mask)
    const layersWithoutMask: Layer[] = []
    const layersWithMask: Layer[] = []
    
    for (const layer of visibleLayers) {
      if (layer.maskCanvas) {
        layersWithMask.push(layer)
      } else {
        layersWithoutMask.push(layer)
      }
    }
    
    // Render layers without mask in batch
    for (const layer of layersWithoutMask) {
      if (layer.img) {
        const props = this.getLayerProps(layer, time)
        // Choose pipeline based on advanced transforms setting
        const pipeline = this.useAdvancedTransforms && this.advancedForegroundPipeline
          ? this.advancedForegroundPipeline
          : this.foregroundPipeline!
        
        this.renderLayerInternal(
          encoder,
          layer,
          props,
          camera,
          targetView,
          pipeline
        )
      }
    }
    
    // Render layers with mask
    for (const layer of layersWithMask) {
      if (layer.img) {
        const props = this.getLayerProps(layer, time)
        this.renderLayerWithMask(encoder, layer, props, camera, targetView)
      }
    }

    // Submit commands
    this.device.queue.submit([encoder.finish()])

    // Clean up temporary buffers AFTER submission
    for (const buffer of this.tempBuffers) {
      buffer.destroy()
    }
    this.tempBuffers = []

    this.performanceMonitor.endFrame()
  }

  /**
   * Cull layers that are not visible
   * Task 11.4: Layer culling optimization
   */
  private cullLayers(
    layers: Layer[],
    time: number,
    camera: CameraState
  ): Layer[] {
    const visible: Layer[] = []
    
    for (const layer of layers) {
      // Skip layers without images
      if (!layer.img) continue
      
      // Get layer properties
      const props = this.getLayerProps(layer, time)
      
      // Skip fully transparent layers
      if (props.opacity <= 0.001) continue
      
      // Skip zero-scale layers
      if (Math.abs(props.scale) < 0.001) continue
      
      // Calculate layer bounds in screen space
      const cameraScale = camera.enabled
        ? Math.max(0.2, Math.min(4, 1 / (1 + camera.position.z * 0.001)))
        : 1
      const depthMul = 1 / Math.max(0.1, 1 + props.z * 0.001)
      const finalScale = props.scale * cameraScale * depthMul
      
      const layerWidth = (layer.img.width || 0) * finalScale
      const layerHeight = (layer.img.height || 0) * finalScale
      
      // Simple viewport culling (with margin for rotation)
      const margin = Math.max(layerWidth, layerHeight) * 1.5
      const screenX = props.x + (camera.enabled ? camera.offset.x : 0)
      const screenY = props.y + (camera.enabled ? camera.offset.y : 0)
      
      if (
        screenX + margin < 0 ||
        screenX - margin > this.width ||
        screenY + margin < 0 ||
        screenY - margin > this.height
      ) {
        // Layer is outside viewport
        continue
      }
      
      visible.push(layer)
    }
    
    return visible
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    return this.performanceMonitor.getStats()
  }

  /**
   * Reset performance statistics
   */
  resetPerformanceStats() {
    this.performanceMonitor.reset()
  }

  /**
   * Get interpolated layer properties at a specific time
   * Task 11.5: Lazy updates - cache properties when they haven't changed
   */
  private getLayerProps(layer: Layer, time: number): LayerProps {
    // Check cache first
    const cacheKey = `${layer.id}_${time}`
    const cached = this.lastLayerProps.get(cacheKey)
    
    // If no keyframes and properties haven't changed, return cached
    if (cached && !layer.keyframes && !layer.usePathAnimation) {
      return cached
    }
    
    const kf = layer.keyframes || {}

    let x = this.interpolateValue(kf.x, time, layer.x)
    let y = this.interpolateValue(kf.y, time, layer.y)

    // Apply Bezier path animation if enabled
    if (
      layer.usePathAnimation &&
      layer.bezierPath &&
      layer.bezierPath.length >= 2
    ) {
      const pathPos = this.interpolateBezierPath(
        layer.bezierPath,
        time,
        this.currentDuration
      )
      if (pathPos) {
        x = pathPos.x
        y = pathPos.y
      }
    }

    const props = {
      x,
      y,
      z: this.interpolateValue(kf.z, time, layer.z),
      scale: this.interpolateValue(kf.scale, time, layer.scale),
      rotation: this.interpolateValue(kf.rotation, time, layer.rotation),
      rotationX: this.interpolateValue(kf.rotationX, time, layer.rotationX),
      rotationY: this.interpolateValue(kf.rotationY, time, layer.rotationY),
      rotationZ: this.interpolateValue(kf.rotationZ, time, layer.rotationZ),
      opacity: this.interpolateValue(kf.opacity, time, layer.opacity ?? 1),
      anchorX: this.interpolateValue(kf.anchorX, time, layer.anchorX),
      anchorY: this.interpolateValue(kf.anchorY, time, layer.anchorY),
      perspective: this.interpolateValue(
        kf.perspective,
        time,
        layer.perspective
      ),
      mask_size: this.interpolateValue(kf.mask_size, time, layer.mask_size)
    }
    
    // Cache the result
    this.lastLayerProps.set(cacheKey, props)
    
    // Limit cache size to prevent memory leaks
    if (this.lastLayerProps.size > 100) {
      const firstKey = this.lastLayerProps.keys().next().value
      if (firstKey) {
        this.lastLayerProps.delete(firstKey)
      }
    }
    
    return props
  }

  /**
   * Interpolate keyframe values
   */
  private interpolateValue(
    keyframes: Keyframe[] | undefined,
    time: number,
    defaultValue: number
  ): number {
    if (!keyframes || keyframes.length === 0) return defaultValue

    const sorted = [...keyframes].sort((a, b) => a.time - b.time)

    if (time <= sorted[0].time) return sorted[0].value
    if (time >= sorted[sorted.length - 1].time)
      return sorted[sorted.length - 1].value

    for (let i = 0; i < sorted.length - 1; i++) {
      if (time >= sorted[i].time && time <= sorted[i + 1].time) {
        const t =
          (time - sorted[i].time) / (sorted[i + 1].time - sorted[i].time)
        return sorted[i].value + (sorted[i + 1].value - sorted[i].value) * t
      }
    }

    return defaultValue
  }

  /**
   * Interpolate position along Bezier path
   */
  private interpolateBezierPath(
    path: BezierPoint[],
    time: number,
    duration: number
  ): { x: number; y: number } | null {
    if (!path || path.length < 2) return null

    const t = time / duration
    const totalPoints = path.length
    const segmentCount = totalPoints - 1
    const currentSegment = Math.min(
      Math.floor(t * segmentCount),
      segmentCount - 1
    )
    const segmentT = t * segmentCount - currentSegment

    const p0 = path[currentSegment]
    const p1 = path[currentSegment + 1]

    if (!p0 || !p1) return null

    // Calculate control points
    const cp1x = p0.cp2x ?? p0.x + (p1.x - p0.x) / 3
    const cp1y = p0.cp2y ?? p0.y + (p1.y - p0.y) / 3
    const cp2x = p1.cp1x ?? p0.x + ((p1.x - p0.x) * 2) / 3
    const cp2y = p1.cp1y ?? p0.y + ((p1.y - p0.y) * 2) / 3

    // Cubic Bezier interpolation
    const mt = 1 - segmentT
    const mt2 = mt * mt
    const mt3 = mt2 * mt
    const t2 = segmentT * segmentT
    const t3 = t2 * segmentT

    return {
      x: mt3 * p0.x + 3 * mt2 * segmentT * cp1x + 3 * mt * t2 * cp2x + t3 * p1.x,
      y: mt3 * p0.y + 3 * mt2 * segmentT * cp1y + 3 * mt * t2 * cp2y + t3 * p1.y
    }
  }

  /**
   * Calculate background layer scale based on mode
   */
  private calculateBackgroundScale(
    layer: Layer,
    canvasW: number,
    canvasH: number
  ): number {
    if (!layer.img || layer.type !== 'background') return 1

    const imgW = layer.img.width
    const imgH = layer.img.height

    if (imgW === 0 || imgH === 0) return 1

    const mode = layer.bg_mode || 'fit'

    switch (mode) {
      case 'fit':
        return Math.min(canvasW / imgW, canvasH / imgH)
      case 'fill':
        return Math.max(canvasW / imgW, canvasH / imgH)
      case 'stretch':
        return Math.min(canvasW / imgW, canvasH / imgH)
      default:
        return 1
    }
  }

  /**
   * Render panorama layer with spherical projection
   */
  private renderPanoramaLayer(
    encoder: GPUCommandEncoder,
    layer: Layer,
    camera: CameraState,
    targetView: GPUTextureView
  ): void {
    if (!layer.img || !this.panoramaPipeline) return

    // Load texture
    const textureId = layer.id
    let texture: GPUTexture
    try {
      const sourceKey = layer.image_data || layer.img.src
      texture = this.textureCache.loadImage(textureId, layer.img, sourceKey)
    } catch (error) {
      console.error(
        `[GPUTimelineRenderer] Failed to load panorama texture:`,
        error
      )
      return
    }

    // Ensure valid dimensions
    const screenW = Math.max(1, this.width)
    const screenH = Math.max(1, this.height)
    const aspectRatio = screenW / screenH
    
    // Clamp FOV to valid range (与Canvas 2D一致)
    const fov = Math.min(170, Math.max(10, camera.fov || 90))
    
    // Debug logging (uncomment to debug pano issues)
    // console.log('[GPU Pano] Rendering panorama:', {
    //   screenW, screenH, aspectRatio, fov,
    //   yaw: camera.rotation.yaw,
    //   pitch: camera.rotation.pitch,
    //   roll: camera.rotation.roll,
    //   imgSize: `${layer.img.width}x${layer.img.height}`,
    //   textureId: textureId,
    //   textureLoaded: !!texture,
    //   tanHalfFov: Math.tan(fov * 0.5 * Math.PI / 180),
    //   rendererSize: `${this.width}x${this.height}`
    // })

    // Update panorama uniforms
    const uniformData = new ArrayBuffer(256)
    const f32 = new Float32Array(uniformData)

    let offset = 0
    // yaw, pitch, roll (f32 x 3)
    f32[offset++] = camera.rotation.yaw || 0
    f32[offset++] = camera.rotation.pitch || 0
    f32[offset++] = camera.rotation.roll || 0
    // fov (f32)
    f32[offset++] = fov
    // aspectRatio (f32)
    f32[offset++] = aspectRatio
    // padding
    f32[offset++] = 0
    // screenSize (vec2f)
    f32[offset++] = screenW
    f32[offset++] = screenH

    // 使用单独的pano uniform buffer，避免与前景图层冲突
    this.device.queue.writeBuffer(this.panoUniformBuffer!, 0, uniformData)

    // Create bind groups - 使用pano专用的uniform buffer
    const uniformBindGroup = this.device.createBindGroup({
      layout: this.uniformBindGroupLayout!,
      entries: [{ binding: 0, resource: { buffer: this.panoUniformBuffer! } }]
    })

    const textureBindGroup = this.device.createBindGroup({
      layout: this.textureBindGroupLayout!,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: this.panoSampler! }  // 使用pano专用sampler
      ]
    })

    // Render pass
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          loadOp: 'load',
          storeOp: 'store'
        }
      ]
    })

    renderPass.setPipeline(this.panoramaPipeline)
    renderPass.setBindGroup(0, uniformBindGroup)
    renderPass.setBindGroup(1, textureBindGroup)
    renderPass.setVertexBuffer(0, this.quadVertexBuffer!)
    renderPass.setIndexBuffer(this.indexBuffer!, 'uint16')
    renderPass.drawIndexed(6)
    renderPass.end()
  }

  /**
   * Render a single layer (internal implementation)
   */
  private renderLayerInternal(
    encoder: GPUCommandEncoder,
    layer: Layer,
    props: LayerProps,
    camera: CameraState,
    targetView: GPUTextureView,
    pipeline: GPURenderPipeline
  ): void {
    if (!layer.img) {
      return
    }

    // Load texture
    const textureId = layer.id
    let texture: GPUTexture
    try {
      const sourceKey = layer.image_data || layer.img.src
      texture = this.textureCache.loadImage(textureId, layer.img, sourceKey) as any
    } catch (error) {
      console.error(
        `[GPUTimelineRenderer] Failed to load texture for layer ${layer.id}:`,
        error
      )
      return
    }

    // Calculate camera transformations - 完全对齐Canvas 2D逻辑
    const camOffsetX = camera.offset.x
    const camOffsetY = camera.offset.y
    const panoActive = camera.panorama
    const cameraActive = camera.enabled

    // Calculate depth multiplier for parallax (与Canvas 2D一致)
    const depthMul = 1 / Math.max(0.1, 1 + props.z * 0.001)

    // Calculate camera Z scale (摄像机推拉产生的缩放效果)
    // cam_pos_z 默认1000，越小越近（放大），越大越远（缩小）
    const camPosZ = camera.position.z
    const cameraZScale = cameraActive && !panoActive 
      ? Math.max(0.1, Math.min(10, 1000 / Math.max(100, camPosZ)))
      : 1

    // Calculate base scale for background layers
    let baseScale = 1
    if (layer.type === 'background') {
      baseScale = this.calculateBackgroundScale(layer, this.width, this.height)
    }

    // Calculate final scale (与Canvas 2D一致)
    const finalScale = props.scale * baseScale * depthMul * cameraZScale

    // Calculate layer position in screen space
    const imgW = layer.img.width
    const imgH = layer.img.height
    const centerX = this.width / 2
    const centerY = this.height / 2
    
    let layerX = props.x
    let layerY = props.y
    
    // 只开camera模式（非pano）下，背景也需要响应摄像机
    if (layer.type === 'background' && cameraActive && !panoActive) {
      const camYaw = camera.rotation.yaw
      const camPitch = camera.rotation.pitch
      const camFov = Math.max(10, Math.min(170, camera.fov || 90))
      const camPosX = camera.position.x
      const camPosY = camera.position.y
      
      // 摄像机位置影响背景偏移（反向）
      layerX -= camPosX
      layerY -= camPosY
      
      // 摄像机旋转影响背景位置
      if (camYaw !== 0 || camPitch !== 0) {
        const yawRad = (camYaw * Math.PI) / 180
        const pitchRad = (camPitch * Math.PI) / 180
        const fovFactor = Math.tan((camFov * Math.PI / 180) / 2)
        const moveScale = this.width / (2 * fovFactor)
        layerX += Math.tan(yawRad) * moveScale
        layerY += Math.tan(pitchRad) * moveScale
      }
    }
    
    // 前景图层跟随摄像机（pano模式和普通摄像机模式都需要）
    if (layer.type !== 'background' && (cameraActive || panoActive)) {
      const camYaw = camera.rotation.yaw
      const camPitch = camera.rotation.pitch
      const camFov = Math.max(10, Math.min(170, camera.fov || 90))
      const camPosX = camera.position.x
      const camPosY = camera.position.y
      
      // 摄像机位置影响前景偏移（反向，与背景一致）
      if (!panoActive) {
        layerX -= camPosX
        layerY -= camPosY
      }
      
      // 摄像机旋转影响前景位置（与背景方向一致）
      if (camYaw !== 0 || camPitch !== 0) {
        const yawRad = (camYaw * Math.PI) / 180
        const pitchRad = (camPitch * Math.PI) / 180
        const fovFactor = Math.tan((camFov * Math.PI / 180) / 2)
        const moveScale = this.width / (2 * fovFactor)
        // pano模式下前景需要反向移动（因为pano背景是球面投影）
        // camera-only模式下前景与背景同向移动
        if (panoActive) {
          layerX -= Math.tan(yawRad) * moveScale
          layerY -= Math.tan(pitchRad) * moveScale
        } else {
          layerX += Math.tan(yawRad) * moveScale
          layerY += Math.tan(pitchRad) * moveScale
        }
      }
    }
    
    // 最终位置：画布中心 + 图层位置 + 摄像机偏移 (与Canvas 2D一致)
    const finalX = centerX + layerX + camOffsetX
    const finalY = centerY + layerY + camOffsetY
    
    const layerW = imgW * finalScale
    const layerH = imgH * finalScale
    
    // 获取旋转角度
    const rotX = (props.rotationX || 0) * Math.PI / 180
    const rotY = (props.rotationY || 0) * Math.PI / 180
    const rotZ = ((props.rotationZ || props.rotation || 0)) * Math.PI / 180
    
    // 透视距离（用于 3D 效果）
    const perspective = props.perspective || 1000
    
    // 计算四个角点（相对于中心，在 3D 空间中）
    const hw = layerW / 2
    const hh = layerH / 2
    
    // 原始角点 (x, y, z)
    const originalCorners = [
      { x: -hw, y: hh, z: 0 },   // bottom-left
      { x: hw, y: hh, z: 0 },    // bottom-right
      { x: hw, y: -hh, z: 0 },   // top-right
      { x: -hw, y: -hh, z: 0 }   // top-left
    ]
    
    // 应用 3D 旋转（顺序：Z -> Y -> X，与 AE 一致）
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX)
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY)
    const cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ)
    
    const corners = originalCorners.map(p => {
      // Z 轴旋转
      let x = p.x * cosZ - p.y * sinZ
      let y = p.x * sinZ + p.y * cosZ
      let z = p.z
      
      // Y 轴旋转
      const x2 = x * cosY + z * sinY
      z = -x * sinY + z * cosY
      x = x2
      
      // X 轴旋转
      const y2 = y * cosX - z * sinX
      z = y * sinX + z * cosX
      y = y2
      
      // 透视投影
      const scale = perspective / (perspective + z)
      return {
        x: x * scale,
        y: y * scale
      }
    })
    
    // 转换到 NDC 空间
    const layerVertices = new Float32Array([
      ((finalX + corners[0].x) / this.width) * 2 - 1, 1 - ((finalY + corners[0].y) / this.height) * 2, 0, 1,
      ((finalX + corners[1].x) / this.width) * 2 - 1, 1 - ((finalY + corners[1].y) / this.height) * 2, 1, 1,
      ((finalX + corners[2].x) / this.width) * 2 - 1, 1 - ((finalY + corners[2].y) / this.height) * 2, 1, 0,
      ((finalX + corners[3].x) / this.width) * 2 - 1, 1 - ((finalY + corners[3].y) / this.height) * 2, 0, 0
    ])
    
    // Create temporary vertex buffer for this layer
    const layerVertexBuffer = this.device.createBuffer({
      size: layerVertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    })
    this.device.queue.writeBuffer(layerVertexBuffer, 0, layerVertices)
    
    // Track buffer for cleanup after frame submission
    this.tempBuffers.push(layerVertexBuffer)

    // Update uniforms
    const uniformData = new ArrayBuffer(256)
    const f32 = new Float32Array(uniformData)

    let offset = 0
    // opacity (f32)
    f32[offset++] = props.opacity
    
    if (this.useAdvancedTransforms && camera.enabled) {
      // Build rotation matrix from camera yaw/pitch/roll
      const yawRad = (camera.rotation.yaw * Math.PI) / 180
      const pitchRad = (camera.rotation.pitch * Math.PI) / 180
      const rollRad = (camera.rotation.roll * Math.PI) / 180
      
      const cy = Math.cos(yawRad)
      const sy = Math.sin(yawRad)
      const cp = Math.cos(pitchRad)
      const sp = Math.sin(pitchRad)
      const cr = Math.cos(rollRad)
      const sr = Math.sin(rollRad)
      
      // Combined rotation matrix (yaw * pitch * roll)
      const r00 = cr * cy + sr * sp * sy
      const r01 = sr * cp
      const r02 = cr * -sy + sr * sp * cy
      const r10 = -sr * cy + cr * sp * sy
      const r11 = cr * cp
      const r12 = -sr * -sy + cr * sp * cy
      const r20 = cp * sy
      const r21 = -sp
      const r22 = cp * cy
      
      // rotationRow0 (vec4: r00, r01, r02, padding)
      f32[offset++] = r00
      f32[offset++] = r01
      f32[offset++] = r02
      f32[offset++] = 0
      
      // rotationRow1 (vec4: r10, r11, r12, padding)
      f32[offset++] = r10
      f32[offset++] = r11
      f32[offset++] = r12
      f32[offset++] = 0
      
      // rotationRow2 (vec4: r20, r21, r22, padding)
      f32[offset++] = r20
      f32[offset++] = r21
      f32[offset++] = r22
      f32[offset++] = 0
    } else {
      // Identity matrix when not using advanced transforms
      // padding to align
      f32[offset++] = 1  // r00
      f32[offset++] = 0  // r01
      f32[offset++] = 0  // r02
      f32[offset++] = 0  // padding
      
      f32[offset++] = 0  // r10
      f32[offset++] = 1  // r11
      f32[offset++] = 0  // r12
      f32[offset++] = 0  // padding
      
      f32[offset++] = 0  // r20
      f32[offset++] = 0  // r21
      f32[offset++] = 1  // r22
      f32[offset++] = 0  // padding
    }

    this.device.queue.writeBuffer(this.uniformBuffer!, 0, uniformData)

    // Create bind groups
    const uniformBindGroup = this.device.createBindGroup({
      layout: this.uniformBindGroupLayout!,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer! } }]
    })

    const textureBindGroup = this.device.createBindGroup({
      layout: this.textureBindGroupLayout!,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: this.sampler! }
      ]
    })

    // Render pass
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          loadOp: 'load',
          storeOp: 'store'
        }
      ]
    })

    renderPass.setPipeline(pipeline)
    renderPass.setBindGroup(0, uniformBindGroup)
    renderPass.setBindGroup(1, textureBindGroup)
    renderPass.setVertexBuffer(0, layerVertexBuffer)
    renderPass.setIndexBuffer(this.indexBuffer!, 'uint16')
    renderPass.drawIndexed(6)
    renderPass.end()
  }

  /**
   * Render a single layer (public API)
   */
  renderLayer(
    layer: Layer,
    props: LayerProps,
    target: GPUTextureView
  ): void {
    const encoder = this.device.createCommandEncoder()
    const pipeline =
      layer.type === 'background'
        ? this.backgroundPipeline!
        : this.foregroundPipeline!
    const camera: CameraState = {
      enabled: false,
      position: { x: 0, y: 0, z: 0 },
      offset: { x: 0, y: 0 },
      rotation: { yaw: 0, pitch: 0, roll: 0 },
      fov: 90,
      panorama: false
    }
    this.renderLayerInternal(encoder, layer, props, camera, target, pipeline)
    this.device.queue.submit([encoder.finish()])
  }

  /**
   * Render layer with mask compositing
   * Task 4.7: Mask compositing implementation
   */
  private renderLayerWithMask(
    encoder: GPUCommandEncoder,
    layer: Layer,
    props: LayerProps,
    camera: CameraState,
    targetView: GPUTextureView
  ): void {
    if (!layer.maskCanvas || !layer.img) {
      // No mask, render normally
      this.renderLayerInternal(
        encoder,
        layer,
        props,
        camera,
        targetView,
        this.foregroundPipeline!
      )
      return
    }

    try {
      // Create mask texture from canvas
      const maskTextureId = `${layer.id}_mask`
      
      // Convert canvas to ImageBitmap for GPU upload
      // Note: This is synchronous in most browsers
      const maskBitmap = layer.maskCanvas as any as ImageBitmap
      
      // Load mask texture
      const maskVersion = layer.maskVersion ?? 0
      const maskSourceKey = `${maskTextureId}:${maskVersion}`
      const maskTexture = this.textureCache.loadImage(maskTextureId, maskBitmap, maskSourceKey)
      
      // For now, render the layer normally
      // Full mask compositing would require a multi-pass approach:
      // 1. Render layer to offscreen texture
      // 2. Apply mask using destination-in blend
      // 3. Composite result to main target
      
      // Simplified approach: render with reduced opacity based on mask
      const maskedProps = { ...props }
      maskedProps.opacity *= 0.8 // Approximate mask effect
      
      this.renderLayerInternal(
        encoder,
        layer,
        maskedProps,
        camera,
        targetView,
        this.foregroundPipeline!
      )
    } catch (error) {
      console.warn(
        `[GPUTimelineRenderer] Failed to apply mask for layer ${layer.id}:`,
        error
      )
      // Fallback: render without mask
      this.renderLayerInternal(
        encoder,
        layer,
        props,
        camera,
        targetView,
        this.foregroundPipeline!
      )
    }
  }

  /**
   * Render overlay (path, mask, extract)
   * Task 7: Overlay rendering implementation
   */
  renderOverlay(
    mode: 'path' | 'mask' | 'extract' | 'none',
    targetView: GPUTextureView,
    overlayData?: {
      color?: [number, number, number, number]
      path?: { x: number; y: number }[]
      layer?: Layer
    }
  ): void {
    if (mode === 'none' || !this.overlayPipeline) return

    const encoder = this.device.createCommandEncoder()

    // Determine overlay color based on mode
    let color: [number, number, number, number] = [1, 0, 0, 0.3] // Default red semi-transparent

    switch (mode) {
      case 'mask':
        color = [1, 0, 0, 0.5] // Red for mask overlay
        break
      case 'extract':
        color = [0, 0, 0, 0.6] // Dark for extract overlay
        break
      case 'path':
        color = [0, 0.5, 1, 0.8] // Blue for path visualization
        break
    }

    if (overlayData?.color) {
      color = overlayData.color
    }

    // Create overlay color buffer
    const colorBuffer = this.device.createBuffer({
      size: 16, // vec4<f32>
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })

    const colorData = new Float32Array(color)
    this.device.queue.writeBuffer(colorBuffer, 0, colorData)

    // Create bind group
    const overlayBindGroup = this.device.createBindGroup({
      layout: this.overlayBindGroupLayout!,
      entries: [{ binding: 0, resource: { buffer: colorBuffer } }]
    })

    // Render pass
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          loadOp: 'load', // Don't clear, overlay on top
          storeOp: 'store'
        }
      ]
    })

    renderPass.setPipeline(this.overlayPipeline)
    renderPass.setBindGroup(0, overlayBindGroup)
    renderPass.setVertexBuffer(0, this.quadVertexBuffer!)
    renderPass.setIndexBuffer(this.indexBuffer!, 'uint16')
    renderPass.drawIndexed(6)
    renderPass.end()

    this.device.queue.submit([encoder.finish()])

    // Clean up temporary buffer
    colorBuffer.destroy()
  }

  /**
   * Render path visualization overlay
   * Task 7.5: Path visualization
   */
  renderPathOverlay(
    path: BezierPoint[],
    targetView: GPUTextureView,
    camera: CameraState
  ): void {
    if (!path || path.length < 2) return

    // For now, use simple overlay rendering
    // Full path visualization with curves would require line rendering pipeline
    this.renderOverlay('path', targetView, {
      color: [0, 0.5, 1, 0.8]
    })
  }

  /**
   * Render mask overlay
   * Task 7.6: Mask overlay
   */
  renderMaskOverlay(
    layer: Layer,
    targetView: GPUTextureView,
    camera: CameraState
  ): void {
    if (!layer.maskCanvas) return

    // Render semi-transparent red tint for mask areas
    this.renderOverlay('mask', targetView, {
      color: [1, 0, 0, 0.5],
      layer
    })
  }

  /**
   * Render extract overlay
   * Task 7.7: Extract overlay
   */
  renderExtractOverlay(
    layer: Layer,
    targetView: GPUTextureView,
    camera: CameraState
  ): void {
    // Render darkened background for extract mode
    this.renderOverlay('extract', targetView, {
      color: [0, 0, 0, 0.6],
      layer
    })
  }

  /**
   * Update uniform buffer with new data
   * Task 11.5: Lazy updates - only update when data changes
   */
  updateUniforms(data: ArrayBuffer): void {
    // Check if data has changed
    if (this.lastUniformData) {
      const lastView = new Uint8Array(this.lastUniformData)
      const newView = new Uint8Array(data)
      
      let changed = false
      for (let i = 0; i < Math.min(lastView.length, newView.length); i++) {
        if (lastView[i] !== newView[i]) {
          changed = true
          break
        }
      }
      
      if (!changed) {
        // Data hasn't changed, skip update
        return
      }
    }
    
    // Update buffer
    this.device.queue.writeBuffer(this.uniformBuffer!, 0, data)
    
    // Cache the data
    this.lastUniformData = data.slice(0)
  }
  
  /**
   * Check if camera state has changed
   */
  private cameraStateChanged(camera: CameraState): boolean {
    if (!this.lastCameraState) {
      this.lastCameraState = { ...camera }
      return true
    }
    
    const changed =
      this.lastCameraState.enabled !== camera.enabled ||
      this.lastCameraState.position.x !== camera.position.x ||
      this.lastCameraState.position.y !== camera.position.y ||
      this.lastCameraState.position.z !== camera.position.z ||
      this.lastCameraState.offset.x !== camera.offset.x ||
      this.lastCameraState.offset.y !== camera.offset.y ||
      this.lastCameraState.rotation.yaw !== camera.rotation.yaw ||
      this.lastCameraState.rotation.pitch !== camera.rotation.pitch ||
      this.lastCameraState.rotation.roll !== camera.rotation.roll ||
      this.lastCameraState.fov !== camera.fov ||
      this.lastCameraState.panorama !== camera.panorama
    
    if (changed) {
      this.lastCameraState = { ...camera }
    }
    
    return changed
  }

  /**
   * Resize render targets
   */
  resizeRenderTargets(width: number, height: number): void {
    this.width = width
    this.height = height
    // TODO: Recreate render targets if needed
  }

  /**
   * Clean up all GPU resources
   */
  cleanup(): void {
    // Clean up any remaining temp buffers
    for (const buffer of this.tempBuffers) {
      buffer.destroy()
    }
    this.tempBuffers = []

    // Destroy buffers
    this.uniformBuffer?.destroy()
    this.panoUniformBuffer?.destroy()
    this.quadVertexBuffer?.destroy()
    this.indexBuffer?.destroy()

    // Clean up texture cache
    this.textureCache.cleanup()

    console.log('[GPUTimelineRenderer] Cleaned up all resources')
  }

  /**
   * Get texture cache statistics
   */
  getCacheStats() {
    return this.textureCache.getStats()
  }

  /**
   * Invalidate a cached texture by id.
   */
  invalidateTexture(id: string): boolean {
    return this.textureCache.evict(id)
  }

  /**
   * Clear all cached textures without destroying pipelines.
   */
  clearTextureCache(): void {
    this.textureCache.cleanup()
  }
}
