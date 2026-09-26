# dsh-deliverable-mobile

DeepSeek Harness 移动端适配：让交付文件（presented deliverables）在手机上可直接打开查看。

## 问题

桌面端交付文件通过 `sessionController.openWorkspacePath`（默认应用打开）打开；
手机上没有对应桌面机制，交付文件卡片上的"打开"无法把文件交给手机文件管理器 / MT 管理器。

## 方案

- **Host 半身**注册 `/api/deliverable.mobile-export` 路由：从会话事件坐标解析交付文件的容器内绝对路径，
  经 DeepSeek Harness App 的 `127.0.0.1:3090/app/export` 桥导出到公共 `Download/DeepSeekHarness/`
  （走 MediaStore，文件管理器 / MT 管理器直接可见可打开）。
- **浏览器半身**注入 `deliverables.file.actions` 槽位，在每张交付文件卡片上添加「📱 手机查看」按钮，
  点击即导出并提示位置。

## 安全

- 路由复用 `connection.requestRejection` 鉴权（与 dsh-web-mobile 删除会话一致）。
- 导出路径经 App 桥的 `BridgePathPolicy` 校验，凭据/运行时内部状态不可导出。
