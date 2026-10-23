// 无限五代 · 注入策略唯一真源（v0.66.0）
//
// 为什么有这个模块：内核注入原本是「多处各自拼字符串」—— boost / lazy / kernel /
// budget / override / tail / runtime-anchor 分散在若干个 assemble handler 里，各自
// 改 `sections`。多个写入者带来四类不可证的问题：同一动态单元被追加两次、后跑的预算器
// 覆盖前面刚做出的选择、面板知道「注入了什么」但不知道「为什么注入」、调参重建后难以
// 证明旧 handler 真的卸载了。
//
// 这里把决策收成一条链：
//
//      TurnFacts  ──►  InjectionUnit[]  ──►  planInjection()  ──►  { selected, dropped, ledger, fingerprint }
//      （本轮事实快照）   （每个单元自带元数据）    （筛选/去重/冲突/TTL/预算）        （一个 assemble mutator 消费）
//
// 四条硬约束（改这个文件前先读）：
//   1) 一个事实快照：一轮只认一份 TurnFacts —— 纯数据、冻结、可序列化，本模块不读全局状态。
//   2) 一个计划器：所有动态单元先过 planInjection()，不在别处判「该不该注入」。
//   3) 一个装配修改者：计划算完，只允许一个 mutator 按计划改 sections。
//   4) 一个审计结果：每个单元都有 selected|dropped + reason + bytes + ttl，面板读它、不重算。
//
// 只允许「整单元丢弃」：预算不足时丢的是整个单元，绝不把一个单元截成半句话。
// 纯函数，无 IO、无 fs、无 crypto（fingerprint 走 FNV-1a / 32bit，跨进程稳定）。
//
// 自检：node data/injection-policy.mjs    →  INJECTION_POLICY_OK <bytes>

// ── 五类通道 ────────────────────────────────────────────────────────────────
// channel 不是 order：order 决定「排在哪」，channel 决定「谁来写、能不能被预算抢」。
// 同一轮里 channel 也定下 mutator 的写入次序：先段、再上下文、最后尾。
export const CHANNELS = Object.freeze(["section", "context", "tail"]);
export const CHANNEL_ORDER = Object.freeze({ section: 10, context: 20, tail: 30 });

// ── 五种作用域 / 失效条件 ────────────────────────────────────────────────────
// scope 说「这东西属于谁」，ttl 说「什么时候失效」—— 两个都写，别只写一个：
// scope=session + ttl=turn 是「换会话才失效，但每轮都允许重发」这种真实组合。
export const SCOPES = Object.freeze(["session", "turn", "step", "event", "assemble"]);
export const TTL = Object.freeze(["session", "turn", "step", "event", "message", "once"]);

// 可失效的 ttl（"message" 与 "once" 的失效点都在「下一条真实用户消息 / 成功装配一次」，
// 由宿主侧的 TTL 台账记账；本模块只按台账里记的 turn/step 判「这一轮还能不能再进」）。
const TTL_CARRIES = new Set(["once"]);

// ── 配额账本：五个分区 ──────────────────────────────────────────────────────
// 总量裁剪（只看总字节）会在同一轮里把该留的挤掉：一个超长的领域包能把批量合同顶出去。
// 分区之后每类各有上限，抢也只在自己那一格里抢。
export const CATEGORIES = Object.freeze([
  "baseline",   // 首句层 / 内核 / 中段锚点 / 末位锚点 —— 不可被抢占
  "task",       // 当前任务态与阶段判据
  "domain",     // 领域包 / 增强集 / 惰性章节 —— 可竞争
  "batch",      // 批量交付合同与批量锚点 —— 预留
  "context",    // 运行时上下文 / 事件信号
]);

// 预算不足时的丢弃顺序（从先丢到后丢）。没列进来的类别按 priority 兜底排序。
export const DROP_ORDER = Object.freeze(["domain", "batch", "task", "context", "baseline", "tail"]);

// 不可裁剪的四样。写死在这里，不是「看情况」—— 首句层没了内核就是没有正文的孤令，
// 末位锚点没了整份载荷的末位语义就没了。
export const NEVER_DROPPED = Object.freeze(["baseline", "tail"]);

