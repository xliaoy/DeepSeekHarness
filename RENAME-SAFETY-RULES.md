# 改名安全规则集（本轮方法论核心产出）

> 背景：把 251 文件的 fork 与 494 文件的官方 v0.1.7-alpha2 合并，并把全仓 `DSHA/dsha` 改名为
> `DeepSeekHarness/deepseekharness`。改名过程中共暴露 **9 类劈开/损坏实例**，全部落进下列四类不变量。

## K1「产出端可达性」— 决定「改不改」
- 若某标记的**产出端不在本仓库内**（藏在离线 rootfs 镜像、预编译 .so 里），则**静态不可见 ⇒ 禁改**。
- 实例：`DSHA_UBUNTU_TOOLS_READY`（产出端在 offline-rootfs.bin 内的烧录脚本里）。
- 判定法：全仓 grep 该标记，若**只有消费端 1 处命中**，则产出端必在仓外 ⇒ 保留。

## K2「跨版本/跨宿主契约」— 决定「改不改」
- 与**已发布版本**或**外部宿主**交换数据的标识符，改名即破坏兼容 ⇒ **禁改**。
- 实例：
  - 备份族 `DSHA-backup-` / `DSHA-sessions-` / `DSHA-data-v5-` / `Download/DSHA/`
    （`BackupScope.java:10-12` 明确注释为跨版本契约；`MainActivity:317` 启动即扫，改了老用户备份直接失联）
  - `com.dsh.client`（`GuestDataResolver.java:62` 的**历史路径别名**，老用户 L2S 链接靠它重映射）
  - 真实 URL `github.com/DSH-APP/DSHA`（改了 404）

## K3「长度耦合」— 决定「改完还对不对」  ★java-port 发现
- 凡 `substring(N)` / `slice(N)` / `indexOf` 的 **N 派生自被改名的前缀长度**，则 N 必须改为**派生式**。
- **不变量**：`startsWith("<literal>")` 与 `substring(<number>)` 同行出现 ⇒ 必须 `len(literal) == number`。
- 本轮命中 **5 处**（全部为真缺陷）：
  | 文件 | 旧 N | 后果 |
  |---|---|---|
  | `EnvironmentDataBackup.java:57-60` | 14 / 18 | **每次环境数据备份抛 JSONException（静默失效）** |
  | `StartupDiagnostics.java:48` | 15 | 启动阶段事件全丢 |
  | `TerminalSession.java:65` | 6 | 18 个异步会话用例超时 |
  | `WebPreviewActivity.java:391` | 12 | **页面事件诊断全丢**（`[DSHA_PAGE] `=12 vs `[DeepSeekHarness_PAGE] `=23） |
  | `TerminalSession.java:184` | — | 连带修正 |
- 穷举法：全仓 `\.substring\(\d+\)` 共 44 处（main 38 + test/debug 6），逐条核 len 后**其余 39 处绑定非品牌字面量**（`READY:`=6、`Groups:`=7、`./`=2、`npm:`=4、`dsh-`=4、`/`=1 等），全部自洽。

## K4「派生路径三方一致」— 决定「重建后还对不对」  ★Lead 发现
- 凡派生自**构建脚本**的路径/资产，必须满足：**产出脚本字面量 == 消费端字面量 == 派生 bin 内实际条目**。
- 实例：`tools/build-standard-runtime.py:90` 产出 `usr/local/lib/dsha-pnpm/`，
  但消费端（`ProotBootstrap.java:1455,1474` + `verify-stability.py:94`）与**已发布的 bin 内条目**都是
  `usr/local/lib/deepseekharness-pnpm/` ⇒ **源码层怎么搜都搜不到，clean 重建时 pnpm 静默失效**。
- 判定法：解包 `.bin`，取**路径型条目**，反向对照产出脚本的字面量。

## K5「契约值误替换」— 决定「改的是不是同一个值」  ★Lead 发现
- 上游一个**不变量值**被改名时替换成了**品牌名**，杜撰出**不存在**的值。
- 实例：上游唯一一个 `com.dsh.client` 被分别替换成 `com.deepseek.harness`（T3）和 `com.deepseekharness`（T2）
  —— 两个**互不相同**、且**都不是真实包名身份**的值。
- **特征：按名字 grep 完全搜不出来**，只能靠「是否满足产出端的不变量」暴露（此处：解析器只认 `com.dsh.client`）。
- 附：本项目三个包名类值的**正确分工**：
  ```
  com.deepseek.harness  = applicationId（真实 Android 包名）→ 跨应用查询（AdbBridge:349, DeviceAppPolicy:38）
  com.deepseekharness   = namespace + 应用内广播 action / 组件名 → 应用内自洽（8 处，全安全）
  com.dsh.client        = 上游旧包名 → GuestDataResolver 的【历史路径别名】，必须原样保留
  ```

## 补充：L2「双层改名」与「覆盖范围不对等」
- L2 实例共 **8 处**：Java 一侧改了新名、assets/JS 一侧仍是旧名（或反之）⇒ 运行时 ReferenceError / 静默丢事件。
  - `WEB_GENERATION`、`BACKUP_RESULT`、`ENV_DATA`、`ENV_PROGRESS`、`PLUGIN_TASK`、
    `ANDROID_RUNTIME`+`ANDROID_FONTS_V1`、`TerminalSession` sentinel（+K3 偏移）。
- **「覆盖范围不对等」**（系统性风险源）：task-1 只覆盖了 `app/src/main/java/`，
  而 `assets/`、`res/`、`tools/`、`src/test/` 是 fork 改过名但**未被覆盖**的域
  ⇒ 任何「Java 新名 / 其它域旧名」都是潜在劈开。**枚举覆盖域时必须逐一确认，不能只扫一个目录。**

## 结论：改名安全四件套（K2/K3/K4/K5）
| 规则 | 管什么 | 违反后果 |
|---|---|---|
| K2 契约不可改 | 改不改 | 老用户数据失联 |
| K3 长度必须派生 | 改完还对不对 | 静默解析失败 |
| K4 派生路径三方一致 | 重建后还对不对 | clean 重建才暴露 |
| K5 不变量值不可品牌化 | 改的是不是同一个值 | grep 搜不到的杜撰值 |

## K6「上游包名残留」— ★verifier 发现 + Lead 补全至 3 处
- **定义**：整文件搬运/覆盖上游代码时，上游**用它自己包名**硬编码的正则/路径未被换成我方包名。
- **识别三特征**：
  1. 该值 == 上游 `applicationId`（本项目：`com.dsh.client`）
  2. 以**转义形态**出现（源码写作 `com\.dsh\.client`）→ ★ **普通 `grep "com.dsh.client"` 搜不到**（转义型漏检）
  3. 该文件在 **fork 基线不存在**（纯上游新文件）→ 据此**排除「历史契约」解释**
- **唯一可靠检出法**：
  ```bash
  grep -rn 'com\.dsh\.client' app/src tools/    # 必须搜转义形态
  # 并与 /tmp/dsha-up/app/build.gradle:15 的 applicationId 对比
  ```
- **本轮命中 3 处（全部有活消费端）**：
  | # | 位置 | 消费端 | 后果 |
  |---|---|---|---|
  | 1 | `GuestDataResolver.java:62` | `legacy` 路径归一化 | 旧备份 guest 路径不被识别（T3 红） |
  | 2 | `MaintenanceDataSnapshot.java:22` | `:40 before()` / `:141` 过滤 | **.l2s 运行时缓存不被跳过 → 被当用户数据归档** |
  | 3 | `assets/environment-data.py:29` | `:33 runtime_cache()` / `:43 guest_target()` | 同上（环境数据备份链路） |
- **修法（双分支，保留兼容）**：
  ```
  com\.dsh\.client  →  (?:com\.deepseek\.harness|com\.dsh\.client)
  ```
  主分支修当前缺陷；兼容分支兼容「从上游 0.1.7 迁移、链路残留上游包名」的路径，成本为零。
- **决定性反证**：团队自己的 `tools/test-environment-data.py:20-22` 明确期望 `com.deepseek.harness`
  → 产品与团队测试期望冲突 ⇒ 该改的是产品。

### ★ Lead 的裁决错误记录（方法论教训）
```
错误裁决：把 GuestDataResolver:62 的 com.dsh.client 判为「历史兼容别名，禁改」
错因    ：① 把「上游自己的包名」错读成「我方的历史别名」（未先问「哪个版本产出过这个值？」）
          ② 只看到 1 处就下结论，未做同类全量扫描（实际 3 处）
纠正者  ：verifier —— 用「fork 基线不含该文件」+「团队自己的测试期望新名」两条硬证据推翻
正确判据：判「是不是历史契约」的第一问应是「fork 基线/已发布版本是否真的产出过这个值？」
          —— 从未产出过 ⇒ 不是契约，是残留。
```

### K6 最终清单（4 处，全部【活动缺陷】）+ 1 处注释劈开
| # | 位置 | 消费端 | 后果 | 等级 |
|---|---|---|---|---|
| ① | `backup/GuestDataResolver.java:62` | `legacy` 路径归一化 | 旧备份 guest 路径不被识别（T3 红） | 活动 |
| ② | `backup/MaintenanceDataSnapshot.java:22` | `:40`/`:141` 过滤 | `.l2s` 运行时缓存不被跳过 → 被当用户数据归档 | 活动 |
| ③ | `assets/environment-data.py:29` | `:33 runtime_cache()`/`:43 guest_target()` | 同上（环境数据备份链路） | 活动 |
| ④ | `builtin-plugins/dsh-computer-use-android/lib/server.cjs:17` | `:26` | **截图不以 image 回传给模型**（`screenshotTarget()`→null） | **活动** |
| ⑤ | `DeepSeekHarnessAccessibilityService.java:541` | —— | **注释与代码劈开**：javadoc 说 `Download/DSHA`，代码写 `Pictures/DeepSeekHarness` | 文档 |

### ★ 第 ④ 处的完整产出端追查（Lead 补证，推翻「潜在」判定）
```java
// DeepSeekHarnessAccessibilityService.java —— 全仓唯一截图产出端
:544  public static String uiScreenshot()               // /app/ui/screenshot
:566      out[0] = saveShot(bmp);                       // 唯一调用
:603      base = getExternalFilesDir(DIRECTORY_PICTURES);   // Pictures
:605      dir  = new File(base, "DeepSeekHarness");         // 已改名
:616      return "OK 截屏已保存：" + f.getAbsolutePath()
真实路径 = /storage/emulated/0/Android/data/com.deepseek.harness/files/Pictures/DeepSeekHarness/screen-<ts>-<uuid8>.png
⇒ 对 server.cjs:17 的两个分支均 NOMATCH ⇒ screenshotTarget() 返回 null
```
**⚠️ `Download/DSHA` 是备份/导出目录**（`DownloadsExport.java:19`、`BackupManager.java:222`），**从无截图产出端写它**。

### ★ K6 变体「注释与代码劈开」
- 改名时**只改代码、漏改注释** ⇒ 注释成为**误导性证据**。
- 本轮实际后果：验收方（verifier）**据注释**推断「分支 1 兜住功能」→ 把**活动缺陷误判为潜在缺陷**。
- **规则**：
  > **注释不是产出端，不能作为兼容性判据。**
  > 判「哪条路径是活的」必须追到【代码里的写文件调用】，不能读注释。

### ★ K6 自动化闸门（verifier 提出 + Lead 补第 ⑤ 条）
```
① 从 /tmp/dsha-up/app/build.gradle 读出上游 applicationId 当代替品字典
② 在我方全部源文件搜该值的三形态：非转义 / 转义(com\.dsh\.client) / URL 编码
③ 白名单排除 tools/ 的 com.dsh.client.rc21audit / .stabilityaudit（否则 7 条假阳性）
④ 判据：凡命中处，必须【同时】出现我方包名（即双分支写法），否则 FAIL
⑤ ★ 对每处命中，必须追到【产出端是谁】，并确认「被判为兜住的那个分支」真有产出端
   —— 不许用裸正则测试代替产出端追查
```
**第 ⑤ 条正是本轮双方都踩过的坑**：正则层 MATCH ≠ 功能可用，**必须验证该分支存在真实产出端**。

---

## K7「同族一致性」（本轮 java-port 自查发现，Lead 复核属实）

### 缺陷实例
```java
// app/src/main/java/…/data/DownloadsExport.java —— 【同一文件，两个分支，两个目录】
:43  values.put(MediaStore.MediaColumns.RELATIVE_PATH, DIRECTORY_DOWNLOADS + "/DSHA/");  // MediaStore 分支（Android 10+ 实走）
:71  File dir = new File(getExternalStoragePublicDirectory(DIRECTORY_DOWNLOADS), "DeepSeekHarness");  // File 分支（Android 9-）
// app/src/main/java/…/backup/ExternalBackupScanner.java
:87  File directory = …,"DeepSeekHarness"                    // 扫描兜底端（已改）
:95  String[] args = {path + "/DSHA/", path + "/DSHA"}       // MediaStore 查询端（未改）⇒ 与 :87 矛盾
```
族内取值集合 = `{DSHA, DeepSeekHarness}`，**基数 = 2（应为 1）** ❌

### 后果
- Android 10+ 导出到 `Download/DSHA/`；Android 9- 导出到 `Download/DeepSeekHarness/`
- `:95` 的 MediaStore 查询永远查不到实际导出目录
- `BackupManager:222` 告诉用户「已保存到 Download/DSHA/」→ 用户找不到文件

### 裁决：方案 A（回退 :71/:87 为 `"DSHA"`）
- ✅ 与「备份族冻结」裁决一致；全族 15 处中 13 处本就是 `DSHA`
- ✅ 向后兼容：老用户旧备份仍在 `Download/DSHA/`，新版本能扫到
- ❌ 方案 B（全族改新名）否决：推翻冻结裁决 + 老备份目录不再被扫描 = 静默丢数据

### K7 规则（含 Lead 补强）
```yaml
K7「同族一致性」
  定义：一个逻辑族（目录名/文件名前缀/协议 token）的所有引用点必须同批处理
  判据：族内引用点【取值集合基数必须为 1】

  补强 (a) 枚举器完备性：
    必须覆盖 引号字面量 / 字符串拼接 / 数组元素 / static final 常量 /
             资源文件 / 资产脚本 六种形态
    —— 单一 grep 正则必然漏：本轮 :43（拼接式，前无引号）与 :95（数组元素）
       都被 `grep -oE '"(Download/)?(DSHA|DeepSeekHarness)/?"'` 漏掉

  补强 (b) 判 FAIL 的处置：
    基数 != 1 时，改哪侧由【产出端可达性 K1】决定，不由「多数派」决定
    —— 若本例 :43 是少数派而 :71/:87 是多数派，按少数服从多数就会改错方向
```

### ★ 三条「grep 看不到的劈开」—— 本轮核心教训
| 规则 | 形态 | 为何 grep 旧名 = 0 发现不了 |
|---|---|---|
| K5 | 值被替换成品牌名 | 旧名已不存在，grep 旧名找不到 |
| K6 | 上游包名残留（转义 `com\.dsh\.client`） | 非转义 grep 找不到 |
| K7 | 同族半改（基数 > 1） | 残留计数只答「还剩多少」，不答「是否被改成一半」 |

> **结论：「grep 旧名 = 0」永远不能证明改名完整。**
> 必须配 **形态枚举 + 基数判据 + 产出端追查** 三者。

---

## K8「版本轴完备性」（java-port 发现，Lead 复核属实）

### 缺陷实例：README 文件名族
三版本对照（Lead 复核 `git show 62d8459:` / `/tmp/dsha-up` / 磁盘）：
| site | 上游 0.1.7 | fork 基线 62d8459 | 当前磁盘 |
|---|---|---|---|
| `backup-prepare.py:166` 产出端 | `DSHA-README.txt` | **`DeepSeekHarness-README.txt`** | `DeepSeekHarness-README.txt` |
| `backup-engine.py:45` SKIP | `DSHA-README.txt` | **`DeepSeekHarness-README.txt`** | `DSHA-README.txt` ← 被覆盖 |
| `backup-engine.py:493` 恢复校验 | `DSHA-README.txt` | **`DeepSeekHarness-README.txt`** | `DSHA-README.txt` ← 被覆盖 |
| `LegacyBackupImporter.java:45` | `DSHA-README.txt` | (该 rev 无此文件) | `DSHA-README.txt` |

**机制**：fork 基线三处一致（基数=1，自洽）→ 上游覆盖 `backup-engine.py` → 失配。
**不是「产出端被改名」，而是「消费端被上游覆盖回旧名」。**

### 后果（活动缺陷，Lead 已可执行证明）
`backup-engine.py:493` 校验：`if allowed and any(p.name not in allowed for p in payload): raise ValueError`
```
scope=sessions  allowed=("sessions","storages","attachments")  → ❌ ValueError
scope=settings  allowed=("settings.yaml",)                     → ❌ ValueError
scope=plugins   allowed=("profiles","plugin-src",…)            → ❌ ValueError
```
⇒ **sessions/settings/plugins 三种作用域的备份，恢复时全部失败。**

### 修复方向（方案 I，Lead 批准）
```python
# 改消费端（engine:45/:493）向 fork 新名收敛，不动产出端（fork 原创设计）
backup-engine.py:45   "DSHA-README.txt" → "DeepSeekHarness-README.txt"
backup-engine.py:493  同上
# 导入端双分支（必须认识所有历史真实值）
LegacyBackupImporter.java:45  + && !name.equals("DeepSeekHarness-README.txt")
```
**理由**：fork 意图优先 —— 当前失配是**覆盖事故的副产物**，不是设计变更；
改成旧名等于让覆盖事故永久固化进 fork。

### K8 规则
```yaml
K8「版本轴完备性」
  判定一个族该向哪个值收敛时，必须【三版本对照】：
    upstream / fork 基线(62d8459) / 当前工作树
  只看两版本会把「上游覆盖事故」误判成「本轮新造」，从而选错收敛方向。

  ⇒ 与 K7 合并为总规则：
     族枚举必须同时覆盖【版本轴】与【语义角色轴】两个维度。
```

### ★ 本轮的真正瓶颈 = 枚举完备性（三次栽跟头）
| 谁 | 漏了什么轴 | 后果 |
|---|---|---|
| java-port | 语义角色（残留计数漏「族内半改」） | K7#1 Download 目录 |
| Lead | 语义角色（漏「备份内容物名族」）+ 版本轴 | 抓出 K7#2，但收敛方向判错 |
| verifier | 产出端（正则层自证） | K6 ④ 误判为潜在缺陷 |

### K7 判据的豁免清单（第一例）
`LegacyBackupImporter.java:45` 是**导入端**，**刻意保留多值**（认所有历史值）
⇒ 基数判据对它**不适用**，须在枚举器里标为「显式多值白名单」，否则误报 FAIL。

---

## K7 判据的最终形式（java-port 细化，Lead 采纳）

### 按角色分列，而非平表 + 豁免
```yaml
产出端 producer : 基数 == 1，取值 == 设计值（fork 新名）
消费端 consumer : 基数 == 1，且必须 == 产出端取值     ← ★唯一的硬约束
导入端 importer : 基数 >= 历史值并集（天然多值，刻意为之）
⇒ 判基数前必须【先给每个引用点标角色】，否则把导入端误报为 FAIL。
```
**「不是特例豁免，而是导入端天然多值」** —— 角色固有属性，不是例外。
⚠️ 边界：该性质**只对「真的只读历史数据」的导入端成立**，不能推广到所有 `XxxImporter`。

### 内容物名族横扫结果（Lead 独立复核，与 java-port 一致）
```
token                                       prepare  engine  importer   判定
.deepseekharness-plugin-src                       3       4        4   ✅ 一致
.deepseekharness-backup-manifest.json             4       1        1   ✅ 一致
.deepseekharness-apikey                           1       2        0   ✅ 一致
.deepseekharness-pub                              1       1        4   ✅ 一致
DeepSeekHarness-README.txt                        3       2        1   ✅ 一致
settings.yaml                                     1       3        1   ✅ 一致
.dsha-plugin-src / .dsha-backup-manifest / .dsha-pub   0   0        0   ✅ 零残留
DSHA-README.txt                                   0       0        1   ⚪ 仅导入端历史值
```
⇒ 无第三个劈开。

### LegacyBackupImporter 的 `DSHA-*` 前缀 = 正确历史值（非残留）
```
:105-106  startsWith("DSHA-sessions-") / "DSHA-settings-" / "DSHA-plugins-" / "DSHA-backup-"
:23       File slots = new File(task, "legacy-payload")     ← 它就是旧备份读取器
:38       Map<String,Object> legacy = readManifest()
调用方     NativeBackupJobs.java:312
⇒ 职责即「读旧版本备份」⇒ 保留，改了会让老备份无法导入。与「备份族冻结」裁决一致。
```

---

## 本轮团队三次栽跟头 —— 根因同一：枚举不完备

| 当事人 | 漏掉的轴 | 后果 |
|---|---|---|
| java-port | 语义角色（残留计数漏「族内半改」） | K7#1 `Download` 目录族劈开 |
| java-port | 形态（拼接式/数组式） | v1 枚举器假 PASS |
| Lead | 语义角色细分（漏「备份内容物名族」） | 漏掉 README 族 |
| Lead | 版本轴（漏 fork 基线） | 收敛方向判错，被 java-port 纠正 |
| verifier | 产出端（正则层自证） | K6 ④ 误判为潜在缺陷 |

> **本轮真正的瓶颈不是「会不会改」，而是【枚举的完备性】。**

### 版本化教训
```yaml
K1  产出端可达性      改哪侧取决于哪侧是产出端
K2  跨版本/跨宿主契约 不改
K3  长度耦合          startsWith(lit)+substring(N) ⇒ N 必须由 lit.length() 派生
K4  派生路径三方一致  producer == consumer == bin entry
K5  契约值误替换      值被替换成品牌名 ⇒ grep 旧名找不到
K6  上游包名残留      转义形态 com\.dsh\.client ⇒ 非转义 grep 找不到
K7  同族一致性        族内取值集合基数必须为 1（按角色分列）
K8  版本轴完备性      必须三版本对照：upstream / fork 基线 / 当前工作树
```
**三条「grep 看不到的劈开」（K5/K6/K7）→ 「搜旧名 = 0」不能证明改名完整。**

---

# 🔴 统一根因：「品牌改名」与「上游覆盖」是两批独立操作

## 机制
```
新搬入的上游文件 → 套用品牌改名规则（dsha- → deepseekharness-）
老文件被上游覆盖 → 只覆盖文件，【没有重跑品牌改名】
                → 老文件里被覆盖回来的上游值【原样留着】
⇒ 跨文件契约断裂：新文件用新名判据，老文件用上游名产出。
```

## 三个实例（全部由 Lead「族值=DSHA」错误裁决放大）

### 实例 1：Download 目录族
```
fork 基线 62d8459 : Download/DeepSeekHarness × 18     Download/DSHA × 0
上游              : Download/DSHA × 19                DeepSeekHarness × 0
当前工作树        : Download/DSHA × 12  +  DeepSeekHarness × 5   ← 基数=2 ❌
$ git grep -c "Download/DSHA" 62d8459 -- app/src → 空（fork 从未用过）
```
**用户可见自相矛盾**：
```
res/values/ui_strings.xml:60  "保存位置：Download/DeepSeekHarness"   ← fork 文案（res 未被覆盖）
res/xml/update_file_paths.xml:6  path="Download/DSHA/"              ← FileProvider（上游值）
Java 实际写入                  "Download/DSHA/"                     ← 上游值
⇒ 用户按提示找不到；FileProvider 白名单与实际目录不一致。
```

### 实例 2：文件名前缀族（跨文件契约断裂，活动缺陷）
```
fork 基线 : DeepSeekHarness-backup 10 / -plugins 5 / -sessions 4 / -settings 3   DSHA-* = 0
上游      : DSHA-backup 13 / -data-v5 6 / -plugins 6 / -sessions 5 / -settings 4
当前      : DSHA-backup 13 / -data-v5 5 / -plugins 6 / -sessions 5 / -settings 4   ← 整族被翻
```
**端到端实测（用 ExternalBackupScanner:74 真实判据）**：
```
BackupManager:32  产出 "DSHA-backup-latest.tar.gz"
scanner:74 判据只认 "deepseekharness-backup-" / "…-migration-"
  "DSHA-backup-latest.tar.gz"        accepted = False ❌
  "DSHA-sessions-20260925.tar.gz"    accepted = False ❌
  "DSHA-plugins-20260925.tar.gz"     accepted = False ❌
  "DSHA-settings-20260925.tar.gz"    accepted = False ❌
  "DSHA-backup-20260925.tar.gz"      accepted = False ❌
⇒ ★ 本轮「导出 → 自动恢复」链路被改断，五种备份名全部不被认领。
```
**关键归属**：
```
$ git cat-file -e 62d8459:…/ExternalBackupScanner.java  → ❌ 基线不存在（本轮新搬入）
  上游 :74  startsWith("dsha-backup-")          ← 上游值
  当前 :74  startsWith("deepseekharness-backup-") ← 已改成 fork 值（新搬入时套了改名）
BackupManager 是老文件 → 被覆盖 → 产出端留上游值
⇒ 两端各来自一个版本
```

### 实例 3：README 说明文件族（见前文 K8 节）

## 修复原则
```
产出端/写入端 (producer) : 单值 == fork 新名（收敛）
消费端 (consumer)        : 单值 == 产出端
读取端/导入端 (reader)   : 多值 —— 认所有历史真实值（fork 新名 + 上游旧名）
```

## ★ 新增 L6b「跨端契约断言」（verifier 建议，Lead 采纳）
```
不只与基线比对，而是直接断言：accepted(produced_name) == True
  for name in [BackupManager.LATEST_BACKUP_NAME] + [BackupScope.fileNamePrefix(s)+suffix for s in scopes] + [data-v5 名]:
      assert ExternalBackupScanner.looksLikeBackupName(name) == True
⇒ 比「与基线比对」更强：不依赖基线是否可得，且能独立抓到本次缺陷。
```

## ★★ Lead 三次判错方向的记录（如实）
```
① K7#1 Download 族 → 判「回退 DSHA」           （错，verifier 拦）
② K7#2 README 族   → 判「改产出端」             （错，java-port 拦）
③ 文件名前缀族     → 批准「备份族冻结：DSHA」   （错，verifier 拦）
共同根因：用「多数派 + 是否本轮新增」做判据，
         没有坚持「三版本 + 该 token 的取值对照 + 产出端/判据端配对」。
⇒ ★ 教训：「多数派」在本轮语境下天然不可靠 —— 因为多数派正是从上游搬进来的。
   唯一可靠判据是【三版本 token 取值对照】+【K1 产出端可达性】。
⇒ ★ 「是否本轮新增」也不可靠 —— ExternalBackupScanner 是本轮新增，但它的值是 fork 值。
```

---

## K7 角色表最终版（四角色）

| 角色 | 期望基数 | 实例 |
|---|---|---|
| 产出端 producer | **1**（== fork 新名） | `BackupScope.fileNamePrefix`、`BackupManager.LATEST_BACKUP_NAME`、`DownloadsExport` |
| 消费端 consumer | **1**，且 == 产出端 | `backup-engine.py` SKIP/校验、`ExternalBackupScanner:74` |
| 读取端 importer | **多值**（历史值并集） | `LegacyBackupImporter:45/:105-106`、`BackupScope.fromFileName` |
| 扫描端 scanner | **多值**（历史目录/名字并集） ← ★本轮新增 | `ExternalBackupScanner:74/:87/:95` |

⚠️ 「多值」是角色的**固有属性**，不是「豁免」；但**只对真的只读历史数据的角色成立**。

---

## 实例 4：`ExternalBackupScanner:74` 前缀集不足（java-port 发现）

### 事实
```java
// 现（= 上游品牌改写版）
if (!lower.startsWith("deepseekharness-backup-") && !lower.startsWith("deepseekharness-migration-")) return false;
```
⇒ **只认 backup/migration，不认三个 scope 前缀。**

### 实测
```
deepseekharness-backup-2026.tar.gz      accepted=True
deepseekharness-sessions-2026.tar.gz    accepted=False ❌
deepseekharness-plugins-2026.tar.gz     accepted=False ❌
deepseekharness-settings-2026.tar.gz    accepted=False ❌
```

### 为何必须一起修（不是「新功能增强」）
```
① 该功能的语义 = 「卸载重装后找回旧备份」
   MainActivity:314-320 触发条件 = 环境未就绪 + 用户数据为空
   :330       文案「发现旧版备份：」  :23 类注释「只读扫描旧版 …tar 备份」
   ⇒ 目标用户 = 升级/重装前的用户，其部分备份名正是 -sessions-/-plugins-/-settings-
   ⇒ 判据端不认 ⇒ 该功能对其部分备份【完全失效】
② BackupScope:10-12 注释证明「不同 scope 前缀本就该被扫描器辨认」
③ 否则 L6b 断言（accepted(produced_name)==True）永久红
④ 「多弹一次提示」不构成风险：:321 declineKey + :322 prefs 去重；且用户确实有可恢复备份
```

### 裁定（Lead 批准方案乙）
```
:74 认【十个】前缀（新旧 × 五种）：backup / migration / sessions / plugins / settings
    × {deepseekharness-, dsha-}
建议用常量数组 + 循环，而非 10 个 || —— 便于 L6 枚举器解析
```

### 附带：K6 同族注释污染
`BackupScope:10-12` 类注释称「老版本按 DSHA-backup- 前缀扫描备份」，
而真相是 **fork 老版本按 `DeepSeekHarness-backup-` 扫**（基线 census 证实 DSHA-* = 0）
⇒ **注释本身也是覆盖事故的一部分，属 K6 同族问题（注释与代码不同批 ⇒ 误导未来维护者）。**
⇒ 改代码时必须同步改注释。

---

# 附录 K9 —— 用户指令驱动的「范围扩张」三连（2026-09-24 03:20~03:45）

## K9.1 指令原文与解释
| # | 用户原话 | 我对它的解释 | 是否推翻此前裁决 |
|---|---|---|---|
| 1 | 「代码里面不能出现dsha的品牌名，必须全换成DeepSeekHarness，大小写你自己决定，保存的备份文件名如果有DSha也要换成DeepSeekHarness」 | 全仓 dsha/DSHA/Dsha 品牌名清空 | ❌ 推翻「协议 token 保留」清单 |
| 1b | 追问后选择「全部改，包括协议token和URL」+「类名资源名一起改」 | 连 DSHA_* / __DSHA_*__ / data-dsha-* / DshaXxx 类名 / DshaText 资源名都改 | ❌ 推翻「Never-rename list」全表 |
| 2 | 「那个插件页面的ui就用我以前的不要有在线商城的那个的，只留插件列表和命令行安装，在线安装这个就行」 | 插件页恢复 fork 形态，去掉市场标签页 | 新增（此前未涉及） |
| 3 | 「把这个dsha.cc相关的全部删除」+「https://github.com/xliaoy/DeepSeekHarness这个是我以前的项目备份你可以看看」 | 删除 dsha.cc 依赖，改为旧项目的 GitHub Releases + deepseekharness:// scheme | ❌ 推翻 java-port Step1「dsha.cc 保留」与我自己的保留建议 |

## K9.2 ★ 本附录最重要的一条：**「用户维护的参考实现」是第 4 个裁决依据**
本次我在 dsha.cc 上犯了第 5 次方向性错误：
```
java-port 举证 dsha.cc 是【活的生产后端】（DNS 103.116.245.249 / HTTPS 200 /
  api/updates.json 返回上游真实包名 com.dsh.client + 真实签名证书 sha256）
⇒ 我据此裁决「保留 dsha.cc」（技术上完全正确）
⇒ 用户否决：「把这个dsha.cc相关的全部删除」，并给出他自己的旧项目仓库
```
**⇒ 我漏了一个维度：技术正确性 ≠ 用户意图。**
```
三个不同的问题被我混成了一个：
  Q1「dsha.cc 存在吗？」          → 存在（java-port 举证正确）
  Q2「改掉会坏功能吗？」           → 会（我也正确）
  Q3「用户想要它吗？」             → ❌ 不想要（我没问，我替用户决策了）
⇒ ★ 裁决依据的优先级应为：
  用户明确指令 > 用户维护的参考实现 > 历史版本实际写出的值 > 技术正确性 > 多数派
★ 「技术上会坏」不是拒绝用户指令的理由 —— 而是【必须把代价说清楚后由用户决定】。
```
**⇒ 落地动作：凡是用户给了参考仓库（本次 /tmp/xliaoy-ref），
   它就是该功能的【权威形态】，一切「要不要保留某功能」的争议以它为准，
   而不是以「上游怎么做 / 技术上是否更优」为准。**

## K9.3 参考实现核实结论（/tmp/xliaoy-ref = github.com/xliaoy/DeepSeekHarness）
```
dsha.cc 出现次数                       = 0          ← 决定性
更新机制  core/DshUpdater.java:48-49   = GitHub Releases
          RELEASES_API = https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=1
          RELEASES_PAGE= https://github.com/deepseek-ai/deepseek-harness/releases
深链      AndroidManifest.xml:81       scheme="deepseekharness" host="install"
插件页    无市场标签页；btnOnlineInstall(弹窗) + btnCommandInstallBtn(命令行)
          PluginFragment.java:261 「支持 GitHub 仓库、npm 包名、Release 下载链接和压缩包直链。」
i18n      strings.xml = 231 条，【无 ui_strings.xml】，布局直接用 @string/plugins_*
```

