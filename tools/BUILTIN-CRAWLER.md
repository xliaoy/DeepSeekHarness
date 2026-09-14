# 内置爬虫开发环境说明（相对原版的最小增量）

本工程在原始 DeepSeek Harness 基础上，仅新增「爬虫开发环境」离线内置：
其他所有内容（ubuntu-tools 28 包、dsh 运行时、原安装流程）保持原版不变。

## 新增资产（app/src/main/assets/）
| 资产 | 大小 | 内容 | 安装 |
|---|---|---|---|
| wheels.bin | 137 MB | 110 个 Python wheel：requests/httpx/aiohttp/curl_cffi/beautifulsoup4/lxml/parsel/scrapy/selenium/playwright/DrissionPage/fake_useragent/pandas/numpy 等 | pip 离线安装 |
| chromium.bin | 218 MB | 无头 Chromium 153 arm64（含全部运行库） | 解压到 /opt/headless-browser |
| install-extra-tools.sh | 2 KB | 安装脚本（ensurepip + pip + chromium） | proot 内执行 |

## 安装流程（冷启动，见 ProotBootstrap.java）
原版流程之后新增一步 `installBundledExtraTools`：
1. 解压 wheels.bin / chromium.bin 到 rootfs 临时目录
2. proot 内执行 install-extra-tools.sh：
   - `python3 -m ensurepip --upgrade`（pip 由 App 内置 Python 3.12 提供，无需 deb）
   - `python3 -m pip install --no-index --find-links=wheels --break-system-packages wheels/*.whl`
   - Chromium 移至 /opt/headless-browser
3. 完成打 `DeepSeekHarness_EXTRA_TOOLS_READY` 标记

## 代码改动（仅 3 个文件）
- `runtime/ProotBootstrap.java`：新增 installBundledExtraTools / collectColdInstallExtra，冷安装流程插入一步
- `runtime/RuntimeTools.java`：注册 install-extra-tools.sh
- `util/ManagedRuntimeLayout.java`：受管白名单加入 install-extra-tools

## 验证
- prepare-standard-assets 全链通过（ubuntu-tools.inputs 与 28 包 lock 校验一致）
- wheels 离线安装已实测（venv 内 --no-index 装 curl_cffi/scrapy/pandas 全部可用）
- Chromium 即容器打包原产物，可运行

## 构建（Android SDK 环境）
```bash
./gradlew :app:assembleStandard
```

## 界面与诊断增强（第二次迭代）
- **启动页实时百分比进度条**：BackupTaskState.Snapshot 新增 ratio（0..1），detail 可带内嵌标记
  `\u0001R{ratio}\u0002{文本}`；ExtractActivity 进度条 determinate（max=1000）+ NN% 文本；
  EnvironmentMaintenance 按阶段权重折算总进度（解压 2%→36%…dpkg→78%…爬虫→96%…100%）。
- **老用户升级自动补装爬虫环境**：EnvironmentMaintenance.update 检测
  `hasBundledExtraTools()`（/opt/headless-browser/chrome + 安装标记），缺失时 `applyBundledExtraTools` 离线补装（带实时进度，失败不阻断 dsh 更新）。
- **启动日志框**：固定 240dp 高度可上下滚动；最新日志在底部实时自动跟随；
  用户上滑查看历史时暂停跟随，回到底部恢复（LaunchFragment 滚动监听）。
- **完整访问链接**：启动日志展示真实鉴权地址（完整 token）；落盘日志
  /root/dsh-web.log 仍经 SensitiveData.redact 打码（StartupTrace 移除展示层脱敏）。
- **诊断与日志页**：环境检查探针新增「无头浏览器」「爬虫库标记」，
  运行时检查新增「爬虫库」「无头浏览器」状态行。
- **安装与修复页**：InstallProbe 新增「Python 爬虫库」「无头浏览器」两项检查。

## 第三次迭代（问题修复）
- **安装修复页可补装爬虫**：InstallPipeline 修复第 2 步时检测「Python 爬虫库 / 无头浏览器」
  检查失败 → 自动调用 `applyBundledExtraTools` 离线补装（幂等，失败不阻断其它修复，复验呈现结果）。
- **启动日志框修复**：去除 fillViewport（内容多高显示多高，不再半空留白）；
  内层 ScrollView 滚动时 `requestDisallowInterceptTouchEvent(true)`，解决与外层
  NestedScrollView 的嵌套滚动冲突——日志现在可正常上下滑动查看历史。

