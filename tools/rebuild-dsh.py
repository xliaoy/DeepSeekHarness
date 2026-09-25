# -*- coding: utf-8 -*-
"""把离线 rootfs 里的 dsh 升级到 0.1.2-rc.1（不落盘解压，直接在 tar 内替换）。

原 rootfs 布局：
  usr/local/lib/node_modules/@deepseek-ai/dsh/                主包
  usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/   全部依赖（@deepseek-ai 嵌套 + 非@deepseek 扁平提升到全局）
  usr/local/bin/dsh -> ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js（符号链接，不变）

本脚本：
  1. 复制原 rootfs 全部条目，跳过 dsh 主包与 dsh/node_modules 整棵子树；
  2. 写入 rc.1 的 dsh 主包 + node_modules（来自 npm 全局安装的暂存树）；
  3. 从原 rootfs 补回 @deepseek-ai/node-addon-landlock-run-linux-arm64（Windows npm 不装
     的 linux-arm64 平台原生模块），保留原权限。
用法：python3 rebuild-dsh.py <src-rootfs.bin> <dst-rootfs.bin> <rc1-dsh-dir>
"""
import os
import sys
import tarfile
import io

SRC = sys.argv[1]
DST = sys.argv[2]
RC1 = sys.argv[3]  # npmstage/node_modules/@deepseek-ai/dsh

DSH_PREFIX = "usr/local/lib/node_modules/@deepseek-ai/dsh/"
LANDLOCK = "usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/node-addon-landlock-run-linux-arm64/"


def norm(name):
    return name.lstrip("./")


def main():
    landlock_entries = []  # (TarInfo, data) 待补回
    kept = 0
    skipped = 0
    with tarfile.open(SRC, "r:gz") as src:
        with tarfile.open(DST, "w:gz", format=tarfile.PAX_FORMAT) as out:
            for ti in src:
                name = norm(ti.name)
                if name == "":
                    continue
                if name == DSH_PREFIX.rstrip("/") or name.startswith(DSH_PREFIX):
                    # dsh 子树：只保留 landlock（稍后统一补回），其余跳过
                    if name.startswith(LANDLOCK):
                        # 目录/符号链接无载荷，extractfile 会返回 None
                        landlock_entries.append(
                            (ti, src.extractfile(ti).read() if ti.isreg() else None))
                        kept += 1
                    else:
                        skipped += 1
                    continue
                if ti.isreg():
                    out.addfile(ti, src.extractfile(ti))
                else:
                    # 目录/符号链接/硬链接无载荷，直接写头部（避免 extractfile 解析链接目标失败）
                    out.addfile(ti)
                kept += 1

            # 写入 rc.1 dsh 树（跳过 .bin：npm CLI shim，运行时按包名 require，不需要；
            # 且 Windows npm 生成的 .bin 在 Android 解压时曾触发 ENOENT）
            added = 0
            skipped_bin = 0
            for root, dirs, files in os.walk(RC1):
                # 跳过所有名为 .bin 的目录及其内容（CLI shim）
                if os.path.basename(root) == ".bin":
                    skipped_bin += 1
                    dirs[:] = []
                    files[:] = []
                    continue
                dirs[:] = [d for d in dirs if d != ".bin"]
                for d in dirs:
                    p = os.path.join(root, d)
                    rel = os.path.relpath(p, RC1).replace("\\", "/")
                    name = DSH_PREFIX + rel
                    st = os.lstat(p)
                    info = tarfile.TarInfo(name)
                    info.type = tarfile.DIRTYPE
                    info.mode = 0o755
                    info.uid = info.gid = 0
                    info.uname = info.gname = "root"
                    info.mtime = 1756900000
                    out.addfile(info)
                    added += 1
                for f in files:
                    p = os.path.join(root, f)
                    if os.path.islink(p):
                        rel = os.path.relpath(p, RC1).replace("\\", "/")
                        name = DSH_PREFIX + rel
                        info = tarfile.TarInfo(name)
                        info.type = tarfile.SYMTYPE
                        info.linkname = os.readlink(p)
                        info.mode = 0o755
                        info.uid = info.gid = 0
                        info.uname = info.gname = "root"
                        info.mtime = 1756900000
                        out.addfile(info)
                        added += 1
                        continue
                    rel = os.path.relpath(p, RC1).replace("\\", "/")
                    name = DSH_PREFIX + rel
                    with open(p, "rb") as fh:
                        data = fh.read()
                    info = tarfile.TarInfo(name)
                    info.size = len(data)
                    info.mode = 0o755 if os.access(p, os.X_OK) else 0o644
                    info.uid = info.gid = 0
                    info.uname = info.gname = "root"
                    info.mtime = 1756900000
                    out.addfile(info, io.BytesIO(data))
                    added += 1

            # 补回 landlock（保留原 TarInfo 与内容）
            for ti, data in landlock_entries:
                if data is not None:
                    out.addfile(ti, io.BytesIO(data))
                else:
                    out.addfile(ti)

    print("完成: 保留 %d 条目, 跳过旧 dsh %d 条, 新增 rc.1 %d 条, landlock %d 条"
          % (kept, skipped, added, len(landlock_entries)))


if __name__ == "__main__":
    main()
