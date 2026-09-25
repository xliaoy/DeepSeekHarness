#!/usr/bin/env python3
"""Android 资源语言闸门：默认语言位（values/）不得填成英文。

## 为什么必须有这个闸门

`values/` 是**默认语言**资源槽，中文界面就是从这里取的。移植一个页面时，
如果把英文文案直接写进 `values/`（而不是 `values-en/`），结果是：

  * 中文模式显示英文 —— 用户一眼可见的功能缺陷；
  * 而 `values-en/` 往往被填了**同样一份英文** ⇒ 两种语言**逐字相同**，
    "切到英文"与"切到中文"没有任何区别，测试也很难发现。

本仓真实踩到过：插件页 `plugin_sort_strings.xml` 有 13 个键
（`plugins_title`/`plugins_cli_install`/`plugin_install_title` …）
在 `values/` 里就是英文原文，导致中文模式下整个插件页是英文。

## 判据（两条，都只看"两种语言是否无法区分"）

1. **同值**：同名键在 `values/` 与 `values-en/` 的值**逐字相同**，
   且该值**不含 CJK**却含成串拉丁字母。
2. **纯英文默认**：`values/` 里含成串拉丁字母的键，在 `values-en/` 中**不存在**
   —— 说明只有一份英文，中文位没有任何中文可用。

**豁免**：专有名词/版本号/型号这类中英文本来就相同的值
（`Node.js 24`、`pnpm`、`DeepSeek Harness`、`DSHA_ARM64_V2` …）
由 `--allow` 列表与 `ALLOW_IDENTICAL` 白名单放行 —— 它们不是"漏翻译"。

口径三元组随输出打印：命中数 / 基线（全部键对）/ 命令（本脚本）。
"""

import argparse
import os
import re
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
RES = os.path.join(REPO, "app", "src", "main", "res")

CJK = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
# 连着的 3 个以上拉丁字母才算"英文文本"；单个字母（如单位、图标占位）不算。
LATIN_RUN = re.compile(r"[A-Za-z]{3,}")

# 中英文本来就该一样的值：专有名词、产品名、版本号、协议名、标识符。
# 判据：去掉这些词之后没有剩余英文，才算"名物"，否则仍需中文。
ALLOW_IDENTICAL = {
    "DeepSeek Harness", "DeepSeekHarness", "DSH", "DeepSeek",
    "Node.js 24", "Node.js", "pnpm", "npm", "GitHub", "Git", "Root",
    "Shizuku", "Stellar", "ADB", "PTY", "Web", "API", "URL", "JSON",
    "LICENSE", "MIT", "APK", "SDK", "CPU", "GPU", "RAM", "ID", "IP",
    "DSHA_ARM64_V2", "STANDARD", "LOW",
}

# 允许整键跳过的例外（键名 → 理由）。保持为空是目标；每加一条都要写清理由。
ALLOW_KEYS = {}


def load_values(path):
    """读一个 strings xml → {键: 值}；解析失败不抛，返回空并告警。"""
    out = {}
    if not os.path.isfile(path):
        return out
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as error:
        print(f"  ⚠️  {os.path.relpath(path, REPO)} 解析失败：{error}")
        return out
    for node in root.iter("string"):
        name = node.get("name")
        if name:
            out[name] = "".join(node.itertext())
    return out


def is_englishy(value):
    """值是否"像一段英文文本"：有 3+ 连续拉丁字母、且完全不含 CJK。"""
    if not value:
        return False
    if CJK.search(value):
        return False
    if value.strip() in ALLOW_IDENTICAL:
        return False
    return bool(LATIN_RUN.search(value))


def strip_allowed(value):
    """移除名物白名单后再看是否还有英文残留 —— 用于区分
    'DeepSeek Harness'（合法名物）与 'Plugin manager'（漏翻译）。"""
    rest = value
    for token in sorted(ALLOW_IDENTICAL, key=len, reverse=True):
        rest = rest.replace(token, " ")
    return rest


def main():
    parser = argparse.ArgumentParser(description="Android 资源语言闸门（values/ 不得填英文）")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出")
    parser.add_argument("--quiet", action="store_true", help="只打印结论")
    args = parser.parse_args()

    zh_dir = os.path.join(RES, "values")
    en_dir = os.path.join(RES, "values-en")
    if not os.path.isdir(zh_dir):
        print(f"找不到 {zh_dir}")
        return 2

    problems = []
    checked = 0
    files = sorted(f for f in os.listdir(zh_dir) if f.endswith(".xml"))
    for name in files:
        zh = load_values(os.path.join(zh_dir, name))
        en = load_values(os.path.join(en_dir, name))
        for key, zhv in sorted(zh.items()):
            if key in ALLOW_KEYS:
                continue
            checked += 1
            if not is_englishy(zhv):
                continue
            env = en.get(key)
            if env is not None and env == zhv:
                # 两条都满足才判缺陷：值相同【且】该值去掉名物后仍有英文
                if strip_allowed(zhv).strip():
                    problems.append((name, key, zhv, "values/ 与 values-en/ 同值且非名物"))
            elif env is None and strip_allowed(zhv).strip():
                problems.append((name, key, zhv, "values-en/ 无此键 ⇒ 只有一份英文可供两种语言"))

    if args.json:
        import json
        print(json.dumps({
            "status": "FAIL" if problems else "PASS",
            "keysChecked": checked,
            "problems": [{"file": f, "key": k, "value": v, "reason": r} for f, k, v, r in problems],
        }, ensure_ascii=False, indent=2))
        return 1 if problems else 0

    if not args.quiet:
        for name, key, value, reason in problems:
            print(f"  🔴 [{name}] {key} = {value[:70]!r}\n       {reason}")

    print()
    print(f"资源语言闸门: {'发现 %d 项问题' % len(problems) if problems else '通过'}")
    print(f"  口径三元组：检查键数={checked} / 基线=values/ 全部 string 键 / 命令=python3 tools/verify-ui-language.py")
    if problems:
        print("  修法：把英文搬去 values-en/，values/ 写中文（不要两处同值）。")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
