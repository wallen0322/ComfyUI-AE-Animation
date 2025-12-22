<template>
  <div class="ae-timeline">
    <!-- 左侧图层面板 -->
    <div class="layers-panel">
      <div class="layers-header">
        <span class="col-expand"></span>
        <span class="col-vis">👁</span>
        <span class="col-name">图层名称</span>
      </div>
      <div class="layers-list">
        <!-- 摄像机轨道 -->
        <template v-if="store.project.cam_enable">
          <div 
            class="layer-row camera-row"
            :class="{ active: selectedTrack === 'camera' && !selectedProp }"
            @click="selectCameraTrack"
          >
            <span class="layer-expand" @click.stop="toggleExpand('camera')">
              {{ expandedLayers.has('camera') ? '▼' : '▶' }}
            </span>
            <span class="layer-vis">🎥</span>
            <span class="layer-icon">📷</span>
            <span class="layer-name">摄像机</span>
            <button class="kf-btn" @click.stop="addCameraKeyframe" title="添加关键帧">◆</button>
          </div>
          <!-- 摄像机属性子轨道 -->
          <template v-if="expandedLayers.has('camera')">
            <div 
              v-for="prop in cameraProps" 
              :key="prop.key"
              class="prop-row camera-prop"
              :class="{ active: selectedTrack === 'camera' && selectedProp === prop.key }"
              @click="selectCameraProp(prop.key)"
            >
              <span class="prop-indent"></span>
              <span class="prop-name">{{ prop.label }}</span>
            </div>
          </template>
        </template>

        <div class="empty-msg" v-if="store.layers.length === 0 && !store.project.cam_enable">
          暂无图层
        </div>

        <!-- 图层列表 -->
        <template v-for="(layer, index) in store.layers" :key="layer.id">
          <div 
            class="layer-row"
            :class="{ active: index === store.currentLayerIndex && selectedTrack === 'layer' && !selectedProp }"
            @click="selectLayerTrack(index)"
          >
            <span class="layer-expand" @click.stop="toggleExpand(layer.id)">
              {{ expandedLayers.has(layer.id) ? '▼' : '▶' }}
            </span>
            <span class="layer-vis">{{ layer.opacity > 0 ? '👁' : '◯' }}</span>
            <span class="layer-icon">{{ layer.type === 'background' ? '🖼' : '📄' }}</span>
            <span class="layer-name">{{ layer.name || '未命名' }}</span>
            <button class="layer-del" @click.stop="store.removeLayer(index)" title="删除">✕</button>
          </div>
          <!-- 图层属性子轨道 -->
          <template v-if="expandedLayers.has(layer.id)">
            <div 
              v-for="prop in getLayerPropsList(layer)" 
              :key="`${layer.id}-${prop.key}`"
              class="prop-row"
              :class="{ active: index === store.currentLayerIndex && selectedProp === prop.key }"
              @click="selectLayerProp(index, prop.key)"
            >
              <span class="prop-indent"></span>
              <span class="prop-name">{{ prop.label }}</span>
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- 右侧时间轴区 -->
    <div class="timeline-panel" ref="timelinePanel">
      <div class="time-ruler" @click="onRulerClick">
        <div 
          v-for="i in tickCount"
          :key="i"
          class="tick"
          :style="{ left: `${((i - 1) / store.project.duration) * 100}%` }"
        >
          <span class="tick-label">{{ i - 1 }}s</span>
        </div>
        <div class="playhead" :style="{ left: `${playheadPos}%` }">
          <div class="playhead-top"></div>
          <div class="playhead-line"></div>
        </div>
      </div>

      <div class="tracks-area">
        <!-- 摄像机轨道 -->
        <template v-if="store.project.cam_enable">
          <div 
            class="track-row camera-track"
            :class="{ active: selectedTrack === 'camera' && !selectedProp }"
            @click.stop="onCameraTrackClick($event)"
          >
            <div
              v-for="(kf, kfIdx) in getCameraKeyframesMerged()"
              :key="kfIdx"
              class="keyframe camera-kf"
              :class="{ current: Math.abs(kf.time - store.currentTime) < 0.02 }"
              :style="{ left: `${(kf.time / store.project.duration) * 100}%` }"
              :title="`${kf.time.toFixed(2)}s`"
              @click.stop="selectCameraKeyframeByTime(kf.time)"
              @mousedown.stop="startDragCameraKfByTime($event, kf.time)"
              @contextmenu.prevent="deleteCameraKeyframeByTime(kf.time)"
            ></div>
          </div>
          <!-- 摄像机属性子轨道 -->
          <template v-if="expandedLayers.has('camera')">
            <div 
              v-for="prop in cameraProps" 
              :key="prop.key"
              class="track-row prop-track camera-prop-track"
              :class="{ active: selectedTrack === 'camera' && selectedProp === prop.key }"
              @click.stop="onCameraPropTrackClick($event, prop.key)"
            >
              <div
                v-for="(kf, kfIdx) in getCameraPropKeyframes(prop.key)"
                :key="kfIdx"
                class="keyframe camera-kf"
                :class="{ current: Math.abs(kf.time - store.currentTime) < 0.02 }"
                :style="{ left: `${(kf.time / store.project.duration) * 100}%` }"
                :title="`${kf.value.toFixed(2)}`"
                @click.stop="selectCameraPropKf(kf, prop.key)"
                @mousedown.stop="startDragCameraPropKf($event, kf, prop.key)"
                @contextmenu.prevent="deleteCameraPropKf(kf, prop.key)"
              ></div>
            </div>
          </template>
        </template>

        <!-- 图层轨道 -->
        <template v-for="(layer, index) in store.layers" :key="layer.id">
          <div 
            class="track-row"
            :class="{ active: index === store.currentLayerIndex && selectedTrack === 'layer' && !selectedProp }"
            @click.stop="onTrackClick($event, index)"
          >
            <div
              v-for="(kf, kfIdx) in getLayerKeyframesMerged(layer)"
              :key="kfIdx"
              class="keyframe"
              :class="{ current: Math.abs(kf.time - store.currentTime) < 0.02 }"
              :style="{ left: `${(kf.time / store.project.duration) * 100}%` }"
              :title="`${kf.time.toFixed(2)}s`"
              @click.stop="selectLayerKeyframeByTime(layer, kf.time, index)"
              @mousedown.stop="startDragLayerKfByTime($event, layer, kf.time, index)"
              @contextmenu.prevent="deleteLayerKeyframeByTime(layer, kf.time)"
            ></div>
          </div>
          <!-- 图层属性子轨道 -->
          <template v-if="expandedLayers.has(layer.id)">
            <div 
              v-for="prop in getLayerPropsList(layer)" 
              :key="`${layer.id}-${prop.key}`"
              class="track-row prop-track"
              :class="{ active: index === store.currentLayerIndex && selectedProp === prop.key }"
              @click.stop="onLayerPropTrackClick($event, layer, prop.key, index)"
            >
              <div
                v-for="(kf, kfIdx) in getLayerPropKeyframes(layer, prop.key)"
                :key="kfIdx"
                class="keyframe"
                :class="{ current: Math.abs(kf.time - store.currentTime) < 0.02 }"
                :style="{ left: `${(kf.time / store.project.duration) * 100}%` }"
                :title="`${kf.value.toFixed(2)}`"
                @click.stop="selectLayerPropKf(layer, kf, prop.key, index)"
                @mousedown.stop="startDragLayerPropKf($event, layer, kf, prop.key, index)"
                @contextmenu.prevent="deleteLayerPropKf(layer, kf, prop.key)"
              ></div>
            </div>
          </template>
        </template>

        <div class="playhead-ext" :style="{ left: `${playheadPos}%` }"></div>
      </div>
    </div>

    <!-- 底部属性区 -->
    <div class="props-bar camera-props" v-if="selectedTrack === 'camera' && store.project.cam_enable">
      <div class="prop-group">
        <span class="group-label">位置</span>
        <div class="prop-item"><label>X</label><input type="number" v-model.number="store.project.cam_pos_x" step="10" /></div>
        <div class="prop-item"><label>Y</label><input type="number" v-model.number="store.project.cam_pos_y" step="10" /></div>
        <div class="prop-item"><label>Z</label><input type="number" v-model.number="store.project.cam_pos_z" step="50" /></div>
      </div>
      <div class="prop-group">
        <span class="group-label">旋转</span>
        <div class="prop-item"><label>Yaw</label><input type="number" v-model.number="store.project.cam_yaw" step="5" /></div>
        <div class="prop-item"><label>Pitch</label><input type="number" v-model.number="store.project.cam_pitch" step="5" /></div>
        <div class="prop-item"><label>Roll</label><input type="number" v-model.number="store.project.cam_roll" step="5" /></div>
      </div>
      <div class="prop-item"><label>FOV</label><input type="number" v-model.number="store.project.cam_fov" step="5" min="1" max="179" /></div>
      <button class="kf-add-btn" @click="addCameraKeyframe">◆ 添加关键帧</button>
    </div>
    <div class="props-bar" v-else-if="store.currentLayer && store.currentLayer.type !== 'background'">
      <div class="prop-item"><label>X</label><input type="number" v-model.number="store.currentLayer.x" step="1" /></div>
      <div class="prop-item"><label>Y</label><input type="number" v-model.number="store.currentLayer.y" step="1" /></div>
      <div class="prop-item" v-if="store.currentLayer.is3D"><label>Z</label><input type="number" v-model.number="store.currentLayer.z" step="1" /></div>
      <div class="prop-item"><label>缩放</label><input type="number" v-model.number="store.currentLayer.scale" step="0.01" /></div>
      <div class="prop-item"><label>旋转</label><input type="number" v-model.number="store.currentLayer.rotation" step="1" /></div>
      <div class="prop-item"><label>不透明度</label><input type="number" v-model.number="store.currentLayer.opacity" step="0.05" min="0" max="1" /></div>
      <button class="kf-add-btn" @click="addLayerKeyframe">◆ 添加关键帧</button>
    </div>
    <div class="props-bar" v-else-if="store.currentLayer && store.currentLayer.type === 'background'">
      <div class="prop-item"><label>填充模式</label>
        <select v-model="store.currentLayer.bg_mode">
          <option value="fit">适应</option><option value="fill">填充</option><option value="stretch">拉伸</option>
        </select>
      </div>
    </div>
  </div>
