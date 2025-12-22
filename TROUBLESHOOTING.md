# 故障排除指南

## RTX 40 系列显卡 UI 布局问题

如果您的 RTX 40 系列显卡（RTX 4060/4070/4080/4090）遇到 UI 布局混乱的问题，这通常是由于 WebGPU 驱动兼容性问题导致的。

### 解决方案

#### 方法 1：禁用 GPU 渲染（推荐）

1. 打开浏览器开发者工具（按 `F12`）
2. 切换到 Console（控制台）标签
3. 输入以下命令并按回车：
   ```javascript
   localStorage.setItem('timeline_disable_gpu', 'true')
   ```
4. 刷新页面（`F5` 或 `Ctrl+R`）

系统将自动回退到 Canvas 2D 渲染，UI 布局应该会恢复正常。

#### 方法 2：更新显卡驱动

1. 访问 NVIDIA 官网：https://www.nvidia.com/Download/index.aspx
2. 下载并安装最新的显卡驱动
3. 重启浏览器

#### 方法 3：更新浏览器

确保使用最新版本的浏览器：
- **Chrome/Edge**: 版本 113 或更高
- **Firefox**: 版本 110 或更高（需要启用 WebGPU）

### 重新启用 GPU 渲染

如果问题已解决，您可以尝试重新启用 GPU 渲染：

1. 打开浏览器控制台
2. 输入：
   ```javascript
   localStorage.removeItem('timeline_disable_gpu')
   ```
3. 刷新页面

### 其他问题

如果禁用 GPU 后问题仍然存在，可能是 CSS 布局问题，请：
1. 清除浏览器缓存
2. 硬刷新页面（`Ctrl+F5`）
3. 检查浏览器控制台是否有其他错误信息

