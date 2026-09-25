# DeepSeekHarness 迁移 —— 独立验收证据链报告

> **角色**：`verifier`（独立验收方，不写生产代码）
> **报告定位**：本报告是**证据链**文件，与 lead 的面向用户验收报告 `ACCEPTANCE-REPORT.md` 互补。
> 凡本报告与 lead 报告结论不一致，以本报告的**实测数字**为准；凡本报告标注「观测值」者，不得当作缺陷。
>
> **口径声明（K29.4）**：本报告所有数字均基于**当前工作区快照**采集。
> 迁移**尚未提交**（`HEAD` 仍为 `62d8459`），因此**任何数字都无法用 git 复现**。
> 每条数字均附**采集命令口径 + 对照基准**；缺一者一律标注为「观测值」而非「结论」。

---

## §0 一句话结论

```
  ══════════════════════════════════════════════════════════════════
   【包能不能用】→ 能。阻塞交付的缺陷 = 0，两个 APK 均已签名可安装。
  ══════════════════════════════════════════════════════════════════
   阻塞交付（defects blocking delivery） : 0
   阻塞验证（blocking verification）     : 1  ← debug 夹具编译错误，已修，631 测试全绿
   独立验证闸门结果                      : PASS=196  FAIL=2（2 条均非产品缺陷）
   头号遗留项                            : 用户明确要求的「自选更新版本」未实现
```

---

## §1 交付物与可安装性（直接证据）

### §1.1 两个 APK 的完整指纹

| 变体 | 路径 | 大小 | mtime | sha256 |
|---|---|---|---|---|
| **standard** | `app/build/outputs/apk/standard/release/app-standard-release.apk` | 275,565,273 B | 2026-09-24 04:58:07 | `d56ac4b396027e892b13078adf5137f9bb45e6e608e46d6023fc52d763c1dcf7` |
| **low** | `app/build/outputs/apk/low/release/app-low-release.apk` | 350,795,751 B | 2026-09-24 05:02:04 | `19063c1f037605a789d437e289a7103f090ce510231a8e7e20ed324d146eccc7` |

**采集口径**：`sha256sum <path>`；`stat -c '%y %s'`。**对照基准**：无（这是产物自身标识）。
**独立复核**：我独立重算 standard 的 sha256，与 lead 报告值**逐字相同** ✅。

### §1.2 ★ 可安装性（「用户能装上」的唯一直接证据）

```
$ /opt/android-sdk/build-tools/36.0.0/apksigner verify --print-certs \
      app/build/outputs/apk/standard/release/app-standard-release.apk
Signer #1 certificate DN: CN=DeepSeek Harness, OU=DeepSeek, O=DeepSeek, L=Shenzhen, ST=Guangdong, C=CN
Signer #1 certificate SHA-256 digest: d98f218af34ca55d10cbf8dda908e804aae40e7e54d0e0fecbdcd1f5462b63f7
  exit=0   ✅
```

low 变体签名 DN 与 SHA-256 **完全相同**（同一密钥签名）✅。

> ⚠️ **工具路径更正**：lead 报告引用的 `/root/tools/apksigner` **不存在**（该目录只有 `aapt2`、`aapt2-x86_64`、`build-dsh.sh`）。
> 实际可用路径为 `/opt/android-sdk/build-tools/36.0.0/apksigner`。**结论不变**（exit=0），但命令必须更正。

### §1.3 包标识

```
package      : com.deepseek.harness          （按既定决策保留）
versionCode  : 145                            （按既定决策）
versionName  : 20260925 / 20260925low
minSdk       : 30 (standard)  /  23 (low)
targetSdk    : 37
native-code  : arm64-v8a（唯一 ABI）
application-label : DeepSeekHarness（89 个 locale 全部解析为 DeepSeekHarness）
```

---

## §2 阻塞项分类（★ 让用户一眼看到「包能不能用」）

| 类别 | 数量 | 明细 | 现状 |
|---|---|---|---|
| **阻塞交付** | **0** | —— | ✅ 两个 APK 可安装 |
| **阻塞验证** | 1 | `PluginSortAudit.java:82` debug 夹具编译错误 | ✅ 已修（见 §3） |
| 非阻塞缺陷 | 2 | ① 31 条译文断链 ② `NAME_PREFIXES` 同值化 | 已定性，见 §8/§9 |
| 遗留项 | 1 | 「自选更新版本」未实现 | 用户明确要求，见 §10 |

> **判据**：阻塞交付 = 使产物不可安装/不可运行；阻塞验证 = 使验证链无法继续。
> **本轮无任何一项属于前者。**

---

## §3 构建链修复全过程（3 次失败 → 成功）

### §3.1 失败 #1：`:app:prepareStandardAssets` 元数据记账不一致

```
ValueError: dsh 离线运行时与当前补丁/依赖锁不一致，请重新生成 dsh-runtime.bin
  at tools/prepare-standard-assets.py:136
```

**三条件逐项实测**（`prepare-standard-assets.py:134-136` 是 `version` / `inputs` / `archive_sha256` 三合一校验）：

| 条件 | 记录值 | 实算值 | 判定 |
|---|---|---|---|
| ① `version` | `0.1.7-alpha.2` | `0.1.7-alpha.2` | ✅ |
| ② `inputs` | 12 项 | 12 项中 **2 项漂移** | ❌ |
| ③ `archive_sha256` | `fd9e4451a232654a…` | `fd9e4451a232654a…` | ✅ |

**漂移项**：`tools/dsh-runtime/package.json`、`tools/dsh-runtime/package-lock.json`。

**根因（三方哈希对照 —— 决定性证据）**：

```
package.json:
  inputs.json 记录     : 2dbe8dcad4dadcaea76bf809…   == /root/dsh-build-work/locked-dsh-runtime/package.json ✅
  HEAD 提交里          : a33f15b1c3d732e7cef1217f…
  当前工作区           : 5b74ccc198c3c16116c7a44a…
```

**★ 机制**：`dsh-runtime.bin` 的**生成端输入**是 `/root/dsh-build-work` 的锁（`0.1.5-rc.1`→`0.1.7-alpha.2` 迁移时生成），
而**校验端输入**是 repo 内的锁。**两者从来不是同一个文件** —— 这不是「记错账」，而是
**「生成端与校验端读不同路径的锁」的结构性路径不一致**。