## K9.4 插件页 UI 消失的完整根因链（三重覆盖叠加）
```
① tools/localize-android-ui.py（产物生成器，:80/:90）
   把所有 R.string.X 抽成 res/values/ui_strings.xml 的混淆键 ui_m0001..ui_m0216，
   并把 res/values/strings.xml 【覆盖】⇒ fork 的 231 条只剩 6 条
   （仅存 app_name / nav_launch / nav_plugins / nav_settings / nav_terminal / accessibility_desc）
② res/layout/fragment_plugins.xml 被上游布局【完全覆盖】
   （diff 与 /tmp/dsha-up 完全相同 ⇒ fork 布局 0 残留）
   上游 = 市场+列表双标签页（market=true / btnMarket / pluginMarketCard / selectTab）
   fork = 单滚动页（pluginScroll + btnOnlineInstall + btnCommandInstallBtn + pluginList）
③ ui/PluginFragment.java 也是上游版 582 行（只做了类名替换，逻辑是 market 双标签页）
⇒ ★ 三条各自独立，任一单独出现都不会导致「UI 完全消失」，三者叠加才造成。
⇒ ★ 这是「上游覆盖 vs fork 定制」批次问题的【第 3 个实例】（前两个：backup-engine.py 的
   README 族、res 层 update_file_paths.xml 与 Java 层不一致）。
```

## K9.5 枚举口径错误：我的 437 vs java-port 的 427（我的错）
```
我的正则 [A-Za-z0-9_./\-]*(?:dsha|DSHA|Dsha)[A-Za-z0-9_./\-]* 没有词边界，
把【别的单词中间的 sha】当成品牌名：
  FluidShaderHandle / attachFluidShader   ← "Shader" 里的 sha
  handshake / xxxHandshake                ← "handshake" 里的 sha
  hasDshAuth / exchangeDshAuthCookie      ← "Dsh"（D-s-h）不是 "Dsha"
⇒ 40 种 / 100 处伪阳性
★ java-port 的规则正确：标识符按 CamelCase/下划线切词，只保留【切出独立词 dsha】的 token。
★ 这与我在 §K8 记录的错误同源：**枚举器的正则本身也是需要被验证的对象**。
★ 落地规则：任何「关键词扫描」必须同时给出【伪阳性白名单 + 未被改动的负对照断言】。
```

## K9.6 java-port 的映射表自检（值得作为标准流程）
```
✅ 将替换  399 种 / 1273 处
⛔ 保留     28 种 /   61 处（dsha.cc 21 种 + rootfs 2 种 + PTY 5 种）
   未匹配    0 种   ← 「没有不知道该怎么改的 token」
   自检 A：替换结果中仍含 dsha 的 token = 0 种
   自检 B：误伤保留名单 = 0 种
★ 这两条自检是【映射表驱动替换】的必要闸门：
  A 防漏改、B 防误改。缺任一条都会产生新的劈开。
★ 后经用户指令，保留名单收缩为 rootfs 2 + PTY 5 = 7 种。
```

## K9.7 深链 scheme 作为跨端契约
```
dsha://install           → 分享出去的旧链接全部失效（用户接受，改为 deepseekharness://install）
⚠️ 这属于 K7 的「消费端」性质：外部网页/分享链接是【仓库外】的消费端，
   改了仓库内所有引用也无法覆盖它们 ⇒ 属于「有意打破的契约」，必须登记而非静默修改。
★ 同 B 组 rootfs 路径 / C 组 PTY 协议一样，都是「产出端在仓库外 ⇒ 禁改」，
  但本处用户【明确要求改】，所以例外成立 —— 前提是【用户知情】。
```

---

# 附录 K10 —— 第 7 与第 8 个枚举轴（2026-09-24 04:00~04:30）

## K10.1 ★ 轴 7：**大小写敏感性** / **token 边界劈开**（java-port 自查发现，Lead 与 verifier 均先误判根因）
```
【现象】dsha.cc 被改成 DeepSeekHarness.cc，17 文件 / 30+ 处
  · UpdateEngine.java:38      FEED = "https://DeepSeekHarness.cc/api/updates.json"  ← 不存在的域名
  · AndroidManifest.xml:106   android:scheme="DeepSeekHarness"  ← 深链【大小写敏感】⇒ 完全失效
  · PluginInstallLink / CommunityActivity / patch json / 5 个测试文件 / 3 个 androidTest
【verifier 的初判】「把品牌名大小写不敏感的假设套到域名上」 ← 现象对，根因错
【Lead 的初判】接受 verifier 的诊断 ← 也没查证
【java-port 的真因】★ 更精确：
  映射表里同时存在两个 token：
      'dsha.cc'       → 被 EXCL 正则 r'dsha\.cc' 正确挡住 ✅
      'https://dsha'  → ❌ 漏网（它【不含 'dsha.cc' 子串】，EXCL 不匹配）
  ⇒ 'https://dsha' 被当普通品牌 token 替换 → 'https://DeepSeekHarness'
  ⇒ '.cc' 属另一个 token，原地保留
  ⇒ 拼接 = 'https://DeepSeekHarness.cc'
  ★ 这是【两个 token 边界劈开】的产物，不是任何单一 token 的替换结果。
                  也不是「大小写不敏感」——替换器从未忽略大小写。
【规则】URL / 域名 / scheme / 文件路径 是【有边界语义的整体】，禁止 token 化。
       排除正则必须与枚举器的【切分口径一致】—— 一个匹配完整域名，
       一个产出被切碎的前缀 ⇒ 两者口径不一致必然漏。
       ★ 与 K4 同源：排除（EXCL）与替换（MAP）是两套正则，两套正则都要与被测对象对齐。
【加固】URL/域名/scheme/路径 → 全小写 deepseekharness，整体匹配整体替换
        常量/token → SCREAMING_SNAKE ；类名/资源名 → PascalCase ；DOM/CSS → kebab-case
        断言：替换后不得出现 DeepSeekHarness.cc；Manifest scheme 必须全小写
```
**★ 方法论收获**：现象对 ≠ 根因对。verifier 与 Lead 都停在「现象解释」就下了结论，
java-port 回看了自己的映射表才找到真因。**「根因必须能被复现验证，而不是听起来合理」。**

## K10.2 ★★ 轴 8：**测试夹具与产品一起错** ⇒ 单测全绿但真机坏（verifier 提出）
```
【机制】同一批替换同时改了【产品代码】与【测试夹具】。
        夹具与产品【同步错】⇒ 断言仍然通过 ⇒ 静默。
【实例】UpdatePolicyTest / PluginInstallLinkTest 的 URL 夹具被一起改成 DeepSeekHarness.cc
【为什么 L6b 抓不到】L6b 的两端输入【都来自源码】。
        源码本身错了 ⇒ 契约断言照样绿。
        ⇒ ★ L6b 的能力边界被这次事件明确了：它能抓【跨端不一致】，抓不到【两端一致地错】。
【唯一能抓的做法】引入【外部真值】：
        · 域名是否真的解析（DNS/HTTP）
        · scheme 是否与旧项目/基线一致（外部参照物）
        · 是否使用了 .invalid 这类【明确不会误认为真】的占位域
【本轮采用的好样板】OptimizationInstrumentation.java:67
        "https://deepseekharness-test.invalid/owned.apk"   ← 一眼看出是测试占位
【规则】测试夹具【禁止】使用产品可能真实使用的域名/IP。
        一律用 RFC 2606 保留域：.invalid / .example / .test
        ⇒ 这样「夹具被误改」时至少还能看出它是个测试值。
        ★ 与 K6 ④「期望形状自证」同根因：输入来源必须可信。
        这次是【输入来源被污染】，比 K6 ④ 更隐蔽——K6 ④ 是自造输入，这次是真实源码被改错。
```

## K10.3 ★ 处置纪律：**先还原真值，再执行删除**（java-port 提出，Lead 批准）
```
【事故后的两条路】
  ❌ 把 dsha.cc 直接改成 deepseekharness.cc —— 等于【发明一个不存在的域名把错误藏起来】
  ✅ 先把被污染处【还原为真值 dsha.cc】，再按用户裁决【删除】
【为什么后者对】「删除」这一步才是可审计的：审计者能对比「删除前=真值、删除后=不存在」。
        前者则把一个错误替换成另一个错误，且错误被新名字掩盖，审计者无从判断。
【代价】java-port 选择不回滚 17 文件（回滚会连带丢弃已确认正确的 399 种 token 替换），
        而是【精确界定受损面】后逐条验证归零。
        ⇒ 修复断言：DeepSeekHarness.cc 残留（大小写不敏感）= 0 ✅
                     Manifest android:scheme 全小写 ✅
                     测试夹具 .invalid ✅
                     产品位置已还原为真值（待删）✅
★ 规则：**事故修复要「界定受损面 + 逐条断言归零」，而不是「整片回滚」。
        回滚范围越界 = 用新风险换旧风险。**
```

## K10.4 Lead 的第 6 次方向性错误（自我记录）
```
【错误】我在下发「全仓改名」指令时，给了类名/资源名/协议 token/DOM 的大小写方案，
        但【漏了 URL/域名/scheme/文件路径这一类 ⇒ 必须全小写】。
⇒ 指令不完备 ⇒ java-port 按不完整规则执行 ⇒ 产生事故。
【性质】这属于「规则给了一半」——比给错规则更隐蔽，因为执行者无从发现缺失。
【穷举轴校正】我之前把「大小写」只理解成【命名风格】（Pascal/camel/kebab/SCREAMING），
        漏了「大小写本身承载语义」的情况：
          域名 DNS 不区分大小写（但书写惯例全小写）
          Android scheme 【区分大小写】
          Linux 文件路径【区分大小写】
          HTTP header 不区分、URL path 区分
⇒ ★ 轴 7 的准确表述：「**标识符的大小写是否承载语义**」，
        而不是「用哪种命名风格」。凡承载语义者，替换必须【保留原有形态】或【整体重写】。
```
**累计漏轴统计（8 次）**：
| # | 漏轴 | 发现者 | 实例 |
|---|---|---|---|
| 1 | 语义角色（半改） | java-port | K7#1 Download 目录族 |
| 2 | 形式（字符串形态） | java-port | `:43` 拼接 / `:95` 数组 |
| 3 | 语义角色粒度 | java-port | `:74` 前缀集不全 |
| 4 | 版本轴（两版本对比） | verifier→Lead | 备份族被误判「冻结」 |
| 5 | 版本轴 token 值对比 | verifier→Lead | K8 三版本对照 |
| 6 | 排除正则与枚举口径不一致 | Lead | 437 vs 427 伪阳性 |
| 7 | **大小写承载语义 / token 边界劈开** | java-port | DeepSeekHarness.cc |
| 8 | **测试夹具与产品同步错** | verifier | 夹具被同批替换 |

---

# 附录 K11 —— 外部数据缺陷的处置：先找更权威的来源，再考虑降级（2026-09-24 04:20）

## K11.1 案例：GitHub 最新 release 缺 `.sha256` 资产
```
【发现者】verifier（其 §②，独立实测）
   tag=v2026.09.22   assets=2  ['app-low-release.apk','app-standard-release.apk']  ← 无 .sha256
   tag=v2026.09.18   assets=4  ✅
   tag=v2026.09.16   assets=4  ✅
   tag=v1.0.9        assets=4  ✅
【verifier 的初判】「外部数据缺陷 ⇒ 产品必须容错或降级：
                  要么回退到『无 sha256 则不可选』，要么『无 hash 时降级为仅 HTTPS 校验』」
【Lead 的核查】★ 找到了更权威的来源，不需要降级：
   GitHub Releases API 的每个 asset 自带 digest 字段：
     app-low-release.apk       digest: sha256:371f5420d9fdf304fd27fe73833190f26c6df070956eb7b838c1a86fc99af60c
     app-standard-release.apk  digest: sha256:84130e82ada95afde7b73ba1451e52673c5b85cd2baf3d1ab2e2e32047dfa309
   ★ 交叉验证（决定性）：下载 v2026.09.18 的 .sha256 资产，内容 = 06d0829321e2c75de94c5f7d60835c67de8ae1a19cd80aa6d1171c687533d855
     该 release 的 app-standard-release.apk API digest = sha256:06d0829321e2c75de94c5f7d60835c67de8ae1a19cd80aa6d1171c687533d855
   ⇒ 两者完全一致 ⇒ digest 是 sha256 的权威来源
【最终方案】sha256 来源链：asset.digest（主）→ <apk>.sha256 资产（回退）→ 都没有才拒绝安装
   ⇒ v2026.09.22 走 digest ⇒ 可校验 ✅
   ⇒ 不改用户发布流程（不必补传资产）✅
   ⇒ 永不出现「跳过完整性校验」的路径 ✅
```

## K11.2 ★ 通则
```
**遇到「外部数据不完整」时，先问「有没有另一个更权威的来源」，
  再考虑「降级/容错」。降级会引入弱化安全的路径，是最后手段。**

推论 1：降级路径（如「无 hash 就只校验 HTTPS」）是【安全弱化】，
        一旦存在就永远是攻击面。能避免就避免。
推论 2：判定「哪个来源更权威」要用【交叉验证】：两个独立来源给出同一个值 ⇒ 可信。
        本例中 .sha256 资产（人工上传的文本）与 API digest（平台计算）
        互相印证 ⇒ 可确认 digest 语义正确。
推论 3：跨来源一致性检查本身就是一个【闸门】。建议在发布流程里加：
        上传 .sha256 资产后，比对它与 API digest ⇒ 不一致则报警
        （这能在源头抓住「资产传错/传漏」）
```

## K11.3 Lead 的第 7 次方向性纠正（对 verifier 的）
```
【verifier 的结论】「最新版永远无法安装」= 缺陷（后果判断对，但解法方向错了）
【Lead 的纠正】后果判断成立，但不必降级 ⇒ 换权威来源即可
【性质】这不是 verifier 的错 —— 它正确地报出了现象与后果，
        只是「解法」需要更广的搜索。
★ 记录模式：**「现象 + 后果」通常比「解法」更容易判对。
  团队成员报现象与后果时应鼓励，Lead 负责找解法。**
        —— 本轮 verifier 报现象（缺 sha256）、Lead 找解法（digest），是好的分工。
```

## K11.4 版本/口径一致性纪律（verifier 提出，Lead 采纳）
```
【问题】同一个指标三方给出三个数：
   Lead 数 .invalid → 7 文件；java-port 说 9 文件/19 处；verifier 数到 17 文件/42 处
【verifier 的诊断，正确】「树在变 ⇒ 这个数字不可作为证据，除非固定 commit + 固定口径」
【规则】报告引用任何计数，必须同时给出：
         ① 口径（文件数 / 出现次数 / URL 主机名 …）
         ② 时间戳或 commit
         ③ 文件清单
        ★ 否则【宁可不给数，也不给错数】。
【禁例】「测试夹具 19 处 .invalid」—— 19 处还是 7 文件？口径未定义 ⇒ 无法复核。
```

## K11.5 豁免/分类的粒度（verifier 提出，Lead 采纳，与 §7.6 并列）
```
**豁免的粒度必须与缺陷的粒度同阶。**
  反例：L6d 第一版用【行级豁免】放过 .invalid 测试域名。
  OptimizationInstrumentation.java:67 同一行【同时】含：
      https://deepseekharness-test.invalid/owned.apk   ← 合法占位（RFC2606）
      https://DeepSeekHarness.cc/download/             ← 真实缺陷
  ⇒ 行级豁免会【漏报该行的真缺陷】
  ⇒ 正确粒度 = 【命中片段级】豁免（逐个 URL 判，不按行判）
推论：**分类的粒度也必须与【原因】同阶，不能按【位置】归并。**
  同一个位置可能同时是 A 类（改名遗漏）与 B 类（待实施改造）。
  ⇒ 报告必须按【原因】分类：类 A 改名残留 / 类 B 待实施 / 类 C 有意保留 / 类 D 外部数据
```

## K11.6 测试夹具必须用 RFC 2606 保留域（轴 8 的加固）
```
【事故】产品代码与测试夹具被【同一批替换】改成 DeepSeekHarness.cc
        ⇒ 夹具与产品同步错 ⇒ 单测全绿但真机坏。
【加固】测试夹具禁止使用产品可能真实使用的域名/IP。
        一律用 RFC 2606 保留域：.invalid / .example / .test
        好样板：OptimizationInstrumentation.java:67 "https://deepseekharness-test.invalid/owned.apk"
【注意】安全负对照用例【故意】使用的域（github.com.evil.test / evil.example）
        不是占位符，必须单独分类，不能与普通占位混算。
```

## K11.7 外部数据的品牌名不算本仓库残留（新）
```
用户仓库的 release name 形如 "DSHA v2026.09.22"。
⇒ ★ 这是【用户 GitHub 仓库里的历史文本】，不是本仓库的代码产物。
  ⇒ 不得计入「本仓库品牌残留」断言。
  ⇒ 同理：release tag、release body、历史 APK 资产名 都属外部数据。
★ 规则：**品牌残留断言的适用范围 = 本仓库能构建出的产物**（源码 + 资源 +
  打包进 APK 的文件 + 发布工具的输出）。外部平台上的元数据不属于此范围，
  但可以在报告里另列一节「外部数据观察」。
```

---

# 附录 K12 —— 轴 9/10：规则作用域 与 分类可证性（2026-09-24 04:40）

## K12.1 ★ 轴 9：**规则的作用域**（同一个 token 在不同站点适用不同规则 ⇒ 分裂）
```
【实例】usr/local/share/ 运行时路径
  bin 真值（tar -tzf dsh-runtime.bin）: usr/local/share/deepseekharness/dsh-runtime.version  ← 全小写
  产出端 tools/build-dsh-runtime.py:620 / prepare-standard-assets.py:75                      ← 小写
  消费端 Java 侧 8+ 处（ProotBootstrap:208 / ManagedRuntimeLayout:15-18 /
    RuntimeTools:16,17,129,249,250 / DiagnosticRepository:97）+ shell + python              ← 大驼峰 ❌
【后果】ProotBootstrap.java:204-209 的解压过滤器用 name.equals(".../DeepSeekHarness/...")
  ⇒ bin 条目名是小写 ⇒ equals 永不成立 ⇒ dsh-runtime.version 【不会被解压】
  ⇒ 连锁：managed-assets-v2 标记 / ca-certificates.crt / dns-compat.cjs 路径全部失效
  ⇒ ★ 装机后才炸的静默故障（单测可能全绿，因为测试用自己的常量而非 bin 真值）
【真因】映射表按【站点】各自套规则：
  tools/*.py 走「路径 → 小写」；Java 走「品牌 → PascalCase」⇒ 同一个语义单元被两种规则劈开
★ 与 K10.1（token 边界劈开）同源的两个表现：**规则应用未按语义边界统一**。
【判据 I1】同 token 形态一致：任意 token 的所有站点必须用同一大小写规则。
【判据 I2】路径按【是否面向用户显示】定形态：
     面向用户显示的路径（Download/、导出目录）→ 品牌显示形态 PascalCase
     rootfs / 系统内部路径（/usr /root /etc /var /data）→ 全小写
  ★ 注意：Download/DeepSeekHarness 保持 PascalCase 是【正确的】，
    因为它是用户可见目录；误「修」成小写会弄丢用户历史备份的可找回性。
  ⇒ 缺陷 1 之所以错，不是因为「用了 PascalCase」，而是因为
    **它在 rootfs 内部路径上用了显示形态，且与产出端不一致**。
【修正】统一为全小写 deepseekharness（K1：以产出端为准；bin 是真值）
```

## K12.2 ★ 轴 10：**分类的理由必须可证**（verifier 发现，性质为元层面错误）
```
【发现】KEEP 清单第 5 行：
  SSL_CERT_FILE:-/usr/local/share/dsha/ca-certificates.crt
  理由：「K2 rootfs 镜像内已烘焙目录（含 CA 证书），产出端不在本仓库；
         改 App 侧字符串将找不到该文件」
【verifier 实测，Lead 独立复现】该理由的【事实前提不存在】：
  · 5 个 bin 里 share/dsha = 0 次（dsh-runtime / offline-rootfs / pnpm-runtime /
    python-support / ubuntu-tools 全部为 0）
  · 基线 62d8459 的产出端 tools/build-dsh-runtime.py:172 就已写【小写 deepseekharness】
  ⇒ 「产出端不在本仓库」与事实相反（产出端就在 tools/）
  ⇒ 真正「找不到文件」的恰恰是【保留 dsha 这个名字】
```

## K12.3 ★★ 恒等式只保证**完备性**，不保证**正确性** —— 分类操纵风险
```
恒等式 ORIGINAL == EXCLUDED ∪ PRESERVED ∪ REPLACED ∪ DELETED
  ⇒ 它证明【分类完备、无遗漏】。
  ⇒ ★ 但它【不证明】分类正确：一条漏改只要被归入 PRESERVED，恒等式照样成立。
  ⇒ ★★ 这就是【分类操纵】：把「漏改」登记成「有意保留」，
     于是「改名完整性」的结论在形式上成立、实质上不成立。
【防御】对 PRESERVED / EXCLUDED 的每一项，
  断言其【理由中陈述的事实前提】可被【产物】验证。
  · 可证例：「声称 bin 内有 X」⇒ tar -tzf 确实有 X
  · 可证例：「声称 .so 内token」⇒ strings .so | grep 命中
  · 不可证例：「声称无 NDK 不能重编」⇒ 这是**能力声明**，非事实陈述
    ⇒ 必须诚实标注【不可证】，不纳入断言，不得为凑覆盖率而编造断言。
【落实】新增断言 L6g「保留理由的事实前提可证」+ 对 KEEP 全部 16 条重新逐条核对。
```

## K12.4 三个「元层面」失效模式的统一模型
```
轴 8  测试夹具与产品一起错    → 测试的【输入】被污染
轴 9  规则作用域不一致        → 规则的【应用边界】被误划
轴 10 分类理由与事实相反      → 验证的【元数据】被污染
⇒ 共同模式：**「被验证对象的定义」本身也可能是错的。**
  断言不仅能证明「代码对不对」，还必须能证明「验证依据本身可不可信」。
推论：任何「完整性/一致性」结论，必须附带【其依据的可证性】说明。
     否则结论只在形式上成立。
```

## K12.5 回归网 vs 一次性检查（Lead 要求）
```
本轮所有新增断言一律设计为【回归网】而非一次性检查：
  L6b 跨端契约（产出端常量 → 判据端正则，两端来自源码）
  L6c 兼容契约三项（launcherContract / baseVersion / bridgeProtocol）
  L6d 外部端点正确性（dsha.cc 归零 / scheme 小写 / FEED 可达 / digest 与回退）
  L6f bin 真值 ↔ 代码声明对账（单向 + share 目录双向）
  L6g 保留理由的事实前提可证
⇒ 目标：将来的改名/重构能【自动报警】，而不是只服务本轮验收。
```

## K12.6 替换器必须校验词边界（轴 10 的姊妹缺陷，Lead 发现）
```
【现象】品牌名被插进英文单词【内部】，破坏 44 处：
    handler                     → hanDeepSeekHarnesske            (8 处)
    inputfirst                  → DeepSeekHarnessinputfirst
    useDshaPickedSession        → useDeepSeekHarnessPickedSession
    ..._is_not_a_backend_handler → ..._is_not_a_backend_hanDeepSeekHarnesske
【危害】比 K10.1（DeepSeekHarness.cc）更严重：后者值错但结构完好；
        本类【破坏结构】——字符串判断永不匹配、变量名与引用失配、
        测试的【期望值与正则同时被破坏】⇒ 断言可能恒真 ⇒ 静默失效。
【真因】子串替换未校验词边界（与 Lead 第 6 次错误 437 vs 427 同源：
        当时【多报】，此时【多改】）。
        ★ 教训：**词边界既是统计口径问题，也是替换安全问题。**
【规则】token 替换若其前后紧邻 [A-Za-z0-9_]，必须拒绝替换。
【新守恒量】★ 替换前后全仓 [A-Za-z]{4,} 的【英文词频】应几乎不变
        （只有品牌相关词会变）。这是能抓住「词内插入」本类缺陷的守恒量。
【分类处置】不能一刀切回滚，须分三类：
        类 X 品牌名插在英文单词中间且原词是常见英文词 ⇒ 回滚
        类 Y 原标识符以 dsha 为【独立前缀词】⇒ 保留（如 onDshaSessionOpen → onDeepSeekHarnessSessionOpen）
        类 Z 期望值/判据 ⇒ 必须找【产出端】确认（如 InputInsetsAudit 的匹配器）
```

## K12.7 累积漏轴统计（10 次）
| # | 漏轴 | 发现者 | 实例 |
|---|---|---|---|
| 1 | 语义角色（半改） | java-port | K7#1 Download 目录族 |
| 2 | 形式（字符串形态） | java-port | `:43` 拼接 / `:95` 数组 |
| 3 | 语义角色粒度 | java-port | `:74` 前缀集不全 |
| 4 | 版本轴（两版本对比） | verifier→Lead | 备份族被误判「冻结」 |
| 5 | 版本轴 token 值对比 | verifier→Lead | K8 三版本对照 |
| 6 | 排除正则与枚举口径不一致（多报） | Lead | 437 vs 427 伪阳性 |
| 7 | 大小写承载语义 / token 边界劈开 | java-port | DeepSeekHarness.cc |
| 8 | 测试夹具与产品同步错 | verifier | 夹具被同批替换 |
| 9 | **规则的作用域** | Lead | share/ 路径大小写分裂 |
| 10 | **分类可证性** + **词边界替换（多改）** | verifier / Lead | KEEP:5 理由伪造 / handler 被插碎 |

**全队错误归属**：Lead 5 次（轴 6/7/9 + 轴 7 规则给一半 + 前缀集遗漏）、
java-port 1 次（轴 7，已自行定位真因）、verifier 2 次（轴 4/5 版本轴）、
共同根因：**枚举轴不完备** + **验证依据本身未被验证**。

---

# 附录 K13 —— 词内插入缺陷的真因与「口径一致性」不变量（2026-09-24 04:55）

## K13.1 ★★ 真因（java-port 独立定位，Lead 复现，逐字符一致）
```
>>> 'dsha' in 'handshake'
True
>>> 'handshake'.replace('dsha', 'DeepSeekHarness')
'hanDeepSeekHarnesske'          ← 与实测破坏值逐字符一致
>>> 'handler'.replace('dsha', 'DeepSeekHarness')
'handler'                       ← 不变
⇒ 真因：**裸品牌词 'dsha' 做【无词边界的全局字面量替换】，命中 'handshake'。**
⇒ 一次破坏 22 处（类 X），另有 6 处大小写变体（Handshake / HANDSHAKE）。
```
**★ 机制模型：`shake` 无 dsha；`handshake` = `han` + `dsha` + `ke`。**
⇒ 品牌词恰好跨越英文单词的内部音节边界。

## K13.2 ★★★ 新不变量 I3'：**口径一致性**（java-port 提出的精确化）
```
【原始表述 I3（Lead 提，过粗）】token 替换若前后紧邻 [A-Za-z0-9_] 则拒绝。
  ❌ 反例：'onDshaSessionOpen' 前面紧邻 'n' ⇒ 字面 I3 会拒绝，但它【合法】。
【精确表述 I3'（java-port）】
  把标识符按 【CamelCase 边界 + 下划线 + 点号 + 连字符 + 斜杠】 切词，
  仅当【某个切片整体等于 dsha/DSHA/Dsha】时才替换。
    'handshake'         → ['handshake']                    ⇒ 无 ⇒ 不替换 ✅
    'onDshaSessionOpen' → ['on','Dsha','Session','Open']   ⇒ 有 ⇒ 替换   ✅
    'dshaPicked'        → ['dsha','Picked']                ⇒ 有 ⇒ 替换   ✅
【上升为通用不变量】
  凡是「检测/统计」与「执行/修改」成对出现的环节，
  两者【必须共享同一实现】。
  ⇒ 本实例：统计时用了切词逻辑，执行时退化成裸 s.replace() ⇒ 两边口径不一致。
  ⇒ 同构实例（verifier）：判断「读角色」的逻辑 vs 实际「豁免」的逻辑，也曾不一致。
⇒ ★ java-port 自我诊断：「这与我 K10.1 是同一根因的第 3 次复发 ——
   『统计口径』与『执行口径』不一致。」
```
**★ 这正是「同一根因在不同环节反复复发」的典型。防御必须是结构性的（共享实现），
而不是每次靠人工记得「两处要保持一致」。**

## K13.3 ★ Lead 第 6 次方向性错误 —— 反推变换规则时用了非权威输入
```
【错误】Lead 据 grep 输出目视推断原词是 'handler'，算出被替换片段 'dler'，
        查映射表无命中，遂声称「真因不是子串匹配」——【方向完全错】。
【真值】原词是 'handshake'（git show HEAD:app/src/main/assets/adb-pair.py 可证）。
【方法正确但数据错】Lead 的「公共前缀/后缀 + 查表」方法本身是对的
        （公共前缀 'han' 算对了），错在【输入词是我拼凑的】。
★ 通用纪律：
  **反推一个变换的规则时，原始值必须取自权威源（git / 产物 / 原始快照），
    绝不能取自【被变换后的文件】里目视拼凑的形态。**
  ⇒ 这是「判据端与产出端都必须来自被测源」的同一纪律，Lead 犯了自己要求别人不犯的错。
  ⇒ 心理机制：看到 'hanDeepSeekHarnesske' 自然联想到最可能的英文词 'handler'，
    即【用「最可能的补全」填补了「未验证的事实」】—— 是「期望形状自证」的变体。

## K13.4 ★ 同一行内也可能发生规则分裂（InputInsetsAudit.java:111）
```
  matches("DEEPSEEK_HARNESSinputfirst(second)?|DeepSeekHarnessinputfirst(DeepSeekHarnessinputsecond)?")
⇒ 同一行内【同时】出现两种大小写形态 ⇒ 大小写规则在【同一行内各管一段】
⇒ ★ 与 share/ 路径分裂（K12.1）同源。
⇒ 推论：**「按行检查」不足以发现本类缺陷** —— 与 verifier 的
   「豁免的粒度必须与缺陷的粒度同阶」是同一原则的两个方向：
     · 豁免过粗（行级）⇒ 漏掉行内缺陷
     · 检查过粗（行级）⇒ 漏掉行内分裂
```

## K13.5 ★ patch 类操作的「静默跳过」缺陷族（java-port 主动加断言）
```
【现象】tools/build-dsh-runtime.py 用 text.replace(target, new) 对 dsh 运行时源码打补丁。
        若 target 在运行时源码里【找不到】，replace 会【静默不生效】，不报错。
【java-port 核实】wrapDeepSeekHarnessLegacyStage 这一处是【正确的】：
        target 就是运行时里 wrapDshaLegacyStage 的【定义行】，patch 后定义与调用一起改名 ⇒ 自洽。
【★ 升级为常设断言】对 build-dsh-runtime.py 里【所有】 text.replace：
        · 每个 replace 的 target 必须在运行时源码里出现（命中率 = 100%）
        · 替换后新文本必须出现（证明真的改了）
        命中率 < 100% 即报警。
⇒ 属于「静默跳过 / 静默不生效」缺陷族的通用防御。
   同类：grep 旧名=0 不证明改完；patch 未命中不报错；
        过滤器不匹配则不提取（K7/K12.1 的 ProotBootstrap 实例）。
⇒ ★ 通用模式：**「应当发生但未发生」的操作，默认【不报错】。
   因此我们必须在「应当发生」的位置放【正向存在性断言】，而不是事后 grep 负面。**
```

## K13.6 EXCLUDED 清单也可能存在「分类操纵」（Lead 追加要求）
```
EXCLUDED 60 条的理由分两类：
  · 词内片段类 18 条：「切词后无独立 dsha 词」 ⇒ 关于字符串的事实，可证
  · dsh 类 42 条（DshAuthLog / DshAuthSession / DshAuthUrl ...）：
    理由「dsh 是另一个产品/CLI 名（无 a），不在本次 dsha 改名范围内」
⇒ ⚠️ 第二条存在粉饰风险：若 'dsh' 其实只是本产品名的截断（而非独立产品），
   则这 42 条是【漏改被登记成不该改】⇒ 与 KEEP:5 同类。
⇒ 要求：抽查 ≥10 条，用「该 token 切词后确实不含 dsha 切片」验证，
   并独立判断 'dsh' 是否确为独立产品名。
