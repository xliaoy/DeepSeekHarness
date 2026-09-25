# task-2 资源层合并 —— 静态视觉核验报告

**核验对象**：`app/build/outputs/apk/standard/release/app-standard-release.apk`
（275,170,433 bytes，2026-09-24 02:04:27，`assembleStandardRelease` BUILD SUCCESSFUL in 6m 59s）

**核验方式**：`aapt2 dump resources` 解析 **APK 资源表**（不依赖源码，不接受「改了源码」作为证据）。

> ⚠️ **方法学陷阱（重要）**：release 构建开启资源压缩，`res/` 下文件名被缩短为 `res/-1.xml`、`res/-B.png`。
> 因此 `unzip -l apk | grep bg_card` 会 **NOT FOUND**，**不能据此判定资源丢失**。
> 必须查 **资源表**（资源名保留）而非**文件路径**。本报告全部结论基于资源表。

---

## 1. fork 美化 drawable —— 10/10 在 APK 资源表中 ✅

| drawable | APK 资源表 |
|---|---|
| `bg_nav_floating` | ✅ |
| `nav_item_bg` | ✅ |
| `bg_drawer_item` | ✅ |
| `bg_drawer_row` | ✅ |
| `bg_addr_plain` | ✅ |
| `bg_bar` | ✅ |
| `bg_chip_selected` | ✅ |
| `bg_tab` | ✅ |
| `bg_tab_on` | ✅ |
| `bg_spinner_popup` | ✅ |
| `bg_spinner_dropdown_item` | ✅ |
| `checkbox_custom` | ✅ |

## 2. fork 独有 layout —— 5/5 在 APK 资源表中 ✅

`activity_source_settings` · `activity_startup_recovery` · `dialog_app` · `item_source_spinner` · `item_source_spinner_dropdown`

## 3. 设计 token 实测值 —— **确认是 fork 值，非上游默认值** ✅

这是「视觉以本 fork 为准」的**决定性证据**：值取自 APK 资源表，而非源文件。

| token | APK 实测 | 上游默认 | 判定 |
|---|---|---|---|
| `radius_card` | **22.0dp** | 18dp | ✅ fork |
| `radius_control` | **16.0dp** | 13dp | ✅ fork |
| `radius_small` | **12.0dp** | 10dp | ✅ fork |
| `gap_section` | **20.0dp** | 16dp | ✅ fork |
| `gap_block` | 16.0dp | 14dp | ✅ fork |
| `gap_control` | **12.0dp** | 10dp | ✅ fork |
| `text_page_title` | **20.0sp** | 22sp | ✅ fork |
| `input_height` | **46.0dp** | 48dp | ✅ fork |
| `page_pad_wide` | **32.0dp** | 24dp | ✅ fork |
| `nav_height` | **64.0dp** | — | ✅ fork 独有 |
| `nav_pad_x` | 20.0dp | — | ✅ fork 独有 |
| `nav_pad_y` | 10.0dp | — | ✅ fork 独有 |
| `launch_log_height` | 220.0dp | — | ✅ fork 独有 |
| `hairline` | 0.5dp | — | ✅ fork 独有 |

**14/14 全部为 fork 值。**

## 4. 色板 —— 日夜双变体均打包，且为 fork 灰阶 ✅

| color | 浅色 | 深色(night) |
|---|---|---|
| `card` | `#ffffffff` | `#ff000000` |
| `primary` | `#ff000000` | （night 变体已打包） |
| `line` | `#ffe5e5ea` | — |
| `text` | `#ff000000` | — |
| `text_muted` | `#ff8e8e93` | — |
| `ripple` | `#0f000000` | — |
| `panel_top` | `#ffffffff` | — |

- `color/card` 同时具备 `()` 与 `(night)` 两个 config 值 → **深色模式资源确实进包**（全 APK 共 69 条 night 限定条目）
- 取值符合 fork 的 iOS 灰阶不透明设计语言：纯白卡片 + `#E5E5EA` hairline + 纯黑强调

## 5. Stellar 补位资源 —— 进包确认 ✅

`string/grants_stellar` · `string/grants_authorize_stellar` · `string/grants_checking`
（用于解除 java-port 回流 Stellar 通道导致的编译阻断）

## 6. 资源一致性核销（源码层，最终态）✅

