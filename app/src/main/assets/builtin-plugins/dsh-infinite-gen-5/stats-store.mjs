/**
 * 统计数据库：插件本体（核心）单写、前端面板单读的那一份 JSON。
 *
 * 为什么要这份文件：面板过去是「点一下 → 服务端现算一份 state → 返回」，等于面板间接
 * 依赖插件内部形态（哪些键、怎么算、算的时候能不能读盘）。现在反过来 —— 核心把该说的
 * 话**写进数据库**，面板只读数据库，不参与任何计算，也不知道插件内部长什么样：
 *
 *   核心（index.js）  --写-->  统计数据库（infinite-gen-5-stats.json）  --读-->  面板（client.js）
 *
 * 因此本模块刻意不依赖 cordis / index.js：读写两侧都能单独测。
 * 写侧：原子替换（tmp + rename），防抖合流（默认 750ms，可关），失败只记录不抛
 * （统计是旁路信息，绝不能因为它把插件本体搞坏）。
 * 读侧：只读盘上的文件，不触发任何计算；盘上没有/读坏时由调用方决定降级策略。
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** 数据库 schema 标识；结构变了就加尾号，读侧按它决定要不要认这份文件。 */
export const STATS_SCHEMA = "ig5-stats/1";
export const STATS_FILE_NAME = "infinite-gen-5-stats.json";
export const STATS_PLUGIN = "dsh-infinite-gen-5";
export const DEFAULT_FLUSH_MS = 750;

const readEnvPath = (name) => {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : null;
};

/** 数据库所在目录：IG5_HOME > DSH_HOME > ~/.dsh（与调参档位同一套约定）。 */
export const statsHome = () =>
  readEnvPath("IG5_HOME") ?? readEnvPath("DSH_HOME") ?? join(homedir(), ".dsh");

/** 数据库路径；IG5_STATS_FILE 可整体覆盖（测试用）。 */
export const statsFile = () => readEnvPath("IG5_STATS_FILE") ?? join(statsHome(), STATS_FILE_NAME);

/** 空库骨架 —— 读侧拿到的键永远齐全，面板不必到处判 undefined。 */
export const emptyStats = (version, at = null) => ({
  schema: STATS_SCHEMA,
  plugin: STATS_PLUGIN,
  version,
  generatedAt: at,
  // v0.38.3：启动自证分区。DSHA 环境下引擎每次启动换一个 DSHA_WEB_GENERATION，而「确认/审阅」
  // 事务被原生闸门拦下，不落 .plugin-manager/run.json —— 所以本体自己记：本次世代 + startup uuid
  // + 上一次启动的确认快照。骨架里先摆 null / []，守住「读侧键永远齐全」这条不变量。
  boot: { at, pid: process.pid, version, generation: null, startup: null, dsha: null, nativePluginManager: null, previous: null },
  boots: [],
  runtime: { role: "unknown", anchorEmissions: 0, rebuilds: 0, sections: [], placements: [], plan: null },
  tuning: null,
  // v0.14.1：启动时由 index.js 用 coverageSnapshot() 填满（域数 / 族分布 / 词表 / 预算）。
  // 骨架里先摆 null，是为了「读侧键永远齐全」这条不变量 —— 面板不必判 undefined。
  coverage: null,
  // v0.15.0：live 分区（本轮是否进行中 / 事件速率 / 最近工具流水），由 index.js 每秒算一次，
  // 同样先摆 null 守住「读侧键永远齐全」。
  live: null,
  tools: { calls: {}, total: 0, capped: 0, truncated: 0, lastCall: null },
  tasks: {
    available: false,
    source: null,
    reason: "尚未读到会话任务清单",
    counts: { pending: 0, inProgress: 0, completed: 0 },
    items: [],
    lastKnown: null,
    at: null,
    session: null,
    writes: [],
  },
  sessions: { seen: 0, events: 0, lastId: null, lastAt: null },
  counters: {},
});

/** 极简安全解析：坏文件当没有，绝不抛（与 index.js 的 safeParseJson 各管一段，互不依赖）。 */const parseJsonSafe = (text) => {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
};

const cloneJson = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

/** 深合并：把已落盘的旧库盖到空骨架上，未知键保留（前向兼容）。 */
const mergeStats = (base, loaded) => {
  if (!loaded || typeof loaded !== "object") return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(loaded)) {
    const current = out[key];
    if (value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)) {
      out[key] = mergeStats(current, value);
    } else {
      out[key] = value;
    }
  }
  return out;
};