> **★ 因果更正（重要）**：**即使完全不做品牌改名，这个闸门在当前工作区也会失败**
> —— 因为 HEAD 的锁是 `0.1.5-rc.1`、`/root/dsh-build-work` 的锁是 `0.1.7-alpha.2`，**必然不同**。
> **不得**写成「改名把 bin 改坏了」—— 那是错的因果。这是**一次无关改动暴露的长期隐藏不一致**。

**修法（方案 A，经 lead 裁定）**：重新生成，使记录指向 repo 内的锁。

```
python3 tools/build-dsh-runtime.py \
  --source /root/dsh-build-work/locked-dsh-runtime/node_modules \
  --output app/src/main/assets/dsh-runtime.bin --version 0.1.7-alpha.2
```

**结果（我独立复核）**：

```
  bin sha256  当前 = fd9e4451a232654af876d3a1bdb4a0c60b51f8cd8d8214c0e42a50928097878e
  bin sha256  备份 = fd9e4451a232654af876d3a1bdb4a0c60b51f8cd8d8214c0e42a50928097878e
  ⇒ ★ 与生成前【逐字节相同】✅  ⇒ 证实「name 字段不进归档」的推断
  inputs.json : version=0.1.7-alpha.2  输入数=12  漂移=0 ✅
  archive_sha256 记录 == 实际 : True ✅
  runtimeId : f1e3f379f7f0355c72a5e7f8d54d1472ac01348e435c08d05f61e7496b6d79a6（未变）✅
```

**为什么「逐字节相同」可预测**：`build-dsh-runtime.py` 只在两处用 `LOCK_ROOT/package.json` ——
`:34` `recipe_inputs()` 取**哈希**、`:640` 取 `dependencies['@deepseek-ai/dsh']`，**从不读 `name`**；
且我扫描归档全部 **13,194** 个成员，新旧两个 `name` 值**命中均为 0**。

> **★ 被否决的方案 B**：只手改 `inputs.json` 里的 2 个哈希 —— 这是**伪造记账**
> （把「我说它一致」写进文件而不真正重生成），违反「证据必须可复现」底线。**主动否决** ✅

### §3.2 失败 #2：`PluginFragment.java:187` 读写竞态

```
error: cannot find symbol — method chooseImport(boolean)  at PluginFragment.java:187
```

**★ 时间线铁证**：

```
  lead 构建失败（b-std2.log 落盘） : 04:54:55
  PluginFragment.java 最后修改      : 04:56:54   ← ★ 比失败【晚 2 分钟】
```

**⇒ 编译读到的是「`chooseImport` 尚未定义」的中间版本。** 这是**读写竞态**，不是代码缺陷。

**我对该文件的结构检查（证明现状完好）**：
```
  :187  ...setOnClickListener(v -> chooseImport(false));
  :493  private void chooseImport(boolean alternative) {   ← 定义存在 ✅
  类声明 @42；类体 @684 闭合；文件末 depth=0 ⇒ 花括号平衡 ✅
  仅 2 个类声明（PluginFragment + 内部 Adapter）⇒ 无重复类 ✅
  find app/src -name PluginFragment.java ⇒ 仅 1 份 ⇒ 无多 source set 副本 ✅
```

### §3.3 失败 #3：`PluginSortAudit.java:82` 泛型推断

```
error: incompatible types: Fragment cannot be converted to PluginFragment
```

**修法**（java-port，我复核）：
```java
androidx.fragment.app.Fragment raw = page.getSupportFragmentManager().findFragmentById(R.id.fragment_container);
if(!(raw instanceof PluginFragment)) throw new IllegalStateException("插件页未挂载为 PluginFragment");
PluginFragment fragment = (PluginFragment) raw;
```
✅ 与上游「先 `Fragment` 后判类型」惯例一致；未新增 import；
✅ 且为「插件页没挂载成 PluginFragment」提供明确失败信息。
✅ `app/src/debug` **不进 release 产物** ⇒ **两个 APK 不受影响**。

### §3.4 ★ 冻结协议（本轮最重要的流程产出）

**问题**：3 次失败中，失败的构建都发生在**未静止的树**上。口头「已停手」不是可观测事实。

**交付物**：`/tmp/migration-evidence/freeze-guard.sh`

```
 ① 连续两轮 30s 窗口内 app/src + tools 变动 = 0  ⇒ 静止
 ② 构建【前/后】各取一次树指纹 ⇒ 不同则【结果作废（无论成败）】，exit 3
 ③ 指纹随构建日志输出 ⇒ 产物可绑定源码版本
```

**负对照实测**（证明它真的会等，不是空转）：
```
  touch app/src/.../PluginFragment.java
  $ sh freeze-guard.sh check
     "...30s 内仍有 1 个文件在变，等待"
     ✅ ① 源已静止（连续 60s 内 0 变动）      ← 等完窗口才放行 ✅
```

**首次实战记录**（lowRelease）：
```
 ① 源已静止 ✅
 ② 构建前树指纹 = a1dd9831ba593227d6226b0b5b2310f71053d8e96a8878c7a436b8c548b16bdd
 ③ 构建后树指纹 = a1dd9831ba593227d6226b0b5b2310f71053d8e96a8878c7a436b8c548b16bdd
 ⇒ ✅ 前后逐字节相同 ⇒ 「该 APK 由该源码版本构建」由【断言】变为【事实】
```

### §3.5 已知工具缺陷（非本轮引入，记为待办）

```
 build-dsh-runtime.py:623  temporary.replace(output) 在 fuseblk 上抛
   FileNotFoundError: 'app/src/main/assets/dsh-runtime.bin.tmp' -> '...dsh-runtime.bin'
 ⇒ /sdcard 实测 stat -f -c %T = fuseblk；/tmp = f2fs
 ⇒ :625 finally 清理临时文件，但【归档已在 :529-622 完整写出】且 :627 inputs.json 写成功
 ⇒ ★ 最终态正确，但【退出码非 0】⇒ 任何「以退出码判成败」的 CI 都会误判
 ⇒ 建议（本轮不改）：output 指向 /tmp 或 /root 再 cp 进 repo，或 replace 失败回退 copyfile
```

---

## §4 产物级品牌断言（三口径并列 —— lead §B 要求）

**采集口径**：`unzip -p APK 'classes*.dex' > /tmp/all.dex` 后逐口径 `grep`。
**对照基准**：旧 APK（mtime 03:13）曾测得 `dsha.cc` = **10 处**。