## 第四次迭代（关键修复）
- **补装修复生效**：修复 applyBundledExtraTools 反向判断（原 `if (!hasBundledExtraTools()) return` 导致
  "环境缺失时反而跳过补装"，现改为已具备才跳过）；安装修复页补装爬虫后复验可转绿。
- **仅检查也含爬虫**：InstallProbe 的 python 爬虫库/无头浏览器检查随全步骤执行（仅检查模式同样覆盖）。
- **日志框重构**：内层改用 androidx NestedScrollView（与外层 NestedScrollView 走嵌套滚动协议，
  彻底解决无法上下滑动问题）；高度改为 layout_weight=1 占满整个日志区域（不再固定 240dp/半空）；
  最新日志在底部实时跟随、上滑查看历史暂停跟随。

## 第五次迭代（爬虫可安装 + 日志区定稿）
- **pip 引导不再依赖 ensurepip**（App 内置 Python 无此模块是装不上的根因）：
  wheels.bin 内置 pip-26.2.1 wheel，install-extra-tools.sh 用
  `PYTHONPATH=<pip.whl> python3 -m pip` 引导后离线安装全部 111 个库（含 pip 自身）；
  已在本机 venv 端到端验证：引导 → --no-index 离线装 → requests/scrapy/pandas 导入成功。
- **日志区域定稿**：固定 240dp 高、内容超出区内滚动、最新日志在底部实时跟随、
  上滑暂停跟随查看历史（NestedScrollView 承载，无嵌套滚动冲突）。

## 第六次迭代（修复残留目录 + 日志视觉与滚动）
- **补装不再卡临时目录**：installBundledExtraTools 对 `root/.deepseekharness-extra-tools`
  采用"存在即清空重用"，install-extra-tools.sh 加 `trap ... EXIT` 兜底清理；
  上次失败残留不再阻塞下一次修复。
- **启动页日志区视觉**：NestedScrollView 固定 240dp + fillViewport=true（文字撑满区域）
  + 背景色可见，不再出现"文字占一半、下边空着"。
- **安装修复页日志可滚动**：install_log_scroll 改 androidx NestedScrollView
  （原为普通 ScrollView，与页面根 ScrollView 嵌套滚动冲突导致滑不动），并保留底部自动跟随。

## 第八次迭代（抓包安装依赖冲突根治）
**根因**：安装脚本用 `pip install wheels/*.whl` 把每个 wheel 当硬性要求，且 wheels.bin 存在重复版本，
pip 报 `ResolutionImpossible`；深入排查发现三处**互斥约束**：
- `django 6.1.1` 需 `asgiref>=3.9.1` ↔ `mitmproxy 12.2.3` 需 `asgiref<=3.11.1` → 交集 **3.11.1**
- `anyio 4.15.1` 需 `typing_extensions>=4.16` ↔ `mitmproxy` 需 `typing_extensions<=4.14` → 降级 **anyio 4.9.0**
- `selenium 4.49.0` 需 `typing_extensions>=4.15` ↔ `mitmproxy` 需 `<=4.14` → 降级 **selenium 4.27.1**

**修复**：
1. wheels.bin 去重 + 按约束交集固定版本（asgiref 3.11.1 / typing_extensions 4.14.0 /
   anyio 4.9.0 / selenium 4.27.1），每个包只保留一个满足全部约束的版本（131 个 wheel）；
2. install-extra-tools.sh 改为 **"包名 + find-links 目录"** 方式安装
   （`pip install --no-index --find-links=wheels $(cat reqs.txt)`，reqs.txt 由脚本从 wheel 名生成），
   让 pip 在候选版本间自行解析，而不是把文件路径当硬要求。

**验证（chroot 全真模拟，rootfs + App 内置 Python）**：
- 首次补装：131 包全部安装成功 → `DeepSeekHarness_EXTRA_TOOLS_READY`，`EXTRA_TOOLS_EXIT=0`
- 三项检查全通过：Python 爬虫库 / 无头浏览器 / 抓包工具（`import mitmproxy,scapy` + `mitmdump`）
- `mitmdump --version` → 12.2.3；selenium 4.27.1、DrissionPage 4.1.1.4 可用
- 幂等重跑（已装环境再修复）：全部 "Requirement already satisfied" → READY（不冲突）

## 第九次迭代（iOS 拟态 UI 升级）
**目标**：iOS 原生观感的高端拟态界面——毛玻璃层次感但**完全不透明**（不使用半透明/模糊）。

