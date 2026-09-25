# -*- coding: utf-8 -*-
"""把 rc.1 缺少的 linux-arm64 原生模块注入离线 rootfs。

背景：rc.1 依赖树是 Windows npm 全局装出来的，npm 只拉当前平台的 optional
依赖，所以 @koromix/koffi-linux-arm64、@img/sharp-linux-arm64、
@img/sharp-libvips-linux-arm64、@vscode/ripgrep-linux-arm64、
node-addon-require-builtin-linux-arm64-gnu 都不在树里。手机（linux-arm64）上
koffi 因此加载不到 3.2.0 原生模块 → subprocess/sandbox 两个 loader 条目失败 →
整棵插件树起不来 → WebUI 不监听 3080 → 看门狗无限重启。

本脚本把 5 个 tgz（npm pack 下来的同版本 linux-arm64 包）解出并写进 rootfs tar：
  usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/<scope>/<name>/

用法：python3 inject-arm64-natives.py <src-rootfs.bin> <dst-rootfs.bin> <tgz目录>
"""
import os
import sys
import tarfile
import io

SRC = sys.argv[1]
DST = sys.argv[2]
TGZ_DIR = sys.argv[3]

PREFIX = "usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/"

# (tgz 文件名, 目标包路径)
PACKAGES = [
    ("koromix-koffi-linux-arm64-3.2.0.tgz", "@koromix/koffi-linux-arm64"),
    ("img-sharp-linux-arm64-0.35.4.tgz", "@img/sharp-linux-arm64"),
    ("img-sharp-libvips-linux-arm64-1.3.3.tgz", "@img/sharp-libvips-linux-arm64"),
    ("vscode-ripgrep-linux-arm64-1.18.0.tgz", "@vscode/ripgrep-linux-arm64"),
    ("node-addon-require-builtin-linux-arm64-gnu-0.1.5.tgz",
     "node-addon-require-builtin-linux-arm64-gnu"),
]

def is_exec(name):
    n = name.replace("\\", "/")
    return (n.endswith(".node")
            or ".so" in n
            or n.startswith("bin/") or "/bin/" in n
            or "/prebuilt/" in n)


def main():
    # 先读每个 tgz，收集要注入的 (tar 内路径, data, mode)
    inject = []  # (dest_path, TarInfo, data)
    for tgz, dest in PACKAGES:
        path = os.path.join(TGZ_DIR, tgz)
        if not os.path.isfile(path):
            print("缺失 tgz: %s" % path)
            return 1
        with tarfile.open(path, "r:gz") as t:
            for ti in t:
                if ti.isdir() or not ti.name.startswith("package/"):
                    continue
                rel = ti.name[len("package/"):]
                if not rel:
                    continue
                dest_name = PREFIX + dest + "/" + rel
                data = t.extractfile(ti).read()
                mode = 0o755 if is_exec(rel) else 0o644
                info = tarfile.TarInfo(dest_name)
                info.type = tarfile.REGTYPE
                info.size = len(data)
                info.mode = mode
                info.uid = info.gid = 0
                info.uname = info.gname = "root"
                info.mtime = 1756900000
                inject.append((dest_name, info, data))
        print("已读入 %s → %s" % (tgz, dest))

    # 注入目录条目（父链）+ 文件
    dirs_needed = set()
    for dest_name, _, _ in inject:
        parts = dest_name.split("/")
        for i in range(1, len(parts)):
            dirs_needed.add("/".join(parts[:i]))

    added = 0
    with tarfile.open(SRC, "r:gz") as src:
        with tarfile.open(DST, "w:gz", format=tarfile.PAX_FORMAT) as out:
            existing = set()
            for ti in src:
                n = ti.name.lstrip("./")
                existing.add(n)
                out.addfile(ti, src.extractfile(ti) if ti.isreg() else None)
            for d in sorted(dirs_needed):
                if d in existing:
                    continue
                info = tarfile.TarInfo(d)
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
                info.uid = info.gid = 0
                info.uname = info.gname = "root"
                info.mtime = 1756900000
                out.addfile(info)
                added += 1
            for dest_name, info, data in inject:
                out.addfile(info, io.BytesIO(data))
                added += 1
    print("完成：注入 %d 个文件/目录 → %s" % (added, DST))
    return 0


if __name__ == "__main__":
    sys.exit(main())