| 口径 | 计数 | 判读 |
|---|---|---|
| `dsha.cc`（主判据） | **0** | ✅ 域名彻底清零 |
| `\bDSHA\b`（整词） | **0** | ✅ |
| `DSHA` 原始子串 | **2** | ⚠️ 见下，白名单魔数 |
| `dsha` 原始子串 | **2** | ⚠️ 见下，英文词缀 |
| `Ldsha`（大小写敏感） | **0** | ✅ 无旧类路径 |
| `DeepSeekHarness` | **97** | ✅ 新品牌已进产物 |

### §4.1 ★ 逐条解释 4 个非零命中（不得只报 `dsha.cc=0` 了事）

```
$ grep -aoE '[A-Za-z_]*DSHA[A-Za-z_]*' /tmp/all.dex | sort | uniq -c
      1 DSHADATA
      1 DSHABAK
$ grep -aoE '[A-Za-z_]*dsha[A-Za-z_]*' /tmp/all.dex | sort | uniq -c
      2 HandshakeKDFFunction
```

| 命中 | 来源 | 性质 | 处置 |
|---|---|---|---|
| `DSHADATA` | `BackupArchive.java:9` `{'D','S','H','A','D','A','T','A'}` | **备份文件格式魔数** | ✅ **保留正确**。上游 `/tmp/dsha-up` **同样这两个魔数，一字节未改**；且 `tools/verify-brand-integrity.py:41-42` 已将二者列入白名单。**改了才是缺陷** —— 会让已有备份包无法被新版本读取。 |
| `DSHABAK5` | `PortableBackupCrypto.java:16` `{'D','S','H','A','B','A','K','5'}` | 同上 | 同上 |
| `HandshakeKDFFunction` | bouncycastle 库 | 英文单词 **hand**·**sha**ke 内含 `dsha` | ❌ **误报**，非品牌名 |

> **★ 匹配规范（本轮同根因第 4 次出现，已升格为 K37）**：
> **品牌扫描禁止裸 substring + 忽略大小写（`-i`）**。本轮 4 次误报：
> `handshake` / `HandshakeKDFFunction` / `buildShadowCorners` / `loadSharedConfigFiles`。
> **必须**用：① 大小写敏感 或 ② 词边界 `\bdsha\b` 或 ③ 明确 token 形态（`dsha.cc` / `Ldsha/`）。
> **且命中后必须逐条打印内容人工判读，不得只看计数。**

### §4.2 资源表（`aapt2 dump resources`，新 APK）

| 口径 | 计数 |
|---|---|
| `DSHA` | **0** ✅ |
| `Shape.DSHA` | **0** ✅ |
| `Dialog.DSHA` | **0** ✅ |
| `DeepSeekHarness` | 52 ✅ |
| `DEEPSEEK_HARNESS` | 43 ✅ |

**产物级 style 闭环**（此前因 stale APK 一直 FAIL，现 PASS）：
```
resource 0x7f110162 style/Shape.DEEPSEEK_HARNESS_Dialog
  () (style) size=2
    cornerFamily(0x7f130133)=0
    cornerSize(0x7f130139)=32.000000dp          ← ★ 32dp 已进入产物 ✅
resource 0x7f11012c style/Dialog.DeepSeekHarness.Material
    shapeAppearanceOverlay(0x7f13037c)=@style/Shape.DEEPSEEK_HARNESS_Dialog   ← ★ 闭环成立 ✅
```
配套族全部在产物中：`Widget.DEEPSEEK_HARNESS_DialogNegative`(5)、
`TextAppearance.DEEPSEEK_HARNESS_DialogBody`(2)、`TextAppearance.DEEPSEEK_HARNESS_DialogTitle`(2)、
`Widget.DEEPSEEK_HARNESS_BottomNavActiveIndicator`(1)、`TextAppearance.DeepSeekHarness.NavLabelActive`(1)、
`DeepSeekHarnessCard` → `@drawable/bg_card` ✅

> **命名风格说明（lead 裁定：非缺陷）**：源码 `Shape.DEEPSEEK_HARNESS_Dialog`（下划线+全大写）
> 与 ref 的 `Dialog.DeepSeekHarness.Alert`（点号+PascalCase）风格不同；
> res XML 的 `name=` 与资源表 dump 用**点号**，仅 Java `R.style.` 用**下划线**。属命名风格差异，**非缺陷**。

### §4.3 L6j：中间产物与 APK dex

```
 [PASS] L6j: 中间产物与 APK dex 均无品牌残留
```
**旧 APK 曾 10 处 `dsha.cc`** ⇒ 该断言从红转绿的**唯一原因是重建**，
再次印证「产物级证据必须绑定产物自身的构建标识」。

---

## §5 单测与构建验证

```
> Task :app:testStandardDebugUnitTest        ← ★ 真执行，非 NO-SOURCE / 非 UP-TO-DATE
BUILD SUCCESSFUL in 1m32s
```

**测试计数（口径：`app/build/test-results/testStandardDebugUnitTest/TEST-*.xml`）**：

```
  XML 文件数 = 121
  tests = 631   failures = 0   errors = 0   skipped = 0     ✅ 全绿
```

**冻结协议**：构建前/后树指纹均为 `a3c2d8ceff00895964746c6c8b266aad963e961897a342ca197247347371504f` ✅

### §5.1 关于「未单独跑 `compileStandardDebugJavaWithJavac`」的说明

**我没有补跑独立 compile 全量采集。** 推理（lead 已认可）：

> 测试任务**依赖**编译任务 ⇒ `testStandardDebugUnitTest` 跑通
> ⇒ **逻辑上必然证明** `compileStandardDebugJavaWithJavac` 通过。
> 这比「再跑一次 compile」是**更强**的证据（它是端到端成功的必要条件）。

---

## §6 ★ 「零命中三前提」元规则（本轮最重要方法论产出）

> **任何「零命中 / 零值」结论，只有在同时满足以下三条之后才成立。**
> 本轮三条**各自都被踩过至少一次**。

| # | 前提 | 含义 | ★ 本轮真实实例 |
|---|---|---|---|
| ① | **查询有效性** | 查询本身成功执行了吗 | `/tmp/dsha-up` **不是 git 仓库** ⇒ `git ls-files` 静默报错被读成「空」 |
| ② | **扫描器有效性** | 探测器对**该对象**有效吗 | 5 个 `.bin` **全是 gzip**（魔数 `1f8b`）⇒ `strings` 对压缩流**结构性失明** |
| ③ | **样本非空** | 采样空间真的采到了吗 | 我 glob 口径写错 ⇒ 0 文件，而断言 `0==0` 便打印「✅ 全绿」 |

