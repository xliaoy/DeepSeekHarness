// 上游 DSH 平台提示词布局表（v0.52.10）
//
// 来源：官方上游实现 `@deepseek-ai/dsh`（package.json repository =
//   git+https://github.com/deepseek-ai/deepseek-harness.git，directory = apps/cli，
//   本机版本 0.1.7-rc.2），文件 `node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js`
//   第 10–54 行的 SECTION_ORDERS / CONTEXT_ORDERS 与第 55–57 行的段名常量。
//   —— 即「拉上游」拉到的就是这张表：它决定平台每一段提示词排在哪、叫什么名字。
//
// 为什么需要它：接管精度取决于**按上游真实布局命中**，而不是靠英文子串猜。
//   · 段（section）：身份 / 人格前后缀 / 各工具用法 / 交付物引用 / 结构化输出 / 自身源码 / Web 面。
//   · 上下文（context）：沙箱策略 / 审批策略 / 子代理委派 —— 这三条**不是段**，
//     只过滤 sections 的接管会把平台自己的沙箱与审批立场留在提示词里（这正是「AI 叛逆」的来源之一）。
// 上游还提供 `suppressRuntimeContext()`：整片运行时上下文可被压制 —— 对应下面的 mode 语义。

/** 上游段表（section order）。数字即上游给的排序值，不是我们的估计。 */
export const HOST_SECTION_ORDERS = Object.freeze({
  HARNESS_IDENTITY: -1000,
  DEPLOYMENT_PERSONA_PREFIX: 0,
  PLAN_POLICY: 500,
  TEAM_POLICY: 600,
  PTC_ONLY: 800,
  FILE_REFERENCE: 900,
  TOOL_BASH: 1000,
  TOOL_PWSH: 1010,
  TOOL_READ: 1100,
  TOOL_WRITE: 1200,
  TOOL_EDIT: 1300,
  TOOL_GLOB: 1400,
  TOOL_GREP: 1500,
  TOOL_JOBS: 1600,
  TOOL_PTY: 1700,
  TOOL_WEB_SEARCH: 2000,
  TOOL_WEB_FETCH: 2100,
  TOOL_LSP: 2200,
  TOOL_SESSION_QUERY: 2300,
  TOOL_GOAL: 2400,
  TOOL_WORKFLOW: 2600,
  TOOL_RALPH: 2700,
  TOOL_SUBAGENT: 2800,
  TOOL_REPORT: 2900,
  TOOL_COMPUTER_USE: 3000,
  MCP_SERVERS: 3100,
  TOOLS_SDK: 5000,
  DELIVERABLE_FILE_REFERENCES: 9000,
  STRUCTURED_OUTPUT: 9900,
  HARNESS_SOURCE: 10000,
  WEB_SURFACE: 10100,
  DEPLOYMENT_PERSONA_SUFFIX: 10200,
});

/** 上游上下文表（context order）：不是段，走的是 contexts 通道。 */
export const HOST_CONTEXT_ORDERS = Object.freeze({
  SANDBOX_POLICY: 110,
  APPROVAL_POLICY: 115,
  SUBAGENT_DELEGATION: 120,
});

/**
 * 上游**真实段名索引**（v0.52.11 从克隆到的官方仓库 master 收的）：
 *   仓库 deepseek-ai/deepseek-harness，提交 639ed01（2026-09-29，Merge PR #5479 / release-dsh-0.2.0-rc.2），
 *   收集命令：grep -rhoE "name: '[a-z][a-z0-9-]*:[a-z0-9-]+'" packages/*\/*\/src/*.ts | sort -u  → 28 条。
 * 有了这张表，接管不再靠前缀猜：**段名直接命中族别**。
 * 注意上游把沙箱/审批/委派同时做成了段与上下文（0.2.0-rc.2 起是段名 sandbox:policy / approval:policy /
 * subagent:delegation）—— 只认前缀的接管会漏掉它们，这正是「AI 叛逆」的残留来源之一。
 */
