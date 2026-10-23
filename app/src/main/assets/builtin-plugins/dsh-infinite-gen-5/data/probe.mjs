// 运行环境探测（infinite-gen5 · 单一真源）
// ───────────────────────────────────────────────────────────────────────────
// 目标：一条命令回答「我现在在哪台机器上、我是谁、能不能出网、包里有什么、缺什么工具」。
// 内核里的「工具链规则」说的是「缺工具 → 探测 → 装一次 → 验证 → 跑」，但**探测**
// 这一步原先全靠模型一条条试 `command -v`。这个模块把那一堆试探压成一次调用。
//
// 硬约束（写死在实现里，不靠调用方自觉）：
//   1. 纯只读 —— 只读文件、只跑 `--version` / `command -v`，从不安装、不写配置、不改系统。
//   2. 不碰用户资产 —— 网络探测只连公共 DNS/端口（1.1.1.1、8.8.8.8、registry.npmjs.org…），
//      不扫内网、不发业务请求；`net: false` 时连这些也不做。
//   3. 不读敏感文件 —— 不读 ~/.ssh、~/.aws、凭据、令牌。只读 /etc/os-release、/proc/self/*、
//      /sys/fs/cgroup/*、/etc/apt 之类的基础信息。
//   4. 处处超时 —— 任何一条探测卡住都只降级成 `unknown` 并记一条 degradation，绝不挂住整个调用。
//   5. 一切结论都要能被复核 —— 报告里带路径/版本/原始行，不只给「可用/不可用」。
//
// 分层（越靠前越便宜，调用方可以只跑前几层）：
//   L0 shape      身份与形态：OS/发行版/架构/容器/WSL/Android/uid/沙箱路径 —— 纯读文件，<50ms
//   L1 resources  资源与限额：CPU/内存/负载/磁盘/cgroup 限额/ulimit
//   L2 network    出网形态：代理环境变量 + DNS + TCP 连通性 + 包源可达性
//   L3 stock      库存：包管理器、语言运行时、常用工具（路径 + 版本）
//   L4 capability 能力位：ptrace/seccomp/capabilities/user namespace/dev 节点
//   L5 domains    领域就绪度：把 L3 的库存映射到 data/toolchains.mjs 的 40+ 个域
// ───────────────────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { accessSync, readFileSync, statfsSync } from "node:fs";
import { createConnection } from "node:net";
import { lookup } from "node:dns/promises";
import { homedir, cpus, totalmem, freemem, loadavg, platform, arch, release, type, uptime } from "node:os";
import { TOOLCHAINS, TOOLCHAIN_PROTOCOL } from "./toolchains.mjs";

export const ENV_SCHEMA = "infinite-gen5/env-probe@1";
export const PROBE_VERSION = 1;

/** 运行时要检查的语言运行时（顺序即报告顺序，先出现的通常是首选）。 */
export const RUNTIME_BINS = [
  "node", "npm", "pnpm", "yarn", "bun",
  "python3", "python", "pip3", "pipx", "uv",
  "go", "cargo", "rustc", "java", "javac", "dotnet",
  "gcc", "g++", "clang", "make", "cmake", "ruby", "php", "perl",
];

/** 通用工具（不属于任何领域，但几乎每个交付物都要用）。 */
export const COMMON_BINS = [
  "curl", "wget", "git", "ssh", "openssl", "tar", "unzip", "zip", "xz", "zstd",
  "jq", "yq", "rg", "sed", "awk", "grep", "find", "xxd", "file", "strings",
  "objdump", "readelf", "nm", "ldd", "strace", "gdb", "python3-pip",
  "rsync", "diff", "sha256sum", "base64", "nc", "socat", "tcpdump", "nmap",
  "sqlite3", "docker", "podman", "kubectl", "adb", "su", "sudo",
];

/** 包管理器：id → 用来判定「存在」的可执行文件。 */
export const PACKAGE_MANAGERS = {
  apt: "apt-get",
  dpkg: "dpkg",
  dnf: "dnf",
  yum: "yum",
  pacman: "pacman",
  zypper: "zypper",
  apk: "apk",
  brew: "brew",
  port: "port",
  winget: "winget",
  choco: "choco",
  scoop: "scoop",
};

