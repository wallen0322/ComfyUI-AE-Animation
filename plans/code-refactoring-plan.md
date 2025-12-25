# ComfyUI-AE-Animation 代码重构计划

## 1. 未使用的文件和目录

### 1.1 根目录未使用文件
| 文件 | 状态 | 说明 |
|------|------|------|
| `demo.mp4` | 删除 | 演示视频文件，未被代码引用 |
| `frontend/frontend/` | 删除 | 空目录，只有占位文件夹 |

### 1.2 前端 src 目录未使用文件
| 文件 | 状态 | 说明 |
|------|------|------|
| `frontend/src/TheatreApp.vue` | 删除 | 未被任何文件引用 |
| `frontend/src/TimelineApp.zip` | 删除 | 压缩文件，不应在源代码中 |
| `frontend/src/composables/useTheatre.ts` | 删除 | 未被任何文件引用 |
| `frontend/src/composables/timeline/gpu/__tests__/GPUTimelineRenderer.test.ts` | 删除 | 测试文件，未被引用 |

### 1.3 前端 utils 目录未使用文件
| 文件 | 状态 | 说明 |
|------|------|------|
| `frontend/src/utils/categoryIcons.ts` | 删除 | 未被引用 |
| `frontend/src/utils/createAnnotatedPath.ts` | 删除 | 只在自己的文件中被引用 |
| `frontend/src/utils/electronMirrorCheck.ts` | 删除 | 未被引用 |
| `frontend/src/utils/envUtil.ts` | 删除 | 只被 electronMirrorCheck.ts 使用 |
| `frontend/src/utils/errorReportUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/eventUtils.ts` | 删除 | 未被引用 |
| `frontend/src/utils/formatUtil.ts` | 删除 | 只被未使用的文件引用 |
| `frontend/src/utils/fuseUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/gridUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/hostWhitelist.ts` | 删除 | 未被引用 |
| `frontend/src/utils/imageUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/linkFixer.ts` | 删除 | 未被引用 |
| `frontend/src/utils/litegraphUtil.ts` | 删除 | 只被未使用的 executionUtil.ts 引用 |
| `frontend/src/utils/mapperUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/markdownRendererUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/mathUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/mouseDownUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/nodeDefUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/nodeFilterUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/packUtils.ts` | 删除 | 未被引用 |
| `frontend/src/utils/rafBatch.ts` | 删除 | 未被引用 |
| `frontend/src/utils/searchAndReplace.ts` | 删除 | 未被引用 |
| `frontend/src/utils/syncUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/tailwindUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/treeUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/typeGuardUtil.ts` | 删除 | 只被未使用的 graphTraversalUtil.ts 引用 |
| `frontend/src/utils/validationUtil.ts` | 删除 | 未被引用 |
| `frontend/src/utils/vintageClipboard.ts` | 删除 | 未被引用 |
| `frontend/src/utils/widgetPropFilter.ts` | 删除 | 未被引用 |

### 1.4 前端 utils 目录未使用文件（依赖链）
| 文件 | 状态 | 说明 |
|------|------|------|
| `frontend/src/utils/executionUtil.ts` | 删除 | 未被引用，依赖的文件也未使用 |
| `frontend/src/utils/executableGroupNodeDto.ts` | 删除 | 只被未使用的 executionUtil.ts 引用 |
| `frontend/src/utils/executableGroupNodeChildDTO.ts` | 删除 | 未被引用，引用不存在的 @/extensions/core/groupNode |
| `frontend/src/utils/graphTraversalUtil.ts` | 删除 | 只被未使用的 searchAndReplace.ts 引用 |

### 1.5 前端 platform 目录未使用文件
| 文件 | 状态 | 说明 |
|------|------|------|
| `frontend/src/platform/workflow/management/stores/workflowStore.ts` | 删除 | 未被引用 |
| `frontend/src/platform/workflow/management/` | 删除 | 只包含未使用的 workflowStore.ts |
| `frontend/src/platform/workflow/` | 删除 | 空目录 |

### 1.6 前端 utils/migration 目录未使用文件
| 文件 | 状态 | 说明 |
|------|------|------|
| `frontend/src/utils/migration/migrateReroute.ts` | 删除 | 未被引用 |
| `frontend/src/utils/migration/` | 删除 | 只包含未使用的 migrateReroute.ts |

## 2. 需要保留的核心文件

### 2.1 后端核心文件
- `ae_animation_core.py` - 后端核心逻辑
- `server.py` - 服务器
- `__init__.py` - 模块初始化

### 2.2 前端核心文件
- `frontend/src/timeline-main.ts` - 时间线入口
- `frontend/src/main.ts` - 遮罩编辑器入口
- `frontend/src/TimelineApp.vue` - 时间线主组件
- `frontend/src/MaskEditorApp.vue` - 遮罩编辑器主组件
- `frontend/src/timeline.css` - 时间线样式
- `frontend/src/i18n.ts` - 国际化

### 2.3 前端 stores（状态管理）
- `frontend/src/stores/timelineStore.ts` - 时间线状态管理
- `frontend/src/stores/maskEditorStore.ts` - 遮罩编辑器状态管理
- `frontend/src/stores/maskEditorDataStore.ts` - 遮罩编辑器数据状态
- `frontend/src/stores/imagePreviewStore.ts` - 图片预览状态
- `frontend/src/stores/dialogStore.ts` - 对话框状态

### 2.4 前端 composables（组合式函数）
- `frontend/src/composables/useCanvasInteraction.ts` - 画布交互
- `frontend/src/composables/useCanvasRenderer.ts` - 画布渲染
- `frontend/src/composables/useTransform3D.ts` - 3D 变换

