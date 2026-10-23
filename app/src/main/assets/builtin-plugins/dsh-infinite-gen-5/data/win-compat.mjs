// 无限五代 · Windows 兼容垫片（实验性，v0.1.0）
//
// 定位：把「平台相关」这件事收敛到一处，其余代码只问垫片、不直接问 process.platform。
// 现状 —— 本仓库大部分平台敏感逻辑散在三处：
//   ① data/vocabulary-data.mjs 里的起步命令（数据，非运行时缺陷，按档位过滤即可）；
//   ② install.sh / install.ps1 / install.bat 三条安装路径（脚本各自为政）；
//   ③ index.js 的 homedir() / joinPath() / 子进程调用（运行时真会炸的地方）。
//
// 本垫片只做一件事：把 ①②③ 需要的判断抽成纯函数，参数可注入 → 于是能在 Linux 上
// 用 `--simulate-platform=win32` 把 win32 分支真跑一遍，不必等 Windows 机器。
//
// 不变量：所有函数都不读 process 之外的全局状态，且接受 opts 覆盖。
// 这样 verify_win_compat.mjs 能构造 win32 / darwin / linux 三种视图做逐项对比。

export const WIN_COMPAT_VERSION = "win-compat@0.1.0";

/** 支持的目标平台。darwin 与 linux 归为 posix —— 它们的差异不在本垫片职责内。 */
export const PLATFORMS = Object.freeze(["linux", "darwin", "win32"]);

/** 平台族：决定分隔符、外壳、PATH 分隔符、行尾。 */
const FAMILY = Object.freeze({ linux: "posix", darwin: "posix", win32: "nt" });

/** 归一化平台名：把 node 的 process.platform / 用户手输的字符串都收进来。 */
export function normalizePlatform(input) {
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return "linux";
  if (raw === "windows" || raw === "win" || raw === "nt" || raw === "win64") return "win32";
  if (raw === "mac" || raw === "macos" || raw === "osx" || raw === "darwin") return "darwin";
  if (raw === "ubuntu" || raw === "debian" || raw === "linux") return "linux";
  return PLATFORMS.includes(raw) ? raw : "linux"; // 未知平台按 posix 走，不抛异常
}

export const familyOf = (platform) => FAMILY[normalizePlatform(platform)] ?? "posix";
export const isWindows = (platform) => normalizePlatform(platform) === "win32";

/**
 * 解析平台视图。opts.platform 优先，其次 IG5_PLATFORM 环境变量，最后 process.platform。
 * 返回的每个字段都是常量，不随调用变化 —— 测试里可以整体替换。
 */
export function platformView(opts = {}) {
  const platform = normalizePlatform(
    opts.platform ?? process.env.IG5_PLATFORM ?? process.platform,
  );
  const nt = platform === "win32";
  return Object.freeze({
    platform,
    family: nt ? "nt" : "posix",
    sep: nt ? "\\" : "/",
    delim: nt ? ";" : ":",
    eol: nt ? "\r\n" : "\n",
    exe: nt ? ".exe" : "",
    /** 家目录候选：优先显式环境变量，否则走平台默认。 */
    homeEnvKeys: nt ? ["USERPROFILE", "APPDATA", "HOMEDRIVE"] : ["HOME"],
    /** 默认 DSH 数据目录的父级。 */
    appDataLeaf: nt ? ".dsh" : ".dsh",
  });
}

/** 家目录：inject 用于测试给定假家目录，win 下按 USERPROFILE 优先。 */
export function homeDir(opts = {}) {
  if (opts.home) return String(opts.home);
  const view = platformView(opts);
  for (const key of view.homeEnvKeys) {
    const v = process.env[key];
    if (v && v.trim()) return v.trim();
  }
  return view.family === "nt" ? "C:\\Users\\TARGET_USER" : "/root";
}

/** 纯字符串拼接，避免在 win32 上把 `/` 混进路径（joinPath 会自己选分隔符）。 */
export function joinPath(parts, opts = {}) {
  const view = platformView(opts);
  // 只剥尾部分隔符，不碰 \r —— 行尾字符不是路径的一部分（上一版把它一起啃掉了）。
  const clean = (p) => String(p ?? "").replace(/[\\/]+$/, "");
  const items = parts
    .filter((p) => p !== undefined && p !== null && p !== "")
    .map(clean)
    .filter(Boolean);
  if (!items.length) return "";
  const joined = items.join(view.sep);
  if (view.family !== "nt") return joined;
  // 盘符与 UNC 的特殊情况：C: + \ → C:\ ；\\ 开头的 UNC 保留双反斜杠。
  const prefixed = joined.replace(/^([A-Za-z]:)\\+/, "$1\\");
  return prefixed.startsWith("\\\\") ? "\\\\" + prefixed.replace(/\\{2,}/g, "\\").slice(2) : prefixed.replace(/\\{2,}/g, "\\");
}

