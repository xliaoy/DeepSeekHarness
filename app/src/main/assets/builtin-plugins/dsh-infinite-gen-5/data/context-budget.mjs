/**
 * context-budget — 「这一轮出门要带多少字节」的前置预算器。
 *
 * 背景：上游 502 / 413 里有一类是**请求体太大**（而不是上游瞬时故障）。
 * 宿主的报错只给状态码，不给体量，所以出事时无从判断「是不是我自己塞太多」。
 * 这个模块做三件事，全部是纯函数，不碰网络、不碰会话文件：
 *
 *   ① 分账：把一次出站请求拆成 system / 工具 schema / 历史 / 当前轮 四笔账，
 *      指出「谁在吃预算」——通常历史里的大块工具回执才是元凶。
 *   ② 分级瘦身（可选）：先裁大回执、再合并重复正文、最后丢最旧的完整轮。
 *      每一级都保持宿主的协议不变量，**绝不**用「撕掉 tool_result」这种会
 *      触发 INVALID_REQUEST 的省字节法。
 *   ③ 报账：瘦身前后字节数、各级裁掉多少、被裁掉的位置，都逐条列出。
 *
 * 协议不变量（宿主 dsh-llm-deepseek 侧会校验，违反即请求被拒）：
 *   - assistant 的 tool_use id 不得重复；
 *   - user 的 tool_result 必须匹配前一条 assistant 的调用；
 *   - 历史不得以「未闭合的 tool_use」结尾；
 *   - system 只允许一条（数组形态的 system 直接判坏）。
 *
 * 四条瘦身铁律（本模块自我约束，测试里逐条断言）：
 *   1. 只裁 tool_result 的正文，不删 block、不改 id、不动顺序配对；
 *   2. 同一条消息里 tool_use 一律排到 tool_result 前面；
 *   3. 落刀后如果遇到「末尾是未闭合 tool_use」，把那条整体撤掉，而不是留半截；
 *   4. 当前轮（最后一条消息）永不裁、永不丢 —— 裁了等于改了这轮的需求本身。
 */

export const BUDGETER_VERSION = "context-budget@0.1.0";

/** 预算档（字节）。默认软上限来自实测：探针到 7813 KiB 仍 200，但真实会话里 256 KiB 以上就开始不划算。 */
export const BUDGET_CEILING = {
	lean: 64 * 1024,
	normal: 256 * 1024,
	wide: 1024 * 1024,
	probe: 8 * 1024 * 1024,
};
export const DEFAULT_CEILING_BYTES = BUDGET_CEILING.normal;

/** 单个工具回执允许保留的上限（字节），超过即按头尾保留裁剪。 */
export const DEFAULT_TOOL_RESULT_CAP = 4096;
/** 裁剪时头部/尾部的保留比例（头 70% 尾 30%，中间用标记替代）。 */
const HEAD_RATIO = 0.7;
/** 认作「大回执」的阈值：低于此值不值得裁（裁了也省不到字节，还把可读性弄没）。 */
const BIG_RESULT_BYTES = 1024;

export function byteLengthOf(v) {
	if (typeof v === "string") return Buffer.byteLength(v, "utf8");
	if (v === null || v === undefined) return 0;
	try {
		return Buffer.byteLength(JSON.stringify(v), "utf8");
	} catch {
		return 0;
	}
}

export function roughTokens(text) {
	const s = typeof text === "string" ? text : JSON.stringify(text ?? "");
	let cjk = 0;
	for (const ch of s) if (ch.charCodeAt(0) > 0x2e7f) cjk++;
	return Math.round(cjk + (s.length - cjk) / 4);
}

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** 把一条消息的 content 统一成 block 数组（字符串 => 单个 text block）。 */
function blocksOf(message) {
	if (typeof message?.content === "string") return [{ type: "text", text: message.content }];
	return asArray(message?.content);
}

function blockKind(b) {
	const t = typeof b?.type === "string" ? b.type : "";
	if (t === "tool_use") return "tool_use";
	if (t === "tool_result") return "tool_result";
	if (t === "thinking" || t === "redacted_thinking") return "thinking";
	return "text";
}

/** tool_result 的正文（可能是字符串或嵌套 block 数组）。 */
function resultText(b) {
	const c = b?.content;
	if (typeof c === "string") return c;
	if (Array.isArray(c)) return c.map((x) => (typeof x === "string" ? x : (x?.text ?? ""))).join("\n");
	return "";
}

