/**
 * payload-contract — Messages / chat-completions 请求体的「契约体检」纯函数层。
 *
 * 为什么要它：「DeepSeek Messages request failed (502)」这条报错只带状态码，
 * 不带原因（providerError 在没有 JSON 信封时回落到模板串）。真正能定性的信息
 * 只有两处：① 发出去的请求体结构对不对；② 网关回的响应体里到底写了什么。
 * 本文件负责 ①，scripts/probe_llm_request.mjs 负责把 ② 抠出来。
 *
 * 判据来源（可复核，非臆测）：
 *   - dsh-llm-deepseek/lib/index.js:1761-1775 —— assistant 的 tool_use id 不能重复；
 *     user 的 tool_result 必须能匹配到前一条 assistant 的调用；历史不能以未闭合调用结尾。
 *   - 同文件 1785-1796 —— 出站字段固定为 model/stream/messages/max_tokens/thinking/
 *     output_config/system/temperature/stop_sequences/tools，各工具只带
 *     name/description/input_schema/defer_loading。
 *   - 同文件 1820-1836 —— providerError 的 code 判定：401/403→AUTH、429→RATE_LIMIT、
 *     5xx 或 api_error→SERVER、400/413→INVALID_REQUEST。
 *
 * 纯函数：不读盘、不联网、不改入参。
 */

export const PAYLOAD_CONTRACT_VERSION = "payload-contract@0.1.0";

/** 单请求体字节数的风险带（保守；上游/网关各自的硬阈值不公开，故写成三档提示而非判死）。 */
export const BODY_BANDS = [
	{ id: "ok", max: 1_000_000, note: "常规区间" },
	{ id: "warn", max: 4_000_000, note: "偏大：网关有缓冲上限时会掉连接（典型表现即 502）" },
	{ id: "hot", max: Number.POSITIVE_INFINITY, note: "很大：先怀疑体量，再怀疑协议" },
];

export function byteLengthOf(value) {
	if (value === void 0 || value === null) return 0;
	if (typeof value === "string") return Buffer.byteLength(value, "utf8");
	try {
		return Buffer.byteLength(JSON.stringify(value), "utf8");
	} catch {
		return 0;
	}
}

/** 粗略 token 估算：ASCII 4 B/token，CJK 约 1 token/字。只做量级判断，不当计费依据。 */
export function roughTokens(text) {
	const s = typeof text === "string" ? text : "";
	if (s === "") return 0;
	const cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/gu) ?? []).length;
	const rest = s.length - cjk;
	return cjk + Math.ceil(rest / 4);
}

export function bandOf(bytes) {
	const found = BODY_BANDS.find((b) => bytes <= b.max);
	return found ? { id: found.id, note: found.note } : { id: "hot", note: BODY_BANDS.at(-1).note };
}

const contentOf = (message) => (Array.isArray(message?.content) ? message.content : []);
const typeOf = (block) => (typeof block?.type === "string" ? block.type : "");
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 对一份请求体做契约体检。
 * @param body - 出站 JSON 对象（Anthropic Messages 形态；chat/completions 形态会自动降级为只查 messages）
 * @returns {{ ok, issues, stats, band }} issues 里每条的 { level, code, where, detail, fix }
 */