| 维度 | 结果 |
|---|---|
| XML `@type/name` 引用 | refs=**430**，defs=**1028**，**undefined = 0** |
| Java `R.*` 引用 | refs=**400**，**undefined = 0**（命中项已核实为 `android.R.*` framework，单独白名单分类） |
| 同 config bucket 内重复定义 | **0** |

**反向灵敏度验证**（防止「什么都不报」的假绿）：故意探针 `layout/__nonexistent__`、`id/__nope__`
均**正确报缺失**；`drawable/bg_card`、`style/Dialog_DeepSeekHarness_Material`、`id/device_stellar_status`
均**正确报存在** → 检查器有效。

### 6.1 ⚠️ 检查器自身的三个 bug（曾导致假 MISS，已修复 —— 方法论留档）

**bug 1：style 名 `.` / `_` 未归一 → 2 个假 MISS**
```
XML : <style name="Dialog.DeepSeekHarness.Material">   （带点）
Java: R.style.Dialog_DeepSeekHarness_Material          （带下划线 —— aapt 生成 R 类时做的转换）
→ 旧脚本两侧直接字符串比较，永不相等 → 永远报「未定义资源」
```
**修复**：两侧统一把 `.` 归一为 `_`。
**教训**：这两个「缺失」一度被当作真实缺口上报，**实际是工具缺陷，资源一直是好的**。

**bug 2：未索引 `@+id/` 定义 → 284 个假 MISS**
```
Java: R.id.bottom_nav
定义: layout 中 android:id="@+id/bottom_nav"
→ defs 索引漏了 `@+id/`（refs 正则里 `(?!\+)` 把它排除了），284 个 R.id.* 全部误报
```
**修复**：defs 中单独索引 `@\+id/([a-zA-Z0-9_]+)`。

**bug 3（更隐蔽）：`TYPE_RE` 同时作为捕获组 → group 索引错位**
`<color name="card">` 解析出 `tag=color, name=color`（group(2) 其实是 group(1) 的内容），
导致 defs 只收到 139 条（应为 1028）。
**修复**：`TYPE_RE` 改为**非捕获组** `(?:...)`，各调用点显式加外层捕获组。

**共同病根**：**「证据搜索域」未覆盖真实定义域** —— 与 verifier 总结的
「多次栽在搜索域/工具层级选错」是同一类错误。**报 FAIL/MISS 时，应先怀疑自己的工具，再去怀疑被检查的对象。**

**bug 4（收尾阶段第 4 次同源踩坑）：未索引 `values/` 里的资源别名**
收尾时我用一个**临时内联脚本**复查「Java 引用的 drawable 是否都在」，
它只扫 `drawable*/` 目录，**漏了 `values/drawable_aliases.xml` 里的别名定义**：
```xml
<item type="drawable" name="bg_polished_card">@drawable/bg_card</item>
<item type="drawable" name="bg_polished_primary">@drawable/bg_btn_primary</item>
<item type="color"    name="polished_primary_text">@color/button_primary_text</item>
```
→ 误报 `bg_polished_card` / `bg_polished_primary` 「缺失 2 个」。
**实证反驳**：这两个资源**就在 APK 资源表里**
```
resource 0x7f07008e drawable/bg_polished_card
resource 0x7f07008f drawable/bg_polished_primary
```
且 `bg_polished_action.xml:4` 正常引用、构建成功 → **别名机制合法，资源完好。**
**修复**：以 `/tmp/rescheck.py`（**已索引 `<item type=...>`**）为准，其判定这两者 `EXISTS`。

> **方法论总结**：`values/` 不只定义 string/dimen/color/style，
> **还能用 `<item type="drawable|color|...">` 定义「资源别名」**。
> 任何「资源存在性」检查若只扫类型目录、不扫 `values/` 的 `<item>`，**必然假报缺失**。
> 同类病根**第 4 次复发**，说明「工具搜索域」是本次任务最大的系统性风险源。

---

### 6.2 「fork 视觉真的作用在上游 layout 上」的产物级证据 ✅

这是「视觉以本 fork 为准」的**最强论证** —— 不是「文件在包里」，而是
**fork 独有的结构被真实打包**。