function withResultText(b, text) {
	const c = b?.content;
	if (typeof c === "string" || c == null) return { ...b, content: text };
	return { ...b, content: [{ type: "text", text }] };
}

/** 稳定摘要：用于识别「同一段正文重复出现」。 */
function digest(text) {
	const s = typeof text === "string" ? text : "";
	let h1 = 0x811c9dc5;
	let h2 = 0x1000193;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
		h2 = (Math.imul(h2, 31) + c) >>> 0;
	}
	return `${s.length}:${h1.toString(36)}${h2.toString(36)}`;
}

/** 头尾保留式裁剪：中间换成一个可核对的标记（含被裁字节数）。 */
export function clipText(text, cap, label = "裁剪") {
	const s = typeof text === "string" ? text : "";
	if (cap <= 0 || byteLengthOf(s) <= cap) return { text: s, clipped: 0 };
	const total = byteLengthOf(s);
	// cap 是「估算用」的宽松上限：真正的约束是标记本身不能把结果撑回去，
	// 所以先切头尾，再按标记实际占用的字节反算被省略多少（保证标签里的数字与对外的 clipped 一致）。
	const budget = Math.max(1, cap - 64);
	const head = Math.max(1, Math.floor(budget * HEAD_RATIO));
	const tail = Math.max(1, budget - head);
	// 按字节安全切：先切字符再回退，避免把多字节汉字切成半个。
	let h = s.slice(0, head);
	while (byteLengthOf(h) > head && h.length > 1) h = h.slice(0, -1);
	let t = s.slice(-tail);
	while (byteLengthOf(t) > tail && t.length > 1) t = t.slice(1);
	let omitted = total - byteLengthOf(h) - byteLengthOf(t);
	const out = `${h}\n…[${label} ${omitted} B，原文 ${total} B]…\n${t}`;
	const after = byteLengthOf(out);
	const markerBytes = after - byteLengthOf(h) - byteLengthOf(t);
	return { text: out, clipped: Math.max(0, total - after), omitted, markerBytes, before: total, after };
}

/** 分账：把一次请求拆成 system / tools / 历史 / 当前轮。 */
export function account(request) {
	const body = request?.body ?? request ?? {};
	const messages = asArray(body.messages);
	const tools = asArray(body.tools);
	const systemBytes = byteLengthOf(body.system);
	const toolsBytes = byteLengthOf(tools);
	let historyBytes = 0;
	const per = [];
	messages.forEach((m, i) => {
		const b = byteLengthOf(m);
		per.push({ index: i, role: m?.role ?? "?", bytes: b, blocks: blocksOf(m).length, current: i === messages.length - 1 });
		if (i !== messages.length - 1) historyBytes += b;
	});
	const currentBytes = messages.length > 0 ? byteLengthOf(messages[messages.length - 1]) : 0;
	const top = [...per].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
	// 分账的四个桶都是「内容」的原始字节，JSON 信封（字段名、引号、逗号、方括号）
	// 与内容无关，单列一笔 envelopeBytes，避免出现「四桶之和对不上总数」的假不一致。
	const partsSum = systemBytes + toolsBytes + historyBytes + currentBytes;
	const total = byteLengthOf(body);
	const envelopeBytes = Math.max(0, total - partsSum);
	return {
		systemBytes,
		toolsBytes,
		historyBytes,
		currentBytes,
		partsSum,
		envelopeBytes,
		total,
		messages: messages.length,
		per,
		top,
		tools: tools.length,
	};
}

