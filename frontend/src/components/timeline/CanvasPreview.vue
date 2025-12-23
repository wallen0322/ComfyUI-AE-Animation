<template>
  <div class="canvas-preview" ref="containerRef">
    <div class="canvas-wrapper">
      <div
        v-if="isCssPreviewMode"
        class="css-preview"
        :style="cssPreviewStyle"
      >
        <div class="css-camera" :style="cssCameraStyle">
          <div
            v-for="(layer, idx) in cssLayers"
            :key="layer.id"
            class="css-layer"
            :style="{
              width: layer.width + 'px',
              height: layer.height + 'px',
              opacity: layer.opacity,
              transform: layer.transform,
              transformOrigin: layer.origin,
              zIndex: idx
            }"
          >
            <img :src="layer.src" :alt="layer.id" draggable="false" />
          </div>
        </div>
        <div class="axis-widget" :style="axisWidgetStyle">
          <div class="axis axis-x"></div>
          <div class="axis axis-y"></div>
          <div class="axis axis-z"></div>
          <div class="axis-label axis-label-x">X</div>
          <div class="axis-label axis-label-y">Y</div>
          <div class="axis-label axis-label-z">Z</div>
        </div>
      </div>

      <canvas 
        ref="canvasRef"
        :width="store.project.width"
        :height="store.project.height"
        :class="['render-canvas', { 'css-mode-hidden': isCssPreviewMode }]"
      />
      <canvas 
        ref="interactionCanvasRef"
        :width="store.project.width"
        :height="store.project.height"
        class="interaction-canvas"
        :class="{ 'css-mode': isCssPreviewMode }"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseLeave"
        @wheel.prevent="onWheel"
        @contextmenu.prevent
        tabindex="0"
        @keydown="onKeyDown"
      />
      <div class="canvas-info">
        <span v-if="store.currentLayer">
          Layer {{ store.currentLayerIndex + 1 }} | X:{{ Math.round(store.currentLayer.x || 0) }} Y:{{ Math.round(store.currentLayer.y || 0) }} S:{{ (store.currentLayer.scale || 1).toFixed(2) }} R:{{ Math.round(store.currentLayer.rotation || 0) }}°
        </span>
        <span v-else>No layer selected</span>
        <span v-if="store.project.cam_enable" style="color: #ff9800; margin-left: 10px;">
          📷 3D Camera (Preview Approximation)
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, computed } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore'
import { useCanvasRenderer } from '@/composables/useCanvasRenderer'
import { useCanvasInteraction } from '@/composables/useCanvasInteraction'
import { buildCSSTransform, buildPerspective, buildTransformOrigin, sortLayersByDepth } from '@/composables/useTransform3D'

const store = useTimelineStore()
const canvasRef = ref<HTMLCanvasElement>()
const interactionCanvasRef = ref<HTMLCanvasElement>()
const containerRef = ref<HTMLDivElement>()

const renderer = useCanvasRenderer(store, canvasRef, interactionCanvasRef)
const {
  initContexts,
  scheduleRender,
  renderInteractionLayer,
  getCachedImage,
  getLayerProps,
  setDrawExtractOverlayOnCtx,
  setDrawBrushPreviewOnCtx,
  cleanup
} = renderer

const isCssPreviewMode = computed(() =>
  store.project.preview_mode === '3d-css' &&
  !store.maskMode.enabled &&
  !store.extractMode.enabled &&
  !store.pathMode.enabled
)

const sceneCenter = computed(() => ({
  x: Math.max(0, (store.project.width || 0) / 2),
  y: Math.max(0, (store.project.height || 0) / 2)
}))

const cssCamera = computed(() => ({
  cam_pos_x: store.project.cam_pos_x ?? 0,
  cam_pos_y: store.project.cam_pos_y ?? 0,
  cam_pos_z: store.project.cam_pos_z ?? 1000,
  cam_yaw: store.project.cam_yaw ?? 0,
  cam_pitch: store.project.cam_pitch ?? 0,
  cam_roll: store.project.cam_roll ?? 0,
  cam_fov: store.project.cam_fov ?? 90
}))

const cssPerspective = computed(() => {
  const h = Math.max(1, store.project.height || 1)
  return buildPerspective(cssCamera.value.cam_fov, h)
})

const cssPreviewStyle = computed(() => ({
  width: `${store.project.width}px`,
  height: `${store.project.height}px`,
  perspective: `${Math.round(cssPerspective.value)}px`,
  perspectiveOrigin: '50% 50%',
  transformStyle: 'preserve-3d'
}))

