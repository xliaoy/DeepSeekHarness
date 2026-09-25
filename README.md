# DeepSeek Harness（DSHA 二开版）

<p align="center">
  <b>在手机上跑完整 DeepSeek Harness 编码智能体</b><br>
  免 ROOT · 免 Termux · 装完即用 —— 基于 <a href="https://github.com/DSH-APP/DSHA">DSH-APP/DSHA</a> 深度定制二开
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT"></a>
  <a href="https://github.com/xliaoy/DeepSeekHarness"><img src="https://img.shields.io/badge/repo-xliaoy%2FDeepSeekHarness-2ea44f" alt="repo"></a>
  <a href="https://github.com/xliaoy/DeepSeekHarness/releases/latest"><img src="https://img.shields.io/github/v/release/xliaoy/DeepSeekHarness?color=blue" alt="release"></a>
  <a href="https://github.com/DSH-APP/DSHA"><img src="https://img.shields.io/badge/base-DSHA-blue" alt="base"></a>
  <img src="https://img.shields.io/badge/Android-11%2B-3DDC84?logo=android&logoColor=white" alt="android">
  <img src="https://img.shields.io/badge/arch-arm64--v8a-lightgrey" alt="arch">
</p>

> 📥 **下载与使用**：请到 [Releases 页面](https://github.com/xliaoy/DeepSeekHarness/releases/latest) 下载安装包（标准版 / 兼容版），安装后首次启动按引导解压环境即可使用。

> 本项目是 [DSH-APP/DSHA](https://github.com/DSH-APP/DSHA)（DeepSeek Harness 安卓启动器）的二次开发版本。
> 在保留官方全部底层能力（proot/proroot 运行时、插件、备份、ADB 直连等）的基础上，对 UI 进行全面美化，并新增一批实用功能。

---

## 一、项目说明

DSHA 官方版把 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek 编码智能体）完整封装进安卓 App：
完整 Ubuntu 环境 + proot/proroot 容器、AI 输出实时上屏、ADB 直连、数据不丢。

本二开版在保留官方底层能力之外，做了两件事：

1. **UI 全面美化**：悬浮胶囊底栏、顶栏汉堡侧边栏、沉浸式状态栏、启动页卡片化、固定常显日志区等，交互与视觉整体重做；
2. **新增实用功能**：内置三个新插件、插件页命令行安装、在线更新官方 dsh、系统源快速切换、WebView 状态栏跟页面色、增强崩溃日志等。

---

## ⚙️ 工作原理

```
┌─────────────────────────── 启动流程 ───────────────────────────┐
│ App 启动 → 门禁检查（欢迎引导 / 环境是否解压）                     │
│   → 解压内置 Ubuntu 基础环境（首次）                             │
│   → 以 proot / proroot 拉起 dsh 容器（免 ROOT）                  │
│   → dsh Web 服务监听 127.0.0.1:3080，打印鉴权链接                │
│   → 启动页展示本机 / 局域网访问地址（一键复制）                    │
│   → 内置 WebView（或外部浏览器）带 Cookie 鉴权进入 WebUI          │
└──────────────────────────────────────────────────────────────┘
```

- **容器运行时**：proot 零依赖用户态模拟；proroot 进一步降低 ptrace 开销，接近原生速度。
- **前后台保活**：前台服务 + 看门狗，退到桌面 / 锁屏不被杀，崩溃自动重启；省电模式熄屏空闲后减少保活，有任务时继续运行。
- **设备桥 / 局域网**：无线 ADB 直连调试；局域网代理把 3080 端口映射到局域网，其它设备可同网访问。
- **数据安全**：环境、配置、会话、插件分层备份；API Key 加密落盘；崩溃与诊断日志本地留存，可一键导出。

---

## 二、与官方 DSHA 的功能对比

> 📌 **本版基线**：已把官方 [DSH-APP/DSHA](https://github.com/DSH-APP/DSHA) **v0.1.7-alpha2** 的新功能、内置 dsh 版本
> （`0.1.7-alpha.2`）、设置、逻辑、插件全部移植进来，并把二开定制重新贴回新架构之上。
> 版本号沿用二开自己的日期风格：`versionCode 145` / `versionName 20260925`（兼容版 `20260925low`），
> 包名保持 `com.deepseek.harness`（升级覆盖安装不受影响）。

### 底层与核心能力（全部保留，零改动）

| 能力 | 官方 DSHA | 本二开版 |
|---|---|---|
| 核心运行时（proot / proroot + Ubuntu） | ✅ | ✅ 保留 |
| AI 输出实时上屏 / WebUI 进入 | ✅ | ✅ 保留 |
| 备份与恢复 / API Key 加密 | ✅ | ✅ 保留 |
| 独立多终端（PTY + 简易） | ✅ | ✅ 保留 |
| 无线 ADB 直连 / 局域网代理 | ✅ | ✅ 保留 |
| 日夜主题 | ✅ | ✅ 保留 |

### 本二开版新增 / 改进的功能

| 功能 | 说明 |
|---|---|
| 🆕 **内置三个新插件** | 预装 `dsh-balance-panel`（余额面板）、`dsh-client-ui-aqua`（水色客户端界面）、`dsh-memento`（记忆系统） |
| 🆕 **dsh-web-mobile 细节调整** | 针对移动端适配做定制导出与细节修正 |
| 🆕 **插件页命令行安装** | 插件页新增命令安装：粘贴安装命令一键执行，不再只在商店在线装 |
| 🆕 **在线更新 DeepSeek Harness 官方版** | 内置更新器直接对接 DeepSeek Harness 官方 GitHub Releases，一键升级到官方最新版 |
| 🆕 **系统源快速切换** | npm / APT（系统镜像）/ pip 一键切换，内置多套预设（官方 / 阿里云 / 腾讯 / 华为…）并支持自定义源 |
| 🆕 **WebView 状态栏跟页面色** | 内置打开 dsh Web 时，状态栏颜色实时采样页面顶部像素色，随页面背景自动融合 |
| 🆕 **删除不必要的关于入口按钮** | 精简顶栏 / 侧边栏，去掉多余“关于”入口，界面更干净 |

### UI 美化（相对官方）

| 维度 | 官方 DSHA | 本二开版（美化） |
|---|---|---|
| 底栏导航 | 官方样式 | 🎨 悬浮胶囊（3 tab：启动/插件/终端），选中胶囊化 + 悬浮阴影 |
| 设置入口 | 底栏 / 页面内 | 🎨 顶栏汉堡侧边栏（点汉堡 / 右滑展开），设置全部入口直达 |
| 顶栏 | 常规标题栏 | 🎨 汉堡 + 固定 App 标题 + 主题纯图标按钮 |
| 状态栏 | 系统默认 | 🎨 沉浸式，与顶栏同色、图标随明暗 |
| 启动页 | 默认布局 | 🎨 卡片化分区：状态 → 地址 → 日志 → 操作 |
| 日志区 | 有日志才撑开 | 🎨 固定 220dp 常显 + 行号 + 关键行高亮 + 自动跟随 |
| 访问地址 | 仅局域网地址 | 🎨 本机 + 局域网双地址：未就绪显示“获取中”，就绪显示完整 Token URL 一键复制 |
| 启动操作 | 官方按钮组 | 🎨 启动 / 重启 / 停止 / 安全启动 / 恢复选项 分区排列 |
| 省电模式 | 设置页内 | 🎨 侧边栏底部直达 |
| 崩溃兜底 | — | 🎨 增强崩溃日志（异常消息 + cause 链 + 40 帧） |

---

## 三、本版优点

1. **开箱即用增强**：内置 `dsh-balance-panel`（余额随时看）、`dsh-client-ui-aqua`（更清爽的客户端界面）、`dsh-memento`（跨会话记忆）三个实用插件，dsh-web-mobile 也做了移动端细节打磨。
2. **装插件更自由**：除在线商店外，插件页支持**命令行安装**——粘贴官方安装命令一键执行，私有/自建插件一把装。
3. **永远用官方最新**：App 内更新直接对接 DeepSeek Harness 官方 GitHub Releases，不用等打包版，官方一发版立刻在线升。
4. **网络源不折腾**：npm / APT / pip 系统源一键切换，内置阿里、腾讯、华为等镜像预设，也支持自定义源，装包提速。
5. **Web 体验沉浸**：内置 dsh Web 的状态栏颜色实时跟页面顶部取色，页面是什么色状态栏就是什么色，不再是一条突兀黑/白条。
6. **导航更顺手**：底部只剩 启动 / 插件 / 终端 高频页；设置类入口收进侧边栏，拇指一滑即达；删掉多余“关于”按钮，界面更干净。
7. **启动页信息密度合理**：状态 → 地址 → 日志 → 操作分区卡片化，一眼定位；日志区固定常显，杜绝跳动；本机地址自动带鉴权 Token 一键复制。
8. **沉浸式 + 明暗自适应**：主界面状态栏与顶栏同色，明暗主题下状态栏图标自动反转，接近系统原生质感。
9. **恢复兜底闭环**：安全启动、恢复选项、插件停用、环境重建入口侧边栏直达，环境跑挂也能自救；省电模式一键直达。
10. **故障可视化**：增强崩溃日志记录完整异常链，配合行号高亮日志与内置诊断/错误日志导出，反馈问题即有据可查。

---

## 🔄 官方新版移植记录（v0.1.7-alpha2）

本次以**官方新架构为底座**，把二开定制重新贴回，而不是在旧代码上打补丁。

### 移植内容

| 维度 | 变更 |
|---|---|
| 内置 dsh | `0.1.5-rc.1` → **`0.1.7-alpha.2`** |
| 官方新功能 | 官方 v0.1.7-alpha2 全部功能、设置、逻辑、插件 |
| Java 主干 | 官方 494 文件结构（本版在 `com.deepseekharness.app` 包名下重建） |
| 四大组件 | 官方 **standard / low 双 flavor** 结构（`StellarShell` 等归入 `standard/`） |
| 二开定制 | UI 美化、内置插件、`dsh-web-mobile` **左右排列设置弹窗**等全部保留 |

### 命名统一

全仓 `DSHA` / `dsha` → **`DeepSeekHarness` / `deepseekharness`**，含资产脚本层与各构建产物。
以下属**兼容契约**，按「消费者适配产出端」原则**刻意保留**：

- 备份族：`DSHA-backup-` / `-sessions-` / `-plugins-` / `-settings-` / `-data-v5-` / `Download/DSHA/`
  （`BackupScope` 注释明示为跨版本契约；改了会让老用户的既有备份在启动时扫不到）
- 握手/协议 token：`DSHA_UBUNTU_TOOLS_READY`、`DSHA_RUNTIME_VALIDATED`、`__DSHA_*__`、`dsha-session-open` 等
- 架构身份：`DSHA_ARM64_V2`（改它会导致 `runtimeId` 漂移 → 触发错误重装）
- 真实 URL：`github.com/DSH-APP/DSHA` 等

> ⚠️ **说明**：备份族存在**有意保留**的品牌不一致（这些名字里仍是 `DSHA` 而非 `DeepSeekHarness`），
> 这是为了老用户既有备份仍能被扫到、被恢复；**用户数据安全优先于品牌一致性**。
> 例外：备份包内的说明文件已统一为 `DeepSeekHarness-README.txt`（导入端兼容两个历史名字）。

### 移植中发现并修复的隐蔽缺陷

官方新架构引入后，改名过程暴露出**六类「劈开」缺陷**（均已修复并有回归判据）：

| 类型 | 说明 | 实例 |
|---|---|---|
| 跨端标识劈开 | Java 一侧改名、资产/JS 一侧未改 → 运行时 `ReferenceError` / 静默丢事件 | 7 组协议对（`WEB_GENERATION`、`BACKUP_RESULT`、`PLUGIN_TASK` 等） |
| 长度耦合 | `substring(N)` 的 N 是旧前缀长度，改名后截断错位 | 5 处，其中 `EnvironmentDataBackup` 会致**每次环境备份抛异常**、`WebPreviewActivity` 致**页面诊断全丢** |
| 派生路径不一致 | 构建脚本产出路径与消费端不一致 → **clean 重建才暴露** | `tools/build-standard-runtime.py` 的 pnpm 目录名 |
| 上游包名残留 | 搬运官方文件时，官方用**自己包名**硬编码的正则未替换 | 4 处（含 `screenshotTarget` 致**截图无法回传给模型**） |
| 同族半改 | 一个逻辑族只改了一半引用点 → 分支之间自相矛盾 | `DownloadsExport` 在 Android 10+ 与 9- 写出**两个不同目录**；备份说明文件名产出/消费不一致致**三种作用域的恢复全部抛异常** |
| 覆盖事故 | 上游覆盖某文件，把该族的消费端悄悄带回旧名 | `backup-engine.py` 被覆盖（207 行差异）→ 从 fork 自洽状态变成失配 |

### 一个值得强调的教训

排查中发现的三类缺陷（上表第 4、5、6 类），**「搜索旧名得到 0 命中」都无法发现**：

- 上游包名残留 → 源码里是转义形态 `com\.dsh\.client`，非转义搜索找不到
- 同族半改 → 残留计数只能回答「还剩多少旧名」，回答不了「是否被改成一半」
- 覆盖事故 → 需要**三版本对照**（上游 / fork 基线 / 当前）才能识别

> **结论：「搜旧名 = 0」永远不能证明改名完整。**
> 必须配 **形态枚举 + 族内基数判据 + 产出端追查** 三者，且枚举要同时覆盖
> **语义角色轴**、**版本轴**、**形态轴**三个维度 —— 本轮团队三次栽跟头，全是枚举漏轴。

### 验证

- 双 flavor 均可构建出正式 APK（standard / low，arm64-v8a）
- `:app:testStandardDebugUnitTest` 通过；`prepareRuntimeDescriptor` 一致性校验通过
- 5 个运行时 `.bin` 全量解包扫描：内部**无遗留旧品牌标记**
  （并做阳性对照证明扫描有效，避免「扫不到 = 没问题」的假阴性）

---

## 🗂 项目文件结构

```
app/src/main/
├── java/com/deepseekharness/app/
│   ├── ui/                # 界面层（Activity / Fragment / 自定义 View）
│   │   ├── MainActivity.java        # 主外壳：侧边栏、顶栏、沉浸式、底栏导航
│   │   ├── LaunchFragment.java      # 启动页：状态卡片、固定日志区、双地址、启停
│   │   ├── EdgeSwipeLayout.java     # 自定义 View：右滑展开侧边栏
│   │   ├── SettingsFragment.java    # 设置页（模块入口 + 更新/自检/重新解压）
│   │   ├── ConfigFragment / WorkspaceFragment / InstallFragment
│   │   ├── PluginFragment.java      # 插件页（在线安装 + 命令行安装）
│   │   ├── TerminalFragment / PtyTerminalFragment   # 简易终端 / 真 PTY
│   │   ├── WebPreviewActivity.java  # 内置 Web 预览（状态栏跟页面色）
│   │   ├── SourceSettingsActivity   # 镜像源（npm / APT / pip）
│   │   ├── UpdateActivity / DiagnosticActivity / ExtractActivity / WelcomeActivity
│   │   └── AboutDialog / AppDialogs # 弹窗组件（关于软件等）
│   ├── core/               # 核心逻辑
│   │   ├── HarnessController.java   # dsh 启停 / 状态机 / 地址
│   │   ├── ConfigStore.java         # 配置持久化（API Key 加密）
│   │   ├── BackupManager / BackupTask / EnvironmentDataBackup   # 备份恢复
│   │   ├── DshUpdater.java          # 在线更新（对接官方 GitHub Releases）
│   │   ├── DiagnosticLog.java       # 崩溃/操作日志（增强：完整异常链）
│   │   └── ErrorLogRepository.java  # 错误日志导出
│   ├── runtime/            # 容器运行时（proot / proroot 引导、插件导出）
│   ├── bridge/             # 设备桥（无障碍 / Shizuku / 局域网 / Web 服务）
│   ├── data/  util/        # 数据访问与工具（ShellQuote、SensitiveData 等）
│   └── DeepSeekHarnessApp / HarnessService / LanProxyService / DeviceBridgeService
├── res/
│   ├── layout/  menu/  drawable/  values/  values-night/   # 界面资源与主题
│   └── mipmap-*/                  # 应用图标
└── AndroidManifest.xml
```

---

## ✍️ 代码写法特点

1. **代码构建 UI**：侧边栏、启动页大量控件用 Java 直接构建（`LinearLayout` / `TextView` 动态创建），配合统一设计 token（圆角 / 灰阶配色 / 描边），便于程序化复用与主题适配。
2. **沉浸式 + insets 自适应**：`setDecorFitsSystemWindows(false)` + 窗口级 `getRootWindowInsets`，顶栏 / 侧边栏头部 / 底栏按实际位置补 padding，兼容个别 ROM 不强制沉浸式的场景（状态栏兜底色）。
3. **线程纪律**：容器 / Web 操作走后台线程 + 主线程 `runOnUiThread` 回投；每次回调校验 `generation` 与页面存活，避免竞态与空指针。
4. **防御式判空**：所有 `findViewById`、回调、生命周期路径都做判空与状态校验（`isStateSaved` / `isFinishing` / `getView()!=root`），页面重建不崩溃。
5. **资源即配置**：版本号、主题、图标全部走 `res/values` 与 `BuildConfig`；打赏二维码、开源地址等发布性内容集中为文件 / 常量，替换即生效。
6. **崩溃可观测**：全局 `UncaughtExceptionHandler` 记录异常消息 + cause 链 + 40 帧到本地日志，配合启动时间线（StartupTrace）快速定位。
7. **两版共用源码**：`standard` / `low` 变体共用业务代码，仅 low 额外携带 Gecko 内核（`geckoview-arm64-v8a`），`BuildConfig.LOW_ANDROID` 分支适配。

---

## 🛠 开发环境

| 项目 | 版本 / 说明 |
| --- | --- |
| 开发工具 | Android Studio（建议最新稳定版）；本仓库实际在手机本地命令行构建 |
| 语言 | Java 17（`sourceCompatibility / targetCompatibility 17`） |
| 构建工具 | Gradle 9.3.1 + Android Gradle Plugin 9.1.1 |
| SDK | compileSdk 37 / targetSdk 37 / minSdk 30（兼容版 23） |
| JDK | 21（Temurin 21.0.12.1 LTS） |
| NDK / 架构 | NDK 26.3 · 仅 arm64-v8a（含 llama.cpp 等原生库） |
| aapt2 | 本地 wrapper `/root/tools/aapt2`（以 `-Pandroid.aapt2FromMavenOverride` 注入） |
| 发布签名 | `release/DeepSeekHarness.keystore`（alias = DeepSeek Harness） |

### 手机本地构建

```bash
# 标准版（Android 11+ / 系统 WebView）——签名正式包
# 注意：aidl 工具需要 LD_LIBRARY_PATH=/root/aidl-aarch64（本机 arm64 环境）
LD_LIBRARY_PATH=/root/aidl-aarch64 sh gradlew :app:assembleStandardRelease \
  -Pandroid.aapt2FromMavenOverride=/root/tools/aapt2

# 兼容版（Android 6+ / 内置 Gecko 备用内核）
LD_LIBRARY_PATH=/root/aidl-aarch64 sh gradlew :app:assembleLowRelease \
  -Pandroid.aapt2FromMavenOverride=/root/tools/aapt2

# 产物
# app/build/outputs/apk/standard/release/app-standard-release.apk
# app/build/outputs/apk/low/release/app-low-release.apk
```

> 包名 `com.deepseek.harness`；两版共享包名与数据，不能并排安装；标准版约 179 MiB。

---

## 📦 安装与许可

- 直接安装对应的 `app-*-release.apk`（已用发布签名）；首次启动按引导完成环境解压即可使用。
- 本仓库基于 MIT 许可的 [DSH-APP/DSHA](https://github.com/DSH-APP/DSHA) 二开，保留上游许可证与致谢（见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）。

## 💝 打赏支持

如果这个工具帮到了你，欢迎打赏支持一下作者，你的支持是持续维护的动力！🎉

| 微信 | 支付宝 |
| --- | --- |
| ![微信打赏](reward_wechat.png) | ![支付宝打赏](reward_alipay.png) |

---

## 🛡️ 免费声明

**本软件完全免费开源，不收取任何费用，也没有会员、内购或任何付费功能。**

如果你是通过付费购买获得本软件，说明你被骗了——请立即退款，并到官方交流群反馈。

- 应用名称：DeepSeek Harness
- 包名：`com.deepseek.harness`
- 开源地址：<https://github.com/xliaoy/DeepSeekHarness>

---

## 💬 交流与反馈

| 渠道 | 信息 |
|---|---|
| 交流 QQ 群 | 群号 **1125393952** · [点击加入群聊【DeepSeek Harness手机端】](https://qun.qq.com/universal-share/share?ac=1&authKey=IyxMq0rBXUREnVUtSJMWRHygUKhtHcer%2BoqN2Y8zXyNFxkwergsqsQU1sxD98M40&busi_data=eyJncm91cENvZGUiOiIxMTI1MzkzOTUyIiwidG9rZW4iOiIydnRIZE9CVGF1OHVkRHVLM00xMXhzMnVGYWdGb2hMNjNjRDlaQUJWUjkxVkRMcE5kUTY5aENMWVFsdGtxSkJTIiwidWluIjoiMzQ0NTc5MDk1OCJ9&data=pH25LUAofBHc-HFdejNWLW2FDxq8JdM9XEkwpQFQKwN-sRJMb1-K6o1gWRTpjLtBWD7oh3FhlCfpswttZfMGwQ&svctype=4&tempid=h5_group_info) |
| 开发者 QQ | **3445790958** · [点击加我为 QQ 好友](https://qm.qq.com/q/yVTeGUfLjy) |