/** 契约体检（与 payload-contract 同口径，这里只做瘦身后复检用的最小集）。 */
export function checkInvariants(messages) {
	const list = asArray(messages);
	const issues = [];
	const seen = new Map();
	const pending = new Map();
	for (let i = 0; i < list.length; i++) {
		const m = list[i];
		const blocks = blocksOf(m);
		// 同一条消息内 tool_use 一律先于 tool_result 消费（宿主就是这样按块顺序走的），
		// 所以先扫调用、再扫回执，块顺序反了也能正确配对。
		const callsHere = new Map();
		for (const b of blocks) {
			if (blockKind(b) !== "tool_use") continue;
			const id = b?.id ?? "";
			if (!id) issues.push({ code: "tool-use-no-id", index: i, id: "", msg: `第 ${i} 条 assistant 的 tool_use 没有 id` });
			seen.set(id, (seen.get(id) ?? 0) + 1);
			callsHere.set(id, (callsHere.get(id) ?? 0) + 1);
			pending.set(id, (pending.get(id) ?? 0) + 1);
		}
		for (const [id, n] of callsHere) if (n > 1) issues.push({ code: "dup-tool-id", index: i, id, msg: `第 ${i} 条消息内重复调用 id ${id} ×${n}（宿主会直接拒）` });
		for (const b of blocks) {
			if (blockKind(b) !== "tool_result") continue;
			const id = b?.tool_use_id ?? "";
			const n = pending.get(id) ?? 0;
			if (!id || n <= 0) issues.push({ code: "orphan-tool-result", index: i, id, msg: `第 ${i} 条的 tool_result ${id || "(无 id)"} 找不到对应的调用` });
			else pending.set(id, n - 1);
		}
	}
	for (const [id, n] of pending) if (n > 0) issues.push({ code: "history-ends-open", index: list.length - 1, id, msg: `历史以未闭合调用结尾（${id} 还差 ${n} 个回执）` });
	// 跨轮复用 id：宿主实测接受（只在同一消息内判重复），所以这里只记录不判坏。
	const reused = [...seen].filter(([, n]) => n > 1).map(([id, n]) => ({ id, times: n }));
	return { ok: issues.length === 0, issues, reusedIds: reused };
}

/** tier A：裁大工具回执（只动正文，不删 block、不动 id）。 */
export function slimResults(messages, opts = {}) {
	const cap = opts.toolResultCap ?? DEFAULT_TOOL_RESULT_CAP;
	const list = asArray(messages);
	const actions = [];
	let freed = 0;
	const out = list.map((m, i) => {
		if (i === list.length - 1) return m; // 当前轮不动
		const blocks = blocksOf(m);
		let touched = false;
		const nextBlocks = blocks.map((b) => {
			if (blockKind(b) !== "tool_result") return b;
			const text = resultText(b);
			const bytes = byteLengthOf(text);
			if (bytes <= Math.max(cap, BIG_RESULT_BYTES)) return b;
			const { text: clipped, clipped: n } = clipText(text, cap, "回执裁剪");
			touched = true;
			freed += n;
			actions.push({ tier: "A", message: i, block: b?.type, toolUseId: b?.tool_use_id ?? "", before: bytes, after: byteLengthOf(clipped), freed: n });
			return withResultText(b, clipped);
		});
		return touched ? { ...m, content: nextBlocks } : m;
	});
	return { messages: out, freed, actions };
}

/** tier B：同段正文在多条回执里重复出现时，只留最新一次，早的换成指针。 */
export function dedupeBodies(messages, opts = {}) {
	const minBytes = opts.dedupeMinBytes ?? 2048;
	const list = asArray(messages);
	const lastSeen = new Map(); // digest → 最新出现的消息下标
	const out = list.map((m, i) => {
		if (i === list.length - 1) return m;
		for (const b of blocksOf(m)) {
			if (blockKind(b) !== "tool_result") continue;
			const t = resultText(b);
			if (byteLengthOf(t) >= minBytes) lastSeen.set(digest(t), i);
		}
		return m;
	});
	const actions = [];
	let freed = 0;
	const next = list.map((m, i) => {
		if (i === list.length - 1) return m;
		const blocks = blocksOf(m);
		let touched = false;
		const nb = blocks.map((b) => {
			if (blockKind(b) !== "tool_result") return b;
			const t = resultText(b);
			const d = digest(t);
			if (byteLengthOf(t) < minBytes || lastSeen.get(d) === i) return b;
			const stub = `…[重复正文 ${byteLengthOf(t)} B，与后文同摘要 ${d}，此处折叠]…`;
			const n = byteLengthOf(t) - byteLengthOf(stub);
			if (n <= 0) return b;
			touched = true;
			freed += n;
			actions.push({ tier: "B", message: i, digest: d, before: byteLengthOf(t), after: byteLengthOf(stub), freed: n, kept: lastSeen.get(d) });
			return withResultText(b, stub);
		});
		return touched ? { ...m, content: nb } : m;
	});
	return { messages: next, freed, actions };
}

