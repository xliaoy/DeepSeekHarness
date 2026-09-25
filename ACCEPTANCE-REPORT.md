# DeepSeekHarness 迁移验收报告

> 生成时间：2026-09-24 12:1x（工作区本地时间）
> **口径声明：本报告所有数字均基于当前工作区快照采集，迁移尚未提交（`HEAD` 仍为 `62d8459`），因此无法用 git 复现。每条数字均标注采集命令口径。**

---

## 一、交付物（用户可直接安装）

| 变体 | 路径 | 大小 | sha256 |
|---|---|---|---|
| **standard**（推荐） | `app/build/outputs/apk/standard/release/app-standard-release.apk` | 275,565,273 B (262.7 MiB) | `d56ac4b396027e892b13078adf5137f9bb45e6e608e46d6023fc52d763c1dcf7` |
| **low**（Android 6+） | `app/build/outputs/apk/low/release/app-low-release.apk` | 350,795,751 B (334.5 MiB) | `19063c1f037605a789d437e289a7103f090ce510231a8e7e20ed324d146eccc7` |

**已复制到显眼位置便于取用（两个变体均已就位）：**
```
/sdcard/Download/DeepSeekHarness/DeepSeekHarness-20260925-standard-release.apk   ← 推荐
/sdcard/Download/DeepSeekHarness/DeepSeekHarness-20260925low-low-release.apk     ← Android 6+
```

### 包标识与可安装性（`aapt2 dump badging` + `apksigner verify`）
```
package name  : com.deepseek.harness        ← 按既定决策保留
versionCode   : 145                          ← 按既定决策
versionName   : 20260925  /  20260925low
minSdk        : 30 (standard) / 23 (low)
targetSdk     : 37
native-code   : arm64-v8a（唯一 ABI）
application-label : DeepSeekHarness          ← 89 个 locale 全部解析为 DeepSeekHarness
签名 DN       : CN=DeepSeek Harness, OU=DeepSeek, O=DeepSeek, L=Shenzhen, ST=Guangdong, C=CN
签名证书 SHA-256 : d98f218af34ca55d10cbf8dda908e804aae40e7e54d0e0fecbdcd1f5462b63f7
```
**复核命令（可原样复现）：**
```bash
AAPT=/root/tools/aapt2                                   # ★ 必须用这个（qemu 包装；x86-64 版会失败）
APKSIGNER=/opt/android-sdk/build-tools/36.0.0/apksigner  # ★ 不在 /root/tools 下
$APKSIGNER verify --print-certs app/build/outputs/apk/standard/release/app-standard-release.apk
# ⇒ exit=0  ✅ 可安装
```
> ⚠️ **口径更正**：本节早前曾把 `apksigner` 写成位于 `/root/tools/`；实际该目录只有
> `aapt2`、`aapt2-x86_64`、`build-dsh.sh`。正确路径如上。
> **结论（验签通过、可安装）不变**，但命令路径必须更正。（verifier 独立复核时发现）

---

## 二、迁移范围

- **底座升级**：dsh `0.1.5-rc.1` → **`0.1.7-alpha.2`**（对齐上游 DSH-APP/DSHA v0.1.7-alpha2）
- **规模**：已跟踪变更 339 文件（+53,783 / −25,015）；新增未跟踪文件 447
- **内置插件**（11 个，`app/src/main/assets/builtin-plugins/`）：
  `dsh-auto-review` `dsh-balance-panel` `dsh-client-ui-aqua` `dsh-computer-use-android`
  `dsh-device-shell-guide` `dsh-infinite-gen-4` `dsh-memento` `dsh-status-overlay`
  `dsh-task-notifier` `dsh-tool-vscreen` `dsh-web-mobile`

---

## 三、用户明确要求逐项核对

| # | 要求 | 状态 | 证据 |
|---|---|---|---|
| 1 | 移植上游新功能/设置/逻辑/插件 | ✅ | dsh 0.1.7-alpha.2；内置插件 11 个 |
| 2 | **保留 dsh-web-mobile 左右排列布局** | ✅ | `fragment_plugins.xml:3-8` 注释明确；布局为无商城版 |
| 3 | 全部 `dsha`/`DSHA` → `DeepSeekHarness` | ✅ | 见 §四 产物级断言 |
| 4 | **插件页只用「列表 + 命令行安装 + 在线安装」** | ✅ | 14 个 id：`btnOnlineInstall` `btnCommandInstallBtn` `btnPluginHelp` + 列表；商城控件（`btnMarket`/`btnInstalled`/`pluginMarketCard`/`pluginWebsiteSection`）已删 |
| 5 | **删除全部 dsha.cc 相关** | ✅ | 源码 0 处；APK dex 内 `dsha.cc` = **0**（旧 APK 曾 10 处） |
| 6 | 自更新改走 GitHub Releases | ✅ | `UpdateEngine.java:42` `FEED = https://api.github.com/repos/xliaoy/DeepSeekHarness/releases` |
| 7 | 保留自更新（更新本体） | ✅ | `DshUpdater.java` 走 GitHub Releases + npm 镜像 |
| 8 | **自选更新版本** | ⚠️ **未完成** | 见 §六 遗留项 ① |
| 9 | 路径形态规则（I2） | ✅ | 用户可见 `Download/DeepSeekHarness`；内部 `share/deepseekharness` |

---

## 四、品牌清理：产物级断言（APK 实测，非源码推断）

> **口径**：解包 APK 后对 3 个 `.dex` 分别扫描；`strings` 用于排除二进制噪声。