**(1) `activity_main.xml` 悬浮胶囊底栏**：8 项相关资源全部在 APK 资源表中
```
drawable/bg_nav_floating ✓   drawable/nav_item_bg ✓    color/nav_item_tint ✓
dimen/nav_height ✓           dimen/nav_pad_x ✓         dimen/nav_pad_y ✓
style/Widget.DSHA.BottomNavActiveIndicator ✓   style/TextAppearance.Dsha.NavLabelActive ✓
```
其定义的 7 个 id 均在包内（id 由 layout 定义，id 在 = layout 在）：
`id/bottom_nav` `id/bottom_nav_wrap` `id/app_bar` `id/sub_back` `id/btn_theme` `id/btn_about` `id/app_title` ✓

> ⚠️ **验 layout 是否进包不能 grep 文件名**：release 资源压缩后路径已缩短（`res/-1.xml`）。
> 正确做法是查**该 layout 定义的 id 是否在资源表**。

**(2) 决定性论证：fork 独有 token 的上游对照**
```bash
for t in nav_height nav_pad_x nav_pad_y hairline launch_log_height; do
  grep -q "name=\"$t\"" /tmp/dsha-up/app/src/main/res/values/dimens.xml \
    && echo "$t 上游存在" || echo "$t 上游不存在 ✓ fork独有"
done
# nav_height / nav_pad_x / nav_pad_y / hairline / launch_log_height → 上游全部不存在
```
→ 这些名字**上游 v0.1.7 压根没有**，却出现在 APK 资源表中 ⇒ **只可能来自 fork 结构，不可能是上游残留**。

**(3) 32dp 弹窗圆角 —— 两层引用链，且可产物级闭环**（⚠️ 曾口头误报行号，此处为实测）

源码层落点：
```xml
<!-- values/themes.xml:94 -->
<style name="Dialog.DeepSeekHarness.Material" parent="ThemeOverlay.Material3.MaterialAlertDialog">
    <item name="shapeAppearanceOverlay">@style/Shape.DSHA.Dialog</item>   <!-- :111 -->
</style>
<!-- values/themes.xml:115 -->
<style name="Shape.DSHA.Dialog" parent="">
    <item name="cornerFamily">rounded</item>
    <item name="cornerSize">32dp</item>                                   <!-- :117 ← 真正落点 -->
</style>
```

**产物级闭环**（`aapt2 dump resources` 输出 style 的 `<item>` 值 —— 无需解 `resources.arsc`）：
```
resource 0x7f110124 style/Dialog.DeepSeekHarness.Material
    shapeAppearanceOverlay(0x7f03037c)=@style/Shape.DSHA.Dialog     ← 引用链（产物级）
resource 0x7f110162 style/Shape.DSHA.Dialog
    cornerFamily(0x7f030133)=0
    cornerSize(0x7f030139)=32.000000dp                              ← 数值（产物级）
```
→ 完整链条 `Dialog.DeepSeekHarness.Material` →(`shapeAppearanceOverlay`)→ `Shape.DSHA.Dialog` →(`cornerSize`)= **32dp**
**全部在 APK 资源表中可验**，不是仅源码级结论。

### 6.3 跨层符号分隔符规律（本次踩坑总结，供后续复核者避坑）

比对同一资源符号时，**不同层用不同分隔符**，跨层比对前必须归一：

| 层 | 分隔符 | 例子 |
|---|---|---|
| res XML 源码 `<style name=>` | **点号** | `name="Widget.DSHA.X"` |
| APK 资源表 dump | **点号** | `style/Widget.DSHA.X` |
| **Java `R.style.` 引用** | **下划线** | `R.style.Widget_DSHA_X` |

- **只有 Java `R.` 引用层是下划线**（aapt 生成 R 类时的转换）；源码与资源表**都保留点号**
- 因此「归一」只在 **Java ↔ (XML源码 \| 资源表)** 之间需要；资源表 ↔ XML 源码可直接比

---

## 7. 尚未完成的真机视觉复验（待冻结解除）

以下需**装机截图**，属设备操作，尚未执行：

1. **`low` 窄屏 140px 左右布局不溢出**（lead 指定最高优先）
2. 悬浮胶囊底栏实际渲染（`bg_nav_floating` + `nav_item_bg` + 关闭 Material 默认指示器）
3. 顶栏同色 + 沉浸式状态栏
4. 卡片渐变质感（`card`→`raised` 上亮下暗）
5. 自绘复选框渲染
6. 弹窗 32dp 圆角 + 双路按钮
7. Stellar 卡片在 Shizuku 卡片下方的实际排版
8. 深色模式整体观感

**约束**：`app-low-release.apk` 为 9/23 08:00 旧产物（本次仅出 standard）；且当前处于全队写入冻结期。
**→ 此约束已在第 8 节解除**（low 包已于 02:20 重建）。

