// 无限五代 · 第五通道 endpoint-relay 的工具注册（v0.65.7 从 index.js 抽出）
//
// 原「ig5-relay-plugin.mjs」曾在 v0.36.8 并入 index.js；本文件把它再拆出来，
// 让 index.js 只留装配与注入。对外只导出 registerRelayTools。
// 依赖的四个宿主内建（withContract / kernelText / plainOutput / safeParseJson）
// 由 index.js 在调用点通过 options 传入 —— 本模块**不反向 import index.js**，避免环。

import * as ig5RelayFs from "node:fs";
import * as ig5RelayCrypto from "node:crypto";
import * as ig5RelayOs from "node:os";
import * as ig5RelayPath from "node:path";
import * as ig5RelayUrl from "node:url";

export function registerRelayTools(ctx, options = {}) {
  // 宿主内建由调用点注入（见 index.js 的 registerRelayTools(ctx, {...})）
  const { withContract, kernelText, plainOutput, safeParseJson } = options;
  const { readFileSync, writeFileSync, mkdirSync, existsSync } = ig5RelayFs;
  const { createHash } = ig5RelayCrypto;
  const { homedir } = ig5RelayOs;
  const { join, dirname, resolve } = ig5RelayPath;
  const { pathToFileURL } = ig5RelayUrl;
// 原 ig5-relay-plugin.mjs 的模块正文 —— 无限五代「端点直连」通道的插件侧接线（第五通道 endpoint-relay）。
// 已并入 index.js：模块的 node 内建依赖改为顶部 ig5Relay* 命名空间导入，在本函数体内解构（避开 index.js 顶层同名导入）。
// 注册点仍是 index.js 里的 ctx.effect(() => { registerRelayTools(ctx); })；卸载 = 删本块 + 顶部 ig5Relay* 导入行。
// 不读改宿主的 prompts/ 与 data/，不改任何既有工具对象。
//
// 设计约束（与 lib/adapter-spec.mjs 的 endpointRelay 能力位一致）：
//   - 默认 dry-run：不带 live:true 的调用只回「将要发出的请求体」与摘要，不发网络包。
//   - 配置只从环境变量读，密钥不回显（只回 hasKey 与 host）。
//   - 单进程自足：不 import /root/ig5-adapters 的任何模块，装到别的机器上也能跑。


const ENV = {
  baseUrl: "IG5_RELAY_BASE_URL",
  apiKey: "IG5_RELAY_API_KEY",
  model: "IG5_RELAY_MODEL",
  payload: "IG5_RELAY_PAYLOAD",
  timeoutMs: "IG5_RELAY_TIMEOUT_MS",
  adaptersDir: "IG5_ADAPTERS_DIR",
  promptDir: "IG5_PROMPT_DIR",
  cache: "IG5_ADAPT_CACHE",
  ttlMs: "IG5_ADAPT_TTL_MS",
  turnInject: "IG5_ADAPT_TURN_INJECT",
  sectionOrder: "IG5_ADAPT_SECTION_ORDER",
};

/** 适配层默认根：只用来动态 import 探针/适配计划，缺目录时降级而不是抛。 */
const ADAPTERS_DEFAULT = "/root/ig5-adapters";
const PROMPT_DIR_DEFAULT = "/root/dsh-infinite-gen-5/prompts";

const DEFAULT_TIMEOUT_MS = 60000;
const HEAD_CHARS = 600;

/** 自动注入：探测结果落盘 → 组装期只读缓存（组装路径绝不发网络包）。 */
const ADAPT_CACHE_DEFAULT = () => join(homedir(), ".dsh", "ig5-adapt-cache.json");
const ADAPT_CACHE_VERSION = "ig5-adapt-cache/1";
const ADAPT_TTL_MS_DEFAULT = 6 * 60 * 60 * 1000;
const ADAPT_SECTION = "ig5-adapt:endpoint";
const ADAPT_SECTION_ORDER = 101; // 紧跟内核主段（order 100）之后、域索引（120）之前
const ADAPT_TURN_SECTION = "ig5-adapt:turn";
const ADAPT_TURN_ORDER = 103;
const ADAPT_DIRECTIVE_CAP = 1400; // 段正文硬上限：这是「端点已探明」的短说明，不是第二份内核
const ADAPT_TURN_CAP = 6000; // 逐轮注入上限，与 lib/kernel-compiler.mjs 的 standard 档同量级

function env(reader, key, fallback = "") {
  // reader 两种形态都收：函数式（宿主注入的 env 访问器）与对象式（process.env）。
  // 只认函数式的话，适配层的 IG5_ADAPT_* / IG5_RELAY_* 在这些调用点上全是死变量。
  try {
    const value = typeof reader === "function" ? reader(key) : reader?.[key];
    return value == null || value === "" ? fallback : String(value);
  } catch {
    return fallback;
  }
}

/** 只暴露主机名，绝不回显路径/密钥/query。 */
function redactHost(rawUrl) {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).host;
  } catch {
    return "<unparsable-url>";
  }
}

