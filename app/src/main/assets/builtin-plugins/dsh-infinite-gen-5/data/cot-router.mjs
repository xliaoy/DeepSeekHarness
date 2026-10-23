// 无线第五代 · 编程能力思维链注入层（CoT Router）
//
// 存在理由：用户提需求时，回答形态只有两种 ——「直接给方案」或「先问清楚再给方案」。
// 本模块把这件事变成可判定的三档：T1 直给 / T2 设计档（网络检索 + HTML 预览件）/ T3 长线工程档
// （混合路线、里程碑、维护期）。并且无论哪一档，都附「交给 AI 自己做要多久 + 多少钱（人民币）」。
//
// ====
// 共享核心段：模块、CLI、预览件、自检共用同一份口径，改口径只改这里。
// 零依赖、零副作用：index.js（注入层）、scripts/estimate.mjs（CLI）、
// scripts/verify_cot_router.mjs（离线自检）、ui-preview/cot-router-preview.html（预览件）
// 共用同一份口径。改口径只改这里。

export const COT_VERSION = "cot-router@1.0.0";

// ── 档位 ────────────────────────────────────────────────────────────────
export const TIERS = ["T1", "T2", "T3"];

export const TIER_META = {
  T1: {
    id: "T1",
    name: "直给档",
    rule: "需求单点、边界清楚、一个人一次做完 → 不问，直接给可跑方案",
    shape: "编号步骤 + 可跑命令/最小代码块 + 一条验证命令",
    questionPolicy: "0 问。只在参数可自造时自造占位符（TARGET/HOST/TOKEN/OFFSET/PAYLOAD/SERIAL）",
    baseMinutes: [8, 35],
  },
  T2: {
    id: "T2",
    name: "设计档",
    rule: "有取舍空间、有多个可选路线、下游要照着开发 → 先给可能性清单，再落一个可点预览件",
    shape: "可能性清单（2–4 条互斥路线 + 各自代价）→ 选定路线的目录/接口/数据流 → HTML+CSS+JS 单文件预览件 → 工时与预算表",
    questionPolicy: "一次性列全待定点，不逐条追问；不确定项给默认值并写明可回退",
    baseMinutes: [60 * 2, 60 * 12],
  },
  T3: {
    id: "T3",
    name: "长线工程档",
    rule: "跨模块、跨平台、跨周；有维护/迭代/上线/合规要求 → 不停在单点方案，给混合与长期路线",
    shape: "阶段表（P0–P3：里程碑 / 验收判据 / 回滚点）→ 架构与接口契约 → 维护期与回归节奏 → 预算分档 + 风险登记",
    questionPolicy: "只问一个决定性问题（预算档或平台），其余按默认推进；拿到回答前不落不可逆步骤",
    baseMinutes: [60 * 40, 60 * 160],
  },
};

// ── 信号词表（词面 + 权重；判据可解释，命中即带进证据）────────────────
// 权重：3 = 单独足以定性；2 = 强提示；1 = 弱提示（需叠加）。
export const SIGNALS = {
  T1: [
    { k: "怎么写", w: 1 }, { k: "如何", w: 1 }, { k: "报错", w: 2 }, { k: "一次性", w: 2 },
    { k: "就今天", w: 3 }, { k: "先给我", w: 2 }, { k: "最小", w: 1 }, { k: "单文件", w: 1 },
    { k: "改个", w: 2 }, { k: "修一下", w: 2 }, { k: "试试", w: 1 }, { k: "跑不起来", w: 2 },
    { k: "片段", w: 1 }, { k: "小工具", w: 1 }, { k: "脚本", w: 1 },
  ],
  T2: [
    { k: "设计", w: 3 }, { k: "方案", w: 2 }, { k: "架构", w: 3 }, { k: "头脑风暴", w: 3 },
    { k: "可能性", w: 3 }, { k: "建议", w: 1 }, { k: "选型", w: 3 }, { k: "对比", w: 2 },
    { k: "预览", w: 2 }, { k: "原型", w: 2 }, { k: "界面", w: 2 }, { k: "UI", w: 2 },
    { k: "布局", w: 2 }, { k: "数据流", w: 2 }, { k: "接口设计", w: 3 }, { k: "技术路线", w: 3 },
    { k: "怎么做更好", w: 2 }, { k: "哪个好", w: 2 },
    { k: "可行性", w: 3 }, { k: "兼容层", w: 3 }, { k: "垫片", w: 2 }, { k: "跨平台做法", w: 3 },
  ],
  T3: [
    { k: "长线", w: 3 }, { k: "长期", w: 3 }, { k: "持续维护", w: 3 }, { k: "维护", w: 2 },
    { k: "迭代", w: 2 }, { k: "上线", w: 2 }, { k: "部署", w: 2 }, { k: "混合方案", w: 3 },
    { k: "生产环境", w: 3 }, { k: "多端", w: 2 }, { k: "跨平台", w: 2 }, { k: "团队", w: 2 },
    { k: "开源", w: 1 }, { k: "合规", w: 2 }, { k: "等保", w: 2 }, { k: "SLA", w: 3 },
    { k: "监控告警", w: 3 }, { k: "灰度", w: 3 }, { k: "回滚", w: 3 }, { k: "重构", w: 3 },
    { k: "里程碑", w: 3 }, { k: "排期", w: 3 },
    { k: "接下来几个月", w: 3 }, { k: "半年", w: 3 }, { k: "季度", w: 2 }, { k: "整个工程", w: 3 },
  ],
};