```
[L6j 主判据]  dsha.cc              = 0    ✅（旧 APK 曾 10 处）
[整词口径]    \bDSHA\b             = 0    ✅
[原始子串]    DSHA                 = 2    ← 白名单（见下）
[原始子串]    dsha                 = 2    ← 误报（见下）
[类路径]      Ldsha（大小写敏感）   = 0    ✅
[新品牌]      DeepSeekHarness      = 218  ✅
```

**两处 `DSHA` 是格式魔数，保留正确：**
```
backup/BackupArchive.java:9         MAGIC={'D','S','H','A','D','A','T','A'}
backup/PortableBackupCrypto.java:16 MAGIC={'D','S','H','A','B','A','K','5'}
```
它们是**备份文件的格式标识**（定长 8 字节写入文件头），上游一字未改。改名会导致**已存在的备份包无法被新版本读取** → 属于「改了才是缺陷」。

**两处 `dsha` 是英文词缀误报**：`HandshakeKDFFunction`（bouncycastle）。

**★ 品牌计数必须声明口径**（同一 APK 可合法产生多个「正确数字」）：

| 口径 | 抽取方式 | `DeepSeekHarness` 计数 |
|---|---|---|
| A 原始字节出现次数 | `re.findall(rb'DeepSeekHarness', dex)` | **224** |
| B **唯一 token（本报告采用）** | `dex.split(b'\0')` 后去重 | **215** |
| C 恰好等于该串的 token | 精确相等 | 0（池中均为完整类名/方法名） |
| D 资源串（另计） | `aapt2 dump strings \| grep -c` | **35** |

> 口径 A/B/C **都不矛盾**，差值 224−215=9 来自「单个 token 内出现多次」。
> **本报告统一采用口径 B**（最保守：常量池中任一条目含该串即计入）。
> 独立复核另报出的 97 属同族观测值（口径不同），**不据此判定对错**，但须一并标注口径。

**资源层断言**（`aapt2 dump resources`，新 APK）：`DSHA` = 0、`Shape.DSHA` = 0、`Dialog.DSHA` = 0；`DeepSeekHarness` = 52、`DEEPSEEK_HARNESS` = 43。

---

## 五、验证结果

| 项目 | 结果 | 口径 |
|---|---|---|
| `assembleStandardRelease` | ✅ BUILD SUCCESSFUL | 1m47s |
| `assembleLowRelease` | ✅ BUILD SUCCESSFUL | 2m32s |
| `testStandardDebugUnitTest` | ✅ **631 tests / 0 failures / 0 errors** | 聚合 121 个 `TEST-*.xml` |
| 品牌完整性闸门 | ✅ PASS（命中 0） | `tools/verify-brand-integrity.py` |
| UI 回归测试 | ✅ 31 tests OK | `tools/test-deepseekharness-ui-regressions.py` |
| 5 个 `.bin` 品牌扫描 | ✅ 路径命中 0 | 解压后 `tar -t`（13,788/9,132/1,071/4/31 条目） |
| 悬空 `R.id` | ✅ 0 | 全 source set 双向配对 |
| 产物级 style 闭环 | ✅ 转绿 | `Shape.DEEPSEEK_HARNESS_Dialog` cornerSize=32dp |

**冻结协议**：两次构建均通过「构建前后树指纹一致」校验（`a3c2d8ce…`），因此**产物与源码版本的绑定是实测事实，而非断言**。

---

## 六、遗留项与已知问题（如实披露）

### ⚠️ ① 「自选更新版本」未实现（用户明确要求过）
UI 选择器已存在（`UpdateActivity` 的预览版/稳定版切换），但**按具体版本号自选下载**的功能**未落地**。原因：参考实现（`xliaoy/DeepSeekHarness`）**没有**版本选择器，需新写 `DshUpdater.listVersions()` + `installVersion()` 及仓库候选暴露。**这是本轮最大的未完成项。**

### ⚠️ ② 英文环境下的 i18n 断链（30 处）
改名改了源码中文字面量，但 `tools/i18n/messages.json` 译文表的**键**未同步 → **英文界面下这些条目回退中文**。
- 影响面：**仅英文 locale**；中文（默认）与构建**不受影响**
- 定性：**断链**（旧键已删、残留 0，但不是每条都补了新键），**不是**遗漏翻译
- 修复方式：向 `messages.json` 回填 30 个键（zh = 新字面量，en = 上游原文去掉旧品牌）→ **需第二次构建**

### ⚠️ ③ 迁移尚未提交（`HEAD` = `62d8459`）
339 个已跟踪文件变更 + 447 个未跟踪文件**全部未 `git add`**。按您的指示（"先不提交，我自己稍后处理"）**未提交**。

### ⚠️ ④ 未跟踪资产的盲区（71 处）
`app/src/main/assets` 磁盘 308 / git 230 / 未跟踪 78，其中 71 处为真实源码资产（含 `web-integration/language.js`）。
**风险**：若只 `git add` 已跟踪文件的改动，这些新资产会漏掉，导致**克隆后构建失败**。
**裁定**（以您自己的仓库为基准，229/229 已跟踪、0 未跟踪）：应补齐 19 个源资产 + 20 个 `.d.ts` + 10 个 `.d.ts.map`；`.pyc` 入 `.gitignore`。

### ⚠️ ⑤ `libproot_legacy.so` 张力
该 `.so` 内含上游版本串，NDK 未安装故未重编。当前**保留并已文档化**；若要彻底重编需安装 NDK 26。

### ⚠️ ⑥ 工具链可移植性缺陷（非本轮引入）
`tools/build-dsh-runtime.py:623` 的 `os.replace` 在 `/sdcard`（fuseblk）上失败并抛非 0 退出码，**但产物已完整写出且自洽**。
→ **不能以退出码判成败**，必须验证最终态。