/** 出网探测目标：只连公共基础设施，绝不碰用户资产。 */
export const NET_TARGETS = [
  { id: "dns-udp", host: "1.1.1.1", port: 53, label: "公共 DNS" },
  { id: "https-any", host: "1.1.1.1", port: 443, label: "公共 HTTPS" },
  { id: "npm", host: "registry.npmjs.org", port: 443, label: "npm 源" },
  { id: "pypi", host: "pypi.org", port: 443, label: "PyPI 源" },
  { id: "github", host: "github.com", port: 443, label: "GitHub" },
];

const PROXY_KEYS = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy",
  "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy", "FTP_PROXY", "ftp_proxy"];

const CONTAINER_MARKERS = [
  "/.dockerenv", "/run/.containerenv", "/var/run/.containerenv",
];

// ───────────────────────────── 小工具 ─────────────────────────────

function run(cmd, args, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    let child;
    try {
      child = execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 },
        (error, stdout, stderr) => {
          done({
            ok: !error,
            code: error ? (typeof error.code === "number" ? error.code : null) : 0,
            timedOut: !!(error && (error.killed || error.signal)),
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
          });
        });
    } catch (error) {
      return done({ ok: false, code: null, timedOut: false, stdout: "", stderr: String(error && error.message || error) });
    }
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* 已经退出 */ }
      done({ ok: false, code: null, timedOut: true, stdout: "", stderr: `timeout after ${timeoutMs}ms` });
    }, timeoutMs + 250);
    if (timer.unref) timer.unref();
  });
}

function readText(path, limit = 65536) {
  try {
    return readFileSync(path, { encoding: "utf8" }).slice(0, limit);
  } catch {
    return null;
  }
}

function exists(path) {
  try { accessSync(path, fsConstants.F_OK); return true; } catch { return false; }
}

/** /etc/os-release 风格文件的键值解析；返回 null 表示读不到。 */
export function parseKeyValueFile(text) {
  if (typeof text !== "string") return null;
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/** 从 /proc/self/status 里取字段（CapEff、Seccomp、NoNewPrivs…）。 */
export function parseProcStatus(text) {
  if (typeof text !== "string") return null;
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return out;
}

/** 把 dd 风格或裸数字的 cgroup 限额解析成字节；`max` / 巨大值 → null。 */
export function parseLimitBytes(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text || text === "max") return null;
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 2 ** 60) return null;
  return value;
}

/** ubuntu:24.04 / debian:12 / alpine → 常用包管理命令的推断面。 */
export function packageManagerAdvice(shape, managers) {
  const id = String(shape?.distro?.ID ?? "").toLowerCase();
  const present = Object.keys(managers ?? {}).filter((key) => managers[key]?.ok);
  // 平台分支先于「一个都没找到」：macOS/Windows 的建议来自平台本身，
  // 而 Linux 上的建议来自发行版与已装的包管理器。
  if (shape?.platform === "darwin") return { command: "brew install", note: "macOS，优先 brew；部分工具要 xcode-select --install" };
  if (shape?.platform === "win32") return { command: "winget install", note: "Windows，优先 winget；也可 choco/scoop" };
  if (present.length === 0) return { command: null, note: "没有找到可用的包管理器 —— 只能手写脚本或用容器" };
  if (id.includes("ubuntu") || id.includes("debian")) return { command: "apt-get install -y", note: "Debian 系，装前先 apt-get update" };
  if (id.includes("alpine")) return { command: "apk add --no-cache", note: "Alpine，包名常与 Debian 系不同（如 upx 而非 upx-ucl）" };
  if (id.includes("fedora")) return { command: "dnf install -y", note: "Fedora 系" };
  if (id.includes("centos") || id.includes("rhel") || id.includes("rocky") || id.includes("alma")) return { command: "dnf install -y", note: "RHEL 系，可能需要启用 EPEL" };
  if (id.includes("arch") || id.includes("manjaro")) return { command: "pacman -S --noconfirm", note: "Arch 系，官方源外要 AUR" };
  if (present.includes("apt")) return { command: "apt-get install -y", note: "有 apt 但发行版未识别" };
  return { command: `${present[0]} install`, note: `按 ${present[0]} 的语法安装` };
}

// ───────────────────────────── L0 形态 ─────────────────────────────

