#!/bin/bash
# DeepSeek Harness：修 pnpm 在 proot 容器里的两类顽固故障。
#
# 故障一：硬链接。pnpm 默认把包从 content-addressable store 用 **硬链接** 铺到
# node_modules/.pnpm（它自己启动时就会打印 "Packages are hard linked from the
# content-addressable store"）。而 Android 私有目录禁止真硬链接，proot 只能用
# --link2symlink 模拟成 .l2s 符号链接链 —— 临时文件一清理，目标就悬空，表现为
# 各种莫名的 ENOENT。改成 package-import-method=copy 直接绕开：
# 在 proot 下硬链接本来就是模拟的，也没真省空间。
#
# 故障二：git-hosted 包的残留。pnpm 装 GitHub 来源的插件时会在
# store/v*/tmp/_tmp_<pid>_<hash>/ 里 clone、跑 prepare、再入库。中途失败的话
# 这些目录会一直留着，下次可能撞上同名或读到半成品（典型报错：
# "Failed to prepare git-hosted package ... ENOENT ... /store/v11/tmp/..."）。
#
# 全部操作幂等，只碰 pnpm 自己的配置与临时目录，不动用户的 .dsh 数据。
set -u
LOG=/root/.dsh/pnpm-env-fix.log
mkdir -p /root/.dsh 2>/dev/null || true
log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

NPMRC=/root/.npmrc
touch "$NPMRC" 2>/dev/null || true

changed=0
# ① 禁用硬链接导入
if grep -q '^package-import-method=' "$NPMRC" 2>/dev/null; then
  if ! grep -q '^package-import-method=copy' "$NPMRC"; then
    sed -i 's|^package-import-method=.*|package-import-method=copy|' "$NPMRC"
    changed=1
  fi
else
  printf 'package-import-method=copy\n' >> "$NPMRC"
  changed=1
fi
# ② 顺带关掉 side-effects-cache：它缓存的是 build 后的产物，同样靠硬链接铺开
if ! grep -q '^side-effects-cache=' "$NPMRC" 2>/dev/null; then
  printf 'side-effects-cache=false\n' >> "$NPMRC"
  changed=1
fi

if [ "$changed" = "1" ]; then
  log "已写入 package-import-method=copy / side-effects-cache=false"
  echo "PNPM_NPMRC_FIXED"
else
  echo "PNPM_NPMRC_ALREADY"
fi

# ③ 清 store 的临时目录（只有失败残留才会留在这儿；正常安装结束即清）
cleaned=0
for STORE in /root/.local/share/pnpm/store/v* /root/.pnpm-store/v*; do
  [ -d "$STORE/tmp" ] || continue
  n=$(find "$STORE/tmp" -maxdepth 1 -mindepth 1 2>/dev/null | wc -l)
  if [ "$n" -gt 0 ]; then
    rm -rf "$STORE"/tmp/* 2>/dev/null || true
    cleaned=$((cleaned + n))
    log "清理 $STORE/tmp 残留 $n 项"
  fi
done
echo "PNPM_TMP_CLEANED=$cleaned"

# ④ store 里若已有悬空的 .l2s 链（上一次硬链接模拟留下的），一并摘掉：
#    它们既读不出内容，又会让后续 tar/复制整体失败
dangling=0
for STORE in /root/.local/share/pnpm/store/v*; do
  [ -d "$STORE" ] || continue
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if ! head -c 1 "$p" >/dev/null 2>&1; then
      rm -f "$p" 2>/dev/null && dangling=$((dangling + 1))
    fi
  done <<EOF
$(find "$STORE" -name '.l2s.*' -o -name '*.l2s.*' 2>/dev/null | head -500)
EOF
done
[ "$dangling" -gt 0 ] && log "摘除悬空 l2s 链 $dangling 个"
echo "PNPM_DANGLING_REMOVED=$dangling"

log "pnpm 环境修复完成"
echo "PNPM_FIX_OK"
