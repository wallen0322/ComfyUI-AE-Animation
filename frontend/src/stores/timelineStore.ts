import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface Keyframe {
  time: number
  value: number
}

export interface BezierPoint {
  x: number
  y: number
  cp1x?: number  // 控制点1
  cp1y?: number
  cp2x?: number  // 控制点2
  cp2y?: number
  time?: number  // 该点对应的时间
}

export interface Layer {
  id: string
  name: string
  type: 'foreground' | 'background'
  image_data?: string
  img?: HTMLImageElement
  // 2D 变换
  x: number
  y: number
  z?: number
  scale: number
  rotation: number
  opacity: number
  // 3D 模式
  is3D?: boolean      // 是否启用 3D 模式
  // 3D 旋转
  rotationX?: number  // X轴旋转 (pitch)
  rotationY?: number  // Y轴旋转 (yaw)
  rotationZ?: number  // Z轴旋转 (roll)
  // 3D 缩放
  scaleX?: number     // X轴缩放
  scaleY?: number     // Y轴缩放
  scaleZ?: number     // Z轴缩放
  // 锚点
  anchorX?: number    // 锚点X
  anchorY?: number    // 锚点Y
  perspective?: number // 透视距离
  // Mask
  mask_size: number
  customMask?: string
  maskCanvas?: HTMLCanvasElement
  maskVersion?: number
  // 路径动画
  bezierPath?: BezierPoint[]
  usePathAnimation?: boolean
  // 其他
  keyframes: Record<string, Keyframe[]>
  bg_mode?: 'fit' | 'fill' | 'stretch'
  [key: string]: any
}

export interface Project {
  width: number
  height: number
  fps: number
  duration: number
  total_frames: number
  mask_expansion: number
  mask_feather: number
  hdr_enable: boolean
  hdr_exposure: number
  pano_enable: boolean
  cam_enable?: boolean  // 3D 摄像机开关
  cam_yaw: number
  cam_pitch: number
  cam_roll: number
  cam_fov: number
  cam_offset_x?: number
  cam_offset_y?: number
  cam_pos_x?: number
  cam_pos_y?: number
  cam_pos_z?: number
  preview_mode?: '2d' | '3d-css'
}

export interface ProjectKeyframes {
  [prop: string]: Keyframe[]
}

function getSafeDuration(p: Project) {
  const fps = Math.max(1, p.fps || 1)
  return p.duration || (p.total_frames / fps)
}