function readConfig(reader = process.env) {
  const baseUrl = env(reader, ENV.baseUrl).replace(/\/+$/, "");
  const apiKey = env(reader, ENV.apiKey);
  const model = env(reader, ENV.model, "MODEL_ID");
  const payloadPath = env(reader, ENV.payload);
  const timeoutMs = Number(env(reader, ENV.timeoutMs, String(DEFAULT_TIMEOUT_MS))) || DEFAULT_TIMEOUT_MS;
  return { baseUrl, apiKey, model, payloadPath, timeoutMs };
}

/**
 * 动态 import 适配层三件套（探针 / 适配计划 / 惰性章节解析）。
 * 用动态 import 而不是顶层 import：插件被拷进 dsh-infinite-gen-5 后，
 * 适配层目录可能不在（用户只想要 relay 通道）——那种情况必须降级，不能加载就爆。
 */
async function loadAdapterLibs(reader = process.env) {
  const dir = env(reader, ENV.adaptersDir, ADAPTERS_DEFAULT) || ADAPTERS_DEFAULT;
  try {
    const [probe, adapt, kernel] = await Promise.all([
      import(pathToFileURL(join(dir, "lib/endpoint-probe.mjs")).href),
      import(pathToFileURL(join(dir, "lib/dynamic-adapt.mjs")).href),
      import(pathToFileURL(join(dir, "lib/kernel-compiler.mjs")).href),
    ]);
    return { dir, probe, adapt, kernel };
  } catch (error) {
    return { dir, error: String((error && error.message) || error).slice(0, 200) };
  }
}

/** 读常驻内核与惰性章节真源；读不到回 error，由调用方按「缺真源」降级。 */
function readKernelSources(reader = process.env) {
  const dir = env(reader, ENV.promptDir, PROMPT_DIR_DEFAULT) || PROMPT_DIR_DEFAULT;
  try {
    const kernelText = readFileSync(join(dir, "infinite-gen-5.md"), "utf8");
    const lazyText = readFileSync(join(dir, "infinite-gen-5-lazy.md"), "utf8");
    return { dir, kernelText, lazyText, kernelBytes: Buffer.byteLength(kernelText, "utf8") };
  } catch (error) {
    return { dir, error: String((error && error.message) || error).slice(0, 200) };
  }
}

/** 适配计划只挑可判定的字段回显，避免把内部结构整包丢给宿主。 */
function slimPlan(plan) {
  const budget = (plan && plan.budget) || {};
  return {
    carrier: plan.carrier,
    slot: plan.slot,
    lazyMode: plan.lazyMode,
    injectLazy: plan.injectLazy,
    indexInline: plan.indexInline,
    cacheCheckpoint: plan.cacheCheckpoint,
    budgetBytes: budget.totalBytes ?? null,
    lazyBudgetBytes: budget.lazyBudgetBytes ?? null,
    confidence: plan.confidence,
    degraded: plan.degraded,
    reasons: plan.reasons,
  };
}

function slimSelection(selection) {
  return (Array.isArray(selection) ? selection : []).map((item) => ({
    id: item.id,
    bytes: item.bytes,
    matched: item.matched,
  }));
}