const toPath = (path) => (Array.isArray(path) ? path.map(String) : String(path).split(".").filter(Boolean));

/**
 * 创建一个统计数据库写入器。
 *
 * @param {object} [options]
 * @param {string} [options.file] 数据库路径（默认 statsFile()）
 * @param {string} [options.version] 当前插件版本，写进库里供面板显示
 * @param {number} [options.flushMs] 防抖毫秒；0 = 每次改动立即落盘
 * @param {boolean} [options.autoLoad] 构造时就吸收盘上旧库（跨进程重启保留计数）
 * @param {() => string} [options.now] 时钟，测试可注入
 */
export const createStatsStore = (options = {}) => {
  const file = options.file ?? statsFile();
  const version = String(options.version ?? "0.0.0");
  const flushMs = Number.isFinite(options.flushMs) ? Math.max(0, Number(options.flushMs)) : DEFAULT_FLUSH_MS;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();

  let doc = emptyStats(version, now());
  let dirty = false;
  let timer = null;
  let lastError = null;
  let writes = 0;
  // v0.15.0：落盘序号 + 变更订阅。
  // 面板要「变更即达」，就必须有人告诉它「库变了」——这件事由写侧广播，读侧只负责读。
  // 订阅回调在**落盘成功之后**触发（面板读的是盘上那份文件，写失败时通知它没有意义），
  // 因此天然就是合流的：防抖窗口内的多次改动只会产生一次通知。
  let seq = 0;
  const listeners = new Set();

  const notify = () => {
    if (listeners.size === 0) return;
    const info = { seq, at: now(), generatedAt: doc.generatedAt, writes, file };
    for (const listener of [...listeners]) {
      // 订阅者（SSE  broadcaster）绝不能因为自己的异常把写侧带崩。
      try {
        listener(info);
      } catch (error) {
        lastError = String((error && error.message) || error);
      }
    }
  };

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return false;
    dirty = false;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
      renameSync(tmp, file);
      writes += 1;
      seq += 1;
      lastError = null;
    } catch (error) {
      lastError = String((error && error.message) || error);
      dirty = true;
      return false;
    }
    // 盘上已经是新内容了，这时候再喊人来看。
    notify();
    return true;
  };

  const schedule = () => {
    dirty = true;
    doc.generatedAt = now();
    if (flushMs === 0) {
      flush();
      return;
    }
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, flushMs);
    if (typeof timer.unref === "function") timer.unref();
  };

  const at = (path) => {
    const keys = toPath(path);
    let node = doc;
    for (const key of keys.slice(0, -1)) {
      if (!node[key] || typeof node[key] !== "object") node[key] = {};
      node = node[key];
    }
    return { node, key: keys.at(-1) };
  };

  const load = () => {
    try {
      const loaded = parseJsonSafe(readFileSync(file, "utf8"));
      if (loaded && loaded.schema === STATS_SCHEMA) {
        doc = mergeStats(emptyStats(version, now()), loaded);
        // 版本号与插件名是「谁在写这份库」，不跟着旧盘走：升级后第一次读就必须反映当前版本，
        // 否则面板会一直显示上一版的版本号（历史数据该留的留，标识该更新的更新）。
        doc.version = version;
        doc.plugin = STATS_PLUGIN;
        dirty = true;
      }
      return true;
    } catch {
      return false;
    }
  };

  if (options.autoLoad === true) load();

  return {
    file,
    schema: STATS_SCHEMA,
    version,
    get dirty() {
      return dirty;
    },
    get writes() {
      return writes;
    },
    /** 落盘序号：每成功写盘 +1，供推送侧「有没有新东西」判定与幂等去重。 */
    get seq() {
      return seq;
    },
    get lastError() {
      return lastError;
    },
    /** 整段替换一个顶层分区（写侧唯一入口之一）。 */
    set(section, value) {
      doc[section] = value;
      schedule();
      return doc[section];
    },
    /** 合并式更新一个顶层分区。 */
    patch(section, fields) {
      const base = doc[section] && typeof doc[section] === "object" ? doc[section] : {};
      doc[section] = { ...base, ...fields };
      schedule();
      return doc[section];
    },
    /** 计数：bump("tools.total") / bump(["tools","calls","scenario"], 1)。 */
    bump(path, n = 1) {
      const { node, key } = at(path);
      node[key] = (Number(node[key]) || 0) + (Number(n) || 0);
      schedule();
      return node[key];
    },
    /** 往数组分区里追加一条尾部记录（如清单写入历史），只留最近 n 条。 */
    push(path, entry, keep = 20) {
      const { node, key } = at(path);
      const list = Array.isArray(node[key]) ? node[key] : [];
      list.push(cloneJson(entry) ?? entry);
      node[key] = list.slice(-Math.max(1, keep));
      schedule();
      return node[key];
    },
    /** 读内存里的当前库（深拷贝，调用方改不动内部状态）。 */
    snapshot() {
      return cloneJson(doc) ?? doc;
    },
    /**
     * 订阅落盘变更（v0.15.0）：每次成功写盘、且防抖窗口内的改动已合流完成后回调一次。
     * 返回退订函数；回调里出错只会被记进 lastError，不会影响写入流程。
     */
    onChange(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** 读盘上的库 —— 面板读侧走这里，不触发任何计算。 */
    read() {
      const loaded = parseJsonSafe((() => {
        try {
          return readFileSync(file, "utf8");
        } catch {
          return "";
        }
      })());
      if (loaded && loaded.schema === STATS_SCHEMA) return loaded;
      return null;
    },
    /** 落盘（force=true 时即便没有脏标记也写一次）。 */
    flush(force = false) {
      if (force) dirty = true;
      return flush();
    },
    /** 停止防抖计时器并把剩余改动落盘（插件卸载/进程退出前调）。 */
    dispose() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      dirty = true;
      return flush();
    },
    load,
  };
};