---

## 七、本轮发现的方法论问题（供参考）

本轮共记录 **41 条规则**（`/tmp/migration-evidence/rename-safety-rules.md`，3,229 行）。最重要的一条元规则：

> **「零命中」唯有在【探测器对该对象有效】且【样本空间非空】时才能作为结论。**

它有三个变体，本轮**全部实际发生**过：
1. **查询有效性** — `git ls-files` 对非 git 目录报错被读成空；`ls` 查错目录 ⇒ 误判"类不存在"
2. **扫描器有效性** — 5 个 `.bin` 全是 gzip，`strings` 对它们**结构性失明**（"deepseek=0" 是看不到，不是没有）
3. **样本非空** — glob 通配失败得到 0 个 XML，却差点被判"全绿"

**闸门错误账本累计 14 条，其中 11 条属基线/口径/探测器类**，仅 4 条是纯误报（全部为大小写不敏感的词中缀：`handshake` / `HandshakeKDFFunction` / `buildShadowCorners` / `loadSharedConfigFiles`）。
→ **本项目的头号风险不是"算错"，而是"量错"。**

---

## 八、验证方法学声明

- 所有品牌断言均在 **API 产物层**（`.dex` / `resources.arsc`）执行，不依赖源码推断
- 所有"未检出"结论均附带**成立的正对照**（同路径能检出已知存在物）
- 两个 APK 均带**冻结指纹**，产物与源码版本的绑定可验证
- 验证方（verifier）与本报告采信的数均经**独立重跑复核**，非转述

---

# ★ 补充：冷安装阻断修复（2026-09-24 06:35）

## 用户报告
```
 版本 20260925 / 145 / 标准版
 最近失败阶段：准备应用工具
 最近失败原因：java.io.IOException: Agent 预设适配未应用，原文件保留：
              上游模块结构与输入适配补丁不符，原文件保留
 另有升级路径报错：环境重建未完成，原件及宿主数据副本已保留：<uuid 事务目录>
```

## 根因（Lead 实测，可复现）
```
 调用链：ProotBootstrap:1313 RuntimeTools.prepare()
        → RuntimeTools:295 patchAgentPresets
        → RuntimeTools:336 ExactTextPatch.apply
        → ExactTextPatch:11 抛异常（拒绝条件 old!=1 || patched!=0）

 实测：从 APK 取 assets/dsh-runtime.bin → tar →
      @deepseek-ai/dsh-client-ui-agent-preset/lib/client.js
      sha256 fb24af3c3de904ebf5a93a8f5c6bcaa6f1a1fb82f6086e0d36d271ab5e6042f7
      逐条 apply（全链累进）：
        我方旧 14 条 ⇒ 失败 [4,5,8]
        上游 16 条   ⇒ 全通过

 ⇒ 真根因：**agent-preset-patch.json 是陈旧补丁集**，落后于上游 0.1.7-alpha.2。
 ⇒ 与品牌改名【无关】（4 条锚点差异全在参数表/前缀，无品牌名）——
    这一条用反事实法验证过，避免误归因。
 ⇒ ★ 两条报错同源：EnvironmentMaintenance:106 prepareRuntimeTools()
    → ProotBootstrap:846 → RuntimeTools.prepare() 是【同一缺陷点】。
```

## 修复
```
 app/src/main/assets/agent-preset-patch.json   14 条 → 16 条（结构取上游）
   品牌归一 41 处：dshaHeaderHint→deepseekharnessHeaderHint 等 6 类 + 1 处 CSS 注释
   残留 dsha = 0
 tools/verify-agent-preset-patch.py            新增构建闸门（APK / .bin / .js 三入口）
```

## 验证证据
| 项 | 判据 | 结果 |
|---|---|---|
| 闸门 vs 两个新 APK | 全链累进 16 条 | 16/16 成功，exit=0 |
| APK 内打包文件 | assets/agent-preset-patch.json 与磁盘逐字节比对 | 相同，patches=16，dsha=0 |
| 负对照（旧 14 条） | 必须非 0 | exit=1，失败 [4,5,8] |
| 零样本护栏 | patches=[] 必须非 0 | exit=1 |
| runtime-descriptor 一致性 | 记录哈希 vs 磁盘 | ca3c0b64… 一致 |
| 单测 | --rerun-tasks 强制重跑 | 121 XML / 631 用例 / 0 失败 |
| 签名 | apksigner verify | 两包 exit=0，证书 d98f218a… |

## 交付物
```
 standard: app/build/outputs/apk/standard/release/app-standard-release.apk
           275,565,073 B  sha256 c8fd4767363d2e801cbfda54b106cbb0add6abd185ac0f60d2d04dd89668672e
 low     : app/build/outputs/apk/low/release/app-low-release.apk
           350,796,010 B  sha256 970731b3b657322ea498ad518af937c574539e9f5c9782f9d1b6483cf14178d5
 用户副本: /sdcard/Download/DeepSeekHarness/（两包 sha256 与源一致）
```

## ★ 遗留风险（已知，未修）
```
 1. 【i18n】新增品牌 key 未回填 tools/i18n/messages.json ⇒ 仅影响 en 语言，
    zh 默认与构建不受影响。
 2. 上游 16 条补丁的 before/after 若随上游再次升级而漂移 ⇒ 闸门会在【构建期】报警，
    不再等到设备冷安装（本次新增该闸门的意义）。
 3. 【陈旧证据教训】本次曾出现 Gradle 报 BUILD SUCCESSFUL 但测试 XML 是 05:11 的旧快照
    （日志为 "1 executed, 29 up-to-date"）⇒ 已用 --rerun-tasks 重跑取得 06:32 新鲜证据。
    凡"测试通过"必须核对结果文件时间戳晚于本轮改动。
```