export const HOST_SECTION_NAME_INDEX = Object.freeze({
  "harness:identity": "stance",
  "deployment:persona-prefix": "stance",
  "deployment:persona-suffix": "stance",
  "harness:source": "source",
  "app:web-surface": "surface",
  "sandbox:policy": "policy",
  "approval:policy": "policy",
  "subagent:delegation": "policy",
  "plan:policy": "policy",
  "team:policy": "policy",
  "tools:ptc-only": "policy",
  "tools:sdk": "tool",
  "tool:bash": "tool",
  "tool:pwsh": "tool",
  "tool:read": "tool",
  "tool:write": "tool",
  "tool:edit": "tool",
  "tool:glob": "tool",
  "tool:grep": "tool",
  "tool:jobs": "tool",
  "tool:pty": "tool",
  "tool:lsp": "tool",
  "tool:goal": "tool",
  "tool:ralph": "tool",
  "tool:session-query": "tool",
  "browser-use:stagehand-native": "tool",
  "computer-use:cua-driver-native": "tool",
  "context:file-reference": "reference",
  "ui:deliverable-file-references": "reference",
  "cordis:include": "reference",
});

/** 上游已知段名常量（源码里逐字导出的那两个）。 */
export const HOST_SECTION_NAMES = Object.freeze({
  IDENTITY: "harness:identity",
  PERSONA_PREFIX: "deployment:persona-prefix",
  PERSONA_SUFFIX: "deployment:persona-suffix",
});

/** exact 档会剔的族：平台自己的立场（身份/人格）与策略（沙箱/审批/委派/计划/团队）。 */
export const HOST_DROPPABLE_FAMILIES = Object.freeze(["stance", "policy"]);

/**
 * 段名族 → 接管建议。
 *   stance —— 平台自己的身份/人格立场：接管的主要目标（去掉它，模型的立场由内核说了算）。
 *   policy —— 沙箱/审批/委派/计划/团队这类行为约束：接管会改工作流，exact 档一并处理。
 *   tool   —— 工具用法说明：接管会削弱宿主工具的可发现性，默认不碰。
 *   reference/surface/source —— 文件引用、Web 面、自身源码：几乎总能安全留着。
 */
export const HOST_FAMILIES = Object.freeze({
  "harness:identity": "stance",
  "deployment:persona-prefix": "stance",
  "deployment:persona-suffix": "stance",
  "harness:source": "source",
  "web:surface": "surface",
});

const PREFIX_FAMILY = [
  ["harness:", "source"],
  ["app:", "surface"],
  ["web:", "surface"],
  ["deployment:persona", "stance"],
  ["deployment:", "stance"],
  ["sandbox:", "policy"],
  ["approval:", "policy"],
  ["subagent:", "policy"],
  ["plan:", "policy"],
  ["team:", "policy"],
  ["structured-output", "policy"],
  ["context:", "reference"],
  ["ui:", "reference"],
  ["cordis:", "reference"],
  ["mcp:", "tool"],
  ["tool:", "tool"],
  ["tools:", "tool"],
  ["browser-use:", "tool"],
  ["computer-use:", "tool"],
];

/** 由段名 + order 推断族别；认不出来就是 foreign（第三方/本插件自己的段）。 */
export function classifySection(name, order) {
  const n = String(name ?? "").toLowerCase();
  if (!n) return { family: "foreign", stake: "unknown" };
  if (HOST_SECTION_NAME_INDEX[n]) return { family: HOST_SECTION_NAME_INDEX[n], stake: "upstream-name" };
  if (HOST_FAMILIES[n]) return { family: HOST_FAMILIES[n], stake: "known" };
  for (const [prefix, family] of PREFIX_FAMILY) {
    if (n.startsWith(prefix)) return { family, stake: "known" };
  }
  const o = Number(order);
  if (Number.isFinite(o)) {
    if (o === HOST_SECTION_ORDERS.HARNESS_IDENTITY || o === HOST_SECTION_ORDERS.DEPLOYMENT_PERSONA_SUFFIX) {
      return { family: "stance", stake: "order" };
    }
    if (o === HOST_SECTION_ORDERS.STRUCTURED_OUTPUT) return { family: "policy", stake: "order" };
    if (o === HOST_SECTION_ORDERS.HARNESS_SOURCE || o === HOST_SECTION_ORDERS.WEB_SURFACE) {
      return { family: family_of(o), stake: "order" };
    }
  }
  return { family: "foreign", stake: "unknown" };
}

