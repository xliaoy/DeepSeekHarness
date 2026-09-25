#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构建期闸门：校验 startup-observer 对 `dsh.bundle.patch` 的【声明形态】处理是否覆盖真实数据。

## 为什么需要它（一次真实逃逸到真机的缺陷）

`app/src/main/assets/startup-observer.cjs` 在启动时读每个插件的 `package.json`，
取出 `dsh.bundle.patch` 并校验每个补丁入口文件确实存在于该包内部。

旧实现只认【字符串】形态：

    const patch = pkg.dsh?.bundle?.patch;
    if (typeof patch !== 'string' || !(await exists(path.resolve(root, patch))))
        issue = '缺少 dsh.bundle.patch 声明或补丁文件';

而上游 dsh 0.1.7 的 `@deepseek-ai/dsh-web-app` 声明的是【5 个文件的数组】。
于是数组进入 `typeof patch !== 'string'` 分支即被判为"缺少声明"，
真机日志出现：

    [STARTUP_ERROR] @deepseek-ai/dsh-web-app: 缺少 dsh.bundle.patch 声明或补丁文件
    [WEB_FAILURE] 加载 DSH 和已启用插件：启动配置或插件加载失败

**这个缺陷在构建期完全静默**：它不在编译路径上，只在真机启动时按运行时数据触发。
本闸门就是把那次真机失败提前到构建期。

## 关键设计：闸门必须拿【真机上会读到的那份元数据】当输入

只断言源码里有 `Array.isArray(patch)` 是**弱断言** —— 它证明不了那份声明真的是数组，
也证明不了那 5 个补丁文件真的存在。所以本闸门的核心是【真实数据回放】：
从 `dsh-runtime.bin`（gzip tar，约 126 MB）里读出 `dsh-web-app/package.json` 本体，
按 observer 的判定语义复算一遍。

## 三项检查

  检查 1（形态覆盖，弱）  源码同时处理 string 与 array 两个分支
  检查 2（真实回放，强）  归档内真实 package.json：patch 是数组、长度 == 5、5 个文件 0 缺失
  检查 3（负对照，必须）  把 observer 逻辑在内存里回退成"只认字符串"，同一份真实数据
                          回放【必须】产出那条 issue；产不出则闸门本身失效 → exit 2

检查 3 是本闸门的意义所在：**一个测不出已知缺陷的闸门等于没有闸门。**

## 口径三元组

每条"通过"都打印 `数量 / 基线 / 命令`，避免"零命中被当成没问题"。

## 用法

    python3 tools/verify-startup-observer.py                  # 默认读仓库内 assets
    python3 tools/verify-startup-observer.py --runtime PATH   # 指定 dsh-runtime.bin 或 APK
    python3 tools/verify-startup-observer.py --observer PATH  # 指定 observer 源码

## 退出码

    0  全部通过
    1  发现缺陷（含负对照失败的具体断链原因）
    2  扫描环境异常（零样本 / 生产者为零 / 被检查数为零 / 输入缺失）
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
ASSETS = os.path.join(REPO, "app", "src", "main", "assets")
DEFAULT_OBSERVER = os.path.join(ASSETS, "startup-observer.cjs")
DEFAULT_RUNTIME = os.path.join(ASSETS, "dsh-runtime.bin")

# 归档内我们真正关心的那个消费者（真机启动时 dsh-web-app 会被加载）
TARGET_PKG = (
    "usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/"
    "@deepseek-ai/dsh-web-app/package.json"
)

# 上游 0.1.7 的期望长度。作为【观测基线】打印；若上游升级改变它，
# 应更新此常量而不是让闸门静默放过（见下方 --expected-len）。
EXPECTED_PATCH_COUNT = 5

# observer 在缺陷发生时打印的文案（负对照必须复现出它）
ISSUE_TEXT = "缺少 dsh.bundle.patch 声明或补丁文件"