```

## K13.7 累积漏轴统计（10 次）与错误归属
| # | 漏轴 / 错误类 | 发现者 | 实例 |
|---|---|---|---|
| 1 | 语义角色（半改） | java-port | K7#1 Download 目录族 |
| 2 | 形式（字符串形态） | java-port | `:43` 拼接 / `:95` 数组 |
| 3 | 语义角色粒度 | java-port | `:74` 前缀集不全 |
| 4 | 版本轴（两版本对比） | verifier→Lead | 备份族被误判「冻结」 |
| 5 | 版本轴 token 值对比 | verifier→Lead | K8 三版本对照 |
| 6 | 排除正则与枚举口径不一致（多报） | Lead | 437 vs 427 伪阳性 |
| 7 | 大小写承载语义 / token 边界劈开 | java-port | DeepSeekHarness.cc |
| 8 | 测试夹具与产品同步错 | verifier | 夹具被同批替换 |
| 9 | 规则的作用域 | Lead | share/ 路径大小写分裂 |
| 10 | 分类可证性 | verifier | KEEP:5 理由伪造 |
| 10b | **口径一致性（统计 vs 执行）** | java-port | `'dsha' in 'handshake'` ⇒ 22 处破坏 |

**错误归属**：Lead 6 次（轴 6/7/9 + 轴 7 规则给一半 + 前缀集遗漏 + K13.3 反推用错输入）、
java-port 2 次（轴 7、10b，均自行定位真因）、verifier 2 次（轴 4/5，自行撤回）。
**共同根因**：① 枚举轴不完备；② **验证/执行依据本身未被验证**。

---

# 附录 K14 —— 权威参照纪律 与 检测器自身的可证性（2026-09-24 05:20）

## K14.1 ★★ 通用纪律：关于「某值是否被改坏」的判断，必须有权威参照
```
【Lead 第 7 次方向性错误】
  Lead 只看当前树的畸形形态（InputInsetsAudit.java:111 同一行含两种大小写），
  就断定「期望值与正则同时被破坏」—— 但【没有拿上游对照】。
【真值】diff 上游 /tmp/dsha-up 与当前树 → 【逐字符相同】
  ⇒ `DSHAinputfirst` 是【上游自己的命名】（uppercase DSHA + lowercase inputfirst），
     不是本轮替换产物 ⇒ 不该改。
【★ 纪律】判定「是否为改名破坏」必须【三版本对照】：上游 / fork基线 / 当前工作树。
        只看当前树会误判 —— 这正是 K8（版本轴）的必然推论。
【★ K8 的关键例外】当某 token 在【上游就是那个形态】时，它就不是破坏。
【与 K13.3 同源】K13.3 是「反推变换规则时用了非权威输入」（原词猜成 handler，真值是 handshake），
  本条是「判定是否被改坏时缺少权威参照」——
  ⇒ 两者的共同病根：**缺少权威参照就下结论。**
【合并纪律】
  「关于『某值是否被改坏』的判断，必须至少有一个权威参照：
    git 历史 / 上游源码 / 构建产物。仅凭当前树的形态做判断，必然误判。」
```
**★ 交叉验证的正面实例：** java-port 靠「找产出端（本文件自产自消）」推出 `dshainputfirst`；
verifier 靠「对照上游真值」证明那是原文。两条独立路径同一结论 ⇒ 可信度更高。

## K14.2 ★★ 检测器/闸门自身的可证性 —— 必须报告漏报率
```
【verifier 的方法论（本轮最高质量工作之一）】
  ① 【用注入负对照验证检测器本身】
      注入 3 处人造破坏 → 检出 3/3；
      并诚实报告【第一版只检出 2/3】（漏了 hanDeepSeekHarnesske，因第一版靠词表）。
      ⇒ 据此把「词表判据」改为「结构判据」后才有效。
      若不注入负对照，就会拿一个【漏报 33%】的检测器去给别人背书。
  ② 【检测器定位为筛查工具，不是判决工具】
      命中 → 必须用上游真值复核才能定罪
      （FactoryResetTest 的 removesOnlyLegacyDeepSeekHarnessDataTree 经核对上游
        确认为【合法改名】，不是破坏）
      ⇒ 避免「白名单/检测器掩盖真破坏」的陷阱。
【规则】
  任何自动闸门必须①注入负对照证明其有效 ②报告漏报率
  ③明确其输出是「候选」而非「判决」。
  否则它给出的是**虚假的安全感**。
【本轮累计】「闸门自身的正确性必须单独验证」已是第 5 次出现。
```

## K14.3 「靠 equalsIgnoreCase 掩盖的大小写不一致」—— 新型潜在雷
```
PluginInstallLink.java:23  "DeepSeekHarness".equalsIgnoreCase(uri.getScheme())
Manifest                   android:scheme="deepseekharness"
   ⇒ 两者大小写不同，但因用了 equalsIgnoreCase ⇒ 【当前侥幸不坏】
   ⇒ ⚠️ 这是【靠 API 语义掩盖的不一致】：
      若将来有人把 equalsIgnoreCase 改成 equals（"更严格"），就会静默失效。
   ⇒ 归类：类 A（改名残留）的变体，或单列为【潜在雷】。
   ⇒ ★ 通用教训：**「当前能跑」不能作为「一致」的证据。**
     当一个不一致被某个 API 的宽容语义掩盖时，它仍是不一致，
     必须在改名时消除，否则它会在未来的某次「收紧」中爆炸。
   ⇒ 与 K12.1（share/ 路径分裂）的区别：
     那次是【硬不一致】（Linux 路径区分大小写，直接坏）；
     这次是【软不一致】（equalsIgnoreCase 容忍）⇒ 潜伏期更长。
```

## K14.4 ★ 架构一致性核查：删除外部后端后是否留下【悬空消费端】
```
【背景】我们的架构：插件安装由【网页跳转 dsha.cc 深链】驱动。
        ref 的架构：由【本应用深链】驱动（无外部后端）。
        用户已裁定删除 dsha.cc ⇒ 我们的架构必须【收敛到 ref 的形态】。
【ref 的权威实现（/tmp/xliaoy-ref/.../PluginInstallLink.java）】
  · 只有 custom 分支："deepseekharness".equalsIgnoreCase(scheme) && "install"(host)
  · 【没有】management() 方法，【没有】web 分支，【没有】dsha.cc
  · 异常消息："安装链接无效，请在插件页粘贴有效的下载链接"（无 dsha.cc 引用）
  · 类注释："接收本应用深链传入的下载请求"（无「网页」字样）
【我们要删的（当前树独有）】
  · management(String) 方法（白名单 dsha.cc/app/plugins）
  · web 分支（https + host==dsha.cc + /install）
  · 注释里的「网页」字样
  · 异常消息里的 dsha.cc 引用
【★ 悬空消费端风险（Lead 提出，verifier 核查中）】
  删除 dsha.cc 后：
    · 若网页侧（plugin-manager-navigation-patch.json）不再产出 dsha.cc 链接，
      而 Java 侧仍等待它 ⇒ **断链**
    · 是否有代码假设「安装必须从网页发起」？
    · native 注入 window.__DEEPSEEK_HARNESS_NATIVE_PLUGINS__ 的消费端在哪？
  ⇒ 判据（verifier 已采纳）：**跨边界 = 存在【按值匹配】的消费代码**。
     用此判据系统性排查「dsha.cc 删除后是否留下悬空消费端」。
  ⇒ ★ 怀疑这是本项目最后一个隐藏的硬缺陷族。