### 7.1 第 9 条（窄屏不溢出）的**静态前置结论** —— 已排查，未发现溢出风险 ✅

虽未真机截图，但已做**全量静态排查**：

**(a) 全 layout 固定宽度分布**（140px ≈ 140dp 阈值）：
```
layout_width="0dp"      90 处  ← 权重自适应，安全
layout_width="16dp"     37 处
layout_width="32dp"     35 处
layout_width="48dp"      8 处   ← 全部 ≤48dp，远低于阈值
```
→ 唯一 ≥140dp 的固定宽度只有 **1 处**：`welcome_page1.xml:6` 的 `140dp` 装饰性圆环 View。
它是 `FrameLayout(match_parent)` 内 `layout_gravity="center"` 的装饰元素，**不参与父容器宽度计算**，
同层另有 118dp/96dp 同心装饰 —— 窄屏下居中显示，**不产生溢出**（无 sibling 被挤压）。

**(b) 横向 LinearLayout 刚性宽度扫描**（最易挤爆的形态）：
初筛命中 `activity_main.xml`，**逐层复核后确认是假阳性**：`app_bar` 内 **`app_title` 用 `layout_width="0dp"`（权重撑满）**，
两侧按钮为 34/44/48dp 定值 → **标题栏自动吸收/让出剩余空间，窄屏优雅压缩**，非刚性溢出。
（初筛的 247dp 是把多层嵌套子元素宽度**跨层级累加**所致，非同一行实际排布。）

**(c) `BottomNavigationView` 悬浮底栏**（本轮改造重点）：
`bottom_nav_wrap` = `match_parent` + 左右 `nav_pad_x`=20dp；`bottom_nav` = `match_parent`，
4 个 tab 由 Material 组件**均分**、无固定宽度 → **天然适配任意宽度**，窄屏安全。
最窄推算：屏宽 320dp → 可用 320−2×20 = **280dp / 4 tab = 每 tab 70dp**，
含 24dp 图标 + 10sp 标签，**有余量**。

**(d) `minWidth` 检查**：仅 `fragment_plugins.xml:33` 有 `minWidth=120dp`（配 `wrap_content`+`singleLine`），140px 屏仍有余量；
另有 `minWidth="0dp"` 9 处（显式解除约束）与 64dp 2 处。

**(e) 无窄屏专用覆盖目录**：`values-sw*/`、`layout-sw*/` **均不存在**
→ 无「窄屏另行覆盖」的逻辑，**结论在 low/standard 上一致**。

⚠️ **(f) 一处须更正的 token 说明**：`page_pad_wide`（fork 32dp / 上游 24dp）
**在 `main/res` 内零引用**（`grep -rn page_pad_wide app/src/` 除定义处无命中），
**它不参与当前布局的宽度计算**，因此**不能**把它列为「窄屏可用宽度」的推导依据。
真正驱动底栏窄屏表现的是 `nav_pad_x`(20dp) / `nav_pad_y`(10dp) / `nav_height`(64dp)
（`activity_main.xml:22-23` 实际引用）。

**结论**：从布局静态结构看**未发现会导致窄屏溢出的刚性宽度**。

---

## 8. 真机实包复验（low, `20260925low`）—— ⚠️ 受阻，未执行

### 8.1 结论

**真机截图验证未能执行**，原因见 8.3 的两项**环境级阻断**（均非本任务代码/资源问题）。
按 lead 指示不卡住，**以「静态 + 产物级证据已完整」收口**，证据等级如实标注如下。

### 8.2 已完成的部分（产物级，均在 low 实包上复验）

| 项 | 证据 | 等级 |
|---|---|---|
| low 包存在且为本轮新产物 | 350,789,544 B · 02:20:55 · `versionName=20260925low` | 产物级 ✅ |
| 目标架构 | `lib` **仅 `arm64-v8a`** | 产物级 ✅ |
| flavor 差异生效 | `minSdk=23`（low） vs `30`（standard） | 产物级 ✅ |
| flavor 文案分叉 | `edition_description` = 「兼容版 · Android 6+ · WebView / Gecko」 | 产物级 ✅ |
| fork 美化 drawable | 抽查 4/4 在包 | 产物级 ✅ |
| fork 独有 layout | 抽查 3/3 在包 | 产物级 ✅ |
| fork 独有 token 排他性 | `nav_height`/`nav_pad_x`/`nav_pad_y`/`hairline`/`launch_log_height` 上游**全无**、low 包**全有** | 产物级 ✅ |
| fork token 取值 | `radius_card=22dp`、`nav_height=64dp`、`nav_pad_x=20dp`、`input_height=46dp` | 产物级 ✅ |
| 32dp 弹窗圆角 | `cornerSize(0x7f030139)=32.000000dp` + `shapeAppearanceOverlay` 引用链 | 产物级 ✅ |
| 窄屏不溢出（第 9 条） | 第 7.1 节全量静态排查 + 本表 token 实测 | **静态级**（非真机截图）⚠️ |

