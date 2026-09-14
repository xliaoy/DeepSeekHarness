#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DeepSeek Harness 备份前置整理（在 rootfs 内运行）。

目标：让备份包「自描述 + 可移植」，跨设备/跨版本恢复不再必然失败。

做两件事（任一失败都不影响备份本体——宽容优先）：
1. 内联本机路径插件：profile 的 dependencies 里形如 link:/root/plugin-src/x 的
   依赖只是一个绝对路径，换设备后目录不存在 → dsh 启动报
   "cannot resolve profile bundle"。这里把这些目录的内容复制到
   /root/.deepseekharness-plugin-src/<包名>/ 一起打进备份，恢复端再落地并重写路径。
2. 生成 /root/.deepseekharness-backup-manifest.json：记录格式版本、App/dsh 版本、工作目录、
   各 profile 的 bundles 与 link 依赖原始路径，供恢复端决策与提示。

用法：python3 backup-prepare.py [--app-version 1.1.5] [--app-code 26] [--workdir deepseek-harness]
输出：最后一行打印需要额外打包的相对路径（空格分隔，供 tar 使用）。
"""
import json
import os
import shutil
import sys
import time

# 路径可配：不然测「磁盘满 / 权限被拒时会不会留下半个备份」只能拿真实环境试，
# 而这个脚本会在 /root 下写清单和内联插件源码，试一次就污染一次
DSH_HOME = os.environ.get("DeepSeekHarness_DSH_HOME", "/root/.dsh")
_BP_ROOT = os.path.dirname(DSH_HOME.rstrip("/")) or "/root"
PROFILES = os.path.join(DSH_HOME, "profiles")
INLINE_DIR = os.path.join(_BP_ROOT, ".dsh", ".deepseekharness-plugin-src")
# 清单放进 .dsh/ 内部：.dsh 整个目录必然被打包，而放在 /root 下要靠
# 打包脚本里那串 [ -f x ] && set -- "$@" x 把它显式加进参数 ——
# 实测清单确实生成了（856 字节）却没出现在包里，说明那串拼接在实际执行
# 环境下并不可靠。与其继续追查，不如让它待在一定会被打包的位置。
# 同时保留旧位置一份，老版本 App 的恢复流程仍能找到。
MANIFEST = os.path.join(_BP_ROOT, ".dsh", ".deepseekharness-backup-manifest.json")
MANIFEST_LEGACY = os.path.join(_BP_ROOT, ".deepseekharness-backup-manifest.json")
# 内联单个插件的体积上限（防把巨大目录塞进备份）
MAX_INLINE_BYTES = 24 * 1024 * 1024
SKIP_DIRS = {"node_modules", ".git", ".pnpm-store", "dist-cache"}


def arg(name, default=""):
    key = "--" + name
    if key in sys.argv:
        i = sys.argv.index(key)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def local_path_dep(spec):
    """link:/file: 形式的本机路径依赖 → 返回路径；否则 None。"""
    if not isinstance(spec, str):
        return None
    for prefix in ("link:", "file:"):
        if spec.startswith(prefix):
            return spec[len(prefix):]
    return None


def dir_size(path):
    total = 0
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
        if total > MAX_INLINE_BYTES:
            return total
    return total


def copy_plugin(src, dst):
    """复制插件源码（跳过 node_modules 等重目录）。失败返回 False。"""
    try:
        if os.path.isdir(dst):
            shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(src, dst, symlinks=True,
                        ignore=shutil.ignore_patterns(*SKIP_DIRS))
        return True
    except Exception as e:
        print("[backup-prepare] 内联失败 %s: %s" % (src, e), file=sys.stderr)
        return False


def read_dsh_version():
    for p in ("/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json",
              "/root/deepseek-harness/package.json"):
        try:
            with open(p) as f:
                v = json.load(f).get("version")
            if v:
                return v
        except Exception:
            pass
    return "unknown"


def write_readme(manifest, extra):
    """在备份里放一份人话说明（DeepSeekHarness-README.txt）。

    备份包解开是一堆点开头的目录，谁也看不出哪个是对话、哪个能删。而备份最需要被读懂的
    时刻恰好是最糟的时刻 —— 手机丢了、环境崩了、人在别的设备上翻这个包。所以这份说明
    要能独立于 App 存在：写清里面有什么、怎么手动取数据、哪些东西换设备后用不了。

    文件名用 ASCII（中文名在某些解压工具里会乱码），内容用中文。
    """
    scope_desc = {
        "full": "全量（配置 + 对话 + 插件）",
        "sessions": "只对话（恢复时只覆盖对话，配置与插件不动）",
        "plugins": "只插件（恢复时只覆盖插件，对话不动）",
    }.get(manifest.get("scope", "full"), manifest.get("scope", "full"))
    lines = [
        "DeepSeek Harness 备份说明",
        "=" * 40,
        "",
        "备份时间：%s" % manifest.get("createdAt", "?"),
        "来自版本： DeepSeek Harness v%s (versionCode %s) · dsh %s" % (
            manifest.get("appVersion", "?"), manifest.get("appVersionCode", "?"),
            manifest.get("dshVersion", "?")),
        "工作目录：%s" % manifest.get("workdir", "?"),
        "格式版本：%s" % manifest.get("formatVersion", "?"),
        "备份范围：%s" % scope_desc,
        "",
        "里面有什么",
        "-" * 40,
        ".deepseekharness-pub/           对话等热数据的真实副本。这些目录在手机上是指向",
        "                     内部存储 Documents/dshdata 的符号链接，直接打包只会",
        "                     存一个链接、换设备后就是空的，所以额外复制了一份。",
        "                     恢复时它优先于 .dsh/ 下的同名链接。",
        ".dsh/sessions/       对话记录。一个会话一个文件，JSONL 纯文本，",
        "                     用任何文本编辑器都能直接看，不需要 DeepSeek Harness。",
        ".dsh/storages/       插件与工具的数据",
        ".dsh/attachments/    对话里的附件",
        ".dsh/settings.yaml   WebUI 设置（模型、外观等）",
        ".dsh/profiles/       插件注册（哪些插件启用、装在哪）",
        ".dsh/.deepseekharness-apikey    API key（本机 Keystore 加密，见下方注意）",
        ".dsh/.credentials.yaml  dsh 自己的凭据文件（如果存在）",
        ".deepseekharness-plugin-src/    本机路径插件的源码内联副本（换设备恢复用）",
        "<工作目录>/.env      环境变量（只有在线安装的用户才有这个文件）",
        "",
        "怎么恢复",
        "-" * 40,
        "推荐：打开 DeepSeek Harness →「工作区」页 →「恢复备份」，选中这个 .tar.gz。",
        "      恢复前 App 会先检查包是否完整，并告诉你里面有多少会话。",
        "",
        "手动：只想取几段对话的话，直接解压，去 .dsh/sessions/ 里找 —— 纯文本。",
        "      整体还原到容器里的话，把 .dsh 覆盖到 /root/ 下（DeepSeek Harness 内置终端可操作）。",
        "",
        "注意",
        "-" * 40,
        "· 这份备份里有你的**全部对话记录**，而它通常放在公共下载目录 —— ",
        "  任何拿到存储权限的应用都能读。要分享这个文件前请想清楚。",
        "· API key 用 Android Keystore 加密，密钥不出设备：换手机或清过 App 数据之后",
        "  这份 key 就解不开了，恢复时 DeepSeek Harness 会提示你重新填一次，这是正常的。",
        "· **没有**包含 Ubuntu 环境本体和 node 依赖（那有几百 MB）。恢复后 DeepSeek Harness 会自动",
        "  补装缺失的插件；环境本身用安装包重新装一次即可，数据不受影响。",
        "· 老版本的备份（没有本说明文件的那些）同样可以直接恢复，不必转换格式。",
    ]
    if manifest.get("inlinedPlugins"):
        lines += ["", "内联了这些本机路径插件的源码：",
                  "  " + ", ".join(manifest["inlinedPlugins"])]
    body = "\n".join(lines) + "\n"
    path = os.path.join(_BP_ROOT, ".dsh", "DeepSeekHarness-README.txt")
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        extra.append("DeepSeekHarness-README.txt")
    except Exception as e:
        print("[backup-prepare] 说明文件写入失败（不影响备份）: %s" % e, file=sys.stderr)


def main():
    manifest = {
        "formatVersion": 2,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "appVersion": arg("app-version", "unknown"),
        "appVersionCode": arg("app-code", "0"),
        "dshVersion": read_dsh_version(),
        "workdir": arg("workdir", "deepseek-harness"),
        # 备份范围：full / sessions / plugins（BackupScope.id 写进来的）。
        # 恢复端靠它决定「整目录替换」还是「只合并某个子树」——部分备份要是被当成
        # 全量恢复，用户的配置与插件会被一个只含对话的包整个换掉。
        # 老备份没有这个字段，缺省 full 正是它们的真实语义。
        "scope": arg("scope", "full"),
        "profiles": {},
        "inlinedPlugins": [],
        "notes": "恢复端见 restore-merge.py：无此文件也能恢复（会走启发式推断）",
    }
    extra = []
    inlined_any = False
    try:
        if os.path.isdir(INLINE_DIR):
            shutil.rmtree(INLINE_DIR, ignore_errors=True)
        for prof in sorted(os.listdir(PROFILES)) if os.path.isdir(PROFILES) else []:
            pkg_path = os.path.join(PROFILES, prof, "package.json")
            if not os.path.isfile(pkg_path):
                continue
            try:
                with open(pkg_path) as f:
                    pkg = json.load(f)
            except Exception as e:
                print("[backup-prepare] 读取 %s 失败: %s" % (pkg_path, e), file=sys.stderr)
                continue
            deps = pkg.get("dependencies") or {}
            bundles = (((pkg.get("dsh") or {}).get("profile") or {}).get("bundles")) or []
            link_deps = {}
            for name, spec in deps.items():
                p = local_path_dep(spec)
                if p is None:
                    continue
                link_deps[name] = spec
                # 内联该插件源码（体积超限则只记录路径，恢复端再提示重装）
                if os.path.isdir(p):
                    if dir_size(p) <= MAX_INLINE_BYTES:
                        os.makedirs(INLINE_DIR, exist_ok=True)
                        if copy_plugin(p, os.path.join(INLINE_DIR, name)):
                            manifest["inlinedPlugins"].append(name)
                            inlined_any = True
                    else:
                        print("[backup-prepare] %s 超过内联上限，跳过内联" % name, file=sys.stderr)
            manifest["profiles"][prof] = {
                "bundles": list(bundles),
                "linkDeps": link_deps,
            }
    except Exception as e:
        print("[backup-prepare] 整理异常（不影响备份）: %s" % e, file=sys.stderr)

    try:
        os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
        _tmp = MANIFEST + ".tmp"
        with open(_tmp, "w") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(_tmp, MANIFEST)
        # 旧位置也留一份：老版本 App 的恢复流程只认 /root/.deepseekharness-backup-manifest.json
        try:
            with open(MANIFEST_LEGACY, "w") as f:
                json.dump(manifest, f, ensure_ascii=False, indent=2)
            extra.append(os.path.basename(MANIFEST_LEGACY))
        except OSError:
            pass
    except Exception as e:
        print("[backup-prepare] manifest 写入失败: %s" % e, file=sys.stderr)

    # 人话说明：备份最需要被读懂的时刻，往往是手机丢了、人在别的设备上翻这个包的时候
    write_readme(manifest, extra)

    if inlined_any and os.path.isdir(INLINE_DIR):
        extra.append(os.path.basename(INLINE_DIR))
    # 末行：供 tar 追加的相对路径（相对 /root）
    print(" ".join(extra))
    return 0


if __name__ == "__main__":
    sys.exit(main())
