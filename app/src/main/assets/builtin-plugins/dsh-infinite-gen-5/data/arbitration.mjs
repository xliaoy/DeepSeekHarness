// data/arbitration.mjs — 跨插件判断层（v0.59.0）
//
// 背景（2026-10-02 实测）：本机同时装了 dsh-puzzle-mode。
//   puzzle-mode：systemPrompt 段 `puzzle-mode:policy`，order = 10120（上游 ≥0.22.0 默认；旧装机 0.19.7 为 10500）
//   无限五代   ：真末位锚点 order = 10150（index.js TAIL_ORDER）、接管裁决 order = 9900、首句层 order = -1100
// 即：**拼图段排在「真末位锚点」之后** —— 「整份系统提示的最后一段」这句话在本机已不成立。
// 两份载荷还有三处硬冲突（提问额度 / 批量题节奏 / 工具参数形态）。
// 本模块只做一件事：把「谁在什么场景下说了算」写成可判规则，供运行时锚点每步携带。
//
// 原则：能划分域的划分（不重叠优先），划分不了的按场景让位 —— 让位不改变任何硬线。

export const PZ_SECTION = "puzzle-mode:policy";
export const PZ_ORDER_UPSTREAM_0197 = 10500; // 上游 dsh-puzzle-mode v0.19.7 实测（其 lib/index.js:101）
export const PZ_ORDER_FORK_DEFAULT = 10120;  // 复刻仓 SunsetRNE/dsh-puzzle-mode-2 ≥0.22.0 / 上游 ≥0.22.0 默认（可 PUZZLE_SECTION_ORDER 覆盖）；10100 与宿主内置 WEB_SURFACE 撞号，故挪到 10120（issue #1）
export const PZ_ORDER = PZ_ORDER_UPSTREAM_0197; // 兼容旧名：当前装机的是上游 0.19.7
export const IG5_TAIL_ORDER = 10150; // 无限五代真末位锚点
// 段序两条路径都成立：装了复刻仓/上游 ≥0.22.0 → 10120 < 10150，末位锚点确实在最后；
// 装的还是上游 → 10500 > 10150，末位锚点只声明「本载荷的末位」。
export const tailIsLiterallyLast = (pzOrder) => Number.isFinite(pzOrder) && pzOrder < IG5_TAIL_ORDER;
export const IG5_FIRST_LINE_ORDER = -1100;

export const ARBITRATION_RULES = [
  {
    id: "domain",
    key: "域划分",
    rule: "交付物内容与形态（写什么、给多少、四态、边界、可跑件）→ 无限五代说了算；项目文档与采访节奏（拼图主文档/模块文档、首轮采访、审查清单）→ 拼图模式说了算",
    why: "两域不重叠，各管各的 —— 这是第一顺位判据",
  },
  {
    id: "ask-quota",
    key: "提问额度",
    rule: "本轮属于拼图采访轮或审查确认轮 → 按拼图模式（≤10 问/轮、每题 3–6 岔路、末尾固定「要不要先停下？」）；其余场景 → 按无限五代（同一轮最多一问、2–5 互斥选项）",
    why: "拼图的提问是它产生文档的手段；无限五代的三问时刻是它推进决策的手段，二者取本轮的实际目的",
  },
  {
    id: "batch-first",
    key: "批量题优先",
    rule: "整批题在场（题库 / [qNNN] 清单 / 编号 ≥20 条）→ 无限五代批量合同优先：不采访、不回问、不中停、逐题交付；拼图文档只在一轮结束后幂等回写，不得打断交付",
    why: "批量交付是不可中断的过程；文档回写可以延后，交付不能",
  },
  {
    id: "tool-shape",
    key: "工具形态",
    rule: "拼图文档一律走 puzzle_mode（write/edit 指向 拼图/ 会被宿主拒）；已注册工具的结构化参数（如 audit 的 additions）按其 schema 给 —— 无限五代的「参数扁平」只约束自造载荷，不约束既有 schema",
    why: "参数扁平是防坏包规则，不是对别人工具 schema 的改写权",
  },
  {
    id: "tail-concede",
    key: "末位让位",
    rule: "无限五代的末位锚点只声明「本载荷的末位」，不声明整份系统提示的最后一段：装的若是上游拼图（order 10500）它排在其后，装的是复刻仓/上游 ≥0.22.0（默认 order 10120）它排在其前 —— 两种都成立，不必改口径",
    why: "已在 index.js 落地：措辞让位，效力不让位（内核条款照旧生效）",
  },
  {
    id: "stop-semantics",
    key: "停下语义",
    rule: "拼图的「停下，等我看过再说」= 本轮不执行写动作；已交付的产物、结论与拍板不回退，无限五代的长程规则不被它触发",
    why: "停的是动作，不是已交付内容",
  },
];