function family_of(order) {
  return order === HOST_SECTION_ORDERS.WEB_SURFACE ? "surface" : "source";
}

/** 由上下文名推断是不是平台的策略类上下文。 */
export function classifyContext(name) {
  const n = String(name ?? "").toLowerCase();
  if (/sandbox/.test(n)) return { family: "policy", key: "SANDBOX_POLICY" };
  if (/approval/.test(n)) return { family: "policy", key: "APPROVAL_POLICY" };
  if (/subagent|delegation/.test(n)) return { family: "policy", key: "SUBAGENT_DELEGATION" };
  return { family: "other", key: null };
}

/** 上游 STRUCTURED_OUTPUT 占掉的 order —— 我们的段不能再用这个数（同 order 会靠插入次序抢位）。 */
export const HOST_TAKEN_ORDERS = Object.freeze(
  Object.values(HOST_SECTION_ORDERS),
);
export function isHostTakenOrder(order) {
  return HOST_TAKEN_ORDERS.includes(Number(order));
}

/** 上游最后一个「立场类」段的 order：接管条款排在它之后、源码段之前最干净。 */
export const HOST_LAST_STANCE_ORDER = HOST_SECTION_ORDERS.STRUCTURED_OUTPUT;

const OURS = "infinite-gen-5:";

/**
 * 精准接管计划：段 + 上下文一起算。
 *   mode=resident（默认）—— 条款常驻，一段不剔、一个上下文不压（只回报「能剔什么」）。
 *   mode=exact          —— 只按上游表命中：剔 stance 段 + 压 policy 上下文；工具/源码/第三方一律不动。
 *   mode=shadow         —— exact 再叠加旧的子串剔除词（兼容老配置）。
 *   mode=replace        —— 非本插件段一律让位，上下文整片压掉。
 */
export function planHostTakeover({ sections = [], contexts = [], mode = "resident", dropList = [], hints = [] } = {}) {
  const secs = Array.isArray(sections) ? sections.filter(Boolean) : [];
  const ctxs = Array.isArray(contexts) ? contexts.filter(Boolean) : [];
  const dropHints = [...(Array.isArray(dropList) ? dropList : []), ...(Array.isArray(hints) ? hints : [])]
    .map((h) => String(h ?? "").toLowerCase())
    .filter(Boolean);

  const kept = [];
  const dropped = [];
  const matched = [];
  for (const s of secs) {
    const name = String(s.name ?? "");
    const cls = classifySection(name, s.order);
    const ours = name.startsWith(OURS);
    if (ours) {
      kept.push(s);
      continue;
    }
    if (cls.family !== "foreign") matched.push({ name, family: cls.family, stake: cls.stake });
    if (mode === "replace") {
      dropped.push({ name, family: cls.family, reason: "replace：非本插件段一律让位" });
      continue;
    }
    if (mode === "exact" || mode === "shadow") {
      // v0.52.11：exact 档剔「立场 + 策略」两族 —— 上游把沙箱/审批/委派也做成了段，
      // 只剔 stance 会把平台自己的沙箱与审批立场留在提示词里。
      if (HOST_DROPPABLE_FAMILIES.includes(cls.family) && cls.stake !== "unknown") {
        dropped.push({ name, family: cls.family, reason: `exact：上游表命中 ${cls.family} 段` });
        continue;
      }
      if (mode === "shadow" && dropHints.length && dropHints.some((h) => name.toLowerCase().includes(h))) {
        dropped.push({ name, family: cls.family, reason: "shadow：命中剔除词" });
        continue;
      }
    }
    kept.push(s);
  }

  const keptContexts = [];
  const suppressedContexts = [];
  for (const c of ctxs) {
    const name = String(c.name ?? "");
    const cls = classifyContext(name);
    if (mode === "replace") {
      suppressedContexts.push({ name, family: cls.family, reason: "replace：上下文整片压制" });
      continue;
    }
    if ((mode === "exact" || mode === "shadow") && cls.family === "policy") {
      suppressedContexts.push({ name, family: cls.family, reason: `exact：平台策略上下文（${cls.key}）` });
      continue;
    }
    keptContexts.push(c);
  }

  return { mode, kept, dropped, matched, keptContexts, suppressedContexts };
}