```

## K14.5 ★ ref 的 PluginSource.parse —— 权威的插件来源识别规则（用户参考实现）
```
参考实现 /tmp/xliaoy-ref/.../PluginSource.java:25-52
（★ 按 K9.2，用户维护的参考实现对该功能有权威性）
  1. 空值 → 报错「请粘贴插件链接或 owner/repo」
  2. spec = value.startsWith("npm:") ? value.substring(4) : value
  3. ★ npm 包名形态：spec.length() <= 300 且匹配
       (?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*(?:@[A-Za-z0-9.^~*+_-]+)?
     ⇒ ★【确认支持 npm 包名】+ 支持 npm: 前缀 + 支持 @version 后缀
     ⇒ Lead 早前悬置的问题「npm 包名形态是否必须接受」⇒ **答案：必须接受** ✅
  4. URL 提取 + 多链接检测（多个 → 报错「识别到多个链接」）
  5. GitHubRef.parse → github 仓库/分支/子目录/Release
  6. ★ HTTPS 压缩包直链：scheme==https && host 非空 && userInfo==null && port==-1
       && host 不在 {github.com, www.github.com, codeload.github.com}
       && path 以 .zip/.tar/.tar.gz/.tgz 结尾
     ⇒ 【与 Lead 早前的「plan 🅰️」一致】：https-only + 后缀白名单 + 拒绝 userinfo/port
     ⇒ 并额外拒绝 github.com 三个域名（因为 GitHub 页面解析失败不能当压缩包下载，
        否则 issues/tree 错误会安装默认分支）★ 这条我原方案没有，ref 更严谨
  7. 全部失败 → 报错「无法识别：支持 npm 包名、GitHub 仓库、分支/子目录、
     Release 下载链接或 HTTPS 压缩包直链」
⇒ ★ 结论：**Step 3c 不应采用 Lead 自拟的 🅰️ 方案，而应采用 ref 的 PluginSource 语义**，
  因为 ref 是用户参考实现（K9.2 优先级：用户维护的参考实现 > 技术正确性）。
```

---

# 附录 K15 —— 悬空消费端 与 夹具/产品分裂（2026-09-24 05:45）

## K15.1 ★★ 新断言 L6h：悬空消费端检测（verifier 设计，Lead 批准并升级）
```
【场景】删除一个外部端点/后端（如 dsha.cc）后，留下【死路径】。
【方法】对每个被删除的外部端点：
  ① 枚举【判据端】= equals/matches/startsWith 比较该值的位置
  ② 断言每个判据端仍【有产出端】（某处会产出该值）
  ③ 判据端有、产出端无 ⇒ 报「死路径」
【本轮结果】PluginInstallLink.management() 判据端存在、产出端 = 0 ⇒ 🔴 死路径
  · 网页侧 dsha.cc 产出 = 0（实测）
  · status-overlay 走 http://127.0.0.1:3090/app/plugins（本地 bridge），与 management 无关
⇒ ★ 关键性质：这条断言【现在就能报红】，不依赖 dsha.cc 是否已删。
   ⇒ 好断言的标志：断言的是【关系】，不是某个【状态】。
【★ 与 L6b 的组合】
  L6b 测「判据端是否接受产出端写出的值」  → 覆盖【值错】
  L6h 测「判据端是否存在产出端」          → 覆盖【死路径】
  两者合起来才完整。单独任一个都有盲区。
【★ 危险点】management() 的存在【看起来功能完好】（有测试、有消费端、编译通过），
  但实际已无生产端 ⇒ 若只把 dsha.cc 改成别的值，
  会把【一个死路径】改成【另一个死路径】，且测试仍绿。
```

## K15.2 ★★ 夹具与产品【分裂】—— K10.2 的镜像版（Lead 实测发现）
```
【现象】java-port 把测试夹具的域名改为 .invalid，但【产品值仍是 dsha.cc】
  产品 PluginInstallLink.java:12  → 只匹配 "https://dsha.cc/app/plugins"
  测试 PluginInstallLinkTest.java:7,8
     assertTrue(management("https://deepseekharness-test.invalid/app/plugins"));
     assertTrue(management("https://deepseekharness-test.invalid/app/plugins/"));
  ⇒ 实测 management("https://deepseekharness-test.invalid/app/plugins") = false
  ⇒ 🔴 两条 assertTrue【必然失败】
  ⇒ 而 :9 的负对照循环（期望 false）恰好通过 ⇒ 【假通过】
  ⇒ 整体呈现「部分红、部分绿」的混乱状态
【★ 与 K10.2 的关系】
  K10.2 = 夹具与产品【一起错】（verifier 发现）⇒ 测试绿但产品坏
  本条  = 夹具改了、产品没改（Lead 发现）⇒ 测试红或假通过
  两者是同一缺陷的【两个方向】。共同根源：**夹具与产品是两个必须同步的副本。**
【防御】
  ① L6b 若覆盖此处会报警 —— 但前提是它的输入来自【产出端真实常量】而非夹具
  ② 更好的防御：**夹具不得内联真值，必须从产品引用同一常量**（消除副本）
     或：断言「夹具用的值 == 产品比较的值」（显式配对检查）
  ③ ★ 要求：对每个测试里的 .invalid 字符串，问「产品里对应的比较值现在是什么？」
     若产品仍是旧值 ⇒ 分裂 ⇒ 落成【fixture ↔ product 配对表】
【★ 已下发】java-port P0-2：夹具↔产品配对核查（怀疑还有别的分裂）
```

## K15.3 scheme 大小写的三层不一致与「靠 API 宽容语义掩盖」
```
现状：
  Manifest:99   android:scheme="deepseekharness"          ← 小写
  代码:23       "DeepSeekHarness".equalsIgnoreCase(...)   ← 大驼峰
  测试夹具      PluginInstallLink.parse("DeepSeekHarness://install?...")  ← 大驼峰
【verifier 的精确分析（比 Lead 更细）】
  若把 equalsIgnoreCase 改成 equals() ⇒ 只有大驼峰能进来
  ⇒ 【小写的 deepseekharness://install 会失效】—— 而 Manifest 声明的正是小写
  ⇒ 会变成【Manifest 能收到 intent，但代码不认】的怪状态
【★ 待验证事实】Android IntentFilter 的 scheme 匹配是否大小写敏感
  （RFC 3986 规定 scheme 大小写不敏感，但 Android 实现可能按字面比较）
  ⇒ Lead 要求 java-port 实测/查文档；verifier 独立复核 ⇒ 两个独立来源
【裁定】统一为小写 + 保留 equalsIgnoreCase
  · Manifest 保持小写 ✅
  · 代码字面量改为小写 "deepseekharness"（消除「靠 equalsIgnoreCase 掩盖的不一致」）
  · 保留 equalsIgnoreCase（宽容收，不拒；用户可能手输深链）
  · 测试夹具改小写 + 新增大写用例证明兼容
⇒ 与 K14.3 同源：**「当前能跑」不能作为「一致」的证据。**
```

## K15.4 ★ 区分「理由措辞不准」与「理由事实错误」（verifier 提出，Lead 补充判据）
```
【verifier 的谨慎】KEEP 有 8 条声称「rootfs 内已存在的版本化目录前缀」(.dsha-opt-*)，
  但 5 个 bin 里 .dsha-opt- = 0 处。verifier 没有直接判为「伪造」，
  而是先查真实产出端，发现上游 tools/test-backup-device.py:12 有
    OWNED = "files/linux/ubuntu/root/.dsha-opt-" + ...  ⇒ 【测试脚本动态拼接】
  ⇒ 结论：措辞不准（不是烘焙在镜像里），但「不应改名」的结论【可能仍对】。
【★ Lead 补充判据（用于区分两类）】
  · 「产出端在【本仓库】但【不在产物里】」⇒ 【措辞不准】
     例：.dsha-opt-*（测试动态拼接）
     处置：修正措辞 + 保留结论（改了要同步两处）
  · 「产出端【不存在于任何地方】」⇒ 【事实错误】
     例：KEEP:5 的 share/dsha（产出端就在 tools/ 且一直写小写）
     处置：移出 PRESERVED
⇒ L6g 应对两类给【不同的处置建议】，不得混为一谈。
  ★ 这是「分类必须与原因同阶」的又一应用（K11.5）。
```

## K15.5 累积漏轴/错误统计（11 次）
| # | 漏轴 / 错误类 | 发现者 | 实例 |
|---|---|---|---|
| 1 | 语义角色（半改） | java-port | K7#1 Download 目录族 |
| 2 | 形式（字符串形态） | java-port | `:43` 拼接 / `:95` 数组 |
| 3 | 语义角色粒度 | java-port | `:74` 前缀集不全 |
| 4 | 版本轴（两版本对比） | verifier→Lead | 备份族被误判「冻结」 |
| 5 | 版本轴 token 值对比 | verifier→Lead | K8 三版本对照 |
| 6 | 排除正则与枚举口径不一致（多报） | Lead | 437 vs 427 伪阳性 |
| 7 | 大小写承载语义 / token 边界劈开 | java-port | DeepSeekHarness.cc |
| 8 | 测试夹具与产品同步错 | verifier | 夹具被同批替换 |
| 9 | 规则的作用域 | Lead | share/ 路径大小写分裂 |
| 10 | 分类可证性 | verifier | KEEP:5 理由伪造 |
| 10b | 口径一致性（统计 vs 执行） | java-port | `'dsha' in 'handshake'` ⇒ 22 处破坏 |
| 11 | **悬空消费端（死路径）** | verifier | management() 无产出端 |
| 11b | **夹具与产品分裂（夹具改了产品没改）** | Lead | PluginInstallLinkTest 断言必失败 |

**错误归属**：Lead 7 次、java-port 2 次、verifier 2 次（verifier 另发现 3 个元层面问题）。
**三条共同根因**：① 枚举轴不完备；② **验证/执行依据本身未被验证**；③ **副本之间缺少同步机制**。

---

# 附录 K16 —— 分类对象的【存在性】与【最小单元】（2026-09-24 06:00）

## K16.1 ★★ 轴 11：分类对象的存在性（verifier 发现，Lead 升级）
```
【verifier 的发现】16 条 KEEP 里 8 条的 token 在本仓库【完全不存在】：
  本仓库 dsha-opt = 0 / git log --all -S'dsha-opt' = 空 / 5 个 bin 内 = 0
  而上游存在（tools/test-backup-device.py, BackupInstrumentation.java, cleanup.json）
【★ 三条独立性质（本轮最重要的元层面模型）】
  完备性：ORIGINAL == EXCLUDED ∪ PRESERVED ∪ REPLACED ∪ DELETED（轴 10）
  存在性：四类的每个元素都必须 ∈ 被分类对象集合（轴 11）← 幽灵条目违反
  正确性：每个元素的归类与其事实相符（轴 10）
  ⇒ ★ 三者【互相独立】。恒等式只保证【完备】，完全不保证【存在】与【正确】。
  ⇒ 一个验证清单可以【同时满足恒等式、却包含大量幻觉条目】。
```

## K16.2 ★★ 真因不是「照抄上游」，而是【同一 token 被重复登记为不同形态】（Lead 定位）
```
【决定性证据 /tmp/migration-evidence/rename-tokens-raw.txt】
  行 473  files/linux/ubuntu/root/.dsha-opt-       | K | "rootfs 内已存在的版本化目录前缀，产出端不在本仓库"
  行 474  data/local/tmp/dsha-opt-                 | R | "REAL 品牌 token，已替换"
  行 475  root/.dsha-opt-backup-check              | K | 同上
  行 476  root/.dsha-opt-backup-check/test-backup-engine.py | K | 同上
  行 477  root/.dsha-opt-backup-check/backup-engine.py      | K | 同上
  行 478  dsha-opt-backup-check                    | R | "REAL 品牌 token，已替换"  ← ★ 同一个东西
  行 479  dsha-opt-plugin-check                    | R | "REAL 品牌 token，已替换"  ← ★ 同一个东西
  行 480  root/.dsha-opt-plugin-check/test-backup-engine.py | K | 同上
  行 481  root/.dsha-opt-plugin-check/backup-engine.py      | K | 同上
  行 482  root/.dsha-opt-plugin-check/repo/scripts/test-plugin-manager.py | K | 同上
【★ 观察】K 类 = 【带路径前缀】形态；R 类 = 【裸 token】形态
  它们是【同一处源码的嵌套切片】：
  上游 tools/test-backup-device.py:43 一行内含
    TMPDIR=/root/.dsha-opt-backup-check … /root/.dsha-opt-backup-check/test-backup-engine.py
    /root/.dsha-opt-backup-check/backup-engine.py
  ⇒ 枚举器用滑动窗口/贪婪截取产出 4 个【嵌套】片段（+ 外层 files/linux/ubuntu/root/.dsha-opt-）
  ⇒ 真正需要替换的【裸 token】dsha-opt-backup-check 被正确归入 R ✅
【⇒ 真因】枚举器的窗口切片产生【嵌套的、带路径的】伪 token，
  与裸 token 是同一处源码的不同截取长度 ⇒ 同一真 token 被重复登记、且归类相反。
  ★ 不是「照抄上游」（raw 文件证明是从本仓库枚举的）。
【★ Lead 升级：最小可替换单元断言】
  不仅要 x ∈ ORIGINAL，还要 **x 必须是【最小可替换单元】**
  （不能是某个真 token 的【超字符串切片】）
  ⇒ 否则同一真 token 的多个切片被分别归类 ⇒ 分类冗余且自相矛盾
     本轮实例：dsha-opt-backup-check 同时是 R（裸）和 K（带路径）
```

## K16.3 ✅ 替换已正确执行 —— KEEP 是【空保护】
```
实测：
  tools/test-backup-device.py:43 = 'TMPDIR=/root/.deepseekharness-opt-backup-check …' ✅
  app/src/androidTest/.../BackupInstrumentation.java = '/root/.deepseekharness-opt-java-check/…' ✅
  app/src/main/java/.../IsolatedInstallProcess.java:28 = "libdeepseekharness-session.so" ✅
  tools/native-session/build.ps1:5 = '…/libdeepseekharness-session.so' ✅
  全仓 dsha-opt = 0 ✅
⇒ ★ 这 7 条 KEEP 是【空保护】：声称保护一个值，
   但那个值（带路径的完整字符串）在任何地方都【不作为被替换对象存在】
   ⇒ 它们没有保护任何东西，反而污染了 PRESERVED 集合。
```

## K16.4 ★ 副本同步问题（K10.2 与 K15.2 的统一）
```
三类副本分裂：
  K10.2  夹具与产品【一起错】        → 测试绿、产品坏（verifier 发现）
  K15.2  夹具改了、产品没改          → 测试红或假通过（Lead 发现）
  K16.4  同一 token 的多个【枚举切片】→ 分类自相矛盾（Lead 发现）
⇒ 共同根源：**同一个真值在系统里有多个副本，且副本间无同步机制。**
⇒ 通用防御（三条）：
  ① 消除副本：夹具/清单引用产品同一常量，而非内联真值
  ② 显式配对断言：断言「副本 A 的值 == 副本 B 的值」
  ③ 最小单元断言：分类/枚举对象必须是不可再分的最小单元
```

---

# 附录 K17 —— Step 5「自选更新版本」的权威答案（2026-09-24 06:15）

## K17.1 🔑 ref 的更新机制只有【dsh runtime】，**没有 APK 自更新**
```
【决定性证据】
① /tmp/xliaoy-ref/app/src/main/java/.../ui/UpdateActivity.java 类注释：
   「更新 DeepSeek Harness：检查上游最新版本并在容器内 npm 更新，不依赖页面生命周期。」
   ⇒ 只有 4 个操作：update_back / update_check / update_update / update_browser
② /tmp/xliaoy-ref/.../res/layout/activity_update.xml 的 id 全集：
   update_back, update_current, update_status, update_progress, update_progress_text,
   update_update, update_check, update_browser, update_notes_panel, update_notes
   ⇒ ★【没有任何 APK 更新按钮】
③ ref 全仓搜 APK 安装代码：
   grep -rn "package-archive|PackageInstaller|ACTION_INSTALL" /tmp/xliaoy-ref/app/src/
   ⇒ 【空】。唯一命中是 Manifest:6 的 REQUEST_INSTALL_PACKAGES 权限
     （★ 有权限但【无对应代码】⇒ 是从上游继承的遗留权限）
④ ref 的 update_desc 字符串（:194）明确说明机制：
   「从 deepseek-ai/deepseek-harness 的 GitHub Releases 获取最新版本，在容器内通过 npm 自动更新。」
⑤ DshUpdater.RELEASES_API（:48）：
   https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=1
   ⇒ 指向【上游 dsh 仓库】，不是本 App 仓库
【⇒ 结论】ref 的「更新」= 更新【容器内的 dsh npm 包】，不是更新 APK 本身。
```

## K17.2 ★ 这如何裁定悬置的两个问题
```
【悬置问题 A】「dsh-runtime 版本选择」还是「APK 版本选择」？
  用户答「两者都要」⇒ 但现在有了权威参照：
  · ref 实现了【dsh runtime 版本选择】的基础（RELEASES_API + npm 安装 + 版本说明面板）
  · ref 【完全没有】APK 版本选择
  ⇒ ★ 解释：用户的「两者都要」是在【不知道 ref 形态】的前提下回答的。
    按 K9.2 裁决依据优先级：
      用户明确指令（两者都要） > 用户维护的参考实现（只有 runtime）
    ⇒ ✅ 用户指令优先 ⇒ **两者都做**，但：
       · dsh runtime 版本选择：按 ref 形态实现（有权威参照）
       · APK 版本选择：ref 无参照 ⇒ 按我们自己的设计 + 用户 repo（xliaoy/DeepSeekHarness）
         GitHub Releases 实现（用户已选「用我的 GitHub Releases」）
    ⇒ ★ 且要【向用户披露】：ref 里没有 APK 自更新，这是我们额外的能力。
【悬置问题 B】本地发布名约定 `deepseekharness-<version>.apk` vs GitHub 资产名
  `app-standard-release.apk` / `app-low-release.apk`
  ⇒ ✅ java-port 已把 generate-release-manifest.py:101 改为
       expected = f'deepseekharness-{version}{"low" if …}.apk'（已确认）
  ⇒ ★ 但【用户的 GitHub Releases 实际资产名是 app-*.apk】⇒ 两者【不一致】
  ⇒ 裁定：manifest.json 是我们【自己生成并上传】的清单（本地约定可自定）；
     APK 自更新走 GitHub Releases API 的 asset 名（app-*.apk）
     ⇒ 两条链【各自独立】，不冲突：
        · 本地/CI 发布流程 → 产出 deepseekharness-<version>.apk + manifest.json
        · 在线更新 → 读 GitHub Releases API 的 assets[]，按 flavor 选 app-standard/low-release.apk
     ⇒ ⚠️ 但必须【明确记录这个不一致】，否则将来会有人以为它们应当相同。
```

## K17.3 已验证的 API 事实（供 Step 5b/5c 使用）
```
【上游 dsh 仓库】deepseek-ai/deepseek-harness
  GET https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=1
  → 返回 1 条：tag=dsh-v0.1.7-rc.1, prerelease=true, name=v0.1.7-rc.1
  ⇒ ★ 可用 ✅（且能返回 prerelease）
【用户 App 仓库】xliaoy/DeepSeekHarness
  GET https://api.github.com/repos/xliaoy/DeepSeekHarness/releases?per_page=3
  → v2026.09.22: ['app-low-release.apk', 'app-standard-release.apk']           ← 无 .sha256
  → v2026.09.18: ['app-low-release.apk', 'app-standard-release.apk', + 各自 .sha256]
  → v2026.09.16: ['app-low-release.apk', 'app-standard-release.apk', + 各自 .sha256]
  ⇒ ★ 证实「.sha256 资产可缺省」⇒ 必须以 asset.digest 为主（K11.2/L6d）
【ref 的 npm registry 默认值】DshUpdater:258 → "https://registry.npmmirror.com"
  tarball: dsh-<version>.tgz，目录 root/.dsh-update
  安装命令: npm install -g @deepseek-ai/dsh@<version>
```

---

# 附录 K18 —— 保留清单的【方向性危害】（2026-09-24 06:35）

## K18.1 ★★★ KEEP 清单 16 条里 15 条不成立（verifier 逐条核实，Lead 独立复核）
```
【逐条结论】
  ① DSHA_ARM64_V2                     → ✅ 保留成立（协议契约）—— 唯一一条
  ② share/dsha/ca-certificates.crt    → 理由伪造（产出端就在 tools/，bin 里没有 share/dsha）
  ③ files/linux/ubuntu/root/.dsha-opt-→ 超字符串切片
  ④ dsha-pty.c                        → 理由【事实相反】
  ⑤ dsha-pty.h                        → 理由【事实相反】
  ⑥ dsha_pty_child                    → 理由【事实相反】
  ⑦ dsha_pty_parent                   → 理由【事实相反】
  ⑧ dsha_pty_prepare                  → 理由【事实相反】
  ⑨ libdsha-session.so（带路径）        → 理由【事实相反】
  ⑩⑪⑫ root/.dsha-opt-backup-check/*   → 超字符串切片（3 条）
  ⑬⑭⑮ root/.dsha-opt-plugin-check/*   → 超字符串切片（3 条）
  ⑯ libdsha-session.so（裸）           → 理由【事实相反】
⇒ 定性：1 条成立 + 8 条超字符串切片 + 6 条理由事实相反 + 1 条理由伪造
```

## K18.2 ✅ Lead 独立复核 §③ 三条断言 —— 全部与事实相反
```
【断言 1「无 NDK 不能重编」】⇒ ❌
  tools/termux-jni/ 实测：deepseekharness-pty.c 2981B、deepseekharness-pty.h 201B、
  deepseekharness-process.c 437B（均 Sep 24 03:42，已改名并改内容）
  ⇒ 源码就在本仓库 ⇒「不能重编」被推翻
【断言 2「dsha_pty_* 已编进 .so，不能改」】⇒ ❌
  deepseekharness-pty.h:4-6 =
    int  DeepSeekHarness_pty_prepare(int pair[2]);
    int  DeepSeekHarness_pty_parent(JNIEnv* env, int pair[2], pid_t pid);
    void DeepSeekHarness_pty_child(int pair[2]);
  生产端/消费端配对完整：.c:29,34,52 定义 / .h:4-6 声明 / build.ps1:43,45,46 调用
  ⇒ 内部符号已改名，三处同步 ⇒「不能改」被推翻
【断言 3「libdsha-session.so 是仓库里的预编译产物」】⇒ ❌ 前提不存在
  git ls-files | grep -c '\.so$' = 13；无 session*.so / libdsha*
  ⇒ 该 .so 根本不在仓库（由 build.ps1 生成）
  真实引用处已改名：IsolatedInstallProcess.java:28 / tools/native-session/build.ps1:5 ✅
【全仓 dsha-pty / dsha_pty 残留 = 0】✅
```

## K18.3 ★★★ 分水岭：保留清单具有【方向性危害】
```
【实测危害】若严格按 KEEP 清单执行，会把【已正确改名】回滚成【错误】：
  tools/termux-jni/deepseekharness-pty.c     → dsha-pty.c
  tools/termux-jni/deepseekharness-pty.h     → dsha-pty.h
  tools/termux-jni/deepseekharness-process.c → dsha-process.c
  DeepSeekHarness_pty_prepare/child/parent   → dsha_pty_*
  libdeepseekharness-session.so              → libdsha-session.so
【★ 结论】保留清单不是「保守」，而是【基于错误前提的主动破坏源】。
  它假设「某处因技术限制不能改」，而该假设为假
  ⇒ 执行它会把正确状态改成错误状态（主动制造的回归）。
【★ 与其他缺陷的【类差】】
  其他缺陷 = 【漏改】（该改的没改，遗留旧品牌）
  KEEP 危害 = 【错改】（不该改的改了，主动回滚正确状态）
  ⇒ 防御手段【完全不同】：
    漏改 → 穷举 + 存在性断言（L6g ①）
    错改 → 每条保留理由必须【可证】，且必须对照产物验证（L6g ②）
  ⇒ ★ L6g 的真正价值：**它不是查「漏改」，而是查「保留理由是否被事实支持」。**
【★ 凝练判据（Lead 定稿，建议入报告）】
  **「保留」必须被证明，不能靠【未验证的技术假设】。
    凡声称『不能改』的，必须给出【可复现的失败证据】；
    给不出的，一律视为【应改未改】。**
【★ 风险披露】这 15 条【实际未被错误执行】
  （java-port 只按正确判据改名，未盲目执行 KEEP）⇒ 当前树是好的。
```

## K18.4 ★ 处置裁定：15 条【全部移入 REPLACED】而非删除
```
· 8 条超字符串切片（.dsha-opt-* 族）→ 从 PRESERVED 移出，token 从 ORIGINAL 剔除
  （不是最小可替换单元）；真 token（裸形态）留在 REPLACED ✅
· 6 条理由事实相反（dsha-pty.* / dsha_pty_* / libdsha-session.so）→ 移入 REPLACED
· 1 条理由伪造（share/dsha/ca-certificates.crt）→ 移入 REPLACED
· 1 条成立（DSHA_ARM64_V2）→ 保留在 PRESERVED ✅
【★ 为什么移入 REPLACED 而非删除】
  它们都是【真实发生过的改名】，只是被错误归类为「保留」。
  删除它们会【丢失改名证据】⇒ 反而制造新的不完备（违反完备性）。
```

## K18.5 ★★ 平台行为无法确证时：不要赌它 —— 让设计不依赖于该行为
```
【背景】Android IntentFilter 的 scheme 匹配是否大小写敏感，无法取得权威来源
  （web_search 不可用；本地无 AOSP 源码；verifier 拒绝编造结论）
【verifier 的稳健方案】让 Manifest 与代码【用同一字面值】
  ⇒ 无论 Android 敏感与否都正确 ⇒ **用「消除差异」代替「判定敏感性」**
【★ Lead 评价】本轮最好的一次工程判断。总结为通用规则：
  **当平台行为无法确证时，不要赌它 —— 让设计【不依赖于该行为】。**
  这比「查文档确认」更稳健，因为它对未知的未来变化也免疫。
【Lead 补充证据（标注为待验证，不作判据）】
  AOSP IntentFilter.matchData 对 scheme 使用 String.equals（大小写敏感），
  与 RFC 3986「scheme 大小写不敏感」不一致 —— 但这是记忆而非实测 ⇒ 不作为判据。
  ⇒ 结论不变：按「同一字面值」实施后，此问题无关紧要。
```

## K18.6 ★★ L6i 升级为【三方配对】—— 覆盖 K10.2
```
【verifier 原设计 L6i】夹具↔产品配对断言
  能力边界：能查「夹具改了产品没改」，不能查「夹具产品一起错」（需外部真值）
⇒ ★ Lead 升级：三方配对 = 产品值 / 夹具值 / 外部真值（/tmp/xliaoy-ref 或 /tmp/dsha-up）
   · 三方一致        → ✅ 最强
   · 产品 == 真值 ≠ 夹具 → 夹具错（测试红，可查）
   · 夹具 == 真值 ≠ 产品 → 产品错（测试红，可查）
   · 产品 == 夹具 ≠ 真值 → ★ 一起错（测试绿，L6i 原设计【不可查】）
   ⇒ 引入外部真值后，连「一起错」也能覆盖
⇒ 要求：凡涉及品牌 / scheme / 域名的夹具，都与外部真值做三方比对。
```

## K18.7 五根支柱（本项目质量保障）
```
① KEEP:5 理由伪造            → 分类可证性（轴 10）
② 检测器漏报率               → 闸门自身必须被验证（K14.2）
③ 悬空消费端（死路径）        → 关系断言 L6h（K15.1）
④ 分类对象存在性             → 轴 11 + 最小可替换单元（K16）
⑤ ★ 保留理由的方向性危害      → 错改类防御（K18.3）← 本轮新增，分水岭级
```

---

# 附录 K19 —— 派生产物完备性：i18n 编译链（2026-09-24 06:50）

## K19.1 ★★★ messages.json 在【构建链里】，其内容【编进 APK】（Lead 实测铁证）
```
【推翻的误判】verifier 曾判「localize-android-ui.py 不在构建链 ⇒ messages.json 是潜在问题」
  ⇒ 对 localize-android-ui.py 的判断正确（确实无人调用）
  ⇒ 但由此推出「messages.json 是潜在问题」【错误】

【铁证 1：Gradle 输入声明】app/build.gradle
  :203  /** 构建期由 tools/prepare-ui-languages.py 生成 util/UiMessages … */
  :205  inputs.file(rootProject.file("tools/prepare-ui-languages.py"))
  :206  inputs.file(rootProject.file("tools/i18n/messages.json"))     ← ★ 关键
  :209  … tools/prepare-ui-languages.py …
【铁证 2：生成器逻辑】tools/prepare-ui-languages.py
  messages=json.loads((root/'tools/i18n/messages.json').read_text())
  translated=[item for item in messages if item['en']]
  unique={item['zh']:item['en'] for item in translated}
  → 生成 UiMessages.java：static final Map<String,String> EN = build();
                          values.put("<zh>","<en>");   ← ★ 逐条编进 APK
【铁证 3：实际产物】app/build/generated/uiLanguage/com/deepseekharness/app/util/UiMessages.java
  :578  values.put("无法打开浏览器，请在浏览器中访问 https://dsha.cc/",
                   "Could not open a browser. Visit https://dsha.cc/ in your browser.");
  :1440 values.put("安装链接无效，请从 dsha.cc 重新选择插件，或在插件页粘贴下载链接",
                   "Invalid installation link. Select the plugin again on dsha.cc or …");
  实测：该产物内 dsha.cc = 2 处；新文案「安装链接无效，请在插件页粘贴有效的下载链接」= 0 处
【铁证 4：APK 级】app/build/outputs/apk/standard/release/app-standard-release.apk
  unzip -p <apk> classes.dex | strings | grep dsha.cc  → 10 行：
    dsha.cc / https://dsha.cc/ / https://dsha.cc/api/updates.json
    ACould not open a browser. Visit https://dsha.cc/ in your browser.
    https://dsha.cc/app/plugins / https://dsha.cc/app/plugins/
    lInvalid installation link. Select the plugin again on dsha.cc or …
    www.dsha.cc
  ⇒ ★★ **dsha.cc 确实【编进了 APK】，用户可见**
  ⇒ APK 内 \bdsha\b 计数 = 22（classes.dex）
```

## K19.2 🔴 影响方向纠正 —— 不是「不切英文」，而是「切英文时显示错误文案」
```
【verifier 的判断】新文案不在表 ⇒ 不会套 T() ⇒ 英文环境仍显示中文
【★ 真实机制（读 UiText.java 确认）】运行时是【查表】，不是【编译期包裹】：
  public static String text(String value) {
      if(value==null||!"en".equals(language))return value;
      String translated=UiMessages.EN.get(value);
      return translated==null?value:translated;    ← 查不到就【回退中文原文】
  }
⇒ 两个后果：
   · 新文案不在表 ⇒ EN.get() 返回 null ⇒ 回退中文 ⇒ 英文用户看到中文（verifier 描述的现象对）
   · ★ 更重要的是【旧条目仍在表里】：旧 zh→旧 en 被编进 APK，
     若仍有代码用旧 zh ⇒ EN 环境显示【含 dsha.cc 的英文】
```

## K19.3 ★★ 「全仓 dsha.cc = 9 处」这个数字【低估了】—— 必须含派生产物
```
源码 grep 只能看到【源文件】中的 9 处。
但 messages.json（数据源）里的 2 条会被【编译进 APK】，
即使 Java 源码里的 dsha.cc 全部删除，APK 里【仍然有 dsha.cc】。
⇒ ★ 这是 K13.5「静默跳过的操作」与 K15「删除只做了一半」的新实例：
   **删除必须覆盖【派生产物】，不只是源文件。**
⇒ ★ 也是新缺陷族：**派生产物完备性**。
```

## K19.4 ★★ 派生产物完备性 —— 三条派生链与幂等性断言（Lead 设计，verifier 执行）
```
【已知派生链】
  ① 源码 → tools/i18n/messages.json → UiMessages.java → APK        （本条 i18n）
  ② 源码 → runtime-descriptor.json → runtimeId                     （已知 1 处陈旧 hash）
  ③ 源码 → 5 个 .bin → APK assets                                   （K4/K7 曾出问题）
【★ 断言设计】对每条派生链给出：产出端 / 中间产物 / 最终产物，
  并断言「源头改了 ⇒ 中间和最终被重新生成且一致」
【★ 通用武器：幂等性断言】
  中间产物的内容必须与「用当前源重跑一次生成器」的结果【相同】
  ⇒ 这是发现「改了源但忘了重跑生成器」的通用手段
  ⇒ 正是 runtime-descriptor.json 那 1 处陈旧 hash 暴露的问题族
【★ 产物级断言的威力】
  「APK 内不得含 dsha.cc」用 strings 扫 APK/dex 即可 ⇒ 比源码 grep 强得多，
  因为它自动覆盖【所有】编进产物的路径（源码、数据源、生成器输出）。
  ⇒ 补上了此前共同盲区：我们一直 grep 源码，查不到【数据源编进产物】的情况。
```

## K19.5 四类系统性风险（本项目）
```
① 漏改（该改的没改）        → 本体品牌残留；防御 = 穷举 + 存在性断言
② 错改（保留清单的方向性危害）→ K18；防御 = 保留理由必须可证
③ 幻觉条目（分类对象不存在）  → K16；防御 = 存在性 + 最小可替换单元
④ ★ 派生产物未同步（源改了产物没重生成/删干净）→ K19；防御 = 幂等性 + 产物级断言
```

---

# 附录 K20 —— 审计维度缺失与闸门判别力（2026-09-24 07:20）

## K20.1 ★★ 审计维度矩阵 —— 我们验证过什么、漏掉过什么
```
【维度】                【是否验证过】  【发现过缺陷】
  文件内容（源码）          ✅ 是            ✅ 大量
  文件内容（数据源）        ⚠️ 曾全盲        ✅ messages.json（K19）
  文件内容（生成物）        ✅ 是            ✅ UiMessages.java
  文件内容（APK/dex）       ⚠️ 后期才加      ✅ dsha.cc ×10
  资源名（resources.arsc）  ✅ 后期加了      ✅ 陈旧产物中的 DSHA 样式族
  ★ 文件名/路径名           ❌ 从未验证      ✅ dsha_brand.png 等 3 处 ★本轮
  ★ 目录名                  ❌ 从未验证      ⏳ 待普查
【★ 通则】**grep 默认只查内容，不查名字。**
  ⇒ 任何「改名」任务都必须同时覆盖：内容 / 文件名 / 目录名 / 资源名 / 产物内名字。
  ⇒ 收尾必做：find . -path ./.git -prune -o -name "*dsha*" -print -o -name "*DSHA*" -print
    （排除 app/build/）⇒ 要求为空。
```

## K20.2 ★★★ 闸门判别力原理（verifier 提出，Lead 采纳并推广）
```
【verifier 拒绝把 DSHA/dsha 加进 L6j 扫描的理由】
  「不是『怕混在一起造成误报』，而是【这些形态在 dex 里有合法存续】
    （DSHA_ARM64_V2 / DSHA-sessions- 等）⇒ 扫它们会使闸门【失去判别力】
    （全是命中 = 没有信息）」
【★ 通则】**闸门的判别力来自「命中的都是坏的」；
  若命中集里混有合法项，闸门就必须先解决分类问题 —— 那就退化成人肉审计了。**
⇒ ★ 与 K18 互为补充：
   K18：错误的保留会【主动破坏】正确状态
   K20.2：无法分类的扫描会【失去判别力】
   ⇒ 两者共同指向：**白名单/豁免必须【极小且可证】，否则闸门失效。**
   ⇒ 反向支持把 KEEP 从 16 条压到 1 条（DSHA_ARM64_V2）的裁定 ✅
```

## K20.3 ★★ 「异常量级必须先确立基准线」（verifier 第 7 次闸门出错）
```
【数字演变】i18n 缺口检测器：v1=221（跨行正则虚高）→ v2=526 → v3 对照上游发现 512 是固有
⇒ 本轮真实增量仅 14（去重 58）⇒「526 处缺口」是【上游固有属性】，非本轮缺陷
【verifier 的教训】「异常量级必须先确立基准线，再谈是否异常。」
【★ Lead 的可操作化版本】
  **任何缺陷声明必须携带一个【对照基准】，且该基准与当前测量【同口径】。
    无基准的数字只能报告为【观测值】，不能报告为【缺陷】。**
  ⇒ 关键在「同口径」：v1/v2 的错误不只是"没对照"，而是"换了口径还没察觉"。
  ⇒ 规则必须写成【同口径 + 有基准】，两条件缺一不可。
  ⇒ 与 K8「版本轴完备性」同一规则：判断"某值是否被改坏"必须有权威参照。
```

## K20.4 ★★ 审计基准本身必须被审计（verifier 发现）
```
【发现】tools/i18n/messages.json 【不在 git 里】：
  git ls-files --error-unmatch → 报错
  git status --short tools/i18n/ → "?? tools/i18n/"
  git cat-file -e 62d8459:tools/i18n/messages.json → 基线【没有】
⇒ ★ 三版本对照：基线无 → 上游 v0.1.7-alpha2 引入 → 当前树有（未提交）
⇒ ★ 它是【构建输入】（Gradle 读它）却不在 git 里
⇒ ★ 后果：所有基于 git 的审计（git grep / git diff / git status）对它【全盲】
   ⇒ 这正是全程都没发现它的原因！
【★ 通则】**审计基准本身必须被审计。任何「只查 git 追踪文件」的闸门，
  对未追踪的构建输入（.bin / messages.json / 生成物）必然全盲。**
⇒ ★ 与「存在性轴」（K16）互为镜像：
   存在性轴 = 清单里的条目【现实中不存在】（幻觉条目）
   本案     = 现实中的对象【不在清单里】（清单外对象）
   ⇒ 合并 = **「清单↔现实」双向映射必须闭合**（既无幻觉，也无遗漏）
```

## K20.5 派生链断言策略（verifier 设计 + Lead 补第 0 步）
```
【verifier 的三策略】
  · 自动生成 + 廉价 → 幂等性断言（重跑比对）
  · 人工维护       → 内容约束断言（禁项 + 必需项）
  · 自动生成 + 昂贵 → 关键标记一致性断言
【★ Lead 补第 0 步前提】（本案教训）
  **在选断言策略之前，必须先回答「这条链存在吗？它的输入被追踪吗？」**
  —— 未追踪的构建输入是最容易被漏掉的一类。
⇒ 完整四步：① 发现链路 → ② 确认输入是否被审计覆盖 → ③ 按性质选断言 → ④ 加负对照
【三条已知派生链】
  ① 源码 → messages.json → UiMessages.java → APK        （人工维护表 ⇒ 内容约束断言）
  ② 源码 → runtime-descriptor.json → runtimeId           （自动+廉价 ⇒ 幂等性断言）
  ③ 源码 → 5 个 .bin → APK assets                        （自动+昂贵 ⇒ 关键标记断言，L6f）
```

## K20.6 ★ versionCode 体系错配（java-port 发现，Lead 实测确认）
```
【冲突】versionCode 是【小整数计数器】(116→117→145)，
       而 GitHub tag 是【日期】(v2026.09.22)
   ⇒ 若把 tag 转整数当 versionCode：20260922 > 145 【恒成立】
   ⇒ select() 判据 r.versionCode <= currentCode ⇒ 全都"是新版本"
   ⇒ ★ 用户已是最新版时检查，仍被告知"发现新版本"并诱导下载同一个 APK
【★ 最危险的反例（Lead 实测）】v0.1.7-rc.1 → 107
   107 < 145（BuildConfig.VERSION_CODE）
   ⇒ 若误用 currentCode=VERSION_CODE(145)：107 <= 145 ⇒ 【永远不更新】(错！)
   ⇒ 必须用 comparableCode(versionName)=20260925 ⇒ 107 < 20260925 ⇒ 正确 ✅
   ⇒ ★ 证明「必须用 versionName 而非 VERSION_CODE」不是风格偏好，是【正确性必需】
【裁定】采用【独立第二套选择函数】，不复用 select()：
   · 既有自建清单链路（小整数 + select()）【原样保留，一行不动】⇒ UpdatePolicyTest 不受影响
   · GitHub 链路新增独立函数，内部用 versionCodeFromTag() 与 comparableCode() 比较
   ⇒ ★ 明确否决「让 Release.versionCode 语义变成日期数值」：
     语义重载会让「同一字段在不同链路含义不同」，正是 K 系列在
     `share/` 路径大小写（轴 9 规则作用域）上刚吃过的教训。
     ⇒ **宁可两个函数，不要一个字段两种语义。**
【实测通过】20260925low → 20260925（剥 low 后缀）/ 2026.09.22 → 20260922 /
            幂等（当前 tag 不比当前版本新）/ garbage → 0（不可解析，须跳过）
```

---

# 附录 K21 —— 资源命名体系审计（2026-09-24 07:35）

## K21.1 ★ 资源名自洽性审计结果（Lead 全量实测）
```
【定义 ↔ 引用 闭合性】
  资源名（含 DEEPSEEK_HARNESS）定义数 19 / XML 引用数 16
  ★ 引用了但未定义（会编译失败）= 【无】✅
  定义了但未被 XML 引用 = 3：
    Theme.DEEPSEEK_HARNESS_Base        → ✅ 被 values-night/themes.xml:4 parent= 引用（正则漏了 parent）
    Widget.DEEPSEEK_HARNESS_DangerButton → 由 Widget.DEEPSEEK_HARNESS_DialogButton 等内部继承
    Widget.DEEPSEEK_HARNESS_DialogButton → 同上
  ⇒ ✅ 无悬空引用，无编译风险
【全仓 res 内 `dsha` 资源名 = 0】✅
  color/deepseekharness_launcher_background   ✔ 已改
  style/Shape.DEEPSEEK_HARNESS_Dialog         ✔ 已改（themes.xml:115 定义，:90/:112 引用）
```

## K21.2 ★★ 「与参考实现不同」≠「错误」—— 命名风格的三种形态
```
【三种并存的风格】
  ① Widget.DEEPSEEK_HARNESS_Button          （下划线 + 全大写）  ← 我们的迁移命名
  ② Widget.DeepSeekHarness.BottomNavActiveIndicator （点号 + PascalCase）
  ③ Theme.DeepseekHarness                    （PascalCase 但小写 s）
【关键判定：② 与 ③ 是【参考实现自己就有】的形态】
  ref themes.xml:3  <style name="Theme.DeepseekHarness" parent="Theme.DeepSeekHarness.Base">
  ⇒ 实测 Theme.DeepseekHarness 在 ref 里被 AndroidManifest 12 处引用
  ⇒ ★ 且它【不含旧品牌 dsha】⇒ 不是改名残留
【★ Lead 裁定：② ③ 保持不动，① 也保持不动】
  理由：
    · 资源名是【内部标识符】，不用户可见
    · 全仓【自洽】（定义↔引用一致，无悬空）
    · 不含旧品牌 ⇒ 不违反用户指令
    · 改动需动 12 处 Manifest + 全部 layout + androidTest 的 R.style.xxx
      ⇒ 风险 >> 收益
  ⇒ 📌 报告记为「与 ref 的命名风格差异（非缺陷）」，
     ★ 明确【不得】列为缺陷。若列则必须附「引用点数量 + 影响面」。
【★ 通则】**「与参考实现不同」不等于「错误」——
  必须区分【用户可见 / 契约性】与【内部标识符】。**
  用户指令「把所有 dsha 换成 DeepSeekHarness」的判定基准是【有旧品牌】，
  不是【与 ref 逐字相同】。
```

## K21.3 ✅ 路线图：旧品牌的三层形态（全部已定位）
```
【第 1 层：文件内容】✅ 已清（git 追踪 + 未追踪全普查）
  全仓（含未追踪，排除 build/.git/__pycache__）含 \bdsha\b 的文件 = 3：
    tools/verify-brand-integrity.py          → 闸门自身的检测正则（合法）✅
    README.md                                → Lead 待更新（已知待办）✅
    team-evidence/task2-res-visual-verification.md → 历史证据文档（合法）✅
【第 2 层：文件名】❌ 3 处待改（已派发给 java-port）
  app/src/main/res/drawable-nodpi/dsha_brand.png
  app/src/main/res/drawable/dsha_launcher_foreground.xml
  tools/test-dsha-ui-regressions.py
【第 3 层：目录名】✅ 实测为 0（find -type d）✅
【第 4 层：资源名】✅ 实测为 0（grep res 内 dsha_）✅
【第 5 层：产物内名字】⏳ Step 6 重建后复核（aapt2 dump resources）
```

## K21.4 ★★ 「审计维度矩阵」—— 内容/文件名/目录名/资源名/产物名（K20.1 补全）
```
我们验证过的维度（含时间）：
  源码内容        ✅ 全程
  数据源内容      ⚠️ 很晚（K19 messages.json）
  生成物内容      ✅ 中后期
  APK/dex 内容    ⚠️ 后期（K19）
  资源名          ✅ 后期（K21）
  ★ 文件名        ❌ 从未 —— 本轮才发现 3 处
  ★ 目录名        ✅ 本轮补测（0 处）
  ★ 产物内名字    ⏳ 待 Step 6
【★ 通则】**grep 默认只查内容，不查名字。**
  任何「改名」任务必须同时覆盖：内容 / 文件名 / 目录名 / 资源名 / 产物内名字。
  收尾必做命令：
    find . -path ./.git -prune -o -path ./app/build -prune \
      -o -name "*dsha*" -print -o -name "*DSHA*" -print   ⇒ 要求为空
```

## K21.5 ★ T4 引用链的产物级确认（历史证据与新状态对照）
```
team-evidence/task2-res-visual-verification.md 曾记录【未修复】的引用链：
   138-191 行：Dialog.DeepSeekHarness.Material →(shapeAppearanceOverlay)→ Shape.DSHA.Dialog → 32dp
⇒ ★ 那是【当时的真实缺陷】（已修）。Lead 本轮实测确认【现在已闭合】：
   themes.xml:115  <style name="Shape.DEEPSEEK_HARNESS_Dialog" parent="">
   themes.xml:90   <item name="shapeAppearanceOverlay">@style/Shape.DEEPSEEK_HARNESS_Dialog</item>
   themes.xml:112  <item name="shapeAppearanceOverlay">@style/Shape.DEEPSEEK_HARNESS_Dialog</item>
   grep -rn "Shape\.DSHA" app/src  ⇒ 【空】✅
⇒ 该证据文档保留其历史价值，★ 但【不得】作为当前缺陷证据引用。
```

---

# 附录 K23 —— 语义变更的消费者普查 + 跨集合断言的基准前提（2026-09-24 08:05）

## K23.1 ★★★ 铁律 3：改变一个值的语义 = 改变所有消费该值的代码的含义
```
【触发事件】java-port 把 UpdateEngine 的版本比较基准从 versionCode(小整数)
  改为 comparableCode(versionName)(日期体系) —— 一个【语义变更】
【必然破坏】UpdateEngine.validatePackage()
   :409  code != release.versionCode        ⇒ 真 versionCode(145) vs 日期(20260922)
                                              ⇒ 恒不等 ⇒ 下载【100% 失败】
   :411  expectedVersion = release.version + "low"  ⇒ "2026.09.22" vs "20260925"
                                              ⇒ 恒不等
   ⇒ ★ 报错文案是"版本不匹配" ⇒ 用户会以为【下载的 APK 坏了】，
     而不是【我们的校验逻辑错了】⇒ "静默坏 + 误导性报错" 的组合
【★ 铁律 3】**改变一个值的语义，等于改变所有消费该值的代码的含义。
  因此语义变更必须伴随【消费者普查】，且普查范围由【字段检索】而非【调用点回忆】确定。**
  ⇒ 与既有铁律并列：
     铁律 1（K1）  改哪一侧，取决于哪一侧是产出端
     铁律 2（K18.3）凡声称"不能改"必须给出可复现失败证据
     铁律 3（K23.1）语义变更必须普查全部消费者
【★ 为什么"字段检索"而非"调用点回忆"】
   前者是【穷举】（grep 字段名 ⇒ 全部命中），后者依赖记忆 ⇒ 必然漏。
   java-port 实测 grep versionCode 共 11 处，确认其余无隐患 —— 这就是正确做法。

## K23.2 ★★★ 校验基准必须是【外部事实源】，不能是被校验对象自身
```
【validatePackage 的正确基准】
   ❌ release.versionCode（清单里的声明）
   ✅ BuildConfig.VERSION_CODE（真实下载到的 APK 的编译期常量）
【★ 通则】若校验基准取自【被校验对象自身】，校验退化为【自己与自己比较】⇒ 恒真的伪校验。
  ⇒ 校验的价值 = 发现【两个独立来源不一致】。若两个来源实际是同一个 ⇒ 校验无信息量。
  ⇒ 同理适用于：
     · runtimeId 必须由 contract 重算（不是读文件里的值去比文件里的值）
     · 品牌断言必须扫【产物】而非【源】（源对不代表产物对，K19）
```

## K23.3 ★★ 跨集合断言必须先证明基准一致
```
【java-port 的第 2 次自我更正】
   命题 "launcherInputs ⊆ inputs" ⇒ 实跑 (24/109) ⇒ 看似缺陷
   ⇒ 查生成器源码后发现：两者【故意用不同基准】
       inputs    : { p.relative_to(assets) }   ← 基准 = app/src/main/assets/
       launchers : { path.relative_to(root) }  ← 基准 = 仓库根
     因为 launcher 含 jniLibs 与 java/runtime 下的文件，【不在 assets/ 内】
   ⇒ ★ 命题本身不成立，不是数据有问题。
【★ 通则】**跨集合断言必须先证明基准一致；基准不一致时该断言无意义。**
  ⇒ 与"报 0 先怀疑基准"（Lead 的 descriptor 误算）是同一根因的两面：
     · Lead：基准错 ⇒ 报 0/全缺失 ⇒ 像灾难
     · java-port：基准错 ⇒ 报 24/109 不符 ⇒ 像缺陷
     共同根因：**比较两个集合前，必须先确认两者用同一基准。**
```

## K23.4 ★★★ share/ 路径大小写 —— 【决定性证据】（Lead 实测，双向闭合）
```
【本案的最终判据：生产端真值】
   $ tar tzf app/src/main/assets/dsh-runtime.bin | grep '^usr/local/share/'
     usr/local/share/deepseekharness/dsh-runtime.version        ← ★ 小写！
【消费端 Java 侧（12 处）】
   $ grep -rhoE 'usr/local/share/[a-zA-Z]+' app/src/main/java/ | sort | uniq -c
     12 usr/local/share/deepseekharness                          ← ★ 小写，一致 ✅
【生产端脚本】
   tools/build-dsh-runtime.py:620   TarInfo('usr/local/share/deepseekharness/dsh-runtime.version')  ✅
   tools/prepare-standard-assets.py:75  if name == 'usr/local/share/deepseekharness/dsh-runtime.version'  ✅
【全局计数】share/dsha = 0 ; share/deepseekharness = 23 ✅
⇒ ★★ 结论：**生产端与消费端【已经一致】，全部小写，无缺陷。**
   此前 verifier harness 报的两条 FAIL（share/dsha 应保留 / share/deepseekharness
   不应存在）是【harness 期望值未随 KEEP=1 裁定更新】⇒ 属 harness 缺陷，非产品缺陷。
【★ 为什么这是"最硬"的证据】
   它不是"源码看起来一致"，而是【产物内部的实际字节】——
   即 K1「收敛于 shipped fork 版本实际写出的值」在【产物层】的验证。
   ⇒ 与 L6f（5 个 bin 内 brand token 断言）同源，但这次查的是【路径形态】。
   ⇒ 📌 通则：**路径类契约的真值端在【产物】里，不在源码里。
     源码只是产生路径的代码；产物才是"实际写出什么"的证据。**
```

## K23.5 ★ 审计维度再扩展：格式 vs 内容（网关时效性）
```
【java-port 的发现】品牌闸门阶段C 报 570 处命中，但全部在【旧 APK】中：
   APK mtime 03:13 < 改名后源码 mtime 03:47 ⇒ 物理上不可能含新名
   ⇒ 命中 570 处是【正确的】，但【结论】若写成"存在品牌残留"就是【误导】。
【★ 通则】**闸门的输出必须自带时效性判据，否则它自己就是幻觉源。**
   ⇒ 实现：检测 APK mtime < 源码树最新 mtime ⇒ 报文改为
     `[STALE-APK] 阶段C 跳过：APK 早于源码 34 分钟，请先重建`
   ⇒ 与「无基准不下结论」（K20.3）同类，但这次是【基准存在但过期】。
   ⇒ 📌 「基准存在」≠「基准有效」。必须再加一维：【基准的时效性】。
【★ 审计基准的三个必要条件（合起来才充分）】
     ① 存在（K16 存在性轴）
     ② 被追踪/可版本化定位（K22）
     ③ 未过期（本条 K23.5）
```

---

# 附录 K24 —— 批量独立复核结果（2026-09-24 08:20）

## K24.1 ✅ preset-header-anchor：三方闭合，非缺陷
```
【三方一致性（Lead 实测）】
   ① 产出端 app/src/main/assets/agent-preset-patch.json  deepseekharness-preset-header-anchor ×2
   ② 消费端 builtin-plugins/dsh-web-mobile/lib/client.js  deepseekharness-preset-header-anchor ×18
   ③ 资产端 web-integration/agent-preset-header.css       deepseekharness-preset-header-anchor ×16
   旧名残留：dsha-preset-header-anchor = 0 ; DSHA-preset-header-anchor = 0 ✅
【三版本对照（K14.1 必做）】
   上游 agent-preset-patch.json : dsha-preset-header-anchor ×9
   上游 client.js               : dsha-preset-header-anchor ×9
   当前树                       : deepseekharness-preset-header-anchor
   ⇒ ★ 上游用的是【全小写 dsha】，我们换成同形态的【全小写 deepseekharness】
     ⇒ 形态保持一致（都是 kebab-case 小写）✅ 这正是 I2 路径形态规则的正确执行
【⇒ 裁定：verifier harness 报的 "preset-header-anchor token 不一致" 是
   【harness 期望值问题】，非产品缺陷。请更新期望值为 deepseekharness- 前缀。】
```

## K24.2 ✅ runtime-descriptor：无陈旧 hash（我挂最久的红项已关闭）
```
【★ 我第一次算错 —— 基准路径错】
   我用【仓库根】解析 inputs ⇒ "实测存在 0 / 缺失 109" ⇒ 像灾难
   实际基准是 app/src/main/assets/ ⇒ 换基准后：存在 109 / 缺失 0 / 陈旧 hash 0 ✅
【★ 通则（与 java-port 同源）】**报 0 或全缺失时，先怀疑基准路径，再怀疑产物。**
   ⇒ 本轮 Lead 与 java-port 独立犯了同一类错（他用 app/ 为 cwd 查 rootProject 路径）
   ⇒ 两人独立犯同类错 ⇒ 高发陷阱 ⇒ 必须入规则
【字段核对】launcherContract=DSHA_ARM64_V2 ✅（唯一合法保留）
   dshVersion=0.1.7-alpha.2 ✅ / baseVersion='10' ✅ / bridgeProtocol=2 ✅
   dataRead=dataWrite=dsh-0.1.7-alpha.2 ✅ / version=1（未动）✅ / inputs=109 ✅
```

## K24.3 ★ runtimeId 派生规则（java-port 复现确认，我原猜测错误）
```
【真实规则】tools/prepare-runtime-descriptor.py:38
   contract = descriptor 去掉 {version, runtimeId} 后的其余 8 个字段
   identity = sha256(json.dumps(contract, sort_keys=True, separators=(',',':')))
   ⇒ java-port 复算 = 文件内值 f1e3f379… ✅ 完全一致
【★ 我的猜测（sha256(sorted(path)+value)）算不出 ⇒ 是【我基准域错了】，不是缺陷
   ⇒ ★ 与 K23.3「跨集合断言必须先证明基准一致」同源
   ⇒ ★ 通则：**"算不出来" ≠ "算错了"。必须先确认算法，再判断值。**
【★ 注意点】inputs 只是 contract 的【一个成员】：
   即使 inputs 全不变，dshVersion 变了 runtimeId 也会变。
   ⇒ 所以 runtimeId 不是"inputs 的指纹"，而是"contract 的指纹"。
```

## K24.4 ★ 幂等性 vs 内容自洽性（两种断言不可互相替代）
```
【java-port 实测】prepareRuntimeDescriptor 连跑 3 次逐字节相同 ✅
                 prepareUiLanguages run A == run B ✅
【★ 但幂等性只证明【确定性】，不证明【正确性】：
   一个恒输出错误内容的生成器也是完全幂等的。】
⇒ 两者回答不同问题：
     幂等性     回答「稳定吗」
     自洽性     回答「对吗」
   ⇒ **两者都要，不能互相替代。**（K19.4 第 ③ 步"按性质选断言"的具体化）
【已有自洽性断言】runtimeId == sha256(canonical_json(contract)) ✅
                 dataRead == ['dsh-'+dshVersion] ✅
                 bridgeProtocol/baseVersion/launcherContract 取值域 ✅
                 launcherInputs 值均为 64 位小写 hex ✅
【❌ 已放弃的错误命题】"launcherInputs ⊆ inputs"
   ⇒ inputs 基准 = app/src/main/assets/ ；launchers 基准 = 仓库根
   ⇒ 两者【故意不同基准】（launcher 含 jniLibs 与 java/runtime，不在 assets/ 内）
   ⇒ 命题本身不成立，不是数据问题（K23.3）
```

## K24.5 ✅ share/ 路径：产物层决定性证据（双向闭合）
```
【生产端真值（拆开 tarball 看实际字节）】
   $ tar tzf app/src/main/assets/dsh-runtime.bin | grep '^usr/local/share/'
     usr/local/share/deepseekharness/dsh-runtime.version        ← ★ 小写
【消费端】Java 12 处全部 usr/local/share/deepseekharness ✅
【生产端脚本】build-dsh-runtime.py:620 TarInfo('usr/local/share/deepseekharness/…') ✅
             prepare-standard-assets.py:75 同 ✅
【全局】share/dsha = 0 ; share/deepseekharness = 23 ✅
【⇒ 裁定：verifier harness 的 2 条 FAIL 是【期望值过期】，非产品缺陷。
   请更新：share/dsha ⇒ 期望 0；share/deepseekharness ⇒ 期望 ≥12。
【★ 通则】**路径类契约的真值端在【产物】里，不在【源码】里。
   源码只是"产生路径的代码"；只有产物才证明"实际写出了什么"。**
```

## K24.6 🔴 K3 长度耦合 —— 本轮唯一确认的真产品缺陷（已修 + 执行验证）
```
【位置】app/src/main/assets/webserver-auth-patch.sh:71-73
   改名前 : indexOf("dsha_t=") + slice(qi + 7)     ⇒ 7==7 ✅ 上游正确
   改名前当前树 : indexOf("deepseekharness_t=") + slice(qi + 7) ⇒ 18!=7 🔴
【★ 为什么最难发现】搜索串改了（看着对）、偏移没改（编译/语法都不报错）
【★ 失败形态】got = "kharness_t=ABC123TOKEN" ≠ tok ⇒ 认证失败，
   但表现为"需要 token"而非"token 解析错" ⇒ 排查困难
【修复（Lead 亲手）】消除耦合，不写 +18：
   const KEY = "deepseekharness_t=";
   const qi = url.indexOf(KEY);
   url.slice(qi + KEY.length)
   ★ 并【额外加固】：Set-Cookie 与 Cookie 比对两处也改用 KEY
     ⇒ 三个使用点共用同一字面量 ⇒ 物理上不可能"改一半"
【★ 执行验证（实跑 node）】
   修复后 ⇒ "ABC123TOKEN" ✅ ；旧写法 ⇒ "kharness_t=ABC123TOKEN" ❌
   边界：带其他 query ✅ / 带 hash ✅
【★ 通则入文档】**凡 indexOf(X) 后跟 substring/slice 硬编码偏移的，
   偏移必须由 X.length 导出。改名时"搜索串"与"偏移量"是一对必须同步的耦合量。**
   ⇒ 自动检测判据：扫 indexOf("...") 附近 slice(qi + N) 且 N != 字面量长度 ⇒ FAIL
```

## K24.7 ★★ 重复书写 = 不一致的结构性来源（两个独立缺陷同根因）
```
【现象】本轮发现的两个缺陷，形态不同但根因相同：
   ① java-port 发现："只改引用不改定义"（dsha_launcher_foreground 引用侧改了、定义侧没改）
   ② verifier 发现：K3 长度耦合（搜索串改了、偏移没改）
【★ 共同根因】同一契约值在多处【重复书写】
   ⇒ 只要一个值出现 N 次，改名就有 N 个可能不一致的地方
   ⇒ ★ 正解不是"更仔细地改 N 处"，而是【收敛为单一常量】⇒ 让不一致物理上不可能
   ⇒ 本案执行：webserver-auth-patch.sh 的 3 处字面量 ⇒ 收敛为 KEY
【★ 通则】**"重复书写"是缺陷的结构性来源，不是执行纪律问题。
   消除重复（提取常量）比"小心地改每一处"更可靠。**
   ⇒ 与 K20.2（白名单必须极小且可证）同属"用结构消除可能性"的思路。
```

## K24.8 ★ 审计基准的三个必要条件
```
综合本轮教训，一个"基准"要能用，必须同时满足：
   ① 存在（K16 存在性轴）—— 清单里的对象现实中存在
   ② 可版本化定位（K22）—— 在 git 里或显式白名单里
   ③ 未过期（K23.5）—— 产物晚于其源
⇒ 缺任一条，基于它的结论都不可辩护。
【两个已发生的实例】
   · ② 缺失：451 项未追踪 ⇒ messages.json 从未被审计（K22）
   · ③ 缺失：旧 APK 被当基线 ⇒ 闸门报"570 处品牌残留"（K23.5）
```

---

# 附录 K25 —— 全量资源引用存在性断言（2026-09-24 08:30）

## K25.1 ✅ drawable 引用图闭合（Lead 全量实测，82 定义 / 58 引用名 / 悬空 0）
```
【方法】解析 res/ 全部 XML：
   定义集 = drawable*/ 下的文件名 stem  ∪  <item type="drawable" name="X">
   引用集 = @drawable/X 与 @android:drawable/X
   断言：引用集 ⊆ 定义集
【结果】
   drawable 定义数: 82    引用名数: 58    ★ 悬空引用: 0  ✅
   deepseekharness_brand                : 定义 True / 被引用 1 次 ✅
   deepseekharness_launcher_foreground  : 定义 True / 被引用 3 次 ✅
【★ 为什么必须做这个断言】
   java-port 差一点造成 aapt2 编译失败（命名规范化时把"引用侧"改了、"定义侧"没改），
   形态是：3 个自适应图标 → @drawable/deepseekharness_launcher_foreground（不存在）
   ⇒ ★ 这是 K10.1「token 边界劈开」的**新形态**：
     前几次是插入到英文词内部（handshake）；
     这次是【只改引用侧、不改定义侧】。
     共同点：替换器没有做「定义 ↔ 引用」的双向一致性校验。
【★ 通则】**任何"改名"操作必须同时更新【定义侧】与【引用侧】，且必须用
   【引用目标存在性断言】验证，而不是"我看改得挺全"。**
   ⇒ 与 K24.7（重复书写 = 不一致的结构性来源）互为补充：
     这条说"物理上不可能不一致"要靠在单点定义；
     这条说"若不得不重复"，就必须有存在性断言兜底。
【📌 建议：把本断言做成常设闸门（L6m），纳入 verify-brand-integrity.py。
   java-port 说要补进扫描器 ⇒ 正确，请务必做。】
```

---

# 附录 K26 —— Step 4 插件页还原：两个规格冲突的裁定（2026-09-24 08:50）

## K26.1 ★★ 冲突 1：ref 布局 = 同一套 style 的另一种命名形态（非"缺资源"）
```
【实测对照（Lead 独立复核）】
   本仓库 14 个：Widget.DEEPSEEK_HARNESS_Button / TextButton / ToolbarAction / CheckBox /
                DangerButton / DialogButton / DialogButtonBar / DialogNegative /
                DialogPositive / PlatformButton / PrimaryButton / RadioButton / Switch /
                BottomNavActiveIndicator
   ref   14 个：Widget.DeepSeekHarness.Button / TextButton / ToolbarAction / ...（同集合）
   ⇒ ★ 语义上一一对应，仅形态不同（下划线全大写 vs 点号驼峰）
   ⇒ ref fragment_plugins.xml 引用的 3 个（Button/TextButton/ToolbarAction）
     在本仓库【都存在语义对应物】
【★ 裁定：采用本仓库形态 `Widget.DEEPSEEK_HARNESS_*`，不照抄驼峰】
   理由：
   ① 【编译必然失败】照抄 ⇒ 3 个悬空 style ⇒ aapt2 报错
      ⇒ 与"只改引用不改定义"是同族错误（本轮已实际发生过一次）
   ② 【同族一致性】本仓库 14 个 Widget.* 全是大写下划线
      ⇒ 混入 3 个驼峰 = 制造【同族形态分裂】⇒ 正是 K7 类缺陷
      ⇒ ★ 为了"像 ref"而制造同族分裂，方向反了
   ③ 【范围爆炸】若真要统一成驼峰 = 14 处改名 + 全仓引用普查
      ⇒ 风险远超本任务收益，且用户【没有要求】
   ④ 【判定基准】K21.2：**「与参考实现不同」≠「错误」**。
      判据是【有无旧品牌】，不是【与 ref 逐字相同】。
      ⇒ ref 驼峰不含 dsha、我们下划线不含 dsha ⇒ 两者都合规
        ⇒ 选【本仓库自洽的那个】
【★ 通则】**移植参考实现时，要移植它的【结构与语义】，不是它的【标识符字面】。
   标识符应适配目标仓库的既有形态；照抄字面会同时制造编译错误与同族分裂。**
```

## K26.2 ★ 冲突 2：视觉资产与待删区块【绑定】，删区块会让资产变孤儿
```
【实测引用者分布（除 fragment_plugins.xml 外）】
   仍有引用者（必须保留）：
     bg_polished_action   被 4 个 layout/xml 引用
     ic_ui2_chevron       被 9 个 layout/xml 引用
   仅 fragment_plugins.xml 引用（删区块后失去引用者）：
     bg_polished_primary / polished_primary_text / ic_ui_copy /
     ui2_community / ui2_community_sub / bg_plugin_segment
【★ 裁定】删区块，但【保留资源文件】，并把"失去引用者的资源"清单【登记进报告】
   理由：
   ① 用户只要求"插件页不要有在线商城"，未要求删资源
   ② 删资源不属本任务范围 ⇒ 扩大范围 = 引入风险
   ③ 按 DEFECT 7 先例：孤儿文件处置需【报告】而非直接删
   ④ ★ 登记的意义：**未登记的对象 = 审计盲区**（K20.4）
      让它们成为"可审计的已知状态"，而不是"悄悄变成孤儿"
【⚠️ 相关陷阱：别名资源】bg_polished_primary / polished_primary_text 定义在
   values/drawable_aliases.xml:5-6，形态 `<item type="drawable" name="X">@drawable/Y</item>`
   ⇒ ★ 扫描器必须支持【两种属性顺序】（<item name=X type=Y> 与 <item type=Y name=X>）
     java-port 第 2 版假阳性（报 6 个）就是这个原因 ⇒ 已修 ✅
```

## K26.3 🔴 删 id 会破坏【非直接引用者】：debug source set
```
【Lead 发现的额外影响面（java-port 初始清单未含）】
   app/src/debug/java/.../ui/LayoutPreviewActivity.java:99
      visible(R.id.pluginMarketCard, !management); visible(R.id.pluginWebsiteSection, !management);
      visible(R.id.pluginLinkSection, !management); visible(R.id.pluginLocalTitle, !management);
      visible(R.id.pluginLocalCard, !management);
   app/src/debug/java/.../ui/LayoutAuditInstrumentation.java:112
      id==R.id.btnMarket
   ⇒ ★ 删除 id 后这两个文件【编译失败】
   ⇒ **删除一个资源 id，影响面 = 全仓库所有 source set 的 R.id.X 引用，**
     **不只是"看起来相关"的那个文件。**
【★ 通则（K23.1 铁律 3 的资源版）】
   **删除一个 id/资源 = 改变所有引用它的代码的含义 ⇒ 必须按【符号检索】普查全部
     source set（main/debug/low/standard/androidTest/test），而非按调用点回忆。**
```

## K26.4 ✅ 闸门"作者自漏"的价值证明（java-port 本轮的强证据）
```
【现象】java-port 的"过期产物判据"上线后，立刻抓到它自己漏报的一处：
      阶段B generated/ 也早于源码 146 分钟 ⇒ 旧串 67 处
      而它此前只报了"旧 APK 570 处"
【★ 为什么这条证据重要】
   一个判据若能抓到【作者自己也不知道】的问题，它就真的在【独立工作】，
   而不是在复述作者的已知结论。
   ⇒ 这与 L6b 的局限（product+fixture 同时错则测不出）正好互补：
     L6b 的出路是【外部真值】；本条的价值是【判据独立性】。
【★ 同类记录（本轮累计）】
   verifier 闸门自漏 8 次（含扩展名裁剪漏 assets/*.sh）
   java-port 扫描器假阳性 2 次（values/ 未读、别名属性顺序）
   java-port 过期产物漏报 1 次（只报 APK 漏 generated/）
   Lead 基准路径错 1 次（descriptor inputs 用仓库根解析 ⇒ 假报 109 缺失）
   java-port 基准路径错 1 次（用 app/ 为 cwd 查 rootProject 路径）
   ⇒ ★ **合计 13 次闸门/审计自身出错。**
     ⇒ 这是本项目最重要的元结论：**审计工具的错误率【不低】，必须被系统性记录。**
     ⇒ 因此报告必须含"闸门自身出错记录"章节，且每个闸门要标"如何被负对照抓出"。
```

## K26.5 ★ 裁定台账（本轮 Lead 的移植类裁定，供复用）
```
   ① 命名形态冲突  ⇒ 用【目标仓库既有形态】，不照抄参考实现字面
   ② 资源绑定冲突  ⇒ 删结构、留资源、登记孤儿清单
   ③ id 删除影响面 ⇒ 按符号检索普查【全部 source set】
   ④ 过期产物      ⇒ 归类为【告警 exit=0】而非缺陷，避免假红
   ⑤ 伪命题断言    ⇒ 基准不一致的跨集合断言直接【弃用】，不"修正"数据
```

---

# 附录 K27 —— 「自选更新版本」功能缺口核查（2026-09-24 09:00，Lead 实测）

## K27.1 🔴 用户需求 vs 实现现状
```
【用户指令原文】"需要加个自选更新版本的功能"
   追问裁定：「两者都要」= ① dsh-runtime 版本自选 + ② APK 版本自选
【实测现状】
   ① APK 侧 —— 部分具备：
      UpdateEngine:42   FEED = https://api.github.com/repos/xliaoy/DeepSeekHarness/releases
      UpdateEngine:142-177  解析 releases【数组】⇒ 填充 options（多个 Release）✅ 有数据
      UpdatePolicy.selectFromReleases(...)  多候选里选一个 ✅ 有算法
      ❌ 但 UpdateRepository.State 只暴露【单个】release：
         State:29  public final UpdatePolicy.Release release;   ← 单值，非列表
      ❌ 且 State 无 versions/candidates 字段
      ⇒ ★ 结论：**引擎【拿到了列表】，但【没传给 UI】** ⇒ UI 无法让用户选
   ② runtime 侧 —— 不具备：
      DshUpdater:55  latestVersion（单值）
      ❌ 无 listVersions / installVersion 方法（与 ref 逐字一致 —— ref 也没有）
      ⇒ ★ 结论：**ref 本身只有"升级到最新"，没有"自选版本"** ⇒ 这是我们【自己的设计】
【⇒ 缺口清单】
   A. State 需暴露候选版本列表（供 APK 版本自选）
   B. DshUpdater 需支持列出版本 + 安装指定版本（供 runtime 版本自选）
   C. UI 需新增版本选择控件（复用已有 update_channel_choice 的 DeepSeekHarnessSelectView 模式）
```

## K27.2 ★ 已确认的既有基础（不是从零开始）
```
   · DshUpdater 与 ref 【逐字一致】(484 行 diff 为空) ✅
     ⇒ 说明运行时升级链路已完整移植
     ⇒ 且 ref 的 npmRegistry() 默认 https://registry.npmmirror.com（国内镜像）
       API: {registry}/@deepseek-ai%2Fdsh/{version}  ← ★ 注意：按【版本】取元数据
       ⇒ ★ **npm 接口本身就是"按版本查询"的** ⇒ 自选版本【在协议层天然可行】
       ⇒ 这是好消息：runtime 自选版本不需要新协议，只需把版本号变成参数
   · UpdatePolicy.selectFromReleases 已能处理多候选 ✅
   · UpdateEngine 已能解析 GitHub releases 数组 ✅
   · UI 已有 DeepSeekHarnessSelectView（下拉选择器）可复用 ✅
     UpdateActivity:33  findViewById(R.id.update_channel_choice) 用的就是它
   ⇒ 📌 自选版本 UI 可以【复用同一个控件模式】⇒ 实现风险低
```

## K27.3 ⚠️ 与 Step 5b 白名单的相互作用（重要）
```
【已知】Step 5b 裁定 = 白名单 (A)，白名单 = { 0.1.7-alpha.2 } 唯一
   理由：12 个 patch 资产硬门禁在 Constants.DSH_VERSION = "0.1.7-alpha.2"
        （RuntimeTools:215 / :457 静默 return）
        ⇒ 装其它版本会【静默禁用】composer-enter + browser bootstrap 补丁
【★ 相互作用（必须处理）】
   若 runtime 自选版本允许选任意版本，但白名单只有 1 个版本
   ⇒ 用户会看到【一个只有 1 个选项的选择器】⇒ 荒谬 UI
   ⇒ 或用户能选非白名单版本 ⇒ 静默失去补丁 ⇒ 比不给选更糟
【★ 裁定】runtime 自选版本的候选列表 = 【白名单 ∩ 可用版本】
   · 白名单 = {0.1.7-alpha.2}
   · 候选 = 从 npm 拉到的该包版本列表 ∩ 白名单
   · 非白名单版本【不显示】（而非显示为"未适配"）
     ⇒ ★ 与 Step 5b 我先前的裁定（"显示但标未适配"）【不同】，请以本条为准：
       理由：显示一个【不可选】的项 = 制造"看起来能选其实不能"的 UI 陷阱
       ⇒ 若将来白名单扩大，候选自然变多 ⇒ 逻辑不变
   · 且应在 UI 上【说明】为什么只有这些版本可选（一句话提示）
   ⇒ 📌 这样"自选版本"在【当前】表现为"选择受支持的运行时版本"，
     而在白名单扩大后自动变成真正的多版本选择。
     ⇒ ★ 功能完整、语义诚实、不制造陷阱。
```

## K27.4 交付顺位
```
   ① Step 4 插件页 UI（java-port 进行中）
   ② 自选版本功能（本附录）—— 用户【明确要求】的功能项
   ③ 其余 P0/P1
   ⇒ ★ ② 是功能性需求，不是清理工作 ⇒ 优先级【高于】剩余 P0 清理项
   ⇒ 但【必须等 Step 4 完成】再动（两者都碰 UI，避免冲突）
```

---

# 附录 K28 —— 未追踪资产盲区：权威源裁定（2026-09-24 09:20）

## K28.1 ★★★ Lead 自身一次「无效信号」事故（第 2 次基准类错误）
```
【错误】我查 /tmp/dsha-up 的 assets 追踪状态，得到一律 "tracked=N"
   ⇒ 我据此写出结论"上游故意不追踪 ⇒ 是上游惯例，非迁移缺陷"
【★ 但】/tmp/dsha-up 【不是 git 仓库】（无 .git，是解压出来的快照）
   ⇒ git ls-files 在非仓库里【报错】，我的命令把它当"空结果"读取了
   ⇒ ★ 所以那批 "tracked=N" 【全部是无效信号】，结论不成立
【★ 通则（新增，与 K24.2 同族但更狠）】
   **"没有输出" ≠ "没有命中"。必须先断言【查询本身有效】（查询返回 0 时，
     要区分"真的没有"和"我根本没查成"）。**
   ⇒ 实现：任何 git 查询都要 `git rev-parse --is-inside-work-tree` 前置断言
   ⇒ 这与 verifier 的"负对照自包含"（K26.4 第 9 次）是同一族：
     两者都是"验证工具自身有效性"的问题
【★ 我在同一轮里【连续犯了两次基准类错误】】
   ① descriptor inputs 用仓库根解析 ⇒ 假报 109 缺失（K24.2）
   ② /tmp/dsha-up 非 git 仓库 ⇒ 假报"上游不追踪"（本条）
   ⇒ ★ 结论：**基准错误是本项目最高发的错误类型**。
     我把它列为【第 0 类风险】：任何结论之前，先验证"我的测量工具在测量什么"。
```

## K28.2 ★★★ 权威源裁定：用户自己的仓库【100% 追踪 assets】
```
【权威源】/tmp/xliaoy-ref = xliaoy/DeepSeekHarness（用户明确指定的权威参考，K9.2）
   磁盘 229 / git 229 / ★ 未追踪 0
   ⇒ ★ **用户自己的仓库，assets 一个不漏全部追踪。**
【我们的现状】
   磁盘 308 / git 230 / 未追踪 78
   其中 .gitignore 有意排除 7（*.bin / *.tar.gz / *.inputs.json）
   ★ 真实盲区 71：
      · __pycache__/*.pyc        20（生成物，应 ignore）
      · *.d.ts / *.map           30（TS 类型声明+sourcemap，构建副产物）
      · runtime-descriptor.json      1（Gradle outputs.file）
      · managed-package-proofs.json  1（Gradle outputs.file）
      · ★ 真实源码资产            19
        language-patch.json / models-navigation-patch.json / pdf-compat-patch.json /
        persona-compat-patch.json / subagent-navigation-patch.json /
        plugin-manager-navigation-patch.json / plugin-manager-policy-patch.json /
        deepseek-messages-compat-patch.json / session-interaction-patch.json /
        office-fonts-patch.json / deepseekharness-builtin.txt /
        deepseekharness-device-shell.sh / deepseekharness-deepseek-messages-compat.js /
        runtime-trial-page.js / runtime-trial-plugin.js /
        plugin-dependencies.py / plugin-transactions.py /
        web-integration/{language.js, es-compat.js, native-plugin-policy.js, session-interaction.js} /
        licenses/{gson,bouncycastle}-LICENSE.txt / builtin-plugins/dsh-tool-vscreen/* (4)
【★ 裁定（依据用户自己的仓库惯例）】
   ⇒ **这 19 个真实源码资产应当纳入 git**，理由：
     ① 用户自己的仓库对 assets 100% 追踪 ⇒ 这是【用户的既定惯例】
     ② 它们是【构建输入】（资产源码），不是生成物
     ③ ★ 它们是【改名审计的盲区】：language.js 正是
        `__DeepSeekHarness_LANGUAGE__` 的消费端（verifier 已认定唯一跨技术栈契约）
        ⇒ 这个最关键的契约文件，竟然【不在 git 里】⇒ 审计完全看不见
   ⇒ 生成物 2 个（runtime-descriptor / managed-package-proofs）：
     ★ 这是【项目自身的既有设计】（build.gradle:160/:171 声明为 outputs.file，
       写在 src/main/assets 内，供 APK 打包后运行时读取）
     ⇒ 是否追踪 = 用户惯例问题 ⇒ 建议【追踪】（参考仓库无此文件无法对照，
       但"生成物入源码树"本身是既有设计，追踪它可让版本可复现）
     ⇒ ⚠️ 但它是【每次构建都会变】的文件 ⇒ 追踪会导致频繁 diff
       ⇒ 📌 折中：**建议追踪**，理由是"可复现性 > diff 噪音"；
         并在报告里说明这是设计权衡，供用户决定
   ⇒ .pyc / .d.ts / .map：**建议补 .gitignore**（它们是生成物，不应入库）
     ⇒ ⚠️ 但注意：.gitignore 只对【未追踪】文件生效 ⇒ 若已追踪则需 git rm --cached
```
## K28.3 ★ 这解释了「为什么审计反复漏掉东西」的一半
```
【结构】本轮发现的三个盲区，根因【同一个】：
   ① messages.json 未追踪（已 add）
   ② 5 个构建脚本未追踪（已 add）
   ③ ★ 71 个资产未追踪（含唯一跨技术栈契约 language.js）
   ⇒ 根因：**构建输入不在版本库 ⇒ 一切基于 git 的审计对它们全盲**
【★ 与 K22/K23.5 合起来，构成"审计基准"的完整条件】
   ① 存在（K16）
   ② 被追踪/可版本化定位（K22）
   ③ 未过期（K23.5）
   ④ ★ 查询有效（K28.1，本轮新增）
   ⇒ 四条缺一不可。
```

---

# 附录 K29 —— 「译文失效」缺陷族的独立复核与正确计数（2026-09-24 09:35，Lead 实测）

## K29.1 ✅ 机制确认（verifier 的机制判断正确）
```
【UiText.java:18-20】
   public static String text(String value){
       if(value==null||!"en".equals(language))return value;
       String translated=UiMessages.EN.get(value);
       return translated==null?value:translated;    ← ★ 取不到 ⇒ 回退中文原文
   }
   ⇒ ★ 确认：这是【运行期按值查表】，键 = 中文原文【字面量】
【⇒ 机制成立】源码字面量改名 ⇒ 表键未改 ⇒ 英文环境显示中文
```

## K29.2 🔴 但 verifier 的「68 条」计数【过高】，正确数是 30（我实测）
```
【verifier 的口径】"上游表含 'DSHA' 且 en 非空 = 78 条；换成新形态后 68 条新键不在当前表"
【★ 问题】它只检查了"表"与"表"之间的关系，
   没有检查【这些新形态的键是否真的被源码用到】。
   而"表里有键"≠"有代码在用该键"。
   ⇒ ★ 这违反了我们自己的规则：**断言必须先证明其前提成立**（K26.3/K23.3）
     具体地：只有【源码真的用 UiText.text("该字面量") 查表】时，缺键才会造成回退。
     若源码用的是 UiText.choose(zh,en)（英文内联），则【查表与否无关紧要】。
【★ 我的正确口径】三条件同时成立才算缺陷：
   ① 源码中存在 UiText.text("X") 形式的调用（即【真的依赖查表】）
   ② X 在当前表中【无键】
   ③ X 是改名产生的（其"DSHA→DeepSeekHarness 还原形态"在上游表中【有键】）
【★ 实测结果（同口径基准对照）】
   上游树 : 字面量 1784, 无键 213（上游【固有】缺口）
   当前树 : 字面量 1836, 无键 220
   共同无键 180 / 仅当前无键 40 / 仅上游无键 33
   ⇒ 在"仅当前无键 40"中再做品牌归因：
     · ★ A 类【改名断链，真缺陷】= 30
     · B 类【上游本来就缺英文】= 8
     · （其余 2 条为路径类差异）
   ⇒ ★ **真缺陷数 = 30，不是 68。**
     差距来源：68 是"表→表"的推导，30 是"源码→表"的实测。
```

## K29.3 ★ 30 条完整清单（改名断链，英文环境回退中文）
```
ADB 保活待恢复：请回到 DSHA
ADB 保活未获系统允许，请回到 DSHA 重试
DISABLED 位置能力未开启：请到 DSHA「设备能力授权」页勾选「允许 agent 读取位置」
DSHA 3090 桥端点清单（BRIDGE_PROTOCOL=
DSHA 内置插件
DSHA 后台服务
DSHA 安全确认
DSHA 安装日志
DSHA 应用更新
DSHA 更新已就绪
DSHA 通知
DSHA后台服务
DSHA运行中
NO_PERMISSION 未授予定位权限：到 DSHA「设备能力授权」页点一下开关会引导授权
[APP_BACKGROUND] App 不在前台，弹不出提问 —— 可先 /app/notify …
[APP_BACKGROUND] 系统限制：只有 App 在前台时才能读剪贴板，可先用 /app/n…
[APP_BACKGROUND] 页面已离开或重建，请回到 DSHA 后重新提问
root 授权或执行超时，请在 root 管理器查看 DSHA 授权
⚠️ DSHA 安全确认
初始化 DSHA
安装包不是 DSHA
局域网权限未允许，请先在 DSHA 权限设置中允许
已开启：容器可读写手机存储任意文件（含 DSHA 目录外）
服务已连接，尚未授权 DSHA。点击下方授权。
未允许局域网访问，请在系统 DSHA 权限设置中允许后重试
未取得悬浮窗权限，请到系统设置 → 应用 → DSHA → 悬浮窗中允许
未找到 su；请确认手机已 root，且 root 管理器允许 DSHA 使用
管理器已安装，服务尚未连接。点击授权重新连接；若仍未连接，请启动管理器服务，并检查隐藏模式是否允许 …
请先完成 DSHA 首次初始化，完成后会返回插件安装确认页
软链接目标超出 DSHA 目录
```
## K29.4 ★★ 元规则：这是本轮【第 4 次】「口径/基准」类错误
```
【本轮口径类错误台账】
   ① verifier v1（221，跨行正则虚高）
   ② verifier v2（526，数对但无基准）
   ③ verifier「55 处/53 条」（只看当前树、归一化前）
   ④ verifier「68 条」（表→表推导，未验证源码是否真用该键）← 本条
   ⑤ Lead descriptor inputs 基准路径错（假报 109 缺失）
   ⑥ Lead /tmp/dsha-up 非 git 仓库（假报"上游不追踪"）
   ⑦ java-port launcherInputs⊆inputs 基准不一致（假报 24/109）
   ⑧ java-port 用 app/ 为 cwd 查 rootProject 路径
   ⇒ ★ **8 次中 6 次是"基准/口径"类，只有 2 次是"数值算错"。**
   ⇒ ⇒ **本项目最高发的错误类型是【基准/口径错误】，不是【计算错误】。**
【★ 我把这条升格为项目第一号风险】
   因为：计算错误会被结果异常暴露；基准错误会【安静地】给出一个看似合理的错数。
   ⇒ **每个数字都必须携带：口径定义 + 对照基准 + 采集命令。**
     三者缺一，该数字只能作为【观测值】，不能作为【缺陷证据】。
【★ 实操检查表（建议写入每个闸门）】
   ① 我的查询真的执行成功了吗？（区分"没有结果"与"查询失败"）
   ② 我的两个集合用同一基准吗？
   ③ 我的"命中"真的会被消费吗？（命中≠可达）
   ④ 我的基准过期了吗？
```

## K29.5 处置裁定（出包后执行）
```
【方案 A 采纳】补 30 个新键（zh = 改名后新形态，en = 上游旧键的 en 原值）
   ⇒ 纯数据补齐、不碰源码、译文可继承 ⇒ 零翻译成本、零编译风险
【方案 B 否决】源码改回旧键 ⇒ 键将含旧品牌名 ⇒ 与用户指令直接冲突
【方案 C 记为改进项】键与显示解耦（稳定 ID 查表）⇒ 根治方案，超出本轮
【★ 前置核实（已在 K29.2 完成）】
   当前表中【旧键 '关于 DSHA' 已不存在】⇒ 属"断链"而非"新增遗漏"
   ⇒ 报告措辞应为"改名后译文表的旧键未同步替换，导致 30 条文案在英文环境回退中文"
```

---

# 附录 K30 —— 悬空 id 普查：三次口径递进与「17 vs 8」的真相（2026-09-24 09:45）

## K30.1 ★ 同一个问题，三方给出三个数（8 / 15 / 17 / 0）——全部有理，全部不完整
```
【Lead 第一版】8 个悬空
   查法：grep -rhoE 'R\.id\.(btnMarket|pluginMarketCard|pluginWebsiteSection|
         btnPluginWebsite|pluginLinkSection|pluginLocalTitle|pluginLocalCard|
         installedControls|btnPluginInstall|btnPluginPaste)'
   ⇒ ★ 缺陷：**我用了"候选集名单"而不是"全集穷举"** ⇒ 只能发现【我想到的】
   ⇒ 漏了 statusText / pluginBusy / btnCancelPluginTask / appbar_github_input / btnInstalled
【java-port 第二版】17 个
   查法：他知道自己删了哪些 id，按【删除清单】反查
   ⇒ ★ 更准确，因为他的依据是【产出端】（我删了什么），而非【我猜消费者会引用什么】
   ⇒ 这正是 K1「改哪一侧取决于哪一侧是产出端」的又一次应用
【Lead 第三版（本轮）】0 个
   查法：★ 双向全集
     ① 采集所有 R.id.X 引用（262 个项目内引用）
     ② 采集所有 id 定义（layout 306 + ids.xml 4 + menu）
     ③ 求差：引用 − 定义
   ⇒ 输出空 ⇒ 悬空 0 ✅
【★ 教训：为什么必须用"全集穷举"而不是"候选集"】
   候选集方法的检出能力 = |候选集 ∩ 真实悬空|，
   而候选集是我【凭记忆/凭推理】构造的 ⇒ 它的完备性无法自证。
   ⇒ ★ **"我想到的" ≠ "存在的"**（与 K19「审计维度完备性」同族）
   ⇒ 通则：**任何"存在性断言"，其采集侧必须是【全集穷举】，
     不得是【候选清单】。候选清单只能用于【缩小范围】，不能用于【下结论】。**
```

## K30.2 ★ 一次差点发生的假警报：`android.R.id.*` 与项目 `R.id.*` 混淆
```
【现象】我的全集穷举报出 2 个悬空：content / text1
【★ 但它们是 android.R.id.content / android.R.id.text1 —— 框架内置 id，完全合法】
【根因】我的正则 `R\.id\.[a-zA-Z_0-9]+` 会匹配 "android.R.id.content" 里的 "R.id.content"
   ⇒ 把【带命名空间的框架 id】误当成了【项目内 id】
【★ 修正】采集时排除前缀 android.
   ⇒ 修正后：项目内引用 262，悬空 0 ✅
【★ 这条与 K28.1 同族（"没有输出≠没有命中"）】
   这次是反向的：**"有输出" ≠ "命中目标"**。
   ⇒ 两者合起来是一条完整通则：
     **计数工具必须同时证明【不漏】与【不误】——
       漏（false negative）与误（false positive）是两个独立方向，
       必须分别设计证据。**
   ⇒ java-port 上轮那 2 次"扫描器假阳性"、verifier 的"8 个 bg_* 假阳性"、
     我这次"android.R.id 假阳性" ⇒ ★ 本项目【假阳性已出现 4 次】
     ⇒ 说明：**在"漏改"之外，"误报"是同等量级的风险，且更容易浪费一轮返工。**
```

## K30.3 ✅ 最终实测结论（可作为验收证据）
```
   项目内 R.id 引用总数 : 262
   id 定义侧            : layout 306 + ids.xml 4
   悬空引用             : ★ 0
   fragment_plugins.xml : 14 个 id，@string 引用 13 个，缺失 0
⇒ ★ Step 4（插件页 UI 复原）在【符号层面】闭合。
```

## K30.4 ★ java-port 的两处"非机械替换"值得记录（避免将来被误认为偷懒）
```
【① statusText 消失后的判据替换】
   原断言：读 layout 里的 statusText View
   ★ 新断言：读 repository.state().getValue().message（权威数据源）
            + 另加"页面确实已渲染"的断言
   ⇒ ★ 这是【升格】：从"读派生视图"改为"读权威源"，
     且【没有为了变绿而删除断言】。
   ⇒ 符合我们"不许降低判据强度"的要求。
【② PluginUiInstrumentation 的路径替换】
   原路径：btnPluginInstall → 点击 → 下载 → 取消
   ★ 新路径：btnOnlineInstall → 对话框 EditText 填地址 → 安装 → 进度框 NEGATIVE 取消
   ⇒ ★ 保持了【真实用户路径】语义（不是直接调 API）
   ⇒ 这两条应写入报告，说明"引用被删 id 的测试不是被删除，而是被【重新锚定】"。
```

---

# 附录 K31 —— 「死资源」假设被推翻：Lead 第 3 次口径错误（2026-09-24 09:55）

## K31.1 🔴 Lead 的错误假设与 java-port 的正确反驳
```
【Lead 的假设】values/ui_strings.xml 有 216 条 <string name="ui_mXXXX">，
   但"全仓库只有 1 处 Java 引用 R.string.ui_mXXXX"（我实测 UpdateActivity.java:34）
   ⇒ 我推断："这 216 条是 DEPRECATED 死资源，对用户几乎无影响"
【★ java-port 的反驳（他的口径：定义 & (Java ∪ XML) 引用）】
   定义 216 / 被引用 77 / 无引用 139
   ⇒ ★ 关键：**XML 侧有 87 处引用**（layout/*.xml），我只查了 Java 侧
【★ 我独立复核（自己重测，未采信）】
   ① values/ui_strings.xml 定义       = 216
   ② values-en/ui_strings.xml 定义    = 216  ★ 存在，且名集一致
   ③ Java 侧 R.string.ui_m*           = 2
   ④ XML 侧 @string/ui_m*             = 88
   ⑤ 去重后实际被引用                 = 77
   ⑥ ui_m0173 zh="稳定版" en="Stable" ✅；ui_m0215 zh="预览版" en="Preview" ✅
   ⇒ ★★ **java-port 正确，我错误。** 这 216 条是【活跃资源】，
     且【有完整的英文对照】⇒ 不是死资源，也没有英文回退。
```

## K31.2 ★★ 根因：我的采集维度【只覆盖了 Java，漏了整个 XML 资源引用面】
```
【我查的】R.string.ui_m*  （Java 侧）
【我漏的】@string/ui_m*   （XML/layout 侧）★ 88 处
【★ 这是"审计维度完备性"（K19）的又一次失败，且是【同一类】的第 3 次】
   ① verifier：按扩展名判语言 ⇒ 漏了 assets/*.sh（K26.6）
   ② verifier：抽取口径未归一化 ⇒ 报 55（K29）
   ③ Lead：只查 Java 引用 ⇒ 漏 XML 引用（本条）
   ⇒ ★ 共同根因：**"引用"这个概念在 Android 项目里是【多通道】的**
     · Java  ：R.string.X / R.id.X / R.drawable.X
     · XML   ：@string/X / @id/X / @drawable/X
     · 资源别名：<item name=X> / values/*.xml 定义
     · assets：字符串字面量
     ⇒ 只查任一通道 ⇒ 系统性漏报
【★ 通则（升格为项目强制口径）】
   **在 Android 项目里断言"某资源是死的/某引用是悬空的"，
     其采集侧【必须】同时覆盖 Java(R.*) 与 XML(@*) 两个通道。
     缺任一通道，结论无效。**
   ⇒ 本条与 K30 的"全集穷举 vs 候选清单"合起来，
     构成"资源引用类断言"的完整要求：
       ① 采集要【全集穷举】（K30）
       ② 采集要【覆盖所有通道】（本条）
       ③ 要求差【双向】（定义−引用 与 引用−定义）
```

## K31.3 ★ 若我按错误结论行动，会造成【把好包改坏】
```
【我原本的倾向】把 216 条 ui_m* 判为死资源 ⇒ 降级其严重度（甚至考虑清理）
【★ 若真去删】⇒ ★ **87 处 layout 引用立刻编译失败** ⇒ 出一个坏 APK
   ⇒ 这正是 K18.3「凡声称'不能改'必须给出可复现失败证据」的镜像：
     **凡声称"可以删"，同样必须给出可复现的安全证据。**
   ⇒ 我当时的"证据"只有 Java 侧 1 处引用 ⇒ 属于【单通道证据】⇒ 不成立
【★ 幸好】java-port 独立复核并反驳，且给出了另一通道的硬数字（87/88 处）
   ⇒ 这是【团队交叉验证挽救了 Lead 的错误】的实例，应写入报告。
```

## K31.4 ✅ 出包利好：这 432 条中英资源【零品牌残留】
```
   grep -c 'DSHA' values/ui_strings.xml       = 0
   grep -c 'DSHA' values-en/ui_strings.xml    = 0
   ⇒ 不会触发出包断言
```
## K31.5 ★ 本轮口径/基准类错误台账更新（第 9 次）
```
   1. verifier v1  221（跨行正则虚高）
   2. verifier v2  526（无基准）
   3. verifier     55/53（未归一化对照）
   4. verifier     68 （表↔表机械替换，未验源码可达性）
   5. verifier     46 vs 31（口径不同，最终收敛）
   6. Lead         descriptor inputs 基准路径错（假报 109 缺失）
   7. Lead         /tmp/dsha-up 非 git 仓库（假报"上游不追踪"）
   8. Lead         ui_m* "只有 1 处引用"（只查 Java，漏 88 处 XML）★ 本条
   9. java-port    launcherInputs⊆inputs 基准不一致（假报 24/109）
  10. java-port    用 app/ 为 cwd 查 rootProject 路径
  11. java-port    扫描器 2 次假阳性
  12. verifier     8 个 bg_* 假阳性（release 压缩改名 res/）
  13. Lead         android.R.id 被当成项目 id（假阳性）
   ⇒ ★ 13 次中：**基准/口径类 8 次、假阳性 4 次、假阴性 1 次**
   ⇒ ⇒ **【本项目的头号风险是"口径与通道完备性"，不是"计算"】**
   ⇒ 📌 每个数字的【证据三要素】= 口径定义 + 对照基准 + 采集命令，
       且采集命令必须【覆盖全部通道】。缺一即降级为"观测值"。

---

# 附录 K32 —— 译文缺陷族的【最终收敛】：46 → 30（2026-09-24 10:05）

## K32.1 ★ 最终结论：真正的 i18n 回归 = **30 条**，其余 16 条【均已同步，不受影响】
```
【方法：对 46 条候选逐条做"是否真的会失去英文"的判定】
   ★ 判据不是"源码是否含新形态"，而是【该文案的英文从哪来】：

   ① UiText.text("X")            = 30 条  ⇒ ★ 按值查 messages.json ⇒ 缺键 ⇒ 回退中文 🔴真缺陷
   ② UiText.choose(zh, en)       =  2 条  ⇒ 英文【内联】⇒ 不查表 ⇒ 不受影响 ✅
   ③ 资源 XML（ui_strings / ui_iteration）= 11 条
        ★ 我按【资源名配对】验证 values-en：ui_m0059/0064/0069/0084/0092/0105/0124/0144
          + ui2_start/ui2_meet ⇒ ★ **8/8 + 2/2 全部有英文，且英文里已是 DeepSeekHarness** ✅
        ⇒ ★ 不受影响（改名的英文已被同步到 values-en）
   ④ Java 拼接（StorageActivity / PluginRepository / AccessibilityService）= 3 条
        · StorageActivity：其实用的是 t(zh,en) = UiText.choose ⇒ 归入②类 ✅
        · PluginRepository:489  "已将 N 个插件…" ⇒ 动态拼接，不走表 ✅
        · AccessibilityService:204 "…配对助手 打开。" ⇒ 动态拼接，不走表 ✅
        ⇒ 均不受影响
   ⇒ ★★ **最终：30 条真缺陷 + 16 条不受影响。**
```

## K32.2 ★ 为什么"11 条 XML 其实没事"是这次审计最反直觉的发现
```
【直觉】源码 zh 改了 ⇒ 译文表（messages.json）键失配 ⇒ 英文丢
【★ 但 XML 资源走的是【另一套机制】】
   Android 资源系统：values/ 与 values-en/ 【按资源名】配对，与内容无关
   ⇒ 只要 values-en/ui_strings.xml 里的 en 文本被同步改名，就【不会回退】
   ⇒ 实测确实已同步（ui_m0069 en='About DeepSeekHarness · Community' 等）
【★ 而我们建的【31/46/68】三个数字里，XML 类被反复算进去 —— 全部是虚高】
   ⇒ 根因：**把"messages.json 的键失配"这一机制，
     错误地外推到了【不依赖 messages.json 的资源通道】上。**
   ⇒ ⇒ 这正是 K31.2「资源引用是多通道的」的镜像：
     **译文来源也是多通道的（表 / 资源 / 内联），各通道的失配条件不同。**
     不能用同一个判据横扫。
【★ 通则（新增）】
   **凡断言"某文案失去译文"，必须先确定该文案的【译文来源通道】，
     再按该通道的配对规则判定。跨通道套用判据 = 系统性虚高。**
```

## K32.3 ✅ 最终可交付数字（带证据三要素）
```
【数字】英文环境回归文案 = 30 条
【口径】源码中存在 UiText.text("X") 调用 ∧ X 不在 tools/i18n/messages.json 的 zh 集合中
        ∧ X 的新形态可由上游旧键（含 DSHA 且 en 非空）改名得到
【基准】上游 /tmp/dsha-up 同口径 = 214 条无键（上游固有缺口）；
        当前 = 221 条；仅当前多出 33 条；扣除不含品牌名者后 = 30
【命令】python3 /tmp/migration-evidence/l6m-i18n-reachability.py
        （verifier 交付，含退出码与双向负对照说明）
【影响】仅 en 语言环境可见；zh（默认）不受影响；不影响编译与出包
【修复】补 30 个键：zh=新形态，en=上游 en 原文【并把 DSHA 换成 DeepSeekHarness】
        （唯一例外 DSHA_ARM64_V2）
【持久性】messages.json 是 Gradle inputs.file（build.gradle:206），
          写入路径命中 0 处（Lead 与 java-port 独立确认）⇒ 补键不会被覆盖
```

## K32.4 ★ 这一条是「同一数据、四个数字」的完整演化，应作为方法论案例
```
   68  →  46  →  31  →  30
   68：表↔表机械替换（未验证源码可达性）
   46：源码全文含新形态（未区分消费通道）
   31：UiText.text 可达性（正确口径，verifier 收敛）
   30：+ 排除 values-en 已同步的个案（Lead 最终收敛）
   ★ 每一次收敛都【不是数据变了，而是判据变准了】。
   ⇒ 这正是我升格为项目第一号风险的那条：**口径错误是最高发错误类型。**
   ⇒ 也说明：**verifier 的"31"已经很接近正确；剩下 1 条差异属边界案例。**
   两个数都应以 30±1 量级呈现，并说明"含 1 条边界待人工确认"。

---

# 附录 K33 —— ★★ 构建闸门阻断根因：「内容寻址派生物 + 元数据哈希」未随改名重生成（2026-09-24 10:20）

## K33.1 现象与失败点
```
> Task :app:prepareStandardAssets FAILED
  ValueError: dsh 离线运行时与当前补丁/依赖锁不一致，请重新生成 dsh-runtime.bin
```
## K33.2 ★ 三合一校验逐项实测（Lead 独立复现，未采信 verifier）
```
prepare-standard-assets.py:134-136
  ① metadata.version       == package.json dependencies['@deepseek-ai/dsh']
        meta='0.1.7-alpha.2'  expected='0.1.7-alpha.2'      ⇒ ✅ 通过
  ② metadata.inputs        == builder.recipe_inputs()          ⇒ ❌ ★唯一失败项
        12 项中 10 项一致，漂移 2 项：
          tools/dsh-runtime/package.json
          tools/dsh-runtime/package-lock.json
  ③ metadata.archive_sha256 == sha256(dsh-runtime.bin)
        meta=fd9e4451a232654a  real=fd9e4451a232654a        ⇒ ✅ 通过
```

## K33.3 ★★ Lead 的深挖：比 verifier 报告更精确的三层事实
```
【第一层：漂移到底是什么】
   repo 内 tools/dsh-runtime/package.json  vs  /root/dsh-build-work/locked-dsh-runtime/package.json
       全字段差异 = ['name']  （deps 相同、version 相同）
       即：'dsha-locked-dsh-runtime' → 'deepseekharness-locked-dsh-runtime'
   ⇒ ★ 是本轮【品牌改名】改了锁文件，但没有重生成 bin
【第二层：记录哈希到底对应谁 —— ★ 决定性证据】
   inputs.json 记录: tools/dsh-runtime/package.json = 2dbe8dcad4dadcaea76bf809
   实测 /root/dsh-build-work/locked-dsh-runtime/package.json = 2dbe8dcad4dadcaea76bf809  ★完全匹配
   实测 repo/tools/dsh-runtime/package.json                 = 5b74ccc198c3c16116c7a44a  ✗
   ⇒ ★★ 证明：当初生成 bin 时，recorded 哈希取自【source 目录的锁】，
     而 repo 内的锁【当时内容相同】（同一份内容，name 还是 dsha-*）
   ⇒ 且我实测：记录哈希与 repo 内锁的 HEAD 版本(951a3590/a33f15b1) 也不匹配
     ⇒ 说明 repo 内锁自 init 提交后【从未 == 记录值】，
       记录值唯一的对应物就是 /root/dsh-build-work/
【第三层：LOCK_ROOT 实际指向 —— 这决定了"重生成能否修好"】
   build-dsh-runtime.py:27  LOCK_ROOT = HOOKS.parents[4] / 'tools/dsh-runtime'
   解析结果 = <repo>/tools/dsh-runtime  ★（不是 source 目录）
   :34  recipe_inputs() 读 [本脚本, LOCK_ROOT/package.json, LOCK_ROOT/package-lock.json, ...]
   ⇒ ★★ 因此：recipe_inputs() 永远读【repo 内】的锁。
     若直接重跑 build-dsh-runtime.py，recorded 哈希会变成【当前 repo 锁】的哈希
       → inputs.json 与 repo 锁一致 → 闸门通过 ✅
       → 且归档内容【逐字节不变】（见 K33.4）
   ⇒ ⇒ ★ 结论：重生成是【正确且充分】的修法，不需要改回锁文件 name。
```

## K33.4 ★★★ 归档内容不依赖 name —— Lead 四路独立验证
```
【证据 1：name 不进归档字节】直接扫描 126MB 归档：
   grep -c 'dsha-locked-dsh-runtime'            dsh-runtime.bin ⇒ 0
   grep -c 'deepseekharness-locked-dsh-runtime' dsh-runtime.bin ⇒ 0
   （tar 全流解压再 grep 同样 0）⇒ ★ name 字段不在任何字节里
【证据 2：源码从不读 name】
   LOCK_ROOT/package.json 仅被读两处：
     :34  recipe_inputs()        ⇒ 只取 sha256（即漂移项）
     :640 --version 默认值       ⇒ 只取 dependencies['@deepseek-ai/dsh']
   ⇒ ★ 无任何代码读 name
【证据 3：归档只由 --source 构建】
   :638  --source = npm 安装后的 node_modules 目录（required=True）
   :510  source.resolve(strict=True) 后遍历打包
   ⇒ ★ 归档内容 = f(source node_modules)，与 repo 锁【内容无关】
【证据 4：依赖集匹配】
   锁声明 127 个包；实测 bin（含嵌套）内含 292 个包；
   ★ 锁 ⊆ bin = True（127/127 全部在）
   抽查 bin 内 @deepseek-ai/dsh 版本 = 0.1.7-alpha.2 == 锁声明 ✅
⇒ ★★ 四路证据一致：归档内容【正确】，失效的只是 inputs.json 的【元数据记账】。
```

## K33.5 ✅ 裁定：走【方案 A 重生成】，理由与风险控制
```
【裁定】重跑 tools/build-dsh-runtime.py 重新生成 bin + inputs.json
【理由】
 ① 它是【唯一正规修法】：让记录哈希与 repo 锁真实一致，闸门恢复通过
 ② 方案 B（只手改 inputs.json 两个哈希）= ★【伪造记账】
    ⇒ 把"我认为一致"写进文件，而没有真正重算 ⇒ 违反本项目"证据必须可复现"
    ⇒ 且将来任何人重跑会得到不同哈希 ⇒ 埋雷 ⇒ 否决
 ③ 方案 C（把锁 name 改回 dsha-*）= 直接违反用户"不能出现 dsha 品牌名" ⇒ 否决
【预期结果】archive_sha256 【不变】= fd9e4451a232654af876d3a1bdb4a0c6
  （因 name 不进内容 ⇒ 归档逐字节相同）
【风险控制（必须执行）】
 ① 先备份当前 bin 到 /tmp（126MB，实测可用空间 540G，充足）
 ② 重生成后 ★立即比对 sha256
     · 若 == fd9e4451… ⇒ 归档无变化，继续出包 ✅
     · 若 ≠             ⇒ ★【立即回滚并报告】，绝不带新产物继续
 ③ 重生成会重写 bin + inputs.json（:626-627），之后必须重跑 prepareRuntimeDescriptor
```

## K33.6 ★ 关于「这是闸门误报还是正确拦截」的判定
```
【★ 判定：闸门【正确工作】，不是误报。】
  闸门断言"源变了必须重生成派生归档" —— 这正是【内容寻址产物】应有的语义。
  ⇒ 若闸门放过，我们会得到一个"元数据说谎"的构建，
    将来无法用 inputs.json 判断 bin 是否与当前补丁一致。
   ⇒ ★ 因此这次 BUILD FAILED 应当【如实写入报告】，
     而不是当成"构建环境问题"掩盖。它证明闸门有效。
```

## K33.7 ★ 归入「改名安全四件套未闭合」家族（第 6 类）
```
  K3   长度耦合（magic offset）              ✅已修
  K29  译文表键未同步（30 条）                ⏸待补
  L6j  产物未重建（旧 APK 内含 dsha.cc）      ⏸出包后自动消解
  K33  ★ 内容寻址派生物的元数据哈希未重生成   ← 本条，当前【阻断出包】
  另： assets 未追踪（71 个盲区）             ⏸待处理
  另： 迁移整体未提交（333 文件 / 451 未追踪） ⏸用户自处理
  ⇒ ★ 共同根因：**同一个值写在多处，改名只改了其中一部分。**
     这与 K24.7「重复书写 = 不一致的结构性来源」完全同构。
  ⇒ 📌 新增规则 K33.8：
     **凡"内容寻址产物"（归档 + 元数据哈希对），源一变必须重生成；
       只改源不重生成 ⇒ 闸门拒绝是【正确行为】。
       且元数据哈希的采集基准必须与该产物生成时的基准一致，
       否则会出现"记录指向另一个目录"的幽灵哈希（本条的 2dbe8dc…/86a88bd…）。**
```

## K33.8 ★ 本条最反直觉之处（值得单独记住）
```
  inputs.json 里那 2 个"漂移"哈希，其实【从来就没对应过 repo 内的锁文件】。
  实测三方哈希互不相同：
     inputs.json 记录 : 2dbe8dcad4dadcaea76bf809   ← 对应 /root/dsh-build-work/
     HEAD 版本        : a33f15b1c3d732e7cef1217f
     当前工作区       : 5b74ccc198c3c16116c7a44a
  ⇒ ★ 也就是说：即使【不做任何改名】，这个闸门在当前工作区也【本来就会失败】。
    改名只是把"本来就存在的记账错位"暴露出来了。
  ⇒ ⇒ **教训：一个长期存在的隐藏不一致，会被一次无关的改动"点燃"。**
     排查时不要停在"是谁改坏的"，要问"为什么它以前是绿的"。
     ⇒ 若闸门以前确实通过过，则当时的 repo 锁必然 == /root/dsh-build-work/ 的锁
       ⇒ 而 HEAD 提交里的锁(951a3590/a33f15b1)不匹配
       ⇒ ★ 说明该 bin 是【本地生成的、且生成时的锁未提交】⇒ 
         这是"不可从 git 复现的构建状态"的又一实例（与"迁移未提交"同族）。

---

# 附录 K34 —— ★ Lead 的重犯：invalid-signal incident #3（同轮第 2 次）（2026-09-24 10:35）

## K34.1 事实
```
 我在派发修复时断言：`app/src/main/java/.../ui/PluginFilePicker.java` 【整个类不存在】，
   并让 java-port 新建该文件（还给了全文）。
 实测：★ 该文件【存在】，位置就在 ui/ 下，且与参考实现 /tmp/xliaoy-ref 的同名文件【字节完全一致】。
 我的错误来源：我用 ls 查的是
   app/src/main/java/com/deepseekharness/app/util/PluginFilePicker.java   ← ★ 路径写错（util/ 而非 ui/）
 得到"不存在"的结论后，我【没有怀疑自己的路径】，反而直接当成事实派发出去。
```

## K34.2 ★ 与 K28 的同族性：本轮第三次「查询无效却当成有效结果」
```
 ① /tmp/dsha-up 不是 git 仓库 ⇒ git ls-files 报错被读成"空结果"
    ⇒ 我得出"上游不追踪 assets"的错结论
 ② android.R.id.content 被我的正则当成项目内 id
    ⇒ 假报 2 个悬空 id
 ③ ★ 本条：ls 查错目录 ⇒ 断言"类不存在"
 ⇒ ★★ 三次的共同结构：
    **我做了一个【会产生合理空值/合理错值】的查询，
      然后把那个空值/错值当成了【被测对象的属性】。**
 ⇒ ⇒ 通则是【查询有效性】必须是一个【显式步骤】，而不是隐含假设：
     **任何"不存在/为空/为 0"的结论，在采信前必须再问一次：
       "我这个查询，如果对象真的存在，它会不会也返回空？"
       若会 ⇒ 该查询不能用于证明"不存在"。**
   ⇒ 对 git：先 assert `git rev-parse --is-inside-work-tree`
   ⇒ 对 文件：先 assert 父目录存在且是我以为的那个
   ⇒ 对 grep：先 assert 基线路径正确（我在 descriptor 那次也犯过）
```

## K34.3 ★ 代价与教训
```
 代价：向已冻结的 teammate 派发了一个【会造成重复/冲突】的任务
       （若他照做，会新建一个与既有文件同名的类 ⇒ 立刻"已存在"错误，或覆盖掉正确文件）
 幸好：我在他动手前自查发现并发出更正 ⇒ 未造成损害
 ⇒ ★ 教训：**派发"新建文件"类指令前，必须先证明该文件不存在，
   且证明方式要能自证有效（例如：先 ls 父目录确认父目录存在，再 ls 目标）。**
 ⇒ 我把它并入项目的「四问检查表」（K29.4）：
    ① 查询真的执行成功了吗？（新增：**成功 = 输出可信，而非退出码为 0**）
    ② 两边基准一致吗？
    ③ 命中会被消费吗？
    ④ 基准过期了吗？
    ⑤ ★ 新增：**"不存在"结论，是否用了一个"存在也会返回空"的查询？**
```

---

# 附录 K35 —— ★ K33 修正：根因不是"幽灵哈希"，而是「生成端与校验端读不同路径的锁」（2026-09-24 10:45）

## K35.1 我 K33 的措辞有误，verifier 的修正更准确（我已独立复核并采纳）
```
【我 K33 原话】"那不是改名后漂移，而是【记录指向另一个目录的幽灵哈希】"
【★ verifier 的修正】记录指向 /root/dsh-build-work 是【正确】的，不是幽灵 ——
   因为 bin 本来就是拿 build-work 的锁生成的 ⇒ 记录如实反映了生成时的输入
【我独立复核】
   HEAD   tools/dsh-runtime/package.json  : version=0.1.5-rc.1   ← ★ 旧版！
                                           name=deepseekharness-locked-dsh-runtime
   当前                                    : version=0.1.7-alpha.2
   build-work                              : version=0.1.7-alpha.2
   三方哈希各不相同（a33f15b1 / 5b74ccc1 / 2dbe8dcad）
  ⇒ ★ verifier 正确：HEAD 是 0.1.5-rc.1，build-work 是 0.1.7-alpha.2，二者【必然不同】
```

## K35.2 ★★ 修正后的根因表述（这是本轮最重要的一条结构性发现）
```
【错误表述】"记录是幽灵哈希 / 记错账"
【★ 正确表述】
   build-dsh-runtime.py:27  LOCK_ROOT = <repo>/tools/dsh-runtime
     ⇒ 【校验端】(prepare-standard-assets.py → recipe_inputs()) 读【repo 内】的锁
   bin 的实际生成输入 = /root/dsh-build-work/locked-dsh-runtime 的锁
     ⇒ 【生成端】用【repo 外】的 npm 工作树
   ⇒ ★★ 两端【读的不是同一个实体】⇒ 这是一个【结构性的路径不一致】，
       而不是"某次改名忘了同步"。
【★ 由此得出一个更强的结论（verifier 提出，我认可）】
   在"把 dsh 从 0.1.5-rc.1 迁移到 0.1.7-alpha.2"这一【任何】工作区状态下：
     repo 锁(若是 HEAD) = 0.1.5-rc.1
     build-work 锁      = 0.1.7-alpha.2
     ⇒ 两者必然不等 ⇒ ★ 该闸门【必然拒绝】
   ⇒ ⇒ **这是 dsh 版本升级的【必经步骤】，不是本次改名引入的缺陷。**
     改名只是【提前暴露】了它（改名前 repo 锁 name 是 dsha-*，
     deps 与 build-work 相同…… 但当时 version 仍是 0.1.5-rc.1 vs 0.1.7 ⇒ 依然不等）。
   ⇒ 📌 结论：**本次 BUILD FAILED 应归因于「dsh 版本迁移未完成收尾」，
     而非「品牌改名破坏了构建」。** 报告里的因果必须这样写。
```

## K35.3 ★ 新增/修正的规则条文
```
 K33.8（修正版）
   凡「内容寻址产物」（归档 + 元数据哈希对）：
     ① 其【生成端输入路径】与【校验端输入路径】必须指向【同一实体】；
        否则闸门必然拒绝，且拒绝是正确行为。
     ② 若两端不一致，重新生成是【唯一】修法（把记录改写成校验端的值）；
        只手改哈希 = 伪造记账 ⇒ 否决。
     ③ 重新生成前必须验证：产物是否【内容依赖】那些漂移的输入。
        本例中 name 字段不进归档 ⇒ 重生成产出【逐字节相同】的归档（实测证实）。
        ⇒ 一般化：**先证明"漂移的输入是否影响产物字节"，
          再决定"重生成"是修复还是重新引入风险。**
 K33.9（新增）
   以【退出码】判成败是不安全的：本例脚本在 fuseblk 上 replace 失败、
    抛出非 0 退出码，但【产物已完整写出且自洽】。
   ⇒ **必须验证【最终态】（哈希/内容/一致性），而不是看退出码。**
   ⇒ 与 K24.4「异常 ≠ 结果错误」同族。
```

## K35.4 ★ 「谁先暴露」与「谁造成的」必须分开（方法论）
```
 改名（03:42）与 dsh 版本迁移（01:38 之前）是两个独立动作。
 闸门在【改名之后】第一次运行并失败 ⇒ 直觉会归因于改名。
 ★ 但时间线只能证明"何时暴露"，不能证明"由谁造成"。
   ⇒ 判据是：**把该改动撤销后，闸门是否通过？**
     实测：撤销改名（repo 锁回到 HEAD 的 0.1.5-rc.1）⇒ 与 build-work 的 0.1.7 仍不等
           ⇒ ★ 闸门【仍然拒绝】⇒ 证明改名不是原因。
   ⇒ 📌 通则（升格）：**归因必须用"反事实测试"，不能用"时间先后"。**
     （这与「相关 ≠ 因果」同义，但在工程排查里极常被违反。）
```

---

# 附录 K36 —— ★ 产物级品牌断言的最终判据与两个"白名单遗留 token"（2026-09-24 11:00）

## K36.1 ★★ 新 APK 实测（Step 4 修复后首次成功出包）
```
 路径 : app/build/outputs/apk/standard/release/app-standard-release.apk
 size : 275,565,273 B
 mtime: 2026-09-24 04:58:07
 sha256: d56ac4b396027e892b13078adf5137f9bb45e6e608e46d6023fc52d763c1dcf7
 BUILD SUCCESSFUL in 1m47s

【三层口径的断言结果】
 ① L6j 主判据  dsha.cc              = 0   ✅（旧 APK 曾为 10 处）
 ② 严格口径    整词 \bDSHA\b         = 0   ✅
 ③ 原始子串    DSHA                 = 2   ← 白名单（见 K36.2）
 ④ 原始子串    dsha                 = 2   ← 英文词缀误报（见 K36.3）
 ⑤ 新品牌      DeepSeekHarness      = 218 ✅ 已进入产物
```

## K36.2 ★ 白名单 1：`DSHADATA` / `DSHABAK5` —— 格式魔数，**保留正确**
```
 定义处（字节数组，源码正则【看不见】，但会编译进 dex）：
   backup/BackupArchive.java:9        MAGIC={'D','S','H','A','D','A','T','A'}
   backup/PortableBackupCrypto.java:16 MAGIC={'D','S','H','A','B','A','K','5'}
 用途：备份归档 / 便携加密备份的【文件格式标识】，定长 8 字节写入文件头
 上游对照：/tmp/dsha-up 同名文件【一字未改】，同为 {'D','S','H','A',...}
 ⇒ ★ 判定：**保留**。它们是格式标识而非品牌：
    一旦改名，所有已存在的备份包（用旧魔数写入）都会被新版本判为
    "ARCHIVE_VERSION / 格式错误" 而【无法读取】⇒ 改了才是缺陷。
 ⇒ 📌 这解释了为什么 verifier 的白名单里有它们，且【必须】有。
 ⇒ ★ 方法论：**字节数组常量是源码正则的盲区。**
    grep 源码永远找不到 `{'D','S','H','A'...}` 形态的字符串，
    但它确实会进入 dex。⇒ "源码 0 命中" ≠ "产物 0 命中"，
    两者是【不同口径】，必须分别采集（这正是我们把 L6j 定义为产物级判据的原因）。
```

## K36.3 ★ 白名单 2：`dsha` 出现在 `HandshakeKDFFunction` —— 英文词缀误报
```
 classes3.dex 内唯一命中：
   HandshakeKDFFunction
   Lorg/bouncycastle/crypto/engines/EthereumIESEngine$HandshakeKDFFunction;
 ⇒ ★ 根因：'handshake' 内含子串 'dsha'（hand**SHA**ke → 实际是 hand-SHA-ke，
   其中的 "dsha" 来自 "…ndsha…"）。这是【英文单词的一部分】，不是品牌名。
 ⇒ ★ 这正是本项目反复遇到的 **WORD-INFIX 缺陷**（32 处大规模误报的同一根因），
    已在 K7/词中缀白名单里处理过；此处是它在【产物 dex】层面的重现。
 ⇒ 📌 通则：**边界必须用词边界或明确的 token 形态，
    绝不能用裸 substring 匹配 —— 在源码层和产物层【都】成立。**
```

## K36.4 ★★ 三层判据的优先级（写入验收标准）
```
 判据层次        采集方式                     本 APK 结果   说明
 ① L6j 主判据   产物 dex 内 'dsha.cc'         0 ✅         最强：直接对应品牌域名残留
 ② 整词口径    产物 dex 内 \bDSHA\b           0 ✅         排除词中缀
 ③ 原始子串     产物 dex 内 'DSHA'            2（白名单）  必须【逐条解释】而非直接判 0
 ④ 源码口径     源码 grep                    0 ✅         必要但【不充分】（见 K36.2 盲区）
 ⇒ ★ 四者结论一致时方可判定"品牌清理完成"。
   ★ 任一层出现残留时，必须【逐条定位到定义处并给出保留理由】，不得只报数字。
   ⇒ 本条即 K16「完备性/存在性/正确性」在产物层的落地。
```

## K36.5 ★ 本轮"构建失败"的次数与性质汇总（供报告）
```
 ① prepareRuntimeDescriptor                      成功
 ② prepareStandardAssets   FAILED  inputs.json 记账不一致（真缺陷，已修 ✅）
 ③ assembleStandardRelease FAILED  chooseImport 缺失（真缺陷，已修 ✅）
 ④ assembleStandardRelease FAILED  ★ 读写竞态：编译读到 PluginFragment 中间态
        （verifier 定位：失败 04:54:55 < 文件最后写入 04:56:54）
 ⑤ assembleStandardRelease SUCCESS ✅
 ⇒ ★ 5 次中：2 次真缺陷、1 次竞态、2 次成功。
 ⇒ 竞态那次的教训已由 verifier 提出【可机器验证的冻结协议】：
     ① 90 秒静默期 ② 构建前后树指纹必须相同 ③ 指纹写入日志
   ⇒ 我采纳为待办（本轮未实现，但用"等显式回报 + 自检 grep"规避了）。
```

---

# 附录 K37 —— ★ 又可复现的词中缀误报：`Ldsha` 的 2 处"命中"（2026-09-24 11:10）

## K37.1 事实
```
 我执行：strings -a classes.dex | grep -ci 'Ldsha'   ⇒ 输出 2
 我一度判为"类路径品牌残留"（若是真的，则是严重缺陷：包名/类名层未改干净）
 ★ 逐条定位后，2 处的真实内容为：
     buildShadowCorners      ← Material Components 的方法名
     updateChildShapes       ← Material Components 的方法名
 ⇒ ★ 误报根因：我用了 `-i`（忽略大小写）
     "buil[dSha]dowCorners" 与 "updat[eChi]ldSha..." 中都含 "dsha"
 ⇒ 正确口径（大小写敏感）：
     grep -c 'Ldsha'    ⇒ 0   ✅
     grep -cE 'Ldsha[/;]' ⇒ 0 ✅（真正的类路径形态 Ldsha/...;）
```

## K37.2 ★ 这是同一个根因在本轮的【第三次】出现
```
 ① 源码层：'dsha' in 'handshake'  ⇒ 32 处大规模误报（已处理）
 ② 产物层：HandshakeKDFFunction   ⇒ classes3.dex 2 处（K36.3）
 ③ ★ 本条：buildShadowCorners / updateChildShapes ⇒ classes.dex 2 处
 ⇒ ★★ 三次全部是 **case-insensitive substring 匹配 + 英文单词中缀** 的组合。
 ⇒ 📌 结论（升级为强制规范）：
    **品牌扫描【禁止】使用裸 substring + 忽略大小写。**
    必须满足以下之一：
      a) 大小写敏感（'dsha' 而非 -i 'dsha'）
      b) 词边界（\bdsha\b / \bDSHA\b）
      c) 明确的 token 形态（如 'dsha.cc'、'Ldsha/'）
 ⇒ ★ 附带教训：**匹配命中后必须【逐条打印命中内容并人工判读】，
    不得只看计数。** 我这次就是"先看到 2，再去看是什么"才避免假缺陷；
    若直接上报"发现 2 处类路径残留"，就是一个会被推翻的结论。