/**
 * 归一化 block 顺序：同一条消息里 tool_use 一律在 tool_result 之前。
 * 这是宿主侧实际接受的口径；顺序反了会被判 INVALID_REQUEST。
 */
export function normalizeBlockOrder(messages) {
	const list = asArray(messages);
	let moved = 0;
	const out = list.map((m) => {
		const blocks = blocksOf(m);
		if (blocks.length < 2) return m;
		const rank = (b) => (blockKind(b) === "tool_use" ? 0 : blockKind(b) === "tool_result" ? 2 : 1);
		const sorted = [...blocks].sort((a, b) => rank(a) - rank(b));
		const changed = sorted.some((b, i) => b !== blocks[i]);
		if (changed) moved++;
		return changed ? { ...m, content: sorted } : m;
	});
	return { messages: out, moved };
}

/** tier C：从最旧处丢弃完整轮；只允许落在「轮边界」，绝不把回执与它的调用劈开。 */
export function dropOldest(messages, opts = {}) {
	const need = opts.needBytes ?? 0;
	const minKeep = opts.minKeepMessages ?? 4;
	const list = asArray(messages);
	const actions = [];
	let freed = 0;

	/**
	 * 轮边界判定：丢掉 [0, i) 之后，新的第 i 条**不能**是装载 tool_result 的 user 消息，
	 * 否则它的调用还在被丢掉的那半截里 → 宿主判 orphan-tool-result。
	 * 遇到这种位置就往后挪到第一个安全点。
	 */
	const isResultCarrier = (m) => blocksOf(m).some((b) => blockKind(b) === "tool_result");
	const safeBoundary = (i) => {
		let k = i;
		while (k < list.length && isResultCarrier(list[k])) k++;
		return k;
	};

	let keepFrom = 0;
	let blocked = false;
	for (let i = 0; i < list.length && keepFrom < list.length && freed < need; i++) {
		const at = safeBoundary(i);
		if (at <= keepFrom) continue; // 这个位置没有可释放的整块
		if (list.length - at < minKeep) {
			blocked = true; // 再切就会低于保留下限
			break;
		}
		for (let j = keepFrom; j < at; j++) {
			const dropped = list[j];
			freed += byteLengthOf(dropped);
			actions.push({ tier: "C", message: j, role: dropped?.role ?? "?", freed: byteLengthOf(dropped) });
		}
		keepFrom = at;
	}

	const kept = list.slice(keepFrom);
	const inv = checkInvariants(kept);
	return { messages: kept, freed, actions, dropped: keepFrom, blockedByMinKeep: blocked, invariants: inv };
}

/** 预检：不瘦身，只告诉你会不会超、谁在吃预算。 */
export function preflight(request, opts = {}) {
	const ceiling = opts.ceiling ?? DEFAULT_CEILING_BYTES;
	const a = account(request);
	const verdict = a.total <= ceiling ? "ok" : a.total <= ceiling * 2 ? "warn" : "hot";
	const advice = [];
	if (verdict !== "ok") {
		const biggest = a.top.find((x) => !x.current);
		advice.push(`最大的一笔是第 ${biggest?.index} 条（${biggest?.role}，${biggest?.bytes} B）——先看它是不是一条超大工具回执`);
		advice.push(`历史 ${a.historyBytes} B / 当前轮 ${a.currentBytes} B / system ${a.systemBytes} B / tools ${a.toolsBytes} B`);
		advice.push("跑 node scripts/trim_request.mjs --messages FILE 按 A→B→C 顺序瘦身");
	}
	return { version: BUDGETER_VERSION, ceiling, verdict, ...a, advice };
}