### 8.3 🔴 两项环境级阻断（已核实，非本任务缺陷）

**阻断 1：`com.deepseek.harness` 未安装，且所有可用通道均无法安装**
```
$ adb-shell "dumpsys package com.deepseek.harness"
Unable to find package: com.deepseek.harness

$ adb-shell "pm install -r '.../app-low-release.apk'"
[POLICY_BLOCKED] pm 只允许查询；安装、卸载、清数据和授权不开放给设备命令

$ curl /app/open?url=file:///.../app-low-release.apk
FORBIDDEN: 只支持 http/https/geo/tel/mailto/market 链接

$ curl /app/help | grep install        →  无任何安装端点（24 个端点全部列出核对）
```
→ **设备 shell 的 `pm` 按策略只读；`/app/*` 无安装接口；`/app/open` 拒绝 file://。**
→ 属**设备策略限制**，不重试、不绕过。

**阻断 2：截屏能力不可用（无障碍服务未开启）**
```
$ curl /app/ui/screenshot
[ERR] 无障碍服务未开启。请让用户在 DSHA「设置 → 设备能力授权」点「设置屏幕操作」，
      或到系统设置 → 无障碍 → DSHA 配对助手 打开。

$ curl /app/vscreen/status   →  {"ok":false,"error":"VSCREEN_NOT_RUNNING"}
```
→ **截图需用户手动开启「屏幕操作」授权**，属用户侧开关（非我可代开）。

### 8.4 防数据丢失核查（安装前的必做步骤，已完成）

lead 要求「安装前先只读确认现有版本，避免覆盖用户数据」。实测结果：

| 包 | 版本 | 安装时间 | 判定 |
|---|---|---|---|
| `com.dsh.client`（label「DSHA」） | v0.1.6-alpha2.1 (142) | 2026-09-22 07:56 | **用户日常在用的 App**，有已授权限与真实数据 |
| `com.deepseek.harness`（本轮构建） | v145 `20260925low` | — | **未安装** |

→ **两者包名不同**，本轮安装属**新增并存**，**不会覆盖 `com.dsh.client`**；
→ 且**未执行任何卸载 / 清数据**（设备策略禁止项）。
→ ⚠️ **值得上报**：设备上用户实际在用的是 `com.dsh.client`，与本轮 `applicationId com.deepseek.harness` **不同名**，
   这与已知的 `app/src/debug/AndroidManifest.xml` 遗留 `targetPackage=com.dsh.client` 缺陷**同源**，
   属 **build-config / manifest 层**问题，**不在 task-2（res）范围**。

### 8.5 未验证项（如需真机证据，请 lead 协调）

1. 悬浮胶囊底栏**实际渲染**形态（`bg_nav_floating` 圆角/高度观感）
2. 顶栏同色 + 沉浸式状态栏效果
3. 卡片渐变质感（`card`→`raised` 上亮下暗）
4. 自绘复选框渲染
5. 弹窗 32dp 圆角 + 双路按钮**实际观感**
6. Stellar 卡片在 Shizuku 卡片下方的**实际排版**
7. 深色模式整体观感
8. **窄屏不溢出**（第 9 条，真机截图）

**解除条件**：需 (a) 用户在「设置 → 设备能力授权」开启**屏幕操作**（解截图），
且 (b) 提供可用的**安装通道**（当前设备 shell 的 `pm install` 被策略禁用）。
二者齐备后可立即补做，预计 10–15 分钟。

---

## 附：核验脚本

- `/tmp/rescheck.py` —— 全图引用/定义核销（正确索引 `color/` 目录与 `drawable-nodpi/`、flavor res、Java `R.*`）
- `/tmp/dupcheck2.py` —— config-bucket 感知的重复定义检查器
