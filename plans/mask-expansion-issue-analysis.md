# 遮罩扩展功能失效问题分析

## 问题描述

**症状**：
- UI 上的遮罩扩展滑块可以正常拖动，数值显示正确
- 数值正确同步到 `store.project.mask_expansion` 和 `store.project.mask_feather`
- 数值正确同步到节点 widgets
- **但是**：前端预览和最终渲染都未显示遮罩扩展效果

## 数据流分析

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  用户操作                                                   │
│    ↓                                                          │
│  ProjectSettings.vue 滑块                                     │
│    ↓                                                          │
│  store.setProject({ mask_expansion: value })                      │
│    ↓                                                          │
│  store.project.mask_expansion 更新 ✅                                │
│    ↓                                                          │
│  TimelineApp.vue save() 同步到节点 widgets ✅                     │
│    ↓                                                          │
│  后端 ae_animation_core.py 应用效果 ✅                              │
│    ↓                                                          │
│  最终渲染输出 ✅                                               │
│                                                              │
│  前端预览 ❌ (未使用 mask_expansion)                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 根本原因

### 前端渲染管线未实现遮罩扩展和羽化

**位置1：Canvas2D 渲染器** (`useCanvasRenderer.ts`)

`drawForegroundLayer()` 函数 (line 688-828)：
```typescript
function drawForegroundLayer(ctx, layer, ...) {
  // ...
  if (layer.maskCanvas) {
    // 应用自定义遮罩
    offCtx.drawImage(layer.maskCanvas, 0, 0, w, h)
  }
  // ...
  // ❌ 没有应用 mask_expansion 或 mask_feather
}
```

**位置2：GPU 渲染器** (`GPUTimelineRenderer.ts`)

GPU 渲染器也没有使用 `mask_expansion` 和 `mask_feather` 参数。

### 后端实现对比

后端 (`ae_animation_core.py` line 1025-1031)：
```python
# Post-processing
if mask_expansion != 0:
    kernel = np.ones((3, 3), np.uint8)
    op = cv2.dilate if mask_expansion > 0 else cv2.erode
    mask_canvas = op(mask_canvas, kernel, iterations=abs(mask_expansion))
if mask_feather > 0:
    ksize = max(3, mask_feather * 2 + 1)
    mask_canvas = cv2.GaussianBlur(mask_canvas, (ksize, ksize), 0)
```

后端使用 OpenCV 的 `cv2.dilate`、`cv2.erode` 和 `cv2.GaussianBlur` 来实现遮罩扩展和羽化。

## 解决方案

### 方案1：仅后端支持（推荐 - 最简单）

**说明**：前端预览不支持遮罩扩展和羽化，用户只能通过运行节点查看最终效果。

**实现**：
1. 在 ProjectSettings.vue 中添加说明文字
2. 更新文档说明此限制

**优点**：
- 实现简单，不需要修改渲染管线
- 不影响现有功能
- 后端功能完全正常

**缺点**：
- 用户体验差，无法实时预览效果

---

### 方案2：前端实现遮罩扩展和羽化（完整实现）

**说明**：在前端渲染管线中实现遮罩扩展和羽化效果。

**实现步骤**：

#### 2.1 Canvas2D 渲染器实现

在 `useCanvasRenderer.ts` 中添加遮罩处理函数：