function chatUrl(baseUrl) {
  if (!baseUrl) return "";
  return /\/chat\/completions$/.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function loadPayload(path) {
  if (!path) return { ok: false, reason: "payload-env-unset", text: "" };
  if (!existsSync(path)) return { ok: false, reason: "payload-missing", text: "" };
  try {
    const text = readFileSync(path, "utf8");
    return { ok: true, reason: "ok", text };
  } catch (error) {
    return { ok: false, reason: `payload-unreadable: ${String((error && error.message) || error)}`, text: "" };
  }
}

function buildBody({ model, system, user, maxTokens = 1024, temperature = 0.7 }) {
  return {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature,
  };
}

async function postJson(url, { apiKey, timeoutMs }, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    // 统一解析入口（v0.36.8 并回 relay 后补齐）：坏包/半截 JSON 不抛，失败时 parsed 仍为 null，
    // 与并回前那段 try/catch 的语义一致，但全文件不再多出裸解析点。
    const parsed = safeParseJson(text, null).value;
    return { ok: res.ok, status: res.status, text, parsed };
  } catch (error) {
    const name = String((error && error.name) || "");
    return {
      ok: false,
      status: 0,
      text: "",
      parsed: null,
      reason: name === "AbortError" ? "timeout" : `transport: ${String((error && error.message) || error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function pickText(parsed) {
  try {
    return String(parsed?.choices?.[0]?.message?.content ?? "");
  } catch {
    return "";
  }
}

function summarize(reply, text) {
  return {
    ok: reply.ok,
    status: reply.status,
    ...(reply.reason ? { reason: reply.reason } : {}),
    textBytes: Buffer.byteLength(text, "utf8"),
    textChars: text.length,
    head: text.slice(0, HEAD_CHARS),
    usage: reply.parsed?.usage ?? null,
  };
}

function relayTool({ reader = process.env } = {}) {
  return {
    name: "infinite_gen5_relay",
    description:
      "把无限五代载荷直接发到 OpenAI 兼容端点（不经宿主会话模型）：status（配置体检）/ plan（dry-run，回将要发的请求体摘要）/ send（live:true 才真发一条）/ batch（多条并发，回收执）/ adapt（探真实端点能力，回适配计划与逐轮注入选择；live:true 才发探针）。默认 dry-run。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "plan", "send", "batch", "adapt", "inventory"], description: "要执行的动作" },
        prompt: { type: "string", description: "用户侧输入；省略则用内置探针句（PROBE_PROMPT）" },
        payloadPath: { type: "string", description: "载荷文件路径；省略则读 IG5_RELAY_PAYLOAD" },
        maxTokens: { type: "integer", minimum: 16, maximum: 32768, description: "max_tokens，默认 1024" },
        live: { type: "boolean", description: "true 才真发网络请求；缺省或 false 一律 dry-run" },
        padding: {
          type: "integer",
          minimum: 0,
          maximum: 200000,
          description: "adapt 用：给探针正文追加 x 的字节数，用来主动触顶看上限；默认 0（小请求摸不到上限）",
        },
        cache: {
          type: "boolean",
          description: "adapt 用：live 探针成功后是否把计划写进 ~/.dsh/ig5-adapt-cache.json 供自动注入读；默认 true",
        },
        inventory: {
          type: "string",
          description: "inventory 用：自有端点清单文件路径（先用 endpoint-inventory.mjs --emit-template 生成骨架）；密钥只写环境变量名",
        },
        cases: {
          type: "string",
          description: 'batch 用：JSON 文本 [{"id":"q001","prompt":"…"}]（扁平字符串，避免嵌套对象）',
        },
        concurrency: { type: "integer", minimum: 1, maximum: 8, description: "batch 并发，默认 2" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: plainOutput, // 宿主硬要求：缺 output.render 会让整份插件激活失败（v0.41.1 修）
    execute(args = {}) {
      return executeRelay(args, { reader });
    },
  };
}

const PROBE_PROMPT = "回一行：IG5_RELAY_OK，并给出你当前生效的输出契约首行。";

async function executeRelay(args = {}, { reader = process.env } = {}) {
  const cfg = readConfig(reader);
  const action = String(args.action ?? "").trim();
  const payloadPath = args.payloadPath ? String(args.payloadPath) : cfg.payloadPath;
  const payload = loadPayload(payloadPath);
  const base = {
    action,
    endpoint: { host: redactHost(cfg.baseUrl), model: cfg.model, hasKey: Boolean(cfg.apiKey) },
    payload: { path: payloadPath || null, ok: payload.ok, reason: payload.reason, bytes: Buffer.byteLength(payload.text, "utf8") },
  };

  if (action === "status") {
    return {
      ...base,
      ok: Boolean(cfg.baseUrl) && payload.ok,
      url: chatUrl(cfg.baseUrl) || null,
      notes: [
        cfg.baseUrl ? "" : `${ENV.baseUrl} 未设置：端点通道不可用（降级为只出请求体与判据脚本）`,
        payload.ok ? "" : `载荷不可用：${payload.reason}`,
        cfg.apiKey ? "" : `${ENV.apiKey} 未设置：匿名请求，多数端点会 401`,
      ].filter(Boolean),
    };
  }

  // adapt：探真实端点能力 → 出适配计划 → 按用户输入选要注入的惰性章节。
  // 与 send/plan 不同，本条不需要载荷文件：能力信号与载荷无关，所以不能走下面的 ready（它要求 payload.ok）。
  if (action === "adapt") {
    const live = args.live === true;
    const libs = await loadAdapterLibs(reader);
    if (libs.error) {
      return { ...base, ok: false, ready: false, reason: "adapters-missing", detail: libs.error, adaptersDir: libs.dir };
    }
    const truth = readKernelSources(reader);
    if (truth.error) {
      return { ...base, ok: false, ready: false, reason: "kernel-missing", detail: truth.error, promptDir: truth.dir };
    }
    const units = libs.kernel.parseLazyUnits(truth.lazyText);
    const kernel = { bytes: truth.kernelBytes, units: units.length };
    const userTurn = args.prompt ? String(args.prompt) : "";
    const selection = () => ({ userTurn: Boolean(userTurn), selected: userTurn ? slimSelection(libs.adapt.selectLazyUnits(userTurn, units)) : [] });

    if (!cfg.baseUrl) {
      return {
        ...base,
        payloadNeeded: false,
        ok: true,
        ready: false,
        reason: "endpoint-unset",
        live,
        kernel,
        plan: slimPlan(libs.adapt.adaptPlan({}, { kernelBytes: truth.kernelBytes })),
        inject: selection(),
        hint: `${ENV.baseUrl} 未设置：只回「未适配的默认计划」，信号全缺按通道默认走`,
      };
    }
    if (!live) {
      return {
        ...base,
        payloadNeeded: false,
        ok: true,
        ready: true,
        live: false,
        dryRun: true,
        reason: "live-required",
        kernel,
        plan: slimPlan(libs.adapt.adaptPlan({}, { kernelBytes: truth.kernelBytes })),
        inject: selection(),
      };
    }

    const probe = await libs.probe.probeEndpoint({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      timeoutMs: cfg.timeoutMs,
      padding: Math.max(0, Math.min(200000, Number(args.padding) || 0)),
    });
    const plan = slimPlan(libs.adapt.adaptPlan(probe.signals, { kernelBytes: truth.kernelBytes }));
    // 探针没成就不落盘：一份全 unknown 的缓存会让自动注入宣称「已适配」，那比没有缓存更坏。
    const cache =
      !probe.ok
        ? { ok: false, reason: "probe-failed（不写缓存：全 unknown 的计划不该被当成已适配）" }
        : args.cache === false
          ? { ok: false, reason: "cache-disabled" }
          : writeAdaptCache(reader, {
              host: redactHost(cfg.baseUrl),
              model: cfg.model || null,
              confidence: probe.confidence,
              signals: probe.signals,
              plan,
            });
    return {
      ...base,
      payloadNeeded: false,
      host: redactHost(cfg.baseUrl),
      ok: probe.ok,
      ready: true,
      live: true,
      dryRun: false,
      used: probe.used,
      confidence: probe.confidence,
      kernel,
      signals: probe.signals,
      plan,
      cache,
      inject: selection(),
      notes: probe.ok ? [] : ["探针没成：读不出的字段一律 unknown，计划按 unknown 走，不重试，不写缓存"],
    };
  }

  // inventory：跑一份「自有端点清单」。三条纪律（密钥只走环境变量 / 来源白名单 / 跨来源不许拼）
  // 写死在 endpoint-inventory.mjs 里，这里只是宿主侧入口。live:false（默认）连一个包都不发。
  if (action === "inventory") {
    const live = args.live === true;
    const libs = await loadAdapterLibs(reader);
    if (libs.error) {
      return { ...base, ok: false, ready: false, reason: "adapters-missing", detail: libs.error, adaptersDir: libs.dir };
    }
    let inv;
    try {
      inv = await import(pathToFileURL(join(libs.dir, "endpoint-inventory.mjs")).href);
    } catch (error) {
      return { ...base, ok: false, ready: false, reason: "inventory-missing", detail: String((error && error.message) || error).slice(0, 200), adaptersDir: libs.dir };
    }
    if (!args.inventory) {
      return {
        ...base,
        payloadNeeded: false,
        ok: false,
        ready: false,
        reason: "inventory-unset",
        hint: "给 inventory 参数一个清单文件路径；没有清单就先跑 `${libs.dir}/endpoint-inventory.mjs --emit-template` 生成骨架",
      };
    }
    const inventoryPath = resolve(String(args.inventory));
    let text;
    try {
      text = readFileSync(inventoryPath, "utf8");
    } catch (error) {
      return { ...base, payloadNeeded: false, ok: false, ready: false, reason: "inventory-unreadable", detail: String((error && error.code) || error.message), inventoryPath };
    }
    const loaded = inv.loadInventory(text);
    if (!loaded.ok) {
      return { ...base, payloadNeeded: false, ok: false, ready: false, reason: "inventory-invalid", detail: loaded.reason, inventoryPath };
    }
    const rejected = loaded.rejected.map((r) => r.reason);
    const counts = {
      entries: loaded.entries.length + loaded.rejected.length,
      planned: loaded.entries.filter((e) => !e.skip).length,
      skipped: loaded.entries.filter((e) => e.skip).length,
      rejected: loaded.rejected.length,
    };
    if (!live) {
      return {
        ...base,
        payloadNeeded: false,
        ok: true,
        ready: loaded.entries.length > 0,
        live: false,
        dryRun: true,
        reason: "live-required",
        inventoryPath,
        counts,
        rejected,
        planned: loaded.entries.filter((e) => !e.skip).map((e) => ({ id: e.id, host: redactHost(e.baseUrl), provenance: e.provenance, hasKey: Boolean(e.keyEnv && reader[e.keyEnv]) })),
        notes: rejected.length ? ["被拒条目一律不发包；原因见 rejected"] : [],
      };
    }
    const run = await inv.runInventory({
      entries: loaded.entries,
      timeoutMs: cfg.timeoutMs,
      padding: Math.max(0, Math.min(200000, Number(args.padding) || 0)),
    });
    const rendered = inv.renderInventoryReport(run, { rejected: loaded.rejected });
    const REPORT_CAP = 4000;
    return {
      ...base,
      payloadNeeded: false,
      ok: run.rows.every((r) => !r.error),
      ready: true,
      live: true,
      dryRun: false,
      inventoryPath,
      counts,
      rejected,
      stitchable: run.stitchable,
      stitchReason: run.stitchReason,
      rows: run.rows.map((r) => ({
        id: r.id,
        // 巡检器自己已经算好了脱敏主机名（host）与扁平的 plan.budgetBytes；别再从这里拆一遍。
        host: r.host ?? redactHost(r.baseUrl),
        provenance: r.provenance,
        skipped: Boolean(r.skipped),
        ok: r.ok,
        hasKey: Boolean(r.hasKey),
        carrier: r.plan ? r.plan.carrier : null,
        slot: r.plan ? r.plan.slot : null,
        budgetBytes: r.plan ? r.plan.budgetBytes ?? null : null,
        confidence: r.confidence ?? null,
        probesUsed: r.probesUsed ?? 0,
        ms: r.ms ?? null,
        error: r.error ?? null,
      })),
      report: rendered.length > REPORT_CAP ? `${rendered.slice(0, REPORT_CAP)}\n…（报告已截断，全文见 runs/inventory-*.md）` : rendered,
      notes: ["报告可直接落盘：同一份清单用 endpoint-inventory.mjs --inventory <path> --out runs/ 会写 md + json"],
    };
  }

  const body = buildBody({
    model: cfg.model,
    system: payload.ok ? payload.text : "",
    user: args.prompt ? String(args.prompt) : PROBE_PROMPT,
    maxTokens: Number(args.maxTokens) || 1024,
  });
  const bodySha = sha256Hex(JSON.stringify(body)) ?? "<crypto-unavailable>";
  const plan = {
    ...base,
    dryRun: args.live !== true,
    requestUrl: chatUrl(cfg.baseUrl) || null,
    requestBodySha256: bodySha,
    requestBytes: Buffer.byteLength(JSON.stringify(body), "utf8"),
    messages: body.messages.length,
    systemBytes: Buffer.byteLength(body.messages[0].content, "utf8"),
    userChars: body.messages[1].content.length,
  };

  // ok = 「这次调用做成了没有」；ready = 「配置齐不齐、真人发能不能成」。两者必须分开：
  // dry-run 的语义是「把请求体备好了」，端点没配属于 ready:false 的警告，不是 dry-run 失败。
  const dryRun = args.live !== true;
  const ready = Boolean(cfg.baseUrl) && payload.ok;
  const notReady = { ready: false, reason: !cfg.baseUrl ? "endpoint-unset" : payload.reason };

  if (action === "plan") return { ...plan, ok: plan.requestBytes > 0, ready, ...(ready ? {} : notReady) };

  if (dryRun) {
    return { ...plan, dryRun: true, ok: true, ready, ...(ready ? {} : notReady) };
  }
  if (!ready) return { ...plan, dryRun: false, ok: false, ...notReady };

  if (action === "send") {
    const reply = await postJson(chatUrl(cfg.baseUrl), cfg, body);
    return { ...plan, ok: reply.ok, dryRun: false, ...summarize(reply, pickText(reply.parsed)) };
  }

  if (action === "batch") {
    // 统一解析入口：坏包不抛；失败时保持原语义回 cases-not-json，detail 换成解析原因。
    const casesParsed = safeParseJson(String(args.cases ?? "[]"), null);
    if (!casesParsed.ok) {
      return { ...plan, ok: false, reason: "cases-not-json", detail: String(casesParsed.reason || "").slice(0, 160) };
    }
    const list = casesParsed.value;
    const items = (Array.isArray(list) ? list : []).slice(0, 64);
    const concurrency = Math.max(1, Math.min(8, Number(args.concurrency) || 2));
    const receipts = [];
    for (let i = 0; i < items.length; i += concurrency) {
      const slice = items.slice(i, i + concurrency);
      const done = await Promise.all(
        slice.map(async (item) => {
          const one = buildBody({
            model: cfg.model,
            system: payload.text,
            user: String(item?.prompt ?? ""),
            maxTokens: Number(args.maxTokens) || 1024,
          });
          const reply = await postJson(chatUrl(cfg.baseUrl), cfg, one);
          const text = pickText(reply.parsed);
          return {
            id: String(item?.id ?? `case-${receipts.length + 1}`),
            ok: reply.ok,
            status: reply.status,
            ...(reply.reason ? { reason: reply.reason } : {}),
            textBytes: Buffer.byteLength(text, "utf8"),
            textSha256: sha256Hex(text) ?? "<crypto-unavailable>",
            head: text.slice(0, 160),
          };
        }),
      );
      receipts.push(...done);
    }
    return {
      ...plan,
      ok: receipts.every((r) => r.ok),
      dryRun: false,
      cases: receipts.length,
      delivered: receipts.filter((r) => r.ok).length,
      receipts,
    };
  }

  return { ...base, ok: false, reason: `unknown-action: ${action}`, hint: "可用：status / plan / send / batch" };
}

// ── 技能装载链接（可选，默认不写盘）────────────────────────────────────────────
// 把 build-skills.mjs 的产物（ig5-layer-01/SKILL.md + ig5-chain.md）装进宿主的技能扫描根。
// 只做复制与点名，不在插件里重算切分 —— 切分口径只有 build-skills.mjs 一处，避免两套真相。
const SKILL_ID = "ig5-layer-01";
const SKILLS_SRC_DEFAULT = "/root/ig5-adapters/dist/skills";

function skillRoots(cwd) {
  return [
    { id: "project-dsh", path: `${cwd}/.dsh/skills` },
    { id: "project-agents", path: `${cwd}/.agents/skills` },
    { id: "home-dsh", path: `${homedir()}/.dsh/skills` },
    { id: "home-agents", path: `${homedir()}/.agents/skills` },
  ];
}

function scanRoots(cwd) {
  return skillRoots(cwd).map((root) => {
    const skillFile = `${root.path}/${SKILL_ID}/SKILL.md`;
    const present = existsSync(skillFile);
    return {
      id: root.id,
      path: root.path,
      rootExists: existsSync(root.path),
      skillInstalled: present,
      skillBytes: present ? Buffer.byteLength(readFileSync(skillFile, "utf8"), "utf8") : 0,
    };
  });
}

function skillsTool({ cwd = process.cwd(), reader = process.env } = {}) {
  return {
    name: "infinite_gen5_skills",
    description:
      "无限五代技能层的装载与体检：status（探四个技能扫描根，看 ig5-layer-01 装了没）/ install（把 dist/skills 装进指定根；不带 apply:true 一律 dry-run）。切分口径不在本工具，在 ig5-adapters/build-skills.mjs。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "install"], description: "要执行的动作" },
        root: { type: "string", description: "install 的目标技能根；省略则用第一个已存在的扫描根" },
        source: { type: "string", description: `产物目录；省略则读 IG5_SKILLS_SRC，再退回 ${SKILLS_SRC_DEFAULT}` },
        apply: { type: "boolean", description: "true 才真写盘；缺省一律 dry-run" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: plainOutput, // 同上：skills 工具也必须声明 output（v0.41.1 修）
    execute(args = {}) {
      const action = String(args.action ?? "").trim();
      const roots = scanRoots(cwd);
      if (action === "status") {
        return {
          action,
          ok: roots.some((r) => r.skillInstalled),
          skillId: SKILL_ID,
          roots,
          installedIn: roots.filter((r) => r.skillInstalled).map((r) => r.id),
          note: "宿主可通过自定义技能目录加载；本工具只看得见上面四个根，自定义根不在视野内不算没装。",
        };
      }
      if (action !== "install") return { action, ok: false, reason: `unknown-action: ${action}`, hint: "可用：status / install" };
      const source = args.source ? String(args.source) : env(reader, "IG5_SKILLS_SRC", SKILLS_SRC_DEFAULT);
      const target = args.root ? String(args.root) : roots.find((r) => r.rootExists)?.path ?? "";
      const skillSrc = `${source}/${SKILL_ID}/SKILL.md`;
      const chainSrc = `${source}/ig5-chain.md`;
      const files = [
        { from: skillSrc, to: `${target}/${SKILL_ID}/SKILL.md` },
        { from: chainSrc, to: `${target}/ig5-chain.md` },
      ];
      const missing = files.filter((f) => !existsSync(f.from)).map((f) => f.from);
      const plan = {
        action,
        dryRun: args.apply !== true,
        source,
        target: target || null,
        files: files.map((f) => ({ from: f.from, to: f.to, sourceExists: existsSync(f.from) })),
        rollback: target ? [`rm -rf "${target}/${SKILL_ID}"`, `rm -f "${target}/ig5-chain.md"`] : [],
      };
      if (!target) return { ...plan, ok: false, reason: "no-target-root", hint: "四个扫描根都不存在，显式传 root: <dir> 指定" };
      if (missing.length) return { ...plan, ok: false, reason: "source-missing", missing };
      if (args.apply !== true) return { ...plan, ok: true, ready: true, reason: "dry-run（加 apply:true 才写盘）" };
      try {
        mkdirSync(`${target}/${SKILL_ID}`, { recursive: true });
        for (const f of files) writeFileSync(f.to, readFileSync(f.from));
      } catch (error) {
        return { ...plan, ok: false, reason: `write-failed: ${String((error && error.message) || error)}` };
      }
      return { ...plan, ok: true, dryRun: false, written: files.map((f) => f.to), rescan: scanRoots(cwd) };
    },
  };
}

// ── 自动注入：探测结果落盘，组装期只读缓存 ─────────────────────────────────
// 为什么不让组装路径自己探：组装每轮都跑，探针要发网络包、要等超时；
// 而且「这一轮该用什么载体」是会话级结论，不是每轮结论。所以 adapt(live) 写，注入读。

/** 缓存路径：环境变量优先，默认 ~/.dsh/ig5-adapt-cache.json。 */
function adaptCachePath(reader = process.env) {
  return env(reader, ENV.cache, "") || ADAPT_CACHE_DEFAULT();
}

/** 把一次 live 探测结果落盘。写失败照实回 ok:false，不假装写成功。 */
function writeAdaptCache(reader, payload, now = Date.now()) {
  const path = adaptCachePath(reader);
  const record = { version: ADAPT_CACHE_VERSION, at: now, ...payload };
  try {
    mkdirSync(dirname(path), { recursive: true });
    const text = `${JSON.stringify(record, null, 1)}\n`;
    writeFileSync(path, text, "utf8");
    return { ok: true, path, at: record.at, bytes: Buffer.byteLength(text, "utf8") };
  } catch (error) {
    return { ok: false, path, reason: String((error && error.message) || error) };
  }
}

/** 读缓存：过期不删也不假装新鲜，照实回 stale，由渲染侧在正文里标注。 */
function readAdaptCache(reader = process.env, now = Date.now()) {
  const path = adaptCachePath(reader);
  if (!existsSync(path)) return { ok: false, path, reason: "no-cache" };
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return { ok: false, path, reason: `cache-unreadable: ${String((error && error.message) || error)}` };
  }
  // 统一解析入口：缓存文件可能是半截写入的 JSON，坏包不抛，理由仍归到 cache-unreadable。
  const cacheParsed = safeParseJson(raw, null);
  if (!cacheParsed.ok) {
    return { ok: false, path, reason: `cache-unreadable: ${String(cacheParsed.reason || "empty")}` };
  }
  const record = cacheParsed.value;
  if (!record || record.version !== ADAPT_CACHE_VERSION || !record.plan) {
    return { ok: false, path, reason: "cache-shape" };
  }
  const ttlMs = Math.max(0, Number(env(reader, ENV.ttlMs, "")) || ADAPT_TTL_MS_DEFAULT);
  const at = Number(record.at) || 0;
  const ageMs = at ? Math.max(0, now - at) : Number.MAX_SAFE_INTEGER;
  return {
    ok: true,
    path,
    at,
    ageMs,
    ttlMs,
    fresh: ageMs <= ttlMs,
    stale: ageMs > ttlMs,
    plan: record.plan,
    signals: record.signals ?? null,
    confidence: record.confidence ?? "unknown",
    host: record.host ?? null,
  };
}

function hours(ms) {
  return `${(ms / 3600000).toFixed(1)}h`;
}

/** 计划 → 一段给人（也给模型）看的纪律文本；超上限就截断并标注。 */
function renderAdaptDirective(entry) {
  const plan = entry.plan ?? {};
  const signals = entry.signals ?? {};
  const unknown = [];
  if (!signals.systemRole || signals.systemRole === "unknown") unknown.push("system 段是否被接受");
  if (!(Number(signals.contextWindow) > 0)) unknown.push("上下文窗口");
  if (!signals.usageReported) unknown.push("usage 回执");
  const where = plan.carrier === "inline" ? "首条 user 消息尾部（端点不收 system，内核并入用户消息）" : "system 段";
  const tick = entry.stale
    ? `过期：下面是 ${hours(entry.ageMs)} 前的测量（TTL ${hours(entry.ttlMs)}），重跑 adapt 刷新`
    : `测量于 ${hours(entry.ageMs)} 前（TTL ${hours(entry.ttlMs)}，未过期）`;
  const lines = [
    `【端点适配 · 本会话】${tick}`,
    `- 载体：${plan.carrier ?? "system"} → 落在${where}；槽位：${plan.slot ?? "LAST"}；惰性档：${plan.lazyMode ?? "standard"}；预算：${plan.budgetBytes ?? "通道默认"} B`,
    `- 依据：systemRole=${signals.systemRole ?? "unknown"} · contextWindow=${signals.contextWindow ?? "unknown"} · usage=${signals.usageReported ? "有" : "无"}${entry.host ? ` · host=${entry.host}` : ""}（置信度 ${entry.confidence}）`,
    `- 未探明：${unknown.length ? unknown.join("、") : "无（探针读全了）"}；读不出的字段一律按 unknown 走，不猜`,
    "- 纪律：不让位的内核不注入第二遍；探针失败不重试；探到 accepted 只说明端点收 system，不等于末位锚点生效（那要宿主的 assemble 瀑布）",
  ];
  let text = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(text, "utf8") > ADAPT_DIRECTIVE_CAP) {
    const room = Math.max(0, ADAPT_DIRECTIVE_CAP - 40);
    text = `${Buffer.from(text, "utf8").subarray(0, room).toString("utf8")}\n…（已达 ${ADAPT_DIRECTIVE_CAP} B 上限，截断）\n`;
  }
  return text;
}

/** 宿主每轮回调可能给 string，也可能给对象；四种形态都试，取不到就回空串。 */
function turnText(turn) {
  if (!turn) return "";
  if (typeof turn === "string") return turn;
  const candidates = [turn.text, turn.userText, turn.content, turn.message?.text, turn.message?.content];
  for (const value of candidates) {
    if (typeof value === "string" && value) return value;
  }
  return "";
}

/** 逐轮注入：只认触发词字面命中（与 lib/dynamic-adapt.mjs 同口径，不做语义相似度）。 */
function renderTurnInject(turn, { units = [], plan = {}, cap = ADAPT_TURN_CAP } = {}) {
  const text = turnText(turn);
  if (!text || !units.length) return "";
  const matched = units.filter((unit) => (unit.triggers ?? []).some((trigger) => text.includes(trigger)));
  if (!matched.length) return "";
  const head = `<!-- ig5 动态注入（触发词命中 ${matched.map((u) => u.id).join("、")}）-->\n`;
  const parts = [head];
  let used = Buffer.byteLength(head, "utf8");
  const budget = Math.min(cap, Number(plan.lazyBudgetBytes) > 0 ? Number(plan.lazyBudgetBytes) : cap);
  const skipped = [];
  for (const unit of matched) {
    const body = `${unit.body ?? ""}\n`;
    const size = Buffer.byteLength(body, "utf8");
    if (used + size > budget) {
      skipped.push(unit.id);
      continue;
    }
    parts.push(body);
    used += size;
  }
  if (skipped.length) parts.push(`<!-- 预算 ${budget} B 装不下：${skipped.join("、")} 见 prompts/infinite-gen-5-lazy.md -->\n`);
  return parts.join("");
}

/**
 * 宿主侧自动注入接线：有缓存才注册系统提示段；逐轮注入要显式开 IG5_ADAPT_TURN_INJECT=1。
 * 任何一步不可用只记 skipped，不抛 —— 自动注入挂了不能把宿主 apply 带崩。
 */
async function registerAdaptiveInjection(ctx, options = {}) {
  const reader = options.reader ?? process.env;
  const info = { section: null, turn: null, skipped: [] };
  const skip = (reason) => {
    info.skipped.push(reason);
    return { registered: false, reason, ...info };
  };

  if (!ctx?.systemPrompt || typeof ctx.systemPrompt.section !== "function") {
    return skip("no-systemPrompt-section");
  }
  const entry = readAdaptCache(reader, options.now ? options.now() : Date.now());
  info.cache = entry.ok
    ? { path: entry.path, ageMs: entry.ageMs, fresh: entry.fresh, stale: entry.stale }
    : { path: entry.path, reason: entry.reason };
  if (!entry.ok) return skip(`cache:${entry.reason}`);

  const order = Number(env(reader, ENV.sectionOrder, "")) || ADAPT_SECTION_ORDER;
  const spec = { name: ADAPT_SECTION, order, text: renderAdaptDirective(entry) };
  try {
    ctx.effect(() => ctx.systemPrompt.section(spec));
    info.section = { name: ADAPT_SECTION, order, chars: spec.text.length };
  } catch (error) {
    info.skipped.push(`section: ${String((error && error.message) || error)}`);
  }

  if (env(reader, ENV.turnInject, "") !== "1") {
    info.skipped.push("turn-inject:off（默认关：内核插件自己已有惰性章节，两边同开=双注入）");
    return { registered: Boolean(info.section), reason: "section-only", ...info };
  }
  if (typeof ctx.systemPrompt.context !== "function") {
    return { registered: Boolean(info.section), reason: "no-systemPrompt-context", ...info };
  }
  const libs = await loadAdapterLibs(reader);
  if (libs.error) return { registered: Boolean(info.section), reason: "adapters-missing", detail: libs.error, ...info };
  const truth = readKernelSources(reader);
  if (truth.error) return { registered: Boolean(info.section), reason: "kernel-missing", detail: truth.error, ...info };

  const units = libs.kernel.parseLazyUnits(truth.lazyText);
  const turnSpec = {
    name: ADAPT_TURN_SECTION,
    order: ADAPT_TURN_ORDER,
    text: (turn) => renderTurnInject(turn, { units, plan: entry.plan }),
  };
  try {
    ctx.effect(() => ctx.systemPrompt.context(turnSpec));
    info.turn = { name: ADAPT_TURN_SECTION, order: ADAPT_TURN_ORDER, units: units.length };
  } catch (error) {
    info.skipped.push(`turn: ${String((error && error.message) || error)}`);
  }
  return { registered: Boolean(info.section || info.turn), reason: "adaptive", ...info };
}

/** 宿主侧接线：DSH 的 apply(ctx) 里调一次。注册端点通道 + 技能装载链 + 自动注入。 */
function installRelayTools(ctx, options = {}) {
  const tools = [relayTool(options), skillsTool(options)];
  ctx.effect(() => {
    for (const tool of tools) ctx.tools.register(withContract(tool));
  });
  const adaptive =
    options.adaptive === false
      ? Promise.resolve({ registered: false, reason: "adaptive-disabled" })
      : registerAdaptiveInjection(ctx, options).catch((error) => ({
          registered: false,
          reason: `adaptive-threw: ${String((error && error.message) || error)}`,
        }));
  return { registered: tools.map((t) => t.name), adaptive };
}

return installRelayTools(ctx, options);
}
