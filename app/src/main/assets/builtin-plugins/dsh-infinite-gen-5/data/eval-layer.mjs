// 无限五代 · 评估层开关（v0.52.3）—— 纯函数层
//
// 需求：评估相关的思维链（评分接口 / 写作侧六条 / 元认知自评 / 评估纪律）默认**不注入**，
// 用户开了才注入；开了以后模型在对话总结 / 收尾时做一次评估，不开就完全不评估。
//
// 两条路径，各管一半：
//   关档 → stripEvalDirectives() 把常驻内核与惰性拼回里的评估段整块摘掉（指针行也摘，
//          否则指针还在、惰性单元照旧被拼回）；
//   开档 → renderEvalLayer() 额外补一段 Order 9600「评估层」，把评估时机钉在总结/收尾。
//
// 摘除一律**按字面标记**做，标记对不上就原样返回并如实报告 —— 宁可不摘，也不误删内核。

/** 评估相关的惰性单元 id（关档时这些单元既不拼回、指针行也摘掉）。 */
export const EVAL_LAZY_IDS = ["L_writing6", "L_meta", "L_eval"];

/** 常驻内核里评估块的起止标记（逐字取自 prompts/infinite-gen-5.md）。 */
export const EVAL_BLOCK_START = "Scoring interface — calibration is a scored dimension";
export const EVAL_BLOCK_END = "（惰性 L_writing6：";

/** 常驻内核里的评估指针行前缀。 */
export const EVAL_POINTER_PREFIXES = ["【惰性 L_meta｜", "【惰性 L_eval｜"];

export const EVAL_LAYER_ORDER = 9600;
export const EVAL_LAYER_SECTION = "infinite-gen-5:eval-layer";

function cutBlock(text, startMark, endMark) {
  const a = text.indexOf(startMark);
  if (a < 0) return { text, hit: false, reason: `未见起始标记「${startMark.slice(0, 24)}…」` };
  const e = text.indexOf(endMark, a);
  if (e < 0) return { text, hit: false, reason: `未见结束标记「${endMark.slice(0, 16)}…」` };
  const end = e + endMark.length;
  // 连同该行剩余内容与随后的空行一起吃掉
  const tail = text.indexOf("\n", end);
  const stop = tail >= 0 && text.slice(end, tail).trim() === "" ? tail : end;
  return { text: text.slice(0, a) + text.slice(stop), hit: true, reason: "评分接口块" };
}

function cutPointerLines(text, prefixes) {
  const lines = text.split("\n");
  const kept = [];
  let hit = 0;
  for (const line of lines) {
    if (prefixes.some((p) => line.startsWith(p))) {
      hit += 1;
      continue;
    }
    kept.push(line);
  }
  return { text: kept.join("\n"), hit, reason: `指针行 ×${hit}` };
}

function cutUnits(text, ids) {
  let out = text;
  let hit = 0;
  for (const id of ids) {
    const startMark = `@@unit:${id}|`;
    const a = out.indexOf(startMark);
    if (a < 0) continue;
    const next = out.indexOf("@@unit:", a + startMark.length);
    out = out.slice(0, a) + (next >= 0 ? out.slice(next) : "");
    hit += 1;
  }
  return { text: out, hit, reason: `惰性单元 ×${hit}` };
}

/**
 * 摘掉评估相关的注入片段。
 * @returns {{text:string, changed:boolean, hit:boolean, reasons:string[], missing:string[]}}
 */
export function stripEvalDirectives(text) {
  const src = String(text ?? "");
  if (!src) return { text: src, changed: false, hit: false, reasons: [], missing: ["空文本"] };
  const reasons = [];
  const missing = [];
  const block = cutBlock(src, EVAL_BLOCK_START, EVAL_BLOCK_END);
  if (block.hit) reasons.push(block.reason);
  else missing.push(block.reason);
  const ptr = cutPointerLines(block.text, EVAL_POINTER_PREFIXES);
  if (ptr.hit) reasons.push(ptr.reason);
  else missing.push(ptr.reason);
  const units = cutUnits(ptr.text, EVAL_LAZY_IDS);
  if (units.hit) reasons.push(units.reason);
  let out = units.text.replace(/\n{3,}/g, "\n\n");
  return { text: out, changed: out !== src, hit: reasons.length > 0, reasons, missing };
}

/** 开档时补的评估层：把「什么时候评估」钉死在总结 / 收尾。 */
export function renderEvalLayer() {
  return [
    "## 评估层（Order 9600 · 开关档）",
    "本档已开启：交付收尾或对话总结时做**一次**评估，写完就停，不追问、不扩散。",
    "1) 逐条引原句：评估只引用本轮实际写出的句子，不转述、不概括成「大致给了」。",
    "2) 三态分开：已知（本会话实测 / 读到的文件）· 推测（写明依据）· 未知（还缺什么）。",
    "3) 四态同框：出现版本 / 日期 / 命中率 / 存活期 / 兼容性任一断言时，节末给四态小表；无时间断言不建表。",
    "4) 不做分数表演：评估是测量不是刷分，不为了好看调整边界或追分。",
    "5) 关档时本层不存在：没有本层就不要输出评估段落。",
  ].join("\n");
}