### §6.1 实例 ②：gzip 失明（K38）

```
 魔数实测（od -An -tx1 | head -c2）：dsh-runtime / offline-rootfs / pnpm-runtime /
                                    python-support / ubuntu-tools 全部 = 1f8b
 ⇒ strings 只能看到【压缩流】⇒ 「正对照 deepseek = 0」不是「里面没有」，
   而是「strings 看不到」⇒ ★ 5 个 bin 的 strings 断言【全部是弱断言】
```

**修正后的有效断言（解压后再扫）**：

| 文件 | 条目数 | 路径含 `dsha`/`DSHA`/`Dsha`（大小写敏感） | 正对照 |
|---|---|---|---|
| `dsh-runtime.bin` | 13,788 | **0** ✅ | 路径含 `deepseek` = **13,517** ✅ |
| `offline-rootfs.bin` | 9,132 | **0** ✅ | —— |
| `pnpm-runtime.bin` | 1,071 | **0** ✅ | —— |
| `python-support.bin` | 4 | **0** ✅ | —— |
| `ubuntu-tools.bin` | 31 | **0** ✅ | —— |

**内容口径（我的独立采集，`gzip.open` 流式 + 词边界正则）**：
```
 dsh-runtime.bin      词边界 dsha/DSHA = 0   正对照 deepseek = 45,047
 offline-rootfs.bin   词边界 dsha/DSHA = 0   正对照 deepseek =      6
 pnpm-runtime.bin     词边界 dsha/DSHA = 0   正对照 deepseek =  1,139
 python-support.bin   词边界 dsha/DSHA = 0   正对照 deepseek =      0   ← 弱断言
 ubuntu-tools.bin     词边界 dsha/DSHA = 0   正对照 deepseek =      0   ← 弱断言
```
> **★ 报告措辞规范**：不得写「其中无品牌名」，只能写
> **「解压后按 N 种口径扫描命中 0」**。两个正对照为 0 的 bin，其断言标注为**弱断言**。

### §6.2 实例 ③：我的第 12 次闸门错误（自我抓出）

```python
# 错误版本
for p in glob.glob('app/build/test-results/**/*.xml'):   # ← 返回 0 个文件
    ...
print(f"⇒ {'✅ 全绿' if f==0 and e==0 else '❌'}")        # ← ★ 0==0 && 0==0 ⇒ 打印「全绿」
```

**修正**：口径改为显式目录 `.../testStandardDebugUnitTest/TEST-*.xml`，
断言增加 `tot>0` **且** `文件数>0` ⇒ 得到真实的 `121 文件 / 631 测试`。

> **★ 教训**：**「零值通过」类断言必须携带一个「非零前提」。**
> 任何 `X == 0 ⇒ PASS` 的闸门，都必须同时断言「采样空间非空」。

### §6.3 三条前提的统一元规则

```
 ★ 「零命中」只有在【证明探测器对该对象有效】且【证明样本非空】之后才能作为结论。
   ⇒ ① 管「查询成功了吗」 ② 管「探测器看得见吗」 ③ 管「样本采到了吗」
```

---

## §7 我修掉的 4 个自家闸门 bug（★ 自反性失败）

> **★ 规则若只用于审查别人而不用于审查自己的工具，就会在工具层产生系统性假红。**
> 本轮我在**自己的闸门**上违反了**自己刚立的规则**。

| # | Bug | 性质 | 抓出方式 |
|---|---|---|---|
| ① | APK 资源表缓存未绑定产物标识 | ★ 自反性失败 | 重建后仍报旧 APK 的 2 条 FAIL |
| ② | L6k `NameError: name 'x' is not defined` | 闸门从未运行过 | 修后**首次**输出真实数据 |
| ③ | 底栏 style 断言用旧名 `Widget.DSHA.*` | stale expectation | 新 APK 上假红 3 条 |
| ④ | `style/DshaCard` 断言旧名 | stale expectation | 现名 `DeepSeekHarnessCard` |

### §7.1 ① 详解：缓存未绑定产物标识（本轮最有价值的闸门修复）

```bash
# 旧逻辑
if [ ! -s /tmp/apkres.txt ]; then aapt2 dump resources "$APKR" > /tmp/apkres.txt; fi
```

```
 /tmp/apkres.txt 生成于 02:07:57（旧 APK 03:13 时代）
 新 APK mtime            04:58:07
 ⇒ ★ 缓存命中 ⇒ 【永不复用新 APK】⇒ 假红 2 条
   （Shape.DEEPSEEK_HARNESS_Dialog 缺失 / Dialog→Shape 闭环断裂）
 ⇒ ★ 这正是我自己定的规则「产物级证据必须绑定产物自身的构建标识」，
   而我自己的闸门违反了它
```

**修正**：按 APK `sha256` 命名缓存 ⇒ `/tmp/apkres.<sha256>.txt`。

### §7.2 ② 详解：闸门崩溃 ≠ 闸门通过

```python
nc=[p for p in sorted(paths) if not subprocess.run(
    ['git','-C',REPO,'cat-file','-e','HEAD:'+torepo(next((pre+x for name,pre in BASE if os.path.exists(pre+x)),x))],
    capture_output=True).returncode==0]
```
生成器内部绑定 `x`，**落回值又写裸 `x`** ⇒ `NameError`。

> 📌 **K29.4 第三条**：**「闸门崩溃」与「闸门通过」在只看 `ok`/`no` 时无法区分。**
> 修正后 L6k **首次**输出真实数据：`合计 321 个文件，未追踪 73 个`。

---

## §8 头号发现 ①：31 条译文断链（L6m 闸门）

### §8.1 机制

`app/src/main/java/com/deepseekharness/app/util/UiText.java:18-23`：

```java
public static String text(String value) {
    if(value==null||!"en".equals(language))return value;
    String translated=UiMessages.EN.get(value);
    return translated==null?value:translated;      // ← ★ 缺键【静默回落中文】
}
```

**⇒ 这是运行时按值查表**：中文原文即键。改名后中文变了 ⇒ 旧键失配 ⇒ **英文环境显示中文**。

### §8.2 决定性区分：`text` vs `choose`

| API | 行为 | 是否表依赖 | 计数 |
|---|---|---|---|
| `UiText.text("X")` | 查 `UiMessages.EN` | ✅ **是** | 1,869 处 |
| `UiText.choose("中","En")` | 英文**内联**，查表 | ❌ **否** | 284 处 |

