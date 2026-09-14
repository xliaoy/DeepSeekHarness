#!/bin/bash
# 安装页第 2 步：只补齐缺失的基础命令，保留用户配置与已有容器。
set -u
export DEBIAN_FRONTEND=noninteractive
missing=""
curl --version >/dev/null 2>&1 || missing="$missing curl"
git --version >/dev/null 2>&1 || missing="$missing git"

if [ -n "$missing" ]; then
    command -v apt-get >/dev/null 2>&1 || { echo "缺少 apt-get，无法补齐：$missing"; exit 1; }
    echo "正在补齐：$missing（首次需要联网）"
    source_file="/tmp/deepseekharness-tools-$$.list"
    trap 'rm -f -- "$source_file"' EXIT
    options=(-o APT::Sandbox::User=root -o Acquire::Retries=1
             -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20
             -o Acquire::http::Pipeline-Depth=0 -o Acquire::PDiffs=false
             -o DPkg::Lock::Timeout=15)
    installed=false
    # 优先使用用户已有软件源；内置 Ubuntu 24.04 可回退到镜像，临时源不覆盖用户配置。
    for source in current mirror; do
        sources=()
        if [ "$source" = mirror ]; then
            grep -q '^VERSION_CODENAME=noble$' /etc/os-release || break
            echo "尝试 Ubuntu 镜像源…"
            # 没有 CA 时先通过 APT 签名验证引导证书包，不关闭签名或 TLS 校验。
            scheme=https
            [ -s /etc/ssl/certs/ca-certificates.crt ] || scheme=http
            printf '%s\n' \
                "deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] $scheme://mirrors.ustc.edu.cn/ubuntu-ports noble main universe" \
                "deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] $scheme://mirrors.ustc.edu.cn/ubuntu-ports noble-updates main universe" \
                "deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] $scheme://mirrors.ustc.edu.cn/ubuntu-ports noble-security main universe" > "$source_file"
            sources=(-o "Dir::Etc::sourcelist=$source_file" -o Dir::Etc::sourceparts=-)
        fi
        if apt-get "${options[@]}" "${sources[@]}" -o APT::Update::Error-Mode=any update \
                && apt-get "${options[@]}" "${sources[@]}" --no-install-recommends --no-remove -y install $missing ca-certificates; then
            installed=true
            break
        fi
    done
    $installed || { echo "基础工具未能安装，请检查网络后重试第 2 步。"; exit 1; }
fi

curl --version >/dev/null 2>&1 || { echo 'curl 无法运行'; exit 1; }
git --version >/dev/null 2>&1 || { echo 'git 无法运行'; exit 1; }
python3 -c 'import ssl, sqlite3, readline, tarfile, zipfile' || exit 1
read -r curl_name curl_version curl_details <<< "$(curl --version)"
printf 'curl %s\n' "$curl_version"
git --version
python3 --version
echo DeepSeekHarness_TOOLS_OK
