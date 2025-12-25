# ComfyUI-AE-Animation 功能实现计划

## 概述

本文档描述两个新功能的详细实现方案：
1. **前景遮罩扩展功能** - 添加可调节的白色边框到裁剪的主体
2. **全局工作区重置功能** - 一键删除所有图层并清除界面内容

---

## 功能 1：前景遮罩扩展功能

### 功能描述

为前景图层添加可调节的遮罩扩展（白色边框）功能，允许用户通过滑块实时预览和调整边框厚度。

### 现有代码分析

**后端** ([`ae_animation_core.py`](../ae_animation_core.py)):
- 已有 `mask_expansion` 参数 (line 323, 788, 1025-1028)
- 已有 `_apply_custom_mask()` 函数 (line 247-277)
- 已有遮罩膨胀逻辑：使用 `cv2.dilate` 或 `cv2.erode`

**前端** ([`timelineStore.ts`](../frontend/src/stores/timelineStore.ts)):
- 已有 `mask_expansion` 项目属性 (line 75)
- 已有 `mask_feather` 项目属性 (line 76)

### 实现方案

#### 后端修改

**状态：无需修改**

后端已完全支持遮罩扩展功能：
- `mask_expansion` 参数范围：-255 到 255
- 正值 = 膨胀（dilate，白色边框）
- 负值 = 收缩（erode，减少遮罩区域）
- 在 `execute()` 方法中应用 (line 1025-1028)

#### 前端修改

**需要修改的文件**：
1. [`frontend/src/components/timeline/ProjectSettings.vue`](../frontend/src/components/timeline/ProjectSettings.vue)
2. [`frontend/src/TimelineApp.vue`](../frontend/src/TimelineApp.vue)

**修改内容**：

##### 1.1 在 ProjectSettings.vue 中添加遮罩扩展滑块

在"项目"部分后添加新的设置区域：

```vue
<!-- 遮罩扩展设置 -->
<div class="section-title">🎭 遮罩扩展</div>
<div class="setting-row">
  <label>扩展</label>
  <input 
    type="range" 
    min="-50" 
    max="50" 
    step="1" 
    :value="store.project.mask_expansion" 
    @input="updateMaskExpansion" 
  />
  <span class="prop-value">{{ store.project.mask_expansion }}px</span>
</div>
<div class="setting-row">
  <label>羽化</label>
  <input 
    type="range" 
    min="0" 
    max="20" 
    step="1" 
    :value="store.project.mask_feather" 
    @input="updateMaskFeather" 
  />
  <span class="prop-value">{{ store.project.mask_feather }}px</span>
</div>
```

添加对应的处理函数：

```typescript
function updateMaskExpansion(e: Event) {
  store.setProject({ mask_expansion: parseInt((e.target as HTMLInputElement).value) || 0 })
}

function updateMaskFeather(e: Event) {
  store.setProject({ mask_feather: parseInt((e.target as HTMLInputElement).value) || 0 })
}
```

##### 1.2 在 TimelineApp.vue 中同步到节点 widgets

在 `save()` 函数中添加：

```typescript
updateWidget('mask_expansion', store.project.mask_expansion)
updateWidget('mask_feather', store.project.mask_feather)
```

在 `loadFromNodeWidgets()` 函数中添加：

```typescript
const maskExpansion = toNumber(getWidget('mask_expansion')?.value, store.project.mask_expansion)
const maskFeather = toNumber(getWidget('mask_feather')?.value, store.project.mask_feather)
```

### 实现步骤

1. 在 `ProjectSettings.vue` 中添加遮罩扩展 UI 控件
2. 添加 `updateMaskExpansion()` 和 `updateMaskFeather()` 函数
3. 在 `TimelineApp.vue` 中同步 `mask_expansion` 到节点 widget
4. 在 `TimelineApp.vue` 中同步 `mask_feather` 到节点 widget
5. 测试前端编译：`npm run build`
6. 测试功能：调整滑块 → 运行节点 → 验证遮罩扩展效果

---

## 功能 2：全局工作区重置功能

### 功能描述

在 UI 中添加"重置工作区"按钮，一键删除所有图层、清除所有关键帧，并重置项目设置到默认值。

### 现有代码分析

**前端** ([`timelineStore.ts`](../frontend/src/stores/timelineStore.ts)):
- 已有 `clearLayers()` 函数 (line 283-289) - 删除所有图层
- 已有 `clearAllKeyframes()` 函数 (line 696-702) - 清除当前图层所有关键帧
- 已有 `project` 默认值 (line 111-133)

### 实现方案

#### 前端修改

**需要修改的文件**：
1. [`frontend/src/stores/timelineStore.ts`](../frontend/src/stores/timelineStore.ts)
2. [`frontend/src/TimelineApp.vue`](../frontend/src/TimelineApp.vue)

#### 2.1 在 timelineStore.ts 中添加重置工作区函数