---

# ★ 补充二：跨端改名劈开修复（2026-09-24 07:05）

## 第二个冷安装阻断（用户第二次报错）
```
 失败阶段：使用兼容方式继续安装离线工具
 原因：install-ubuntu-tools: line 7:
       cd: /root/.deepseekharness-bundled-tools: No such file or directory
 ⇒ 第一个阻断（agent-preset）已解除 —— 阶段从「准备应用工具」推进到
   「安装离线 curl、git 与证书」⇒ 上次修复生效，暴露了下一层。
```

## 缺陷一：脚本丢失参数化
```
 产者 ProotBootstrap:1332  slot = ".deepseekharness-bundled-tools-" + UUID   ← 带 UUID
 产者 ProotBootstrap:1382  "…/install-ubuntu-tools " + arg(guest)            ← 传了 $1
 消费者【我方】脚本:7       cd /root/.deepseekharness-bundled-tools          ← 硬编码，$1 被忽略
 消费者【上游】脚本:7-9     install_dir="${1:-…}" + 正则校验 + cd "$install_dir"
 ⇒ 改名时把【可变名替换成固定名】，整块删掉了参数化逻辑。
```

## 缺陷二：标记被劈成两个不同新名
```
 上游两端一致 : DSHA_UBUNTU_TOOLS_READY
 我方 shell   : DeepSeekHarness_UBUNTU_TOOLS_READY      ← 驼峰
 我方 Java    : DEEPSEEK_HARNESS_UBUNTU_TOOLS_READY     ← 大写下划线
 ⇒ 同一旧名两处各按自己风格转换 ⇒ 生成两个不同新名。即使目录对了也会判失败。
```

## 修复
```
 app/src/main/assets/install-ubuntu-tools.sh
   :7-9  恢复参数化 + 形状正则（品牌改为 deepseekharness）
   :19   rmdir "$install_dir"
   :20   printf '\nDEEPSEEK_HARNESS_UBUNTU_TOOLS_READY\n'  ← 与 Java:1375 逐字符一致
 残留 dsha = 0
 tools/verify-cross-layer-contracts.py   新增闸门（三段：标记配对 / 参数契约 / 品牌残留）
```

## 同类普查结论
```
 assets 下全部 *_READY/_OK/_DONE/_COMPLETE 标记（产者 16 / 消费者 11）逐一比对：
   ★ 唯一真实的跨端断链 = UBUNTU_TOOLS_READY（已修）
   其余为脚本内部自产自销，上游同样无 Java 消费者 ⇒ 非我方引入
 Java 引用的 guest 脚本 3 个：adb-shell.py / install-ubuntu-tools.sh 均正确部署；
   /root/dsh-bin/adb 仅出现在【用户提示文案】中，非真实调用 ⇒ 无误
```

## 闸门验证（双向对照）
| 对照 | 期望 | 实测 |
|---|---|---|
| 正对照（修复后仓库） | exit 0 | exit 0 ✅ |
| 负对照①（还原修复前脚本） | 非 0，且报出两条 | exit 1，报"标记断链 + 参数断链" ✅ |
| 负对照②（改回正确内容） | exit 0 | exit 0 ✅ |

## 交付物（本轮重新构建）
```
 standard: app/build/outputs/apk/standard/release/app-standard-release.apk
           275,565,155 B  sha256 f14b22c61e6256ca90a01792f4b2725afa8e9851db685ed3c29a7c7edd6ba10b
 low     : app/build/outputs/apk/low/release/app-low-release.apk
           350,796,086 B  sha256 77a811f0eef596367723493c8531c3820aa95e33e84e5a686812c9b689936596
 用户副本: /sdcard/Download/DeepSeekHarness/（sha256 与源逐一相同 ✅）
 构建    : BUILD SUCCESSFUL，0 个 error:
```

## 验证链
| 项 | 判据 | 结果 |
|---|---|---|
| 跨层契约闸门 | 三段全过 + 正对照 | exit 0 ✅ |
| 补丁闸门（两 APK） | 16/16 全链累进 | exit 0 ✅ |
| 品牌闸门 | 词边界扫描 | exit 0，0 命中 ✅ |
| APK 内脚本核对 | 是否修复版 | 两包均：消费 $1 ✅ / 正则 ✅ / 标记一致 ✅ / 无硬编码 ✅ |
| APK 品牌独立核对 | 绕过闸门缓存直接扫 | 两包均 0 残留，241 个品牌词元 ✅ |
| 签名 | apksigner verify | 两包 exit=0 ✅ |
| 单测 | --rerun-tasks 强制重跑 | 121 XML / 631 用例 / 0 失败，mtime 06:51 ✅ |

## ★ 本轮新增的两条通则（已入 RENAME-SAFETY-RULES.md K49）
```
 K49.2 改名必须只改【名字】，不得改变【结构】。
       若替换后原本的变量/参数消失了，说明改的不是名字，是逻辑。
 K49.3 批量改名必须【成对进行】。同一契约两端逐字符相同，则新名也必须逐字符相同。
       驼峰式与大写下划线式并存时尤其危险 —— 两个结果"看起来都对"。
```

## ★ 遗留（未修，已知）
```
 1. i18n：新增品牌 key 未回填 tools/i18n/messages.json ⇒ 仅影响 en 语言
 2. 自选更新版本功能：用户明确要求过两次，尚未实现
 3. 设备侧冷安装实测：需用户在真机验证是否能走完全流程
```