export function inspectBody(body) {
	const issues = [];
	const b = isObject(body) ? body : {};
	const messages = Array.isArray(b.messages) ? b.messages : [];
	if (messages.length === 0) {
		issues.push({
			level: "error",
			code: "no-messages",
			where: "messages",
			detail: "messages 为空或不是数组",
			fix: "至少放一条 user 消息；空 messages 会被上游按非法请求拒掉",
		});
	}

	let pending = new Map();
	let roles = 0;
	for (let i = 0; i < messages.length; i += 1) {
		const message = messages[i];
		const role = typeof message?.role === "string" ? message.role : "";
		const where = `messages[${i}]`;
		if (role === "") {
			issues.push({ level: "error", code: "no-role", where, detail: "缺 role", fix: "补 role（system/user/assistant）" });
			continue;
		}
		if (message.content === void 0 || message.content === null) {
			issues.push({
				level: "error",
				code: "no-content",
				where,
				detail: `${role} 消息的 content 是 ${String(message.content)}`,
				fix: "content 必须是字符串或内容块数组；undefined 会在 JSON 里整个键消失 → 上游 400",
			});
			continue;
		}
		if (role === "user" || role === "assistant") roles += 1;

		if (role === "assistant") {
			const calls = contentOf(message).filter((block) => typeOf(block) === "tool_use");
			const ids = calls.map((c) => (typeof c?.id === "string" ? c.id : ""));
			if (ids.some((id) => id === "")) {
				issues.push({ level: "error", code: "tool-use-no-id", where, detail: "有 tool_use 块缺 id", fix: "给每个调用补唯一 id" });
			}
			// 去重前后各比一次：宿主适配器只用 Set 判「条数对不对」，两条调用同 id 时会漏过，
			// 上游那侧仍可能按重复 id 拒整请求 —— 所以这里两种口径都抓。
			const dupIds = [...new Set(ids.filter((id, i) => id !== "" && ids.indexOf(id) !== i))];
			const setSize = new Set(ids.filter(Boolean)).size;
			if (dupIds.length > 0 || (calls.length > 0 && setSize !== calls.length)) {
				issues.push({
					level: "error",
					code: "dup-tool-id",
					where,
					detail: `tool_use id 重复：${dupIds.length > 0 ? dupIds.join(", ") : `${calls.length} 条调用只有 ${setSize} 个不同 id`}`,
					fix: "调用 id 必须唯一（宿主侧只在条数不符时报错，同 id 两条会漏过 → 靠上游拒）",
				});
			}
			// 闭合集合按出现次数计：同 id 两条调用要两个结果才算闭，否则历史带悬空调用
			pending = new Map();
			for (const id of ids) if (id) pending.set(id, (pending.get(id) ?? 0) + 1);
			for (let k = 0; k < calls.length; k += 1) {
				const args = calls[k]?.input ?? calls[k]?.arguments;
				if (typeof args === "string") {
					let ok = true;
					try {
						JSON.parse(args);
					} catch {
						ok = false;
					}
					if (!ok) {
						issues.push({
							level: "error",
							code: "tool-args-not-json",
							where: `${where}.content[${k}]`,
							detail: `参数串不是合法 JSON（长度 ${args.length}）`,
							fix: "回放历史前把参数串修正为合法 JSON（宿主侧 repairToolArguments 负责；本仓 scripts/patch-host-toolargs.mjs 可检查它有没有打上）",
						});
					}
				}
			}
		} else if (role === "user") {
			const results = contentOf(message).filter((block) => typeOf(block) === "tool_result");
			for (const r of results) {
				const id = typeof r?.tool_use_id === "string" ? r.tool_use_id : "";
				const left = id === "" ? 0 : (pending.get(id) ?? 0);
				if (left <= 0) {
					issues.push({
						level: "error",
						code: "orphan-tool-result",
						where,
						detail: `tool_result 找不到对应调用：${id || "(空 id)"}`,
						fix: "把 tool_result 放进紧跟该调用的那条 user 消息，或删掉这个孤儿结果",
					});
					continue;
				}
				if (left === 1) pending.delete(id);
				else pending.set(id, left - 1);
			}
			if (pending.size > 0) {
				issues.push({
					level: "error",
					code: "call-without-result",
					where,
					detail: `上一条 assistant 的调用没有结果：${[...pending].join(", ")}`,
					fix: "每个 tool_use 必须在下一条 user 里跟一个 tool_result",
				});
			}
		}
	}
	if (pending.size > 0) {
		issues.push({
			level: "error",
			code: "history-ends-open",
			where: "messages.at(-1)",
			detail: `历史以未闭合的调用结尾：${[...pending].join(", ")}`,
			fix: "补上结果，或把这轮的 assistant 调用消息删掉",
		});
	}

	// 工具表：name 必填、input_schema 必须是对象（否则上游可能按非法工具定义拒整请求）
	if (b.tools !== void 0) {
		if (!Array.isArray(b.tools)) {
			issues.push({ level: "error", code: "tools-not-array", where: "tools", detail: `tools 是 ${typeof b.tools}`, fix: "tools 必须是数组" });
		} else {
			b.tools.forEach((tool, i) => {
				const name = typeof tool?.name === "string" ? tool.name : "";
				if (name === "") issues.push({ level: "error", code: "tool-no-name", where: `tools[${i}]`, detail: "工具缺 name", fix: "补 name（出站时只发 name/description/input_schema/defer_loading）" });
				const schema = tool?.input_schema ?? tool?.parameters;
				if (schema === void 0 || schema === null) {
					issues.push({ level: "warn", code: "tool-no-schema", where: `tools[${i}]`, detail: `${name || "?"} 没有 input_schema`, fix: "补一个最小 object schema（{type:'object',properties:{}}）以免上游自行推导" });
				} else if (!isObject(schema)) {
					issues.push({ level: "error", code: "tool-bad-schema", where: `tools[${i}]`, detail: `${name || "?"} 的 input_schema 不是对象`, fix: "input_schema 必须是 JSON Schema 对象" });
				}
			});
		}
	}

	// 字段白名单之外的东西：出站只认固定字段，多发的键会被上游按未知字段处理
	const allowed = new Set(["model", "stream", "messages", "max_tokens", "thinking", "output_config", "system", "temperature", "stop_sequences", "tools"]);
	if (b.system !== void 0 && typeof b.system !== "string" && !Array.isArray(b.system)) {
		issues.push({ level: "error", code: "system-type", where: "system", detail: `system 是 ${typeof b.system}`, fix: "system 必须是字符串（或内容块数组）" });
	}
	if (b.max_tokens !== void 0 && !(Number.isFinite(b.max_tokens) && b.max_tokens > 0)) {
		issues.push({ level: "error", code: "bad-max-tokens", where: "max_tokens", detail: `max_tokens=${String(b.max_tokens)}`, fix: "max_tokens 必须是正数" });
	}

	const perMessage = messages.map((m, i) => ({ index: i, role: typeof m?.role === "string" ? m.role : "?", bytes: byteLengthOf(m) }));
	const bytes = byteLengthOf(b);
	const systemBytes = byteLengthOf(typeof b.system === "string" ? b.system : "");
	const toolBytes = byteLengthOf(b.tools);
	const stats = {
		bytes,
		band: bandOf(bytes),
		messages: messages.length,
		roles,
		turns: Math.ceil(roles / 2),
		systemBytes,
		toolBytes,
		largest: perMessage.slice().sort((a, b2) => b2.bytes - a.bytes).slice(0, 3),
		estTokens: roughTokens(typeof b.system === "string" ? b.system : "") + perMessage.reduce((sum, m) => sum + Math.ceil(m.bytes / 4), 0),
		extraKeys: Object.keys(b).filter((k) => !allowed.has(k)),
	};
	if (stats.extraKeys.length > 0) {
		issues.push({
			level: "warn",
			code: "extra-keys",
			where: "body",
			detail: `带了非出站白名单字段：${stats.extraKeys.join(", ")}`,
			fix: "删掉或确认上游容忍这些字段；协议面越窄越不容易被网关按非法请求拒掉",
		});
	}
	if (stats.band.id !== "ok") {
		issues.push({
			level: "warn",
			code: `body-size-${stats.band.id}`,
			where: "body",
			detail: `请求体 ${bytes} B（${(bytes / 1048576).toFixed(2)} MiB）`,
			fix: stats.band.note,
		});
	}
	return { ok: issues.every((i) => i.level !== "error"), issues, stats, band: stats.band };
}