**验证**：`AboutFragment.java:11` 与 `MainActivity.java:269` 用
`UiText.choose("关于 DeepSeekHarness","About DeepSeekHarness")`
⇒ **英文内联，不查表 ⇒ 不是缺陷** ✅

> **★ 我的错误史（两次）**：
> - 错误 1：把 `DSHA→DeepSeekHarness` **机械替换后的假设结果**当作源码事实（gate-error #11）。
>   实测：上游 78 条 `DSHA` 字符串**全部不在当前源码中**。
> - 错误 2：**未验证可达性** ⇒ 把 `choose(...)` 也算作缺陷。
> **正确方法**：只有 `UiText.text("X")` 且首参为字面量才表依赖。

### §8.3 闸门与结果

**交付物**：`/tmp/migration-evidence/l6m-i18n-reachability.py`（可执行闸门）

```python
LIT   = re.compile(r'UiText\.text\(\s*"((?:[^"\\\n]|\\.)*)"')   # 只取 text + 字面量
BRAND = re.compile(r'(?i)deepseek[\s_-]?harness|dsha')
norm()  # 把品牌形态归一为 <B> ⇒ 只比较【键结构】，不比较品牌写法
```

**口径**：当前树 vs `/tmp/dsha-up`。**对照基准**：上游表 + 上游源码（同口径重跑）。

```
 上游 1632 键无对应 / 214 可达
 当前 1671 键无对应 / 221 可达
 共同无键 188
 仅当前无键 33
 仅上游无键 26
 ⇒ ★ A 类（新增断链）= 【31 条】
```

**双向负对照**（内嵌于闸门）：
```
 (a) 改源码不改表 ⇒ 必须报 FAIL
 (b) 改表不改源码 ⇒ 必须报 PASS（无人消费）
```

样本（前 8 条）：
```
  1  AboutFragment.java            DeepSeekHarness 关于
 24  DeviceGrantsFragment.java:392 已开启：容器可读写手机存储任意文件（含 DeepSeekHarness 目录外）
 25  DeviceGrantsFragment.java:75  未找到 su；请确认手机已 root，且 root 管理器允许 DeepSeek…
 26  InstallFragment.java:172      DeepSeekHarness 安装日志
 27  PluginFragment.java:185       在线安装支持 GitHub 仓库、npm 包名、Release 下载链接和压缩包
 28  PluginFragment.java:654       DeepSeekHarness 内置插件
 29  PluginInstallActivity.java:48 初始化 DeepSeekHarness
 30  PluginInstallActivity.java:48 请先完成 DeepSeekHarness 首次初始化…
 31  DocumentPaths.java:79         软链接目标超出 DeepSeekHarness 目录
```

> **独立性**：lead 独立得出 **30** 条；差异是 4 行转写截断，**是同一批条目** ✅

### §8.4 处置（lead 已裁定：方案 A）

```
 ① 补 31 键（zh = 新形态；en 同步替换 DSHA/dsha → DeepSeekHarness）
 ② 必须在【APK 交付后】执行 —— 改 messages.json 会触发 prepareUiLanguages，打断在飞构建
 ③ 方案 B（只手改表）否决（违令）；方案 C（键与显示解耦）记为后续根治建议
 ⇒ ⚠️ 本轮【未执行】⇒ 英文环境这 31 条会显示中文（已知遗留）
```

### §8.5 L6m 边界声明

```
 · 只覆盖 `UiText.text("字面量")` 形态；变量拼接 / choose(...) 不在覆盖内
 · 「基数=1」只证一致性，不证正确性
 · ★ 不得把「L6m PASS」表述为「改名完整」
```

---

## §9 头号发现 ②：`NAME_PREFIXES` 同值化（含我本人的修正）

### §9.1 现场

`app/src/main/java/com/deepseekharness/app/backup/ExternalBackupScanner.java:77-85`：

```java
/**
 * 归档名前缀。扫描端必须认识<b>所有历史上真实出现过的</b>名字…
 * 新名（本版产出）与旧名（上游命名）各 five 个范围前缀…        ← ★ 注释
 */
private static final String[] NAME_PREFIXES = {
        "deepseekharness-backup-", "deepseekharness-migration-",
        "deepseekharness-sessions-", "deepseekharness-plugins-", "deepseekharness-settings-",
        "deepseekharness-backup-", "deepseekharness-migration-",     // ★ 与上面逐字相同
        "deepseekharness-sessions-", "deepseekharness-plugins-", "deepseekharness-settings-",
};
```

**去重检测**：总数 **10**，去重后 **5**，重复项 5 个（各 2 次）。

### §9.2 我的探针输出（有效事实）

```
  deepseekharness-backup-2026.tar.gz          → true
  DeepSeekHarness-backup-2026.tar.gz          → true
  DEEPSEEK_HARNESS-backup-2026.tar.gz         → false
  DSHA-backup-2026.tar.gz                     → false
```

### §9.3 ★ lead 的反驳（我独立复现，成立 —— 我错了）

```java
String lower = name.toLowerCase(Locale.US);      // ← 输入已被压成小写
for(String p:NAME_PREFIXES) if(lower.startsWith(p)) return true;
```
```
 lower("DEEPSEEK_HARNESS-backup-2026.tar.gz") = "deepseek_harness-backup-2026.tar.gz"
 ⇒ ★ 下划线【保留】⇒ 压小写后是 deepseek_harness- 而【不是】 deepseekharness-
 ⇒ 大写前缀在 lower 化输入上【恒 false】⇒ 是【死代码】
```

**我实跑自己的「修法」验证其无效**：

| 用例 | 原版 | 我的修法 |
|---|---|---|
| `deepseekharness-backup-2026.tar.gz` | true | true |
| `DeepSeekHarness-sessions-20260923-023712.tar.gz` | true | true |
| `DEEPSEEK_HARNESS-backup-2026.tar.gz` | **false** | **false** ← ★ 修了还是 false |

> **★ 我的第 4 个无效提议**：性质 = **「未在提出前先实跑验证修法」**。
> **教训：提出修法前必须实跑该修法，否则「修法」本身也是未经证据的断言。**

### §9.4 ★ 决定性判据：本机真实备份全部 MATCH

