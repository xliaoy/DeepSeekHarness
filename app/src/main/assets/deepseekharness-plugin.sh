#!/bin/sh
# npm 插件安装后登记到 dsh；普通 npm install 保持 npm 自身语义。
. /etc/profile.d/deepseekharness-runtime-env.sh
case "$1" in
    install) shift; exec python3 /root/.dsh/plugin-manager.py npm "$@" ;;
    import|export|delete|list|check-updates|rollback|safe-mode) exec python3 /root/.dsh/plugin-manager.py "$@" ;;
    *) printf '%s\n' '用法：deepseekharness-plugin install <npm包名[@版本]>' \
            '      deepseekharness-plugin import <插件压缩包路径>' \
            '      deepseekharness-plugin list | delete <插件名>' \
            '      deepseekharness-plugin check-updates [插件名] | rollback <插件名>' \
            '      deepseekharness-plugin safe-mode on|off|status' \
            '安装或删除后，请重启 DeepSeek Harness Web。普通依赖/命令行工具请使用 npm install。' ;;
esac