/** 把 fetch 头/状态归一成一句人话诊断。纯函数，便于自检。 */
export function diagnoseHttp({ status, headers, bodyText, contentType, requestBytes } = {}) {
	const h = (name) => {
		if (headers && typeof headers.get === "function") return headers.get(name) ?? "";
		if (isObject(headers)) return headers[name] ?? headers[name.toLowerCase()] ?? "";
		return "";
	};
	const text = typeof bodyText === "string" ? bodyText : "";
	const trimmed = text.trim();
	const looksHtml = /^<(!doctype|html|head|body)/i.test(trimmed) || (contentType && /text\/html/i.test(contentType));
	let envelope = null;
	try {
		envelope = trimmed === "" ? null : JSON.parse(trimmed);
	} catch {
		envelope = null;
	}
	const errObj = isObject(envelope?.error) ? envelope.error : isObject(envelope) && typeof envelope.message === "string" ? envelope : null;
	const detail = typeof errObj?.message === "string" ? errObj.message : "";
	const upstreamRequestId = h("x-request-id") || h("request-id") || h("x-ds-request-id") || "";
	const retryAfter = h("retry-after");
	const advice = [];
	let cause = "unknown";
	if (status === 502 || status === 503 || status === 504) {
		cause = looksHtml ? "gateway-plain-error" : "upstream-5xx";
		advice.push(looksHtml
			? "回的是网关自己的错误页：请求基本没到模型，先看体量与连接（缓冲上限 / 超时 / 上游掉连接）"
			: "上游 5xx：多为网关或模型侧瞬时故障，重试即可；若每次都挂同一轮，按体量与结构往下查");
	} else if (status === 413) {
		cause = "too-large";
		advice.push("请求体超限：降历史、降注入、再发");
	} else if (status === 400) {
		cause = "bad-request";
		advice.push("结构非法：先跑 inspectBody() 看是哪一条");
	} else if (status === 429) {
		cause = "rate-limit";
		advice.push(retryAfter ? `按 Retry-After=${retryAfter} 退避` : "按指数退避重试");
	} else if (status === 401 || status === 403) {
		cause = "auth";
		advice.push("密钥 / 权限，不是协议问题");
	} else if (status === void 0) {
		cause = "transport";
		advice.push("没拿到状态码：连接层就断了（DNS / TLS / 代理）");
	}
	if (typeof requestBytes === "number" && requestBytes > 4_000_000) advice.push(`本次请求体 ${(requestBytes / 1048576).toFixed(2)} MiB，优先怀疑体量`);
	return {
		status: status ?? null,
		cause,
		detail: detail || (looksHtml ? trimmed.slice(0, 200) : ""),
		upstreamRequestId,
		retryAfter: retryAfter || null,
		looksHtml: Boolean(looksHtml),
		bodyHead: trimmed.slice(0, 400),
		advice,
	};
}

/** 从一段 SSE / 事件流文本里挑出错误事件（in-band error 也会被上游用 200 发出来）。 */
export function scanStreamErrors(text) {
	const out = [];
	const lines = String(text ?? "").split("\n");
	for (const line of lines) {
		if (!line.startsWith("data:")) continue;
		const payload = line.slice(5).trim();
		if (payload === "" || payload === "[DONE]") continue;
		let evt = null;
		try {
			evt = JSON.parse(payload);
		} catch {
			continue;
		}
		const type = typeof evt?.type === "string" ? evt.type : "";
		if (type === "error" || isObject(evt?.error)) {
			out.push({
				type: type || "error",
				message: typeof evt?.error?.message === "string" ? evt.error.message : typeof evt?.message === "string" ? evt.message : "(无 message)",
			});
		}
	}
	return out;
}
