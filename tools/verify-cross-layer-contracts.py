#!/usr/bin/env python3
"""产者/消费者契约闸门 —— 在构建期发现"跨端改名劈开"类缺陷。

## 为什么需要它

本项目在品牌改名（dsha/DSHA -> DeepSeekHarness）过程中，反复出现同一类缺陷：
**同一个契约的一端改了名，另一端没改（或改成了不同的新名）**，于是运行时静默失效
或在设备冷安装时才炸。已实际发生的实例：

  1. `agent-preset-patch.json` 陈旧补丁集 -> 冷安装失败在「准备应用工具」
  2. `install-ubuntu-tools.sh` 丢掉了 `$1` 参数化 -> `cd /root/.deepseekharness-bundled-tools`
     找不到目录 -> 冷安装失败在「安装离线 curl、git 与证书」
  3. shell 打印 `DeepSeekHarness_UBUNTU_TOOLS_READY`，Java 断言
     `DEEPSEEK_HARNESS_UBUNTU_TOOLS_READY` -> 即使目录对了也会判失败

这三例的共同点：**两端都在，名字却对不上**，编译期完全无感知。

## 本闸门做什么

扫描 assets 下的 shell/python 产者与 Java 消费者，针对若干**已知契约族**做双向配对，
并做通用的一致性检查：

  A. READY/DONE 标记：脚本 printf 出的标记字符串，必须在 Java 中有同名字面量。
  B. 位置参数契约：Java 传给脚本的 `$1` 参数，脚本必须真的消费 `$1`。
  C. 品牌残留：产者/消费者两侧都不应出现旧品牌 `dsha/DSHA/Dsha`（白名单除外）。

## 设计约束（本项目铁律）

- **正对照必须存在**：断言"至少检出 N 个标记/契约"，否则零样本会误判全绿（K41）。
- **样本非空**：断言扫描到的文件数 > 0。
- 每个结论都要打印**判据**，便于人工复核。

用法:
    python3 tools/verify-cross-layer-contracts.py            # 默认扫仓库
    python3 tools/verify-cross-layer-contracts.py --root DIR
退出码: 0=全部一致; 1=发现劈开/断链; 2=扫描环境异常（零样本等）
"""
from __future__ import annotations

import argparse
import os
import re
import sys

# ── 已知允许保留旧品牌的位置（协议/兼容契约，见 RENAME-SAFETY-RULES.md）──────────
BRAND_ALLOWLIST = {
    "DSHA_ARM64_V2",      # 架构标识，影响 runtimeId
    "DSHADATA",           # 备份归档 magic
    "DSHABAK5",           # 便携备份 magic
    "libproot_legacy",    # 原生库旧名
}

# 旧品牌词元（词边界内），排除白名单后即为残留
BRAND_RE = re.compile(r"[A-Za-z0-9_$-]*(?:dsha|DSHA|Dsha)[A-Za-z0-9_$-]*")

# READY/DONE 风格标记
MARKER_RE = re.compile(r"[A-Z][A-Z0-9_]{5,}_(?:READY|OK|DONE|COMPLETE)\b")

# 只有这些标记是"跨端契约"（Java 会断言）。其余是脚本内部自产自销的使用痕迹。
CROSS_LAYER_MARKER_RE = re.compile(r"_READY\b")


def read(path: str) -> str:
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def collect(root: str):
    assets = os.path.join(root, "app/src/main/assets")
    java = os.path.join(root, "app/src/main/java")

    producers, consumers, scan = {}, {}, []

    if os.path.isdir(assets):
        for name in sorted(os.listdir(assets)):
            if not name.endswith((".sh", ".py")):
                continue
            p = os.path.join(assets, name)
            if not os.path.isfile(p):
                continue
            scan.append(p)
            text = read(p)
            for m in MARKER_RE.finditer(text):
                producers.setdefault(m.group(0), set()).add(name)

    if os.path.isdir(java):
        for base, _dirs, files in os.walk(java):
            for name in files:
                if not name.endswith(".java"):
                    continue
                p = os.path.join(base, name)
                scan.append(p)
                text = read(p)
                for m in MARKER_RE.finditer(text):
                    consumers.setdefault(m.group(0), set()).add(name)

    return producers, consumers, scan


