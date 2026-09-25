#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""restore-merge.py 的 ensure_workspace_dirs 主机侧单测。

背景：备份只带 .dsh（会话数据），不带工作区工作目录；恢复后 dsh 启动时按
cwd 校验每个会话，工作目录缺失会把恢复的会话从 workspace.json 注册表除名
（文件还在，界面里对话消失）。ensure_workspace_dirs 在恢复合并完成后按
注册表里的 workspace path 补建目录，让校验通过。

跑法（主机侧，纯 stdlib，不依赖 Android）：
  python tools/test-restore-merge-wsdir.py
"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import time

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "..", "app", "src", "main", "assets", "restore-merge.py")
SPEC = importlib.util.spec_from_file_location("restore_merge", SCRIPT)
rm = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rm)

passed = 0


def check(name, cond):
    global passed
    if cond:
        passed += 1
        print("PASS", name)
    else:
        print("FAIL", name)


def make_ws(root, path, title="闲聊"):
    wsdir = os.path.join(root, ".dsh", "storages")
    os.makedirs(wsdir)
    with open(os.path.join(wsdir, "workspace.json"), "w", encoding="utf-8") as f:
        json.dump({
            "unit": {"name": "workspace", "version": 2},
            "global": {"initialized": True, "workspaceIds": ["w1"], "archivedSessionIds": []},
            "tables": {"workspaces": {"w1": {"path": path, "title": title,
                                             "sessionIds": ["s1"]}}},
        }, f, ensure_ascii=False)


# 用例1：workspace.json 里的路径会被补建
root1 = tempfile.mkdtemp(prefix="DeepSeekHarness_ws1_")
target1 = "/DeepSeekHarness_unit_ws_test_%d" % int(time.time())
make_ws(root1, target1)
created = rm.ensure_workspace_dirs(root1)
check("1.1 有创建返回 True", created is True)
check("1.2 目标目录已创建", os.path.isdir(target1))
check("1.3 报告含补建信息", any("补建工作区目录" in m for m in rm.report))
shutil.rmtree(target1, ignore_errors=True)
shutil.rmtree(root1, ignore_errors=True)
rm.report.clear()

# 用例2：无 workspace.json → 返回 False，不报错
root2 = tempfile.mkdtemp(prefix="DeepSeekHarness_ws2_")
ok = rm.ensure_workspace_dirs(root2)
check("2.1 无 workspace.json 返回 False", ok is False)
check("2.2 无 workspace.json 报告提示跳过", any("补建工作区目录跳过" in m for m in rm.report))
shutil.rmtree(root2, ignore_errors=True)
rm.report.clear()

# 用例3：目录已存在时幂等，不重复创建也不报错
root3 = tempfile.mkdtemp(prefix="DeepSeekHarness_ws3_")
target3 = "/DeepSeekHarness_unit_ws_test_exist_%d" % int(time.time())
os.makedirs(target3)
make_ws(root3, target3)
ok = rm.ensure_workspace_dirs(root3)
check("3.1 目录已存在仍返回 True（幂等）", ok is True)
check("3.2 目录仍在", os.path.isdir(target3))
shutil.rmtree(target3, ignore_errors=True)
shutil.rmtree(root3, ignore_errors=True)

# 用例4：非绝对路径（不该补建，防止相对路径误建）
root4 = tempfile.mkdtemp(prefix="DeepSeekHarness_ws4_")
make_ws(root4, "relative/workspace")
ok = rm.ensure_workspace_dirs(root4)
check("4.1 相对路径被忽略（不补建）", ok is False)
check("4.2 相对路径未创建", not os.path.isdir("relative"))
shutil.rmtree(root4, ignore_errors=True)

print("RESULT: %d passed" % passed)
sys.exit(0 if passed == 9 else 1)
