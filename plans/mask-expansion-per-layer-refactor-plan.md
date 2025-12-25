# 遮罩扩展功能重构计划：从全局设置改为每个图层的独立属性

## 1. 当前实现分析

### 1.1 当前数据流

```
ProjectSettings.vue (滑块)
    ↓
store.project.mask_expansion / mask_feather (全局设置)
    ↓
TimelineApp.vue save() 函数
    ↓
后端 widget: mask_expansion / mask_feather (全局参数)
    ↓
ae_animation_core.py 处理 (对所有前景图层应用相同的值)
```

### 1.2 当前问题

- **问题1**: 遮罩扩展是全局设置，所有前景图层共享相同的扩展值
- **问题2**: 无法为不同图层设置不同的遮罩扩展效果
- **问题3**: UI控件绑定到全局设置，而不是当前选中图层

## 2. 新实现方案

### 2.1 数据结构设计

#### Layer 接口修改
```typescript
export interface Layer {
  id: string
  name: string
  type: 'foreground' | 'background'
  image_data?: string
  image_ref?: AssetRef
  img?: HTMLImageElement
  
  // 2D 变换
  x: number
  y: number
  z?: number
  scale: number
  rotation: number
  opacity: number
  
  // 3D 模式
  is3D?: boolean
  rotationX?: number
  rotationY?: number
  rotationZ?: number
  scaleX?: number
  scaleY?: number
  scaleZ?: number
  anchorX?: number
  anchorY?: number
  perspective?: number
  
  // Mask (原有)
  mask_size: number
  customMask?: string
  customMask_ref?: AssetRef
  maskCanvas?: HTMLCanvasElement
  maskVersion?: number
  
  // 遮罩扩展 (新增)
  mask_expansion: number  // 遮罩扩展值（正数扩展，负数收缩）
  mask_feather: number     // 遮罩羽化值
  
  // 路径动画
  bezierPath?: BezierPoint[]
  usePathAnimation?: boolean
  
  // 其他
  keyframes: Record<string, Keyframe[]>
  bg_mode?: 'fit' | 'fill' | 'stretch'
  [key: string]: any
}
```

#### Project 接口修改（移除遮罩扩展相关）
```typescript
export interface Project {
  width: number
  height: number
  fps: number
  duration: number
  total_frames: number
  
  // 移除以下属性（移到 Layer）
  // mask_expansion: number
  // mask_feather: number
  
  hdr_enable: boolean
  hdr_exposure: number
  pano_enable: boolean
  cam_enable?: boolean
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
```

### 2.2 新数据流

```
ProjectSettings.vue (滑块)
    ↓
store.currentLayer.mask_expansion / mask_feather (当前选中图层的值)
    ↓
TimelineApp.vue save() 函数
    ↓
后端 widget: 每个图层的 mask_expansion / mask_feather
    ↓
ae_animation_core.py 处理 (使用每个图层的独立值)
```

## 3. 修改文件清单

### 3.1 前端文件

| 文件 | 修改内容 |
|------|----------|
| `frontend/src/stores/timelineStore.ts` | 1. 在 `Layer` 接口添加 `mask_expansion` 和 `mask_feather` 属性<br>2. 从 `Project` 接口移除 `mask_expansion` 和 `mask_feather` 属性<br>3. 在 `project` ref 中移除 `mask_expansion` 和 `mask_feather`<br>4. 在 `addLayer` 函数中为每个图层初始化默认值<br>5. 在 `loadAnimation` 函数中处理每个图层的遮罩扩展值<br>6. 在 `exportAnimation` 函数中导出每个图层的遮罩扩展值 |
| `frontend/src/components/timeline/ProjectSettings.vue` | 1. 修改滑块绑定从 `store.project.mask_expansion` 改为 `store.currentLayer?.mask_expansion`<br>2. 添加当前选中图层检查，如果没有选中图层则禁用控件<br>3. 添加提示信息说明当前设置的图层 |
| `frontend/src/TimelineApp.vue` | 1. 修改 `save()` 函数，将每个图层的遮罩扩展值保存到 widget<br>2. 修改 `loadFromNodeWidgets()` 函数，从 widget 加载每个图层的遮罩扩展值<br>3. 确保 widget 名称与图层 ID 关联（如 `layer_0_mask_expansion`） |
| `frontend/src/composables/useCanvasRenderer.ts` | 1. 修改渲染逻辑，使用每个图层的 `mask_expansion` 和 `mask_feather` 值<br>2. 确保遮罩扩展效果正确应用到每个图层 |

