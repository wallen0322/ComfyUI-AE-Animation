# 遮罩数据同步问题分析报告

## 问题描述

将遮罩扩展功能从全局项目设置重构为每个图层独立属性后，遮罩数据无法正确传递到后端，导致最终输出的遮罩形态和前景白边出现错误。

## 问题根源分析

### 1. 数据流概览

```
UI (ProjectSettings.vue)
  ↓ 更新当前图层的 mask_expansion/mask_feather
Store (timelineStore.ts)
  ↓ 保存到 layer 对象
TimelineApp.vue save()
  ↓ 调用 exportAnimation()
  ↓ 保存到 layers_keyframes widget
后端 (ae_animation_core.py)
  ↓ 解析 layers_keyframes JSON
  ↓ 渲染图层
  ↓ 应用遮罩扩展
```

### 2. 问题点 1：TimelineApp.vue 中无效的 widget 更新

**位置**: [`frontend/src/TimelineApp.vue:1259-1266`](frontend/src/TimelineApp.vue:1259-1266)

```typescript
// 为每个图层保存 mask_expansion 和 mask_feather 值
for (let i = 0; i < store.layers.length; i++) {
  const layer = store.layers[i]
  if (layer.type === 'foreground') {
    updateWidget(`layer_${i}_mask_expansion`, layer.mask_expansion ?? 0)
    updateWidget(`layer_${i}_mask_feather`, layer.mask_feather ?? 0)
  }
}
```

**问题**:
- 后端 `ae_animation_core.py` 的 `define_schema` 中只定义了全局的 `mask_expansion` 和 `mask_feather` widget（第323-324行）
- 没有定义 `layer_0_mask_expansion`、`layer_0_mask_feather` 这样的 widget
- `updateWidget()` 尝试更新不存在的 widget 会失败，导致错误日志

**影响**:
- 这段代码不会导致数据丢失，因为遮罩扩展值已经通过 `layers_keyframes` widget 传递
- 但会产生不必要的错误日志，影响调试

### 3. 问题点 2：后端后处理逻辑使用全局遮罩扩展值

**位置**: [`ae_animation_core.py:1029-1064`](ae_animation_core.py:1029-1064)

```python
# Post-processing: create white border effect around foreground objects
# Only apply white at edges (expanded area), not over foreground content
if mask_expansion > 0:
    # Save original mask before expansion
    original_mask = mask_canvas.copy()
    
    # Expand mask (dilation)
    kernel = np.ones((3, 3), np.uint8)
    expanded_mask = cv2.dilate(mask_canvas, kernel, iterations=mask_expansion)
    
    # Apply feathering to expanded mask
    if mask_feather > 0:
        ksize = max(3, mask_feather * 2 + 1)
        expanded_mask = cv2.GaussianBlur(expanded_mask, (ksize, ksize), 0)
    
    # Create edge mask: only the expanded area (white border)
    edge_mask = np.clip(expanded_mask.astype(np.int16) - original_mask.astype(np.int16), 0, 255).astype(np.uint8)
    
    # Apply white only at edges
    edge_alpha = edge_mask.astype(np.float32) / 255.0
    for c in range(3):
        canvas[:, :, c] = (canvas[:, :, c] * (1 - edge_alpha) +
                          255 * edge_alpha).astype(np.uint8)
    
    # Update mask_canvas to expanded version for output
    mask_canvas = expanded_mask
elif mask_expansion < 0:
    # Contract mask (erosion)
    kernel = np.ones((3, 3), np.uint8)
    mask_canvas = cv2.erode(mask_canvas, kernel, iterations=abs(mask_expansion))
else:
    # Only apply feathering if no expansion
    if mask_feather > 0:
        ksize = max(3, mask_feather * 2 + 1)
        mask_canvas = cv2.GaussianBlur(mask_canvas, (ksize, ksize), 0)
```

**问题**:
- 这段代码使用的是全局的 `mask_expansion` 和 `mask_feather` 参数（execute 函数的参数）
- 但实际上每个图层都有独立的遮罩扩展值（存储在 `layer_render_data` 中）
- 当前实现对所有前景图层使用相同的全局遮罩扩展值，而不是每个图层各自的值

**影响**:
- 这是导致遮罩数据同步问题的核心原因
- 用户设置的每个图层的独立遮罩扩展值被忽略
- 所有图层都使用全局 widget 的值（默认为 0）

### 4. 数据正确传递的部分

以下部分是正确实现的：

1. **前端 Store 导出** ([`timelineStore.ts:796-798`](frontend/src/stores/timelineStore.ts:796-798)):
```typescript
// 遮罩扩展（每个图层的独立属性）
mask_expansion: l.mask_expansion,
mask_feather: l.mask_feather,
```

2. **前端 Store 加载** ([`timelineStore.ts:626-627`](frontend/src/stores/timelineStore.ts:626-627)):
```typescript
// 遮罩扩展（每个图层的独立属性）
mask_expansion: l.mask_expansion ?? 0,
mask_feather: l.mask_feather ?? 0,
```