# 检查 1 的锚点：数组分支。等价写法都接受。
ARRAY_BRANCH_PATTERNS = [
    re.compile(r"Array\.isArray\s*\(\s*patch\s*\)"),
    re.compile(r"Array\.isArray\s*\(\s*(?:pkg\s*\.\s*)?dsh\s*\?\s*\.\s*bundle\s*\?\s*\.\s*patch\s*\)"),
    re.compile(r"Array\.isArray\s*\(\s*patches\s*\)"),
]
# 检查 1 的锚点：字符串分支
STRING_BRANCH_PATTERNS = [
    re.compile(r"typeof\s+patch\s*===\s*['\"]string['\"]"),
    re.compile(r"typeof\s+patch\s*!==\s*['\"]string['\"]"),
]


# --------------------------------------------------------------------------
# 读取输入
# --------------------------------------------------------------------------
def _bail(msg: str) -> "NoReturn":
    """输入/环境异常统一走 exit 2（与仓内闸门风格一致：2 = 扫描环境异常）。"""
    print("!! %s" % msg, file=sys.stderr)
    raise SystemExit(2)


def _open_tar(path: str) -> tarfile.TarFile:
    """打开 dsh-runtime.bin（gzip tar）或 APK 内的 assets/dsh-runtime.bin。"""
    if not os.path.isfile(path):
        _bail("输入不存在：%s" % path)

    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            for entry in ("assets/dsh-runtime.bin", "dsh-runtime.bin"):
                if entry in names:
                    return tarfile.open(
                        fileobj=io.BytesIO(gzip.decompress(z.read(entry))), mode="r:"
                    )
            _bail("APK 内找不到 assets/dsh-runtime.bin；实际条目示例：%s" % names[:8])

    with open(path, "rb") as fh:
        head = fh.read(2)
    if head != b"\x1f\x8b":
        _bail("既不是 ZIP 也不是 gzip（魔数 %r）；无法当作 dsh 运行时读取。" % head)
    # 流式解压，不把整个归档展开到磁盘
    with open(path, "rb") as fh:
        return tarfile.open(fileobj=io.BytesIO(gzip.decompress(fh.read())), mode="r:")


def _norm(name: str) -> str:
    return name[2:] if name.startswith("./") else name


def scan_archive(tf: tarfile.TarFile):
    """一次遍历拿到：全部文件成员名 + 全部声明 dsh.bundle.patch 的 package.json。

    返回 (files:set[str], producers:list[dict], scan_count:int, pkg_total:int)
    `producers` 里每项含 name / form / items / root / missing。
    """
    files: set[str] = set()
    pkg_members: list[tuple[str, tarfile.TarInfo]] = []
    scan_count = 0

    for m in tf:
        if not m.isfile():
            continue
        n = _norm(m.name)
        scan_count += 1
        files.add(n)
        if n.endswith("package.json"):
            pkg_members.append((n, m))

    producers = []
    for n, m in pkg_members:
        try:
            doc = json.loads(tf.extractfile(m).read().decode("utf-8"))
        except Exception:
            continue
        bundle = (doc.get("dsh") or {}).get("bundle")
        if not isinstance(bundle, dict) or "patch" not in bundle:
            continue
        raw = bundle["patch"]
        root = posixpath.dirname(n)
        if isinstance(raw, str):
            form, items = "string", [raw]
        elif isinstance(raw, list):
            form, items = "array", list(raw)
        else:
            # 既非 string 也非 array：observer 会走 `[]` 分支 → 同样报 issue。
            # 这里记为 other，items 留空，由 missing 计数体现。
            form, items = "other", []

        missing = []
        for it in items:
            if not isinstance(it, str) or not it or posixpath.isabs(it):
                missing.append(str(it))
                continue
            resolved = posixpath.normpath(posixpath.join(root, it))
            # observer 另外要求 target 必须落在 root 之内（防目录穿越）
            if not resolved.startswith(root + "/"):
                missing.append(str(it))
                continue
            if resolved not in files:
                missing.append(str(it))

        producers.append(
            {
                "name": doc.get("name") or n,
                "member": n,
                "root": root,
                "form": form,
                "items": items,
                "missing": missing,
            }
        )

    return files, producers, scan_count, len(pkg_members)


