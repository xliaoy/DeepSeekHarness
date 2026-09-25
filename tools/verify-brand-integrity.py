#!/usr/bin/env python3
"""品牌完整性闸门：确保旧品牌名不会经由【任何】路径进入交付产物。

为什么需要独立脚本（而不是在源码上 grep）：
  旧品牌进入 APK 的路径不止「源码字面量」一条，至少有三种：
    ① 源码字面量                 （grep app/src 可见）
    ② 数据源 → 生成器 → Java      （tools/i18n/messages.json → UiMessages.java）
    ③ 生成器脚本自身的默认值       （tools/*.py 的默认参数、模板串）
  只 grep 源码只能覆盖 ①，②③ 会漏。因此本脚本按【产出口径】逐层检查：
    阶段 A 数据源      tools/i18n/messages.json 等 JSON 数据表
    阶段 B 生成中间物  app/build/generated/**（用当前源重跑生成器后应无残留）
    阶段 C 最终产物    APK 内 classes*.dex 的字符串表

用法：
    python3 -B tools/verify-brand-integrity.py                # 自动发现已构建产物
    python3 -B tools/verify-brand-integrity.py --apk X.apk    # 指定 APK
退出码：0 = 全部通过；1 = 发现残留（打印命中位置）。
"""
import argparse
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 旧品牌在【产物】中不允许出现的形态。
# 注意：不检查裸 'dsh'——那是另一个产品名（CLI 命令 / npm 包），刻意保留。
FORBIDDEN = [
    ("dsha.cc", re.compile(r"dsha\.cc", re.I)),
    ("dsha 域名", re.compile(r"dsha\.(app|com|org|dev|io|net)", re.I)),
    ("裸 dsha", re.compile(r"(?<![A-Za-z0-9_])dsha(?![A-Za-z0-9_])", re.I)),
    ("旧品牌驼峰", re.compile(r"(?<![A-Za-z0-9_])[Dd]sha(?=[A-Z])")),
]

# 允许保留的位置：这些是【跨端契约值】，改名反而会破坏兼容性。
ALLOWED_CONTEXT = re.compile(
    r"DSHA_ARM64_V2"      # launcherContract：运行时数据兼容性标识
    r"|DSHABAK5"          # 备份格式魔数（定长 8 字节）
    r"|DSHADATA"          # 归档魔数（定长 8 字节）
    r"|libproot_legacy"   # 预编译 .so 内的上游版本串
    r"|\bDsh(?:Auth|Model|Updater|Session|Update)\b"  # dsh（无 a）产品族
)


def hits_in_text(text, label, out):
    for name, pattern in FORBIDDEN:
        for m in pattern.finditer(text):
            start = max(0, m.start() - 60)
            ctx = text[start:m.end() + 60].replace("\n", " ")
            if ALLOWED_CONTEXT.search(m.group(0)) or ALLOWED_CONTEXT.search(ctx):
                continue
            out.append({"layer": label, "kind": name, "match": m.group(0), "context": ctx.strip()})
    return out


def check_data_sources():
    problems = []
    for rel in ("tools/i18n/messages.json",):
        path = ROOT / rel
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except Exception as exc:  # noqa: BLE001
            problems.append({"layer": "数据源", "kind": "读取失败", "match": rel, "context": str(exc)})
            continue
        hits_in_text(text, "数据源 " + rel, problems)
    return problems


def check_generated():
    """阶段B：生成中间物。

    ⚠️ 必须先判过期：本目录是【上次构建的残留】。若它早于当前源码，
    它反映的是旧源码的字符串，据此报「品牌残留」会指向已经修好的地方。
    """
    problems = []
    root = ROOT / "app/build/generated"
    if not root.is_dir():
        return problems
    stale = stale_note(root, "阶段B generated/")
    if stale:
        problems.append(stale)
        return problems
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in (".java", ".json", ".txt", ".xml"):
            continue
        try:
            if path.stat().st_size > 20_000_000:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:  # noqa: BLE001
            continue
        hits_in_text(text, "生成中间物 " + str(path.relative_to(ROOT)), problems)
    return problems


