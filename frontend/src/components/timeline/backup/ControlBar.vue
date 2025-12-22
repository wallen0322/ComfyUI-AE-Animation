<template>
  <div class="control-bar">
    <!-- 时间控制 -->
    <div class="tool-group">
      <span class="group-label">时间</span>
      <div class="group-content">
        <input 
          type="number" 
          class="time-input"
          :value="store.currentTime.toFixed(2)"
          @input="onTimeInput"
          step="0.01"
          min="0"
        />
        <span class="time-unit">s</span>
        <button class="tool-btn" @click="store.togglePlayback" :class="{active: store.isPlaying}" title="播放/暂停">
          {{ store.isPlaying ? '⏸' : '▶' }}
        </button>
        <button class="tool-btn" @click="store.stopPlayback" title="停止">⏹</button>
      </div>
    </div>

    <div class="divider"></div>

    <!-- 关键帧 -->
    <div class="tool-group">
      <span class="group-label">关键帧</span>
      <div class="group-content">
        <button class="tool-btn accent" @click="addKeyframe" title="添加关键帧">◆ 添加</button>
        <button class="tool-btn danger" @click="deleteKeyframe" title="删除关键帧">✕ 删除</button>
        <button class="tool-btn danger" @click="clearAllKeyframes" title="清除所有">🗑 清空</button>
      </div>
    </div>

    <div class="divider"></div>

    <!-- 工具 -->
    <div class="tool-group">
      <span class="group-label">工具</span>
      <div class="group-content">
        <button class="tool-btn" @click="toggleMask" :class="{active: store.maskMode.enabled}" title="遮罩编辑">
          🖌 Mask
        </button>
        <button class="tool-btn" @click="togglePath" :class="{active: store.pathMode.enabled}" title="路径编辑">
          📍 Path
        </button>
        <button class="tool-btn" @click="toggleExtract" :class="{active: store.extractMode.enabled}" title="背景提取">
          ✂ Extract
        </button>
      </div>
    </div>

    <!-- 右侧时间显示 -->
    <div class="time-display">
      <span class="current-time">{{ store.currentTime.toFixed(2) }}</span>
      <span class="total-time">/ {{ store.project.duration.toFixed(1) }}s</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore'

const store = useTimelineStore()
const timeInput = ref(0)

function onTimeInput(e: Event) {
  const value = parseFloat((e.target as HTMLInputElement).value)
  if (!Number.isNaN(value)) {
    store.setCurrentTime(value)
  }
}

function goToTime() {
  store.setCurrentTime(timeInput.value)
}

function addKeyframe() {
  store.addKeyframe()
}

function deleteKeyframe() {
  store.deleteKeyframe()
}

function clearAllKeyframes() {
  if (confirm('Clear all keyframes?')) {
    store.clearAllKeyframes()
  }
}

function toggleMask() {
  store.maskMode.enabled = !store.maskMode.enabled
}

async function openAdvancedMask() {
  if (!store.currentLayer) {
    alert('请先选择一个图层')
    return
  }

  try {
    // 创建遮罩编辑器弹窗
    const dialog = document.createElement("dialog")
    dialog.style.cssText = `
      width: 90vw;
      height: 90vh;
      max-width: none;
      max-height: none;
      padding: 0;
      border: 1px solid #444;
      border-radius: 8px;
      background: #1a1a1a;
      z-index: 10000;
    `

    const container = document.createElement("div")
    container.id = "ae-mask-editor-root"
    container.style.cssText = "width: 100%; height: 100%;"
    dialog.appendChild(container)
    document.body.appendChild(dialog)

    // 动态加载 Vue 遮罩编辑器
    if (!window.createMaskEditorApp) {
      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = "/extensions/ComfyUI-AE-Animation/vue-dist/assets/mask-editor-CZJ1cWVZ.css"
      document.head.appendChild(link)

      const script = document.createElement("script")
      script.type = "module"
      script.src = "/extensions/ComfyUI-AE-Animation/vue-dist/mask-editor.js"
      
      await new Promise((resolve, reject) => {
        script.onload = resolve
        script.onerror = reject
        document.head.appendChild(script)
      })

      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // 创建临时节点对象给遮罩编辑器使用
    const mockNode = {
      id: Date.now(),
      type: 'AEAnimationLayer',
      imgs: store.currentLayer.img ? [{ src: store.currentLayer.img.src }] : [],
      images: [],
      widgets: [],
      properties: {}
    }

    if (store.currentLayer.image_data && !store.currentLayer.img) {
      mockNode.imgs = [{ src: store.currentLayer.image_data }]
    }

    // 挂载 Vue 应用
    if (window.createMaskEditorApp) {
      const app = window.createMaskEditorApp(container, {
        nodeData: mockNode
      })

      dialog.addEventListener("close", () => {
        app.unmount()
        dialog.remove()
      })
    }

    dialog.showModal()
  } catch (error) {
    console.error('[Timeline] 无法打开高级遮罩编辑器', error)
    alert('打开高级遮罩编辑器失败：' + error.message)
  }
}

function togglePath() {
  store.pathMode.enabled = !store.pathMode.enabled
}

function toggleExtract() {
  store.extractMode.enabled = !store.extractMode.enabled
}
</script>

<style scoped>
.control-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: linear-gradient(180deg, #2a2a2a 0%, #252525 100%);
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}

.tool-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-label {
  font-size: 10px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.group-content {
  display: flex;
  align-items: center;
  gap: 6px;
}

.divider {
  width: 1px;
  height: 36px;
  background: #444;
}

.time-input {
  width: 70px;
  padding: 6px 8px;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #fff;
  font-size: 12px;
  font-family: monospace;
}

.time-input:focus {
  outline: none;
  border-color: #3a7bc8;
}

.time-unit {
  color: #666;
  font-size: 12px;
}

.tool-btn {
  padding: 6px 12px;
  background: #3a3a3a;
  border: 1px solid #555;
  border-radius: 4px;
  color: #ddd;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.tool-btn:hover {
  background: #4a4a4a;
  border-color: #666;
}

.tool-btn.active {
  background: #3a7bc8;
  border-color: #4a8bd8;
  color: #fff;
}

.tool-btn.accent {
  background: #2d6a4f;
  border-color: #40916c;
}

.tool-btn.accent:hover {
  background: #40916c;
}

.tool-btn.danger {
  background: #5a3a3a;
  border-color: #7a4a4a;
}

.tool-btn.danger:hover {
  background: #7a4a4a;
}

.time-display {
  margin-left: auto;
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 8px 12px;
  background: #1a1a1a;
  border-radius: 4px;
}

.current-time {
  font-size: 18px;
  font-weight: 600;
  font-family: monospace;
  color: #3a7bc8;
}

.total-time {
  font-size: 12px;
  color: #666;
}
</style>