</template>


<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore'

const store = useTimelineStore()
const timelinePanel = ref<HTMLElement>()
const selectedTrack = ref<'camera' | 'layer'>('layer')
const selectedProp = ref<string | null>(null)
const expandedLayers = reactive(new Set<string>())

const tickCount = computed(() => Math.ceil(store.project.duration) + 1)
const playheadPos = computed(() => (store.currentTime / store.project.duration) * 100)

// 摄像机属性定义
const cameraProps = [
  { key: 'cam_pos_x', label: '位置 X' },
  { key: 'cam_pos_y', label: '位置 Y' },
  { key: 'cam_pos_z', label: '位置 Z' },
  { key: 'cam_yaw', label: 'Yaw' },
  { key: 'cam_pitch', label: 'Pitch' },
  { key: 'cam_roll', label: 'Roll' },
  { key: 'cam_fov', label: 'FOV' }
]

// 图层属性定义
const layerPropsConfig = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'z', label: 'Z' },
  { key: 'scale', label: '缩放' },
  { key: 'rotation', label: '旋转' },
  { key: 'opacity', label: '不透明度' },
  { key: 'rotationX', label: '旋转X' },
  { key: 'rotationY', label: '旋转Y' },
  { key: 'rotationZ', label: '旋转Z' }
]