```
 /sdcard/Download/DeepSeekHarness/ 下真实存在：
   DeepSeekHarness-sessions-20260923-023712.tar.gz          → true  ✅
   DeepSeekHarness-sessions-20260923-092044-a7effb58.tar.gz → true  ✅
   DeepSeekHarness-20260925-standard-release.apk            → false ✅（正确排除）
   README.md.gz                                             → false ✅（正确排除）
 ⇒ ★★ 真实备份【没有一个被漏掉】⇒ 「历史备份失联」的推论【被证伪】
```

### §9.5 最终定性（低危，代码卫生类）

```
 真实问题 = ① 注释说谎（"各 five 个"，实际去重后 5 个）
            ② 数组 5 个冗余重复项
            ③ 与 DIRECTORY_NAMES 的双形态风格不齐（【风格】，非【功能】）
 ⇒ ★ 不是「历史备份失联」（已实测证伪）
 ⇒ 处置：方案 (b) 本轮不修（保住已交付两个 APK 的 sha256）；列为遗留项
```

**仍成立的观察**：`looksLikeBackupName` 在 `app/src/test` 下**零单元测试覆盖**，
而现有测试恰好覆盖了处理正确的 `BackupScope` 与 `LegacyBackupImporter`
⇒ **「该入口零测试覆盖（测试恰好绕开了它）」**，但**不得**据此推论「大写备份失联」。

---

## §10 用户 9 条明确要求逐项核对

| # | 要求 | 状态 | 证据 |
|---|---|---|---|
| 1 | 移植上游新功能/设置/逻辑/插件 | ✅ | dsh `0.1.7-alpha.2`；内置插件 11 个 |
| 2 | 保留 dsh-web-mobile 左右排列布局 | ✅ | `fragment_plugins.xml`；`client.js` `140px`×12 + `flex-direction: row`×3 |
| 3 | 全部 `dsha`/`DSHA` → `DeepSeekHarness` | ✅ | APK dex `DeepSeekHarness`=97 / `dsha.cc`=0 / `Ldsha`=0 |
| 4 | 插件页只用「列表 + 命令行安装 + 在线安装」 | ✅ | 14 个 id：`btnCommandInstallBtn` `btnOnlineInstall` + 列表；商城控件已删 |
| 5 | 删除全部 dsha.cc 相关 | ✅ | 源码 `dsha.cc` 实体**0** 处；APK dex **0** |
| 6 | 自更新改走 GitHub Releases | ✅ | `UpdateEngine.java:42` `FEED = https://api.github.com/repos/xliaoy/DeepSeekHarness/releases` |
| 7 | 保留自更新（更新本体） | ✅ | `UpdateEngine` 走 GitHub Releases |
| 8 | **自选更新版本** | ⚠️ **未完成** | **最大遗留项**，见 §10.1 |
| 9 | 路径形态规则 | ✅ | 用户可见 `Download/DeepSeekHarness`（`update_file_paths.xml:6`）；内部 `share/deepseekharness` |

> **口径说明 ⑤**：`dsha.cc` 源码唯一命中 = `tools/verify-brand-integrity.py:32`
> `("dsha.cc", re.compile(r"dsha\.cc", re.I))` —— 这是**检测模式本身**，非真实引用 ✅

### §10.1 ⚠️ 遗留项 ①：「自选更新版本」未实现

**用户原话**：「加个自选更新版本的功能」，并确认「两者都要」
（= 自选 dsh 运行时版本 **和** APK 版本）。

**实测**：
```
 grep -rln 'versionList|selectVersion|自选版本|chooseVersion' app/src/main/java app/src/main/res
 ⇒ 无命中 ⇒ 未实现
```

**设计约束（GitHub API 无 `versionCode`）**：
```
 ⇒ 「自选 APK 版本」必须【下载 APK】再解析 AndroidManifest（BadgingParser）
 ⇒ release asset 命名：app-standard-release.apk / app-low-release.apk
 ⇒ digest 三路复现：v2026.09.22 的 assets 带 digest=sha256:…，
   但 v2026.09.22 仅有 2 个 asset 且【无 .sha256】；v2026.09.18/09.16/v1.0.9 各有 4 个
 ⚠️ release name「DSHA v2026.09.22」属【外部数据】⇒ 排除出品牌残留断言
```

---

## §11 改名安全与保留清单审查

### §11.1 ★ 头号发现 ③：KEEP 清单 16 条中 15 条不成立

**闸门 L6g 输出**：
```
 ① 存在性异常 15
 ② 最小单元（不得为 R 类的路径扩展）违反 6
 ③ 方向性异常 1
 ③ 负对照 : DSHA_ARM64_V2 的子串命中 = ['DSHA']（应为空，说明判据不是纯子串匹配）
```

> **★ 方向性危害（lead 定性）**：
> 「保留清单具有**方向性危害**：它不是「保守」，而是**基于错误前提的主动破坏源**。」
> 「『保留』必须被证明…凡声称『不能改』的，必须给出**可复现的失败证据**；
> 给不出的，一律视为**应改未改**。」
>
> ⚠️ **重要限定**：这 15 条**实际上从未被误执行**。
> 风险陈述：**若严格执行该清单，会把已正确改名的 5 处回滚为旧名。**

### §11.2 唯一可辩护的 KEEP 条目：`DSHA_ARM64_V2`

**lead 裁定：保留（方案 i），报告为「有意保留」（class C）**。
理由：协议握手常量，非用户可见；改名会**主动声明跨版本不兼容**。
真实损害若误改 = 静默破坏 `RuntimeDescriptor.java:38-43` 的 `compatible()`，
调用方 `ManagedRuntimeTransaction.java:131`、`ProotBootstrap.java:128`。

### §11.3 四集合恒等式（K8 版本轴）

```
 ORIGINAL(489) == EXCLUDED(60) ∪ PRESERVED(16) ∪ REPLACED(392) ∪ DELETED(21)
 当前：60 + 16 + 392 = 468，差 21  ⇒ DELETED ⊂ ORIGINAL 待补
 每个 DELETED 必须含 dsha.cc；工作区 DELETED 必须 = 0
```

### §11.4 备份族（Plan B）最终态

| 位置 | 写端 | 读端 |
|---|---|---|
| 目录名 | `DeepSeekHarness` | `{"DeepSeekHarness", "DEEPSEEK_HARNESS"}` ✅ 双形态 |
| 文件名前缀 | `deepseekharness-*` | 见 §9（**单形态**，已定性低危） |
| README | `DeepSeekHarness-README.txt` | `DEEPSEEK_HARNESS-README.txt` + `DeepSeekHarness-README.txt` |
| FileProvider | `Download/DeepSeekHarness` | —— |