def discover_argv_contracts(root: str):
    """找出 Java 里 `... /root/dsh-bin/<script>` 后跟一个参数实参的调用点。

    返回 [(script_name, java_file, java_line_no)]。
    """
    java = os.path.join(root, "app/src/main/java")
    found = []
    if not os.path.isdir(java):
        return found
    # 形如: "/bin/bash /root/dsh-bin/NAME " + ...arg(x)
    pat = re.compile(r'/root/dsh-bin/([A-Za-z0-9._-]+)\s*"\s*\+\s*\S')
    for base, _dirs, files in os.walk(java):
        for name in files:
            if not name.endswith(".java"):
                continue
            p = os.path.join(base, name)
            for i, line in enumerate(read(p).splitlines(), 1):
                for m in pat.finditer(line):
                    found.append((m.group(1), name, i))
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.getcwd())
    args = ap.parse_args()
    root = args.root

    producers, consumers, scan = collect(root)

    print("=" * 74)
    print("产者/消费者契约闸门")
    print("=" * 74)
    print(f"扫描文件数 = {len(scan)}")

    # ── 样本非空（K41）────────────────────────────────────────────────
    if len(scan) == 0:
        print("!! 【样本非空】失败：未扫描到任何文件，零样本不能算通过")
        return 2
    if not producers:
        print("!! 【样本非空】失败：未发现任何产者标记，判据可能失效")
        return 2
    print(f"产者标记   = {len(producers)}")
    print(f"消费者标记 = {len(consumers)}")
    print()

    failures = []

    # ── A. 跨端 READY 标记配对 ────────────────────────────────────────
    print("── A. 跨端 READY 标记配对 ──")
    cross = {k: v for k, v in producers.items() if CROSS_LAYER_MARKER_RE.search(k)}
    checked = 0
    for marker, files in sorted(cross.items()):
        checked += 1
        where = ",".join(sorted(files))
        if marker in consumers:
            print(f"  OK   {marker:46} 产者={where}  消费者={','.join(sorted(consumers[marker]))}")
        else:
            print(f"  FAIL {marker:46} 产者={where}  ★ 消费者侧无同名字面量")
            failures.append(f"标记断链: {marker}（产者 {where}，Java 无同名断言）")
    if checked == 0:
        print("  !! 【正对照】失败：未检出任何跨端 READY 标记，闸门可能已失效")
        return 2
    print(f"  → 正对照通过：检查了 {checked} 个跨端标记")
    print()

    # ── B. 位置参数契约 ──────────────────────────────────────────────
    print("── B. 位置参数契约（Java 传 $1 → 脚本须消费 $1）──")
    argv_contracts = discover_argv_contracts(root)
    assets_dir = os.path.join(root, "app/src/main/assets")
    b_checked = 0
    for script, jfile, line in sorted(set(argv_contracts)):
        b_checked += 1
        # Java 侧通常写 /root/dsh-bin/<name>（guest 内脚本无扩展名，实际落盘为 <name>.sh）
        cands = [os.path.join(assets_dir, script),
                 os.path.join(assets_dir, script + ".sh")]
        sh = next((c for c in cands if os.path.isfile(c)), None)
        if sh is None:
            print(f"  ??   {script:40} Java:{jfile}:{line} 调用了但 assets 下无此脚本")
            continue
        body = read(sh)
        uses = re.search(r'\$\{?1\b', body) is not None
        if uses:
            print(f"  OK   {script:40} Java:{jfile}:{line}  脚本消费 $1 ✅")
        else:
            print(f"  FAIL {script:40} Java:{jfile}:{line}  ★ Java 传参但脚本未消费 $1")
            failures.append(f"参数断链: {script} 被传 $1 但脚本未使用")
    if b_checked == 0:
        print("  !! 【正对照】失败：未检出任何带参调用点")
        return 2
    print(f"  → 正对照通过：检查了 {b_checked} 个带参调用点")
    print()

    # ── C. 品牌残留（两侧）───────────────────────────────────────────
    # ★ 精度控制（本项目 K42 教训：词内命中是最大的假阳性来源）：
    #   1) 只认【词边界】上的独立品牌词元，避免 handshake / PAIR_HANDSHAKE 类误报。
    #   2) 跳过注释行——注释里说明"改名前叫什么"是合法的、且是有价值的文档，
    #      不能当成残留（否则会诱导后人删掉改名记录）。
    print("── C. 品牌残留（词边界 + 跳过注释）──")
    WORD_BRAND_RE = re.compile(
        r"(?<![A-Za-z0-9_])"          # 左侧非词字符
        r"(?:dsha|DSHA|Dsha)"         # 旧品牌词元本体
        r"(?![A-Za-z0-9_])"           # 右侧非词字符（真实代码里罕见，多为文档）
    )
    COMMENT_PREFIXES = ("#", "//", "*", "/*", "<!--")
    residues = []
    for p in scan:
        for lineno, line in enumerate(read(p).splitlines(), 1):
            stripped = line.lstrip()
            if stripped.startswith(COMMENT_PREFIXES):
                continue
            for m in WORD_BRAND_RE.finditer(line):
                tok = m.group(0)
                if any(a in line for a in BRAND_ALLOWLIST):
                    continue
                residues.append((os.path.relpath(p, root), tok, lineno))
    if residues:
        for f, t, ln in residues[:20]:
            print(f"  FAIL {t!r:12} {f}:{ln}")
            failures.append(f"品牌残留: {t!r} 在 {f}:{ln}")
        if len(residues) > 20:
            print(f"  ... 另有 {len(residues) - 20} 处")
    else:
        print("  OK   非注释代码中零残留 ✅")
    print()

    # ── 汇总 ────────────────────────────────────────────────────────
    print("=" * 74)
    if failures:
        print(f"结论：发现 {len(failures)} 项契约问题")
        for f in failures:
            print(f"   - {f}")
        return 1
    print("结论：通过 —— 产者/消费者契约一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