```

## K37.3 ★ 可安装性最终确认（APK 交付依据）
```
 【包的标识】
   package name  : com.deepseek.harness        ✅ 与既定决策一致
   versionCode   : 145                          ✅ 与既定决策一致
   versionName   : 20260925                     ✅ 与既定决策一致
   minSdk        : 30                           ✅ standard flavor
   targetSdk     : 37                           ✅
   native-code   : arm64-v8a                    ✅ 唯一 ABI
 【应用名】application-label = DeepSeekHarness  ✅
   ★ 且 89 个 locale 的 application-label-* 【全部】解析为 DeepSeekHarness
     ⇒ 说明 app_name 在所有语言目录下都是新品牌，无一处遗留
 【签名】Signer #1 CN=DeepSeek Harness, OU=DeepSeek, O=DeepSeek, L=Shenzhen, ST=Guangdong, C=CN
   SHA-256 : d98f218af34ca55d10cbf8dda908e804aae40e7e54d0e0fecbdcd1f5462b63f7
   SHA-1   : ff672cb1d54088071ad5e1e0b3c20e0e30e98d2f
   apksigner verify exit=0 ✅ ⇒ **可安装**
 ⇒ ★ 证书 DN 也是新品牌（DeepSeek Harness）⇒ 连签名主体都完成了改名。
