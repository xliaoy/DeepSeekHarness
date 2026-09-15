# dsh-client-ui-aqua 移动端布局错位修复方案

## 一、问题现象

- 手机端（触摸屏）新建会话后**发送第一条消息**，输入框（composer）与统计行（stats：轮数/步数/token）**错位**：
  - 统计行悬浮在输入框外部下方，与输入框不对齐
  - 输入框提示文字右侧被截断
  - 发送按钮与边缘距离异常
- AI **回复完成后恢复正常**；**重新进入页面也恢复**。
- 禁用「dsh-client-ui-aqua」皮肤后不再出现 → 责任方为 aqua 皮肤。
- 旧版本（0.1.5-rc.2）同样存在 → 非 0.1.6-alpha.1 引入。

## 二、根因分析

aqua 皮肤实现了 **cursor-driven tilt（光标驱动倾斜动效）**（`data-dsh-aqua-press` 开关）：
- 监听指针移动，对浮动玻璃面板（含 composer+stats 融合面板）写入内联 transform：
  `perspective(800px) rotateX(θx) rotateY(θy) scale(1.01)`
- **原实现未排除触摸屏**（只有 reduced-motion 与侧栏对话框两项豁免），
  而触摸设备在"点击发送按钮/输入框"时同样触发 pointer 事件 → tilt 生效，
  给 composer+stats 面板写入 transform → **统计行被视觉推离输入框，形成错位**。
- AI 回复完成后面板重算/指针离开 → transform 复位 → 恢复。
- 重新进入页面 → 重载后 transform 清空 → 正常。

## 三、修复内容

修改 `lib/client.js` 的 `tiltable(spot)`，增加触摸屏（coarse pointer）豁免：

```js
function tiltable(spot) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    // 移动端（coarse pointer）禁用 tilt：触摸会触发 transform 把 composer+stats 面板推错位（发送消息后布局错乱）
    if (window.matchMedia("(hover: none), (pointer: coarse)").matches) return false;
    if (spot.matches('[class*="sidebarCol"]') && document.querySelector('[role="dialog"]') !== null) return false;
    return true;
}
```

## 四、影响评估

- **移动端（触摸屏）**：彻底关闭 tilt 动效 —— 触摸屏本无 hover 语义，关闭无功能损失；错位消除。
- **桌面端（鼠标 hover）**：tilt 动效完全保留，交互不变。
- **reduced-motion（系统减少动效）**：原本就跳过，行为不变。
- 其余效果（毛玻璃、光标光晕 spotlight、侧栏等）不受影响。

## 五、涉及文件与生效方式

| 文件 | 作用 |
|---|---|
| `/root/deepseekharness-client-ui-aqua/lib/client.js` | 运行环境（当前设备） |
| `app/src/main/assets/builtin-plugins/dsh-client-ui-aqua/lib/client.js` | App 内置资源（新 APK 随包分发） |

- 当前设备：修改运行环境文件后 **重启 dsh Web** 生效（`patchReload: startup`）。
- 新装用户：下次构建 APK 后开箱即带修复。

## 六、验证步骤

1. 重启 dsh Web；
2. 新建会话 → 发送「你好」；
3. 等待回复期间观察：统计行应与输入框对齐、无悬浮错位；
4. 回复完成后再次确认布局正常。

---

## 七、补充修复（第二轮：垂直错位 + 顶部偏移）

用户补充：错位分模式出现——
- **云母模式（`data-dsh-float`）**：输入框折叠错位 + 顶部排版偏移
- **兼容模式（`data-dsh-compat`）**：输入框正常，但顶部排版错位

### 排查结论
1. aqua 的移动端适配块（`css$m`，`@media max-width:640px`）**已有水平修复**（`width:auto / max-width:100vw-16px / margin auto`），
   但**垂直方向**未覆盖：发送消息后统计行（`[data-dsh-stats]`）脱离输入栏、悬浮到输入框外下方（kimi 截图分析确认）。
2. 顶部偏移来源：
   - 云母模式：`header { margin: 12px 16px 0; border-radius: 20px }`（浮动玻璃卡片，窄屏挤压）
     及 `[data-phase=active] [data-conversation-scroll] { margin-top: -95px; padding-top: 107px }`（消息区顶部负边距融合 header，窄屏错位）
   - 兼容模式：header 无云母玻璃但仍被挤动。

### 注入规则（追加到 `css$m` 块内）
```css
[data-dsh-float] header, [data-dsh-aqua][data-dsh-compat] header {
  margin: 0 !important; border-radius: 0 !important; position: static !important;
}
[data-dsh-float] [data-phase=active] [data-conversation-scroll] {
  margin-top: 0 !important; padding-top: 0 !important;
}
[data-dsh-float] [data-dsh-inputbar]:has([data-dsh-stats]) {
  display: flex !important; flex-direction: column !important; align-items: stretch !important;
}
[data-dsh-float] [data-dsh-stats] {
  order: 0 !important; position: static !important; transform: none !important;
}
```

### 涉及文件（同前）
- `/root/deepseekharness-client-ui-aqua/lib/client.js`（运行环境）
- `app/src/main/assets/builtin-plugins/dsh-client-ui-aqua/lib/client.js`（App 内置）

### 验证步骤
1. 重启 dsh Web；
2. 分别在**云母模式**与**兼容模式**下：新建会话 → 发送「你好」→ 观察等待回复期间输入框/统计行是否对齐、顶部是否偏移；
3. 回复完成后复查。