# --------------------------------------------------------------------------
# observer 判定语义的可信移植
# --------------------------------------------------------------------------
def observer_issue_for(patch_value, root: str, files: set[str], *, legacy: bool) -> str:
    """复现 startup-observer.cjs 在 `check()` 内对 patch 的判定结果。

    legacy=False  使用当前实现（string 与 array 都接受）
    legacy=True   回退成缺陷版实现（只认 string）—— 负对照用

    返回 '' 表示无 issue，否则返回 issue 文案。
    """
    if legacy:
        # 缺陷版：非 string 一律判缺失，且不做数组遍历
        if not isinstance(patch_value, str):
            return ISSUE_TEXT
        target = posixpath.normpath(posixpath.join(root, patch_value))
        if not target.startswith(root + "/") or target not in files:
            return ISSUE_TEXT
        return ""

    # 当前实现：const patches = typeof patch === 'string' ? [patch]
    #                                 : Array.isArray(patch) ? patch : [];
    if isinstance(patch_value, str):
        patches = [patch_value]
    elif isinstance(patch_value, list):
        patches = list(patch_value)
    else:
        patches = []

    if not patches:
        return ISSUE_TEXT
    for item in patches:
        if not isinstance(item, str) or not item or posixpath.isabs(item):
            return ISSUE_TEXT
        target = posixpath.normpath(posixpath.join(root, item))
        if not target.startswith(root + "/") or target not in files:
            return ISSUE_TEXT
    return ""


# --------------------------------------------------------------------------
# 检查 2e：真实执行 .cjs（端到端，闭掉"移植版与源码脱节"的缺口）
# --------------------------------------------------------------------------
def node_version() -> str:
    try:
        out = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=30)
        return out.stdout.strip() or "未知"
    except Exception:
        return "未知"


def run_real_observer(observer_path: str, target: dict):
    """把真实归档数据落成一个最小夹具，用 Node 真跑 observer 源码。

    返回 None 表示环境不具备（无 node / 夹具失败）→ 调用方标注为弱断言。
    返回 ''   表示无 issue（通过）。
    返回 文案  表示 observer 报出的 issue。
    """
    if shutil.which("node") is None:
        return None

    try:
        with tempfile.TemporaryDirectory(prefix="obs-gate-") as work:
            home = os.path.join(work, "home")
            prof = os.path.join(home, "profiles", "web")
            inst = os.path.join(work, "install")
            pkg_dir = os.path.join(prof, "node_modules", target["name"])
            os.makedirs(pkg_dir, exist_ok=True)
            os.makedirs(os.path.join(inst, "node_modules"), exist_ok=True)

            # ① profile 的 package.json：只启用目标插件
            with open(os.path.join(prof, "package.json"), "w", encoding="utf-8") as fh:
                json.dump({"dsh": {"profile": {"bundles": [target["name"]]}}}, fh)

            # ② 插件目录：声明 = 归档里读出的真实形态
            declared = target["items"] if target["form"] == "array" else (
                target["items"][0] if target["items"] else ""
            )
            with open(os.path.join(pkg_dir, "package.json"), "w", encoding="utf-8") as fh:
                json.dump(
                    {
                        "name": target["name"],
                        "version": "0.0.0-gate",
                        "dsh": {"bundle": {"patch": declared}},
                    },
                    fh,
                )

            # ③ 按声明逐个落出补丁文件（内容无关，observer 只校验存在性）
            for item in target["items"]:
                if not isinstance(item, str) or posixpath.isabs(item):
                    continue
                dest = os.path.join(pkg_dir, *item.lstrip("./").split("/"))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                open(dest, "w", encoding="utf-8").close()

            env = dict(os.environ)
            env.update(
                {
                    "DSH_HOME": home,
                    "DeepSeekHarness_STARTUP_PROFILE": "web",
                    "DeepSeekHarness_OBSERVER_INSTALL": inst,
                }
            )
            proc = subprocess.run(
                ["node", observer_path],
                capture_output=True,
                text=True,
                timeout=120,
                env=env,
                cwd=work,
            )
            # observer 通过 stdout 发 JSON 事件；解析出 issue
            for line in proc.stdout.splitlines():
                if '"type":"issue"' not in line:
                    continue
                try:
                    payload = json.loads(line.split("] ", 1)[1])
                except Exception:
                    continue
                msg = str(payload.get("message") or "")
                if ISSUE_TEXT in msg:
                    return ISSUE_TEXT
                if msg:
                    return msg
            return ""
    except Exception:
        return None


