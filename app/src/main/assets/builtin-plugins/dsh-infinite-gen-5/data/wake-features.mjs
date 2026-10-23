import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SELF_CHECK_WAKE_WORD = "无限第五代自检";
export const IDENTITY_WAKE_WORD = "亲爱的";
export const DEFAULT_IDENTITY_TEXT = "你是‘伴侣身份’助手：温柔、可靠、主动协作，提供连贯自然的陪伴式互动；优先帮助用户完成当前任务。尊重用户指定的关系和互动设定，保持已确认的称呼、语气和偏好一致；用户要求调整时立即跟随。优先回应当前问题，可以主动关心和提出必要建议，不重复无关身份说明。角色表达与事实、工具结果和文件状态分开，不把未验证内容说成已完成。技术任务保持可执行、可验证、结构清晰；用户要求正式、简洁或只给结论时立即切换。普通技术问题不必退出伴侣身份，澄清时自然简洁。";
export const defaultWakeSettings = () => ({ firstWakeEnabled: true, identityText: DEFAULT_IDENTITY_TEXT, identityWakeWord: IDENTITY_WAKE_WORD, selfcheckWakeWord: SELF_CHECK_WAKE_WORD });

export function validateWakePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("settings 必须是对象");
  for (const key of Object.keys(patch)) if (!["firstWakeEnabled", "identityText"].includes(key)) throw new TypeError(`未知唤醒配置字段：${key}`);
  if (Object.hasOwn(patch, "firstWakeEnabled") && typeof patch.firstWakeEnabled !== "boolean") throw new TypeError("firstWakeEnabled 必须是布尔值");
  if (Object.hasOwn(patch, "identityText")) {
    if (typeof patch.identityText !== "string" || !patch.identityText.trim()) throw new TypeError("identityText 必须是非空文本");
    if (Buffer.byteLength(patch.identityText, "utf8") > 4000 || Buffer.from(patch.identityText, "utf8").toString("utf8") !== patch.identityText) throw new TypeError("identityText 必须是有效 UTF-8，且不超过 4000 bytes");
  }
  return { ...patch };
}

export function wakeSettingsFile(env = process.env) {
  const base = env.DSH_PROFILE_DIR || join(env.IG5_HOME || env.DSH_HOME || join(homedir(), ".dsh"), "profiles", encodeURIComponent(env.DSH_PROFILE || "default"));
  return join(base, "infinite-gen-5", "wake-settings.json");
}

export function createWakeStore({ file = wakeSettingsFile() } = {}) {
  let settings = defaultWakeSettings();
  let error = null;
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    settings = { ...settings, ...validateWakePatch(saved) };
  } catch (cause) {
    if (cause.code !== "ENOENT") error = "唤醒配置读取或校验失败，使用默认值";
  }
  const save = (patch) => {
    const next = { ...settings, ...validateWakePatch(patch) };
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(temp, JSON.stringify({ firstWakeEnabled: next.firstWakeEnabled, identityText: next.identityText }) + "\n", { mode: 0o600, flag: "wx" });
      renameSync(temp, file);
    } catch (cause) {
      rmSync(temp, { force: true });
      throw new Error("唤醒配置持久化失败", { cause });
    }
    settings = next;
    error = null;
    return { ...settings };
  };
  return { get: () => ({ ...settings }), status: () => ({ valid: error === null, error }), set: save, reset: () => save({ firstWakeEnabled: true, identityText: DEFAULT_IDENTITY_TEXT }) };
}

export const realUserMessage = (message) => message?.role === "user" && message?.source?.kind === "user";
export const messageText = (message) => (Array.isArray(message?.content) ? message.content : []).filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");

export function createWakeState({ source, session, events }) {
  const header = session?.header;
  const known = Array.isArray(events) && header && typeof header.isSeeded === "boolean" && Number.isSafeInteger(session?.inheritedEventCount);
  const history = !known || events.some((event) => ["user/message", "assistant/message", "assistant/attempt", "tool/call", "tool/result", "session/compacted"].includes(event.type));
  return { firstEligible: known && source === "startup" && !header.isSeeded && !header.parentSession && !header.origin && session.inheritedEventCount === 0 && !history, seen: new Set(), identityAwake: false };
}

export function wakeTexts(state, messages, settings) {
  const texts = [];
  for (const message of messages) {
    if (!realUserMessage(message) || state.seen.has(message.id ?? message)) continue;
    state.seen.add(message.id ?? message);
    const text = messageText(message);
    if (state.firstEligible && settings.firstWakeEnabled && text.includes(IDENTITY_WAKE_WORD)) {
      texts.push(`[无限五代 · 伴侣身份]\n${settings.identityText}\n这是用户配置的协作人格，不改变当前任务或工具权限；不要宣称具有人类身份。`);
      state.identityAwake = true;
    }
    state.firstEligible = false;
    if (text.includes(SELF_CHECK_WAKE_WORD)) texts.push("[无限五代 · 自检唤醒] 用户请求无限第五代自检。请现在调用只读 infinite_gen5_selfcheck 工具，依据返回证据报告结果；未知项明确说明未知，不声称已运行 npm 全量门禁。无需复述唤醒机制。");
  }
  return texts;
}

export function wakeMessage(text) {
  return { id: randomUUID(), role: "user", content: [{ type: "text", text }], source: { kind: "plugin", plugin: "infinite-gen-5", form: "snapshot", sections: [{ name: "infinite-gen-5:wake", text }] } };
}

// Registrations belong to both the agent scope and this plugin's effect.
export function registerWakeFeatures(ctx, store) {
  const agents = new Map();
  const status = { available: typeof ctx?.on === "function", agents: 0, injected: 0 };
  // 旧宿主/离线夹具没有事件总线时，唤醒能力关闭，但绝不阻断插件其它能力注册。
  if (!status.available) return { status, agents, dispose: () => {} };
  const dispose = ctx.on("agent/created", ({ agent, source }) => {
    if (!agent?.ctx?.effect || !agent.ctx.on) return;
    let events;
    try { events = agent.session?.snapshotEvents(); } catch { events = undefined; }
    const state = createWakeState({ source, session: agent.session, events });
    agents.set(agent, state);
    status.agents = agents.size;
    const inject = (messages) => {
      for (const text of wakeTexts(state, messages, store.get())) {
        agent.inject(wakeMessage(text));
        status.injected += 1;
      }
    };
    ctx.effect(() => agent.ctx.effect(() => {
      const inserted = agent.ctx.on("agent/inbox/inserted", ({ message }) => inject([message]));
      // Admission fallback covers input queued before initialization or introduced by another interceptor.
      const preStep = agent.ctx.on("agent/pre-step", async (_payload, next) => {
        const decision = await next();
        if (decision.kind !== "enter") return decision;
        const extra = wakeTexts(state, decision.messages, store.get()).map(wakeMessage);
        status.injected += extra.length;
        return extra.length ? { ...decision, messages: [...decision.messages, ...extra] } : decision;
      });
      return () => { inserted(); preStep(); agents.delete(agent); status.agents = agents.size; };
    }), "infinite-gen-5: agent wake features");
    if (typeof agent.inject === "function") inject([...(agent.inbox?.nextStep ?? []), ...(agent.inbox?.nextTurn ?? [])]);
  });
  return { status, agents, dispose };
}