const cssCameraStyle = computed(() => {
  const transforms: string[] = []
  const cam = cssCamera.value
  const offsetX = store.project.cam_offset_x || 0
  const offsetY = store.project.cam_offset_y || 0

  // Move to scene center first
  transforms.push(`translate3d(${sceneCenter.value.x}px, ${sceneCenter.value.y}px, 0px)`)

  // Apply camera view transform (inverse: move scene opposite to camera)
  const tx = -(cam.cam_pos_x + offsetX)
  const ty = -(cam.cam_pos_y + offsetY)
  const tz = -(cam.cam_pos_z || 0)

  transforms.push(`translate3d(${tx}px, ${ty}px, ${tz}px)`)

  if (store.project.cam_enable) {
    // Camera rotations (inverse)
    if (cam.cam_pitch !== 0) transforms.push(`rotateX(${-cam.cam_pitch}deg)`)
    if (cam.cam_yaw !== 0) transforms.push(`rotateY(${-cam.cam_yaw}deg)`)
    if (cam.cam_roll !== 0) transforms.push(`rotateZ(${-cam.cam_roll}deg)`)

    // Distance-based scale (same heuristic as canvas preview)
    const camScale = Math.max(0.2, Math.min(4, 1 / (1 + (cam.cam_pos_z ?? 1000) * 0.001)))
    if (camScale !== 1) transforms.push(`scale(${camScale})`)
  }

  return { transform: transforms.join(' ') || undefined, transformStyle: 'preserve-3d' }
})

const cssLayers = computed(() => {
  if (!isCssPreviewMode.value) return []

  const layers = store.layers.map((layer: any) => {
    const img = getCachedImage(layer)
    if (!img || !img.complete) return null

    const projW = Math.max(1, store.project.width || 1)
    const projH = Math.max(1, store.project.height || 1)
    const props = getLayerProps(layer)

    // Apply the same background fit logic as the canvas renderer
    let baseScale = 1
    if (layer.type === 'background' && img.width && img.height) {
      const mode = layer.bg_mode || 'fit'
      if (mode === 'fit') baseScale = Math.min(projW / img.width, projH / img.height)
      else if (mode === 'fill') baseScale = Math.max(projW / img.width, projH / img.height)
      else baseScale = Math.min(projW / img.width, projH / img.height)
      if (!Number.isFinite(baseScale) || baseScale <= 0) baseScale = 1
    }

    const scaleX = (layer.scaleX ?? props.scale ?? 1) * baseScale
    const scaleY = (layer.scaleY ?? props.scale ?? 1) * baseScale
    const scaleZ = layer.scaleZ ?? 1

    const posX = props.x
    const posY = props.y
    const posZ = props.z || 0

    const rotationZ = props.rotationZ !== undefined && props.rotationZ !== 0 ? props.rotationZ : props.rotation

    const transform = buildCSSTransform({
      x: posX,
      y: posY,
      z: posZ,
      rotationX: props.rotationX || 0,
      rotationY: props.rotationY || 0,
      rotationZ: rotationZ || 0,
      scaleX,
      scaleY,
      scaleZ,
      anchorX: layer.anchorX ?? 0,
      anchorY: layer.anchorY ?? 0,
      opacity: props.opacity ?? 1
    }, img.width, img.height)

    return {
      id: layer.id,
      type: layer.type,
      src: img.src || layer.image_data,
      width: img.width,
      height: img.height,
      opacity: props.opacity ?? 1,
      transform,
      origin: buildTransformOrigin(layer.anchorX ?? 0, layer.anchorY ?? 0),
      x: posX,
      y: posY,
      z: posZ
    }
  }).filter(Boolean) as Array<{
    id: string
    type: string
    src: string
    width: number
    height: number
    opacity: number
    transform: string
    origin: string
    x: number
    y: number
    z: number
  }>

  const camera = {
    cam_pos_x: cssCamera.value.cam_pos_x,
    cam_pos_y: cssCamera.value.cam_pos_y,
    cam_pos_z: cssCamera.value.cam_pos_z,
    cam_yaw: cssCamera.value.cam_yaw,
    cam_pitch: cssCamera.value.cam_pitch,
    cam_roll: cssCamera.value.cam_roll,
    cam_fov: cssCamera.value.cam_fov
  }

  const sorted = sortLayersByDepth(layers, camera)
  // Keep original order for layers with identical depth by stable sort
  return sorted
})

const axisWidgetStyle = computed(() => {
  const cam = cssCamera.value
  const transforms: string[] = []
  transforms.push('translate3d(0, 0, 0)')
  // Apply inverse camera rotation to axes to reflect camera orientation
  if (cam.cam_pitch) transforms.push(`rotateX(${-cam.cam_pitch}deg)`)
  if (cam.cam_yaw) transforms.push(`rotateY(${-cam.cam_yaw}deg)`)
  if (cam.cam_roll) transforms.push(`rotateZ(${-cam.cam_roll}deg)`)
  transforms.push('scale(0.6)')
  return { transform: transforms.join(' ') || undefined }
})

const interaction = useCanvasInteraction(
  store,
  canvasRef,
  interactionCanvasRef,
  scheduleRender,
  getLayerProps,
  getCachedImage,
  renderer.renderInteractionLayer
)