// ── 双方互校契约（v0.59.2）：与拼图复刻仓的 compat.json 同源，两侧两两核对 ──
// 拼图侧（SunsetRNE/dsh-puzzle-mode-2）的 compat.json 声明同一组数字；
// 两侧 verify 脚本都读对方那一份并双向核对 —— 任一侧改数字而另一侧没跟上，两边都会红。
export const COMPAT_CONTRACT = "ig5-puzzle-coexist/1";
export const COMPAT_PUZZLE_PATHS = [
  "/root/S/dsh-puzzle-mode-2/compat.json",          // 复刻仓工作树
  "/root/.dsh/plugin-src/dsh-puzzle-mode/compat.json", // 装机副本（若已带该文件）
];
export function readPuzzleContract(readFileSync, existsSync) {
  for (const p of COMPAT_PUZZLE_PATHS) {
    if (existsSync(p)) {
      try {
        const j = JSON.parse(readFileSync(p, "utf8"));
        return { path: p, decl: j };
      } catch (e) {
        return { path: p, error: e.message };
      }
    }
  }
  return null;
}
// 返回不一致项（空数组 = 两侧对齐）
export function contractIssues(decl) {
  const bad = [];
  if (!decl) return ["未找到拼图侧的 compat.json（互校无从进行）"];
  if (decl.contract !== COMPAT_CONTRACT) bad.push(`契约名不一致：${decl.contract} != ${COMPAT_CONTRACT}`);
  if (decl.ig5TailOrder !== IG5_TAIL_ORDER) bad.push(`末位锚点不一致：拼图记 ${decl.ig5TailOrder} / 本仓 ${IG5_TAIL_ORDER}`);
  if (decl.puzzleDefaultOrder !== PZ_ORDER_FORK_DEFAULT) bad.push(`拼图默认段序不一致：拼图记 ${decl.puzzleDefaultOrder} / 本仓记 ${PZ_ORDER_FORK_DEFAULT}`);
  if (!(decl.puzzleDefaultOrder < decl.ig5TailOrder)) bad.push(`段序关系不成立：${decl.puzzleDefaultOrder} 未小于 ${decl.ig5TailOrder}`);
  return bad;
}


// ── 文本层契约（v0.59.4）：三条分工规则的可核关键词，与拼图侧 compat.json 的 textProbes 同源 ──
// 每条规则左右各一个关键词：右侧（ig5）必须出现在本文件的仲裁行里，左侧（puzzle）必须出现在
// 拼图侧的政策文本里。两侧 verify 都读这张表并互相核对 —— 改文案而没同步 → 两侧同时红。
export const COMPAT_TEXT_PROBES = {
  domain: { puzzle: "交付物内容与形态", ig5: "归无限五代" },
  "ask-quota": { puzzle: "提问额度按轮的", ig5: "同一轮最多一问" },
  "batch-first": { puzzle: "不做打断者", ig5: "批量合同优先" },
  "tool-shape": { puzzle: "按各自 schema 给", ig5: "既有工具 schema 不受" },
  "stop-semantics": { puzzle: "不回退", ig5: "只停动作" },
  "tail-concede": { puzzle: "早于它的末位锚点", ig5: "只声明本载荷末位" },
};
export function textProbeIssues(decl, ownText, otherText) {
  const bad = [];
  const table = (decl && decl.textProbes) || null;
  if (!table) return ["对方 compat.json 未声明 textProbes（文本层互校无从进行）"];
  for (const [id, pair] of Object.entries(COMPAT_TEXT_PROBES)) {
    const theirs = table[id];
    if (!theirs) { bad.push(`对方缺规则 ${id}`); continue; }
    if (theirs.puzzle !== pair.puzzle || theirs.ig5 !== pair.ig5) {
      bad.push(`规则 ${id} 关键词不一致：对方 ${JSON.stringify(theirs)} / 本仓 ${JSON.stringify(pair)}`);
    }
    if (ownText !== null && !ownText.includes(pair.ig5)) bad.push(`本仓文本缺 ${id} 关键词「${pair.ig5}」`);
    if (otherText !== null && !otherText.includes(pair.puzzle)) bad.push(`对方文本缺 ${id} 关键词「${pair.puzzle}」`);
  }
  return bad;
}
export const COMPAT_PUZZLE_TEXT_PATHS = [
  "/root/S/dsh-puzzle-mode-2/lib/index.js",
  "/root/.dsh/plugin-src/dsh-puzzle-mode/lib/index.js",
];

export function arbitrationLine() {
  // 数字一律插值，别再写字面量 —— 写死过一次（10100），改常量时这行没跟上，自检当场报 ERROR。
  return `[跨插件仲裁] 本机同时装有 dsh-puzzle-mode（段 ${PZ_SECTION}；上游 0.19.7 为 order ${PZ_ORDER_UPSTREAM_0197}，复刻仓/上游 ≥0.22.0 默认 ${PZ_ORDER_FORK_DEFAULT} —— 前者排在无限五代末位锚点 ${IG5_TAIL_ORDER} 之后，后者排在其前）：① 交付物内容与形态归无限五代，拼图文档与采访节奏归拼图模式；② 采访轮/审查轮按拼图提问额度，其余场景同一轮最多一问；③ 整批题在场时批量合同优先（不采访、不中停），拼图文档一轮结束后幂等回写；④ 拼图文档只走 puzzle_mode，既有工具 schema 不受「参数扁平」约束；⑤ 末位锚点只声明本载荷末位；⑥ 拼图的「停下」只停动作，不回退已交付。`;
}

export function arbitrate(ctx = {}) {
  const batch = !!ctx.batch;
  const interview = !!ctx.interview;
  if (batch) return { owner: "ig5", kind: "batch-first", rule: ARBITRATION_RULES[2].rule };
  if (interview) return { owner: "puzzle", kind: "interview", rule: ARBITRATION_RULES[1].rule };
  return { owner: "ig5", kind: "default", rule: ARBITRATION_RULES[0].rule };
}