def check_resources():
    """资源引用 ↔ 定义 双向存在性。

    为什么必须单独查（K10.1 的新形态）：
      改名如果【只改引用、不改定义】（或反之），aapt2 会失败；更糟的是当引用与定义
      分处不同文件时，人工 diff 极难发现。本项目已实测踩到过一次：
        ic_launcher.xml → @drawable/deepseekharness_launcher_foreground  (引用 3 处)
        而真实文件仍叫 dsha_launcher_foreground.xml                     (文件 0 个新名)
      且该 xml 体内又指向 @drawable/DeepSeekHarness_brand（半途形态）。

    ⚠️ 定义来源【必须】覆盖三类，否则会产生大量误报（我第一版扫描器报了 27 个假阳性）：
      ① 文件型：res/<type>-*/<name>.xml|.png|...
      ② 值型：  res/values*/*.xml 里的 <drawable|color|style|string name="...">
      ③ 别名：  values/drawable_aliases.xml 之类的 <item name="X">@drawable/Y</item>
    只查 ① 会把所有别名型资源（bg_polished_card 等）误判成缺失。
    """
    problems = []
    res_roots = [p for p in (ROOT / "app/src").rglob("res") if p.is_dir()]
    defined = {}   # (type, name) -> 首个定义来源
    refs = []      # (type, name, 出处文件)

    for res in res_roots:
        for path in res.rglob("*"):
            if not path.is_file():
                continue
            parent = path.parent.name
            if parent.startswith("values"):
                try:
                    text = path.read_text(encoding="utf-8", errors="ignore")
                except Exception:  # noqa: BLE001
                    continue
                # 值型 + 别名型定义
                for m in re.finditer(r"<(drawable|color|style|string|dimen|bool|integer)\s+name=\"([^\"]+)\"", text):
                    defined.setdefault((m.group(1), m.group(2)), str(path.relative_to(ROOT)))
                # 别名文件形态：<item name="X" type="drawable"> / <item type="drawable" name="X">
                # ⚠️ 两种属性顺序都必须支持 —— 只认一种会漏掉全部别名（我上一版因此报了 6 个假阳性）
                for m in re.finditer(r"<item\s+([^>]*?)/?>", text):
                    attrs = m.group(1)
                    n = re.search(r'name="([^"]+)"', attrs)
                    t = re.search(r'type="([^"]+)"', attrs)
                    if n and t:
                        defined.setdefault((t.group(1), n.group(1)), str(path.relative_to(ROOT)))
            elif parent.split("-")[0] in ("drawable", "mipmap", "layout", "anim", "menu", "color", "xml", "raw"):
                rtype = parent.split("-")[0]
                defined.setdefault((rtype, path.stem), str(path.relative_to(ROOT)))
                # 文件型资源的内容里也可能引用别的资源
                if path.suffix == ".xml":
                    try:
                        text = path.read_text(encoding="utf-8", errors="ignore")
                    except Exception:  # noqa: BLE001
                        continue
                    for m in re.finditer(r"@(drawable|color|mipmap|layout|anim|menu|xml|raw|string)/([A-Za-z0-9_.]+)", text):
                        refs.append((m.group(1), m.group(2), str(path.relative_to(ROOT))))
            # 源码里的引用（Java / 非资源目录的 xml / manifest）
            # ⚠️ res/ 下的 xml 已在上面文件型分支扫过，这里必须排除，
            #    否则同一条悬空引用会被报两次（重复计数会让人误判严重程度）。
            if path.suffix in (".xml", ".java") and "res" not in path.parts:
                try:
                    text = path.read_text(encoding="utf-8", errors="ignore")
                except Exception:  # noqa: BLE001
                    continue
                for m in re.finditer(r"@(drawable|color|mipmap|layout|anim|menu|xml|raw)/([A-Za-z0-9_.]+)", text):
                    refs.append((m.group(1), m.group(2), str(path.relative_to(ROOT))))

    # Manifest 单独扫（不在 res/ 下）
    manifest = ROOT / "app/src/main/AndroidManifest.xml"
    if manifest.is_file():
        text = manifest.read_text(encoding="utf-8", errors="ignore")
        for m in re.finditer(r"@(drawable|mipmap|style|string|xml|color)/([A-Za-z0-9_.]+)", text):
            refs.append((m.group(1), m.group(2), "app/src/main/AndroidManifest.xml"))

    # ① 悬空引用：被引用但无定义
    for rtype, name, where in refs:
        if (rtype, name) in defined:
            continue
        # style 继承形态 @style/Foo.Bar 以父名定义
        if "." in name and (rtype, name.split(".")[0]) in defined:
            continue
        problems.append({"layer": "资源引用", "kind": "悬空引用",
                         "match": f"@{rtype}/{name}",
                         "context": f"{where} 引用了不存在的资源（可能只改了引用没改定义）"})
    # ② 定义了但文件名疑似半途改名形态（新旧混杂的驼峰大写开头）
    for (rtype, name), src in defined.items():
        if rtype in ("drawable", "mipmap") and re.match(r"^[A-Z]", name):
            problems.append({"layer": "资源定义", "kind": "命名形态可疑（大写开头）",
                             "match": f"{rtype}/{name}", "context": f"定义于 {src}；Android 资源名约定全小写"})
    return problems