const {
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onWheel,
  onKeyDown,
  clearExtractSelection,
  applyExtractSelection,
  drawExtractOverlayOnCtx,
  drawBrushPreviewOnCtx
} = interaction

setDrawExtractOverlayOnCtx(drawExtractOverlayOnCtx)
setDrawBrushPreviewOnCtx(drawBrushPreviewOnCtx)

onMounted(() => {
  initContexts()
  scheduleRender()
})

onUnmounted(() => {
  cleanup()
})

const requestCanvasRender = () => {
  if (!isCssPreviewMode.value) {
    scheduleRender()
  }
}

watch(() => [store.layers, store.currentLayer, store.currentTime], () => {
  requestCanvasRender()
}, { deep: true })

watch(() => store.project, () => {
  requestCanvasRender()
}, { deep: true })

// Watch camera parameters specifically for real-time preview
watch(() => [
  store.project.cam_enable,
  store.project.cam_pos_x,
  store.project.cam_pos_y,
  store.project.cam_pos_z,
  store.project.cam_offset_x,
  store.project.cam_offset_y,
  store.project.cam_yaw,
  store.project.cam_pitch,
  store.project.cam_roll,
  store.project.cam_fov,
  store.project.pano_enable
], () => {
  requestCanvasRender()
})

watch(() => store.extractMode.enabled, () => {
  requestCanvasRender()
})

watch(() => [store.maskMode.enabled, store.pathMode.enabled], () => {
  requestCanvasRender()
})

watch(() => [store.maskMode.brush, store.maskMode.erase, store.extractMode.brush], () => {
  renderInteractionLayer()
})

watch(isCssPreviewMode, (next) => {
  if (!next) {
    scheduleRender()
  }
})

defineExpose({
  clearExtractSelection,
  applyExtractSelection,
  scheduleRender,
  renderer
})
</script>

<style scoped>
.canvas-preview {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: visible;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
}

.canvas-wrapper {
  position: relative;
  display: inline-block;
}

.render-canvas {
  display: block;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
  outline: none;
  will-change: contents;
  image-rendering: -webkit-optimize-contrast;
  box-sizing: border-box;
}

.render-canvas.css-mode-hidden {
  visibility: hidden;
  pointer-events: none;
}

.interaction-canvas {
  position: absolute;
  top: 0;
  left: 0;
  cursor: move;
  outline: none;
  box-sizing: border-box;
  z-index: 10;
  background: transparent;
}

.interaction-canvas:focus {
  outline: 2px solid #3a7bc8;
}

canvas {
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
  cursor: move;
  outline: none;
  will-change: contents;
  transform: translateZ(0);
  image-rendering: -webkit-optimize-contrast;
  box-sizing: border-box;
  display: block;
  contain: layout style paint;
}

canvas:focus {
  box-shadow: 0 0 0 2px #3a7bc8, 0 4px 24px rgba(0, 0, 0, 0.5);
}

.canvas-info {
  position: relative;
  margin-top: 8px;
  margin-left: auto;
  margin-right: auto;
  width: fit-content;
  background: rgba(0, 0, 0, 0.8);
  color: #aaa;
  font-size: 11px;
  padding: 4px 12px;
  border-radius: 4px;
  white-space: nowrap;
  z-index: 20;
  pointer-events: auto;
  text-align: center;
  display: flex;
  align-items: center;
  gap: 10px;
}

.css-preview {
  position: absolute;
  top: 0;
  left: 0;
  transform-style: preserve-3d;
  background: radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.04), transparent 40%), radial-gradient(circle at 80% 0%, rgba(255, 255, 255, 0.04), transparent 40%), #0f0f0f;
  overflow: hidden;
}

.css-camera {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
}

.css-layer {
  position: absolute;
  top: 0;
  left: 0;
  transform-style: preserve-3d;
  will-change: transform;
}

.css-layer img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  pointer-events: none;
}

.interaction-canvas.css-mode {
  opacity: 0;
}

.axis-widget {
  position: absolute;
  top: 12px;
  left: 12px;
  width: 64px;
  height: 64px;
  transform-style: preserve-3d;
  pointer-events: none;
}

.axis {
  position: absolute;
  bottom: 8px;
  left: 8px;
  width: 40px;
  height: 2px;
  transform-origin: left center;
  border-radius: 2px;
}

.axis-x {
  background: #e74c3c;
  transform: rotateZ(0deg);
}

.axis-y {
  background: #2ecc71;
  transform: rotateZ(90deg);
  width: 40px;
}

.axis-z {
  background: #3498db;
  width: 32px;
  transform: rotateX(90deg);
}

.axis-label {
  position: absolute;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.6);
}

.axis-label-x { left: 46px; bottom: 4px; color: #e74c3c; }
.axis-label-y { left: 4px; bottom: 48px; color: #2ecc71; }
.axis-label-z { left: 28px; bottom: 28px; color: #3498db; }
</style>