/** DSH 根目录：IG5_HOME > DSH_HOME > <home>/.dsh。 */
export function dshRoot(opts = {}) {
  const env = opts.env ?? process.env;
  const direct = String(envValue("IG5_HOME", { ...opts, env }) ?? envValue("DSH_HOME", { ...opts, env }) ?? "").trim();
  if (opts.home) return joinPath([opts.home, ".dsh"], opts); // 测试注入优先，不被环境变量抢
  if (direct) return direct;
  return joinPath([homeDir(opts), ".dsh"], opts);
}

/**
 * 外壳命令构造。返回 { cmd, args } 直接喂 child_process.execFileSync，
 * 不走 shell —— 这是 Windows 上最容易踩的一条：`sh -c "node x.mjs"` 在 win 上不存在。
 */
export function shellFor(script, opts = {}) {
  const view = platformView(opts);
  const body = String(script ?? "").trim();
  if (view.family === "nt") {
    return { cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", body], shell: false };
  }
  return { cmd: "/bin/sh", args: ["-c", body], shell: false };
}

/** npm/pnpm 在 win 上是 .cmd 包装；execFile 必须点全名，否则 EINVAL。 */
export function binName(name, opts = {}) {
  const view = platformView(opts);
  const base = String(name ?? "").trim();
  if (!base) return base;
  if (view.family === "nt" && !/\.(cmd|exe|bat|ps1)$/i.test(base)) return `${base}.cmd`;
  return base;
}

/**
 * 起步命令的平台适配。命令库（data/vocabulary-data.mjs）写的是 POSIX 风格，
 * win32 上要换外壳与临时目录。返回 { line, changed, reason }；changed=false 表示原样可用。
 */
export function adaptCommand(line, opts = {}) {
  const view = platformView(opts);
  const src = String(line ?? "");
  if (view.family !== "nt") return { line: src, changed: false, reason: "posix 原样" };
  let out = src;
  const reasons = [];
  if (/(^|\s)\/tmp\//.test(out)) {
    out = out.replace(/(^|\s)\/tmp\//g, "$1%TEMP%\\");
    reasons.push("临时目录 → %TEMP%");
  }
  if (/^chmod \+x /.test(out)) {
    out = out.replace(/^chmod \+x /, "icacls ").replace(/$/, " /grant %USERNAME%:F");
    reasons.push("chmod → icacls");
  }
  if (/\bsudo\b/.test(out)) {
    out = out.replace(/\bsudo\b/g, "Start-Process -Verb RunAs");
    reasons.push("sudo → Start-Process -Verb RunAs");
  }
  if (/\\\|\s*(grep|awk|sed)\b/.test(out) || /\|\s*(grep|awk|sed)\b/.test(out)) {
    reasons.push("管道工具需 PowerShell 等价物（findstr/Select-String）—— 需人工复核");
  }
  return { line: out, changed: out !== src, reason: reasons.join("；") || "win32 无需改动" };
}

/** 行尾归一：按目标平台重写，用于落盘 .ps1/.bat 与生成器输出。 */
export function normalizeEol(text, opts = {}) {
  const view = platformView(opts);
  // 先丢掉落单的 \r（混杂行尾的元凶），再把 CRLF 收敛成 LF，最后按平台铺开。
  const body = String(text ?? "").replace(/\r(?!\n)/g, "").replace(/\r\n/g, "\n");
  return view.eol === "\n" ? body : body.split("\n").join(view.eol);
}

/** 安装脚本选择：win32 有 .ps1 与 .bat 两条，优先 pwsh 可用的 .ps1。 */
export function installerFor(opts = {}) {
  const view = platformView(opts);
  if (view.family === "nt") {
    return { primary: "install.ps1", fallback: "install.bat", run: "powershell -ExecutionPolicy Bypass -File install.ps1" };
  }
  return { primary: "install.sh", fallback: "install.ps1", run: "chmod +x install.sh && ./install.sh" };
}

/** 环境变量读取：win 上大小写不敏感，这里显式做一次大小写兼容查找。 */
export function envValue(name, opts = {}) {
  const env = opts.env ?? process.env;
  if (name in env) return env[name];
  if (familyOf(opts.platform ?? process.platform) === "nt") {
    const key = Object.keys(env).find((k) => k.toLowerCase() === String(name).toLowerCase());
    if (key) return env[key];
  }
  return undefined;
}

/**
 * 自检视图：把同一份输入在三个平台下展开，供 verify 脚本逐项比对。
 * 纯函数 —— 不写盘、不建子进程。
 */
export function compatMatrix(opts = {}) {
  const probe = opts.probe ?? "npm run verify:cot-router";
  const rows = [];
  for (const platform of PLATFORMS) {
    const o = { home: opts.home, platform };
    const sh = shellFor(probe, o);
    rows.push({
      platform,
      family: familyOf(platform),
      home: homeDir(o),
      dshRoot: dshRoot(o),
      joined: joinPath(["a", "b", "c.mjs"], o),
      shell: `${sh.cmd} ${sh.args[sh.args.length - 1]}`,
      npmBin: binName("npm", o),
      installer: installerFor(o).primary,
      eol: normalizeEol("x\ny", o) === "x\r\ny" ? "CRLF" : "LF",
      tempAdapted: adaptCommand("curl -s http://HOST/ -o /tmp/out.bin", o).line,
    });
  }
  return rows;
}