### 3.2 后端文件

| 文件 | 修改内容 |
|------|----------|
| `ae_animation_core.py` | 1. 修改图层数据处理逻辑，从每个图层获取 `mask_expansion` 和 `mask_feather`<br>2. 在渲染每个前景图层时使用该图层的遮罩扩展值<br>3. 确保图层序列化/反序列化正确处理遮罩扩展值 |

## 4. Widget 命名方案

由于每个图层需要独立的遮罩扩展值，widget 命名需要与图层 ID 关联：

```
layer_0_mask_expansion
layer_0_mask_feather
layer_1_mask_expansion
layer_1_mask_feather
...
```

或者使用 JSON 格式存储所有图层的遮罩扩展值：

```json
{
  "layers_mask_expansion": {
    "layer_0": 10,
    "layer_1": 5,
    ...
  },
  "layers_mask_feather": {
    "layer_0": 2,
    "layer_1": 0,
    ...
  }
}
```

## 5. UI 交互设计

### 5.1 ProjectSettings.vue 更新

```vue
<template>
  <div class="section-title">🎭 遮罩扩展</div>
  
  <!-- 显示当前选中的图层 -->
  <div class="layer-info" v-if="currentLayer">
    <span class="layer-name">{{ currentLayer.name }}</span>
  </div>
  
  <div class="setting-row slider-row">
    <label>扩展</label>
    <input 
      type="range" 
      min="-50" 
      max="50" 
      step="1" 
      :value="currentLayerMaskExpansion" 
      @input="updateMaskExpansion" 
      :disabled="!currentLayer || currentLayer.type !== 'foreground'"
    />
    <span class="prop-value">{{ currentLayerMaskExpansion }}px</span>
  </div>
  
  <div class="setting-row slider-row">
    <label>羽化</label>
    <input 
      type="range" 
      min="0" 
      max="50" 
      step="1" 
      :value="currentLayerMaskFeather" 
      @input="updateMaskFeather"
      :disabled="!currentLayer || currentLayer.type !== 'foreground'"
    />
    <span class="prop-value">{{ currentLayerMaskFeather }}px</span>
  </div>
  
  <div class="no-layer-warning" v-if="!currentLayer">
    请选择一个前景图层来设置遮罩扩展
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore'

const store = useTimelineStore()

const currentLayer = computed(() => store.currentLayer)

const currentLayerMaskExpansion = computed(() => 
  currentLayer.value?.mask_expansion ?? 0
)

const currentLayerMaskFeather = computed(() => 
  currentLayer.value?.mask_feather ?? 0
)

function updateMaskExpansion(event: Event) {
  const value = parseInt((event.target as HTMLInputElement).value, 10)
  if (!isNaN(value) && currentLayer.value) {
    store.updateLayer(store.currentLayerIndex, { mask_expansion: value })
  }
}

function updateMaskFeather(event: Event) {
  const value = parseInt((event.target as HTMLInputElement).value, 10)
  if (!isNaN(value) && currentLayer.value) {
    store.updateLayer(store.currentLayerIndex, { mask_feather: value })
  }
}
</script>
```

## 6. 执行步骤

1. 修改 `timelineStore.ts` 中的 `Layer` 接口
2. 修改 `timelineStore.ts` 中的 `Project` 接口
3. 修改 `timelineStore.ts` 中的 `addLayer` 函数
4. 修改 `timelineStore.ts` 中的 `loadAnimation` 函数
5. 修改 `timelineStore.ts` 中的 `exportAnimation` 函数
6. 修改 `ProjectSettings.vue` 组件
7. 修改 `TimelineApp.vue` 的 `save()` 函数
8. 修改 `TimelineApp.vue` 的 `loadFromNodeWidgets()` 函数
9. 修改 `useCanvasRenderer.ts` 中的遮罩扩展应用逻辑
10. 修改 `ae_animation_core.py` 中的图层数据处理逻辑
11. 编译并验证功能

## 7. 注意事项

1. **向后兼容性**: 需要处理旧项目文件中没有图层遮罩扩展值的情况，提供默认值
2. **性能考虑**: 避免频繁的 store 更新，使用防抖处理
3. **UI 反馈**: 在图层切换时，UI 控件应该立即更新显示的值
4. **默认值**: 新图层的 `mask_expansion` 默认为 0，`mask_feather` 默认为 0
5. **类型限制**: 只有前景图层（type === 'foreground'）才有遮罩扩展功能