export const LEDGER_DEFAULTS = Object.freeze({
  ceiling: 262144,            // 窗口大小；0 = 不设限（只量不改）
  baselineBytes: 0,           // 0 = 由计划按 protected 单元现算
  dynamicMaxBytes: 12000,     // 领域 / 增强 / 惰性 合计上限
  contextMaxBytes: 2400,      // 运行时上下文 + 事件信号合计上限
  taskMaxBytes: 1800,
  batchMaxBytes: 4096,
  maxUnitsPerTurn: 12,
  maxUnitsPerChannel: Object.freeze({ section: 8, context: 6, tail: 2 }),
});

export const PROFILE_VALUES = Object.freeze({
  minimal: Object.freeze({ dynamicMaxBytes: 6000, contextMaxBytes: 1600, maxUnitsPerTurn: 6, minTriggerConfidence: 0.85, tail: false }),
  balanced: Object.freeze({ dynamicMaxBytes: 12000, contextMaxBytes: 2400, maxUnitsPerTurn: 12, minTriggerConfidence: 0.6, tail: true }),
  full: Object.freeze({ dynamicMaxBytes: 16000, contextMaxBytes: 3200, maxUnitsPerTurn: 20, minTriggerConfidence: 0.4, tail: true }),
});

export const clampNumber = (value, low, high) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return low;
  return Math.min(high, Math.max(low, n));
};

/** 把字符串按「整单元」折算字节数：UTF-8 口径，与最终拼接长度一致。 */
export const bytesOf = (text) => Buffer.byteLength(String(text ?? ""), "utf8");

/** FNV-1a 32bit：跨进程稳定，不依赖 crypto，模块可在浏览器/离线脚本里同源使用。 */
export const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  const source = String(text ?? "");
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

/** 正文摘要（只留 digest，不留原文）：面板与统计库要的是「这段有多大、是不是它」，不是原文。 */
export const digestOf = (text) => fnv1a(String(text ?? "")).toString(16).padStart(8, "0");

// ── 事实快照 ────────────────────────────────────────────────────────────────
// 一轮只认一份。冻结是刻意的：assemble 期间若还有别处能改它，计划就不再可复现。
export const snapshotFacts = (input = {}) => Object.freeze({
  turn: Number(input.turn) || 0,
  step: Number(input.step) || 0,
  userText: String(input.userText ?? ""),
  sessionId: input.sessionId ?? null,
  batch: input.batch ? Object.freeze({ ...input.batch }) : null,
  taskState: input.taskState ? Object.freeze({ ...input.taskState }) : null,
  compacted: Boolean(input.compacted),
  rearm: Boolean(input.rearm),
  lastEventKind: input.lastEventKind ?? null,
  configRevision: Number(input.configRevision) || 0,
  revision: Number(input.revision) || 0,
  marks: input.marks && typeof input.marks === "object" ? input.marks : null,
});

// ── TTL 台账 ────────────────────────────────────────────────────────────────
// 「上一轮内容残留到下一轮」是动态注入最容易出的一类错。台账只记一件事：
// 某个单元最后一次真的进了装配，是在哪一个 turn / step。计划器据此判 once / message。
export const createTtlLedger = () => {
  const marks = Object.create(null);
  return {
    /** 读标记：{ turn, step, at } 或 undefined（从没进过）。 */
    get(id) {
      return marks[id];
    },
    /** 全量快照（进事实快照用；只读副本，外部改不动内部）。 */
    snapshot() {
      return { ...marks };
    },
    /** 计划被真的消费之后记账 —— 只记「进了装配」的单元，被丢弃的不记。 */
    commit(plan, { turn, step } = {}) {
      const at = Date.now();
      for (const row of plan?.selected ?? []) {
        marks[row.id] = { turn: Number(turn) || 0, step: Number(step) || 0, ttl: row.ttl ?? "turn", at };
      }
      return marks;
    },
    /** 换会话 / 换配置时清空：残留标记比不记账更坏（会静默吞掉本该注入的一段）。 */
    clear() {
      for (const key of Object.keys(marks)) delete marks[key];
    },
    get size() {
      return Object.keys(marks).length;
    },
  };
};

// ── 计划器主体 ──────────────────────────────────────────────────────────────
const textOf = (unit, facts) => {
  if (typeof unit.render === "function") return String(unit.render(facts) ?? "");
  return String(unit.text ?? "");
};

const matchOf = (unit, facts) => {
  if (typeof unit.when === "function") return Boolean(unit.when(facts));
  return unit.enabled !== false;
};

const confidenceOf = (unit) => {
  const raw = unit.confidence;
  if (raw === undefined || raw === null) return 1; // 没声明 = 无条件可信（基线类）
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
};

