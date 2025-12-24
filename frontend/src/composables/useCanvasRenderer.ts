import { Ref } from 'vue'
import { GPUTimelineRenderer, GPUDebugger, type CameraState } from './timeline/gpu'
import {
  clampFov,
  clampImageDimension,
  calculateDepthScale,
  calculateCameraZScale
} from '../utils/numberUtil'

export interface PanoCache {
  key?: string
  sourceKey?: string
  mapX?: Float32Array
  mapY?: Float32Array
  srcData?: Uint8ClampedArray
  imgW?: number
  imgH?: number
  canvas?: HTMLCanvasElement
  ctx?: CanvasRenderingContext2D | null
  outW?: number
  outH?: number
}

export function useCanvasRenderer(
  store: any,
  canvasRef: Ref<HTMLCanvasElement | undefined>,
  interactionCanvasRef: Ref<HTMLCanvasElement | undefined>
) {
  let ctx: CanvasRenderingContext2D | null = null
  let interactionCtx: CanvasRenderingContext2D | null = null
  let renderPending = false
  
  // GPU rendering
  let gpuRenderer: GPUTimelineRenderer | null = null
  let gpuContext: GPUCanvasContext | null = null
  let gpuDebugger: GPUDebugger | null = null
  let useGPU = false
  
  const imageCache = new Map<string, HTMLImageElement>()
  const panoCache: PanoCache = {}
  const maskCompositeCache: {
    canvas: HTMLCanvasElement | null
    ctx: CanvasRenderingContext2D | null
  } = {
    canvas: null,
    ctx: null
  }

  async function initContexts() {
    // Check if GPU rendering should be disabled (for debugging)
    const disableGPU = localStorage.getItem('timeline_disable_gpu') === 'true'
    
    // Check if experimental camera rotation should be enabled
    const enableCameraRotation = localStorage.getItem('timeline_gpu_camera_rotation') === 'true'
    
    // Try to initialize WebGPU first
    if (!disableGPU && 'gpu' in navigator && canvasRef.value) {
      try {
        console.log('[Timeline] Attempting WebGPU initialization...')
        const adapter = await navigator.gpu.requestAdapter()
        console.log('[Timeline] GPU adapter:', adapter)
        
        if (adapter) {
          // Check adapter info for compatibility issues
          let adapterInfo: any = null
          try {
            adapterInfo = await (adapter as any).requestAdapterInfo?.()
            if (adapterInfo) {
              const vendor = adapterInfo.vendor || ''
              const description = adapterInfo.description || ''
              console.log('[Timeline] GPU Vendor:', vendor)
              console.log('[Timeline] GPU Description:', description)
              
              // Check for known problematic GPU configurations
              // Some 40-series NVIDIA cards may have WebGPU driver issues
              if (description.includes('RTX 40') || description.includes('GeForce RTX 40')) {
                console.warn('[Timeline] ⚠️ Detected RTX 40-series GPU. If you experience UI layout issues, try disabling GPU rendering.')
                console.warn('[Timeline] To disable GPU: Open browser console and run: localStorage.setItem("timeline_disable_gpu", "true") then reload.')
              }
            }
          } catch (infoError) {
            console.log('[Timeline] Could not get adapter info:', infoError)
          }
          
          const device = await adapter.requestDevice()
          console.log('[Timeline] GPU device:', device)
          
          const context = canvasRef.value.getContext('webgpu')
          console.log('[Timeline] WebGPU context:', context)
          
          if (context) {
            const presentationFormat = navigator.gpu.getPreferredCanvasFormat()
            console.log('[Timeline] Presentation format:', presentationFormat)
            
            try {
              context.configure({
                device,
                format: presentationFormat,
                alphaMode: 'premultiplied'
              })
            } catch (configError) {
              console.error('[Timeline] ❌ WebGPU context configuration failed:', configError)
              throw configError
            }
            
            // Check if advanced transforms (camera rotation) should be enabled
            const useAdvancedTransforms = localStorage.getItem('timeline_gpu_advanced') === 'true'
            
            try {
              gpuRenderer = new GPUTimelineRenderer({
                device,
                presentationFormat,
                width: store.project.width,
                height: store.project.height,
                useAdvancedTransforms
              })
            } catch (rendererError) {
              console.error('[Timeline] ❌ GPUTimelineRenderer creation failed:', rendererError)
              throw rendererError
            }
            
            gpuDebugger = new GPUDebugger(device, adapter)
            gpuContext = context
            useGPU = true
            console.log('[Timeline] ✅ WebGPU initialized successfully')
            console.log('[Timeline] Canvas size:', store.project.width, 'x', store.project.height)
            
            // Log device info in debug mode
            if (import.meta.env.DEV) {
              await gpuDebugger.logDeviceInfo()
            }
            
            // Still initialize interaction canvas with 2D
            if (interactionCanvasRef.value) {
              interactionCtx = interactionCanvasRef.value.getContext('2d', {
                alpha: true
              })
            }
            return
          }
        }
      } catch (error) {
        console.warn('[Timeline] ❌ WebGPU initialization failed, falling back to Canvas 2D:', error)
        console.warn('[Timeline] If you have an RTX 40-series GPU and experience UI issues, this fallback should resolve them.')
        // Clear any partial GPU state
        gpuRenderer = null
        gpuContext = null
        useGPU = false
      }
    } else if (disableGPU) {
      console.log('[Timeline] GPU rendering disabled by user preference')
    } else if (!('gpu' in navigator)) {
      console.log('[Timeline] WebGPU not supported in this browser')
    }
    
    // Fallback to Canvas 2D
    console.log('[Timeline] Using Canvas 2D renderer')
    useGPU = false
    if (canvasRef.value) {
      ctx = canvasRef.value.getContext('2d', { 
        alpha: false,
        desynchronized: true
      })
    }
    if (interactionCanvasRef.value) {
      interactionCtx = interactionCanvasRef.value.getContext('2d', {
        alpha: true
      })
    }
  }

  function scheduleRender() {
    if (renderPending) return
    renderPending = true
    requestAnimationFrame(() => {
      renderPending = false
      render()
    })
  }

  function getCachedImage(layer: any): HTMLImageElement | null {
    // If layer.img exists and matches current image_data, return it
    if (layer.img && layer.img.src === layer.image_data) {
      return layer.img
    }
    
    // If img exists but doesn't match image_data, clear it
    if (layer.img && layer.img.src !== layer.image_data) {
      layer.img = undefined
    }
    
    if (!layer.image_data) return null
    
    const cacheKey = layer.id
    // Check cache, but verify it matches current image_data
    if (imageCache.has(cacheKey)) {
      const cachedImg = imageCache.get(cacheKey)!
      // If cached image matches current image_data, use it
      if (cachedImg.src === layer.image_data && cachedImg.complete) {
        layer.img = cachedImg
        return cachedImg
      } else {
        // Cache mismatch, remove it
        imageCache.delete(cacheKey)
      }
    }
    
    // Create new image from current image_data
    const img = new Image()
    img.onload = () => {
      layer.img = img
      scheduleRender()
    }
    img.src = layer.image_data
    imageCache.set(cacheKey, img)
    return null
  }

  function interpolateValue(keyframes: any[], time: number, defaultValue: number): number {
    if (!keyframes || keyframes.length === 0) return defaultValue
    
    const sorted = [...keyframes].sort((a, b) => a.time - b.time)
    
    if (time <= sorted[0].time) return sorted[0].value
    if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value
    
    for (let i = 0; i < sorted.length - 1; i++) {
      if (time >= sorted[i].time && time <= sorted[i + 1].time) {
        const t = (time - sorted[i].time) / (sorted[i + 1].time - sorted[i].time)
        return sorted[i].value + (sorted[i + 1].value - sorted[i].value) * t
      }
    }
    
    return defaultValue
  }

  function interpolateBezierPath(path: any[], time: number, duration: number): { x: number, y: number } | null {
    if (!path || path.length < 2) return null
    
    const t = time / duration
    const totalPoints = path.length
    const segmentCount = totalPoints - 1
    const currentSegment = Math.min(Math.floor(t * segmentCount), segmentCount - 1)
    const segmentT = (t * segmentCount) - currentSegment
    
    const p0 = path[currentSegment]
    const p1 = path[currentSegment + 1]
    
    if (!p0 || !p1) return null
    
    const cp1x = p0.cp2x ?? (p0.x + (p1.x - p0.x) / 3)
    const cp1y = p0.cp2y ?? (p0.y + (p1.y - p0.y) / 3)
    const cp2x = p1.cp1x ?? (p0.x + (p1.x - p0.x) * 2 / 3)
    const cp2y = p1.cp1y ?? (p0.y + (p1.y - p0.y) * 2 / 3)
    
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

  function getLayerProps(layer: any) {
    const time = store.currentTime
    const kf = layer.keyframes || {}
    
    let x = interpolateValue(kf.x, time, layer.x || 0)
    let y = interpolateValue(kf.y, time, layer.y || 0)
    
    if (layer.usePathAnimation && layer.bezierPath && layer.bezierPath.length >= 2) {
      const pathPos = interpolateBezierPath(layer.bezierPath, time, store.project.duration)
      if (pathPos) {
        x = pathPos.x
        y = pathPos.y
      }
    }
    
    return {
      x,
      y,
      z: interpolateValue(kf.z, time, layer.z || 0),
      scale: interpolateValue(kf.scale, time, layer.scale || 1),
      rotation: interpolateValue(kf.rotation, time, layer.rotation || 0),
      opacity: interpolateValue(kf.opacity, time, layer.opacity ?? 1),
      mask_size: interpolateValue(kf.mask_size, time, layer.mask_size || 0),
      rotationX: interpolateValue(kf.rotationX, time, layer.rotationX || 0),
      rotationY: interpolateValue(kf.rotationY, time, layer.rotationY || 0),
      rotationZ: interpolateValue(kf.rotationZ, time, layer.rotationZ || 0),
      anchorX: interpolateValue(kf.anchorX, time, layer.anchorX || 0),
      anchorY: interpolateValue(kf.anchorY, time, layer.anchorY || 0),
      perspective: interpolateValue(kf.perspective, time, layer.perspective || 1000)
    }
  }

  function render() {
    if (useGPU && gpuRenderer && gpuContext) {
      renderWithGPU()
    } else {
      renderCanvas2D()
    }
    renderInteractionLayer()
  }

  function renderWithGPU() {
    if (!gpuRenderer || !gpuContext) return

    // Ensure all layer images are loaded
    let allImagesLoaded = true
    for (const layer of store.layers) {
      if (layer.image_data && !layer.img) {
        const img = getCachedImage(layer)
        if (!img) {
          allImagesLoaded = false
        }
      }
    }

    // If images are still loading, fall back to Canvas 2D temporarily
    if (!allImagesLoaded) {
      renderCanvas2D()
      return
    }

    // Build camera state with interpolated values
    const cameraEnabled = !!store.project.cam_enable && !store.project.pano_enable
    const camera: CameraState = {
      enabled: cameraEnabled,
      position: {
        x: store.interpolateProjectValue?.('cam_pos_x', store.currentTime, store.project.cam_pos_x || 0) ?? (store.project.cam_pos_x || 0),
        y: store.interpolateProjectValue?.('cam_pos_y', store.currentTime, store.project.cam_pos_y || 0) ?? (store.project.cam_pos_y || 0),
        z: store.interpolateProjectValue?.('cam_pos_z', store.currentTime, store.project.cam_pos_z || 0) ?? (store.project.cam_pos_z || 0)
      },
      offset: {
        x: store.interpolateProjectValue?.('cam_offset_x', store.currentTime, store.project.cam_offset_x || 0) ?? (store.project.cam_offset_x || 0),
        y: store.interpolateProjectValue?.('cam_offset_y', store.currentTime, store.project.cam_offset_y || 0) ?? (store.project.cam_offset_y || 0)
      },
      rotation: {
        yaw: store.interpolateProjectValue?.('cam_yaw', store.currentTime, store.project.cam_yaw || 0) ?? (store.project.cam_yaw || 0),
        pitch: store.interpolateProjectValue?.('cam_pitch', store.currentTime, store.project.cam_pitch || 0) ?? (store.project.cam_pitch || 0),
        roll: store.interpolateProjectValue?.('cam_roll', store.currentTime, store.project.cam_roll || 0) ?? (store.project.cam_roll || 0)
      },
      fov: store.interpolateProjectValue?.('cam_fov', store.currentTime, store.project.cam_fov || 90) ?? (store.project.cam_fov || 90),
      panorama: !!store.project.pano_enable
    }
    


    try {
      // 确保GPU渲染器的尺寸与项目尺寸一致
      const projW = store.project.width
      const projH = store.project.height
      gpuRenderer.resizeRenderTargets(projW, projH)
      
      const targetView = gpuContext.getCurrentTexture().createView()
      gpuRenderer.renderFrame(store.layers, store.currentTime, camera, targetView, store.project.duration)
    } catch (error) {
      console.error('[Timeline] GPU rendering error:', error)
      // Fall back to Canvas 2D on error
      useGPU = false
      renderCanvas2D()
    }
  }

  function renderCanvas2D() {
    if (!canvasRef.value || !ctx) return
    
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, store.project.width, store.project.height)

    // 获取摄像机偏移（用于所有图层）
    const camOffsetX = store.interpolateProjectValue?.('cam_offset_x', store.currentTime, store.project.cam_offset_x ?? 0) ?? (store.project.cam_offset_x ?? 0)
    const camOffsetY = store.interpolateProjectValue?.('cam_offset_y', store.currentTime, store.project.cam_offset_y ?? 0) ?? (store.project.cam_offset_y ?? 0)
    
    const panoEnabled = !!store.project.pano_enable
    const cameraEnabled = !!store.project.cam_enable

    // 渲染背景图层
    const bgLayer = store.layers.find((l: any) => l.type === 'background')
    if (bgLayer && ctx) {
      drawBackgroundLayer(ctx, bgLayer, camOffsetX, camOffsetY, 1, cameraEnabled)
    }

    // 渲染前景图层
    if (ctx) {
      store.layers.filter((l: any) => l.type !== 'background').forEach((layer: any) => {
        drawForegroundLayer(ctx!, layer, camOffsetX, camOffsetY, cameraEnabled, 1)
      })
    }
    
    if (store.pathMode.enabled && store.currentLayer?.bezierPath && ctx) {
      drawBezierPath(ctx, store.currentLayer.bezierPath)
    }

    if (store.extractMode.enabled && ctx) {
      drawExtractOverlay(ctx)
    }
  }

  let drawExtractOverlayOnCtxFn: ((iCtx: CanvasRenderingContext2D) => void) | null = null
  let drawBrushPreviewOnCtxFn: ((iCtx: CanvasRenderingContext2D) => void) | null = null

  function setDrawExtractOverlayOnCtx(fn: (iCtx: CanvasRenderingContext2D) => void) {
    drawExtractOverlayOnCtxFn = fn
  }

  function setDrawBrushPreviewOnCtx(fn: (iCtx: CanvasRenderingContext2D) => void) {
    drawBrushPreviewOnCtxFn = fn
  }

  function renderInteractionLayer() {
    if (!interactionCanvasRef.value || !interactionCtx) return
    
    const iCtx = interactionCtx
    const w = store.project.width
    const h = store.project.height
    
    iCtx.clearRect(0, 0, w, h)
    
    if (store.pathMode.enabled && store.currentLayer?.bezierPath) {
      drawBezierPathOnCtx(iCtx, store.currentLayer.bezierPath)
    }
    
    if (store.extractMode.enabled && drawExtractOverlayOnCtxFn) {
      drawExtractOverlayOnCtxFn(iCtx)
    }
    
    if (store.maskMode.enabled && store.currentLayer?.maskCanvas) {
      drawMaskOverlayOnCtx(iCtx)
    }
    
    if (store.currentLayer && store.currentLayer.img) {
      drawSelectionBorder(iCtx)
    }

    if (drawBrushPreviewOnCtxFn) {
      drawBrushPreviewOnCtxFn(iCtx)
    }
  }

  function ensureMaskCanvas(layer: any, imgW: number, imgH: number) {
    if (layer.maskCanvas || !layer.customMask) return

    const maskImg = new Image()
    maskImg.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = maskImg.width || imgW
      canvas.height = maskImg.height || imgH
      const mCtx = canvas.getContext('2d')
      if (mCtx) {
        mCtx.drawImage(maskImg, 0, 0, canvas.width, canvas.height)
        layer.maskCanvas = canvas
        scheduleRender()
      }
    }
    maskImg.src = layer.customMask
  }

  function drawBackgroundLayer(ctx: CanvasRenderingContext2D, layer: any, camOffsetX = 0, camOffsetY = 0, cameraScale = 1, cameraActive = false) {
    const img = getCachedImage(layer)
    if (!img || img.width === 0 || img.height === 0) return

    const props = getLayerProps(layer)
    // pano 显示只依赖开关，不再强制 cameraActive
    const panoEnabled = !!store.project.pano_enable

    ctx.save()
    ctx.globalAlpha = props.opacity

    const mode = layer.bg_mode || 'fit'
    const canvasW = store.project.width
    const canvasH = store.project.height
    const imgW = img.width
    const imgH = img.height
    let baseScale = 1
    const isPanoCompatible = panoEnabled && imgW > 0 && imgH > 0

    if (isPanoCompatible) {
      const yaw = store.interpolateProjectValue?.('cam_yaw', store.currentTime, store.project.cam_yaw || 0) ?? (store.project.cam_yaw || 0)
      const pitch = store.interpolateProjectValue?.('cam_pitch', store.currentTime, store.project.cam_pitch || 0) ?? (store.project.cam_pitch || 0)
      const roll = store.interpolateProjectValue?.('cam_roll', store.currentTime, store.project.cam_roll || 0) ?? (store.project.cam_roll || 0)
      const fov = clampFov(store.interpolateProjectValue?.('cam_fov', store.currentTime, store.project.cam_fov || 90) ?? (store.project.cam_fov || 90))
      const deg2rad = Math.PI / 180
      const maxPreview = 1024
      let prevW = canvasW
      let prevH = canvasH
      const scaleDown = clampImageDimension(Math.max(canvasW, canvasH) / maxPreview)
      if (scaleDown > 1.01) {
        prevW = clampImageDimension(Math.round(canvasW / scaleDown))
        prevH = clampImageDimension(Math.round(canvasH / scaleDown))
      }

      const sourceKey = layer.image_data || img.src
      const key = `${prevW}x${prevH}|${imgW}x${imgH}|${yaw}|${pitch}|${roll}|${fov}`
      const needRebuild = panoCache.key !== key || panoCache.sourceKey !== sourceKey

      if (needRebuild) {
        const srcCanvas = document.createElement('canvas')
        srcCanvas.width = imgW
        srcCanvas.height = imgH
        const sctx = srcCanvas.getContext('2d')
        if (sctx) {
          sctx.drawImage(img, 0, 0, imgW, imgH)
          panoCache.srcData = sctx.getImageData(0, 0, imgW, imgH).data
        } else {
          panoCache.srcData = undefined
        }

        const aspect = canvasW / clampImageDimension(canvasH)
        const tanHalfFov = Math.tan((fov * deg2rad) / 2)
        const yawRad = yaw * deg2rad
        const pitchRad = pitch * deg2rad
        const rollRad = roll * deg2rad
        const cy = Math.cos(yawRad), sy = Math.sin(yawRad)
        const cp = Math.cos(pitchRad), sp = Math.sin(pitchRad)
        const cr = Math.cos(rollRad), sr = Math.sin(rollRad)

        const mapX = new Float32Array(prevW * prevH)
        const mapY = new Float32Array(prevW * prevH)
        for (let yPix = 0; yPix < prevH; yPix++) {
          const ny = (yPix + 0.5) / prevH * 2 - 1
          for (let xPix = 0; xPix < prevW; xPix++) {
            const nx = (xPix + 0.5) / prevW * 2 - 1
            let vx = nx * tanHalfFov * aspect
            let vy = -ny * tanHalfFov
            let vz = 1
            const invLen = 1 / Math.hypot(vx, vy, vz)
            vx *= invLen; vy *= invLen; vz *= invLen

            // Apply yaw (Y), then pitch (X), then roll (Z)
            // Yaw
            let tx = cy * vx + sy * vz
            let tz = -sy * vx + cy * vz
            vx = tx; vz = tz
            // Pitch
            let ty = cp * vy - sp * vz
            tz = sp * vy + cp * vz
            vy = ty; vz = tz
            // Roll
            tx = cr * vx - sr * vy
            ty = sr * vx + cr * vy
            vx = tx; vy = ty

            const lon = Math.atan2(vx, vz)
            const lat = Math.asin(Math.max(-1, Math.min(1, vy)))
            const u = ((lon / (Math.PI * 2)) + 0.5) * imgW
            const v = ((0.5 - (lat / Math.PI))) * imgH
            let ui = Math.floor(u) % imgW; if (ui < 0) ui += imgW
            let vi = Math.floor(v); vi = Math.max(0, Math.min(imgH - 1, vi))
            const idx = yPix * prevW + xPix
            mapX[idx] = ui
            mapY[idx] = vi
          }
        }
        panoCache.key = key
        panoCache.sourceKey = sourceKey
        panoCache.mapX = mapX
        panoCache.mapY = mapY
        panoCache.imgW = imgW
        panoCache.imgH = imgH
        panoCache.outW = prevW
        panoCache.outH = prevH

        panoCache.canvas = document.createElement('canvas')
        panoCache.canvas.width = prevW
        panoCache.canvas.height = prevH
        panoCache.ctx = panoCache.canvas.getContext('2d')
      }

      const srcData = panoCache.srcData
      const mapX = panoCache.mapX
      const mapY = panoCache.mapY
      const pCanvas = panoCache.canvas
      const pCtx = panoCache.ctx
      const outW = panoCache.outW || 0
      const outH = panoCache.outH || 0
      if (srcData && mapX && mapY && pCanvas && pCtx && outW > 0 && outH > 0) {
        const dstImage = pCtx.getImageData(0, 0, outW, outH)
        const data = dstImage.data
        const len = outW * outH
        for (let idx = 0; idx < len; idx++) {
          const ui = mapX[idx]
          const vi = mapY[idx]
          const si = (vi * imgW + ui) * 4
          const di = idx * 4
          data[di] = srcData[si]
          data[di + 1] = srcData[si + 1]
          data[di + 2] = srcData[si + 2]
          data[di + 3] = 255
        }
        pCtx.putImageData(dstImage, 0, 0)
        // pano直接绘制到画布，填满整个画布
        ctx.drawImage(pCanvas, 0, 0, canvasW, canvasH)
        ctx.restore()
        return // pano渲染完成，直接返回
      } else {
        ctx.restore()
        return drawBackgroundLayer(ctx, { ...layer, panoFallback: true, type: layer.type, bg_mode: layer.bg_mode }, camOffsetX, camOffsetY, 1, false)
      }
    } else {
      if (imgW > 0 && imgH > 0) {
        if (mode === 'fit') {
          baseScale = Math.min(canvasW / imgW, canvasH / imgH)
        } else if (mode === 'fill') {
          baseScale = Math.max(canvasW / imgW, canvasH / imgH)
        } else if (mode === 'stretch') {
          baseScale = 1 // stretch mode: no base scale
        }
      }

      if (!Number.isFinite(baseScale) || baseScale <= 0) baseScale = 1

      // 背景图层渲染
      let bgX = props.x
      let bgY = props.y
      const bgZ = props.z || 0
      
      // 只开camera模式（非pano）下，背景也需要响应摄像机
      const cameraOnlyMode = cameraActive && !panoEnabled
      if (cameraOnlyMode) {
        const camYaw = store.interpolateProjectValue?.('cam_yaw', store.currentTime, store.project.cam_yaw ?? 0) ?? (store.project.cam_yaw ?? 0)
        const camPitch = store.interpolateProjectValue?.('cam_pitch', store.currentTime, store.project.cam_pitch ?? 0) ?? (store.project.cam_pitch ?? 0)
        const camFov = store.interpolateProjectValue?.('cam_fov', store.currentTime, store.project.cam_fov ?? 90) ?? (store.project.cam_fov ?? 90)
        const camPosX = store.interpolateProjectValue?.('cam_pos_x', store.currentTime, store.project.cam_pos_x ?? 0) ?? (store.project.cam_pos_x ?? 0)
        const camPosY = store.interpolateProjectValue?.('cam_pos_y', store.currentTime, store.project.cam_pos_y ?? 0) ?? (store.project.cam_pos_y ?? 0)
        const camPosZ = store.interpolateProjectValue?.('cam_pos_z', store.currentTime, store.project.cam_pos_z ?? 0) ?? (store.project.cam_pos_z ?? 0)
        
        // 摄像机位置影响背景偏移（反向）
        bgX -= camPosX
        bgY -= camPosY
        
        // 摄像机旋转影响背景位置
        if (camYaw !== 0 || camPitch !== 0) {
          const yawRad = camYaw * Math.PI / 180
          const pitchRad = camPitch * Math.PI / 180
          const fovFactor = Math.tan((camFov * Math.PI / 180) / 2)
          const moveScale = canvasW / (2 * fovFactor)
          bgX += Math.tan(yawRad) * moveScale
          bgY += Math.tan(pitchRad) * moveScale
        }
      }
      
      // Z深度产生的缩放效果
      const depthScale = calculateDepthScale(bgZ)
      
      // 摄像机Z轴产生的缩放效果（推拉）
      let cameraZScale = 1
      if (cameraOnlyMode) {
        const camPosZ = store.interpolateProjectValue?.('cam_pos_z', store.currentTime, store.project.cam_pos_z ?? 1000) ?? (store.project.cam_pos_z ?? 1000)
        cameraZScale = calculateCameraZScale(camPosZ)
      }
      
      // 最终位置和缩放
      const translateX = canvasW / 2 + bgX + camOffsetX
      const translateY = canvasH / 2 + bgY + camOffsetY
      const finalScale = (props.scale || 1) * baseScale * depthScale * cameraZScale
      
      if (!Number.isFinite(translateX) || !Number.isFinite(translateY) || !Number.isFinite(finalScale) || finalScale <= 0) {
        ctx.restore()
        return
      }
      
      ctx.translate(translateX, translateY)
      
      // 3D旋转效果（rotationX/rotationY）- Canvas 2D只能近似模拟
      if (props.rotationX !== 0 || props.rotationY !== 0) {
        const rx = (props.rotationX || 0) * Math.PI / 180
        const ry = (props.rotationY || 0) * Math.PI / 180
        const cosX = Math.cos(rx)
        const cosY = Math.cos(ry)
        ctx.scale(cosY, cosX)
      }
      
      // 使用rotationZ（如果有值）或rotation
      const actualRotation = props.rotationZ || props.rotation || 0
      ctx.rotate((actualRotation * Math.PI) / 180)
      ctx.scale(finalScale, finalScale)

      ctx.drawImage(img, -imgW / 2, -imgH / 2, imgW, imgH)
    }
    ctx.restore()
  }

  function drawForegroundLayer(ctx: CanvasRenderingContext2D, layer: any, camOffsetX = 0, camOffsetY = 0, cameraActive = false, cameraScale = 1) {
    const img = getCachedImage(layer)
    if (!img || img.width === 0 || img.height === 0) return

    const props = getLayerProps(layer)
    const w = img.width
    const h = img.height

    ensureMaskCanvas(layer, w, h)

    ctx.save()
    
    const panoActive = !!store.project.pano_enable
    
    let layerX = props.x
    let layerY = props.y
    const layerZ = props.z || 0
    
    // 前景图层跟随摄像机（pano模式和普通摄像机模式都需要）
    if (cameraActive || panoActive) {
      const camYaw = store.interpolateProjectValue?.('cam_yaw', store.currentTime, store.project.cam_yaw ?? 0) ?? (store.project.cam_yaw ?? 0)
      const camPitch = store.interpolateProjectValue?.('cam_pitch', store.currentTime, store.project.cam_pitch ?? 0) ?? (store.project.cam_pitch ?? 0)
      const camFov = store.interpolateProjectValue?.('cam_fov', store.currentTime, store.project.cam_fov ?? 90) ?? (store.project.cam_fov ?? 90)
      const camPosX = store.interpolateProjectValue?.('cam_pos_x', store.currentTime, store.project.cam_pos_x ?? 0) ?? (store.project.cam_pos_x ?? 0)
      const camPosY = store.interpolateProjectValue?.('cam_pos_y', store.currentTime, store.project.cam_pos_y ?? 0) ?? (store.project.cam_pos_y ?? 0)
      
      // 摄像机位置影响前景偏移（反向，与背景一致）- 仅在非pano模式下
      if (!panoActive) {
        layerX -= camPosX
        layerY -= camPosY
      }
      
      // 摄像机旋转影响前景位置（与背景方向一致）
      if (camYaw !== 0 || camPitch !== 0) {
        const yawRad = camYaw * Math.PI / 180
        const pitchRad = camPitch * Math.PI / 180
        const fovFactor = Math.tan((camFov * Math.PI / 180) / 2)
        const moveScale = store.project.width / (2 * fovFactor)
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
    
    // Z深度产生的缩放效果
    const depthScale = calculateDepthScale(layerZ)
    
    // 摄像机Z轴产生的缩放效果（推拉）- 仅在camera-only模式下
    let cameraZScale = 1
    if (cameraActive && !panoActive) {
      const camPosZ = store.interpolateProjectValue?.('cam_pos_z', store.currentTime, store.project.cam_pos_z ?? 1000) ?? (store.project.cam_pos_z ?? 1000)
      cameraZScale = calculateCameraZScale(camPosZ)
    }
    
    // 最终位置：图层位置 + 摄像机偏移
    const translateX = store.project.width / 2 + layerX + camOffsetX
    const translateY = store.project.height / 2 + layerY + camOffsetY
    
    if (!Number.isFinite(translateX) || !Number.isFinite(translateY)) {
      ctx.restore()
      return
    }
    
    ctx.translate(translateX, translateY)
    
    // 3D旋转效果（rotationX/rotationY）- Canvas 2D只能近似模拟
    if (props.rotationX !== 0 || props.rotationY !== 0) {
      const rx = props.rotationX * Math.PI / 180
      const ry = props.rotationY * Math.PI / 180
      
      const cosX = Math.cos(rx)
      const cosY = Math.cos(ry)
      
      // 简化的2D近似：只应用水平和垂直缩放来模拟3D旋转
      // rotationY影响水平缩放，rotationX影响垂直缩放
      ctx.scale(cosY, cosX)
    }
    
    // 使用rotationZ（如果有值）或rotation
    const actualRotation = props.rotationZ || props.rotation || 0
    ctx.rotate((actualRotation * Math.PI) / 180)
    const scaleApplied = props.scale * depthScale * cameraZScale
    ctx.scale(scaleApplied, scaleApplied)
    ctx.globalAlpha = props.opacity

    const anchorOffsetX = (props.anchorX || 0) * w
    const anchorOffsetY = (props.anchorY || 0) * h

    if (layer.maskCanvas) {
      if (!maskCompositeCache.canvas) {
        maskCompositeCache.canvas = document.createElement('canvas')
        maskCompositeCache.ctx = maskCompositeCache.canvas.getContext('2d')
      }

      const offscreen = maskCompositeCache.canvas
      const offCtx = maskCompositeCache.ctx

      if (offscreen && offCtx) {
        if (offscreen.width !== w) offscreen.width = w
        if (offscreen.height !== h) offscreen.height = h

        offCtx.save()
        offCtx.clearRect(0, 0, w, h)
        offCtx.globalCompositeOperation = 'source-over'
        offCtx.drawImage(img, 0, 0, w, h)
        offCtx.globalCompositeOperation = 'destination-in'
        offCtx.drawImage(layer.maskCanvas, 0, 0, w, h)
        offCtx.restore()

        ctx.drawImage(
          offscreen,
          -w / 2 - anchorOffsetX,
          -h / 2 - anchorOffsetY,
          w,
          h
        )
      } else {
        ctx.drawImage(img, -w / 2 - anchorOffsetX, -h / 2 - anchorOffsetY, w, h)
      }
    } else {
      ctx.drawImage(img, -w / 2 - anchorOffsetX, -h / 2 - anchorOffsetY, w, h)
    }

    if (props.mask_size > 0) {
      ctx.strokeStyle = '#3ac88e'
      ctx.lineWidth = 2 / props.scale
      ctx.setLineDash([5 / props.scale, 5 / props.scale])
      const maskW = w * props.mask_size
      const maskH = h * props.mask_size
      ctx.strokeRect(-maskW / 2, -maskH / 2, maskW, maskH)
      ctx.setLineDash([])
    }

    ctx.restore()
  }

  function drawBezierPath(ctx: CanvasRenderingContext2D, path: any[]) {
    if (!path || path.length === 0) return
    
    const centerX = store.project.width / 2
    const centerY = store.project.height / 2
    
    ctx.save()
    ctx.strokeStyle = '#ff6b6b'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    
    ctx.beginPath()
    ctx.moveTo(centerX + path[0].x, centerY + path[0].y)
    
    for (let i = 1; i < path.length; i++) {
      const p0 = path[i - 1]
      const p1 = path[i]
      
      const cp1x = p0.cp2x ?? (p0.x + (p1.x - p0.x) / 3)
      const cp1y = p0.cp2y ?? (p0.y + (p1.y - p0.y) / 3)
      const cp2x = p1.cp1x ?? (p0.x + (p1.x - p0.x) * 2 / 3)
      const cp2y = p1.cp1y ?? (p0.y + (p1.y - p0.y) * 2 / 3)
      
      ctx.bezierCurveTo(
        centerX + cp1x, centerY + cp1y,
        centerX + cp2x, centerY + cp2y,
        centerX + p1.x, centerY + p1.y
      )
    }
    ctx.stroke()
    ctx.setLineDash([])
    
    path.forEach((pt, i) => {
      ctx.beginPath()
      ctx.arc(centerX + pt.x, centerY + pt.y, 6, 0, Math.PI * 2)
      ctx.fillStyle = i === 0 ? '#4ecdc4' : (i === path.length - 1 ? '#ff6b6b' : '#ffe66d')
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()
    })

    if (path.length >= 2) {
      const lastIndex = path.length - 1
      const p0 = path[lastIndex - 1]
      const p1 = path[lastIndex]

      const cp1x = p0.cp2x ?? (p0.x + (p1.x - p0.x) / 3)
      const cp1y = p0.cp2y ?? (p0.y + (p1.y - p0.y) / 3)
      const cp2x = p1.cp1x ?? (p0.x + (p1.x - p0.x) * 2 / 3)
      const cp2y = p1.cp1y ?? (p0.y + (p1.y - p0.y) * 2 / 3)
      const t = 0.99
      const mt = 1 - t
      const dx =
        3 * mt * mt * (cp1x - p0.x) +
        6 * mt * t * (cp2x - cp1x) +
        3 * t * t * (p1.x - cp2x)
      const dy =
        3 * mt * mt * (cp1y - p0.y) +
        6 * mt * t * (cp2y - cp1y) +
        3 * t * t * (p1.y - cp2y)

      const angle = Math.atan2(dy, dx)
      const endX = centerX + p1.x
      const endY = centerY + p1.y
      const arrowLen = 18

      ctx.beginPath()
      ctx.moveTo(endX, endY)
      ctx.lineTo(
        endX - arrowLen * Math.cos(angle - Math.PI / 6),
        endY - arrowLen * Math.sin(angle - Math.PI / 6)
      )
      ctx.moveTo(endX, endY)
      ctx.lineTo(
        endX - arrowLen * Math.cos(angle + Math.PI / 6),
        endY - arrowLen * Math.sin(angle + Math.PI / 6)
      )
      ctx.strokeStyle = '#ff6b6b'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    ctx.restore()
  }

  function drawExtractOverlay(ctx: CanvasRenderingContext2D) {
    // Extract overlay is drawn on interaction canvas, not main canvas
    // This function is kept for compatibility but does nothing
  }

  function drawBezierPathOnCtx(iCtx: CanvasRenderingContext2D, path: any[]) {
    if (!path || path.length === 0) return
    
    const centerX = store.project.width / 2
    const centerY = store.project.height / 2
    
    iCtx.save()
    iCtx.strokeStyle = '#ff6b6b'
    iCtx.lineWidth = 2
    iCtx.setLineDash([5, 5])
    
    iCtx.beginPath()
    iCtx.moveTo(centerX + path[0].x, centerY + path[0].y)
    
    for (let i = 1; i < path.length; i++) {
      const p0 = path[i - 1]
      const p1 = path[i]
      
      const cp1x = p0.cp2x ?? (p0.x + (p1.x - p0.x) / 3)
      const cp1y = p0.cp2y ?? (p0.y + (p1.y - p0.y) / 3)
      const cp2x = p1.cp1x ?? (p0.x + (p1.x - p0.x) * 2 / 3)
      const cp2y = p1.cp1y ?? (p0.y + (p1.y - p0.y) * 2 / 3)
      
      iCtx.bezierCurveTo(
        centerX + cp1x, centerY + cp1y,
        centerX + cp2x, centerY + cp2y,
        centerX + p1.x, centerY + p1.y
      )
    }
    iCtx.stroke()
    iCtx.setLineDash([])
    
    path.forEach((pt, i) => {
      iCtx.beginPath()
      iCtx.arc(centerX + pt.x, centerY + pt.y, 6, 0, Math.PI * 2)
      iCtx.fillStyle = i === 0 ? '#4ecdc4' : (i === path.length - 1 ? '#ff6b6b' : '#ffe66d')
      iCtx.fill()
      iCtx.strokeStyle = '#fff'
      iCtx.lineWidth = 2
      iCtx.stroke()
    })
    
    iCtx.restore()
  }

  function drawExtractOverlayOnCtx(iCtx: CanvasRenderingContext2D) {
    // This is now handled by interaction composable
    // Kept here for compatibility
  }

  function drawMaskOverlayOnCtx(iCtx: CanvasRenderingContext2D) {
    const layer = store.currentLayer
    if (!layer || !layer.maskCanvas || !layer.img) return
    
    const props = getLayerProps(layer)
    const imgW = layer.img.width
    const imgH = layer.img.height
    const canvasW = store.project.width
    const canvasH = store.project.height
    const centerX = canvasW / 2
    const centerY = canvasH / 2
    
    // 获取摄像机偏移
    const camOffsetX = store.interpolateProjectValue?.('cam_offset_x', store.currentTime, store.project.cam_offset_x ?? 0) ?? (store.project.cam_offset_x ?? 0)
    const camOffsetY = store.interpolateProjectValue?.('cam_offset_y', store.currentTime, store.project.cam_offset_y ?? 0) ?? (store.project.cam_offset_y ?? 0)
    
    const layerZ = props.z || 0
    // Z轴深度效果
    const depthScale = calculateDepthScale(layerZ)
    
    // 与前景图层渲染一致的位置计算
    const finalX = props.x + camOffsetX
    const finalY = props.y + camOffsetY
    const finalScale = props.scale * depthScale
    
    iCtx.save()
    iCtx.globalAlpha = 0.5
    iCtx.translate(centerX + finalX, centerY + finalY)
    
    const actualRotation = props.rotationZ !== undefined && props.rotationZ !== 0 ? props.rotationZ : props.rotation
    iCtx.rotate((actualRotation * Math.PI) / 180)
    iCtx.scale(finalScale, finalScale)
    
    iCtx.fillStyle = 'rgba(255, 0, 0, 0.3)'
    iCtx.fillRect(-imgW / 2, -imgH / 2, imgW, imgH)
    
    iCtx.globalCompositeOperation = 'destination-out'
    iCtx.drawImage(layer.maskCanvas, -imgW / 2, -imgH / 2, imgW, imgH)
    
    iCtx.restore()
  }

  function drawSelectionBorder(iCtx: CanvasRenderingContext2D) {
    const layer = store.currentLayer
    if (!layer || !layer.img) return
    
    const props = getLayerProps(layer)
    const imgW = layer.img.width
    const imgH = layer.img.height
    const canvasW = store.project.width
    const canvasH = store.project.height
    const centerX = canvasW / 2
    const centerY = canvasH / 2
    
    // 获取摄像机参数
    const cameraActive = !!store.project.cam_enable
    const panoActive = !!store.project.pano_enable
    const camOffsetX = store.interpolateProjectValue?.('cam_offset_x', store.currentTime, store.project.cam_offset_x ?? 0) ?? (store.project.cam_offset_x ?? 0)
    const camOffsetY = store.interpolateProjectValue?.('cam_offset_y', store.currentTime, store.project.cam_offset_y ?? 0) ?? (store.project.cam_offset_y ?? 0)
    
    const layerZ = props.z || 0
    // Z轴深度效果
    const depthScale = calculateDepthScale(layerZ)
    
    // 与前景图层渲染一致的位置计算
    let layerX = props.x
    let layerY = props.y
    
    // 前景图层跟随摄像机旋转（与drawForegroundLayer保持一致）
    if ((cameraActive || panoActive) && layer.type !== 'background') {
      const camYaw = store.interpolateProjectValue?.('cam_yaw', store.currentTime, store.project.cam_yaw ?? 0) ?? (store.project.cam_yaw ?? 0)
      const camPitch = store.interpolateProjectValue?.('cam_pitch', store.currentTime, store.project.cam_pitch ?? 0) ?? (store.project.cam_pitch ?? 0)
      const camFov = store.interpolateProjectValue?.('cam_fov', store.currentTime, store.project.cam_fov ?? 90) ?? (store.project.cam_fov ?? 90)
      const camPosX = store.interpolateProjectValue?.('cam_pos_x', store.currentTime, store.project.cam_pos_x ?? 0) ?? (store.project.cam_pos_x ?? 0)
      const camPosY = store.interpolateProjectValue?.('cam_pos_y', store.currentTime, store.project.cam_pos_y ?? 0) ?? (store.project.cam_pos_y ?? 0)
      
      // 摄像机位置影响前景偏移（反向，与背景一致）- 仅在非pano模式下
      if (!panoActive) {
        layerX -= camPosX
        layerY -= camPosY
      }
      
      if (camYaw !== 0 || camPitch !== 0) {
        const yawRad = camYaw * Math.PI / 180
        const pitchRad = camPitch * Math.PI / 180
        const fovFactor = Math.tan((camFov * Math.PI / 180) / 2)
        const moveScale = canvasW / (2 * fovFactor)
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
    
    let finalX = layerX + camOffsetX
    let finalY = layerY + camOffsetY
    let finalScale = props.scale * depthScale
    
    if (layer.type === 'background' && imgW > 0 && imgH > 0) {
      const mode = layer.bg_mode || 'fit'
      let baseScale = 1
      if (mode === 'fit') baseScale = Math.min(canvasW / imgW, canvasH / imgH)
      else if (mode === 'fill') baseScale = Math.max(canvasW / imgW, canvasH / imgH)
      else baseScale = Math.min(canvasW / imgW, canvasH / imgH)
      finalScale = props.scale * baseScale * depthScale
    }
    
    if (!Number.isFinite(finalScale) || finalScale <= 0) finalScale = 1
    
    iCtx.save()
    iCtx.translate(centerX + finalX, centerY + finalY)
    
    const actualRotation = props.rotationZ !== undefined && props.rotationZ !== 0 ? props.rotationZ : props.rotation
    iCtx.rotate((actualRotation * Math.PI) / 180)
    iCtx.scale(finalScale, finalScale)
    
    iCtx.strokeStyle = '#3a7bc8'
    iCtx.lineWidth = 2 / finalScale
    iCtx.strokeRect(-imgW / 2, -imgH / 2, imgW, imgH)
    
    iCtx.fillStyle = '#3a7bc8'
    const corners = [[-imgW/2, -imgH/2], [imgW/2, -imgH/2], [imgW/2, imgH/2], [-imgW/2, imgH/2]]
    corners.forEach(([cx, cy]) => {
      iCtx.fillRect(cx - 4/finalScale, cy - 4/finalScale, 8/finalScale, 8/finalScale)
    })
    
    iCtx.restore()
  }

  function cleanup() {
    imageCache.clear()
    maskCompositeCache.canvas = null
    maskCompositeCache.ctx = null
    if (gpuRenderer) {
      gpuRenderer.cleanup()
      gpuRenderer = null
    }
    gpuContext = null
  }

  function resetPanoCache() {
    panoCache.key = undefined
    panoCache.sourceKey = undefined
    panoCache.mapX = undefined
    panoCache.mapY = undefined
    panoCache.srcData = undefined
    panoCache.imgW = undefined
    panoCache.imgH = undefined
    panoCache.canvas = undefined
    panoCache.ctx = null
    panoCache.outW = undefined
    panoCache.outH = undefined
  }

  function invalidateLayerCache(layerId: string) {
    imageCache.delete(layerId)
    if (gpuRenderer) {
      gpuRenderer.invalidateTexture(layerId)
      gpuRenderer.invalidateTexture(`${layerId}_mask`)
    }
  }

  function clearCaches() {
    imageCache.clear()
    resetPanoCache()
    gpuRenderer?.clearTextureCache()
  }

  function toggleGPU(enable: boolean) {
    if (enable) {
      localStorage.removeItem('timeline_disable_gpu')
      console.log('[Timeline] GPU rendering will be enabled on next reload')
    } else {
      localStorage.setItem('timeline_disable_gpu', 'true')
      console.log('[Timeline] GPU rendering will be disabled on next reload')
    }
  }

  return {
    initContexts,
    scheduleRender,
    render,
    getCachedImage,
    getLayerProps,
    setDrawExtractOverlayOnCtx,
    setDrawBrushPreviewOnCtx,
    cleanup,
    panoCache,
    imageCache,
    gpuRenderer,
    isUsingGPU: () => useGPU,
    toggleGPU,
    getGPUStats: () => gpuRenderer?.getCacheStats() || null,
    getPerformanceStats: () => gpuRenderer?.getPerformanceStats() || null,
    resetPerformanceStats: () => gpuRenderer?.resetPerformanceStats(),
    invalidateLayerCache,
    clearCaches
  }
}