export async function probeShape() {
  const notes = [];
  const osRelease = parseKeyValueFile(readText("/etc/os-release"));
  const lsbRelease = parseKeyValueFile(readText("/etc/lsb-release"));
  const androidBuild = parseKeyValueFile(readText("/system/build.prop"));
  const androidProps = parseKeyValueFile(readText("/system/system/build.prop"));

  let container = null;
  for (const marker of CONTAINER_MARKERS) {
    if (exists(marker)) { container = marker; break; }
  }
  const cgroup = readText("/proc/1/cgroup");
  if (container === null && cgroup && /docker|containerd|kubepods|lxc|garden|podman/i.test(cgroup)) {
    container = `/proc/1/cgroup:${cgroup.split("\n")[0].slice(0, 60)}`;
  }
  if (cgroup === null) notes.push("/proc/1/cgroup 读不到（Android/受限容器常见），容器判定只用文件标记");

  const procVersion = readText("/proc/version");
  const wsl = procVersion !== null && /microsoft/i.test(procVersion);

  let android = null;
  if (androidBuild || androidProps || exists("/system/bin/getprop")) {
    android = {
      release: androidBuild?.["ro.build.version.release"] ?? androidProps?.["ro.build.version.release"] ?? null,
      sdk: androidBuild?.["ro.build.version.sdk"] ?? androidProps?.["ro.build.version.sdk"] ?? null,
      model: androidBuild?.["ro.product.model"] ?? androidProps?.["ro.product.model"] ?? null,
      abi: androidBuild?.["ro.product.cpu.abi"] ?? androidProps?.["ro.product.cpu.abi"] ?? null,
      termux: exists(`${process.env.PREFIX ?? "/data/data/com.termux/files/usr"}/bin`),
    };
  }

  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const gid = typeof process.getgid === "function" ? process.getgid() : null;
  const dshSandbox = exists("/root/.dsh/plugin-src") || exists("/root/.dsh/profiles");

  return {
    platform: platform(),
    type: type(),
    arch: arch(),
    release: release(),
    node: process.version,
    uptimeSec: Math.round(uptime()),
    distro: osRelease ?? lsbRelease ?? null,
    container,
    wsl,
    android,
    identity: {
      uid,
      gid,
      user: process.env.USER ?? process.env.LOGNAME ?? null,
      home: homedir(),
      root: uid === 0,
      euidRoot: typeof process.geteuid === "function" ? process.geteuid() === 0 : uid === 0,
      cwd: process.cwd(),
      dshSandbox,
    },
    notes,
  };
}

// ───────────────────────────── L1 资源 ─────────────────────────────

export function probeResources() {
  const notes = [];
  const resources = {
    cpuCount: cpus().length,
    totalMemBytes: totalmem(),
    freeMemBytes: freemem(),
    loadavg: loadavg(),
  };
  try {
    const st = statfsSync("/");
    resources.disk = {
      totalBytes: st.blocks * st.bsize,
      freeBytes: st.bavail * st.bsize,
    };
  } catch {
    resources.disk = null;
    notes.push("statfs(/) 不可用，磁盘余量未知");
  }
  const limits = parseProcStatus(readText("/proc/self/limits"));
  resources.ulimits = limits
    ? {
      openFiles: limits["Max open files"] ?? null,
      procs: limits["Max processes"] ?? null,
      addressSpace: limits["Max address space"] ?? null,
      stack: limits["Max stack size"] ?? null,
    }
    : null;
  if (!limits) notes.push("/proc/self/limits 不可用，资源上限未知");

  const readLimit = (path) => parseLimitBytes(readText(path)?.trim() ?? null);
  resources.cgroup = {
    memoryMaxBytes: readLimit("/sys/fs/cgroup/memory.max") ?? readLimit("/sys/fs/cgroup/memory/memory.limit_in_bytes"),
    pidsMax: readText("/sys/fs/cgroup/pids.max")?.trim() ?? null,
    cpuMax: readText("/sys/fs/cgroup/cpu.max")?.trim() ?? null,
  };

  return { resources, notes };
}

// ───────────────────────────── L2 网络 ─────────────────────────────

/** TCP 连通性；超时/拒绝都算不可达，绝不抛。 */
export function tcpProbe(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const socket = createConnection({ host, port });
    const done = (ok, reason) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* 已关闭 */ }
      resolve({ ok, reason, ms: Date.now() - started });
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done(true, "connected"));
    socket.on("timeout", () => done(false, `timeout after ${timeoutMs}ms`));
    socket.on("error", (error) => done(false, error?.code ?? String(error?.message ?? error)));
  });
}