function toggleExpand(id: string) {
  if (expandedLayers.has(id)) {
    expandedLayers.delete(id)
  } else {
    expandedLayers.add(id)
  }
}

function getLayerPropsList(layer: any) {
  // 只返回有关键帧的属性，或者基础属性
  const hasKf = (prop: string) => layer.keyframes?.[prop]?.length > 0
  return layerPropsConfig.filter(p => hasKf(p.key) || ['x', 'y', 'scale', 'rotation', 'opacity'].includes(p.key))
}

// 选择函数
function selectCameraTrack() {
  selectedTrack.value = 'camera'
  selectedProp.value = null
}

function selectCameraProp(prop: string) {
  selectedTrack.value = 'camera'
  selectedProp.value = prop
}

function selectLayerTrack(index: number) {
  selectedTrack.value = 'layer'
  selectedProp.value = null
  store.selectLayer(index)
}

function selectLayerProp(index: number, prop: string) {
  selectedTrack.value = 'layer'
  selectedProp.value = prop
  store.selectLayer(index)
}

// 添加关键帧
function addCameraKeyframe() {
  const time = store.currentTime
  for (const prop of cameraProps) {
    const value = (store.project as any)[prop.key] ?? 0
    store.setProjectKeyframe(prop.key, time, value)
  }
}