const categoryOf = (unit) => {
  if (unit.category && CATEGORIES.includes(unit.category)) return unit.category;
  if (unit.protected === true) return "baseline";
  if (unit.channel === "tail") return "tail";
  if (unit.channel === "context") return "context";
  return "domain";
};

/** 稳定排序：priority 高的先留 → channel（段/上下文/尾）→ order → id（localeCompare 兜底）。 */
export const sortUnits = (a, b) =>
  Number(b.priority ?? 0) - Number(a.priority ?? 0) ||
  (a.channelOrder ?? CHANNEL_ORDER[a.channel] ?? 99) - (b.channelOrder ?? CHANNEL_ORDER[b.channel] ?? 99) ||
  Number(a.order ?? 0) - Number(b.order ?? 0) ||
  String(a.id).localeCompare(String(b.id));

/** 预算不足时的丢弃次序：先按 DROP_ORDER 类别，再按 priority 升序（低优先先走）。 */
export const sortDropCandidates = (a, b) => {
  const ai = DROP_ORDER.indexOf(a.category);
  const bi = DROP_ORDER.indexOf(b.category);
  return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) ||
    Number(a.priority ?? 0) - Number(b.priority ?? 0) ||
    Number(b.bytes ?? 0) - Number(a.bytes ?? 0) ||
    String(a.id).localeCompare(String(b.id));
};

/**
 * 出计划。纯函数：同样的 facts + units + options 必得同样的 selected/dropped/fingerprint。
 *
 * 管线次序（每一步都能单独解释「为什么它不在这里」）：
 *   ① 形状校验 → ② 触发条件 → ③ 依赖在场 → ④ 重复 id → ⑤ 条件互斥 → ⑥ TTL 台账 →
 *   ⑦ 最小置信度 → ⑧ 空渲染 → ⑨ 单元数上限（每轮 / 每通道）→ ⑩ 分区配额账本（整单元丢弃）
 */