```

---

# 附录 K38 —— ★★ L6f 的正确口径：压缩容器上的扫描是【结构性失明】（2026-09-24 11:25）

## K38.1 事实：5 个 .bin **全部是 gzip**
```
 魔数（od -An -tx1，head -c2）：
   dsh-runtime.bin / offline-rootfs.bin / pnpm-runtime.bin /
   python-support.bin / ubuntu-tools.bin   ⇒ 全部 1f8b = gzip
 ⇒ ★ 因此在压缩流上跑 strings，只能看到【压缩后的字节】，
    看不到归档内的任何文件名或内容。
 ⇒ ★ verifier 报告的"正对照 deepseek=0"（python-support / ubuntu-tools）
    被他正确标记为"弱断言"，但真实情况更严重：
    **5 个 bin 的 L6f 断言【全部】是弱断言**，不只是那 2 个。
```

## K38.2 ★ 解开归档后的权威结果
```
 文件                 条目数     路径含 dsha/DSHA/Dsha（大小写敏感）
 dsh-runtime.bin      13,788    0  ✅
 offline-rootfs.bin    9,132    0  ✅
 pnpm-runtime.bin      1,071    0  ✅
 python-support.bin        4    0  ✅
 ubuntu-tools.bin         31    0  ✅
【成立的正对照】dsh-runtime.bin 路径含 deepseek = 13,517 ⇒ 证明解包确实能读到内容
 ⇒ ★ 对比：压缩流口径下"deepseek=0"是【看不到】；解压口径下"deepseek=13517"是【看得见】。
   ⇒ ★★ **同一个对象、同一台机器、两次"扫描"，结论完全相反。
     差别只在【容器有没有被解开】。**
