#!/usr/bin/env python3
"""在已授权的调试安装中运行隔离备份测试，不访问或恢复用户 .dsh。"""
from pathlib import Path
import re
import shlex
import subprocess
import sys

ADB = r"F:\DEEPSEEK_HARNESS\_toolchains\android-sdk\platform-tools\adb.exe"
REPO = Path(__file__).resolve().parents[1]
PLUGIN = "--plugins" in sys.argv
OWNED = "files/linux/ubuntu/root/.deepseekharness-opt-" + ("plugin" if PLUGIN else "backup") + "-check"


def shell(command, data=None):
    return subprocess.run([ADB, "exec-out", "run-as com.deepseek.harness sh -c " + shlex.quote(command)],
                          input=data, capture_output=True, check=True).stdout


package = subprocess.check_output([ADB, "shell", "dumpsys", "package", "com.deepseek.harness"], text=True)
native = re.search(r"legacyNativeLibraryDir=(\S+)", package).group(1) + "/arm64"
legacy = shell("if test -f " + shlex.quote(native + "/libproot_legacy.so") + "; then printf yes; fi") == b"yes"
shell("mkdir -p " + OWNED)
files = [("app/src/main/assets/backup-engine.py", "backup-engine.py"),
         ("tools/test-backup-engine.py", "test-backup-engine.py")]
if PLUGIN:
    files = [("app/src/main/assets/" + name, "repo/app/src/main/assets/" + name)
             for name in ("plugin-manager.py", "plugin-lifecycle.py", "register-builtin-plugins.py", "plugin-semver.cjs")]
    files.append(("scripts/test-plugin-manager.py", "repo/scripts/test-plugin-manager.py"))
for source, name in files:
    remote = "/data/local/tmp/deepseekharness-opt-" + Path(name).name
    subprocess.run([ADB, "push", str(REPO / source), remote], check=True)
    shell("mkdir -p " + str(Path(OWNED + "/" + name).parent).replace("\\", "/"))
    shell("cp " + remote + " " + OWNED + "/" + name)
command = '''root="$PWD/files/linux/ubuntu"
native=NATIVE
export LD_LIBRARY_PATH="$PWD/files/linux/lib:$native"
export PROOT_LOADER="$native/libprootloader_legacy.so"
export PROOT_L2S_DIR="$root/.l2s"
export PROOT_TMP_DIR="$PWD/cache"
export HOME=/root
export PATH=/usr/local/bin:/usr/bin:/bin
exec "$native/libproot_legacy.so" --link2symlink -0 -r "$root" -b /dev -b /proc -b "$root/.l2s:$root/.l2s" -w /root /bin/bash -c 'TMPDIR=/root/.deepseekharness-opt-backup-check python3 -B /root/.deepseekharness-opt-backup-check/test-backup-engine.py /root/.deepseekharness-opt-backup-check/backup-engine.py'
'''.replace("NATIVE", shlex.quote(native))
if not legacy:
    command = command.replace("libproot_legacy.so", "libproot.so").replace("libprootloader_legacy.so", "libprootloader.so")
if PLUGIN:
    command = command.replace(".deepseekharness-opt-backup-check", ".deepseekharness-opt-plugin-check")
    command = command.replace("/root/.deepseekharness-opt-plugin-check/test-backup-engine.py /root/.deepseekharness-opt-plugin-check/backup-engine.py", "/root/.deepseekharness-opt-plugin-check/repo/scripts/test-plugin-manager.py")
result = subprocess.run([ADB, "shell", "run-as com.deepseek.harness sh -c " + shlex.quote(command)], check=False)
raise SystemExit(result.returncode)