---

## 补充三：第四轮修复 —— 插件加载失败（真机阻断的最后一层）

### 现象
第三轮真机日志（2026-09-24 14:54:11）显示冷安装已全部通过（
`DEEPSEEK_HARNESS_UBUNTU_TOOLS_READY`、`适配 dsh 运行时`、`解压与离线安装完成` 均正常），
但卡在最后一步：
```
[STARTUP_ERROR] @deepseek-ai/dsh-web-app: 缺少 dsh.bundle.patch 声明或补丁文件
[WEB_FAILURE] 加载 DSH 和已启用插件：启动配置或插件加载失败
```

### 根因
`app/src/main/assets/startup-observer.cjs:70`（修复前）只接受 `dsh.bundle.patch` 为**字符串**：
```js
if (typeof patch !== 'string' || !(await exists(path.resolve(root, patch))))
  issue = '缺少 dsh.bundle.patch 声明或补丁文件';
```
而 dsh 0.1.7 起该字段可以是**有序数组**，官方的 `@deepseek-ai/dsh-web-app` 正是 5 个 yml 的数组。
⇒ 对官方核心包**必然误报**，并级联阻断启动。

上游同位置（`/tmp/dsha-up/.../startup-observer.cjs:68`）一直有正确实现：
```js
// 0.1.7 支持有序补丁数组；每一个入口仍须存在于该包内部。
const patches = typeof patch === 'string' ? [patch] : Array.isArray(patch) ? patch : [];
```
⇒ 我方移植的是 0.1.7 **之前**的观察器语义。

### 排查中的两次方向纠偏（值得记录）
1. 先解包核对归档 → `dsh.bundle.patch` 是数组、5 个文件全在（0 缺失）⇒ **归档没问题**。
2. 再在运行时 JS 里搜英文原文 `declaration or patch file` → **0 命中**。
3. ⇒ 反转方向：这句中文是我们**自己**的代码产出的。在 i18n 里定位 `startup_2073`
   （`files: ["startup"]`）才摸到 observer。
**教训：定位报错第一步是确定「谁说的这句话」；中文串优先在自己仓里搜。**

### 顺带修复：观察器丢失了 i18n 机制
我方在改名/移植中**整段删掉**了上游的 `uiPhrases` + `uiText()`，导致英文语言用户在启动
追踪里看到中文。已按上游恢复（`process.env.DeepSeekHarness_UI_LANGUAGE`，
与 `HarnessController.java:178` 导出的名字逐字符一致）。

### 验证证据（双向）
| 用例 | 输入 | 期望 | 实测 |
|---|---|---|---|
| 正向 | 官方 `dsh-web-app`（数组 5 文件齐全） | 无 issue | 无 issue ✅ |
| **负对照** | **还原旧逻辑** + 同一输入 | 产出那条 issue | **复现出与用户日志一字不差的 issue** ✅ |
| 回归 | `dsh-web-mobile`（字符串形态） | 正常 | 正常 ✅ |
| 回归 | `DeepSeekHarness_UI_LANGUAGE=en` | 全英文 | `Configuration check: …` ✅ |
| 回归 | 中文 | 全中文 | `配置检查：…` ✅ |
| 品牌 | observer 全文 | 0 处 dsha | 0 处 ✅ |

「负对照复现出用户的原始症状」是根因成立的最强证据形式。

### 本轮同时进行的两个新需求
1. **设置进侧边栏** —— 确认我方在整包升级时丢掉了用户原有的 DrawerLayout 侧边栏
   （参考仓 `/tmp/xliaoy-ref` 653 行 MainActivity 里有完整实现），正在搬回。
2. **更新拆分为「软件更新」与「运行时更新」** —— 进行中。

### 新增闸门
`tools/verify-startup-observer.py` —— 把「补丁声明形态」缺陷固化到构建期，
含真实数据回放与负对照（无负对照则闸门自身判为无效）。

### 通则沉淀
- **K50.4.1**：升级底座时，「诊断/校验代码」也必须跟版。校验器是元数据契约的消费者；
  上游把契约从标量放宽为数组时，校验器不改就会把合法输入判为非法。
- **K50.4.2**：校验器**误报**比漏报更凶险 —— 它把完全正常的官方包标记为损坏并阻断启动。
- **K50.6.1**：改名时若把「机制」整段删掉，契约会**静默失效**（因为没人读了，不报错）。
  删任何代码前要问：这是【改名】还是【消失】？消失的东西有没有消费者？

---

## 补充四：第四轮收口 —— 构建产物与全量验证

### 交付物（用户可直接安装）
| 文件 | 大小 | sha256 |
|---|---|---|
| `/sdcard/Download/DeepSeekHarness/DeepSeekHarness-20260925-standard-release.apk` | 275,598,396 B | `64ae5b271e1ac9e0b72c74e7968b6d7842c7fd94065847604b35f377968fd058` |
| `/sdcard/Download/DeepSeekHarness/DeepSeekHarness-20260925low-low-release.apk` | 350,944,471 B | `0f0c0bd14e3fa083e58550bc09c42a62d4edc6217cb302fd9855f27d33785f87` |

- 构建命令：`:app:assembleStandardRelease :app:assembleLowRelease` → **BUILD SUCCESSFUL**，`error:` **0 条**
- 签名校验：`apksigner verify` 两个包均 **exit=0**

### 本轮交付的三件事（用户裁定「三个一起做完，最后一次性构建」）
1. **修复插件加载失败**（第四轮阻断根因）—— 含后续复核发现的 2 处漏报修复。
2. **设置进侧边栏** —— 按用户原有布局（DrawerLayout）搬回，官方新架构控件零丢失。
3. **更新拆分为「软件更新」+「运行时更新」** —— 两个独立入口，且**都支持自选版本**。