def dex_strings(apk):
    """解出 APK 内所有 classes*.dex 的可打印字符串。"""
    chunks = []
    with zipfile.ZipFile(apk) as archive:
        for name in archive.namelist():
            if re.fullmatch(r"classes\d*\.dex", name):
                data = archive.read(name)
                chunks.append(data)
    joined = b"\n".join(chunks)
    return joined.decode("latin-1", errors="ignore")


def check_apk(apk, problems):
    try:
        text = dex_strings(apk)
    except Exception as exc:  # noqa: BLE001
        problems.append({"layer": "APK", "kind": "读取失败", "match": str(apk), "context": str(exc)})
        return problems
    return hits_in_text(text, "APK " + apk.name, problems)


def discover_apks(explicit):
    found = []
    if explicit:
        found.extend(Path(p) for p in explicit)
    else:
        for pattern in ("app/build/outputs/apk/*/release/*.apk", "release/*.apk"):
            found.extend(sorted(ROOT.glob(pattern)))
    return [p for p in found if p.is_file()]


def check_descriptor():
    """runtime-descriptor.json 的内容【自洽性】。

    与幂等性断言互补：幂等性回答"稳定吗"，本函数回答"对吗"。
    一个恒输出错误内容的生成器也是完全幂等的，所以两者不可互相替代。

    ⚠️ 已排除的伪命题：「launcherInputs ⊆ inputs」。
       两者【故意用不同基准】—— inputs 相对 app/src/main/assets/，
       launcherInputs 相对仓库根（因它含 jniLibs 与 java/runtime，不在 assets 内）。
       强行比较会得到 24/109 的假告警。**跨集合断言必须先证明基准一致。**
    """
    import hashlib
    problems = []
    path = ROOT / "app/src/main/assets/runtime-descriptor.json"
    if not path.is_file():
        return problems
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        problems.append({"layer": "descriptor", "kind": "解析失败", "match": str(path), "context": str(exc)})
        return problems

    def bad(kind, match, ctx):
        problems.append({"layer": "descriptor", "kind": kind, "match": match, "context": ctx})

    # ① runtimeId 必须能由 contract（去掉 version 与 runtimeId）真实复算
    contract = {k: v for k, v in doc.items() if k not in ("version", "runtimeId")}
    calc = hashlib.sha256(json.dumps(contract, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if calc != doc.get("runtimeId"):
        bad("runtimeId 不自洽", str(doc.get("runtimeId")),
            f"复算应为 {calc}；改了 contract 字段却忘记重算身份摘要")

    # ② dataRead/dataWrite 必须与 dshVersion 一致（否则数据目录名漂移）
    version = doc.get("dshVersion", "")
    if doc.get("dataRead") != ["dsh-" + version]:
        bad("dataRead 与 dshVersion 不一致", str(doc.get("dataRead")), f"dshVersion={version}")
    if doc.get("dataWrite") != "dsh-" + version:
        bad("dataWrite 与 dshVersion 不一致", str(doc.get("dataWrite")), f"dshVersion={version}")

    # ③ 契约常量取值域（改名最容易被误碰的地方）
    if doc.get("launcherContract") != "DSHA_ARM64_V2":
        bad("launcherContract 被改动", str(doc.get("launcherContract")),
            "该值由 RuntimeDescriptor.compatible() 比对，改名会破坏兼容判定")
    if doc.get("bridgeProtocol") != 2:
        bad("bridgeProtocol 异常", str(doc.get("bridgeProtocol")), "应为 2")
    if not str(doc.get("baseVersion", "")).isdigit():
        bad("baseVersion 形态异常", str(doc.get("baseVersion")), "应为纯数字串")

    # ④ 摘要形态：所有 inputs/launcherInputs 的 value 必须是 64 位小写 hex
    for field in ("inputs", "launcherInputs"):
        for name, digest in (doc.get(field) or {}).items():
            if not re.fullmatch(r"[0-9a-f]{64}", str(digest)):
                bad("摘要形态异常", f"{field}:{name}", f"{digest!r} 不是 64 位小写 hex")
    return problems


def newest_source_mtime():
    """源码树中最新的 mtime（用于判断 APK 是否过期）。"""
    newest = 0.0
    for base in ("app/src", "tools"):
        for path in (ROOT / base).rglob("*"):
            if path.is_file():
                try:
                    newest = max(newest, path.stat().st_mtime)
                except OSError:
                    pass
    return newest


def stale_note(artifact, label):
    """产物早于源码 ⇒ 该阶段结论无效。

    为什么必须内建：闸门若在此时报「发现 570 处残留」，使用者会以为
    【改名没做完】，而真相是【产物过期】⇒ 闸门输出必须自带时效性，
    否则它自己就是幻觉来源。
    （已实测踩到两次：旧 APK 570 处、旧 generated/ 67 处，全是过期产物）
    """
    try:
        art_mtime = artifact.stat().st_mtime
    except OSError:
        return None
    src_mtime = newest_source_mtime()
    if art_mtime + 1 < src_mtime:
        minutes = int((src_mtime - art_mtime) / 60)
        return {"layer": label, "kind": "STALE-ARTIFACT", "match": artifact.name,
                "context": f"{artifact.name} 早于源码 {minutes} 分钟，{label} 跳过：请先重建再判品牌"}
    return None


def stale_apk_note(apk):
    return stale_note(apk, "阶段C APK")


def main():
    parser = argparse.ArgumentParser(description="品牌完整性闸门（数据源 → 生成物 → APK）")
    parser.add_argument("--apk", action="append", default=[], help="显式指定 APK；可重复")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出")
    parser.add_argument("--skip-apk", action="store_true", help="只跑阶段A/B（改名期常用）")
    args = parser.parse_args()

    # 过期产物是【告警】不是【缺陷】：它只说明"这一层本次没法判"，
    # 不能算作品牌违规 —— 否则闸门会因"没重建"而报红，制造假红。
    skipped = []
    problems = []
    for layer in (check_data_sources(), check_generated(), check_resources(), check_descriptor()):
        for item in layer:
            (skipped if item.get("kind") == "STALE-ARTIFACT" else problems).append(item)
    apks = [] if args.skip_apk else discover_apks(args.apk)
    for apk in apks:
        note = stale_apk_note(apk)
        if note:
            # 过期产物：不判品牌，只报告"结论无效"，避免误导
            skipped.append(note)
            continue
        problems += check_apk(apk, [])

    report = {
        "apksChecked": [str(p.relative_to(ROOT)) if ROOT in p.parents else str(p) for p in apks],
        "apksSkippedStale": skipped,
        "hits": problems,
        "status": "FAIL" if problems else "PASS",
    }
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        for item in skipped:
            print(f"  ⚠️  [{item['layer']}] {item['kind']}: {item['match']}  {item['context']}")
        for item in problems:
            print(f"  🔴 [{item['layer']}] {item['kind']}: {item['match']}  …{item['context']}")
        verdict = report["status"]
        stale_apks = [x for x in skipped if x.get("layer") == "阶段C APK"]
        if not problems and stale_apks:
            verdict += "（阶段C 因产物过期未判定）"
        # 只数【被跳过判定的 APK】；阶段A/B 的过期项不属于 APK，不能计入。
        print(f"品牌完整性: {verdict}  (实际判定 {len(apks) - len(stale_apks)} 个 APK，命中 {len(problems)} 处)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