export const planInjection = (facts, units, options = {}) => {
  const ledgerQuota = { ...LEDGER_DEFAULTS, ...(options.ledger ?? {}) };
  const minConfidence = clampNumber(options.minTriggerConfidence ?? 0.6, 0, 1);
  const ttlMarks = facts?.marks ?? null;
  const selected = [];
  const dropped = [];
  const seen = new Set();
  const presentIds = new Set();
  for (const unit of Array.isArray(units) ? units : []) {
    if (unit && unit.id) presentIds.add(unit.id);
  }
  const drop = (row) => {
    dropped.push(row);
    return row;
  };

  // ①–⑧：逐个单元判定，全部带原因。
  for (const unit of Array.isArray(units) ? units : []) {
    if (!unit || typeof unit !== "object" || !unit.id) {
      drop({ id: unit?.id ?? "<missing-id>", reason: "invalid-unit" });
      continue;
    }
    if (CHANNELS.indexOf(unit.channel) < 0) {
      drop({ id: unit.id, reason: "invalid-channel", detail: String(unit.channel) });
      continue;
    }

    let matched = false;
    try {
      matched = matchOf(unit, facts);
    } catch (error) {
      drop({ id: unit.id, reason: "predicate-error", detail: String(error?.message ?? error) });
      continue;
    }
    if (!matched) {
      drop({ id: unit.id, reason: "predicate-false" });
      continue;
    }

    // 依赖：核心内核不在场时，引用它的条款不该单独出现（脱离内核就是半套规则）。
    const deps = Array.isArray(unit.dependsOn) ? unit.dependsOn : [];
    const missingDep = deps.find((dep) => !presentIds.has(dep));
    if (missingDep) {
      drop({ id: unit.id, reason: "dependency-missing", detail: String(missingDep) });
      continue;
    }

    if (seen.has(unit.id)) {
      drop({ id: unit.id, reason: "duplicate-id" });
      continue;
    }
    seen.add(unit.id);

    const category = categoryOf(unit);
    const ttl = TTL.includes(unit.ttl) ? unit.ttl : "turn";
    const scope = SCOPES.includes(unit.scope) ? unit.scope : "turn";
    const confidence = confidenceOf(unit);
    const priority = Number(unit.priority ?? 0);

    // 条件互斥：同一轮里两条冲突的规则（如两个批量方案）只允许 priority 高的那条在场。
    const conflictId = (Array.isArray(unit.conflictsWith) ? unit.conflictsWith : [])
      .find((other) => selected.some((row) => row.id === other));
    if (conflictId) {
      drop({ id: unit.id, reason: "conflict", detail: String(conflictId) });
      continue;
    }

    // TTL：once / message 档靠台账判「本轮还能不能进」；其余档靠 when 自己表达（facade 在 index.js）。
    const mark = ttlMarks && typeof ttlMarks === "object" ? ttlMarks[unit.id] : undefined;
    if (TTL_CARRIES.has(ttl) && mark && Number(mark.turn) >= facts.turn && facts.turn > 0) {
      drop({ id: unit.id, reason: "ttl-spent", detail: `${ttl}@turn ${mark.turn}` });
      continue;
    }

    if (confidence < minConfidence) {
      drop({ id: unit.id, reason: "low-confidence", confidence, min: minConfidence });
      continue;
    }

    let text = "";
    try {
      text = textOf(unit, facts);
    } catch (error) {
      drop({ id: unit.id, reason: "render-error", detail: String(error?.message ?? error) });
      continue;
    }
    if (!text.trim()) {
      drop({ id: unit.id, reason: "empty-render" });
      continue;
    }

    selected.push({
      id: unit.id,
      channel: unit.channel,
      channelOrder: CHANNEL_ORDER[unit.channel],
      category,
      order: Number.isFinite(Number(unit.order)) ? Number(unit.order) : null,
      priority,
      scope,
      ttl,
      confidence,
      protected: unit.protected === true,
      reason: unit.reason ?? null,
      source: unit.source ?? null,
      text,
      bytes: bytesOf(text),
      digest: digestOf(text),
    });
  }

  // ⑨ 单元数上限：先按通道内限额削（低优先先走），再削总量。被削的都是整单元。
  selected.sort(sortUnits);
  const perChannel = { ...LEDGER_DEFAULTS.maxUnitsPerChannel, ...(ledgerQuota.maxUnitsPerChannel ?? {}) };
  const channelCount = { section: 0, context: 0, tail: 0 };
  const overUnits = new Set();
  for (const row of selected) {
    channelCount[row.channel] += 1;
    const cap = Number(perChannel[row.channel] ?? Infinity);
    if (channelCount[row.channel] > cap) overUnits.add(row.id);
  }
  const survivorsA = [];
  for (const row of selected) {
    if (overUnits.has(row.id)) {
      drop({ id: row.id, reason: "channel-unit-cap", cap: perChannel[row.channel] ?? null, category: row.category });
      continue;
    }
    survivorsA.push(row);
  }
  const maxUnits = Number(ledgerQuota.maxUnitsPerTurn) || 0;
  const survivorsB = [];
  for (const row of survivorsA) {
    if (maxUnits > 0 && survivorsB.length >= maxUnits) {
      drop({ id: row.id, reason: "unit-cap", cap: maxUnits, category: row.category });
      continue;
    }
    survivorsB.push(row);
  }

  // ⑩ 分区配额账本：不可裁剪的四样先占，剩下的按类别抢自己的那一格。
  const neverDropped = new Set([...(options.neverDropped ?? NEVER_DROPPED)]);
  const quota = {
    baseline: Number(ledgerQuota.baselineBytes) > 0 ? Number(ledgerQuota.baselineBytes) : Infinity,
    task: Number(ledgerQuota.taskMaxBytes) || Infinity,
    domain: Number(ledgerQuota.dynamicMaxBytes) || Infinity,
    batch: Number(ledgerQuota.batchMaxBytes) || Infinity,
    context: Number(ledgerQuota.contextMaxBytes) || Infinity,
    tail: Infinity,
  };
  const used = { baseline: 0, task: 0, domain: 0, batch: 0, context: 0, tail: 0 };

  const pinned = survivorsB.filter((row) => neverDropped.has(row.category) || row.protected === true);
  const optional = survivorsB.filter((row) => !(neverDropped.has(row.category) || row.protected === true));
  for (const row of pinned) used[row.category] += row.bytes;

  const kept = [...pinned];
  for (const row of optional) {
    const cap = quota[row.category] ?? Infinity;
    if (used[row.category] + row.bytes <= cap) {
      kept.push(row);
      used[row.category] += row.bytes;
    } else {
      drop({ id: row.id, reason: "budget", category: row.category, bytes: row.bytes, priority: row.priority, cap });
    }
  }

  // 总天花板（ceiling）：0 = 不设限。超了就按丢弃次序整单元走。
  const ceiling = Number(ledgerQuota.ceiling) || 0;
  let totalBytes = kept.reduce((sum, row) => sum + row.bytes, 0);
  if (ceiling > 0 && totalBytes > ceiling) {
    const victims = [...kept].sort(sortDropCandidates);
    for (const row of victims) {
      if (totalBytes <= ceiling) break;
      if (neverDropped.has(row.category) || row.protected === true) continue;
      const at = kept.indexOf(row);
      if (at < 0) continue;
      kept.splice(at, 1);
      used[row.category] -= row.bytes;
      totalBytes -= row.bytes;
      drop({ id: row.id, reason: "ceiling", category: row.category, bytes: row.bytes, priority: row.priority });
    }
  }

  kept.sort(sortUnits);

  const ledger = {
    mode: options.mode ?? "warn",
    ceiling,
    minTriggerConfidence: minConfidence,
    softCap: dynamicSoftCap(ledgerQuota),
    maxUnitsPerTurn: maxUnits,
    maxUnitsPerChannel: perChannel,
    categories: Object.keys(quota).map((name) => ({
      category: name,
      bytes: used[name],
      cap: Number.isFinite(quota[name]) ? quota[name] : null,
      units: kept.filter((row) => row.category === name).length,
    })),
    totals: {
      bytes: totalBytes,
      units: kept.length,
      selected: kept.length,
      dropped: dropped.length,
      channels: countBy(kept, (row) => row.channel),
      categories: countBy(kept, (row) => row.category),
    },
  };

  const report = {
    revision: facts.revision,
    turn: facts.turn,
    step: facts.step,
    configRevision: facts.configRevision,
    mode: ledger.mode,
    fingerprint: fingerprintOf(kept, dropped),
    budget: { ceiling, hardProtectedBytes: pinned.reduce((sum, row) => sum + row.bytes, 0), totalBytes },
    selected: kept.map(publicRow),
    dropped: dropped.map(publicRow),
    ledger,
  };

  return { facts, selected: kept, dropped, totalBytes, ledger, report };
};