function addLayerKeyframe() {
  if (!store.currentLayer) return
  store.addKeyframe()
}

// 获取关键帧数据
function getCameraKeyframesMerged() {
  const times = new Set<number>()
  const pkf = store.projectKeyframes
  for (const prop of cameraProps) {
    const arr = pkf[prop.key]
    if (arr) arr.forEach((k: any) => times.add(Math.round(k.time * 100) / 100))
  }
  return Array.from(times).sort((a, b) => a - b).map(t => ({ time: t }))
}

function getCameraPropKeyframes(prop: string) {
  return (store.projectKeyframes[prop] || []).map((k: any) => ({ time: k.time, value: k.value }))
}

function getLayerKeyframesMerged(layer: any) {
  const times = new Set<number>()
  for (const prop of layerPropsConfig) {
    const arr = layer.keyframes?.[prop.key]
    if (arr) arr.forEach((k: any) => times.add(Math.round(k.time * 100) / 100))
  }
  return Array.from(times).sort((a, b) => a - b).map(t => ({ time: t }))
}

function getLayerPropKeyframes(layer: any, prop: string) {
  return (layer.keyframes?.[prop] || []).map((k: any) => ({ time: k.time, value: k.value }))
}

// 点击轨道
function onRulerClick(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  store.setCurrentTime(ratio * store.project.duration)
}

function onCameraTrackClick(e: MouseEvent) {
  selectedTrack.value = 'camera'
  selectedProp.value = null
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  store.setCurrentTime(ratio * store.project.duration)
}

function onCameraPropTrackClick(e: MouseEvent, prop: string) {
  selectedTrack.value = 'camera'
  selectedProp.value = prop
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  store.setCurrentTime(ratio * store.project.duration)
}

function onTrackClick(e: MouseEvent, index: number) {
  selectedTrack.value = 'layer'
  selectedProp.value = null
  store.selectLayer(index)
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  store.setCurrentTime(ratio * store.project.duration)
}

function onLayerPropTrackClick(e: MouseEvent, layer: any, prop: string, index: number) {
  selectedTrack.value = 'layer'
  selectedProp.value = prop
  store.selectLayer(index)
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  store.setCurrentTime(ratio * store.project.duration)
}

// 摄像机关键帧操作
function selectCameraKeyframeByTime(time: number) {
  store.setCurrentTime(time)
  selectedTrack.value = 'camera'
  selectedProp.value = null
}

function deleteCameraKeyframeByTime(time: number) {
  for (const prop of cameraProps) {
    store.deleteProjectKeyframe(prop.key, time)
  }
}