/** 主入口：按 A→B→C 逐级瘦身，每级之后复检契约，始终不动当前轮。 */
export function trim(request, opts = {}) {
	const ceiling = opts.ceiling ?? DEFAULT_CEILING_BYTES;
	const body = request?.body ?? request ?? {};
	const messages = asArray(body.messages);
	const tiers = opts.tiers ?? ["A", "B", "C"];
	const before = byteLengthOf(body);
	const log = [];
	let cur = messages;
	let totalFreed = 0;
	/** 用「非 messages 部分固定字节 + 当前 messages」估实时体量，避免每级重算整个 body。 */
	const fixedBytes = before - byteLengthOf({ messages });
	const afterBytes = () => fixedBytes + byteLengthOf({ messages: cur });

	const norm = normalizeBlockOrder(cur);
	cur = norm.messages;
	if (norm.moved > 0) log.push({ tier: "N", moved: norm.moved, freed: 0, note: "同条消息内 tool_use 前移（宿主接受口径）" });

	// 每级的力度随预算缩放：预算小就裁得更狠，别出现「每级都只省一点、最后还是超」。
	const scaled = {
		...opts,
		toolResultCap: opts.toolResultCap ?? Math.max(512, Math.min(DEFAULT_TOOL_RESULT_CAP, Math.floor(ceiling / 8))),
		dedupeMinBytes: opts.dedupeMinBytes ?? Math.max(256, Math.min(2048, Math.floor(ceiling / 16))),
	};

	for (const t of tiers) {
		if (afterBytes() <= ceiling) break;
		if (t === "A") {
			const r = slimResults(cur, scaled);
			cur = r.messages;
			totalFreed += r.freed;
			log.push({ tier: "A", freed: r.freed, cap: scaled.toolResultCap, actions: r.actions });
		} else if (t === "B") {
			const r = dedupeBodies(cur, scaled);
			cur = r.messages;
			totalFreed += r.freed;
			log.push({ tier: "B", freed: r.freed, floor: scaled.dedupeMinBytes, actions: r.actions });
		} else if (t === "C") {
			const need = afterBytes() - ceiling;
			const r = dropOldest(cur, { needBytes: need, minKeepMessages: opts.minKeepMessages ?? 4 });
			cur = r.messages;
			totalFreed += r.freed;
			log.push({ tier: "C", freed: r.freed, dropped: r.dropped, blockedByMinKeep: r.blockedByMinKeep, actions: r.actions });
		}
	}

	const outBody = { ...body, messages: cur };
	const inv = checkInvariants(cur);
	const after = byteLengthOf(outBody);
	return {
		version: BUDGETER_VERSION,
		ceiling,
		body: outBody,
		messagesOut: cur.length,
		messagesIn: messages.length,
		before,
		after,
		freed: before - after,
		log,
		invariants: inv,
		ok: inv.ok,
		overBudget: after > ceiling,
	};
}

/* ------------------------------------------------------------------ *
 * 系统提示段预算（v0.47.0）：把「本轮装配出来的系统提示」也纳入预算。
 *
 * 背景：消息历史可以靠 trim() 瘦，但系统提示同样吃上下文窗口 —— 内核 + 增强集
 * + 惰性章节 + 批量臂叠起来能到几百 KB，占掉窗口的一大块。这里做的是**只动自己的段**：
 * 宿主的段（工具用法/沙箱策略/宿主身份）一个字节都不碰，改不了也不该改。
 *
 * 分级（阶梯式，每级只多丢一样东西，便于回退与观测）：
 *   full   全量：都保留
 *   lean-1 丢批量臂（只在整批题场景有用，单轮对话里是纯占位）
 *   lean-2 再丢增强集
 *   lean-3 再把惰性章节降级成一行指针（告诉模型原文在哪，而不是整段搬进来）
 * 内核与两个锚点永不丢 —— 丢了就不是「少带点」而是「换了个人」。
 * ------------------------------------------------------------------ */

/** 永不降级的段名后缀（内核 + 两个锚点）。 */
export const PROTECTED_SECTION_HINTS = ["order-100", "kernel", "tail-anchor", "runtime-anchor"];

export const SECTION_TIERS = ["full", "lean-1", "lean-2", "lean-3"];

/** 段名 → 可降级等级（越小的等级越先被丢）。返回 null 表示受保护、永不丢。 */
export function droppableRankOf(name) {
	const n = String(name ?? "").toLowerCase();
	if (PROTECTED_SECTION_HINTS.some((h) => n.includes(h))) return null;
	if (n.includes("batch-arm")) return 1;
	if (n.includes("boost-corpus") || n.includes("boost")) return 2;
	if (n.includes("lazy-sections") || n.includes("lazy")) return 3;
	// 路由条款（CoT Router 注入段）与惰性章节同命：窗口紧时同样只留一行指针 ——
	// 它的正文就在模块里，指针照样能把「按需拼回」的规则告诉模型，不必整段占窗口。
	if (n.includes("tuning-clause") || n.includes("router-clause")) return 3;
	// 认不出来的段一律当受保护：宁可少省，也不误丢。
	return null;
}

