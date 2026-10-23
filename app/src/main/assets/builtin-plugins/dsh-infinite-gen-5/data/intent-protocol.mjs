// 可验证的用户意图协议：把“不要擅自缩减/回退”从提示词提升为执行前门禁。
// 该模块只做纯函数，便于离线单测；不执行命令、不改写参数。

const textOf = (value) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (value && typeof value === "object") return Object.entries(value).map(([k, v]) => `${k} ${textOf(v)}`).join(" ");
  return "";
};

const commandOf = (args) => {
  if (args && typeof args === "object" && typeof args.command === "string") return args.command.replace(/\s+/g, " ").trim();
  return textOf(args).replace(/\s+/g, " ").trim();
};

const hasFlag = (command, flag) => new RegExp(`(?:^|\\s)${flag}(?:[=\\s]|$)`, "i").test(command);

// 第二层：把“历史回滚”与“擅自覆盖工作区”分开。
// 允许查看历史；真正回滚必须带明确的用户意图与已登记检查点。
export function createIntentLock(overrides = {}) {
  return Object.freeze({
    version: 1,
    preserveHistory: overrides.preserveHistory !== false,
    allowRollback: overrides.allowRollback === true,
    checkpoint: typeof overrides.checkpoint === "string" ? overrides.checkpoint : null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  });
}

const isHistoryRead = (command) => /(?:^|\\s)(?:log|show|diff|reflog|blame|rev-parse)(?:\\s|$)/i.test(command);
const hasExplicitRollback = (args) => Boolean(args && typeof args === "object" && args.protocolIntent === "rollback" && typeof args.checkpoint === "string" && args.checkpoint.trim() !== "");

export function rollbackDecision(args, lock) {
  const command = commandOf(args);
  if (isHistoryRead(command)) return { ok: true, mode: "history-read", reason: null };
  if (!/(?:^|\\s)(?:reset|restore|checkout)(?:\\s|$)/i.test(command)) return { ok: true, mode: "not-rollback", reason: null };
  if (hasExplicitRollback(args) && lock?.allowRollback === true && lock.checkpoint === args.checkpoint) {
    return { ok: true, mode: "approved-rollback", reason: null };
  }
  return { ok: false, mode: "blocked-rollback", reason: "历史回滚必须使用已登记 checkpoint，并由当前意图锁显式允许；否则只保留历史查看，不覆盖工作区。" };
}

export function inspectIntentAction(name, args, lock = createIntentLock()) {
  const command = commandOf(args);
  const lower = command.toLowerCase();
  const rollback = rollbackDecision(args, lock);
  if (!rollback.ok) return { ok: false, code: "ROLLBACK_REQUIRES_CHECKPOINT", reason: rollback.reason, command };
  const git = /(?:^|[\s"'`])git(?:\.exe)?(?:[\s"'`]|$)/i.test(command);
  if (!git) return { ok: true, command, reason: null, code: null };

  if (/(?:^|\s)clone(?:\s|$)/i.test(command) && (
    hasFlag(command, "--depth") || hasFlag(command, "--filter") ||
    hasFlag(command, "--single-branch") || hasFlag(command, "--shallow-since") ||
    hasFlag(command, "--shallow-exclude")
  )) {
    return {
      ok: false,
      code: "INTENT_REDUCTION",
      reason: "检测到会削弱仓库完整性的克隆参数（depth/filter/single-branch/shallow-*）；协议默认要求保留完整历史。",
      command,
    };
  }

  if (/(?:^|\s)(?:reset|restore|checkout)(?:\s|$)/i.test(command) && !hasExplicitRollback(args) && (
    /(?:--hard|--discard-changes|--source|\\.\\.|--)/i.test(lower) ||
    /(?:restore|checkout)\s+--/i.test(lower)
  )) {
    return {
      ok: false,
      code: "WORKTREE_DESTRUCTIVE",
      reason: "检测到可能覆盖或回退工作区修改的 Git 操作；协议要求先保留 diff，并等待用户明确确认。",
      command,
    };
  }

  return { ok: true, command, reason: null, code: null };
}

export function protocolDecision(exec, lock = createIntentLock()) {
  const result = inspectIntentAction(exec?.name, exec?.arguments, lock);
  if (result.ok) return { kind: "allow" };
  return {
    kind: "deny",
    reason: `[intent-protocol:${result.code}] ${result.reason}`,
    info: { name: "intent-protocol", code: result.code, reason: result.reason },
  };
}

export const PROTOCOL_TEXT = [
  "## 用户意图执行协议",
  "工具动作不得擅自削弱用户要求：完整克隆不得改成浅克隆、单分支、稀疏或过滤克隆。",
  "存在工作区修改时不得擅自 reset、restore、checkout 覆盖或回退；先保留 diff，明确确认后才可执行。",
  "模型负责提出动作，执行协议负责拒绝违反意图的参数；被拒绝后缩小动作或重新规划，不改写用户目标。",
].join("\\n");

export { commandOf };