function startDragCameraKfByTime(e: MouseEvent, time: number) {
  if (e.button !== 0) return
  const kfData: { prop: string; value: number }[] = []
  for (const prop of cameraProps) {
    const arr = store.projectKeyframes[prop.key]
    if (arr) {
      const kf = arr.find((k: any) => Math.abs(k.time - time) < 0.02)
      if (kf) kfData.push({ prop: prop.key, value: kf.value })
    }
  }
  if (kfData.length === 0) return
  
  const trackEl = (e.target as HTMLElement).parentElement
  if (!trackEl) return
  const rect = trackEl.getBoundingClientRect()
  const duration = store.project.duration
  let currentTime = time

  const onMouseMove = (moveE: MouseEvent) => {
    const ratio = Math.max(0, Math.min(1, (moveE.clientX - rect.left) / rect.width))
    const newTime = Math.round(ratio * duration * 100) / 100
    if (Math.abs(newTime - currentTime) < 0.005) return
    for (const kf of kfData) {
      store.deleteProjectKeyframe(kf.prop, currentTime)
      store.setProjectKeyframe(kf.prop, newTime, kf.value)
    }
    currentTime = newTime
    store.setCurrentTime(newTime)
  }
  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 摄像机单属性关键帧操作
function selectCameraPropKf(kf: any, prop: string) {
  store.setCurrentTime(kf.time)
  selectedTrack.value = 'camera'
  selectedProp.value = prop
}

function deleteCameraPropKf(kf: any, prop: string) {
  store.deleteProjectKeyframe(prop, kf.time)
}

function startDragCameraPropKf(e: MouseEvent, kf: any, prop: string) {
  if (e.button !== 0) return
  const trackEl = (e.target as HTMLElement).parentElement
  if (!trackEl) return
  const rect = trackEl.getBoundingClientRect()
  const duration = store.project.duration
  let currentTime = kf.time
  const value = kf.value

  const onMouseMove = (moveE: MouseEvent) => {
    const ratio = Math.max(0, Math.min(1, (moveE.clientX - rect.left) / rect.width))
    const newTime = Math.round(ratio * duration * 100) / 100
    if (Math.abs(newTime - currentTime) < 0.005) return
    store.deleteProjectKeyframe(prop, currentTime)
    store.setProjectKeyframe(prop, newTime, value)
    currentTime = newTime
    store.setCurrentTime(newTime)
  }
  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 图层关键帧操作
function selectLayerKeyframeByTime(layer: any, time: number, index: number) {
  store.selectLayer(index)
  store.setCurrentTime(time)
  selectedTrack.value = 'layer'
  selectedProp.value = null
}

function deleteLayerKeyframeByTime(layer: any, time: number) {
  for (const prop of layerPropsConfig) {
    if (layer.keyframes?.[prop.key]) {
      layer.keyframes[prop.key] = layer.keyframes[prop.key].filter((k: any) => Math.abs(k.time - time) > 0.02)
    }
  }
}

function startDragLayerKfByTime(e: MouseEvent, layer: any, time: number, index: number) {
  if (e.button !== 0) return
  store.selectLayer(index)
  
  const kfData: { prop: string; value: number }[] = []
  for (const prop of layerPropsConfig) {
    const arr = layer.keyframes?.[prop.key]
    if (arr) {
      const kf = arr.find((k: any) => Math.abs(k.time - time) < 0.02)
      if (kf) kfData.push({ prop: prop.key, value: kf.value })
    }
  }
  if (kfData.length === 0) return

  const trackEl = (e.target as HTMLElement).parentElement
  if (!trackEl) return
  const rect = trackEl.getBoundingClientRect()
  const duration = store.project.duration
  let currentTime = time

  const onMouseMove = (moveE: MouseEvent) => {
    const ratio = Math.max(0, Math.min(1, (moveE.clientX - rect.left) / rect.width))
    const newTime = Math.round(ratio * duration * 100) / 100
    if (Math.abs(newTime - currentTime) < 0.005) return
    for (const kf of kfData) {
      if (layer.keyframes?.[kf.prop]) {
        const idx = layer.keyframes[kf.prop].findIndex((k: any) => Math.abs(k.time - currentTime) < 0.02)
        if (idx >= 0) layer.keyframes[kf.prop][idx].time = newTime
      }
    }
    currentTime = newTime
    store.setCurrentTime(newTime)
  }
  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 图层单属性关键帧操作
function selectLayerPropKf(layer: any, kf: any, prop: string, index: number) {
  store.selectLayer(index)
  store.setCurrentTime(kf.time)
  selectedTrack.value = 'layer'
  selectedProp.value = prop
}

function deleteLayerPropKf(layer: any, kf: any, prop: string) {
  if (layer.keyframes?.[prop]) {
    layer.keyframes[prop] = layer.keyframes[prop].filter((k: any) => Math.abs(k.time - kf.time) > 0.02)
  }
}

function startDragLayerPropKf(e: MouseEvent, layer: any, kf: any, prop: string, index: number) {
  if (e.button !== 0) return
  store.selectLayer(index)
  
  const trackEl = (e.target as HTMLElement).parentElement
  if (!trackEl) return
  const rect = trackEl.getBoundingClientRect()
  const duration = store.project.duration
  let currentTime = kf.time

  const onMouseMove = (moveE: MouseEvent) => {
    const ratio = Math.max(0, Math.min(1, (moveE.clientX - rect.left) / rect.width))
    const newTime = Math.round(ratio * duration * 100) / 100
    if (Math.abs(newTime - currentTime) < 0.005) return
    if (layer.keyframes?.[prop]) {
      const idx = layer.keyframes[prop].findIndex((k: any) => Math.abs(k.time - currentTime) < 0.02)
      if (idx >= 0) layer.keyframes[prop][idx].time = newTime
    }
    currentTime = newTime
    store.setCurrentTime(newTime)
  }
  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}
</script>


<style scoped>
.ae-timeline {
  display: grid;
  grid-template-columns: 180px 1fr;
  grid-template-rows: 1fr auto;
  height: 100%;
  background: #1e1e1e;
  font-size: 11px;
}

.layers-panel {
  grid-row: 1;
  grid-column: 1;
  display: flex;
  flex-direction: column;
  background: #222;
  border-right: 1px solid #333;
  overflow: hidden;
}

.layers-header {
  display: flex;
  align-items: center;
  height: 24px;
  padding: 0 4px;
  background: #2a2a2a;
  border-bottom: 1px solid #333;
  font-size: 10px;
  color: #888;
}

.col-expand { width: 16px; }
.col-vis { width: 20px; text-align: center; }
.col-name { flex: 1; }

.layers-list {
  flex: 1;
  overflow-y: auto;
}

.empty-msg {
  padding: 16px;
  text-align: center;
  color: #555;
}

.layer-row {
  display: flex;
  align-items: center;
  height: 24px;
  padding: 0 4px;
  border-bottom: 1px solid #2a2a2a;
  cursor: pointer;
  transition: background 0.1s;
}

.layer-row:hover { background: #2a2a2a; }
.layer-row.active { background: #3a5070; }

.layer-expand {
  width: 16px;
  font-size: 8px;
  color: #888;
  cursor: pointer;
  text-align: center;
}
.layer-expand:hover { color: #fff; }

.layer-vis { width: 20px; text-align: center; font-size: 10px; }
.layer-icon { width: 16px; text-align: center; font-size: 10px; }
.layer-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #ccc;
  font-size: 10px;
}
.layer-row.active .layer-name { color: #fff; }

.layer-del {
  width: 16px;
  height: 16px;
  background: transparent;
  border: none;
  color: #666;
  cursor: pointer;
  opacity: 0;
  font-size: 10px;
}
.layer-row:hover .layer-del { opacity: 1; }
.layer-del:hover { color: #f44; }

.camera-row { background: #2a3040; }
.camera-row.active { background: #3a4560; }

.kf-btn {
  width: 16px;
  height: 16px;
  background: transparent;
  border: none;
  color: #f39c12;
  cursor: pointer;
  font-size: 10px;
}
.kf-btn:hover { color: #f1c40f; }

/* 属性子行 */
.prop-row {
  display: flex;
  align-items: center;
  height: 20px;
  padding: 0 4px;
  background: #1a1a1a;
  border-bottom: 1px solid #252525;
  cursor: pointer;
}
.prop-row:hover { background: #252525; }
.prop-row.active { background: #2a3545; }

.prop-indent { width: 32px; }
.prop-name {
  flex: 1;
  color: #888;
  font-size: 9px;
}
.prop-row.active .prop-name { color: #aaa; }

.camera-prop { background: #1e1e28; }
.camera-prop:hover { background: #252530; }
.camera-prop.active { background: #303045; }

/* 时间轴面板 */
.timeline-panel {
  grid-row: 1;
  grid-column: 2;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.time-ruler {
  position: relative;
  height: 24px;
  background: #2a2a2a;
  border-bottom: 1px solid #333;
  cursor: pointer;
}

.tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #444;
}

.tick-label {
  position: absolute;
  top: 6px;
  left: 4px;
  font-size: 9px;
  color: #777;
  font-family: monospace;
}

.playhead {
  position: absolute;
  top: 0;
  z-index: 10;
}

.playhead-top {
  width: 12px;
  height: 12px;
  margin-left: -6px;
  background: #e74c3c;
  clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%);
}

.playhead-line {
  position: absolute;
  top: 12px;
  left: -1px;
  width: 2px;
  height: 500px;
  background: #e74c3c;
  pointer-events: none;
}

.tracks-area {
  flex: 1;
  position: relative;
  overflow-y: auto;
  background: #1a1a1a;
}

.track-row {
  position: relative;
  height: 24px;
  border-bottom: 1px solid #2a2a2a;
  cursor: pointer;
}

.track-row:hover { background: #222; }
.track-row.active { background: #2a3545; }

.prop-track {
  height: 20px;
  background: #1a1a1a;
  border-bottom: 1px solid #252525;
}
.prop-track:hover { background: #222; }
.prop-track.active { background: #253040; }

.camera-track { background: #252535; }
.camera-track.active { background: #353550; }

.camera-prop-track { background: #1e1e28; }
.camera-prop-track:hover { background: #252530; }
.camera-prop-track.active { background: #303045; }

.keyframe {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%) rotate(45deg);
  width: 8px;
  height: 8px;
  background: #3498db;
  border: 1px solid #5dade2;
  z-index: 5;
  cursor: grab;
}

.keyframe:active { cursor: grabbing; }

.keyframe.current {
  background: #e74c3c;
  border-color: #ec7063;
  transform: translate(-50%, -50%) rotate(45deg) scale(1.2);
}

.keyframe.camera-kf {
  background: #f39c12;
  border-color: #f1c40f;
}

.playhead-ext {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #e74c3c;
  pointer-events: none;
  z-index: 8;
}

/* 底部属性栏 */
.props-bar {
  grid-row: 2;
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background: #252525;
  border-top: 1px solid #333;
  flex-wrap: wrap;
}

.prop-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.prop-item label {
  font-size: 10px;
  color: #888;
  min-width: 40px;
}

.prop-item input,
.prop-item select {
  width: 60px;
  padding: 3px 5px;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 3px;
  color: #fff;
  font-size: 10px;
  font-family: monospace;
}

.prop-item input:focus,
.prop-item select:focus {
  outline: none;
  border-color: #3498db;
}

.camera-props { background: #2a2a35; }

.prop-group {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 10px;
  border-right: 1px solid #444;
}

.group-label {
  font-size: 9px;
  color: #666;
  min-width: 24px;
}

.kf-add-btn {
  padding: 4px 8px;
  background: #f39c12;
  border: none;
  border-radius: 3px;
  color: #000;
  font-size: 10px;
  cursor: pointer;
  margin-left: auto;
}

.kf-add-btn:hover { background: #f1c40f; }
</style>