3. **TimelineApp.vue 保存到 layers_keyframes** ([`TimelineApp.vue:1215-1245`](frontend/src/TimelineApp.vue:1215-1245)):
```typescript
const anim = store.exportAnimation()
const jsonStr = JSON.stringify({
  layers: anim.layers,
  project_keyframes: store.projectKeyframes,
  project: anim.project
})
lw.value = jsonStr
```

4. **后端解码图层** ([`ae_animation_core.py:461-462`](ae_animation_core.py:461-462)):
```python
# Mask expansion (per-layer property)
"mask_expansion": layer.get("mask_expansion", 0),
"mask_feather": layer.get("mask_feather", 0),
```

5. **后端收集图层渲染数据** ([`ae_animation_core.py:927-928`](ae_animation_core.py:927-928)):
```python
"mask_expansion": layer.get("mask_expansion", 0),
"mask_feather": layer.get("mask_feather", 0),
```

## 修复方案

### 修复 1：移除 TimelineApp.vue 中无效的 widget 更新代码

**文件**: [`frontend/src/TimelineApp.vue`](frontend/src/TimelineApp.vue:1259-1266)

删除以下代码：
```typescript
// 为每个图层保存 mask_expansion 和 mask_feather 值
for (let i = 0; i < store.layers.length; i++) {
  const layer = store.layers[i]
  if (layer.type === 'foreground') {
    updateWidget(`layer_${i}_mask_expansion`, layer.mask_expansion ?? 0)
    updateWidget(`layer_${i}_mask_feather`, layer.mask_feather ?? 0)
  }
}
```

**原因**: 这些 widget 在后端不存在，更新它们会产生错误。遮罩扩展值已经通过 `layers_keyframes` widget 正确传递。

### 修复 2：修改后端后处理逻辑使用图层级遮罩扩展值

**文件**: [`ae_animation_core.py`](ae_animation_core.py:1029-1064)

将后处理逻辑从全局遮罩扩展改为图层级遮罩扩展：

```python
# Post-processing: create white border effect around foreground objects
# Only apply white at edges (expanded area), not over foreground content
# 使用每个图层的 mask_expansion 和 mask_feather 值
layer_mask_expansion = data.get("mask_expansion", 0)
layer_mask_feather = data.get("mask_feather", 0)

# 向后兼容：如果图层值为 0 且全局值不为 0，则使用全局值
if layer_mask_expansion == 0 and mask_expansion != 0:
    layer_mask_expansion = mask_expansion
if layer_mask_feather == 0 and mask_feather != 0:
    layer_mask_feather = mask_feather

if layer_mask_expansion > 0:
    # Save original mask before expansion
    original_mask = mask_canvas.copy()
    
    # Expand mask (dilation)
    kernel = np.ones((3, 3), np.uint8)
    expanded_mask = cv2.dilate(mask_canvas, kernel, iterations=layer_mask_expansion)
    
    # Apply feathering to expanded mask
    if layer_mask_feather > 0:
        ksize = max(3, layer_mask_feather * 2 + 1)
        expanded_mask = cv2.GaussianBlur(expanded_mask, (ksize, ksize), 0)
    
    # Create edge mask: only the expanded area (white border)
    edge_mask = np.clip(expanded_mask.astype(np.int16) - original_mask.astype(np.int16), 0, 255).astype(np.uint8)
    
    # Apply white only at edges
    edge_alpha = edge_mask.astype(np.float32) / 255.0
    for c in range(3):
        canvas[:, :, c] = (canvas[:, :, c] * (1 - edge_alpha) +
                          255 * edge_alpha).astype(np.uint8)
    
    # Update mask_canvas to expanded version for output
    mask_canvas = expanded_mask
elif layer_mask_expansion < 0:
    # Contract mask (erosion)
    kernel = np.ones((3, 3), np.uint8)
    mask_canvas = cv2.erode(mask_canvas, kernel, iterations=abs(layer_mask_expansion))
else:
    # Only apply feathering if no expansion
    if layer_mask_feather > 0:
        ksize = max(3, layer_mask_feather * 2 + 1)
        mask_canvas = cv2.GaussianBlur(mask_canvas, (ksize, ksize), 0)
```

**注意**: 这个修复需要将后处理逻辑移到图层渲染循环内部，而不是在所有图层渲染完成后统一处理。

## 验证步骤

1. 创建多个前景图层
2. 为每个图层设置不同的 mask_expansion 值（如 5, 10, 15）
3. 保存并运行节点
4. 检查输出的遮罩是否正确反映了每个图层的不同扩展值

## 总结

问题的核心在于后端的后处理逻辑仍然使用全局的 `mask_expansion` 和 `mask_feather` 参数，而忽略了每个图层独立的遮罩扩展值。修复方案包括：

1. 移除前端无效的 widget 更新代码
2. 修改后端后处理逻辑，在图层渲染循环内部使用每个图层的遮罩扩展值