**互补读端（均为双形态）**：
```
 BackupScope.java:78-80                  "DeepSeekHarness-x-" || "DEEPSEEK_HARNESS-x-"  ✅
 LegacyBackupImporter.java:105-106       同  ✅
 ExternalBackupScanner.java:74           DIRECTORY_NAMES 双形态  ✅
 ExternalBackupScanner.java:80-85        NAME_PREFIXES ★ 单形态（§9）
```
> **上游对照**：上游消费端只认 `DSHA-README.txt`；
> `DEEPSEEK_HARNESS-README.txt` 是**fork 新增的前向兼容值**，
> 产出端从不写它 ⇒ 一条**死兼容分支**（无害）。

---

## §12 跨边界与 L6 闸门族

### §12.1 跨边界判据

```
 跨边界 = 值在【生产端】与【消费端】必须逐字相同，且两端【跨技术栈】
 操作性检验 = 「是否存在【按值匹配】的消费代码」
```

**L2 结果**：`[PASS] 无「Java 产出新名 / assets 消费旧名」的劈开式改名`
（该闸门动机：只扫新名 = **自证式检查**，会漏掉「旧名残留在另一端」）

### §12.2 L6 闸门族边界声明（**不得把 L6 PASS 表述为「改名完整」**）

| 闸门 | 覆盖 | 边界 |
|---|---|---|
| L6 | 六形态枚举 | (a) 形态轴枚举**永远可能不完备**；(b) exemption 白名单人工登记；(c) 「基数=1」只证一致性**不证正确性**；(d) 只覆盖已登记族 |
| L6b | 跨端契约 | **无法**捕获「两端一致地错」 |
| L6j | 产物品牌 | 覆盖 `dsha.cc` 字面量；**排除** `DSHA`/`dsha`（合法 dex 存活：`DSHA_ARM64_V2`、`DSHA-sessions-`） |
| L6k | Gradle inputs 追踪 | 仅 `inputs.file/dir/files(...)` 可从 `app/build.gradle` 解析的字面量；白名单 = 5 个 `.bin` |
| L6l | K3 长度耦合 | 220 字符启发式窗口；仅 `X + N` 算术形式。**本轮 0 命中** ✅ |
| L6m | 译文断链 | 见 §8.5 |

### §12.3 L6k 口径澄清（★ lead §⑤ 要求）

```
 我的 L6k 口径 : app/src + tools，排除 __pycache__ / build ⇒ 321 个文件，未追踪 73
 lead 的口径   : git status 全部未追踪 = 448；assets 下未追踪 = 51
 ⇒ ★ 两者【不是矛盾】，是【不同口径】（K29.4 第一条：必须先声明口径与基准）
 ⇒ 73 的性质 = 迁移未提交（K22），用户已明确选择稍后自行处理
```

---

## §13 ★ K22：迁移未提交 = 头号报告级发现

```
 HEAD                          : 62d8459（未变）
 git diff --stat HEAD          : 339 files changed, 53,783 insertions(+), 25,015 deletions(-)
 未追踪总数                    : 448
 modified-not-committed        : 292–293
```

**核心问题**：**所有数字都无法用 git 复现。**

```
 ★ 任何「当前工作区」的测量都会随时间漂移
 ⇒ 本报告每条数字必须绑定【工作区快照时间戳 + 采集命令口径 + 对照基准】
 ⇒ 无法绑定的，只能标注为「观测值」，【不得】作为缺陷声明
```

**lead 的升级**：「出包前必须提交，且必须**分多次提交**按工作性质拆分」；
现实折衷 = commit 1（上游迁移 + 定制）+ commit 2（本轮改名 + 构建链修复）。
**用户选择：先不提交，自己稍后处理。**

**树指纹（可复现锚点）**：`a3c2d8ceff00895964746c6c8b266aad963e961897a342ca197247347371504f`
（口径：`app/src` + `tools` 全文件 sha256 排序聚合，排除 `__pycache__`/`build`）

### §13.1 「迁移未提交」的连带审计盲区

**★ 展示案例**：`app/src/main/assets/web-integration/language.js` ——
它是 `__DeepSeekHarness_LANGUAGE__` 的**唯一消费者**，却**从未被 git 追踪过**。

**未追踪资产分层表（口径：`git ls-files --others --exclude-standard`）**：

| 类别 | 数量 | 处置建议 |
|---|---|---|
| 源码资产（`.ts`/`.js`/`.json`/`.yml`/`.py`/`.sh`/`.cjs`/`LICENSE`） | 19 | **应追踪** |
| `.d.ts` | 10 | **应追踪** |
| `.d.ts.map` | 10 | **应追踪** |
| 生成物 | 2 | 应追踪或明确 ignore |
| `.pyc` | 20 | 应 ignore（`.gitignore:29`） |
| `.bin` | 5 | 应 ignore（`.gitignore:24-26`；**不得 `git add` 126MB**） |

> **★ 独立修正（lead 已采纳）**：对照 `/tmp/xliaoy-ref`（**是** git 仓库）：
> `.d.ts` **43/43 追踪** 且 `.d.ts.map` **28/28 追踪**；
> 同一 `dsh-web-mobile/lib/types` 目录 ref 有 56 条目、本仓 76。
> ⇒ **`.d.ts.map` 应被追踪，而非忽略。**（更细粒度证据优先于总量级证据）
>
> **口径差异说明**：我的 51 vs lead 的 71，差异 = `__pycache__/*.pyc` 是否计入。**不执行 `git add`。**

---

## §14 闸门自身出错台账（累计 14 条）

| 闸门/环节 | 次数 | 错因分类 | 被什么抓出 |
|---|---|---|---|
| verifier 主线（含本轮 2 条） | 6 | 口径/基准/工具类 | 自查 + lead 对照 |
| java-port | 2 | 口径/基准类 | lead |
| lead | 2 | 口径/基准类 | 自查 |
| 词中缀误报 | 4 | 探测器类 | 命中后逐条判读 |
| **合计** | **14** | | |

```
 分类分布（互斥二分，合计 14）：
   · 基线 / 口径 / 探测器类 : 10 条（71%）   ← ★ 本题头号风险来源
   · 纯词中缀误报类          :  4 条（29%）
 ⇒ ★ 结论句：头号风险是【量错】而非【算错】
```