```

## K38.3 ★★ 通用规则（升格，本轮最重要的方法论产出之一）
```
 【K38.3a】扫描任何【产物/归档】前，必须先确定其【容器格式】，再选择扫描层。
   判据：读魔数。1f8b=gzip / 425a=zstd / 504b=zip / 无魔数=裸文本或 tar。
   ⇒ 对压缩容器：**扫描必须在【解压后】进行**。
 【K38.3b】任何"扫描产物得 0 命中"的断言，必须附带【成立的正对照】
   —— 即"用同一扫描路径，能检出一个【已知存在】的东西"。
   ⇒ 正对照为 0 时，断言【不成立】（只能写"未检出"，不能写"不存在"）。
   ⇒ 本例中正确的正对照 = 解压后 deepseek=13,517（已知一定有大量该字符串）。
 【K38.3c】报告措辞约束：
   禁止 "该 bin 中无品牌名"；
   只能写 "解压后按 {dsha, DSHA, Dsha} 三种大小写敏感口径扫描，命中 0。
             正对照：deepseek=13,517 ⇒ 扫描有效。"
 ⇒ ★ 这三条与 K24.8（查询有效性四条件）、K34.2（"存在也会返回空"的查询）同族，
   共同构成一条元规则：
   ⇒⇒ **"0 命中"永远是一个【关于扫描器的陈述】，而不是【关于对象的陈述】，
        除非扫描器本身被证明对该对象有效。**
```

## K38.4 ★ 词中缀误报第 4 次（同根因，本附属实同一根因已 4 次）
```
 不敏感口径下 dsh-runtime.bin 得到 1 条"命中"：
   .../@smithy/core/dist-es/submodules/config/shared-ini-file-loader/loadSharedConfigFiles.js
 ★ 解析："loa[dSha]redConfigFiles" —— loadShared 内含 dSha
 【大小写敏感复核】'dsha'=0  'DSHA'=0  'Dsha'=0  ⇒ 全部 0 ✅
 ⇒ ★ 本轮同根因 4 次：
    ① 'handshake'          含 'dsha'   （源码层，曾致 32 处误报）
    ② 'HandshakeKDFFunction'（产物 dex，classes3.dex 2 处）
    ③ 'buildShadowCorners' / 'updateChildShapes'（产物 dex，classes.dex 2 处，我误用 -i）
    ④ 'loadSharedConfigFiles'（归档内，我误用 -i）
 ⇒ ⇒ ★★ 强制规范（K37.2 已立，此处再确认）：
     品牌扫描【禁止】不敏感裸 substring。
     必须：大小写敏感 / 词边界 / 明确 token 形态。
 ⇒ ★ 且【命中后必须逐条打印命中内容人工判读】—— 4 次里有 3 次是我"再看一眼"才避免假缺陷。
```

---

# 附录 K39 —— ★ 泛型推断"理论应成立却实测失败"：显式化优于压制（2026-09-24 11:40）

## K39.1 事实
```
 debug/PluginSortAudit.java:82
   PluginFragment fragment = page.getSupportFragmentManager().findFragmentById(R.id.fragment_container);
 ⇒ 编译错误：incompatible types: Fragment cannot be converted to PluginFragment

 签名：<T extends Fragment> T findFragmentById(int)
 ⇒ 按 Java 泛型推断规则，赋值目标 PluginFragment 应当能推断 T=PluginFragment
 ⇒ ★ 但实测失败（受 androidx 版本 / @Nullable / compileSdk 37 影响）
```

## K39.2 ★★ 判据：上游怎么写，就是答案
```
 全仓库 findFragmentById 共 11 处，我逐一核查：
   10 处安全 —— 且其中【所有】需要拿到具体类型的写法，
     一律【先声明 Fragment，再 instanceof 判类型 / 再显式强转】：
       LayoutPreviewActivity.java:36    androidx.fragment.app.Fragment old = ...
       InstallAuditInstrumentation.java:95  Fragment previous = ...
       FragmentEntrySelfTest.java:143   Fragment current = ...
       MainActivity.java:255,265        Fragment shown = ...
   1 处缺陷 —— 唯一违规的 PluginSortAudit.java:82 是【本轮新写】的
 ⇒ ★★ 结论：**上游的写法不是随意选择，而是【绕开了那个推断陷阱】。**
   ⇒ 当我们新写代码时，"比上游更简洁"的写法恰恰是踩坑的写法。
 ⇒ 📌 规则 K39.2：**当泛型推断"理论应成立却实测失败"时，
   选择【显式化】而不是【压制（内联强转/加注解）】。
   并且先去看上游在同一 API 上的写法 —— 那通常就是正确形态。**
```

## K39.3 ★ 审计夹具应自证前置条件
```
 建议修法（选项 A，已派发给 java-port）：
   Fragment raw = ...findFragmentById(R.id.fragment_container);
   if (!(raw instanceof PluginFragment)) throw new IllegalStateException("插件页未挂载为 PluginFragment");
   PluginFragment fragment = (PluginFragment) raw;
 【理由】后续用反射 getDeclaredField("hideBuiltinOnly") / getDeclaredMethod("render")：
   若 raw 类型不对，会抛出【难以定位的反射异常】；
   显式判类型可让失败【自解释】。
 ⇒ ★ 通则：**审计/断言工具自身必须先校验其前置条件，
   否则工具会把"环境不对"报成"被测对象不对"** —— 这正是本项目
   gate-error 账本里"基线/口径类错误占多数"的同一个病根（K29.4）。
```

## K39.4 ★ 影响定性（关键：不阻塞交付）
```
 ① 该文件属 debug source set ⇒ 不参与 release 出包
 ② 我已独立验证：unzip -l standard-APK | grep -c PluginSortAudit ⇒ 0
    ⇒ debug 类确未进入 release 产物
 ⇒ ★ **两个 release APK（standard / low）的有效性不受影响，用户可安装使用。**
   ⇒ 但它阻断了【单测链】(compileStandardDebugJavaWithJavac) ⇒ 必须修，否则 ④⑤ 跑不了。
 ⇒ 📌 报告须区分：【阻塞交付】与【阻塞验证】是两件事，不可混为一谈。
```

---

# 附录 K40 —— ★★ 三次阻断全部落在 debug/androidTest 夹具：一类系统性风险（2026-09-24 11:50）

## K40.1 事实：连续三次阻断，全部在【非 release】source set
```
 ① PluginFragment.chooseImport 缺失        → main（真参与出包）★ 唯一的 main 类
 ② itemActions 的 UiText 包装被删           → main（真参与出包）★ 
 ③ PluginSortAudit.java:82 泛型推断失败      → debug source set
 ④ PluginSortAudit.java:82 同上（本条）      → debug source set
 ⇒ ★ 更正：①② 属 main（会进 release 包），③ 属 debug（不进包）。
   ⇒ 因此【不能说】"阻断全在夹具" —— 前两次确实影响出包。
   ⇒ 但 ★ 后两次（同一处）确实只在 debug。
```

## K40.2 ★ 真正的结构性原因：审计夹具与主代码【消费同一套标识符】
```
 debug/ 与 androidTest/ 里的审计夹具，为了取到内部状态，大量使用：
   · 反射：getDeclaredField("hideBuiltinOnly") / getDeclaredMethod("render")
   · 直接引用：R.id.xxx、PluginFragment.xxx、UiText.text(...)
 ⇒ ★ 因此【main 的任何一次重命名/删除/签名变化，都会打断夹具】。
 ⇒ 本项目刚刚做的是【全量品牌改名 + 大规模 UI 重构（去商城版）】
   ⇒ ⇒ ★★ 夹具是【这次改动的最大受害面】，且它：
        ① 不参与出包 ⇒ 不会被 assembleRelease 暴露
        ② 只在 test/debug 编译时才暴露
        ③ 一次只报一条 ⇒ 逐个浮现
   ⇒ 📌 这解释了为什么"包已经能出了，但验证链一直卡住"。
```

## K40.3 ★★ 规则：改动的【受害面】必须按"谁消费了被改的标识符"来枚举
```
 ⇒ 这是 K23（改一个值要普查全部消费者）的又一次实例，但它在【source set 维度】上：
   ⇒ ★ 普查消费者时，必须以 source set 为显式维度：
       main ∪ debug ∪ androidTest ∪ (test) —— 一个都不能漏。
   ⇒ 本项目的验证方式（assembleRelease 通过）【天然看不到】debug/androidTest 的破坏。
   ⇒ ★ 因此验收标准必须【显式包含】：
       compileStandardDebugJavaWithJavac 与 compileStandardDebugAndroidTestJavaWithJavac
     否则"能出包"会被误当成"改干净了"。
```

## K40.4 ★ 效率规则：编译错误必须【全量采集】，不得逐条往返
```
 javac 在若干错误后会停止报告；Gradle 输出也可能被截断为"首条"。
 ⇒ ★ 正确做法：
     ① 单独跑 compile 任务（不跑 full build）
     ② --continue 以获得更全的清单
     ③ grep -E 'error:' <log> | sort -u 一次性取出
     ④ 把【全量清单】交给修复方，一轮改完
 ⇒ 📌 本项目已因"一次一条"浪费了多轮往返（java-port 明确反馈"缺 project classpath
    无法本地全量编译，只能被动逐条响应"）。
 ⇒ ★ 通则：**当修复方无法本地复现时，验证方必须承担"提供完整错误清单"的责任。**
    否则往返成本由双方共同承担，且与错误数量成正比。
```

## K40.5 ★ 口径差实例（java-port 主动标注，值得记录为正面案例）
```
 我报 findFragmentById"共 11 处"；java-port grep 到 12 处。
 差异 = 他在 :82 新增的【注释里含方法名】，被文本 grep 计入。
 ⇒ 按【调用点】口径 = 11（一致）；按【文本命中】口径 = 12。
 ⇒ ★ 他主动标注差异并说明原因，避免了复查时的误判。
 ⇒ 📌 这正是 K29.4 要求的"每个数字都必须带口径定义"的正面执行。
   反例：我此前多次因口径未声明而把"文本命中"当成"调用点计数"，
   或把"压缩流命中"当成"归档内容命中"（K38）。
 ⇒ ★ 结论：**口径差异本身不是错误，不声明口径才是错误。**
```

---

# 附录 K41 —— ★★ 元规则的第三个变体：零命中必须同时证明【探测器有效】+【样本非空】（2026-09-24 12:00）

## K41.1 事件：verifier 自查出第 12 次闸门错误
```
【错误】glob 'app/build/test-results/**/*.xml' ⇒ 返回 0 个文件
        而脚本【无条件】打印 "✅ 全绿"（因为 0==0 && 0==0）
 ⇒ 差点把"我没查到"报成"全绿"
【修正】口径改为显式目录 + 断言加 tot>0 且 文件数>0
        实测结果：121 个 XML / 631 tests / 0 failures / 0 errors / 0 skipped ✅
 ⇒ ★ 值得肯定：他【主动】报告了自己的错误，且是在他把该规则写进报告之后。
   ⇒ 这说明规则已被真正内化，而不是抄写。
```

## K41.2 ★★ 元规则（三个变体合并）
```
 本项目反复出现的"假绿/假红"，根因全部可以归到一个母规则：

 ┌─ 母规则 ────────────────────────────────────────────────────────┐
 │ "零命中"或"零失败"【不能】直接作为结论。                          │
 │ 只有当【探测器对该对象有效】且【样本空间非空】时，才成立。         │
 └──────────────────────────────────────────────────────────────────┘

 三个变体（本轮全部实际发生）：
 ① 查询有效性（K24.8 / K34.2）
    "查询成功了吗？" —— 若查询在"对象存在"时也会返回空，则该空不能证明不存在。
    实例：/tmp/dsha-up 非 git 仓库（git ls-files 报错被读成空）；
          ls 查错目录（util/ vs ui/）⇒ 断言"类不存在"。
 ② 扫描器有效性（K38.3b）
    "扫描器看得见吗？" —— 必须带【成立的正对照】。
    实例：5 个 bin 全是 gzip，strings 上的"deepseek=0"是【看不到】；
          解压后 deepseek=45,047 / 13,517 ⇒ 这才是有效对照。
 ③ 样本非空（K41.1，本条）
    "样本采到了吗？" —— X==0 ⇒ PASS 的闸门必须同时断言采样空间非空。
    实例：glob 通配失败 ⇒ 0 个 XML ⇒ 却被判"全绿"。
    修正后：121 文件 / 631 tests。
```

## K41.3 ★ 为什么这三个变体本质相同
```
 三者都是【把"观察到的空"当成了"对象的属性"】：
   ① 空 = 查询失败        → 误读为"不存在"
   ② 空 = 探测器失明      → 误读为"没有"
   ③ 空 = 没采到样本      → 误读为"全通过"
 ⇒ ★ 共同的结构性错误：**缺少一个"阳性对照"（positive control）。**
 ⇒ ⇒ 因此最简洁的落地形式是一条【强制性工程规范】：
     ★★ 任何"结果为空/为零"的断言，必须【同时】给出一个"已知非空"的对照，
        且该对照走【完全相同的采集路径】。
 ⇒ 例：
    · 断言"APK 内无 dsha" ⇒ 同时给出"APK 内 DeepSeekHarness = 218"（同路径）
    · 断言"5 个 bin 无品牌" ⇒ 同时给出"解压后 deepseek = 45,047"（同路径）
    · 断言"631 测试全绿"   ⇒ 同时给出"XML 文件数 = 121"（同路径）
    · 断言"无悬空 R.id"    ⇒ 同时给出"已定义 id 总数"与"被引用 id 总数"
```

## K41.4 ★ 本轮闸门错误账本更新（第 12 条）
```
 此前 13 条（verifier 9 + java-port 3 + lead 3，其中含重复计），
 本条为 verifier 第 10 条 ⇒ 账本累计 14 条。
 ★ 分布统计更新：
   · 基线/口径/探测器类  = 11 / 14  ⇒ ★ 依然是最主要风险，远超算术错误
   · 纯误报（词中缀等）  = 4 / 14（handshake / HandshakeKDF / buildShadowCorners / loadSharedConfigFiles）
   · 其中【自查发现】    = 2（lead 的 android.R.id；verifier 本条）
 ⇒ 📌 结论不变且更强：**本项目的头号风险不是"算错"，而是"量错"——
    即用无效或口径不符的探针去测量，然后相信结果。**
```

---

# 附录 K42 —— ★★ 「看似合理的修法」可能是死代码：必须先证明修复能达成目标（2026-09-24 12:30）

## K42.1 缺陷事实
```
 backup/ExternalBackupScanner.java:80-85
   private static final String[] NAME_PREFIXES = {
       "deepseekharness-backup-", "deepseekharness-migration-",
       "deepseekharness-sessions-", "deepseekharness-plugins-", "deepseekharness-settings-",
       "deepseekharness-backup-", "deepseekharness-migration-",   ← ★ 与上组逐字相同
       "deepseekharness-sessions-", "deepseekharness-plugins-", "deepseekharness-settings-",
   };
   ⇒ 10 项、去重后 5 项；注释却说"新名与旧名各 five 个" ⇒ 注释说谎
   ⇒ 根因：机械改名把【两个语义槽】压成了同一个值（K24.7 重复书写的又一实例）
```

## K42.2 ★★ verifier 的修法被实跑证伪（本轮最重要的方法论点）
```
【verifier 建议】把第二组改成大写形态：
    "DEEPSEEK_HARNESS-backup-", "DEEPSEEK_HARNESS-migration-", ...
  ⇒ 理由：与 DIRECTORY_NAMES = {"DeepSeekHarness","DEEPSEEK_HARNESS"} 的双形态策略对齐
【★ 我用 javac + java 实跑证伪】
  looksLikeBackupName 的实现：
      String lower = name.toLowerCase(Locale.US);      ← ★ 输入已被压成小写
      for (String p : NAME_PREFIXES) if (lower.startsWith(p)) return true;
  ⇒ ★ 任何【大写前缀】在 lower 化后的输入上【恒为 false】⇒ 是【死代码】
  ⇒ 实测：数组改为大写后，目标用例 'DEEPSEEK_HARNESS-backup-2026.tar.gz'
          依然 NO-MATCH ⇒ ★ 修法【解决不了它自己要解决的问题】
 ⇒ ⇒ ★★ 通则（升格）：**提出修法时，必须证明"改完之后目标用例会通过"，
   而不是"改法看起来与别处一致"。**
   ⇒ 形式化：修复 = (症状 S, 改法 C) 满足 C ⇒ S 消失。
     仅凭"C 与同族写法风格一致"【不构成】C ⇒ S 的证明。
   ⇒ 与之对照：K18.3「凡声称"不能改"必须给出可复现失败证据」——
     本条的镜像：「凡声称"这样改就能修好"必须给出可复现通过证据」。
```

## K42.3 ★ 真正的缺口被定位为【下划线形态】，而非大小写形态
```
 lower("DEEPSEEK_HARNESS-backup-…") = "deepseek_harness-backup-…"
   ★ 下划线【保留】⇒ 与数组里的 "deepseekharness-"（无下划线）不是同一个串
 ⇒ ★ 真正的缺口是【下划线形态】。
 ⇒ 但查上游产端：BackupManager 产出
     "DSHA-backup-latest.tar.gz" 与 "root/.dsha-backup-*.tar.gz"
   ⇒ 【没有下划线形态】⇒ 该用例是【构造出来的】，历史上不存在。
```

## K42.4 ★★ 决定性定性依据：实测【真实存在的备份】全部可识别
```
 实测 /sdcard/Download/DeepSeekHarness/ 下真实文件：
   DeepSeekHarness-sessions-20260923-023712.tar.gz          → MATCH ✅
   DeepSeekHarness-sessions-20260923-092044-a7effb58.tar.gz → MATCH ✅
 原因：lower("DeepSeekHarness-…") = "deepseekharness-…" 恰等于数组里的小写前缀
 ⇒ ⇒ ★★ **现实中的备份没有被漏掉。** 缺陷的实际危害远低于探针暗示的程度。
 ⇒ 📌 教训：**构造用例证明"某输入不被识别"时，必须同时回答
   「该输入在现实中是否存在？」** 否则会把【不可能输入】误当成【真实遗漏】。
   ⇒ 这与 K41 的"样本非空"是同一族的镜像：那里是样本为空却判绿，
     这里是样本虚构却判红。
 ⇒ ★ 最终定性：低危（代码卫生类：注释说谎 + 数组冗余 + 风格不齐），非数据安全缺陷。
   裁定：本轮不修（避免第三次构建作废已交付 APK 的 sha256）。
```

## K42.5 ★ verifier 的有效观察（保留）
```
 looksLikeBackupName 在 app/src/test 下【零覆盖】；
 而现有测试恰好覆盖了 BackupOps 中【处理正确】的两个入口
   （BackupScopeTest、LegacyBackupImporterTest）
 ⇒ ★ 观察有效：**这不是"忘了写测试"，而是"测试恰好绕开了缺陷入口"。**
 ⇒ 但需【去掉】由它推出的"大写备份失联"结论（K42.4 已证伪）。
 ⇒ 📌 通则：一个正确的观察（测试盲区）【不能】用来支撑一个未经验证的后果推论。
```

---

# 附录 K43 —— ★ 品牌计数的三个数值（218/97/224）都不矛盾：它们是三种口径（2026-09-24 12:45）

## K43.1 事件
```
 同一份 APK（standard, sha256 d56ac4b3…）的 "DeepSeekHarness 出现次数"，
 三方报出三个不同数字：lead 218 / verifier 97 / lead 复算 224。
 ⇒ ★ 三个都【不是错误】，是【三种口径】。判据本身没问题，问题是没声明口径。
```

## K43.2 实测口径分解（命令：python3 zipfile + re，对象 = classes.dex）
```
  口径A【原始字节出现次数】          = 224
        re.findall(rb'DeepSeekHarness', dex_bytes)
        ⇒ 含子串情形（XXXDeepSeekHarnessYYY 也计）
  口径B【NUL 分隔、含该串的 token】  = 215
        [t for t in dex.split(b'\x00') if b'DeepSeekHarness' in t]
        ⇒ 去重前 = 去重后 = 215（字符串常量池天然唯一）
  口径C【恰好等于该串的 token】      = 0
        ⇒ 因为池里存的是类名/方法名等带前后的完整串，无裸品牌串
  ⇒ 差 224-215 = 9，全部来自【单个 token 内出现多次】
  ⇒ 另有资源侧口径：aapt2 dump strings | grep -c = 35（不含 dex）
```

## K43.3 ★★ 通则：品牌洁净度报告必须写"口径三元组"
```
 任何"清洁度计数"必须同时给出：
   ① 扫描对象（哪个文件/哪个容器：dex? resources.arsc? 解压前后?）
   ② 抽取方式（原始字节 / NUL 分词 / 唯一 token / 精确相等）
   ③ 是否含子串（这是 224 与 215 的唯一区别）
 ⇒ ★ 否则【同一个对象会合法地产生无穷多个"正确数字"】——
    然后各方争论谁对，实际都只是口径不同（K29.4 第一条的计数版本）。
 ⇒ 📌 本项目采用的权威口径（写入验收报告）：
    **唯一 token 数 / 去重 / 含子串也算品牌**，因为它对"品牌是否残留"最保守：
    只要池里任何一条常量包含品牌串，就算命中。
 ⇒ 按此口径：DeepSeekHarness = 215（classes.dex），另有 aapt2 资源串 35 条。
```

## K43.4 ★ 为什么 97 也可能是对的
```
 verifier 的 97 很可能来自：① 只扫部分 dex；② 或只统计【恰好以品牌开头/结尾】的；
 ③ 或统计的是【改名后新增的】而非全部包含者。
 ⇒ ★ 未复现前不判定其对错，但【必须标注口径】，否则与 215/224 并列会误导读者。
 ⇒ 建议：验收报告统一用 215，并注明"另有 97（口径 X）、224（口径 Y）视为同族观测值"。
```

---

# 附录 K44 —— 交付后现场诊断：两条报错均为【设计内的安全拒绝】，非崩溃（2026-09-24 14:20）

## K44.1 现场事实
```
 设备已安装 com.deepseek.harness  versionCode=145 versionName=20260925
   lastUpdateTime = 2026-09-24 14:02:54  ← ★ 用户已装上本轮构建的新包
   我的 APK 构建时间 = 04:58（standard） ⇒ 时间线自洽
 另一在装包 com.dsh.client versionCode=142 versionName=0.1.6-alpha2.1（上游对照，未动）
```

## K44.2 报错①【环境重建未完成，原件及宿主数据副本已保留：…】
```
 出处：core/EnvironmentMaintenance.java:121（rebuild 的 catch 块）
 机制：新版 APK 内置 dsh 运行时从 0.1.5-rc.1 → 0.1.7-alpha.2 发生变化
       ⇒ 首次启动触发【环境重建事务】（EnvironmentRebuildTransaction）
       ⇒ 失败时 catch 执行 transaction.rollback() 后，抛出该文案 + 事务目录 + 错误码
 ⇒ ★ 性质：【安全的失败】。它先回滚，再把原环境与宿主数据副本【原样保留】，
   并把事务目录路径回报给用户 ⇒ 这正是"宁可不动，也不半吊子"的设计。
 ⇒ ★ 不是数据丢失，不是崩溃，不是我的改名引入的缺陷。
```

## K44.3 报错②【Agent 预设适配未应用，原文件保留：上游模块结构与输入适配补丁不符，原文件保留】
```
 出处：util/ExactTextPatch.java:11
 机制：对【锁定的上游源码】做单个精确补丁时，
       old = count(source, before)    必须【恰好为 1】
       patched = count(source, after) 必须【恰好为 0】
       否则 throw "上游模块结构与输入适配补丁不符，原文件保留"
 ⇒ ★ 性质：同样是【设计内的安全拒绝】—— 它拒绝"猜测式匹配"与"部分匹配"，
   宁可不打补丁，也不改坏上游源码（"结构变化时拒绝猜测或部分匹配"，见类注释）。
 ⇒ ★ 这条【恰恰是我这轮改名预期的后果】：
   上游 0.1.7 的源码文本变了（且我也改了品牌名），补丁锚点 before 串对不上
   ⇒ 补丁拒绝应用 ⇒ 原文件保留 ✅ 这是【正确的保守行为】，不是 bug。
```

## K44.4 两条报错的共同根因
```
 两者同源：**新版运行时/上游源码 与 设备上的既有磁盘状态/补丁锚点 不匹配**。
 ⇒ 这正是"整包升级 + 全面改名"这类变更【必然】会触发的受控拒绝路径。
 ⇒ ★ 关键判断：【它们不是缺陷，是护栏在起作用。】
   如果一个迁移做完之后，旧环境被静默覆盖或补丁被强行套用，那才是真缺陷。
```

## K44.5 ★ 恢复动作（已存在于产品中，非需新写代码）
```
 ① 环境重建未完成 ⇒ 走「安装与修复」页 →「恢复中断维护」
    实现：core/BackupTask.java:183  start(UiText.text("恢复中断维护"), true, true,
                                        id -> EnvironmentMaintenance.recover(controller))
    提示文案：HarnessController:229 / DiagnosticRepository:32 已明确引导用户去该页
 ② 预设适配未应用 ⇒ 属"补丁未套用"，原文件保留；需按新上游结构更新补丁锚点
 ⇒ ⚠️ 我【未】在设备上执行恢复：① 属用户数据决策 ② 设备桥明确禁止读该目录
    （FORBIDDEN: 该路径属于凭据或运行时内部状态）
```

## K44.6 ★ 诊断纪律（本轮新增教训）
```
 · 用户给的两条文案我【没有当成 bug】，而是先 grep 源码定位其【出处与触发条件】
   ⇒ 结果证明两条都是【预期行为】。若直接"修"，就会把护栏当成缺陷拆掉。
 ⇒ 📌 通则：**报错文案必须先定位到源码出处，判断它是『护栏』还是『故障』，
   再决定是否修改。** 拆护栏比不修更危险。
 · 设备桥上该目录被 FORBIDDEN ⇒ 我【没有】尝试 su/其他通道绕过（尊重硬约束）。
 · 「正对照」的应用：桥接读文件能力先用【已知存在的 sdcard 文件】验证，
   发现连它也返回 FORBIDDEN ⇒ 说明这是【路径级策略】而非"文件不存在"（K41 变体①）。
```

---

# 附录 K45 —— ★★ 冷安装失败的真根因：agent-preset-patch.json 是【陈旧补丁集】（2026-09-24 14:30）

## K45.1 现场（用户提供日志，2026-09-24 14:09:47）
```
 版本 20260925 / 145 / 标准版
 最近失败阶段：准备应用工具
 最近失败原因：java.io.IOException: Agent 预设适配未应用，原文件保留：
              上游模块结构与输入适配补丁不符，原文件保留
 阶段链：检查安装条件 → 准备解压 → 解压 Ubuntu 与 Node → 解压 dsh 与内置依赖
        → 安装 Python 与 pnpm → 【准备应用工具 ← FAILED】
 ⇒ ★ 这是【冷安装】，不是环境重建 ⇒ 是【一级阻塞：新版全新安装无法完成】
 ⇒ ★ 这【推翻】了我上一条 K44 的宽松判断（我当时判为"护栏正常"）——
   护栏确实在正常工作，但【它拦下的是我们必须修的真缺陷】。
   教训：护栏正常工作 ≠ 无缺陷；必须看【护栏拦的是不是本该通过的东西】。
```

## K45.2 精确调用链
```
 ProotBootstrap:1312  extractionStage(..."准备应用工具")
 ProotBootstrap:1313  RuntimeTools.prepare(ctx, getRootfsDir())
 RuntimeTools:295     patchAgentPresets → patchClientModule(..., "agent-preset-patch.json", "Agent 预设")
 RuntimeTools:302     if (!spec.dshVersion.equals(pkg.version)) return;   ← 版本门（0.1.7-alpha.2 ✅ 通过）
 RuntimeTools:314     applyClientPatches(...)
 RuntimeTools:336     ExactTextPatch.apply(updated, patch.before, after)
 ExactTextPatch:11    if (old != 1 || patched != 0) throw "上游模块结构与输入适配补丁不符，原文件保留"
 RuntimeTools:324     catch → throw description + "适配未应用，原文件保留：" + msg
 ⇒ ★ 与用户日志文案【逐字吻合】⇒ 调用链确认无误。
```

## K45.3 ★★ 根因：把 APK 里的 dsh-runtime.bin 取出来，逐条实测 14 条补丁
```
 方法：从 app-standard-release.apk 读 assets/dsh-runtime.bin（gzip, 125,964,708 B）
      → tar 取 usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/
              @deepseek-ai/dsh-client-ui-agent-preset/lib/client.js（78,091 B）
      → 对每条 patch 计算 old=count(src,before), patched=count(src,after)
 结果：14 条中【4 条失败】
   [4]  old=0 patched=0  FAIL
   [5]  old=0 patched=0  FAIL
   [8]  old=0 patched=0  FAIL
   [10] old=0 patched=1  FAIL（★ after 已在源码中 ⇒ 被判"重复套用"）
 ⇒ ★ 真根因不是"改名把锚点改坏"，而是 ★★ **我们的补丁集比上游落后**：