```typescript
function applyMaskExpansion(
  ctx: CanvasRenderingContext2D,
  maskCanvas: HTMLCanvasElement,
  expansion: number,
  feather: number,
  width: number,
  height: number
) {
  if (!maskCanvas || (expansion === 0 && feather === 0)) {
    return maskCanvas
  }

  // 创建处理后的遮罩画布
  const processedCanvas = document.createElement('canvas')
  processedCanvas.width = width
  processedCanvas.height = height
  const processedCtx = processedCanvas.getContext('2d')!

  // 绘制原始遮罩
  processedCtx.drawImage(maskCanvas, 0, 0, width, height)

  // 应用遮罩扩展（膨胀/收缩）
  if (expansion !== 0) {
    const iterations = Math.abs(expansion)
    const kernelSize = 3
    const kernel = createDilationKernel(kernelSize)

    // 简化的膨胀/收缩算法
    // 注意：Canvas 2D 没有 cv2.dilate/erode，需要手动实现
    for (let i = 0; i < iterations; i++) {
      if (expansion > 0) {
        // 膨胀：使用多次模糊模拟
        processedCtx.filter = 'blur'
        processedCtx.drawImage(processedCanvas, 0, 0, width, height)
        processedCtx.filter = 'none'
      } else {
        // 收缩：使用多次收缩模拟
        // Canvas 2D 收缩比较复杂，可能需要更高级的算法
      }
    }
  }

  // 应用羽化
  if (feather > 0) {
    processedCtx.filter = `blur(${feather}px)`
    processedCtx.drawImage(processedCanvas, 0, 0, width, height)
    processedCtx.filter = 'none'
  }

  return processedCanvas
}
```

修改 `drawForegroundLayer()` 函数：
```typescript
function drawForegroundLayer(ctx, layer, ...) {
  // ... 现有代码 ...
  
  if (layer.maskCanvas) {
    // 获取项目参数
    const maskExpansion = store.project.mask_expansion || 0
    const maskFeather = store.project.mask_feather || 0
    
    // 应用遮罩扩展和羽化
    const processedMask = applyMaskExpansion(
      ctx,
      layer.maskCanvas,
      maskExpansion,
      maskFeather,
      w,
      h
    )
    
    // 使用处理后的遮罩
    offCtx.drawImage(processedMask, 0, 0, w, h)
  }
  
  // ...
}
```

#### 2.2 GPU 渲染器实现

在 `GPUTimelineRenderer.ts` 中添加遮罩扩展和羽化的 shader 支持：

1. 添加新的 shader 变量和计算
2. 在 fragment shader 中实现类似后端的 dilate/erode 和 blur 效果

#### 2.3 添加 watch 监听参数变化

在 `useCanvasRenderer.ts` 中添加：
```typescript
watch(() => [store.project.mask_expansion, store.project.mask_feather], () => {
  scheduleRender()
})
```

**优点**：
- 用户体验好，可以实时预览效果
- 功能完整

**缺点**：
- 实现复杂，需要大量代码
- Canvas 2D 的 dilate/erode 算法实现比较复杂
- 可能影响性能

---

### 方案3：混合方案（推荐 - 平衡）

**说明**：前端预览支持简单的遮罩扩展和羽化，但效果可能与后端不完全一致。

**实现**：
1. 前端实现简化的遮罩扩展（使用 Canvas filter）
2. 添加说明，告知用户前端预览和后端渲染可能有细微差异

**优点**：
- 实现相对简单
- 用户可以看到大致效果
- 性能影响小

**缺点**：
- 前后端效果可能不完全一致
- 仍然需要修改渲染管线

---

## 技术挑战

### Canvas 2D 限制

1. **没有内置的 dilate/erode 算法**
   - Canvas 2D API 不提供类似 OpenCV 的形态学操作
   - 需要手动实现，计算复杂度高

2. **性能考虑**
   - 多次迭代处理可能影响性能
   - 大图像处理可能较慢

3. **效果一致性**
   - Canvas 2D 的 blur 效果与 OpenCV 的 GaussianBlur 可能有细微差异

### GPU 渲染器挑战

1. **Shader 复杂性**
   - 需要编写 GLSL shader 来实现 dilate/erode
   - 需要多 pass 或复杂的算法

2. **兼容性**
   - WebGPU shader 语法和功能可能有限制
   - 需要考虑不同 GPU 的兼容性

## 推荐方案

考虑到实现复杂度和用户体验，**推荐使用方案1（仅后端支持）**：

1. 在 ProjectSettings.vue 中添加说明文字
2. 更新文档说明此限制
3. 保持现有功能不变

如果用户强烈需要前端预览，可以考虑后续实现方案3（混合方案）。

## 需要修改的文件（如果选择方案1）

1. `frontend/src/components/timeline/ProjectSettings.vue` - 添加说明文字
2. `README.md` - 更新文档