> **★ 口径说明**：上表按「环节」与「错因」两个维度交叉；为避免重复计数，
> 分类分布采用**互斥二分口径**（每条只归一类），故与「按环节」的行计数不可直接相加比对。
> lead 的独立统计为「累计 14 条，其中基线/口径/探测器类 11 条（79%）」；
> 我的互斥口径得 10 条（71%）。**差异 1 条源于归类边界**（我将 4 条词中缀误报独立成类，
> lead 将其中 1 条计入探测器类），**不影响「量错 > 算错」的结论方向**。

### §14.1 本轮我自己犯的（诚实记录）

| # | 错误 | 类别 |
|---|---|---|
| 8 | K3 扫描按**扩展名**判语言，漏掉 `assets/*.sh`（内含真 JS） | 探测口径 |
| 9 | 把 `DSHA→DeepSeekHarness` **机械替换的产物**当源码事实 | 基准错误 |
| 10 | 未验证可达性 ⇒ 把 `choose(...)` 计入缺陷 | 口径 |
| 11 | 提出 `NAME_PREFIXES` 修法**未先实跑**，实为死代码 | 未验证断言 |
| 12 | glob 返回 0 却打印「全绿」（`0==0`） | 样本非空 |

### §14.2 ★ 结论句

```
 ══════════════════════════════════════════════════════════════
  头号风险是【量错】而非【算错】。
 ══════════════════════════════════════════════════════════════
   计算错误会被异常暴露；基准错误会【安静地】给出看似合理的错数。
   ⇒ 本项目最高发错误类型 = 基准错误（本轮台账 14 条中 11 条，79%）
   ⇒ 任何数字必须携带【口径定义 + 对照基准 + 采集命令】，缺一只能作为「观测值」
```

---

## §15 新增规则（本轮沉淀）

| 编号 | 规则 |
|---|---|
| **K33** | **内容寻址产物（归档 + 元数据哈希对）的【生成端输入路径】与【校验端输入路径】必须指向同一实体。** 若不同，重新生成是唯一修法；只手改哈希 = 伪造记账。源一变必须重生成；只改源不重生成 ⇒ 闸门拒绝是**正确行为**。 |
| **K34** | **任何「扫描产物」的断言，必须先证明扫描器对该产物有效**（正对照），再声明命中数。 |
| **K37** | **品牌扫描禁止裸 substring + 忽略大小写（`-i`）**；必须大小写敏感 / 词边界 / 明确 token 形态；**且命中后必须逐条打印内容人工判读**。 |
| **K38** | **扫描前先验容器格式**（`1f8b`=gzip / `42 5a`=zstd / 无=tar）；压缩容器**必须解压后再扫**，不得在压缩流上跑 `strings`。 |
| **K29.4 第三条** | **「闸门崩溃」≠「闸门通过」**：只看 `ok`/`no` 时二者无法区分；必须校验闸门自身的退出码与输出完整性。 |
| **零命中三前提** | 「零命中」只有在【证明探测器对该对象有效】且【证明样本非空】之后才能作为结论。 |
| **修法需自证** | **提出修法前必须实跑该修法**，否则「修法」本身也是未经证据的断言。 |
| **自反性** | **规则若只用于审查别人而不用于审查自己的工具，就会在工具层产生系统性假红。** |

---

## §16 遗留项汇总

| # | 项 | 危害 | 处置 |
|---|---|---|---|
| ① | **「自选更新版本」未实现** | **高**（用户明确要求） | 下轮实现，见 §10.1 |
| ② | 31 条译文断链（英文环境显示中文） | 中 | 方案 A 补键，须在 APK 交付后执行 |
| ③ | `NAME_PREFIXES` 去重 + 注释订正 | 低（代码卫生） | 本轮不修（保 APK sha256） |
| ④ | `dsh-runtime.bin` 的 `.inputs.json` 记账曾长期不一致 | 中（已修） | 已随方案 A 修正 |
| ⑤ | `build-dsh-runtime.py` 在 fuseblk 上非零退出 | 低 | 待办：改 output 路径或回退 copyfile |
| ⑥ | 迁移未提交（448 未追踪） | **报告级** | 用户选择稍后自行处理 |
| ⑦ | `.d.ts.map` ×10 应追踪 | 低 | 建议下轮 `git add` |
| ⑧ | `looksLikeBackupName` 零测试覆盖 | 低 | 建议补测试 |

---

## §17 验证方法学与可复现性

### §17.1 全部闸门与工具

| 工具 | 路径 | 用途 |
|---|---|---|
| 主验证 harness | `/tmp/migration-evidence/verification-harness.sh` | 196 PASS / 2 FAIL，含 A–M 全小节 |
| 译文断链闸门 | `/tmp/migration-evidence/l6m-i18n-reachability.py` | 31 条 A 类 |
| 冻结协议 | `/tmp/migration-evidence/freeze-guard.sh` | 树指纹 + 构建前后比对 |
| 品牌三口径 | `tools/verify-brand-integrity.py` | 白名单含 2 个备份魔数 |

### §17.2 构建纪律

```
 · 唯一正确调用：sh /root/tools/build-dsh.sh <task>   （禁用裸 ./gradlew）
 · 输出一律 > file 2>&1，禁止 | tail
 · 单 Gradle 进程（team-wide 单 token）
 · 重试前清理 app/build/intermediates/javac/standardRelease
 · Duplicate resources ⇒ 清 app/build/intermediates/{assets/standardRelease,mergeStandardReleaseAssets}
```

### §17.3 证据纪律

```
 · 只引用我【自己算出】的数字；同侪结果仅作旁证
 · 标注证据级别（产物级 vs 源码级）
 · 绝不以「等价 Java 驱动通过」冒充「Gradle 通过」
 · 宁可不给，不给错数
```

---

## §18 结语

```
 【能否交付】→ 能。阻塞交付 0，两个 APK 已签名、可安装、sha256 已固化。
 【验证是否充分】→ 196 项断言 PASS；2 条 FAIL 均经证伪为非产品缺陷。
 【最大遗留】→ ①「自选更新版本」未实现（用户明确要求）
              ②31 条译文断链（英文环境）
 【本轮最有价值的产出】
   · 冻结协议 —— 把「停手」从承诺变成可观测事实，使产物绑定源码版本成为【事实】
   · 零命中三前提 —— 把「查询有效 / 探测器有效 / 样本非空」统一为一条元规则
   · 自反性失败 —— 规则必须同样约束自己的工具，否则工具层产生系统性假红
   · NAME_PREFIXES 的「修法实为死代码」—— 提出修法前必须实跑该修法
```