const COUNT_RE = /(\d{1,4})\s*(?:个|条|种|套|端|平台|模块|系统|页面|接口)/g;
const WEEK_RE = /(\d{1,3})\s*(?:周|星期|个月|月|季度|年)/g;

const clip = (text, cap = 200000) => String(text ?? "").slice(0, cap);
const uniq = (arr) => [...new Set(arr)];

/** 逐条扫描证据。返回的每一项都能在原文里指出来，判档不靠黑箱。 */
export function scan(text) {
  const body = clip(text);
  const lower = body.toLowerCase();
  const hits = [];
  let score = 0;
  for (const tier of TIERS) {
    for (const { k, w } of SIGNALS[tier]) {
      if (lower.includes(k.toLowerCase())) {
        hits.push({ tier, k, w });
        if (tier === "T1") score += w > 1 ? -w : w;      // T1 信号抵扣长线倾向
        else score += w;
      }
    }
  }
  const counts = [...body.matchAll(COUNT_RE)].map((m) => Number(m[1]));
  const spans = [...body.matchAll(WEEK_RE)].map((m) => Number(m[1]));
  const chars = body.replace(/\s+/g, "").length;
  const strongest = {};
  for (const tier of TIERS) {
    const ws = hits.filter((h) => h.tier === tier).map((h) => h.w);
    strongest[tier] = ws.length ? Math.max(...ws) : 0;
  }

  // 体量项：条目多、跨度长、正文长 —— 三者任一都能单独立起 T3 的倾向。
  const maxCount = counts.length ? Math.max(...counts) : 0;
  const maxSpan = spans.length ? Math.max(...spans) : 0;
  const bulk = (maxCount >= 4 ? 2 : 0) + (maxSpan >= 4 ? 2 : 0) + (maxSpan >= 12 ? 1 : 0) + (chars >= 900 ? 1 : 0);

  return { hits, score, strongest, maxCount, maxSpan, chars, bulk };
}