### ★ 修复进包验证（不只看源码，直接查 APK 内资产）
| 项 | standard | low |
|---|---|---|
| 数组分支 `Array.isArray(patch)` | ✅ | ✅ |
| `realpath` 防护层 | ✅ | ✅ |
| `isFile` 防护层 | ✅ | ✅ |
| catalog 按文件分组 | ✅ | ✅ |
| `uiPhrases` i18n | ✅ | ✅ |
| dsha 残留 | 0 | 0 |

### ★ 侧边栏与更新页资源进包验证
`drawer_layout` / `drawer_panel` / `btn_menu` / `bottom_nav` / `fragment_container` /
`ui2_update_section_runtime` / `update_runtime_check` —— 全部在 APK 资源表中 ✅
（同时存在证明侧边栏是**叠加**的，没有覆盖官方底部导航。）

### 闸门
| 闸门 | exit |
|---|---|
| `tools/verify-cross-layer-contracts.py` | 0 |
| `tools/verify-startup-observer.py`（本轮新增） | 0 |
| `tools/verify-brand-integrity.py` | 0 |

### APK 品牌终检
口径三元组：扫描成员 **897** / 正规式 `全词 dsha 大小写不敏感`（解压后字节）/
命令 `python3 zipfile + re` ⇒ **命中 0 处**。

### 复核发现的 2 处漏报（Lead 亲自复现并修复）
`patch-fix` 独立复核指出：我方 observer 抄上游 4 层防护只抄了 3 层。
Lead 亲自构造用例复现：
- **符号链接逃逸**：包内软链 → `/etc/passwd`，修复前**静默通过**（应报 issue）→ 已修 ✅
- **声明指向目录**：`patch/d` 是目录，修复前**静默通过** → 已修 ✅
- 严重性未夸大：symlink 那条实测**未泄漏**内容（读取阶段 regex 未匹配），属深度防御缺失。

### 附带修复的既有缺陷：catalog 截断
observer 原先把 5 个补丁文件的 id 合并后 `slice(0,100)` 只发 1 条 catalog ⇒ 丢 **311/411** 个 id。
实测 `tool-bash` 等 147 个 id 在自建索引里查不到。已改为**按补丁文件各发一条**：
实测 **1 条/100 id → 5 条/322 id**，`tool-bash` 归属恢复 ✅（该缺陷 HEAD 就已存在，非本轮引入）

### 未修 / 待办（诚实记录，不假装完成）
- `emit()` 丢 try/catch、`fatal` 标志缺失（`StartupDiagnostics.java:63` 默认 `true`，
  会把可选插件失败也按致命处理 —— 方向是**误报**，不阻断安装）、`Cause:` 中文分隔符：历史遗留，已记录待排期。
- `locate()` 搜索目录比上游窄（固定 4 目录 vs 上游 `Module.createRequire().resolve.paths()`）：
  若真机插件装在 4 目录之外会误报，**需真机验证**。
- 真机冷安装 + 启动走查：容器内无法替代，**醒来装包后请重点看这一步**。
- `DshUpdater.java` 内既有中文串未走 `UiText.text(...)`：建议单独排期。
- **迁移仍未提交**（遵用户「先不提交，我自己稍后处理」）。

---

## 补充五（第五轮）：真机 15:28 日志 —— 内置插件全部报「缺少补丁文件」的根因

### 现象
15:27 起的 5 次启动，**8 个插件全部**报
`[STARTUP_ERROR] <name>: 缺少 dsh.bundle.patch 声明或补丁文件`，
而**同一时刻官方包 `@deepseek-ai/dsh-web-app` 不再报错**。

### 根因：上一轮我引入的回归（不是插件没适配）
对照两次日志即可定位：

| 时间 | 官方包（数组形态） | 自定义插件（字符串形态） |
|---|---|---|
| 14:53（旧 APK） | ❌ 报错 | ✅ 正常 |
| 15:27（新 APK） | ✅ 正常 | ❌ **8 个全报错** |

即：上一轮修好数组支持后，**字符串分支反而被我自己加的 `realpath` 防护层判成非法**。

机制（已用真机形态**复现并反证**）：
- 真机上 `profiles/web/node_modules/<插件>` 是指向实体目录 `/root/deepseekharness-*` 的**软链**；
- `root`（未解析）= 软链路径，`realpath(target)` = **实体**路径；
- `real!.startsWith(root + sep)` ⇒ **false** ⇒ 误报。

**反证**：同一份夹具下，上游 observer ⇒ `issue=0`；我方（缺陷版）⇒ `issue=1`。
⇒ 该层防护把**合法软链布局**误判为越界，属**误报**，方向比漏报更凶险（K50.4.2）。

### 修复
先把 `root` 自身也 `realpath`，再做包含性比较；三层防护（非绝对路径 / 文本不越界 / 必须是普通文件）保留：

```js
const realRoot = await fsp.realpath(root).catch(() => root);
const real = await fsp.realpath(target).catch(() => '');
if (!real || !(real === realRoot || real.startsWith(realRoot + path.sep))) { ... }
```

### 双向证据（同一夹具）
| 用例 | 期望 | 实测 |
|---|---|---|
| 真机软链布局 · 7 个真实插件 | 0 issue | **0 issue，7 个配置检查** ✅ |
| 包内软链逃逸 → 包外 | 拦截 | 拦截（issue=1）✅ |
| 声明指向目录 | 拦截 | 拦截（issue=1）✅ |

