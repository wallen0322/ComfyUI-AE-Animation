<template>
  <div class="layer-panel">
    <!-- 图层列表区 -->
    <div class="panel-section">
      <div class="section-header">
        <span>🗂 图层列表</span>
        <div class="layer-actions" v-if="store.currentLayer">
          <button @click="moveLayer(-1)" title="上移">↑</button>
          <button @click="moveLayer(1)" title="下移">↓</button>
          <button @click="moveLayerToTop" title="置顶">⇈</button>
          <button @click="moveLayerToBottom" title="置底">⇊</button>
        </div>
      </div>
      
      <div class="layer-list">
        <div class="empty-hint" v-if="store.layers.length === 0">
          暂无图层，请添加前景或背景
        </div>
        <div 
          v-for="(layer, index) in store.layers"
          :key="layer.id"
          class="layer-item"
          :class="{ active: index === store.currentLayerIndex }"
          @click="store.selectLayer(index)"
        >
          <span class="layer-icon">{{ layer.type === 'background' ? '🖼' : '📄' }}</span>
          <span class="layer-name">{{ layer.name || '未命名图层' }}</span>
          <button 
            class="layer-delete"
            @click.stop="store.removeLayer(index)"
            title="删除"
          >✕</button>
        </div>
      </div>
    </div>

    <!-- 属性编辑区 -->
    <div class="panel-section" v-if="store.currentLayer">
      <div class="section-header">
        <span>⚙️ 图层属性</span>
      </div>
      
      <!-- 前景图层属性 -->
      <div class="prop-content" v-if="store.currentLayer.type !== 'background'">
        <!-- 3D 模式开关 -->
        <div class="prop-row single">
          <div class="prop-item full">
            <label class="checkbox-label">
              <input type="checkbox" v-model="store.currentLayer.is3D">
              <span>启用 3D 模式</span>
            </label>
          </div>
        </div>

        <!-- 位置 -->
        <div class="prop-group-title">位置</div>
        <div class="prop-row">
          <div class="prop-item">
            <label>X</label>
            <input type="number" v-model.number="store.currentLayer.x" step="1">
          </div>
          <div class="prop-item">
            <label>Y</label>
            <input type="number" v-model.number="store.currentLayer.y" step="1">
          </div>
          <div class="prop-item" v-if="store.currentLayer.is3D">
            <label>Z</label>
            <input type="number" v-model.number="store.currentLayer.z" step="1">
          </div>
        </div>

        <!-- 2D 模式：简单缩放和旋转 -->
        <template v-if="!store.currentLayer.is3D">
          <div class="prop-row">
            <div class="prop-item">
              <label>缩放</label>
              <input type="number" v-model.number="store.currentLayer.scale" step="0.01" min="0.01">
            </div>
            <div class="prop-item">
              <label>旋转</label>
              <input type="number" v-model.number="store.currentLayer.rotation" step="1">
            </div>
          </div>
        </template>

        <!-- 3D 模式：分轴旋转和缩放 -->
        <template v-else>
          <div class="prop-group-title">3D 旋转</div>
          <div class="prop-row">
            <div class="prop-item">
              <label>X (Pitch)</label>
              <input type="number" v-model.number="store.currentLayer.rotationX" step="1">
            </div>
            <div class="prop-item">
              <label>Y (Yaw)</label>
              <input type="number" v-model.number="store.currentLayer.rotationY" step="1">
            </div>
            <div class="prop-item">
              <label>Z (Roll)</label>
              <input type="number" v-model.number="store.currentLayer.rotationZ" step="1">
            </div>
          </div>

          <div class="prop-group-title">3D 缩放</div>
          <div class="prop-row">
            <div class="prop-item">
              <label>X</label>
              <input type="number" v-model.number="store.currentLayer.scaleX" step="0.01" min="0.01">
            </div>
            <div class="prop-item">
              <label>Y</label>
              <input type="number" v-model.number="store.currentLayer.scaleY" step="0.01" min="0.01">
            </div>
            <div class="prop-item">
              <label>Z</label>
              <input type="number" v-model.number="store.currentLayer.scaleZ" step="0.01" min="0.01">
            </div>
          </div>

          <div class="prop-group-title">锚点</div>
          <div class="prop-row">
            <div class="prop-item">
              <label>锚点 X</label>
              <input type="number" v-model.number="store.currentLayer.anchorX" step="1">
            </div>
            <div class="prop-item">
              <label>锚点 Y</label>
              <input type="number" v-model.number="store.currentLayer.anchorY" step="1">
            </div>
          </div>
        </template>

        <!-- 通用属性 -->
        <div class="prop-row">
          <div class="prop-item">
            <label>不透明度</label>
            <input type="number" v-model.number="store.currentLayer.opacity" step="0.05" min="0" max="1">
          </div>
          <div class="prop-item">
            <label>遮罩尺寸</label>
            <input type="number" v-model.number="store.currentLayer.mask_size" step="0.01" min="0">
          </div>
        </div>
      </div>

      <!-- 背景图层属性 -->
      <div class="prop-content" v-else>
        <div class="prop-row single">
          <div class="prop-item full">
            <label>填充模式</label>
            <select v-model="store.currentLayer.bg_mode">
              <option value="fit">适应 (Fit)</option>
              <option value="fill">填充 (Fill)</option>
              <option value="stretch">拉伸 (Stretch)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTimelineStore } from '@/stores/timelineStore'

