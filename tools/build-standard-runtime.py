#!/usr/bin/env python3
"""补齐固定版本的离线工具资产。需要 Python 3.9+ 和 bsdtar（Windows 自带 tar）。"""
import argparse
import gzip
import hashlib
import io
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

PACKAGES = [
    ("pool/main/s/sqlite3/libsqlite3-0_3.45.1-1ubuntu2.7_arm64.deb",
     "2633907e89b37ae88fb1b18736b0a7a14feb614382c6297fca91cea4182fbbad",
     "libsqlite3-0", "libsqlite3.so.0.8.6", "libsqlite3.so.0"),
    ("pool/main/r/readline/libreadline8t64_8.2-4build1_arm64.deb",
     "7f46b2f3ca588cd2f05d2cfb6844017309760b4201105cdfda4b339f9e6c69da",
     "libreadline8t64", "libreadline.so.8.2", "libreadline.so.8"),
]
PNPM_VERSION = "10.34.5"
PNPM_SHA256 = "ccb5c479cab1b00621325bfe7d4c9a8a8031e7a525d7249e275ecbec81b08db2"
CERTIFI_VERSION = "2026.7.22"
CERTIFI_URL = "https://files.pythonhosted.org/packages/0b/a7/71ac2cff56fec219ed242bb11b8efb69fcc4bec75db06fb7bfe35de520e6/certifi-2026.7.22-py3-none-any.whl"
CERTIFI_SHA256 = "62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775"


def download(cache, name, checksum, urls):
    path = cache / name
    if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == checksum:
        return path
    last = None
    for url in urls:
        try:
            with urllib.request.urlopen(url, timeout=45) as response:
                data = response.read()
            if hashlib.sha256(data).hexdigest() != checksum:
                raise ValueError("官方校验值不匹配：" + name)
            path.write_bytes(data)
            return path
        except (OSError, ValueError) as error:
            last = error
    raise RuntimeError("下载失败：" + name) from last


def archive(path, entries):
    with path.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0,
                                             compresslevel=9) as compressed:
        with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as target:
            for item, data in entries:
                item.uid = item.gid = item.mtime = 0
                item.uname = item.gname = "root"
                target.addfile(item, io.BytesIO(data) if data is not None else None)
    print(path.name, path.stat().st_size, "bytes")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", default="app/build/runtime-downloads")
    parser.add_argument("--output", default="app/src/main/assets")
    parser.add_argument("--tar", default=shutil.which("bsdtar") or "tar")
    args = parser.parse_args()
    cache, output = Path(args.cache), Path(args.output)
    cache.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    support = []
    for remote, checksum, package, original, soname in PACKAGES:
        deb = download(cache, Path(remote).name, checksum, [base + remote for base in (
            "https://ports.ubuntu.com/ubuntu-ports/", "https://mirrors.ustc.edu.cn/ubuntu-ports/")])
        payload = cache / (package + ".tar.zst")
        payload.write_bytes(subprocess.check_output([args.tar, "-xOf", str(deb), "data.tar.zst"]))
        for source, destination in (
            ("usr/lib/aarch64-linux-gnu/" + original, "usr/lib/aarch64-linux-gnu/" + soname),
            ("usr/share/doc/" + package + "/copyright", "usr/share/doc/" + package + "/copyright")):
            data = subprocess.check_output([args.tar, "-xOf", str(payload), "./" + source])
            item = tarfile.TarInfo(destination)
            item.mode, item.size = 0o644, len(data)
            support.append((item, data))
    archive(output / "python-support.bin", support)
    pnpm = download(cache, "pnpm-" + PNPM_VERSION + ".tgz", PNPM_SHA256,
                    ["https://registry.npmjs.org/pnpm/-/pnpm-" + PNPM_VERSION + ".tgz"])
    entries = []
    with tarfile.open(pnpm, "r:gz") as source:
        for item in source:
            if not item.name.startswith("package/") or ".." in Path(item.name).parts:
                raise ValueError("pnpm 归档路径异常")
            if item.name.endswith(".exe") or "/reflink.darwin-" in item.name or "/reflink.win32-" in item.name:
                continue
            # 目录名必须与消费端逐字一致：ProotBootstrap.java:1455/1474 与
            # verify-stability.py:94 都按 usr/local/lib/deepseekharness-pnpm/ 查找 pnpm.cjs。
            # 曾因此处写作 deepseekharness-pnpm 而与消费端劈开（改名只覆盖了 Java 一侧）。
            item.name = "usr/local/lib/deepseekharness-pnpm/" + item.name[len("package/"):]
            entries.append((item, source.extractfile(item).read() if item.isfile() else None))
    archive(output / "pnpm-runtime.bin", entries)
    certifi = download(cache, "certifi-" + CERTIFI_VERSION + ".whl", CERTIFI_SHA256, [CERTIFI_URL])
    with zipfile.ZipFile(certifi) as source:
        (output / "ca-certificates.crt").write_bytes(source.read("certifi/cacert.pem"))
        license_path = next(name for name in source.namelist() if name.endswith("/LICENSE"))
        (output / "licenses").mkdir(exist_ok=True)
        (output / "licenses/certifi-LICENSE.txt").write_bytes(source.read(license_path))


if __name__ == "__main__":
    main()