const countBy = (rows, keyOf) => {
  const acc = {};
  for (const row of rows) {
    const key = String(keyOf(row));
    acc[key] = (acc[key] ?? 0) + 1;
  }
  return acc;
};

const dynamicSoftCap = (ledgerQuota) =>
  (Number(ledgerQuota.dynamicMaxBytes) || 0) + (Number(ledgerQuota.contextMaxBytes) || 0) +
  (Number(ledgerQuota.taskMaxBytes) || 0) + (Number(ledgerQuota.batchMaxBytes) || 0);

// 对外行：不带正文，只带「能审计的那几个数」。面板与统计库都读这一份。
const publicRow = (row) => ({
  id: row.id,
  channel: row.channel,
  category: row.category,
  order: row.order,
  priority: row.priority,
  scope: row.scope,
  ttl: row.ttl,
  bytes: row.bytes ?? null,
  digest: row.digest ?? null,
  confidence: row.confidence ?? null,
  protected: row.protected === true,
  reason: row.reason ?? null,
  source: row.source ?? null,
});

/** 计划指纹：同样的选择、同样的字节、同样的丢弃原因 → 同一个指纹。丢弃项也进指纹。 */
export const fingerprintOf = (selected, dropped) => {
  const parts = [];
  for (const row of [...selected].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    parts.push(`S|${row.id}|${row.bytes}|${row.channel}|${row.ttl ?? "turn"}|${row.category ?? "-"}`);
  }
  for (const row of [...dropped].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    parts.push(`D|${row.id}|${row.reason}|${row.detail ?? ""}`);
  }
  return `ig5p${fnv1a(parts.join("\n")).toString(16).padStart(8, "0")}`;
};

/**
 * 旧结果 ↔ 新计划的旁路比对（落地第一步用：不改行为，先证明计划器认得出现状）。
 * 返回 { ok, checked, missing, extra, bytesDelta, notes }：ok=false 时先修计划器，别接线。
 */