### 闸门补强（这次失败暴露的闸门缺陷）
`tools/verify-startup-observer.py` 原先**只回放运行时归档**，而归档里的包是实体目录 ——
**完全覆盖不到真机的软链形态**，所以它一路绿灯而真机全红。
新增**检查 4：真机软链布局回放**（用 APK 内 observer 真跑）+ **4b 逃逸仍须拦下**。
判别力已验证：把修复回退成缺陷版 ⇒ 检查 4 **FAIL**（`issue=2`）；恢复 ⇒ PASS。

顺带修正 `tools/verify-brand-integrity.py` 的 APK 计数口径：
阶段 A/B 的过期项被误算进「跳过判定的 APK」，导致 2 个 APK 全判完却显示「实际判定 1 个」。

### 本轮产物
- `:app:assembleStandardRelease :app:assembleLowRelease` ⇒ `BUILD SUCCESSFUL in 1m 56s`，`error:` **0**
- 单测 `:app:testStandardDebugUnitTest :app:testLowDebugUnitTest --rerun-tasks` ⇒ SUCCESS
  **631 用例 × 2 flavor，0 失败 0 错误 0 跳过**，结果文件 07:41/07:42 晚于源码修改 07:34
- 用**从 APK 抽出的** observer 回放真机形态 ⇒ 7 插件 0 issue（非源码回放，闭 K51.5.1）
- `apksigner verify` 两个 APK 均**有效**；品牌闸门 **判定 2 个 APK，命中 0 处**
- standard `sha256=b5f53fac…5af6`（275,598,559 B）；low `sha256=83fea5f0…e2e8`（350,944,637 B）
- 已复制到 `/sdcard/Download/DeepSeekHarness/`，sha256 与构建产物**逐字节一致**

### 关于 `dsh-web-mobile`（用户本轮追问）
核查结论：我方 `dsh-web-mobile` **已经是 DSHA 完整版**（87 个文件，含全部 `lib/types/**`），
且**设置弹窗左右两栏布局完整保留**，三要素齐备：
1. `settings-toolbar-reparent` 为**空任务**（工具栏不搬进左栏）；
2. 面板 `flex-direction: row`（左 140px 垂直导航 + 右内容区）；
3. `> :first-child` 140px 列 + `_navList` 纵向 + 工具栏锚定 `> :last-child`。
三者互为前提，注释已标注「**不可回退**」。

---

## 补充六（第六轮）：侧边栏底栏冗余 · 插件页中文变英文 · 三个插件未内置

### ① 底栏设置项未随侧边栏改造移除
**现象**：设置已全部移入汉堡侧边栏，底栏仍留一个「设置」——同一功能两个入口，且侧边栏是主路径。

**修法**：对齐参考实现 `xliaoy/DeepSeekHarness`——底栏**不是整条删掉**，而是
**只去掉「设置」这一项**，保留 启动 / 插件 / 终端 三项（原菜单注释已明确：
「设置入口已全部移入顶栏汉堡侧边栏，底栏不再占位」）。这一点最初误判为"整条底栏都要去掉"，
查参考仓源码后才纠正 —— 启动/插件/终端三页在侧边栏里**没有**对等入口，删整条会让
这三个页面彻底不可达。

连带处理（K23.1：语义变更必须普查消费者，范围由字段检索确定）：
- `R.id.nav_settings` 随菜单删除而消失，`MainActivity` 两处 + 5 个 debug/androidTest 共 6 处引用
  原本会**编译失败**；已全部改走新增的 `MainActivity.openSettings()`。
- `consumeTaskTarget()` 的 `open_install` 分支原本借 `nav_settings` 当底栏基准项
  （紧接着就 replace 成 InstallFragment），改挂 `nav_launch`，语义不变。
- 侧边栏补一行「设置」（外观/语言/通用项），保证 SettingsFragment 仍有点击入口。
- `LayoutPreviewActivity` 是**纯布局预览**、没有 MainActivity 实例，
  改为不再替它调 openSettings()，底栏留无选中态（我第一版误引入不存在的 `main` 变量
  导致编译失败，已修正）。

### ② 插件页在中文模式下显示英文
**现象**：插件页整页英文，且切到英文也没变化。

**根因（不是翻译表缺失，而是填错了槽）**：`values/` 是**默认语言 = 中文**的资源槽，
`values-en/` 才是英文。移植插件页时把 13 个键的**英文原文直接写进了 `values/`**，
于是 `values/` 与 `values-en/` **逐字相同** —— 两种语言无法区分，中文恒为英文。

已核实的清单（13 个键，全部属同一处误填）：

| 键 | values/ 修复前 | values/ 修复后 |
|---|---|---|
| plugins_title | Plugin manager | 插件管理 |
| plugins_search_hint | Search plugin name or description | 搜索插件名称或描述 |
| plugins_sort_name | Sort by name | 名称排序 |
| plugins_sync_status | Sync local install status | 同步本机安装状态 |
| update_check | Check for updates | 检查更新 |
| plugin_install_title | Install Plugin | 安装插件 |
| plugins_tip | Usage tips | 使用提示 |
| plugins_online_install | Install online | 在线安装 |
| plugins_cli_install | Install via CLI | 命令行安装 |
| plugins_safe_mode | Safe mode: restore previously enabled third-party plugins | 安全模式：恢复此前启用的第三方插件 |
| plugins_list | Plugin list | 插件列表 |
| plugins_import | Import | 导入 |
| plugins_export | Export | 导出 |

**中文文案来源**：参考仓 `values/strings.xml` 的对应键（上述 13 个值与之一致）。