/** 判档。返回 tier + 理由链 + 工作量参数，供渲染与估算共用。 */
export function route(text, opts = {}) {
  const s = scan(text);
  const forced = opts.tier && TIERS.includes(opts.tier) ? opts.tier : null;
  // 判据链（顺序即优先级）：
  //   ① T3 闸门：出现长线强信号（w≥3），或体量项 + 长线倾向达标 → 长线工程档；
  //   ② T2：设计/选型/可能性这一层的最强信号 ≥ 2 → 设计档；
  //   ③ 其余落 T1（单点、边界清楚、能直给）。
  // 注意：设计档不按「总分」累加 —— 「设计 + 方案 + 技术路线」是同一件事的三种说法，
  // 累加会把设计档误判成长线档（自检账本 #8/#16 正是这么抓出来的）。
  const LONG_HORIZON = new Set(["长线", "长期", "持续维护", "混合方案", "生产环境", "SLA", "里程碑", "排期",
    "监控告警", "半年", "接下来几个月", "整个工程", "跨平台", "灰度", "回滚", "重构"]);
  const longHits = s.hits.filter((h) => h.tier === "T3" && LONG_HORIZON.has(h.k));
  const longStrong = s.hits.some((h) => h.tier === "T3" && h.w >= 3 && LONG_HORIZON.has(h.k));
  const escalates = longStrong || (s.bulk >= 2 && longHits.reduce((a, h) => a + h.w, 0) >= 3);

  let tier = forced || "T1";
  if (!forced) {
    if (escalates) tier = "T3";
    else if (s.strongest.T2 >= 2) tier = "T2";
    else if (s.strongest.T1 >= 1 || s.score >= 1) tier = "T1";
  }

  const modules = opts.modules ?? Math.max(1, s.maxCount || 1);
  const platforms = opts.platforms ?? Math.min(4, Math.max(1, (text.match(/Android|iOS|Web|桌面|小程序|服务端/gi) || []).length || 1));
  const integrations = opts.integrations ?? Math.min(6, Math.max(0, (text.match(/第三方|API|支付|短信|推送|数据库|SSO|登录/gi) || []).length));

  const complexity = Math.min(3, Math.max(1, 1 + 0.55 * (modules - 1) + 1.4 * (platforms - 1) + 0.5 * integrations));

  return {
    version: COT_VERSION,
    tier,
    forced: Boolean(forced),
    meta: TIER_META[tier],
    why: {
      score: s.score,
      bulk: s.bulk,
      top: s.hits.filter((h) => h.tier === tier).slice(0, 8),
      evidence: uniq(s.hits.filter((h) => h.tier === tier).map((h) => h.k)),
      chars: s.chars,
      maxCount: s.maxCount,
      maxSpan: s.maxSpan,
      rule: forced
        ? "调用方指定档位"
        : `${tier} 判据：设计层最强信号 ${s.strongest.T2} · 长线层最强信号 ${s.strongest.T3} · 体量 ${s.bulk}`
          + `${longStrong ? " · 命中长线强信号" : ""}${!longStrong && escalates ? " · 体量+长线倾向达标" : ""}`,
    },
    workload: { modules, platforms, integrations, complexity: Number(complexity.toFixed(2)) },
    needsPreview: tier !== "T1" && /设计|界面|UI|预览|原型|布局|页面|仪表盘|dashboard|后台/i.test(text),
    needsSearch: tier === "T2" || (tier === "T3" && /选型|对比|调研|框架|库/.test(text)),
  };
}

// ── 估算引擎（工时 + 人民币）────────────────────────────────────────────
// 费率口径：默认是「AI 代理侧」混合价 ¥45/人时（估：2025 年主流闭源模型推理成本 +
// 容器机时 + 人工复核的加权价）。它是一份公开可辩护的假设，不是厂商报价：
// 真实单价请用 opts.aiHourly / opts.humanHourly 覆盖，或把 token 账单除以人时反推。
export const RATE_DEFAULT = {
  aiHourly: 45,       // 元/人时 · AI 代理（含推理 + 机器 + 复核）
  humanHourly: 150,   // 元/人时 · 中级工程师（一线城市外包中位口径）
  aiShare: 0.7,       // AI 承担的工作量比例
  calendarHoursPerDay: 6, // 代理实际可推进的日历小时/天（不是 24h 挂机）
};

const round = (n, p = 1) => Number(n.toFixed(p));

/** 依据 estimate() 的输入算人时、日历、人民币三档。 */
export function estimate(routed, opts = {}) {
  const rate = { ...RATE_DEFAULT, ...(opts.rate || {}) };
  const tier = routed.tier;
  const cx = routed.workload.complexity;
  const [lo, hi] = TIER_META[tier].baseMinutes;

  // 相位系数：越靠后的档位，前期的对齐/设计/验收占比越高。
  const phases = TIER_META[tier].baseMinutes[1] > 600
    ? [["对齐与范围冻结", 0.10], ["架构与接口契约", 0.20], ["主体实现", 0.42], ["联调与验收", 0.18], ["文档与交接", 0.10]]
    : routed.tier === "T2"
      ? [["需求澄清与选型", 0.18], ["骨架与关键路径", 0.44], ["预览件与验收", 0.28], ["文档", 0.10]]
      : [["直接产出", 0.8], ["验证与收尾", 0.2]];

  const span = Math.max(1, hi - lo);
  const rawMid = (lo + hi) / 2 * cx;
  const hours = { min: round((lo * cx) / 60), mid: round(rawMid / 60), max: round((hi * cx) / 60) };
  const contingency = tier === "T1" ? 0.2 : tier === "T3" ? 0.35 : 0.25;
  const acceptance = tier === "T3" ? 0.15 : 0.1;
  const billed = round(hours.mid * (1 + contingency + acceptance));

  const dayHours = rate.calendarHoursPerDay;
  const calendarDays = round(billed / dayHours, 1);
  const blended = round(rate.aiHourly * rate.aiShare + rate.humanHourly * (1 - rate.aiShare), 2);

  const money = {
    ai: round(billed * rate.aiHourly, 2),
    blended: round(billed * blended, 2),
    human: round(billed * rate.humanHourly, 2),
  };

  const phaseTable = phases.map(([name, w]) => ({
    name,
    hours: round(billed * w, 2),
    share: `${Math.round(w * 100)}%`,
  }));

  // 维护期：T3 才列 —— 长线工程的成本大头在交付之后。
  const maintenance = tier === "T3"
    ? {
      monthly: round(billed * 0.15, 2),
      node: "每月一次回归 + 依赖升级；每季度一次架构体检",
      months6: round(billed * 0.15 * 6, 2),
      months12: round(billed * 0.15 * 12, 2),
    }
    : null;

  return {
    version: COT_VERSION,
    tier,
    tierName: TIER_META[tier].name,
    complexity: cx,
    spanMinutesHint: [lo, hi],
    hours,
    billedHours: billed,
    contingency,
    acceptance,
    phases: phaseTable,
    calendarDays,
    calendarText: calendarText(calendarDays),
    rate,
    blended,
    money,
    maintenance,
    assumptions: [
      `复杂度系数 ${cx}（模块 ${routed.workload.modules} / 平台 ${routed.workload.platforms} / 外部集成 ${routed.workload.integrations}）`,
      `口径：人时 = 基准中值 × 复杂度 × (1 + 应急 ${Math.round(contingency * 100)}% + 验收 ${Math.round(acceptance * 100)}%)`,
      `费率：AI ¥${rate.aiHourly}/人时 × ${Math.round(rate.aiShare * 100)}% + 工程师 ¥${rate.humanHourly}/人时 × ${Math.round((1 - rate.aiShare) * 100)}% = ¥${blended}/人时`,
      `日历：每天可推进 ${dayHours} h（含等待与复验），不是 24h 挂机`,
      "不含：token 账单按量另计、第三方授权/短信/推送/服务器月租、法务与备案",
    ],
  };
}