/**
 * 启动自证（v0.38.3）：把本次启动写进库 —— 世代号（DSHA 环境下引擎每次启动递增）、
 * 本次 startup uuid、以及上一次启动的确认快照（跨重启保留，供面板显示「上次加载确认」）。
 *
 * 为什么需要它：DSHA 环境下插件管理器的「确认/审阅」事务被原生闸门拦下
 * （DSHA_NATIVE_REVIEW_REQUIRED，不落 .plugin-manager/run.json），停一次 DSH 再起就
 * 没有任何落盘面能回答「上次到底确认过没有」。这一段由插件本体自己记账，不依赖 DSHA 放行。
 *
 * 抽成独立导出是为了让门禁（scripts/verify_boot_attest.mjs）测的是这段真代码，而不是副本。
 *
 * @param {object} store Stats Service 或 createStatsStore(...) 的返回值；Service 需要提供
 *   snapshot/publish/append 与 file/version 元数据，旧 store 仍支持 set/push 回退。
 * @param {object} [options]
 * @param {object} [options.env] 环境变量表（默认 process.env；门禁注入假世代用）
 * @param {string} [options.startup] 本次启动 id（默认 randomUUID）
 * @param {string} [options.at] 启动时刻（默认现在）
 * @param {string} [options.statsFile] 库里记的库路径（默认 statsFile()）
 * @param {number} [options.keep] 启动历史保留条数（默认 20）
 */
export const recordBoot = (store, options = {}) => {
  const env = options.env ?? process.env;
  const at = options.at ?? new Date().toISOString();
  const startup = options.startup ?? randomUUID();
  const generation = env.DSHA_WEB_GENERATION ?? null;
  const prev = (store.snapshot() ?? {}).boot ?? null;
  const boot = {
    at,
    pid: options.pid ?? process.pid,
    version: store.version,
    schema: STATS_SCHEMA,
    file: store.file,
    statsFile: options.statsFile ?? statsFile(),
    generation,
    startup,
    dsha: env.DSHA_ANDROID_RUNTIME === "1" || env.DSHA_NATIVE_PLUGIN_MANAGER === "1",
    nativePluginManager: env.DSHA_NATIVE_PLUGIN_MANAGER === "1",
    // 旧库（本版之前）没有 startup —— 宁可不写「上次」，也不臆造一条确认记录。
    previous: prev && prev.startup
      ? {
        at: prev.at ?? null,
        startup: prev.startup,
        generation: prev.generation ?? null,
        version: prev.version ?? null,
        pid: prev.pid ?? null,
      }
      : null,
  };
  // 优先走 Host Stats Service 的业务命名接口；旧 store 仍可直接运行，便于回滚。
  const publish = typeof store.publish === "function" ? store.publish : store.set;
  const append = typeof store.append === "function" ? store.append : store.push;
  if (typeof publish !== "function" || typeof append !== "function") {
    throw new TypeError("recordBoot 需要提供 publish/append 或 set/push 接口");
  }
  publish.call(store, "boot", boot);
  append.call(store, "boots", { at, startup, generation, version: boot.version, pid: boot.pid }, options.keep ?? 20);
  return boot;
};