# --------------------------------------------------------------------------
# 检查 1
# --------------------------------------------------------------------------
def check_declaration_shape(text: str):
    hits_array = [p.pattern for p in ARRAY_BRANCH_PATTERNS if p.search(text)]
    hits_string = [p.pattern for p in STRING_BRANCH_PATTERNS if p.search(text)]
    return hits_array, hits_string


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--observer", default=DEFAULT_OBSERVER)
    ap.add_argument("--runtime", default=DEFAULT_RUNTIME)
    ap.add_argument(
        "--expected-len",
        type=int,
        default=EXPECTED_PATCH_COUNT,
        help="dsh-web-app 的 dsh.bundle.patch 期望长度（观测基线）",
    )
    args = ap.parse_args()

    print("=" * 74)
    print("startup-observer 补丁声明形态闸门")
    print("=" * 74)
    print("口径：")
    print("  被检查主体 = app/src/main/assets/startup-observer.cjs 的 patch 判定分支")
    print("  输入基线   = app/src/main/assets/dsh-runtime.bin 内 dsh-web-app/package.json")
    print("  命令       = python3 tools/verify-startup-observer.py")
    print()

    failures: list[str] = []

    # ── 输入存在性 ────────────────────────────────────────────────────
    if not os.path.isfile(args.observer):
        print("!! 输入缺失：observer 源码 %s" % args.observer)
        return 2
    if not os.path.isfile(args.runtime):
        print("!! 输入缺失：dsh 运行时 %s" % args.runtime)
        return 2

    with open(args.observer, encoding="utf-8", errors="replace") as fh:
        observer_text = fh.read()

    # ── 守卫：被检查数 == 0 → exit 2 ──────────────────────────────────
    print("── 守卫 ──")
    hits_array, hits_string = check_declaration_shape(observer_text)
    checked = len(hits_array) + len(hits_string)
    print("  扫描数（observer 源码行数） = %d" % len(observer_text.splitlines()))
    print("  被检查数（命中的形态分支）   = %d" % checked)
    if checked == 0:
        print("!! 【被检查数==0】observer 内未发现任何 patch 形态分支，判据可能失效")
        return 2

    # ── 读归档 ────────────────────────────────────────────────────────
    print()
    print("── 读取 dsh 运行时（gzip tar，流式解压，不落盘）──")
    tf = _open_tar(args.runtime)
    files, producers, scan_count, pkg_total = scan_archive(tf)

    print("  归档文件成员数（扫描数）     = %d" % scan_count)
    print("  其中 package.json            = %d" % pkg_total)
    print("  声明 dsh.bundle.patch 的包数 = %d" % len(producers))

    # ── 守卫：扫描数 == 0 / 生产者数 == 0 → exit 2 ────────────────────
    if scan_count == 0:
        print("!! 【扫描数==0】归档内未读到任何文件成员，不能算通过")
        return 2
    if not producers:
        print("!! 【生产者数==0】归档内没有任何包声明 dsh.bundle.patch，判据可能失效")
        return 2

    # ── 检查 1：源码形态覆盖（弱断言）─────────────────────────────────
    print()
    print("── 检查 1：声明形态覆盖（弱断言 —— 只证明源码里有分支）──")
    if hits_array:
        print("  OK   array 分支： %s" % hits_array[0])
    else:
        print("  FAIL ★ 未找到任何 Array.isArray(patch) 或等价数组分支")
        failures.append(
            "检查1 形态覆盖: observer 缺少数组分支，数组形态声明会被判为缺失"
        )
    if hits_string:
        print("  OK   string 分支：%s" % hits_string[0])
    else:
        print("  FAIL ★ 未找到 typeof patch === 'string' 分支")
        failures.append("检查1 形态覆盖: observer 缺少字符串分支")
    print("  口径三元组： 数量=2 个形态分支 / 基线=string+array 双形态 / "
          "命令=grep -n 'Array.isArray(patch)' app/src/main/assets/startup-observer.cjs")

    # ── 检查 2：真实数据回放（强断言）─────────────────────────────────
    print()
    print("── 检查 2：真实数据回放（强断言 —— 用真机读到的那份元数据）──")
    target = next((p for p in producers if p["member"] == TARGET_PKG), None)
    if target is None:
        print("  FAIL ★ 归档内找不到目标成员：%s" % TARGET_PKG)
        failures.append("检查2 真实回放: 归档内缺 dsh-web-app/package.json")
    else:
        print("  目标成员 = %s" % TARGET_PKG)
        print("  产物包名 = %s" % target["name"])
        print("  形态     = %s" % target["form"])
        print("  长度     = %d" % len(target["items"]))
        for i, it in enumerate(target["items"]):
            ok = it not in target["missing"]
            print("    [%d] %-32s %s" % (i, it, "EXISTS" if ok else "MISSING"))

        # 2a 形态
        if target["form"] != "array":
            print("  FAIL ★ dsh.bundle.patch 形态 = %s，期望 array" % target["form"])
            failures.append(
                "检查2 真实回放: dsh-web-app 的 patch 形态是 %s 而非 array" % target["form"]
            )
        else:
            print("  OK   形态是 array ✅")

        # 2b 长度（对照观测基线）
        if len(target["items"]) != args.expected_len:
            print("  !! 长度 = %d，与观测基线 %d 不一致（上游可能已升级；请复核后更新常量）"
                  % (len(target["items"]), args.expected_len))
            failures.append(
                "检查2 真实回放: patch 长度 %d != 基线 %d"
                % (len(target["items"]), args.expected_len)
            )
        else:
            print("  OK   长度 = %d == 基线 %d ✅" % (len(target["items"]), args.expected_len))

        # 2c 文件存在性
        if target["missing"]:
            print("  FAIL ★ %d/%d 个补丁文件在归档内缺失：%s"
                  % (len(target["missing"]), len(target["items"]), target["missing"]))
            failures.append(
                "检查2 真实回放: %d 个补丁文件缺失 %s"
                % (len(target["missing"]), target["missing"])
            )
        else:
            print("  OK   全部 %d 个补丁文件在归档内存在（0 缺失）✅"
                  % len(target["items"]))

        # 2d 用 observer 语义复算（移植版）
        issue = observer_issue_for(target["items"], target["root"], files, legacy=False)
        if issue:
            print("  FAIL ★ 用当前 observer 语义复算仍产出 issue：%s" % issue)
            failures.append("检查2 真实回放: 当前 observer 语义仍报 '%s'" % issue)
        else:
            print("  OK   用当前 observer 语义复算：无 issue ✅")

        # 2e ★ 真实执行 observer 源码（闭掉"移植版与源码脱节"的判别力缺口）
        #    2d 用的是本文件里的 Python 移植；若有人改坏 .cjs 而移植没跟着改，
        #    2d 仍是绿的。2e 直接拿磁盘上的 .cjs 跑 Node，才是真正的端到端。
        node_verdict = run_real_observer(args.observer, target)
        if node_verdict is None:
            print("  !! 2e 跳过：环境无 node 或夹具构建失败（标注为弱断言；2d 仍有效）")
            print("  !! 【弱断言声明】本次未能真实执行 .cjs，仅验证了移植语义")
        elif node_verdict:
            print("  FAIL ★ 2e 真实执行 .cjs 产出 issue：%r" % node_verdict)
            failures.append("检查2 真实执行: observer 在真实数据上报 '%s'" % node_verdict)
        else:
            print("  OK   2e 真实执行 .cjs（Node %s）：无 issue ✅" % node_version())

        print("  口径三元组： 数量=%d 个补丁文件 / 基线=%s / 命令=python3 "
              "tools/verify-startup-observer.py --runtime %s"
              % (len(target["items"]), TARGET_PKG, args.runtime))

    # ── 检查 2b：真实生产者形态分布（回放面的证据）────────────────────
    print()
    print("── 检查 2b：归档内所有生产者的形态分布 ──")
    by_form: dict[str, list[str]] = {}
    for p in sorted(producers, key=lambda x: x["name"]):
        by_form.setdefault(p["form"], []).append(p["name"])
        flag = "" if not p["missing"] else "  ★ 缺失 %s" % p["missing"]
        print("  %-48s 形态=%-6s 长度=%-2d%s"
              % (p["name"], p["form"], len(p["items"]), flag))
    print("  → 形态分布： %s"
          % ", ".join("%s=%d" % (k, len(v)) for k, v in sorted(by_form.items())))
    print("  口径三元组： 数量=%d 个生产者 / 基线=运行时归档内全部声明 / "
          "命令=同上" % len(producers))

    if "string" not in by_form:
        print("  !! 【回归面为空】归档内没有字符串形态的生产者，"
              "无法验证字符串分支仍正常（样本非空前提不满足）")

    # ── 检查 3：负对照（必须有）───────────────────────────────────────
    print()
    print("── 检查 3：负对照 —— 回退成只认字符串，同一份真实数据必须复现缺陷 ──")
    if target is None:
        print("  !! 跳过：无可用于回放的目标成员")
        return 2

    legacy_issue = observer_issue_for(
        target["items"], target["root"], files, legacy=True
    )
    if legacy_issue == ISSUE_TEXT:
        print("  OK   旧逻辑 + 真实数据 ⇒ 复现出 issue：%r ✅" % legacy_issue)
        print("       ⇒ 闸门对【该已知缺陷】具备判别力")
    elif legacy_issue:
        print("  OK   旧逻辑 + 真实数据 ⇒ 产出 issue（文案不同）：%r" % legacy_issue)
        print("       ⇒ 仍能判失败，但文案与真机日志不一致，建议人工核对")
    else:
        print("  FAIL ★ 旧逻辑 + 真实数据 ⇒ 未产出任何 issue")
        print("       ⇒ 闸门测不出已知缺陷，闸门本身无效")
        return 2

    # 3b 反向：字符串形态在旧逻辑下应【通过】（证明负对照不是"永远报错"）
    str_prods = [p for p in producers if p["form"] == "string" and not p["missing"]]
    if str_prods:
        sp = str_prods[0]
        one = sp["items"][0]
        old_v = observer_issue_for(one, sp["root"], files, legacy=True)
        new_v = observer_issue_for(one, sp["root"], files, legacy=False)
        print("  反向对照：字符串形态生产者 %s" % sp["name"])
        print("    [旧逻辑] issue=%r" % old_v)
        print("    [新逻辑] issue=%r" % new_v)
        if old_v == "" and new_v == "":
            print("  OK   字符串形态在两种逻辑下都通过 ⇒ 负对照不是「永远报错」 ✅")
        else:
            print("  FAIL ★ 字符串形态在旧逻辑下本应通过，实际 issue=%r" % old_v)
            failures.append("检查3 反向对照: 字符串形态回归失败")
    else:
        print("  !! 【回归面为空】归档内无可用的字符串形态生产者，"
              "无法验证字符串分支（弱断言）")

    # ── 检查 4：真机布局回放 —— profile 里是【软链】，实体在 /root/deepseekharness-* ──
    # 历史缺陷：observer 的路径防护拿 realpath(target) 去比对【未解析的 root】，
    # 于是真机上合法的「软链 → 实体目录」布局被误判成越界，全部内置插件报
    # 「缺少 dsh.bundle.patch 声明或补丁文件」。归档回放（检查 2）看不到这个形态，
    # 因为归档里的包是实体目录、且走的是同一层路径。所以必须单独回放【真机形态】。
    print()
    print("── 检查 4：真机软链布局回放 —— 软链插件不得被误判为缺补丁 ──")
    obs_path = os.path.join(REPO, "app/src/main/assets/startup-observer.cjs")
    nv = shutil.which("node")
    if nv is None or not os.path.isfile(obs_path):
        print("  !! 跳过（缺 node 或 observer）：node=%r observer=%s" % (nv, os.path.isfile(obs_path)))
        print("  !! 【弱断言】此项未验证")
        failures.append("检查4: 缺 node 或 observer，真机布局回放未执行")
    else:
        with tempfile.TemporaryDirectory() as td:
            home = os.path.join(td, "home")
            inst = os.path.join(td, "inst")
            rootd = os.path.join(td, "root")
            nm = os.path.join(home, "profiles/web/node_modules")
            os.makedirs(nm)
            os.makedirs(os.path.join(inst, "node_modules"))
            # 两个内置插件，实体目录名与插件名不同（真机正是如此）
            plug_names = ["dsh-web-mobile", "dsh-status-overlay"]
            for pn in plug_names:
                ent = os.path.join(rootd, "deepseekharness-" + pn[len("dsh-"):])
                os.makedirs(os.path.join(ent, "lib"))
                with open(os.path.join(ent, "package.json"), "w") as fh:
                    json.dump({"name": pn, "version": "9.9.9",
                               "dsh": {"bundle": {"patch": "./cordis.patch.yml"}}}, fh)
                with open(os.path.join(ent, "cordis.patch.yml"), "w") as fh:
                    fh.write("- insert:\n    - id: %s\n      name: '%s'\n" % (pn, pn))
                with open(os.path.join(ent, "lib/index.js"), "w") as fh:
                    fh.write("module.exports = {};\n")
                os.symlink(ent, os.path.join(nm, pn))
            with open(os.path.join(home, "profiles/web/package.json"), "w") as fh:
                json.dump({"name": "p", "private": True,
                           "dsh": {"profile": {"bundles": plug_names}}}, fh)
            env = dict(os.environ)
            env["DSH_HOME"] = home
            env["DeepSeekHarness_OBSERVER_INSTALL"] = inst
            env["DeepSeekHarness_STARTUP_PROFILE"] = "web"
            proc = subprocess.run([nv, obs_path], env=env, capture_output=True, text=True, timeout=120)
            out = proc.stdout
            n_issue = out.count('"type":"issue"')
            n_plug = out.count('"type":"plugin"')
            print("  软链插件 = %d 个，配置检查事件 = %d，issue 事件 = %d" % (len(plug_names), n_plug, n_issue))
            if n_plug != len(plug_names):
                print("  FAIL ★ 配置检查事件数不符（期望 %d）" % len(plug_names))
                failures.append("检查4: 软链布局下配置检查事件数=%d，期望 %d" % (n_plug, len(plug_names)))
            elif n_issue != 0:
                print("  FAIL ★ 真机软链布局被误判：issue=%d（应为 0）" % n_issue)
                for ln in out.splitlines():
                    if '"type":"issue"' in ln:
                        print("        %s" % ln.strip()[:160])
                failures.append("检查4: 真机软链布局误报 issue=%d" % n_issue)
            else:
                print("  OK   真机软链布局 0 issue ⇒ 路径防护不再误伤合法软链 ✅")

            # 4b 防护未失效：包内软链逃逸到包外，必须仍被拦下
            ent0 = os.path.join(rootd, "deepseekharness-web-mobile")
            outside = os.path.join(td, "outside.yml")
            with open(outside, "w") as fh:
                fh.write("- insert:\n    - id: outside\n")
            os.symlink(outside, os.path.join(ent0, "patch-evil.yml"))
            with open(os.path.join(ent0, "package.json"), "w") as fh:
                json.dump({"name": "dsh-web-mobile", "version": "9.9.9",
                           "dsh": {"bundle": {"patch": ["./patch-evil.yml"]}}}, fh)
            proc2 = subprocess.run([nv, obs_path], env=env, capture_output=True, text=True, timeout=120)
            esc = [ln for ln in proc2.stdout.splitlines() if '"type":"issue"' in ln]
            if esc:
                print("  OK   包内软链逃逸仍被拦下（issue=%d）⇒ 防护未因本次修复失效 ✅" % len(esc))
            else:
                print("  FAIL ★ 包内软链逃逸未被拦下 ⇒ 修复把防护一起削掉了")
                failures.append("检查4b: 软链逃逸未被拦下")

    # ── 汇总 ──────────────────────────────────────────────────────────
    print()
    print("=" * 74)
    if failures:
        print("结论：发现 %d 项问题" % len(failures))
        for f in failures:
            print("   - %s" % f)
        return 1
    print("结论：通过 —— observer 的声明形态覆盖了归档内真实数据的所有形态")
    return 0


if __name__ == "__main__":
    sys.exit(main())