**为什么之前没发现**：`UiText.text()` 走的是 `tools/i18n/messages.json` → 生成 `UiMessages.java`，
那条链路**是好的**（3290 条、插件页中文串 100% 覆盖）；
问题出在**另一条并行的资源路径**（XML `@string/...`）上。两条路都叫"文案"，
审查时只查了 Java 侧就下了"已覆盖"的结论 —— 这是本次真正的教训。

**新闸门**：`tools/verify-ui-language.py`（新增）
判据：`values/` 与 `values-en/` 同值且非专有名词 / `values-en/` 无此键 ⇒ 判缺陷。
内置白名单放行 `DeepSeek Harness`/`Node.js 24`/`pnpm`/`DSH` 等中英文本就相同的名物。
已验证判别力：注入 1 处缺陷 ⇒ EXIT=1 报红，恢复 ⇒ EXIT=0。基线 495 键。

### ③ dsh-balance-panel / dsh-client-ui-aqua / dsh-infinite-gen-4 未内置
**现象**：三个插件在 assets 里有源码，但装机后插件页看不到。

**根因**：`BuiltinPlugins.DEFAULT_BUILTINS` 只有 7 项，这三个（以及 `dsh-memento`）
从未进入其中 ⇒ `installManagedAssets()` 根本不安装它们。资产齐全但永不落地。

**修法**：以参考仓为权威口径对齐 —— 参考仓的 `DEFAULT_BUILTINS` 是 **10 项**，
且 `dsh-infinite-gen-4` 走 `installPresetPlugin()` **单独预装**：

| 插件 | 装机方式 | 为什么特殊 |
|---|---|---|
| dsh-client-ui-aqua | DEFAULT_BUILTINS + `lib/client.js`/`lib/invariant.js`/`LICENSE`/`README.md` + `lib/types/**` 递归 | 入口在 `lib/index.js`，但运行时还需要 `lib/invariant.js` 和**全部** `.d.ts`（客户端按 `exports.types` 取型） |
| dsh-balance-panel | DEFAULT_BUILTINS + `lib/client.js`/`lib/host.js`/`LICENSE`/`README.md` | 宿主入口是 **`lib/host.js`** 而非 `lib/index.js` |
| dsh-memento | DEFAULT_BUILTINS 单独分支，24 个文件（主入口 `index.mjs` + types + `lib/*.mjs` 全量 + `client/` + `bin/mcp-server.mjs`） | 入口是 **`index.mjs`**，**根本没有 `lib/index.js`** |
| dsh-infinite-gen-4 | `installPresetPlugin()`，21 个文件（`index.js` + `client.js` + prompts + scripts + tests + assets 图） | **不进** DEFAULT_BUILTINS，保持第三方身份 ⇒ 插件页可在线更新 / 删除 |

**关键设计点（容易改错的地方）**：原实现是 `{"package.json","cordis.patch.yml","lib/index.js"}`
**写死三件套**。这三个插件如果只用三件套，装机即失败（缺 `lib/host.js`/`index.mjs`）。
`dsh-memento` 与 `dsh-infinite-gen-4` **没有** `lib/index.js`，写死会在 `install()` 打开
asset 时直接抛 IOException —— 参考仓专门为它加了 `continue` 分支。

**新增 `installTree()`**：`lib/types/**` 这类"文件个数会随上游版本变化"的子目录
不再逐个硬编码文件名（上游加一个 `.d.ts` 就会静默漏装），按 `AssetManager.list()`
递归枚举，asset 与目标两端同步下沉。

**三处清单必须一致**（改了 2 处才发现第 3 处）：
- Java `BuiltinPlugins.DEFAULT_BUILTINS`
- asset `deepseekharness-builtin.txt`
- asset `register-builtin-plugins.py` 的 `DEFAULT_BUILTINS`
已核验：三处各 10 项、逐项一致 ✅；`PRESET_PLUGINS` 常量与 Java `PRESET_PLUGIN` 对应。

### 本轮验证
- `:app:assembleStandardRelease :app:assembleLowRelease` ⇒ `BUILD SUCCESSFUL in 51s`，`error:` **0**
- `:app:testStandardDebugUnitTest :app:testLowDebugUnitTest` ⇒ SUCCESS
  **631 用例 × 2 flavor，0 失败 0 错误 0 跳过**，结果文件 08:20/08:21 晚于本轮最晚源码 07:52 ✅
- 五道闸门全绿：verify-ui-language(495 键) / verify-startup-observer /
  verify-cross-layer-contracts / verify-brand-integrity(2 APK 0 命中) /
  verify-agent-preset-patch(16/16)
- `apksigner verify` 两个 APK 均**有效**
- APK 内插件资产：11 个目录全部就位，4 个新插件的入口文件逐一确认在包内
  （`dsh-balance-panel/lib/host.js`、`dsh-client-ui-aqua/lib/types/index.d.ts`、
  `dsh-infinite-gen-4/index.js`、`dsh-memento/index.mjs`、`dsh-memento/bin/mcp-server.mjs`）
- `aapt2 dump resources` 复核 13 个键：默认 `()` = 中文，`(en)` = 英文 ✅
- 装机清单自校验：模拟 `installManagedAssets()` 逐插件展开，**所有显式清单在 assets 中都存在**
  ⇒ 不会在装机期抛 IOException

### 交付路径
- `Download/DeepSeekHarness/DeepSeekHarness-20260925-standard-release.apk` — 275,601,660 B，sha256 `0348417b…`
- `Download/DeepSeekHarness/DeepSeekHarness-20260925low-low-release.apk` — 350,945,669 B，sha256 `ef39b2d5…`
（sha256 与构建产物逐字节一致）