export async function probeNetwork(options = {}) {
  const notes = [];
  const proxies = {};
  for (const key of PROXY_KEYS) {
    if (process.env[key]) proxies[key] = process.env[key];
  }
  const net = { enabled: options.net !== false, proxies, dns: null, targets: [] };
  if (options.net === false) {
    notes.push("net=false：跳过一切出网探测（只报代理环境变量）");
    return { network: net, notes };
  }
  const timeoutMs = options.netTimeoutMs ?? 1500;

  const dnsNames = options.dnsNames ?? ["registry.npmjs.org", "pypi.org"];
  // DNS 与 TCP 并行走：串行查两个名字在慢解析器上就是白等两轮超时。
  const dnsRows = await Promise.all(dnsNames.map(async (name) => {
    const started = Date.now();
    try {
      const answer = await lookup(name, { all: false });
      return { name, ok: true, address: answer?.address ?? null, ms: Date.now() - started };
    } catch (error) {
      return { name, ok: false, reason: error?.code ?? String(error?.message ?? error), ms: Date.now() - started };
    }
  }));
  net.dns = dnsRows;

  const results = await Promise.all(NET_TARGETS.map(async (target) => {
    const probe = await tcpProbe(target.host, target.port, timeoutMs);
    return { ...target, ...probe };
  }));
  net.targets = results;

  const anyOk = results.some((row) => row.ok);
  const registryOk = results.filter((row) => row.ok && row.id !== "dns-udp" && row.id !== "https-any").length;
  net.verdict = anyOk ? (registryOk > 0 ? "online" : "restricted") : "offline";
  if (net.verdict === "offline" && Object.keys(proxies).length) {
    notes.push("代理环境变量存在但公共目标都连不上 —— 代理可能只对内网生效，或需要认证");
  }
  if (net.verdict === "offline") {
    notes.push("出网不通：安装一律走「等价替代」分支（系统自带命令 / 已有工具 / 手写脚本），并把降级点写进交付物");
  }
  return { network: net, notes };
}

// ───────────────────────────── L3 库存 ─────────────────────────────

/** 定位可执行文件：优先 `command -v`（POSIX），Windows 退回 `where`。 */
async function which(bin, timeoutMs) {
  if (platform() === "win32") {
    const res = await run("where", [bin], timeoutMs);
    const path = res.ok ? res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] : null;
    return path ?? null;
  }
  const res = await run("/bin/sh", ["-c", `command -v ${JSON.stringify(bin)} 2>/dev/null || true`], timeoutMs);
  const path = res.ok ? res.stdout.trim().split(/\r?\n/)[0] : "";
  return path || null;
}

/** 批量定位：**一次** shell 调用查完一批。
 *  逐条 `command -v` 要 spawn 上百个进程，在慢机器/Android 上就是好几秒 ——
 *  这一层是「快速评估」的关键路径，必须只付一次进程启动成本。 */
export async function whichBatch(bins, timeoutMs = 3000) {
  const unique = [...new Set(bins.filter((bin) => typeof bin === "string" && bin.length > 0))];
  const found = new Map();
  if (unique.length === 0) return found;
  if (platform() === "win32") {
    for (const bin of unique) {
      const path = await which(bin, timeoutMs);
      if (path) found.set(bin, path);
    }
    return found;
  }
  const list = unique.map((bin) => JSON.stringify(bin)).join(" ");
  const script = `for b in ${list}; do p=$(command -v "$b" 2>/dev/null) && printf '%s\t%s\n' "$b" "$p"; done`;
  const res = await run("/bin/sh", ["-c", script], timeoutMs);
  for (const line of res.stdout.split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const bin = line.slice(0, tab).trim();
    const path = line.slice(tab + 1).trim();
    if (bin && path) found.set(bin, path);
  }
  return found;
}

/** 版本：跑 `<bin> --version`，拿第一行有效内容；卡住就标 unknown 而不是等它。 */
async function versionOf(path, timeoutMs) {
  const attempts = [["--version"], ["-V"], ["-v"]];
  for (const args of attempts) {
    const res = await run(path, args, timeoutMs);
    const text = `${res.stdout}\n${res.stderr}`.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/^(usage|用法|try|请|error:|警告)/i.test(line));
    if (text) return text.slice(0, 100);
    if (res.timedOut) return "unknown(timeout)";
  }
  return null;
}

