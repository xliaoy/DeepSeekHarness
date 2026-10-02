"""Keep a dedicated Gradle-generated asset directory equal to this build's plan.

Only descendants of app/build may be pruned. Reject links and reparse aliases
before touching their contents so an old generated tree cannot redirect writes.
"""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD = (ROOT / "app/build").resolve()


def prune(output: Path, expected: set[str]) -> None:
    target = output.absolute()
    if target == BUILD or not target.is_relative_to(BUILD) or target.resolve() != target:
        raise ValueError("生成资产目录必须是 app/build 内无链接的专用子目录")
    if any(not name or name.startswith("/") or "\\" in name or ".." in name.split("/") for name in expected):
        raise ValueError("生成资产清单包含无效路径")
    target.mkdir(parents=True, exist_ok=True)

    stale_files: list[Path] = []
    directories: list[Path] = []

    def visit(directory: Path) -> None:
        if directory.is_symlink() or directory.resolve() != directory.absolute():
            raise ValueError("生成资产目录包含链接或路径别名：" + str(directory))
        for entry in directory.iterdir():
            if entry.is_symlink() or entry.resolve() != entry.absolute():
                raise ValueError("生成资产目录包含链接或路径别名：" + str(entry))
            if entry.is_dir():
                visit(entry)
                directories.append(entry)
            elif entry.is_file():
                if entry.relative_to(target).as_posix() not in expected:
                    stale_files.append(entry)
            else:
                raise ValueError("生成资产目录包含特殊文件：" + str(entry))

    # Complete the tree check before deleting any stale output. A surprising
    # link or special file must leave the generated directory untouched.
    visit(target)
    for entry in stale_files:
        if entry.is_symlink() or entry.resolve() != entry.absolute() or not entry.is_file():
            raise ValueError("生成资产文件在清理前已变化：" + str(entry))
        entry.unlink()
    for directory in directories:
        if not any(directory.iterdir()):
            directory.rmdir()
