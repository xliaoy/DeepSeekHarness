# DeepSeek Harness 的终端入口与 TLS 根证书；用户显式设置的证书路径优先。
# 注意：这里是 rootfs 内的**机器路径**，必须与 Java 侧 RuntimeTools.CERT_PATH /
# ManagedRuntimeLayout / ProotBootstrap 以及 tools/ 的烘焙路径逐字一致（均为 share/deepseekharness/）。
# 它不是用户可见品牌，按命名边界规则保持 DeepSeekHarness 不改 —— 单边改名会让 TLS 预载静默失效。
if [ -r /usr/local/share/deepseekharness/dns-compat.cjs ]; then
    case " ${NODE_OPTIONS-} " in
        *" --require=/usr/local/share/deepseekharness/dns-compat.cjs "*) ;;
        *) export NODE_OPTIONS="--require=/usr/local/share/deepseekharness/dns-compat.cjs${NODE_OPTIONS:+ $NODE_OPTIONS}" ;;
    esac
fi
case ":$PATH:" in *:/root/dsh-bin:*) ;; *) export PATH="/root/dsh-bin:$PATH" ;; esac
export SSL_CERT_FILE="${SSL_CERT_FILE:-/usr/local/share/deepseekharness/ca-certificates.crt}"
export REQUESTS_CA_BUNDLE="${REQUESTS_CA_BUNDLE:-$SSL_CERT_FILE}"
export CURL_CA_BUNDLE="${CURL_CA_BUNDLE:-$SSL_CERT_FILE}"
export GIT_SSL_CAINFO="${GIT_SSL_CAINFO:-$SSL_CERT_FILE}"
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$SSL_CERT_FILE}"
export npm_config_cafile="${npm_config_cafile:-$SSL_CERT_FILE}"
export npm_config_prefix="${npm_config_prefix:-/usr/local}"
export NARB_DISABLE_NATIVE_CACHE="${NARB_DISABLE_NATIVE_CACHE:-1}"
export NARB_DISABLE_NATIVE_CACHE="${NARB_DISABLE_NATIVE_CACHE:-1}"