### 2.5 前端 composables/timeline/gpu（GPU 渲染）
- `frontend/src/composables/timeline/gpu/GPUTimelineRenderer.ts` - GPU 时间线渲染器
- `frontend/src/composables/timeline/gpu/TextureCache.ts` - 纹理缓存
- `frontend/src/composables/timeline/gpu/PerformanceMonitor.ts` - 性能监控
- `frontend/src/composables/timeline/gpu/GPUDebugger.ts` - GPU 调试器
- `frontend/src/composables/timeline/gpu/timelineShaders.ts` - 时间线着色器
- `frontend/src/composables/timeline/gpu/advancedShaders.ts` - 高级着色器
- `frontend/src/composables/timeline/gpu/gpuSchema.ts` - GPU 模式定义
- `frontend/src/composables/timeline/gpu/index.ts` - 导出

### 2.6 前端 composables/maskeditor（遮罩编辑器）
- `frontend/src/composables/maskeditor/brushUtils.ts` - 画笔工具
- `frontend/src/composables/maskeditor/splineUtils.ts` - 样条工具
- `frontend/src/composables/maskeditor/StrokeProcessor.ts` - 笔触处理器
- `frontend/src/composables/maskeditor/useBrushDrawing.ts` - 画笔绘制
- `frontend/src/composables/maskeditor/useCanvasHistory.ts` - 画布历史
- `frontend/src/composables/maskeditor/useCanvasManager.ts` - 画布管理
- `frontend/src/composables/maskeditor/useCanvasTools.ts` - 画布工具
- `frontend/src/composables/maskeditor/useCoordinateTransform.ts` - 坐标变换
- `frontend/src/composables/maskeditor/useImageLoader.ts` - 图片加载
- `frontend/src/composables/maskeditor/useKeyboard.ts` - 键盘处理
- `frontend/src/composables/maskeditor/useMaskEditorLoader.ts` - 遮罩编辑器加载
- `frontend/src/composables/maskeditor/useMaskEditorSaver.ts` - 遮罩编辑器保存
- `frontend/src/composables/maskeditor/usePanAndZoom.ts` - 平移和缩放
- `frontend/src/composables/maskeditor/useToolManager.ts` - 工具管理
- `frontend/src/composables/maskeditor/gpu/brushShaders.ts` - 画笔着色器
- `frontend/src/composables/maskeditor/gpu/GPUBrushRenderer.ts` - GPU 画笔渲染器
- `frontend/src/composables/maskeditor/gpu/gpuSchema.ts` - GPU 模式定义

### 2.7 前端 components（组件）
- `frontend/src/components/timeline/CanvasPreview.vue` - 画布预览
- `frontend/src/components/timeline/ProjectSettings.vue` - 项目设置

### 2.8 前端 components/maskeditor（遮罩编辑器组件）
- `frontend/src/components/maskeditor/MaskEditorContent.vue` - 遮罩编辑器内容
- `frontend/src/components/maskeditor/BrushCursor.vue` - 画笔光标
- `frontend/src/components/maskeditor/BrushSettingsPanel.vue` - 画笔设置面板
- `frontend/src/components/maskeditor/ColorSelectSettingsPanel.vue` - 颜色选择面板
- `frontend/src/components/maskeditor/ImageLayerSettingsPanel.vue` - 图层设置面板
- `frontend/src/components/maskeditor/PaintBucketSettingsPanel.vue` - 油漆桶设置面板
- `frontend/src/components/maskeditor/PointerZone.vue` - 指针区域
- `frontend/src/components/maskeditor/SettingsPanelContainer.vue` - 设置面板容器
- `frontend/src/components/maskeditor/SidePanel.vue` - 侧边栏
- `frontend/src/components/maskeditor/ToolPanel.vue` - 工具面板
- `frontend/src/components/maskeditor/controls/DropdownControl.vue` - 下拉控件
- `frontend/src/components/maskeditor/controls/SliderControl.vue` - 滑块控件
- `frontend/src/components/maskeditor/controls/ToggleControl.vue` - 切换控件
- `frontend/src/components/maskeditor/dialog/TopBarHeader.vue` - 顶部栏头部

### 2.9 前端 extensions（扩展）
- `frontend/src/extensions/core/maskeditor/types.ts` - 遮罩编辑器类型定义
- `frontend/src/extensions/core/maskeditor/constants.ts` - 遮罩编辑器常量

### 2.10 前端 platform（平台）
- `frontend/src/platform/distribution/types.ts` - 分发类型定义

### 2.11 前端 utils（工具函数）
- `frontend/src/utils/numberUtil.ts` - 数字工具（被多处使用）
- `frontend/src/utils/colorUtil.ts` - 颜色工具（被 useBrushDrawing.ts 使用）

### 2.12 前端 scripts（脚本）
- `frontend/src/scripts/api.ts` - API 脚本
- `frontend/src/scripts/app.ts` - 应用脚本
- `frontend/src/scripts/utils.ts` - 工具脚本

## 3. 代码优化建议

### 3.1 后端 ae_animation_core.py
- 检查冗余的兜底逻辑
- 移除废弃的注释块
- 优化重复的代码模式
- 统一错误处理方式

### 3.2 前端 TimelineApp.vue
- 移除未使用的变量和函数
- 优化重复的代码模式
- 简化组件逻辑

### 3.3 前端 GPUTimelineRenderer.ts
- 移除未使用的变量和函数
- 优化重复的代码模式
- 简化渲染逻辑

### 3.4 前端 timelineStore.ts
- 移除未使用的变量和函数
- 优化状态管理逻辑
- 简化导出函数

## 4. 执行计划

1. 删除未使用的文件和目录
2. 优化后端代码
3. 优化前端核心代码
4. 编译并验证重构后的代码