/** 并发探测一批可执行文件：先一次批量定位，再对**找到的**那些查版本。
 *  `versions: false` 完全不查版本；`versionBudgetMs` 用完后剩下的标 skipped(budget) —— 
 *  「快速评估」宁可少几个版本号，也不能让探测拖成十几秒。 */
export async function inspectBins(bins, options = {}) {
  const unique = [...new Set(bins)];
  const found = await whichBatch(unique, options.whichTimeoutMs ?? 3000);
  const rows = unique.map((bin) => ({ bin, ok: found.has(bin), path: found.get(bin) ?? null, version: null }));
  if (options.versions === false) return rows;

  const budget = options.versionBudgetMs ?? 2500;
  const started = Date.now();
  const limit = Math.max(1, Math.min(24, options.concurrency ?? 12));
  const targets = rows.filter((row) => row.ok);
  let cursor = 0;
  const workers = new Array(Math.min(limit, targets.length)).fill(0).map(async () => {
    for (;;) {
      if (Date.now() - started > budget) {
        while (cursor < targets.length) targets[cursor++].version = "skipped(budget)";
        return;
      }
      const index = cursor++;
      if (index >= targets.length) return;
      targets[index].version = await versionOf(targets[index].path, options.versionTimeoutMs ?? 1200);
    }
  });
  await Promise.all(workers);
  return rows;
}

export async function probeStock(options = {}) {
  const notes = [];
  const managerBins = Object.values(PACKAGE_MANAGERS);
  const managerRows = await inspectBins(managerBins, options);
  const managers = {};
  for (const [id, bin] of Object.entries(PACKAGE_MANAGERS)) {
    const row = managerRows.find((r) => r.bin === bin);
    managers[id] = { bin, ok: !!(row && row.ok), path: row?.path ?? null, version: row?.version ?? null };
  }

  const runtimeRows = await inspectBins(RUNTIME_BINS, options);
  const commonRows = await inspectBins(COMMON_BINS, options);

  const stock = {
    managers,
    runtimes: runtimeRows,
    common: commonRows,
    writable: {
      tmp: (() => { try { accessSync("/tmp", fsConstants.W_OK); return true; } catch { return false; } })(),
      cwd: (() => { try { accessSync(process.cwd(), fsConstants.W_OK); return true; } catch { return false; } })(),
      dsh: (() => { try { accessSync("/root/.dsh", fsConstants.W_OK); return true; } catch { return false; } })(),
    },
  };
  if (!Object.values(managers).some((row) => row.ok)) {
    notes.push("没有包管理器：工具链只能走「等价替代 / 静态包 / 容器」分支");
  }
  return { stock, notes, managerBins };
}

// ───────────────────────────── L4 能力位 ─────────────────────────────

export async function probeCapabilities(options = {}) {
  const notes = [];
  const status = parseProcStatus(readText("/proc/self/status"));
  const caps = {};
  if (status) {
    caps.capEff = status.CapEff ?? null;
    caps.capBnd = status.CapBnd ?? null;
    caps.seccomp = status.Seccomp ?? null;
    caps.noNewPrivs = status.NoNewPrivs ?? null;
    // cap_sys_admin (bit 21) / cap_sys_ptrace (19) / cap_net_raw (13) / cap_net_admin (12) / cap_bpf (39)
    if (caps.capEff && /^[0-9a-f]+$/i.test(caps.capEff)) {
      const mask = BigInt(`0x${caps.capEff}`);
      const has = (bit) => (mask & (1n << BigInt(bit))) !== 0n;
      caps.decoded = {
        sysAdmin: has(21),
        sysPtrace: has(19),
        netRaw: has(13),
        netAdmin: has(12),
        bpf: has(39),
        sysModule: has(16),
        dacReadSearch: has(2),
      };
    }
  } else {
    notes.push("/proc/self/status 不可用：capabilities/seccomp 未知（Android 兼容层常见）");
  }
  const yama = readText("/proc/sys/kernel/yama/ptrace_scope")?.trim() ?? null;
  const caps2 = {
    ...caps,
    ptraceScope: yama,
    ptraceLikely: yama === null ? "unknown" : (yama === "0" ? "allowed" : "restricted"),
    devNodes: {
      tun: exists("/dev/net/tun"),
      kvm: exists("/dev/kvm"),
      fuse: exists("/dev/fuse"),
      mem: exists("/dev/mem"),
    },
    namespaces: {
      user: exists("/proc/self/ns/user"),
      net: exists("/proc/self/ns/net"),
      mount: exists("/proc/self/ns/mount"),
      pid: exists("/proc/self/ns/pid"),
    },
    kernelModules: exists("/lib/modules") ? "可能有模块树" : "无 /lib/modules",
    bpf: exists("/sys/fs/bpf") ? "bpf fs 存在" : "无 /sys/fs/bpf",
  };
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    notes.push("非 root：内核模块、驱动、原始套接字、iptables 之类操作大概率不可用，先按「用户态可达」设计");
  }
  return { capabilities: caps2, notes };
}