const store = useTimelineStore()

function moveLayer(delta: number) {
  const idx = store.currentLayerIndex
  if (idx < 0) return
  const newIdx = idx + delta
  if (newIdx >= 0 && newIdx < store.layers.length) {
    const layer = store.layers[idx]
    store.layers.splice(idx, 1)
    store.layers.splice(newIdx, 0, layer)
    store.selectLayer(newIdx)
  }
}

function moveLayerToTop() {
  const idx = store.currentLayerIndex
  if (idx < 0) return
  const layer = store.layers[idx]
  store.layers.splice(idx, 1)
  store.layers.push(layer)
  store.selectLayer(store.layers.length - 1)
}

function moveLayerToBottom() {
  const idx = store.currentLayerIndex
  if (idx <= 0) return
  const layer = store.layers[idx]
  store.layers.splice(idx, 1)
  store.layers.unshift(layer)
  store.selectLayer(0)
}
</script>

<style scoped>
.layer-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
}

.panel-section {
  display: flex;
  flex-direction: column;
}

.panel-section:first-child {
  flex: 1;
  min-height: 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #2a2a2a;
  border-bottom: 1px solid #333;
  font-size: 12px;
  font-weight: 600;
  color: #e0e0e0;
}

.layer-actions {
  display: flex;
  gap: 4px;
}

.layer-actions button {
  width: 24px;
  height: 24px;
  background: #3a3a3a;
  border: 1px solid #555;
  border-radius: 4px;
  color: #ddd;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.layer-actions button:hover {
  background: #4a4a4a;
  border-color: #666;
}

.layer-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.empty-hint {
  padding: 20px;
  text-align: center;
  color: #666;
  font-size: 12px;
}

.layer-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 4px;
  background: #252525;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.layer-item:hover {
  background: #2d2d2d;
}

.layer-item.active {
  background: #3a7bc8;
}

.layer-icon {
  font-size: 16px;
}

.layer-name {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #ddd;
}

.layer-item.active .layer-name {
  color: #fff;
}

.layer-delete {
  width: 20px;
  height: 20px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #888;
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
}

.layer-item:hover .layer-delete {
  opacity: 1;
}

.layer-delete:hover {
  background: #f44;
  color: #fff;
}

/* 属性区 */
.prop-content {
  padding: 14px;
}

.prop-row {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.prop-row:last-child {
  margin-bottom: 0;
}

.prop-row.single {
  display: block;
}

.prop-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prop-item.full {
  flex: none;
  width: 100%;
}

.prop-item label {
  font-size: 10px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.prop-item input,
.prop-item select {
  width: 100%;
  padding: 8px 10px;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #fff;
  font-size: 12px;
  font-family: monospace;
}

.prop-item input:focus,
.prop-item select:focus {
  outline: none;
  border-color: #3a7bc8;
}

.prop-group-title {
  font-size: 11px;
  font-weight: 600;
  color: #aaa;
  margin: 12px 0 8px 0;
  padding-bottom: 4px;
  border-bottom: 1px solid #333;
}

.prop-group-title:first-child {
  margin-top: 0;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  color: #ddd;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #3a7bc8;
}
</style>
