#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构建闸门：校验 agent-preset-patch.json 能否应用到 dsh 运行时里的上游前端模块。

背景
----
冷安装时 ProotBootstrap -> RuntimeTools.prepare() -> patchAgentPresets()
会用 app/src/main/assets/agent-preset-patch.json 里的补丁链去改写 dsh 运行时内的
    usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/
        @deepseek-ai/dsh-client-ui-agent-preset/lib/client.js
一旦某条锚点在真实文件上对不上，ExactTextPatch 抛
    "上游模块结构与输入适配补丁不符，原文件保留"
整个「准备应用工具」阶段就会失败，App 卡死。

补丁集与上游 dsh 版本强耦合：上游一升级，锚点就会漂移。这个脚本就是
把那次运行时失败提前到构建期暴露出来。

ExactTextPatch 的真实语义（见 app/src/main/java/com/deepseekharness/app/util/ExactTextPatch.java）
--------------------------------------------------------------------------------------------
    old     = count(source, before)
    patched = count(source, after)
    if (patched == 1 && old == count(after, before))  -> 幂等，原样返回（视为成功）
    if (old != 1 || patched != 0)                     -> 抛异常（失败）
    else                                              -> 替换（成功）

注意：`old != 1 || patched != 0` 是【拒绝】条件，不是接受条件。
判定成功必须用：(patched == 1 and old == count(after, before)) or (old == 1 and patched == 0)

★ 必须按【全链累进】apply，不能每条都拿原始 src 去判：
  前面的补丁会改变后面的上下文。

用法
----
    python3 tools/verify-agent-preset-patch.py <APK 或 dsh-runtime.bin> [-p 补丁JSON]
    # 默认补丁 = app/src/main/assets/agent-preset-patch.json

    # 负对照：用旧的 14 条补丁集，断言闸门会非 0 退出
    python3 tools/verify-agent-preset-patch.py <APK> -p /path/to/old-14.json

退出码
------
    0  全部补丁在该模块上成功应用
    1  有补丁失败 / 正对照失败 / 样本非空失败 / 输入错误
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import tarfile
import zipfile

MODULE_PATH = (
    "usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/"
    "@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js"
)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DEFAULT_PATCH = os.path.join(REPO, "app", "src", "main", "assets", "agent-preset-patch.json")
ASSETS_DIR = os.path.join(REPO, "app", "src", "main", "assets")

# client.js 基线指纹。仅作为提示信息，不作为失败条件 —— 上游升级后应更新补丁，
# 而不是让闸门因为指纹变化就报错。真正的判据永远是补丁本身能否应用。
BASELINE_SHA256 = "fb24af3c3de904ebf5a93a8f5c6bcaa6f1a1fb82f6086e0d36d271ab5e6042f7"


# --------------------------------------------------------------------------
# 读取输入
# --------------------------------------------------------------------------
def _read_tar_member(raw: bytes, member: str) -> bytes | None:
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tf:
        for cand in (member, "./" + member):
            try:
                f = tf.extractfile(cand)
            except KeyError:
                f = None
            if f is not None:
                return f.read()
    return None


def extract_client_js(path: str, member: str = MODULE_PATH) -> str:
    """从 APK 或 dsh-runtime.bin 里取出上游 client.js 源码。"""
    if not os.path.isfile(path):
        raise SystemExit("输入不存在：%s" % path)

    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            # 优先 assets/dsh-runtime.bin（正式 APK 布局）
            for entry in ("assets/dsh-runtime.bin", "dsh-runtime.bin"):
                if entry in names:
                    raw = _read_tar_member(z.read(entry), member)
                    if raw is not None:
                        return raw.decode("utf-8")
            raise SystemExit(
                "APK 内找不到 assets/dsh-runtime.bin；实际条目示例：%s" % names[:10]
            )

    with open(path, "rb") as fh:
        head = fh.read(2)
        fh.seek(0)
        raw = fh.read()
    if head == b"\x1f\x8b":  # gzip -> 视为 tar.gz
        data = _read_tar_member(raw, member)
        if data is None:
            raise SystemExit("dsh-runtime.bin 内找不到模块：%s" % member)
        return data.decode("utf-8")

    # 直接就是 client.js
    return raw.decode("utf-8")


def load_prepend_asset(name: str) -> str:
    """读 prependAsset 指向的本地 asset（与 RuntimeTools.assetText 行为一致）。"""
    p = os.path.join(ASSETS_DIR, name)
    if not os.path.isfile(p):
        raise SystemExit("prependAsset 缺文件：%s" % p)
    with open(p, encoding="utf-8") as fh:
        return fh.read()