/**
 * 按窗口预算决定系统提示该停在哪一级。
 *
 * @param {Array<{name?:string,text?:string}>} sections 装配出来的段
 * @param {{ceiling?:number,shareCap?:number,mode?:string}} opts
 *   ceiling  上下文窗口字节（默认 normal 256 KiB）
 *   shareCap 系统提示最多占窗口的比例（默认 0.25）
 *   mode     off = 只观测不降级
 */
export function planSectionBudget(sections, opts = {}) {
	const list = asArray(sections).filter(Boolean);
	const ceiling = Number(opts.ceiling) > 0 ? Number(opts.ceiling) : DEFAULT_CEILING_BYTES;
	const shareCap = Number(opts.shareCap) > 0 ? Number(opts.shareCap) : 0.25;
	const mode = opts.mode === "off" ? "off" : opts.mode === "apply" ? "apply" : "warn";

	const per = list.map((s, i) => ({
		index: i,
		name: s.name ?? `#${i}`,
		bytes: byteLengthOf(s.text ?? ""),
		rank: droppableRankOf(s.name),
	}));
	const total = per.reduce((a, x) => a + x.bytes, 0);
	const target = Math.floor(ceiling * shareCap);
	const share = ceiling > 0 ? total / ceiling : 0;

	let budgetTotal = total;
	const drop = [];
	for (const tier of SECTION_TIERS.slice(1)) {
		const rank = SECTION_TIERS.indexOf(tier);
		if (budgetTotal <= target) break;
		for (const x of per) {
			if (x.rank !== rank) continue;
			budgetTotal -= x.bytes;
			drop.push({ name: x.name, bytes: x.bytes, keptAs: "dropped", tier, rank: x.rank });
		}
	}
	const tier = drop.length === 0 ? "full" : SECTION_TIERS[Math.min(3, Math.max(...drop.map((d) => SECTION_TIERS.indexOf(d.tier))))];

	const protectedBytes = per.filter((x) => x.rank === null).reduce((a, x) => a + x.bytes, 0);
	const issues = [];
	if (protectedBytes > target) {
		issues.push({
			code: "protected-over-cap",
			detail: `受保护段 ${protectedBytes} B 已超过系统提示配额 ${target} B —— 只能靠关档位/换小内核解决，不在这里动刀`,
		});
	}
	if (mode === "off" && total > target) {
		issues.push({ code: "observed-only", detail: `mode=off：只报数不降级，本轮超配额 ${total - target} B` });
	}

	return {
		version: BUDGETER_VERSION,
		mode,
		tier,
		ceiling,
		shareCap,
		target,
		before: total,
		after: budgetTotal,
		freed: total - budgetTotal,
		share,
		verdict: total <= target ? "ok" : total <= target * 1.5 ? "warn" : "hot",
		per,
		drop,
		protectedBytes,
		issues,
	};
}

/**
 * 按 plan 把段表实际裁剪一遍（纯函数，返回新数组）。
 * 只删自己那些可降级段；惰性章节降级时换成一枚一行指针，而不是静默消失。
 */
export function applySectionPlan(sections, plan, opts = {}) {
	const list = asArray(sections).filter(Boolean);
	if (!plan || plan.tier === "full") return { sections: list.slice(), dropped: [], swapped: [] };
	const droppedNames = new Set(plan.drop.map((d) => d.name));
	const pointerOf = typeof opts.pointerOf === "function" ? opts.pointerOf : null;
	const out = [];
	const dropped = [];
	const swapped = [];
	list.forEach((s, i) => {
		const name = s.name ?? `#${i}`;
		if (!droppedNames.has(name)) {
			out.push(s);
			return;
		}
		const rank = droppableRankOf(name);
		if (rank === 3 && pointerOf) {
			// 指针话术交给调用方：把整段（含 name 与原文体量）传过去，「丢了多大一块」才写得出。
			const text = pointerOf({ ...s, name }, s.text);
			if (typeof text === "string" && text.length > 0) {
				out.push({ ...s, text });
				swapped.push({ name, before: byteLengthOf(s.text ?? ""), bytes: byteLengthOf(text) });
				return;
			}
		}
		dropped.push({ name, bytes: byteLengthOf(s.text ?? "") });
	});
	return { sections: out, dropped, swapped };
}