```typescript
function resetWorkspace() {
  // 清除所有图层
  layers.value = []
  currentLayerIndex.value = -1
  originalLayerProperties.value.clear()
  
  // 清除项目关键帧
  projectKeyframes.value = {}
  
  // 重置项目设置到默认值
  project.value = {
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
    preview_mode: '2d'
  }
  
  // 重置工具模式
  maskMode.value = { enabled: false, drawing: false, erase: false, brush: 20 }
  pathMode.value = { enabled: false, data: null }
  extractMode.value = { enabled: false, drawing: false, brush: 30, blurType: 'gaussian' }
  
  // 停止播放
  isPlaying.value = false
  stopPlaybackLoop()
  setCurrentTime(0)
  
  // 清除历史记录
  history.value = []
  historyIndex.value = -1
  
  // 保存历史记录
  saveHistory()
}
```

导出该函数：

```typescript
return {
  // ... 现有导出
  resetWorkspace
}
```

#### 2.2 在 TimelineApp.vue 中添加重置按钮

在 header 右侧区域添加"重置工作区"按钮：

```vue
<div class="header-right">
  <div class="project-inputs">
    <!-- 现有输入框 -->
  </div>
  <button class="btn btn-warning" @click="resetWorkspace" title="重置工作区">Reset</button>
  <button class="btn btn-primary" @click="addForeground">+ FG Layer</button>
  <button class="btn btn-secondary" @click="addBackground">+ BG Layer</button>
  <div class="header-divider"></div>
  <button class="btn btn-accent" @click="save" title="保存到节点">Save</button>
  <button class="btn btn-close" @click="close" title="关闭">Close</button>
</div>
```

添加对应的处理函数：

```typescript
function resetWorkspace() {
  if (!confirm('确定要重置工作区吗？这将删除所有图层和关键帧，无法撤销。')) {
    return
  }
  store.resetWorkspace()
  canvasPreviewRef.value?.scheduleRender?.()
}
```

添加按钮样式：

```css
.btn-warning {
  background: #ff9800 !important;
  color: #fff !important;
}
.btn-warning:hover {
  background: #e68a00 !important;
  color: #fff !important;
}
```

### 实现步骤

1. 在 `timelineStore.ts` 中添加 `resetWorkspace()` 函数
2. 在 `timelineStore.ts` 中导出 `resetWorkspace` 函数
3. 在 `TimelineApp.vue` 中添加"重置工作区"按钮
4. 在 `TimelineApp.vue` 中添加 `resetWorkspace()` 函数
5. 添加 `.btn-warning` 样式
6. 测试功能：点击重置按钮 → 验证所有内容被清除

---

## 文件修改汇总

| 文件 | 修改内容 | 优先级 | 状态 |
|------|----------|--------|------|
| `frontend/src/components/timeline/ProjectSettings.vue` | 添加遮罩扩展 UI 控件 | 中 | ✅ 已完成 |
| `frontend/src/stores/timelineStore.ts` | 添加 `resetWorkspace()` 函数并导出 | 高 | ✅ 已完成 |
| `frontend/src/TimelineApp.vue` | 添加重置工作区按钮和同步逻辑 | 高 | ✅ 已完成 |

---

## 测试计划

### 功能 1：遮罩扩展功能测试

1. **UI 测试**
   - [x] 遮罩扩展滑块显示正常
   - [ ] 滑块范围正确（-50 到 50）
   - [ ] 数值显示正确

2. **功能测试**
   - [ ] 正值（扩展）产生白色边框
   - [ ] 负值（收缩）减少遮罩区域
   - [ ] 零值无效果

3. **同步测试**
   - [ ] UI 值同步到节点 widget
   - [ ] 运行节点后效果正确

### 功能 2：重置工作区功能测试

1. **UI 测试**
   - [x] 重置按钮显示正常
   - [ ] 按钮样式正确（警告色）

2. **功能测试**
   - [ ] 点击按钮弹出确认对话框
   - [ ] 确认后所有图层被删除
   - [ ] 所有关键帧被清除
   - [ ] 项目设置恢复到默认值
   - [ ] 播放停止，时间重置为 0
   - [ ] 历史记录被清除

3. **边界测试**
   - [ ] 取消确认对话框无效果
   - [ ] 重置后可以正常添加新图层

---

## 注意事项

1. **后端兼容性**
   - 后端已完全支持 `mask_expansion` 和 `mask_feather` 参数
   - 无需修改后端代码

2. **撤销功能**
   - 重置工作区操作无法撤销（已通过确认对话框提示）
   - 建议在确认对话框中明确说明

3. **数据持久化**
   - 重置工作区后应调用 `save()` 保存到节点
   - 确保工作流保存后重置状态被保留

4. **用户体验**
   - 遮罩扩展滑块应提供实时预览（通过 CanvasPreview）
   - 重置按钮使用警告色以区别于其他操作按钮

---

## 实现优先级

| 优先级 | 任务 | 预估复杂度 | 状态 |
|--------|------|------------|------|
| P0 | 在 timelineStore.ts 添加 resetWorkspace 函数 | 低 | ✅ 已完成 |
| P0 | 在 TimelineApp.vue 添加重置按钮 | 低 | ✅ 已完成 |
| P1 | 在 ProjectSettings.vue 添加遮罩扩展 UI | 中 | ✅ 已完成 |
| P1 | 在 TimelineApp.vue 同步遮罩扩展参数 | 中 | ✅ 已完成 |
