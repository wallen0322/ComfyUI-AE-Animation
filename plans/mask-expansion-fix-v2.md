# 遮罩扩展问题修复方案 v2

## 问题分析

用户反馈指出两个严重缺陷：

### 缺陷 1：遮罩扩展逻辑回退到全局设置
- 当前实现使用所有前景图层的最大遮罩扩展值作为全局参数
- 这不是真正的每个图层独立处理
- 用户期望每个图层都有自己的遮罩扩展值

### 缺陷 2：参数传递不完整
- 用户说"目前只能传导扩展参数，遮罩羽化参数无法被设置"
- 需要检查前端 UI 控件是否正确绑定了 mask_feather 参数

## 根本原因分析

### 当前架构的限制

当前后端使用单个 `mask_canvas` 来累积所有前景图层的遮罩：
```python
mask_canvas = np.zeros((height, width), dtype=np.uint8)
for data in layer_render_data:
    # 渲染图层，更新 mask_canvas
    if is_foreground:
        mask_canvas[:] = np.maximum(mask_canvas, mask_layer)
```

这种架构使得真正的每个图层独立遮罩扩展处理变得困难，因为：
1. 所有图层的遮罩被合并到一个画布
2. 后处理在所有图层渲染完成后统一应用
3. 无法区分哪个遮罩区域属于哪个图层

### 前端数据传递验证

需要检查：
1. `ProjectSettings.vue` 中的控件是否正确绑定了 `mask_expansion` 和 `mask_feather`
2. `timelineStore.ts` 中的 `exportAnimation()` 是否正确导出了这两个值
3. `TimelineApp.vue` 中的 `save()` 是否正确保存了这两个值到 `layers_keyframes`

## 修复方案

### 方案 A：修改渲染函数支持图层级遮罩扩展（推荐）

修改所有渲染函数，添加 `layer_mask_expansion` 和 `layer_mask_feather` 参数，在渲染每个图层后立即应用遮罩扩展。

**优点**：
- 真正实现每个图层独立遮罩扩展
- 遮罩扩展效果与图层渲染同步

**缺点**：
- 需要修改多个渲染函数
- 需要为每个图层维护独立的遮罩画布

### 方案 B：简化为全局遮罩扩展（快速修复）

保持当前架构，但确保：
1. 前端 UI 正确绑定两个参数
2. 前端正确导出和保存两个参数
3. 后端正确读取和使用两个参数

**优点**：
- 修改量小
- 向后兼容

**缺点**：
- 不是真正的每个图层独立处理
- 所有前景图层使用相同的遮罩扩展值

### 方案 C：混合方案（折中）

1. 前端保持每个图层独立的遮罩扩展值
2. 后端在图层渲染循环中为每个图层应用遮罩扩展
3. 使用临时遮罩画布来处理每个图层的遮罩扩展
4. 最后合并到最终的 mask_canvas

## 推荐实施方案

采用 **方案 C（混合方案）**，具体步骤：

### 步骤 1：修改渲染函数签名

为 `_render_layer_3d`、`_render_layer_2d_with_3d_rotation`、`_render_layer_2d` 添加可选参数：

```python
def _render_layer_3d(
    img_np: np.ndarray,
    mvp: np.ndarray,
    canvas: np.ndarray,
    mask_canvas: np.ndarray,
    opacity: float,
    is_foreground: bool,
    width: int,
    height: int,
    layer_mask_expansion: int = 0,
    layer_mask_feather: int = 0
) -> None:
```

### 步骤 2：在渲染函数内部应用遮罩扩展

在渲染函数内部，如果是前景图层且设置了遮罩扩展，则：

1. 创建临时遮罩画布
2. 应用遮罩扩展到临时遮罩
3. 使用扩展后的遮罩进行合成

### 步骤 3：修改图层渲染循环

在 `execute()` 方法的图层渲染循环中，传递图层级遮罩扩展值：

```python
for data in layer_render_data:
    layer = data["layer"]
    is_foreground = data["is_foreground"]
    
    layer_mask_expansion = data.get("mask_expansion", 0)
    layer_mask_feather = data.get("mask_feather", 0)
    
    # 调用渲染函数时传递遮罩扩展参数
    if is_3d:
        cls._render_layer_3d(
            img_np, mvp, canvas, mask_canvas, opacity,
            is_foreground, width, height,
            layer_mask_expansion, layer_mask_feather
        )
```

### 步骤 4：移除全局后处理逻辑

移除或注释掉原来的全局后处理代码（第1039-1074行），因为遮罩扩展现在在图层渲染时处理。

### 步骤 5：验证前端数据传递

检查并确保：
1. `ProjectSettings.vue` 中两个滑块控件都正确绑定
2. `timelineStore.ts` 中 `exportAnimation()` 正确导出两个值
3. `TimelineApp.vue` 中 `save()` 正确保存到 `layers_keyframes`

## 验证步骤

1. 创建多个前景图层
2. 为每个图层设置不同的 mask_expansion 值（如 5, 10, 15）
3. 为每个图层设置不同的 mask_feather 值（如 2, 5, 10）
4. 保存并运行节点
5. 检查输出的遮罩是否正确反映了每个图层的不同扩展和羽化值
