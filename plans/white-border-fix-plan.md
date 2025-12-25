# 白边功能修复计划

## 问题分析

### 问题1：前端白边功能仍在使用全局参数

**文件**: `frontend/src/composables/useCanvasRenderer.ts`

**问题位置**: 第775-803行 `drawMaskExpansionOutline` 函数

**问题代码**:
```typescript
function drawMaskExpansionOutline(
  ctx: CanvasRenderingContext2D,
  layer: any,
  props: any,
  w: number,
  h: number,
  anchorOffsetX: number,
  anchorOffsetY: number
) {
  if (!layer.maskCanvas) return

  const maskExpansion = store.project.mask_expansion || 0  // ❌ 使用全局项目参数
  const maskFeather = store.project.mask_feather || 0      // ❌ 使用全局项目参数

  if (maskExpansion === 0 && maskFeather === 0) return

  const result = applyMaskExpansion(layer.maskCanvas, maskExpansion, maskFeather, w, h)
  // ...
}
```

**正确做法**: 应该使用 `props.mask_expansion` 和 `props.mask_feather`（每图层独立参数）

---

### 问题2：后端白边功能被删除

**文件**: `ae_animation_core.py`

**问题**: 在重构为每图层独立遮罩扩展时，白边功能被删除了。之前白边功能是通过后处理实现的：

1. 扩展遮罩（dilation）
2. 应用羽化（Gaussian blur）
3. 计算边缘遮罩（expanded_mask - original_mask）
4. 在边缘添加白色像素

**当前状态**: 后端只更新了 `mask_canvas`，没有在画布上添加白边效果。

---

### 问题3：前后端参数范围不一致

| 参数 | 前端范围 | 后端widget范围 | 说明 |
|------|----------|---------------|------|
| mask_expansion | -50 到 50 | -255 到 255 | 前端范围较小 |
| mask_feather | 0 到 50 | 0 到 100 | 前端范围较小 |

**影响**: 如果前端设置的值超出后端处理范围，可能导致效果不一致。

---

## 修复方案

### 修复1：前端 - 使用每图层独立参数

**文件**: `frontend/src/composables/useCanvasRenderer.ts`

**修改位置**: 第775-803行 `drawMaskExpansionOutline` 函数

**修改内容**:
```typescript
function drawMaskExpansionOutline(
  ctx: CanvasRenderingContext2D,
  layer: any,
  props: any,
  w: number,
  h: number,
  anchorOffsetX: number,
  anchorOffsetY: number
) {
  if (!layer.maskCanvas) return

  // ✅ 使用每图层独立参数
  const maskExpansion = props.mask_expansion || 0
  const maskFeather = props.mask_feather || 0

  if (maskExpansion === 0 && maskFeather === 0) return

  const result = applyMaskExpansion(layer.maskCanvas, maskExpansion, maskFeather, w, h)
  if (!result) return

  // Draw white border at edges (edge mask)
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = 'white'
  
  // Draw edge mask with white color
  ctx.drawImage(result.edgeMask, -w / 2 - anchorOffsetX, -h / 2 - anchorOffsetY, w, h)
  
  ctx.restore()
}
```

---

### 修复2：后端 - 在渲染函数中添加白边效果

**文件**: `ae_animation_core.py`

**修改位置**: 三个渲染函数
- `_render_layer_3d` (第502-566行)
- `_render_layer_2d_with_3d_rotation` (第569-730行)
- `_render_layer_2d` (第760-852行)

**修改方案**: 在每个渲染函数中，对于前景图层，在更新 mask_canvas 之后，在 canvas 上添加白边效果。

**白边效果实现逻辑**:
```python
# 白边效果实现（在渲染函数中）
if is_foreground and layer_mask_expansion > 0:
    # 1. 保存原始遮罩
    original_mask = mask_layer.copy()
    
    # 2. 扩展遮罩
    kernel = np.ones((3, 3), np.uint8)
    expanded_mask = cv2.dilate(mask_layer, kernel, iterations=layer_mask_expansion)
    
    # 3. 应用羽化
    if layer_mask_feather > 0:
        ksize = max(3, layer_mask_feather * 2 + 1)
        expanded_mask = cv2.GaussianBlur(expanded_mask, (ksize, ksize), 0)
    
    # 4. 计算边缘遮罩（expanded - original）
    edge_mask = np.clip(expanded_mask.astype(np.int16) - original_mask.astype(np.int16), 0, 255).astype(np.uint8)
    
    # 5. 在边缘添加白色
    edge_alpha = edge_mask.astype(np.float32) / 255.0
    for c in range(3):
        canvas[:, :, c] = (canvas[:, :, c] * (1 - edge_alpha) +
                          255 * edge_alpha).astype(np.uint8)
    
    # 6. 更新 mask_canvas 为扩展后的遮罩
    mask_canvas[:] = np.maximum(mask_canvas, expanded_mask)
```

---

### 修复3：校准前后端参数范围

**选项1**: 统一使用前端范围（推荐）
- 前端保持不变：扩展值 -50 到 50，羽化值 0 到 50
- 后端 widget 范围调整为与前端一致
- 后端处理逻辑保持不变

**选项2**: 统一使用后端范围
- 后端保持不变：扩展值 -255 到 255，羽化值 0 到 100
- 前端范围调整为与后端一致

**推荐**: 选项1（统一使用前端范围），因为：
1. 前端范围更适合实际使用场景
2. 用户界面已经使用前端范围
3. 避免用户设置过大值导致性能问题

---

## 实施步骤

1. **修复前端白边功能**
   - 修改 `useCanvasRenderer.ts` 中的 `drawMaskExpansionOutline` 函数
   - 使用 `props.mask_expansion` 和 `props.mask_feather` 代替全局参数

2. **修复后端白边功能**
   - 修改 `_render_layer_3d` 函数，添加白边效果
   - 修改 `_render_layer_2d_with_3d_rotation` 函数，添加白边效果
   - 修改 `_render_layer_2d` 函数，添加白边效果

3. **校准前后端参数范围**
   - 修改后端 widget 范围与前端一致

4. **验证**
   - 编译前端代码
   - 验证 Python 语法
   - 测试白边效果

---

## 预期结果

修复后：
1. 前端预览中每图层独立显示白边效果
2. 后端渲染输出中每图层独立显示白边效果
3. 前后端白边效果一致
4. 前后端参数范围一致