// ───────────────────────────── L3.5 设备（DSHA） ─────────────────────────────

export async function probeDevice(options = {}) {
  const notes = [];
  const tokenPath = options.bridgeTokenPath ?? "/root/.dsh/.bridge_token";
  const token = readText(tokenPath)?.trim() ?? null;
  const device = { bridgeToken: !!token, endpoints: {}, adbShell: null };
  if (globalThis.fetch && typeof options.deviceProbe === "function") {
    device.endpoints = await options.deviceProbe(token);
    return { device, notes };
  }
  if (typeof globalThis.fetch !== "function") {
    notes.push("当前 Node 无 fetch：跳过 DSHA 接口探测（用 curl 也行）");
    return { device, notes };
  }
  if (!token) {
    notes.push(`${tokenPath} 不存在：DSHA 桥接未配置，设备能力按「不可用」处理`);
    return { device, notes };
  }
  const base = options.bridgeBase ?? "http://127.0.0.1:3090";
  try {
    const res = await fetch(`${base}/app/device?token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(options.deviceTimeoutMs ?? 1500) });
    const text = (await res.text()).slice(0, 400);
    device.endpoints.device = { ok: res.ok, status: res.status, sample: text };
  } catch (error) {
    device.endpoints.device = { ok: false, reason: error?.name ?? String(error?.message ?? error) };
    notes.push("DSHA /app/device 探测失败：设备通道可能没开（这不是错误，只是能力缺席）");
  }
  const adb = await which("adb-shell", options.whichTimeoutMs ?? 800);
  device.adbShell = adb;
  return { device, notes };
}

// ───────────────────────────── L5 领域就绪度 ─────────────────────────────

/** 从一行工具链里抽出候选可执行文件名。
 *  行格式：`<工具> — <用途> | 装: … | 验: …`，工具位可能是
 *  「rizin + Cutter / radare2」「binutils（readelf/objdump/strings/nm）」这种复合写法。 */
export function binsOfToolLine(line) {
  const text = String(line ?? "");
  const head = text.split("|")[0].split("—")[0].split("--")[0].trim();
  // 括号里通常才是真正的命令名（`Detect It Easy (diec)`、`binutils（readelf/objdump）`），
  // 所以括号内容排在前面；括号外的长名字多是显示名（`Cutter`、`StegSolve`）。
  const inside = [...head.matchAll(/[（(]([^）)]*)[）)]/g)].map((m) => m[1]).join(" ");
  const stripped = head.replace(/[（(][^）)]*[）)]/g, " ").replace(/[（(].*$/, " ");
  const candidates = `${inside} ${stripped}`
    .split(/[+/、,，]|\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+/)[0])
    .map((part) => part.replace(/[.。；;：:]+$/, ""))
    .filter((part) => /^[a-z0-9][a-z0-9._-]*$/i.test(part))
    .filter((part) => part.length >= 2 && part.length <= 32);
  return [...new Set(candidates)];
}

/** 一个域就绪度：装了几个 / 缺哪几个（按 toolchains 数据算，不猜）。 */
export function domainReadiness(stockRows, toolchains = TOOLCHAINS) {
  const present = new Set(stockRows.filter((row) => row.ok).map((row) => row.bin));
  const domains = [];
  for (const [id, lines] of Object.entries(toolchains)) {
    if (!Array.isArray(lines) || lines.length === 0) continue;
    const tools = [];
    for (const line of lines) {
      const bins = binsOfToolLine(line);
      if (bins.length === 0) {
        tools.push({ line: line.slice(0, 60), bins: [], state: "no-bins" });
        continue;
      }
      const hit = bins.find((bin) => present.has(bin)) ?? null;
      tools.push({ line, bins, hit, state: hit ? "ready" : "missing" });
    }
    const checkable = tools.filter((tool) => tool.bins.length > 0);
    const ready = checkable.filter((tool) => tool.state === "ready");
    const installOf = (line) => {
      const m = String(line).match(/\|\s*装\s*:\s*([^|]+)/);
      return m ? m[1].trim() : null;
    };
    // 缺什么：优先报「像个真命令」的小写名字，别把 GUI 显示名（StegSolve/Cutter）当缺件。
    const isCommandLike = (bin) => /^[a-z][a-z0-9._+-]*$/.test(bin);
    domains.push({
      id,
      total: checkable.length,
      ready: ready.length,
      ratio: checkable.length ? Number((ready.length / checkable.length).toFixed(2)) : 0,
      missing: checkable.filter((tool) => tool.state === "missing")
        .map((tool) => tool.bins.find(isCommandLike) ?? tool.bins[0]).slice(0, 6),
      // 缺的那几个「装什么」——只说缺没用，得给出最近的一步。
      install: checkable.filter((tool) => tool.state === "missing")
        .map((tool) => ({
          bin: tool.bins.find(isCommandLike) ?? tool.bins[0],
          install: installOf(tool.line),
        })).slice(0, 4),
    });
  }
  domains.sort((a, b) => b.ratio - a.ratio || a.id.localeCompare(b.id));
  return domains;
}

/** 给模型的一句话结论 + 建议的下一步命令。 */
export function renderEnvSummary(report, options = {}) {
  const lines = [];
  const shape = report.shape ?? {};
  const where = shape.container ? `容器（${shape.container}）` : shape.wsl ? "WSL" : shape.android ? "Android" : "裸机/虚拟机";
  lines.push(`环境：${shape.platform}/${shape.arch} ${shape.distro?.PRETTY_NAME ?? shape.distro?.ID ?? shape.release}` +
    ` · ${where} · uid=${shape.identity?.uid}${shape.identity?.root ? "(root)" : "(非 root)"}` +
    ` · node ${shape.node}`);
  const res = report.resources ?? {};
  if (res.cpuCount) {
    lines.push(`资源：${res.cpuCount} 核 / 内存 ${gb(res.totalMemBytes)} GiB（空闲 ${gb(res.freeMemBytes)}）` +
      (res.disk ? ` / 磁盘余量 ${gb(res.disk.freeBytes)} GiB` : "") +
      (res.ulimits?.openFiles ? ` / nofile ${res.ulimits.openFiles}` : ""));
  }
  const net = report.network ?? {};
  if (report.network === null || report.network === undefined) lines.push("网络：未探测（本次没选 network 层）");
  else if (net.enabled === false) lines.push("网络：跳过探测（net=false）");
  else {
    const okList = (net.targets ?? []).filter((row) => row.ok).map((row) => row.id);
    lines.push(`网络：${net.verdict ?? "unknown"}` +
      (okList.length ? `（可达：${okList.join("、")}）` : "（公共目标全部不可达）") +
      (Object.keys(net.proxies ?? {}).length ? ` · 代理变量 ${Object.keys(net.proxies).length} 个` : " · 无代理变量"));
  }
  const stock = report.stock ?? {};
  if (report.stock === null || report.stock === undefined) {
    lines.push("库存：未探测（本次没选 stock 层）");
  } else {
    const managerNames = Object.entries(stock.managers ?? {}).filter(([, row]) => row.ok).map(([id]) => id);
    lines.push(`包管理：${managerNames.length ? managerNames.join("、") : "无"}` +
      ` · 可写：tmp=${stock.writable?.tmp ? "y" : "n"} cwd=${stock.writable?.cwd ? "y" : "n"}`);
    const runtimes = (stock.runtimes ?? []).filter((row) => row.ok);
    lines.push(`运行时：${runtimes.length ? runtimes.map((row) => row.bin).join("、") : "无"}`);
    const common = (stock.common ?? []).filter((row) => row.ok).map((row) => row.bin);
    lines.push(`常用工具：${common.length}/${(stock.common ?? []).length} 就绪` +
      (common.length ? `（${common.slice(0, 18).join("、")}${common.length > 18 ? "…" : ""}）` : ""));
  }
  const caps = report.capabilities ?? {};
  if (caps.decoded) {
    const on = Object.entries(caps.decoded).filter(([, v]) => v).map(([k]) => k);
    lines.push(`能力：capEff=${caps.capEff}${on.length ? `（含 ${on.join("、")}）` : ""}` +
      ` · seccomp=${caps.seccomp ?? "?"} · ptrace=${caps.ptraceLikely ?? "?"}`);
  }
  const dev = report.device ?? {};
  if (dev.bridgeToken !== undefined) {
    lines.push(`设备：DSHA ${dev.bridgeToken ? "桥接令牌在位" : "未配置"}` +
      (dev.endpoints?.device ? ` · /app/device ${dev.endpoints.device.ok ? "可达" : "不可达"}` : "") +
      (dev.adbShell ? ` · adb-shell ${dev.adbShell}` : ""));
  }
  const domains = report.domains ?? [];
  if (domains.length) {
    const ready = domains.filter((row) => row.ratio >= 0.6);
    const top = domains.slice(0, 5);
    lines.push(`领域就绪：${ready.length}/${domains.length} 个域 ≥60% —— 最高：` +
      top.map((row) => `${row.id} ${row.ready}/${row.total}`).join(" · "));
    const needWork = domains.filter((row) => row.ratio < 0.6).slice(-3).reverse();
    if (needWork.length) {
      lines.push(`最缺工具：${needWork.map((row) => `${row.id} 缺 ${row.missing.slice(0, 3).join("/")}`).join(" · ")}`);
      // 离「能干活」最近的那个域：说明装哪两个工具就能把它点着。
      const closest = needWork[needWork.length - 1];
      if (closest?.install?.length) {
        lines.push(`离就绪最近：${closest.id} ${closest.ready}/${closest.total} —— ` +
          closest.install.slice(0, 2).map((row) => `${row.bin}（${row.install ?? "见领域包"}）`).join(" · "));
      }
    }
  }
  const advice = report.advice ?? {};
  if (advice.command) lines.push(`装工具用：${advice.command}（${advice.note}）`);
  if (report.notes?.length) lines.push(`注意：${report.notes.slice(0, options.noteLimit ?? 6).join("；")}`);
  return lines.join("\n");
}

function gb(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "?";
  return (bytes / 2 ** 30).toFixed(1);
}

// ───────────────────────────── 总入口 ─────────────────────────────

/** 一次跑完 5 层；任何一层失败都只记 note，不影响其它层。 */
export async function probeEnv(options = {}) {
  const layers = new Set(options.layers ?? ["shape", "resources", "network", "stock", "capabilities", "device", "domains"]);
  const notes = [];
  const started = Date.now();

  const shape = layers.has("shape") ? await probeShape() : null;
  if (shape) notes.push(...shape.notes);

  let resources = null;
  if (layers.has("resources")) {
    const r = probeResources();
    resources = r.resources;
    notes.push(...r.notes);
  }

  let network = null;
  if (layers.has("network")) {
    const r = await probeNetwork(options);
    network = r.network;
    notes.push(...r.notes);
  }

  let stock = null;
  if (layers.has("stock")) {
    const r = await probeStock(options);
    stock = r.stock;
    notes.push(...r.notes);
  }

  let capabilities = null;
  if (layers.has("capabilities")) {
    const r = await probeCapabilities(options);
    capabilities = r.capabilities;
    notes.push(...r.notes);
  }

  let device = null;
  if (layers.has("device")) {
    const r = await probeDevice(options);
    device = r.device;
    notes.push(...r.notes);
  }

  let domains = null;
  if (layers.has("domains") && !stock) {
    notes.push("domains 层依赖 stock 层：本次没选 stock，领域就绪度跳过");
  }
  if (layers.has("domains") && stock) {
    const rows = [...stock.runtimes, ...stock.common, ...Object.values(stock.managers).map((row) => ({
      bin: row.bin, ok: row.ok, path: row.path, version: row.version,
    }))];
    domains = domainReadiness(rows, options.toolchains ?? TOOLCHAINS);
  }

  const report = {
    schema: ENV_SCHEMA,
    probeVersion: PROBE_VERSION,
    at: new Date().toISOString(),
    tookMs: Date.now() - started,
    shape,
    resources,
    network,
    stock,
    capabilities,
    device,
    domains,
    advice: packageManagerAdvice(shape, stock?.managers),
    toolProtocol: TOOLCHAIN_PROTOCOL,
    notes,
  };
  report.summary = renderEnvSummary(report, options);
  return report;
}