# --------------------------------------------------------------------------
# ExactTextPatch 的可信移植
# --------------------------------------------------------------------------
def count(value: str, part: str) -> int:
    if not part:
        return 0
    n = 0
    start = 0
    while True:
        at = value.find(part, start)
        if at < 0:
            return n
        n += 1
        start = at + len(part)


def apply(source: str, before: str, after: str) -> tuple[str, str]:
    """返回 (新文本, 'APPLIED'|'IDEMPOTENT')；失败抛 ValueError。"""
    if not before or not after or before == after:
        raise ValueError("无效的文本补丁")
    old = count(source, before)
    patched = count(source, after)
    if patched == 1 and old == count(after, before):
        return source, "IDEMPOTENT"
    if old != 1 or patched != 0:
        raise ValueError(
            "上游模块结构与输入适配补丁不符，原文件保留 (old=%d patched=%d)" % (old, patched)
        )
    return source.replace(before, after), "APPLIED"


# --------------------------------------------------------------------------
# 主校验
# --------------------------------------------------------------------------
def run_patches(spec: dict, source: str, verbose: bool = True):
    patches = spec.get("patches") or []
    cur = source
    rows = []
    for i, p in enumerate(patches):
        after = p["after"]
        if "prependAsset" in p:
            after = load_prepend_asset(p["prependAsset"]) + "\n" + after
        old = count(cur, p["before"])
        patched = count(cur, after)
        try:
            cur, verdict = apply(cur, p["before"], after)
            ok = True
        except ValueError as exc:
            verdict = str(exc)
            ok = False
        rows.append({"i": i, "old": old, "patched": patched, "ok": ok, "verdict": verdict})
        if verbose:
            print(
                "  [%2d] old=%-3d patched=%-3d %s  %s"
                % (i, old, patched, "OK  " if ok else "FAIL", verdict)
            )
    return cur, rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="校验 agent-preset-patch.json 补丁链")
    ap.add_argument("target", help="APK 路径 或 dsh-runtime.bin 路径（或裸 client.js）")
    ap.add_argument("-p", "--patches", default=DEFAULT_PATCH, help="补丁 JSON 路径")
    ap.add_argument("--module", default=MODULE_PATH, help="tar 内的模块成员路径")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args(argv)

    print("=" * 72)
    print("补丁集   : %s" % args.patches)
    print("运行时   : %s" % args.target)
    print("=" * 72)

    try:
        source = extract_client_js(args.target, args.module)
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print("!! 读取运行时失败：%s" % exc)
        return 1

    import hashlib

    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
    print("client.js: %d chars  sha256=%s" % (len(source), digest))
    if digest != BASELINE_SHA256:
        print("   (提示：与已知基线 %s… 不同，上游可能已升级)" % BASELINE_SHA256[:16])
    print()

    with open(args.patches, encoding="utf-8") as fh:
        try:
            spec = json.load(fh)
        except json.JSONDecodeError as exc:
            print("!! 补丁 JSON 解析失败：%s" % exc)
            return 1

    patches = spec.get("patches") or []
    print("dshVersion=%s  module=%s" % (spec.get("dshVersion"), spec.get("module")))

    # ---- 样本非空（K41：防零样本误判全绿） ----
    if len(patches) == 0:
        print("!! 【样本非空】失败：patches 数量为 0，零样本不能算通过")
        return 1
    print("patches=%d" % len(patches))
    print()

    print("---- 全链累进应用 ----")
    _, rows = run_patches(spec, source, verbose=True)

    ok_n = sum(1 for r in rows if r["ok"])
    fail = [r for r in rows if not r["ok"]]
    print()
    print("---- 汇总 ----")
    print("成功 %d / %d，失败 %d %s" % (ok_n, len(rows), len(fail), [r["i"] for r in fail]))

    # ---- 正对照（K41：防零样本误判全绿） ----
    if ok_n == 0:
        print("!! 【正对照】失败：没有任何一条补丁成功，判定为无效运行")
        return 1
    print("【正对照】通过：至少 1 条补丁成功（%d 条）" % ok_n)

    if fail:
        print("【结论】失败：%d 条补丁与上游模块不符" % len(fail))
        for r in fail:
            print("     [%2d] old=%d patched=%d  %s" % (r["i"], r["old"], r["patched"], r["verdict"]))
        return 1

    print("【结论】通过：全部 %d 条补丁可在该运行时上应用" % len(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