**实现方式**：用「不透明垂直渐变（上亮下暗模拟玻璃光泽）+ hairline 描边 + 柔和层叠阴影」替代真实毛玻璃，
面板均为实色，符合"不要透明效果"的要求。

- **色板**（day/night 双套，iOS 系统色）：
  - 页面 `systemGroupedBackground` #F2F2F7（深色 #000000）
  - 卡片纯白 #FFFFFF（深色 #1C1C1E）、次级 #F7F7FA / #2C2C2E
  - hairline 分隔 #E5E5EA（深色 #38383A）
  - 文字阶梯 iOS label/secondary/tertiary：#000000 / #3C3C43 / #8E8E93
- **导航栏**：56dp + bg_bar 渐变背景 + 底部 hairline + 17sp semibold 标题（`NavTitle`）
- **底栏**：60dp、24dp 图标、bg_bar 渐变 + hairline 分隔（iOS Tab Bar 尺寸）
- **组件全部渐变光泽化**（day/night 自动适配）：
  `bg_card` / `bg_card_clickable` / `bg_preview` / `bg_chip(_clickable)` / `bg_btn` / `bg_btn_primary` /
  `bg_btn_danger` / `bg_input`（聚焦 2dp 黑描边）/ `bg_tab` / `bg_tab_on`（选中 1.5dp 黑描边）/ 新增 `bg_bar`
- **细节**：新增 `hairline`(0.5dp) 与 `text_large_title`(26sp) 尺寸 token；卡片 22dp 大圆角 + 2dp 柔和阴影

**限制说明**：iOS 连续圆角（squircle）与系统级背景模糊在 Android 端需自定义 outline/RenderEffect(API31+)，
且真模糊必然引入透明，与本次要求冲突，故采用不透明渐变模拟。

## 第十次迭代（UI 重构：底栏 / 进度百分比 / 排版规范 / 弹窗去重）
- **底栏 Telegram 风格**：新增 `nav_item_bg`（选中态淡灰圆角胶囊，未选中透明）+ 56dp 紧凑高度 +
  24dp 图标 + itemRippleColor 涟漪 + 单 hairline 分隔；保留图标/文字选中态着色（黑/灰）。
- **进度百分比全覆盖**（凡有进度均显示 %）：
  | 场景 | 实现 |
  |---|---|
  | 启动页解压/安装 | 结构化 ratio + `NN%`（已有） |
  | 安装修复页 | 「进度 NN% · 总耗时 N 秒」（已有） |
  | 更新页 | DshUpdater 阶段进度 15/60/90/100% → `update_progress_text` 显示 NN% |
  | 网页加载 | WebView onProgressChanged → `web_progress_text` 显示 NN%，完成后隐藏 |
  | 插件操作弹窗 | `AppDialogs.setProgressPercent(state.percent)` + 弹窗内 NN% 文本 |
  | 文件下载弹窗 | WebDownloads 已接 setProgressPercent（NN%） |
- **排版统一**：12 个布局文件中的硬编码间距（4/8/12/16/20/32dp）统一替换为设计 token
  （gap_hair / gap_tight / gap_control / gap_block / gap_section / page_pad_wide），数值等价、视觉零变化。
- **弹窗内容去重**：更新完成时详细说明由完成弹窗展示，页面 `update_status` 只显示简短状态
  （「更新完成，等待重启应用」），同一内容不再两处重复。

## 第十一次迭代（全页面卡片分组重设计）
**方式**：4 个并行子任务按页面组分工重排全部 21 个布局（严格保持 ID 与功能）。

| 分组 | 文件 | 要点 |
|---|---|---|
| 主流程 | fragment_launch / fragment_install / activity_extract / activity_update / activity_plugin_install | 每页 2–4 张卡片 + 组标题；主操作整行 PrimaryButton；extract 的动态 addView 父容器约束已保留 |
| 插件与设置 | fragment_plugins / item_plugin / fragment_settings / fragment_config / fragment_workspace | 插件分段卡、列表项卡片化、设置三组、配置四组（接口/行为/安全/设备）、工作区五卡 |
| 诊断与终端 | activity_diagnostics / activity_web_preview / fragment_terminal / fragment_pty_terminal / dialog_app / dialog_remind_backup | 诊断三卡、错误页标题卡+操作卡、终端 iOS 工具条 + 深色卡片、弹窗 iPhone 风格 |
| 欢迎引导 | activity_welcome + welcome_page1/2/3 | 弹性留白 + 插图卡 + 条目卡；页码点改 iOS 胶囊（Java 同步改造） |