export const useTimelineStore = defineStore('timeline', () => {
  // Project settings
  const project = ref<Project>({
    width: 1280,
    height: 720,
    fps: 30,
    duration: 5,
    total_frames: 150,
    mask_expansion: 0,
    mask_feather: 0,
    hdr_enable: false,
    hdr_exposure: 0,
    pano_enable: false,
    cam_enable: false,
    cam_yaw: 0,
    cam_pitch: 0,
    cam_roll: 0,
    cam_fov: 90,
    cam_offset_x: 0,
    cam_offset_y: 0,
    cam_pos_x: 0,
    cam_pos_y: 0,
    cam_pos_z: 1000,
    preview_mode: '2d'  // '2d' or '3d-css'
  })
  const projectKeyframes = ref<ProjectKeyframes>({})

  // Layers
  const layers = ref<Layer[]>([])
  const currentLayerIndex = ref<number>(-1)
  const cameraSelected = ref<boolean>(false)  // 是否选中Camera图层

  // Playback
  const currentTime = ref<number>(0)
  const currentFrame = ref<number>(0)
  const isPlaying = ref<boolean>(false)

  // Tools
  const maskMode = ref({
    enabled: false,
    drawing: false,
    erase: false,
    brush: 20
  })

  const pathMode = ref({
    enabled: false,
    data: null as any
  })

  const extractMode = ref({
    enabled: false,
    drawing: false,
    brush: 30,
    blurType: 'gaussian'
  })

  // Computed
  const currentLayer = computed(() => {
    if (currentLayerIndex.value >= 0 && currentLayerIndex.value < layers.value.length) {
      return layers.value[currentLayerIndex.value]
    }
    return null
  })

  const foregroundLayers = computed(() => 
    layers.value.filter(l => l.type === 'foreground')
  )

  const backgroundLayer = computed(() => 
    layers.value.find(l => l.type === 'background')
  )

  // Actions
  function setProject(data: Partial<Project>) {
    const fps = Math.max(1, data.fps ?? project.value.fps)
    const hasDuration = typeof data.duration === 'number'
    const hasTotalFrames = typeof data.total_frames === 'number'

    const next: Project = {
      ...project.value,
      ...data,
      fps
    }

    if (hasDuration && !hasTotalFrames) {
      next.total_frames = Math.max(1, Math.round((next.duration || 0) * fps))
    } else if (hasTotalFrames && !hasDuration) {
      next.total_frames = Math.max(1, Math.round(next.total_frames))
      next.duration = next.total_frames / fps
    } else {
      next.total_frames = Math.max(1, Math.round(next.total_frames || (next.duration * fps)))
      next.duration = next.duration || (next.total_frames / fps)
    }

    Object.assign(project.value, next)
  }
  function setProjectKeyframe(prop: string, time: number, value: number) {
    if (!projectKeyframes.value[prop]) projectKeyframes.value[prop] = []
    const arr = projectKeyframes.value[prop]
    const existing = arr.find(k => Math.abs(k.time - time) < 1e-3)
    if (existing) existing.value = value
    else arr.push({ time, value })
    arr.sort((a, b) => a.time - b.time)
  }

  function deleteProjectKeyframe(prop: string, time: number) {
    const arr = projectKeyframes.value[prop]
    if (!arr) return
    projectKeyframes.value[prop] = arr.filter(k => Math.abs(k.time - time) > 1e-3)
  }

  function interpolateProjectValue(prop: string, time: number, fallback: number) {
    const arr = projectKeyframes.value[prop]
    if (!arr || arr.length === 0) return fallback
    const sorted = [...arr].sort((a, b) => a.time - b.time)
    if (time <= sorted[0].time) return sorted[0].value
    if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value
    for (let i = 0; i < sorted.length - 1; i++) {
      const k1 = sorted[i]
      const k2 = sorted[i + 1]
      if (time >= k1.time && time <= k2.time) {
        const t = (time - k1.time) / Math.max(1e-6, k2.time - k1.time)
        return k1.value + (k2.value - k1.value) * t
      }
    }
    return fallback
  }

  function addLayer(layer: Layer) {
    layers.value.push({
      z: 0,
      is3D: false,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      anchorX: 0,
      anchorY: 0,
      perspective: 1000,
      ...layer
    })
    // 自动选中新添加的图层
    currentLayerIndex.value = layers.value.length - 1
  }

  function removeLayer(index: number) {
    if (index >= 0 && index < layers.value.length) {
      layers.value.splice(index, 1)
      if (currentLayerIndex.value >= layers.value.length) {
        currentLayerIndex.value = layers.value.length - 1
      }
    }
  }

  function clearLayers() {
    layers.value = []
    currentLayerIndex.value = -1
  }

  function selectLayer(index: number) {
    if (index >= 0 && index < layers.value.length) {
      currentLayerIndex.value = index
      cameraSelected.value = false  // 选中图层时取消Camera选中
    }
  }

  function selectCameraLayer() {
    cameraSelected.value = true
    currentLayerIndex.value = -1  // 取消图层选中
  }

  function deselectAll() {
    cameraSelected.value = false
    currentLayerIndex.value = -1
  }

  function updateLayer(index: number, updates: Partial<Layer>) {
    if (index >= 0 && index < layers.value.length) {
      // Update layer properties - Vue's reactivity should handle this
      const layer = layers.value[index]
      Object.assign(layer, updates)
      // Trigger reactivity by updating the array reference
      // This ensures watchers detect the change
      const updatedLayers = [...layers.value]
      updatedLayers[index] = { ...layer }
      layers.value = updatedLayers
    }
  }

  function setCurrentTime(time: number) {
    const duration = getSafeDuration(project.value)
    currentTime.value = Math.max(0, Math.min(time, duration))
    currentFrame.value = Math.floor(currentTime.value * project.value.fps)
  }

  function setCurrentFrame(frame: number) {
    const totalFrames = Math.max(
      1,
      Math.round(project.value.total_frames || getSafeDuration(project.value) * project.value.fps)
    )
    currentFrame.value = Math.max(0, Math.min(frame, totalFrames - 1))
    currentTime.value = currentFrame.value / project.value.fps
  }

  let playbackId: number | null = null
  let lastPlayTime = 0

  function togglePlayback() {
    isPlaying.value = !isPlaying.value
    if (isPlaying.value) {
      startPlayback()
    } else {
      stopPlaybackLoop()
    }
  }

  function startPlayback() {
    if (playbackId !== null) return
    lastPlayTime = performance.now()
    playbackLoop()
  }

  function playbackLoop() {
    if (!isPlaying.value) return
    
    const now = performance.now()
    const deltaTime = (now - lastPlayTime) / 1000  // 转换为秒
    lastPlayTime = now
    
    let newTime = currentTime.value + deltaTime
    const duration = getSafeDuration(project.value)
    
    // 循环播放
    if (newTime >= duration) {
      newTime = 0
    }
    
    setCurrentTime(newTime)
    playbackId = requestAnimationFrame(playbackLoop)
  }

  function stopPlaybackLoop() {
    if (playbackId !== null) {
      cancelAnimationFrame(playbackId)
      playbackId = null
    }
  }

  function stopPlayback() {
    isPlaying.value = false
    stopPlaybackLoop()
    setCurrentTime(0)
  }

  function loadAnimation(animation: any) {
    if (!animation) return
    
    const proj = animation.project || {}
    const fps = proj.fps || project.value.fps || 30
    const duration = proj.duration ?? (proj.total_frames ? proj.total_frames / Math.max(1, fps) : project.value.duration)
    const totalFrames = proj.total_frames ?? Math.max(1, Math.round((duration || project.value.duration) * fps))
    setProject({
      width: proj.width || 1280,
      height: proj.height || 720,
      fps,
      duration,
      total_frames: totalFrames,
      mask_expansion: proj.mask_expansion || 0,
      mask_feather: proj.mask_feather || 0,
      hdr_enable: !!proj.hdr_enable,
      hdr_exposure: proj.hdr_exposure || 0,
      pano_enable: !!proj.pano_enable,
      cam_enable: proj.cam_enable !== undefined ? !!proj.cam_enable : !!proj.pano_enable,
      cam_yaw: proj.cam_yaw || 0,
      cam_pitch: proj.cam_pitch || 0,
      cam_roll: proj.cam_roll || 0,
      cam_fov: proj.cam_fov || 90,
      cam_offset_x: proj.cam_offset_x || 0,
      cam_offset_y: proj.cam_offset_y || 0,
      cam_pos_x: proj.cam_pos_x || 0,
      cam_pos_y: proj.cam_pos_y || 0,
      cam_pos_z: proj.cam_pos_z !== undefined ? proj.cam_pos_z : 1000,
      preview_mode: proj.preview_mode || '2d'
    })
    projectKeyframes.value = proj.project_keyframes || {}

    layers.value = (animation.layers || []).map((l: any) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      image_data: l.image_data,
      // 2D 变换
      x: l.x || 0,
      y: l.y || 0,
      z: l.z || 0,
      scale: l.scale || 1,
      rotation: l.rotation || 0,
      opacity: l.opacity !== undefined ? l.opacity : 1,
      // 3D 模式
      is3D: l.is3D || false,
      // 3D 旋转
      rotationX: l.rotationX || 0,
      rotationY: l.rotationY || 0,
      rotationZ: l.rotationZ || 0,
      // 3D 缩放
      scaleX: l.scaleX !== undefined ? l.scaleX : (l.scale || 1),
      scaleY: l.scaleY !== undefined ? l.scaleY : (l.scale || 1),
      scaleZ: l.scaleZ !== undefined ? l.scaleZ : 1,
      // 锚点
      anchorX: l.anchorX || 0,
      anchorY: l.anchorY || 0,
      perspective: l.perspective || 1000,
      // Mask
      mask_size: l.mask_size || 0,
      customMask: l.customMask,
      // 路径动画
      bezierPath: l.bezierPath,
      usePathAnimation: l.usePathAnimation || false,
      // 其他
      keyframes: l.keyframes || {},
      bg_mode: l.bg_mode || 'fit'
    }))
  }

  function addKeyframe() {
    const layer = currentLayer.value
    if (!layer) return

    // 包含 2D 和 3D 属性
    const props: (keyof Layer)[] = [
      'x', 'y', 'z', 'scale', 'rotation', 'opacity', 'mask_size',
      'rotationX', 'rotationY', 'rotationZ', 
      'scaleX', 'scaleY', 'scaleZ',
      'anchorX', 'anchorY', 'perspective'
    ]
    if (!layer.keyframes) layer.keyframes = {}

    for (const prop of props) {
      let currentValue = layer[prop]
      if (currentValue === undefined) {
        if (prop === 'scale' || prop === 'opacity') currentValue = 1
        else if (prop === 'perspective') currentValue = 1000
        else currentValue = 0
      }
      
      if (!layer.keyframes[prop]) layer.keyframes[prop] = []
      layer.keyframes[prop] = layer.keyframes[prop].filter((kf: Keyframe) => kf.time !== currentTime.value)
      layer.keyframes[prop].push({ time: currentTime.value, value: currentValue as number })
      layer.keyframes[prop].sort((a: Keyframe, b: Keyframe) => a.time - b.time)
    }
  }

  function deleteKeyframe() {
    const layer = currentLayer.value
    if (!layer || !layer.keyframes) return

    const props: (keyof Layer)[] = [
      'x', 'y', 'z', 'scale', 'rotation', 'opacity', 'mask_size',
      'rotationX', 'rotationY', 'rotationZ',
      'scaleX', 'scaleY', 'scaleZ',
      'anchorX', 'anchorY', 'perspective'
    ]
    for (const prop of props) {
      if (layer.keyframes[prop]) {
        layer.keyframes[prop] = layer.keyframes[prop].filter((kf: Keyframe) => kf.time !== currentTime.value)
      }
    }
  }

  function clearAllKeyframes() {
    const layer = currentLayer.value
    if (!layer) return
    layer.keyframes = {}
  }

  function exportAnimation() {
    return {
      project: { ...project.value, project_keyframes: projectKeyframes.value },
      layers: layers.value.map(l => ({
        id: l.id,
        name: l.name,
        type: l.type,
        image_data: l.image_data,
        // 2D 变换
        x: l.x,
        y: l.y,
        z: l.z || 0,
        scale: l.scale,
        rotation: l.rotation,
        opacity: l.opacity,
        // 3D 模式
        is3D: l.is3D || false,
        // 3D 旋转
        rotationX: l.rotationX,
        rotationY: l.rotationY,
        rotationZ: l.rotationZ,
        // 3D 缩放
        scaleX: l.scaleX,
        scaleY: l.scaleY,
        scaleZ: l.scaleZ,
        // 锚点
        anchorX: l.anchorX,
        anchorY: l.anchorY,
        perspective: l.perspective,
        // Mask
        mask_size: l.mask_size,
        customMask: l.customMask,
        // 路径动画
        bezierPath: l.bezierPath,
        usePathAnimation: l.usePathAnimation,
        // 其他
        keyframes: l.keyframes,
        bg_mode: l.bg_mode
      }))
    }
  }

  return {
    // State
    project,
    layers,
    currentLayerIndex,
    cameraSelected,
    currentTime,
    currentFrame,
    isPlaying,
    maskMode,
    pathMode,
    extractMode,
    projectKeyframes,

    // Computed
    currentLayer,
    foregroundLayers,
    backgroundLayer,

    // Actions
    setProject,
    addLayer,
    removeLayer,
    clearLayers,
    selectLayer,
    selectCameraLayer,
    deselectAll,
    updateLayer,
    setCurrentTime,
    setCurrentFrame,
    togglePlayback,
    stopPlayback,
    addKeyframe,
    deleteKeyframe,
    clearAllKeyframes,
    setProjectKeyframe,
    deleteProjectKeyframe,
    interpolateProjectValue,
    loadAnimation,
    exportAnimation
  }
})