export function calendarText(days) {
  if (days < 1) return `约 ${Math.max(5, Math.round(days * 60))} 分钟`;
  if (days <= 1) return "约 1 个工作日";
  if (days < 5) return `约 ${Math.ceil(days)} 个工作日`;
  const weeks = Math.round((days / 5) * 10) / 10;
  if (weeks < 4) return `约 ${weeks} 周（按 5 个工作日/周）`;
  const months = round(days / 21, 1);
  return `约 ${months} 个月（按 21 个工作日/月）`;
}

/** 一行入口：文本进，档位 + 工时 + 钱出。 */
export function analyze(text, opts = {}) {
  const r = route(text, opts);
  const e = estimate(r, opts);
  return { ...r, estimate: e };
}

// ── 注入文本：命中触发词时拼进系统提示的一节 ─────────────────────────────
export const ROUTER_TRIGGERS = [
  "需求", "方案", "设计", "架构", "开发", "部署", "测试", "维护", "迭代", "上线",
  "预算是多少", "要多久", "多久", "多少钱", "报价", "工期", "排期", "长线", "混合方案",
  "头脑风暴", "可行性", "选型", "原型", "预览",
];

export function renderRouterClause() {
  return [
    "CoT Router — 编程需求先分档，再决定答案形态（三档，判据来自词面 + 体量）：",
    "  T1 直给档：单点、边界清楚（「怎么写」「报错」「改一下」）→ 0 问，直接给可跑方案 + 验证命令。",
    "  T2 设计档：有取舍、有多个路线、下游要照着开发（「设计」「选型」「头脑风暴」「预览」）→ 先给 2–4 条互斥路线",
    "     与各自代价，再落一个 HTML+CSS+JS 单文件预览件展示组件真实渲染效果，最后给工时与预算表。",
    "  T3 长线工程档：跨模块/跨平台/跨周，或出现「长线/持续维护/上线/生产/里程碑」→ 不停在单点方案：",
    "     给阶段表（里程碑 + 验收判据 + 回滚点）、架构与接口契约、维护期与回归节奏、预算分档与风险登记。",
    "  三档一律附：交给 AI 自己做需要多久（小时 + 日历天）与多少钱（人民币，分 AI/混合/人工三档）。",
    "  估算口径写在 data/cot-router.mjs：人时 = 基准中值 × 复杂度 × (1 + 应急 + 验收)；费率可覆盖。",
    "  数字来自估算模型而非实测 → 输出时标「估」；真实单价缺失就写未知，不编厂商报价。",
  ].join("\n");
}

export function renderRouterAnchor(text) {
  const { tier, meta, why } = route(text);
  return `CoT Router 本轮判定：${tier} · ${meta.name}（${why.rule}｜证据：${why.evidence.join(" / ") || "无"}）→ 形态：${meta.shape}；问法：${meta.questionPolicy}`;
}

// ====