**校验（独立于子任务自检）**：
1. XML 合法性：21 布局 + 全部资源文件**全通过**
2. ID 完整性：对照基线 **194 个 ID 零丢失**
3. 重复 ID：无
4. 元素宽高：无缺失
5. 资源悬空引用：无（2 处 `@string/*` 由 build.gradle resValue 提供）
6. 关键元素类型与 Java 强转匹配：NestedScrollView / ProgressBar / TextView / Button 全部一致
7. 卡片化覆盖：20/21（activity_welcome 为纯容器页，无需卡片）

**额外优化**：欢迎页页码点由「●」文本改为 iOS 胶囊（选中 20×8dp 主色 + 未选 8dp 灰点），
启用了原本无引用方的 `dot_active`/`dot_inactive`。

## 第十二次迭代（更新功能：真实下载进度 + 包大小 + 离线安装）
原实现：容器内 `npm install -g`（阶段估算 15/60/90/100%，无包大小）→ 无法显示真实进度。
新实现（DshUpdater 改造）：
1. **fetchTarballMeta**：从 npmmirror registry 获取 tarball 下载地址；
2. **downloadTarball**：App 侧直连下载（跟随 302→CDN），以响应头 **Content-Length 为包大小与百分比基准**，
   按 512KB 节流上报 **真实字节进度**，消息显示「正在下载更新包 12.3 / 45.6 MB (27%)」；
3. **installLocalTarballCommand**：容器内 `npm install -g <本地 tgz>`（离线，不再触发 npm 二次联网）；
4. 复验版本 + 会话补丁 + needsRestart 弹窗重启。
界面无需改动：`update_status` 显示消息（含 MB 与 %），`update_progress_text` 由 UpdateUi 渲染真实百分比。

### 更新后重启逻辑（stopWebAndRestart）
- 防重入：`restartScheduled` 进程内只执行一次；
- 先 `stopWeb()`（释放旧代码/文件占用）；
- 延迟 `delayMs` 后：构造 MainActivity 的 PendingIntent → **AlarmManager RTC_WAKEUP** 定 1.2s 闹钟 →
  `killProcess(pid)`（结束自身进程）；
- 原理：直接再活 Activity 会在杀进程时一并失效；AlarmManager 由系统进程调度，
  **App 进程被杀后仍会触发**并冷启动 MainActivity → 新版本代码加载。
- 入口：更新完成弹窗 →「确认重启」→ `stopWebAndRestart(3000)`（3 秒倒计时后自动重启）；
  选「稍后」则下次打开生效。

### 重启二次进入修复
**现象**：点「确认重启」→ App 退出重进后，过几秒又重复进入一次。
**根因**：重启闹钟（AlarmManager 1.2s 后拉起 MainActivity）是"一次性定时炸弹"——若用户在手
动重进（进程已恢复、旧代码已释放）后、闹钟触发前这段时间内进入了 App，闹钟仍会到点再次拉起
MainActivity → 二次进入。
**修复**：新增 `DshUpdater.cancelPendingRestart(context)`，在 `Application.onCreate`（进程每次
启动最早执行）统一取消该重启闹钟：
- 手动提前进入 → 残留闹钟被取消 → 不再二次拉起；
- 闹钟正常触发的那次重启 → 闹钟已消费，取消无害。
（两处使用完全相同的 PendingIntent：requestCode 0x53AF + 相同 Intent，保证 cancel 匹配。）

### 更新页与重启交互调整（第十三次迭代）
- **更新页进度条改回无限（indeterminate）**：不再显示百分比；当前阶段由 `update_status` 文字说明
  （正在获取更新数据 / 正在下载更新包 X.X / Y.Y MB / 正在解压安装更新包 / 正在校验更新结果…），
  下载大小仍实时显示；`update_progress_text`（%）隐藏。
- **重启交互**：更新完成弹窗「立即重启 / 稍后」+ **3 秒实时倒数**（每秒更新消息"3 秒后自动重启…"）：
  - 点「立即重启」→ `stopWebAndRestart(0)` 立刻重启（停 Web → killProcess → 闹钟拉起新代码）；
  - 3 秒未点击 → 自动执行立即重启；
  - 「稍后」/关闭弹窗 → 取消倒计时（dismiss 时 removeCallbacks）。