```

## K45.4 ★★★ 决定性对照：上游补丁 vs 我们补丁
```
 上游 /tmp/dsha-up/app/src/main/assets/agent-preset-patch.json
    dshVersion = 0.1.7-alpha.2   patches = 【16 条】
 我们 app/src/main/assets/agent-preset-patch.json
    dshVersion = 0.1.7-alpha.2   patches = 【14 条】

 【关键实测】用【上游的 16 条】测【我们 APK 里的运行时】：
   ⇒ ★ 失败 0 / 16 —— 【全部通过】
 【反向】用【我们的 14 条】测【我们 APK 里的运行时】：
   ⇒ ★ 失败 4 / 14

 差异定位：
   · 上游多出 [14][15] 两条（header/showPresetPicker 相关）我们【缺失】
   · 我们的 [8] 'seatInjected = ...' 缺 'const ' 前缀（上游为 'const seatInjected = ...'）
   · 我们的 [10] 'async apply() {...}' 这一条，其 after 文本【已存在于】运行时
     ⇒ 上游 [10] 是 'const result = await ...' —— 与我们的 [10] 【不是同一条】
 ⇒ ⇒ ★★ 结论：**我们的 agent-preset-patch.json 是与【更早的运行时/更早移植】配套的旧版**，
   上游为 0.1.7-alpha.2 提供的是 16 条的新版，我们只带了 14 条且其中若干锚点已过时。
```

## K45.5 ★ 此缺陷与"改名"的关系（避免误归因，K33 反事实法）
```
 反事实：若【不改名】，这 4 条锚点会匹配吗？
   · [4][5] 差在参数表（上游加了 useShowPresetPicker）⇒ 与改名【无关】
   · [8]    差在 'const ' 前缀           ⇒ 与改名【无关】
   · [10]   after 已存在                 ⇒ 与改名【无关】
 ⇒ ★ 归因结论：**与改名无关**，是【补丁集版本落后】。
   ⇒ 这也解释了一个此前困惑：为什么 dshVersion 门通过（都是 0.1.7-alpha.2）却仍失败
     —— 因为【dshVersion 相同不代表内部 client.js 文本相同】。
     ⇒ 📌 通则：**以"版本号相等"当作"文本相同"的代理判据是无效的**（K29.4 变体①）。
       版本号只是弱判据；补丁锚点是【内容寻址】的，必须按内容校验。
```

## K45.6 修复方案（正确做法）
```
 ★ 直接用上游 0.1.7-alpha.2 的 16 条补丁集替换我们的 14 条
   ⇒ 实测：该 16 条在我们的运行时上【0 失败】⇒ 替换即可修好冷安装
 ⚠️ 但必须同时核对【改名影响】：上游补丁的 after 串里若含 'dsha'/'DSHA' 品牌，
    需一并改成 DeepSeekHarness（保持本轮命名边界）
 ⚠️ 且需检查 prependAsset 引用的 web-integration/agent-preset-switch.js 是否一致
 ⚠️ 修完必须【重新构建 APK】⇒ 用户需重装
```

## K45.7 ★ 我的判断失误（本轮第 4 条 Lead 自身错误，入账）
```
 【错误】见到"原件保留/原文件保留"文案，我判为"设计内的安全拒绝，非故障"，
        并建议用户"不要去修它们"。
 【为何错】我只做了【静态代码阅读】，没有做【把运行时取出来实测锚点】这一步。
          护栏文案的存在，使我把"机制是安全的"误当成"这次触发是正常的"。
 ⇒ 📌 新增规则：**判据「这是护栏还是故障」不能只看代码路径是否优雅，
   必须实测【该护栏本次拦下的输入是否【本应】通过】。**
   ⇒ 形式化：护栏安全 ≠ 该次拦截正确。二者独立。
 ⇒ 与 K42.2「修法需自证」互为镜像：
   那里是"没证明改完会通过就提修法"，
   这里是"没证明拦下的本该通过就说不用改"。
 ⇒ ★ 共同点：【都缺少对目标行为的实测】，而只有静态阅读。
 ⇒ 📌 元规则加强：**凡涉及"要不要改"的判断，必须包含一次对目标对象的实跑。**
```

---

# 附录 K46 —— 补丁集陈旧缺陷的修复与【我的一次错误测量】（2026-09-24 06:30）

## K46.1 修复结果
```
 agent-preset-patch.json: 16 条（取上游结构 + 我方品牌归一）
   残留 dsha 品牌命中 = 0
   新名到位：deepseekharnessHeaderHint / SwitchAria / NewSessionPrefix /
             deepseekharness-preset-header-anchor / data-deepseekharness-agent-preset /
             createDeepSeekHarnessAgentPresetSwitcher
   ★ 真实 client.js（sha256 fb24af3c…, 78091 chars）全链 16/16 通过
```

## K46.2 ★★ 我的一次错误测量（入账，第 5 条 Lead 错误）
```
 【错误】我写了 /tmp/apchk/scan.py，对每个补丁文件的每条 patch 用
        【对原始 src 的 count】判定 ⇒ 报出 "5 个文件有问题"：
          agent-preset FAIL 3/14、plugin-manager-nav FAIL 1/8、3 个 "module 未找到"
 【为何错】① ★ 没有模拟【全链累进】—— applyClientPatches 是逐条把结果传给下一条，
            后面的补丁作用于【已被前面改过的文本】。对原始 src 判后续条目必然失真。
          ② 用 module 字段存在性当作"能否校验"的判据，但 client-combo / composer-enter /
            session-interaction 这三个文件【结构上就没有 module 字段】，
            它们走 RuntimeTools:220/268/473 的另路消费 ⇒ 不是"未找到"，是"不同消费方式"。
 【修正后】改用全链累进口径（scan2.py）⇒ 9 个 module 型补丁文件【9/9 全部通过】。
 ⇒ 📌 规则 K46.2：**校验一个"链式变换"时，必须按链累进模拟；
   对原始输入逐条独立判定会在第二条起系统性失真。**
   这与 K41「零命中需先证明扫描器有效」同源：**判据本身必须先被验证**。
 ⇒ 📌 规则 K46.2b：**"字段缺失"不等于"对象异常"** —— 先查该字段在【该对象的消费路径上】
   是否本来就应该存在。consumer 决定字段，不是 schema 决定字段（呼应 K1）。
```

## K46.3 附带确认
```
 · plugin-manager-navigation-patch.json（我方 8 条）全链 CHAIN-OK ⇒ 【无需修】
 · 上游该文件为 12 条，两者都能在我们的运行时上跑通 ⇒ 我方 8 条不是"陈旧"，
   而是【上游后续增补了 4 条】，属功能差异非缺陷。★ 与 agent-preset 的"锚点漂移"性质不同。
 ⇒ 📌 区分：【锚点漂移=缺陷（必须修）】 vs 【条目更少=功能取舍（可不动）】。
   判据：前者 old=0 且 patched=0 且该锚点上游存在；后者锚点仍能命中。
```

## K46.4 正确的新验证器口径（供 tools/verify-agent-preset-patch.py 采用）
```
 1. 从 APK/dsh-runtime.bin 取真实模块文本（正对照：文件数 > 0）
 2. 断言 patches 数 > 0（样本非空）
 3. ★ 全链累进：cur = src; for each patch: 判定后 cur = cur.replace(before, after, 1)
 4. 任一条失败 ⇒ 非 0 退出，打印失败索引与 before 首行
 5. ★ 负对照：拿【旧 14 条】喂进去必须非 0（证明闸门真能报警）
```

---

# 附录 K47 —— ★★ patch-fix 纠正了我的判据公式（Lead 第 6 条错误，2026-09-24 06:40）

## K47.1 我派单时写错的公式
```
 我写的： ok ⇔ (patched==1 and old==count(after,before)) or (old==1 and patched==0)
 ⇒ ★ 错在：**第一个分支是【幂等成功】，第二个分支是【正常应用成功】——两者都是 ok，**
   但我在文字里把它当成了"接受判据"，而 **`old != 1 || patched != 0` 才是拒绝条件**。
   实际后果：我此前把 patch[10]（old=0, patched=1）报为 ★ FAIL，
   **按真实语义它是 (A) 幂等成功。**
```

## K47.2 源码真相（ExactTextPatch.java，逐行）
```java
:9   int old = count(source, before), patched = count(source, after);
:10  if (patched == 1 && old == count(after, before)) return source;   // (A) 幂等 → 成功
:11  if (old != 1 || patched != 0) throw IllegalArgumentException(...); // (C) 拒绝 → 失败
:12  return source.replace(before, after);                              // (B) 应用 → 成功
 ⇒ ★ 三分支：ok ⇔ (A) || (B)
 ⇒ 我此前把 :11 的【拒绝式】当成 ok 判据，等价于"把护栏的报警条件当成通过条件"。
```

## K47.3 影响评估（是否改变了根因结论？）
```
 不影响。两种口径下：
   · 我方旧 14 条的失败集合，真实语义 = [4],[5],[8]（+[10] 修正为幂等成功）
   · 上游 16 条 = 全通过
 ⇒ 根因（补丁集陈旧）与修复方向（换上游结构 + 品牌归一）**不变**。
 ⇒ 但 📌 **"影响很小"不能成为不记录的借口** —— 判据写错本身就是缺陷，
   若这次失败集合恰好跨越了幂等分支，就会得出相反的结论。
```

## K47.4 ★ 新增元规则
```
 📌 K47.4：**从源码抄判据时，必须把 if 分支的语义方向写清楚（成功/拒绝），
   并逐分支标注。** 只抄布尔表达式、不标方向，极易把"拒绝条件"误用为"接受条件"。
   ⇒ 与 K42.2/K45.7 同族：**判据本身必须先被验证**，不能假设自己的公式是对的。
```

## K47.5 ★ 闸门实测（Lead 独立复跑，非转述）
```
 正对照（修复后 16 条 vs 既有 APK）  : 16/16 成功   EXIT=0  ✅
 负对照（旧 14 条 vs 同一 APK）      : 11/14，失败 [4,5,8]  EXIT=1  ✅ 会报警
 零样本护栏（patches=[]）            : 拒绝     EXIT=1  ✅
 ⇒ ★ K41「零样本误判全绿」的两道防线（样本非空 + 正对照）均已实测生效。
 ⇒ patch-fix 另附：幂等复跑 pass1==pass2 逐字节相同；node 语法解析 OK；
   注入标识符声明早于使用（无 TDZ 风险）。这些是超出派单要求的有效加固。
```

## K47.6 生产文件状态
```
 app/src/main/assets/agent-preset-patch.json   8580 B  14→16 条  残留 dsha=0
 tools/verify-agent-preset-patch.py            9860 B  新增构建闸门
 ⇒ 下一步：重新构建 APK（唯一 Gradle 进程由 Lead 控制）
```

---

# 附录 K48 —— 修复闭环与交付（2026-09-24 06:30）

## K48.1 ★★ 一次修复同时解除【两条】用户报错
```
 报错①「环境重建未完成」：EnvironmentMaintenance:106
        → controller.proot().prepareRuntimeTools()
        → ProotBootstrap:846  RuntimeTools.prepare(ctx, rootfsDir)   ← ★ 同一缺陷点
 报错②「Agent 预设适配未应用」：RuntimeTools:295 patchAgentPresets → ExactTextPatch:11
 ⇒ ★ 两条报错【共用同一个 RuntimeTools.prepare 路径】⇒ 本次修复同时覆盖两者。
 ⇒ 这也解释了为何用户先见②（冷安装路径）后见①（升级后环境重建路径）。
```

## K48.2 修复内容
```
 app/src/main/assets/agent-preset-patch.json   14 条 → 16 条   8580 B
   结构取上游 0.1.7-alpha.2；品牌 41 处归一为 DeepSeekHarness 形态；残留 dsha = 0
 tools/verify-agent-preset-patch.py            9860 B  新增构建闸门（APK/bin/js 三入口）
 ⇒ 单文件最小改动，不动任何 Java 逻辑。
```

## K48.3 ★ 交付物（Lead 亲验）
```
 standard: app/build/outputs/apk/standard/release/app-standard-release.apk
           275,565,073 B  sha256 c8fd4767363d2e801cbfda54b106cbb0add6abd185ac0f60d2d04dd89668672e
 low     : app/build/outputs/apk/low/release/app-low-release.apk
           350,796,010 B  sha256 970731b3b657322ea498ad518af937c574539e9f5c9782f9d1b6483cf14178d5
 用户副本: /sdcard/Download/DeepSeekHarness/
           DeepSeekHarness-20260925-standard-release.apk       sha256 与源一致 ✅
           DeepSeekHarness-20260925low-low-release.apk         sha256 与源一致 ✅
 签名    : cert SHA-256 d98f218af34ca55d10cbf8dda908e804aae40e7e54d0e0fecbdcd1f5462b63f7
           apksigner verify 两包均 exit=0 ✅
```

## K48.4 ★ 验证链（每步都有独立判据）
```
 ① 闸门对【两个新 APK】: 16/16 成功  exit=0  ✅
 ② APK 内打包文件核对  : assets/agent-preset-patch.json
                          patches=16，与磁盘源【逐字节相同】，dsha 残留=0  ✅
 ③ 负对照（旧 14 条）  : exit=1，失败 [4,5,8] ⇒ 闸门真能报警  ✅
 ④ 零样本护栏          : patches=[] ⇒ exit=1  ✅
 ⑤ runtime-descriptor.json 一致性：记录哈希 ca3c0b64… == 磁盘文件哈希  ✅
    ★ 该描述符 mtime 06:17:31 晚于补丁文件 06:15:14 ⇒ 是构建期重新生成并已同步
```

## K48.5 ★★ 一次差点误用【陈旧证据】的事件（入账：判据有效性自查）
```
 【事件】跑完 testStandardDebugUnitTest，Gradle 报 BUILD SUCCESSFUL，
        但日志显示 "30 actionable tasks: 1 executed, 29 up-to-date"。
        我据此查 XML，得 121 文件 / 631 用例 / 0 失败 ⇒ 差点直接采信。
 【自查】我核了 XML 的 mtime = **05:11** —— ★ 早于本轮构建（06:18）。
        ⇒ 这是【上一轮】的测试结果快照，**不构成本轮证据**。
 ⇒ 📌 规则 K48.5：**"测试通过"的判据必须包含【结果文件时间戳晚于本轮改动】。**
   否则是在用旧绿冒充新绿。
   ⇒ 与 K41（零样本误判）/ K47.4（判据方向）同族，共同点：
     **先验判据本身是否有效，再用它下结论。**
 【处置】改查是否与我改动有交集：RuntimeDescriptorTest 引用 'agent-preset-patch.json'
        字符串，初看像依赖；细读发现只是 Map 的 key，且真实文件读取的是
        runtime-descriptor.json（而非该补丁）。⇒ 交集极小。
        但为取得【本轮干净证据】，仍以 --rerun-tasks 强制重跑。
```

---

# 附录 K49 —— ★★★ 新缺陷族：「跨端改名劈开」(cross-layer rename split) （2026-09-24 07:00）

## K49.1 第二个冷安装阻断（用户第二次报错）
```
 失败阶段：使用兼容方式继续安装离线工具
 原因：/root/dsh-bin/install-ubuntu-tools: line 7:
       cd: /root/.deepseekharness-bundled-tools: No such file or directory
 ⇒ ★ 注意：第一个阻断（agent-preset）已被我的修复解除——
   阶段从「准备应用工具」推进到「安装离线 curl、git 与证书」⇒ 修复生效，暴露了下一层。
```

## K49.2 ★★ 缺陷一：脚本丢失了参数化
```
 产者 ProotBootstrap:1332
   String slot = ".deepseekharness-bundled-tools-" + UUID.randomUUID();
   String guest = "/root/" + slot;                    // 带 UUID
 ProotBootstrap:1382
   "/bin/bash /root/dsh-bin/install-ubuntu-tools " + ShellQuote.arg(guest)   // ← 传了 $1

 消费者【我方】install-ubuntu-tools.sh:7
   cd /root/.deepseekharness-bundled-tools            // ★ 硬编码，$1 被完全忽略
 消费者【上游】install-ubuntu-tools.sh:7-9
   install_dir="${1:-/root/.dsha-bundled-tools}"
   [[ "$install_dir" =~ ^/root/\.dsha-bundled-tools(-[a-f0-9-]{36})?$ ]] || exit 64
   cd "$install_dir"                                   // ★ 正确：消费 $1 且校验形状
 ⇒ ★ 定性：**改名时"把可变名替换成固定名"，把参数化逻辑整块删掉了。**
   ⇒ 这不是"改名改错字"，而是【改名过程中丢了一整个契约】
   ⇒ 📌 通则 K49.2：**改名必须只改【名字】，不得改变【结构】。**
     若替换后原本的变量/参数消失了，说明改的不是名字，是逻辑。
```

## K49.3 ★★ 缺陷二：标记被"劈成了两个不同新名"
```
 上游（两端一致）:
   shell : printf '\nDSHA_UBUNTU_TOOLS_READY\n'
   Java  : contains("\nDSHA_UBUNTU_TOOLS_READY\n")

 我方（★ 两端不一致）:
   shell : printf '\nDeepSeekHarness_UBUNTU_TOOLS_READY\n'    ← 驼峰式
   Java  : contains("\nDEEPSEEK_HARNESS_UBUNTU_TOOLS_READY\n") ← 大写下划线式

 ⇒ ★ 同一个旧名，两处各按自己的风格转换 ⇒ 生成【两个不同】的新名。
 ⇒ 后果：即使缺陷一修好、目录 cd 成功，最后仍会因标记不匹配而判失败（静默且难查）。
 ⇒ 📌 通则 K49.3：**批量改名必须【成对进行】——
   对同一契约，先在两端确认其"应是同一个字符串"，再统一替换。
   两处风格不同（驼峰 vs 大写下划线）时尤其危险，因为两个结果"看起来都对"。**
 ⇒ 📌 K49.3b：**判据 —— 旧名在同一契约的两端必须逐字符相同；若相同，新名也必须逐字符相同。**
```

## K49.4 ★ 同类普查（K23.1：范围由字段检索确定，不靠调用点回忆）
```
 全量扫描 assets 下 *.sh/*.py 的所有 *_READY/_OK/_DONE/_COMPLETE 标记，与 Java 侧比对：
   产者标记 16 个，消费者标记 11 个
   ★ 唯一真实的跨端断链 = UBUNTU_TOOLS_READY（→ DEEPSEEK_HARNESS_UBUNTU_TOOLS_READY）
   其余（BUNDLES_OK / PNPM_FIX_OK / RESTORE_OK / SESSION_OK 等）经核验为
   【脚本内部自产自销】，上游同样无 Java 消费者 ⇒ 非我方引入，无需处理。
 ⇒ ★ 关键：**"产者有消费者无"不等于缺陷** —— 必须先判定该标记是否本就是跨端契约。
   ⇒ 判据：上游该标记是否也有 Java 消费者？无 ⇒ 内部标记。
```

## K49.5 修复
```
 app/src/main/assets/install-ubuntu-tools.sh
   :7   install_dir="${1:-/root/.deepseekharness-bundled-tools}"
   :8   [[ "$install_dir" =~ ^/root/\.deepseekharness-bundled-tools(-[a-f0-9-]{36})?$ ]] || exit 64
   :9   cd "$install_dir"
   :19  rmdir "$install_dir"
   :20  printf '\nDEEPSEEK_HARNESS_UBUNTU_TOOLS_READY\n'   ← 与 Java:1375 逐字符一致
 ⇒ 全部旧品牌改名为 deepseekharness / DEEPSEEK_HARNESS 形态；残留 dsha = 0
```

## K49.6 ★ 新增闸门：tools/verify-cross-layer-contracts.py
```
 目的：把"跨端改名劈开"这一整类缺陷挡在【构建期】，而不是等设备冷安装才炸。
 三段检查：
   A. 跨端 READY 标记配对：脚本 printf 的标记必须在 Java 有同名字面量
   B. 位置参数契约：Java 传 $1 的脚本必须真的消费 $1
   C. 品牌残留：词边界匹配 + 跳过注释行
 护栏（K41 强制）：
   · 样本非空：扫描文件数==0 或产者标记==0 ⇒ exit 2
   · 正对照：A 段检查数==0 或 B 段检查数==0 ⇒ exit 2
 实测：
   正对照（修复后仓库）      ⇒ exit 0 ✅
   负对照①（还原修复前脚本）⇒ exit 1，报出"标记断链 + 参数断链"两条 ✅
   负对照②（改回正确内容）  ⇒ exit 0 ✅（证明不是恒报错）
```

## K49.7 ★ 闸门精度调优（把 K42 的教训写进代码）
```
 首版误报 3 处，全部是【词内/注释】假阳性，与我此前的人工误报同源：
   · 'handshake'、'PAIR_HANDSHAKE'  ← grep 'dsha' 命中 handSHAke（K42.1 老毛病）
   · 'dsha_t' 出现在 webserver-auth-patch.sh:72 的【注释】里，
     该行是"改名把前缀从 "dsha_t="(7) 变成 "deepseekharness_t="(18)" 的文档说明
 ⇒ 修正：① 改用词边界正则 (?<![A-Za-z0-9_])dsha(?![A-Za-z0-9_])
          ② 跳过注释行（# // * /* <!--）
 ⇒ 📌 K49.7：**"改名前的旧名出现在说明改名过程的注释里"是合法且有价值的文档，
   不应算残留。** 闸门若把它判为缺陷，会诱导后人删掉改名记录 —— 那是净损失。
```

## K49.8 我的第 7 条错误（入账）
```
 【错误】首次运行闸门得到 3 项 FAIL，我差点直接当成"3 个品牌残留"报给用户。
 【规避】我先核对了每一处的上下文，发现 2 处是词内误报、1 处在注释里。
 ⇒ 这次【没有】犯下"把假阳性当缺陷"的错（对比 K44 我把真缺陷当护栏放过）。
 ⇒ 📌 元规则：**闸门给出的每个 FAIL，在采纳前必须人工核对上下文。**
   闸门负责"不漏"，人负责"不误"；两者都不能省。
```

---

## 附录 K50 — Round-4：插件加载失败的真根因（观察器只认字符串形态）

### K50.1 现象
第三轮真机日志（2026-09-24 14:54:11）在冷安装全部通过后，卡在最后一层：
```
[STARTUP_ERROR] @deepseek-ai/dsh-web-app: 缺少 dsh.bundle.patch 声明或补丁文件
[STARTUP_STAGE] 加载 DSH 和已启用插件
[WEB_FAILURE] 加载 DSH 和已启用插件：启动配置或插件加载失败
```

### K50.2 排查路径（含两次自我纠偏）
1. 先怀疑归档损坏 → 解 `dsh-runtime.bin` 验证：`@deepseek-ai/dsh-web-app/package.json`
   的 `dsh.bundle.patch` 是【长度 5 的数组】，5 个文件在归档内【全部存在】(0 缺失)。
   ⇒ **归档没问题**，问题在设备侧。
2. 再怀疑报错串出自运行时 JS → 在 `dsh-app-boot` / `dsh-web-app` 里 grep 英文原文
   `declaration or patch file`，**0 命中**。
3. ⇒ **反转方向**：这个中文串是我们【自己】的代码产出的。在 i18n 里定位到
   `startup_2073`，`files: ["startup"]`，顺藤摸到 `app/src/main/assets/startup-observer.cjs:70`。

### K50.3 根因
`startup-observer.cjs` 旧代码：
```js
const patch = pkg.dsh?.bundle?.patch;
if (typeof patch !== 'string' || !(await exists(path.resolve(root, patch))))
  issue = '缺少 dsh.bundle.patch 声明或补丁文件';
```
只处理 `patch` 为**字符串**的情形。而 dsh 0.1.7 起 `dsh.bundle.patch` 可以是**有序数组**，
官方的 `@deepseek-ai/dsh-web-app` 正是数组（5 个 yml）。于是对官方核心包必然误报。

上游对照（`/tmp/dsha-up/app/src/main/assets/startup-observer.cjs:68`）写得很清楚：
```js
// 0.1.7 支持有序补丁数组；每一个入口仍须存在于该包内部。
const patches = typeof patch === 'string' ? [patch] : Array.isArray(patch) ? patch : [];
```
⇒ **我方移植的是 0.1.7 之前的观察器语义**。

### K50.4 通则（继 K49 之后的第四类移植缺陷）
- **K50.4.1 升级底座时，除了"业务代码"要跟版，【诊断/校验代码】同样要跟版。**
  校验器是"元数据契约"的消费者；上游把契约从标量放宽为数组时，校验器不改就会把合法输入判为非法。
- **K50.4.2 校验器误报（false positive）比漏报更凶险**：它会让一个【完全正常的】官方包
  被标记为损坏，并级联阻断整个启动流程。排查时容易一路往"包坏了"的方向跑偏。
- **K50.4.3 定位报错第一步是确定【谁说的这句话】。** 本次两次跑偏都是因为默认
  "报错来自运行时"，直到搜遍运行时 0 命中才反转。**中文串优先在自己仓里搜。**
- 与 K49 呼应：K49 是"改名改掉了结构/成对契约"，K50 是"跟版跟漏了契约的放宽"。
  两者的共同点仍是——**契约两端必须逐字符/逐语义对齐**。

### K50.5 双向验证（这次的证据强度）
| 用例 | 输入 | 期望 | 实测 |
|---|---|---|---|
| 正向 | 官方 `dsh-web-app`（数组，5 个文件齐全） | 无 issue | 无 issue ✅ |
| 负对照 | **还原旧逻辑** + 同一输入 | 产出那条 issue | 复现出与用户日志一字不差的 issue ✅ |
| 回归 | `dsh-web-mobile`（字符串形态） | 正常 | 正常 ✅ |
| 回归 | 英文语言 | 全英文 | `Configuration check: …` ✅ |
| 回归 | 中文语言 | 全中文 | `配置检查：…` ✅ |

负对照复现了用户的原始症状 —— 这是"根因成立"的最强证据形式。

### K50.6 顺带发现并修复：观察器丢了 i18n 机制
我方 `startup-observer.cjs` 在改名/移植中**整体丢失**了上游的 `uiPhrases` + `uiText()`。
后果：英文语言用户在启动追踪里看到的是中文。
- 上游用 `process.env.DSHA_UI_LANGUAGE` 判定；我方 Java 侧（`HarnessController.java:178`）
  已导出 `DeepSeekHarness_UI_LANGUAGE`，**契约两端名字本来就是对上的**，只是消费端被删了。
- 已按上游语义恢复，并把 `'未知版本'` 的调用点也对齐成 `uiText('未知版本')`。
- ⇒ **通则 K50.6.1**：改名时若把"机制"整段删掉，契约会静默失效而不报错（因为没人读了）。
  删任何一段代码前要问：它是【改名】还是【消失】？消失的东西有没有消费者？

### K50.7 闸门
新增 `tools/verify-startup-observer.py`（task-11），把这个缺陷固化到构建期。

---

## 附录 K51 — Round-4 复核发现：修复中的「深度防御缺失」与「回放式闸门」陷阱

### K51.1 背景
K50 的修复（observer 支持数组形态）交给独立复核人交叉验证。复核结论：**修复足以解除真机阻断**，
但抓出 **2 处漏报** + **1 处更大的既有缺陷**。Lead 逐条亲自复现，全部成立。

### K51.2 ★ 漏报一：`realpath` 层缺失（符号链接逃逸）
上游 4 层防护：
```
L70  typeof item !== 'string' || !item || path.isAbsolute(item)
L72  !target.startsWith(root + path.sep)
L73  !fs.existsSync(target)
L73  !fs.realpathSync(target).startsWith(root + path.sep)   ← 漏
L73  !fs.statSync(target).isFile()                          ← 漏
```
我方修复版只实现了前 3 层（第 3 层用 `await exists()`）。

**实测（Lead 亲自复现）**：包内软链 `patch/evil.yml -> /etc/passwd`
- 文本层：`path.isAbsolute('patch/evil.yml')` = false ⇒ 通过
- 越界层：`resolve(root,item)` 仍在 root 内 ⇒ 通过
- 存在层：`exists()` 跟随软链 ⇒ **为真，通过**
- ⇒ **静默通过**，而上游 `realpathSync` 会解析出 `/etc/passwd` 判定越界并拒绝。

**严重性判定（不夸大）**：复核人实测该 case **未泄漏** `/etc/passwd` 内容
（读取阶段 regex 未匹配到 id，`catalog` 未发出）。所以这是**深度防御缺失**，
不是「已可利用的泄漏」。但一个被篡改的插件包确实能让任意宿主文件进入补丁读取路径。

### K51.3 ★ 漏报二：`isFile` 层缺失（声明指向目录）
`patch: ["patch/d"]` 且 `patch/d` 是**目录**时：`exists()` 对目录返回 true ⇒ 静默通过。
后续 `fsp.readFile` 抛 EISDIR 被 `catch(_){}` 吞掉 ⇒ ids 为空 ⇒ 仍不报错。
⇒ 一条「声明了无效补丁文件却完全不报错」的路径。

### K51.4 通则：**「我改对了」不等于「我没改坏」；也不等于「这一层本来就对」**
- 修复一个契约缺陷时，**要顺带核对同一处防护的【完整层次】**。
  上游写了 4 层，你抄了 3 层 —— 剩下的 1 层不会报错，只会静默放行。
- **K51.4.1**：抄写防御代码要**逐层对照**，不是「功能跑通就行」。
  跑通只证明了被覆盖的那些层有效，**证明不了没抄的那层不重要**。
- **K51.4.2**：`catch (_) { }` 是漏报的温床 —— 它把「读取失败」变成「静默成功」。
  本文件里它出现在 ids 解析处，正好掩盖了 isFile 缺失的后果。

### K51.5 ★★ 复核人自曝的闸门陷阱（本轮最有价值的方法论）
复核人在`tools/verify-startup-observer.py` 初版里，检查 2 的回放用的是
**他写在脚本里的 Python 语义移植**，而不是**磁盘上的 `.cjs` 源码**。
⇒ 后果：把 `broken.cjs` 传给 `--observer`，检查 2 依然 PASS（它压根没读那份源码）。
⇒ 只有检查 1 报 FAIL。**若有人改坏 `.cjs` 且同步改了移植，闸门会静默放行。**

**修法**：新增 2e —— materialize 最小夹具 + 用真实环境变量跑 `node <observer>` +
解析 stdout 的 JSON issue 事件。负例下检查 1 与 2e **同时**报 FAIL。

> **★ K51.5.1（建议入册为通则）：「回放式闸门」必须回放【被测物本身】，
> 回放它的【副本/移植】等于没有回放。**
> 副本与被测物会各自漂移，而闸门恰好看不见这种漂移 —— 这是 K2「消费者要适配生产者」
> 的镜像：**验证器要执行被测物，不是执行自己对被测物的理解。**

### K51.6 附带发现的既有缺陷：catalog 截断（丢弃 311/411 个 id）
`startup-observer.cjs` 把 5 个补丁文件的 id **累进一个数组**后 `slice(0,100)` 发**一条** catalog；
上游是**每个补丁文件发一条**。
- 实测真实包：`cordis.patch.yml=189 standard=67 ptc=69 minimal=17 cordis=69` 合计 **411**
- 我方（修复前）：1 条 catalog / 截断到 100 ⇒ **丢 311**
- 上游：5 条 catalog ⇒ 仅丢 89
- 后果：`StartupDiagnostics.java:56-61` 据此建 `owners` 索引，
  **147 个 id 在上游有归属、在我方没有**（实测 `tool-bash`），
  插件报错时归因不到 ⇒ 启动失败原因更难定位。
- 该逻辑 **HEAD 就已存在**（`git show HEAD` 证实），非本轮引入。
- 已修：改为**按补丁文件各发一条** catalog。实测 5 条 / 322 个 id，`tool-bash` 归属恢复。

### K51.7 本轮实际修复清单
| # | 项 | 状态 |
|---|---|---|
| 1 | 数组形态支持（真机阻断根因） | 已修 ✅ |
| 2 | `uiPhrases`/`uiText` i18n 机制丢失 | 已修 ✅ |
| 3 | 漏掉 `realpath` 层 | 已修 ✅（Lead 复现确认） |
| 4 | 漏掉 `isFile` 层 | 已修 ✅（Lead 复现确认） |
| 5 | catalog 截断丢 311 个 id | 已修 ✅（1 条/100 → 5 条/322） |
| 6 | `emit()` 丢 try/catch、`fatal` 标志、`Cause:` i18n | **未修**，历史遗留，已记录 |
| 7 | `locate()` 目录列表比上游窄 | **未修**，需真机验证 |

### K51.8 遗留项说明（诚实记录，不假装完成）
- **`fatal` 标志缺失**：`StartupDiagnostics.java:63` 是 `optBoolean("fatal", true)` —— **默认 true**。
  我方 observer 从不发 `fatal`，故**任何**一条 issue（含可选插件失败）都会置
  `explicitStartupFailure`。上游只有 7 个关键入口失败才 fatal。
  ⇒ 方向是**误报**（不阻断冷安装，但拖累启动诊断准确度）。已记录待排期。
- **`locate()` 比上游窄**：上游用 `Module.createRequire().resolve.paths()`，
  我方用固定 4 个目录。若真机插件装在 4 目录之外（pnpm 链接等）会误报「找不到插件目录」。
  容器内无法复现真机目录布局 ⇒ **需真机验证**。