export const compareWithLive = (plan, live = {}, options = {}) => {
  const plannedIds = new Set((plan?.selected ?? []).map((row) => row.id));
  const liveIds = new Set((live.sections ?? []).map((row) => String(row?.id ?? row?.name ?? "")));
  const missing = [...plannedIds].filter((id) => !liveIds.has(id));
  const extra = [...liveIds].filter((id) => id && !plannedIds.has(id));
  const allowExtra = new Set(options.allowExtra ?? []);
  const extraFiltered = extra.filter((id) => !allowExtra.has(id));
  const bytes = (rows) => rows.reduce((sum, row) => sum + Number(row?.bytes ?? row?.chars ?? 0), 0);
  return {
    ok: missing.length === 0 && extraFiltered.length === 0,
    checked: plannedIds.size,
    missing,
    extra: extraFiltered,
    allowedExtra: extra.filter((id) => allowExtra.has(id)),
    bytesDelta: bytes(plan?.selected) - bytes(live.sections),
  };
};

// ── 模块自检：node data/injection-policy.mjs ────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = [];
  const ok = (cond, label, detail = "") => {
    if (!cond) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  };

  const facts = snapshotFacts({ turn: 1, step: 1, userText: "验证插件", configRevision: 3 });
  const planned = planInjection(facts, [
    {
      id: "kernel",
      channel: "section",
      order: 100,
      priority: 1000,
      protected: true,
      text: "BASE",
      reason: "基线",
    },
    {
      id: "boost:test",
      channel: "section",
      order: 150,
      priority: 10,
      when: (current) => current.userText.includes("验证"),
      text: "BOOST",
      reason: "命中验证",
    },
  ], { ceiling: 1024 });

  ok(planned.selected.length === 2, "两条单元都进", String(planned.selected.length));
  ok(planned.report.selected.every((row) => typeof row.reason === "string"), "选择项都带 reason");
  ok(planned.report.fingerprint.startsWith("ig5p"), "指纹成形", planned.report.fingerprint);

  // 同一事实快照 → 同一指纹；事实变了 → 指纹变。
  const again = planInjection(facts, [
    { id: "kernel", channel: "section", order: 100, priority: 1000, protected: true, text: "BASE", reason: "基线" },
    { id: "boost:test", channel: "section", order: 150, priority: 10, text: "BOOST", reason: "命中验证" },
  ], { ceiling: 1024 });
  ok(again.report.fingerprint === planned.report.fingerprint, "同事实同指纹");
  const other = planInjection(snapshotFacts({ turn: 2, step: 1, userText: "别的" }), [
    { id: "kernel", channel: "section", order: 100, priority: 1000, protected: true, text: "BASE" },
  ], { ceiling: 1024 });
  ok(other.report.fingerprint !== planned.report.fingerprint, "事实变了指纹就该变");

  // 重复 id 只进一次，且必有 duplicate-id 原因。
  const dup = planInjection(facts, [
    { id: "kernel", channel: "section", order: 100, priority: 1000, protected: true, text: "BASE" },
    { id: "kernel", channel: "section", order: 100, priority: 999, text: "BASE2" },
  ], { ceiling: 4096 });
  ok(dup.selected.length === 1, "重复 id 只进一次", String(dup.selected.length));
  ok(dup.dropped.some((row) => row.reason === "duplicate-id"), "重复 id 留 reason");

  // 依赖不在场 → 依赖缺失丢弃；依赖在场 → 正常进。
  const dep = planInjection(facts, [
    { id: "boost", channel: "section", order: 150, priority: 60, dependsOn: ["kernel"], text: "BOOST" },
  ], { ceiling: 4096 });
  ok(dep.selected.length === 0 && dep.dropped[0].reason === "dependency-missing", "缺依赖不单独挂");

  // 冲突：只留先到的高优先单元。
  const conflict = planInjection(facts, [
    { id: "a", channel: "section", order: 1, priority: 90, text: "A" },
    { id: "b", channel: "section", order: 2, priority: 10, text: "B", conflictsWith: ["a"] },
  ], { ceiling: 4096 });
  ok(conflict.selected.length === 1 && conflict.selected[0].id === "a", "冲突只留一条");
  ok(conflict.dropped.some((row) => row.reason === "conflict"), "冲突留 reason");

  // 命中率闸：低置信单元在 balanced 下被削、在 full 下放行。
  const lowConf = [{ id: "maybe", channel: "section", order: 160, priority: 20, confidence: 0.7, text: "MAYBE" }];
  const balanced = planInjection(facts, lowConf, { minTriggerConfidence: PROFILE_VALUES.balanced.minTriggerConfidence });
  const full = planInjection(facts, lowConf, { minTriggerConfidence: PROFILE_VALUES.full.minTriggerConfidence });
  const minimal = planInjection(facts, lowConf, { minTriggerConfidence: PROFILE_VALUES.minimal.minTriggerConfidence });
  ok(balanced.selected.length === 1, "balanced 放行 0.7 的命中");
  ok(full.selected.length === 1, "full 更宽");
  ok(minimal.selected.length === 0 && minimal.dropped[0].reason === "low-confidence", "minimal 削掉 0.7 的命中");

  // 配额账本：领域格满了就整单元丢，绝不截断。
  const big = planInjection(facts, [
    { id: "d1", channel: "section", order: 150, priority: 60, category: "domain", text: "x".repeat(400) },
    { id: "d2", channel: "section", order: 151, priority: 50, category: "domain", text: "y".repeat(400) },
    { id: "b1", channel: "section", order: 170, priority: 70, category: "batch", text: "z".repeat(100) },
  ], { ledger: { dynamicMaxBytes: 500, maxUnitsPerTurn: 12, ceiling: 0 } });
  ok(big.selected.some((row) => row.id === "d1"), "领域格内先到先占");
  ok(big.selected.some((row) => row.id === "b1"), "批量格不受领域格拖累");
  const budgetDrop = big.dropped.find((row) => row.reason === "budget");
  ok(budgetDrop && budgetDrop.id === "d2", "超格的是整单元，且带 reason=budget", JSON.stringify(budgetDrop));

  // 基线不可被抢占：领域塞爆也不动内核。
  const pinned = planInjection(facts, [
    { id: "kernel", channel: "section", order: 100, priority: 1000, protected: true, text: "K".repeat(900) },
    { id: "d1", channel: "section", order: 150, priority: 90, category: "domain", text: "x".repeat(900) },
  ], { ledger: { dynamicMaxBytes: 100, maxUnitsPerTurn: 12, ceiling: 1200 } });
  ok(pinned.selected.some((row) => row.id === "kernel"), "基线不被抢占");
  ok(!pinned.selected.some((row) => row.id === "d1"), "领域格超限被丢");

  // TTL：once 记账过就不再来第二遍。
  const ttlLedger = createTtlLedger();
  const unitOnce = [{ id: "rearm", channel: "context", order: 118, priority: 90, ttl: "once", text: "REARM" }];
  const first = planInjection(facts, unitOnce, {});
  ttlLedger.commit(first, { turn: 1, step: 1 });
  const second = planInjection(snapshotFacts({ ...facts, marks: ttlLedger.snapshot() }), unitOnce, {});
  ok(first.selected.length === 1, "once 首次进");
  ok(second.selected.length === 0 && second.dropped[0].reason === "ttl-spent", "once 记账后不再进", JSON.stringify(second.dropped));
  ttlLedger.clear();
  ok(ttlLedger.size === 0, "台账可清空");

  // 单元数上限：整单元削，不留半句。
  const many = Array.from({ length: 6 }, (_, i) => ({
    id: `u${i}`, channel: "section", order: 150 + i, priority: 50 - i, category: "domain", text: "T".repeat(10),
  }));
  const capped = planInjection(facts, many, { ledger: { maxUnitsPerTurn: 3, maxUnitsPerChannel: { section: 8, context: 6, tail: 2 }, ceiling: 0 } });
  ok(capped.selected.length === 3, "每轮单元数封顶", String(capped.selected.length));
  ok(capped.dropped.filter((row) => row.reason === "unit-cap").length === 3, "超上限的都有原因");

  // 旁路比对：旧结果与计划一致才算认得出。
  const cmp = compareWithLive(capped, { sections: capped.selected.map((row) => ({ id: row.id, bytes: row.bytes })) });
  ok(cmp.ok === true, "旁路比对认出现状", JSON.stringify(cmp));
  const cmp2 = compareWithLive(capped, {
    sections: capped.selected.map((row) => ({ id: row.id, bytes: row.bytes })).concat([{ id: "kernel", bytes: 1 }]),
  }, { allowExtra: ["kernel"] });
  ok(cmp2.ok === true && cmp2.allowedExtra.length === 1, "白名单内的额外段不算漂移");

  if (failures.length > 0) {
    console.error("INJECTION_POLICY_FAIL");
    for (const line of failures) console.error(`  ✗ ${line}`);
    process.exitCode = 1;
  } else {
    console.log(`INJECTION_POLICY_OK ${planned.totalBytes}`);
  }
}
