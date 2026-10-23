/**
 * DSH 自身任务清单（todo）的读侧与写侧规则。
 *
 * 事实来源（宿主源码实勘）：
 *   - 工具 `todo_write` 由 @deepseek-ai/dsh-tool-todo 注册，执行体只做一件事：
 *     `exec.agent.session.append("todo/write", { todos })`；
 *   - 同一个包里注册了会话投影 `todos`（wire），reduce 规则 = 取最后一条 `todo/write` 的 data.todos；
 *   - 会话事件订阅是公开的：`ctx.on("session/event", (session, event) => …)`，
 *     读投影是 `ctx.sessionProjections.stateOf(session, "todos")`。
 *
 * 于是插件对「DSH 任务清单」的更新能力有两条正当路径：
 *   读：订阅会话事件 → 读 `todos` 投影 → 镜像进统计数据库（面板只读库就能显示进度）；
 *   写：走与官方工具**同一条**事件（`session.append("todo/write", { todos })`），
 *       并且先在本地按同一套策略校验，避免把宿主拒绝的清单塞进会话。
 * 本模块只放纯规则，不碰 cordis、不碰文件，便于 verify_stats_panel.mjs 直接驱动。
 */

/** 会话投影键：宿主 todo 工具的注册名，别改。 */
export const TODOS_PROJECTION_KEY = "todos";
/** 宿主任务清单事件类型（官方工具用的就是它）。 */
export const TODOS_EVENT = "todo/write";
/** 宿主策略：状态只有这三种。 */
export const TASK_STATUSES = ["pending", "in_progress", "completed"];
/** 本地护栏：一次写入的条目上限与单条内容长度上限。 */
export const TASK_MAX_ITEMS = 24;
export const TASK_MAX_CONTENT = 200;

const STATUS_ALIASES = new Map([
  ["pending", "pending"],
  ["todo", "pending"],
  ["open", "pending"],
  ["inprogress", "in_progress"],
  ["in_progress", "in_progress"],
  ["in-progress", "in_progress"],
  ["doing", "in_progress"],
  ["active", "in_progress"],
  ["completed", "completed"],
  ["complete", "completed"],
  ["done", "completed"],
  ["finished", "completed"],
]);

/** 把一个状态字符串规范成宿主认的三种；认不出来当 pending（保守，不会卡住模型）。 */
export const normalizeStatus = (raw) => {
  const key = String(raw ?? "").trim().toLocaleLowerCase();
  return STATUS_ALIASES.get(key) ?? "pending";
};

/** 计数：面板进度条就靠这三个数。 */
export const countStatuses = (items) => {
  const counts = { pending: 0, inProgress: 0, completed: 0 };
  for (const item of Array.isArray(items) ? items : []) {
    if (item && item.status === "completed") counts.completed += 1;
    else if (item && item.status === "in_progress") counts.inProgress += 1;
    else counts.pending += 1;
  }
  return counts;
};

/**
 * 读侧：把 `todos` 投影的值规范成数据库里的 tasks 段。
 * 投影在首次写入前是 `null`；老版本或别的写入方可能给出 `{content,status}` 数组，都认。
 */
export const readTaskList = (value, meta = {}) => {
  const items = Array.isArray(value)
    ? value
        .map((entry) => {
          if (entry === null || typeof entry !== "object") return null;
          const content = typeof entry.content === "string" ? entry.content.trim() : "";
          if (content.length === 0) return null;
          return { content: content.slice(0, TASK_MAX_CONTENT), status: normalizeStatus(entry.status) };
        })
        .filter(Boolean)
    : [];
  const available = Array.isArray(value);
  return {
    available,
    source: available ? `${TODOS_PROJECTION_KEY}@sessionProjections` : null,
    reason: available ? null : "会话尚未写过任务清单（宿主投影为 null）",
    counts: countStatuses(items),
    items,
    at: meta.at ?? new Date().toISOString(),
    session: meta.session ?? null,
  };
};

/**
 * 写侧：按宿主策略校验一份要写进会话的清单。
 *
 * 与宿主工具一致的地方：内容非空、不重复、状态合法；比宿主宽松的地方只有一处 ——
 * 宿主在「同时只能一个 in_progress」时是**直接报错拒绝**，而面板点按钮这种场景更希望
 * 「能写就写、多出来的降级为 pending 并说明」，否则用户面对的只是一句报错。
 *
 * @returns {{ok: boolean, todos: Array<{content: string, status: string}>, errors: string[], repairs: string[]}}
 */
export const normalizeTodoPatch = (rawTodos, options = {}) => {
  const maxItems = Number.isFinite(options.maxItems) ? Math.max(1, Number(options.maxItems)) : TASK_MAX_ITEMS;
  const allowParallel = options.allowParallel === true;
  const errors = [];
  const repairs = [];
  const todos = [];
  const seen = new Set();
  if (!Array.isArray(rawTodos)) {
    return { ok: false, todos: [], errors: ["todos 必须是数组"], repairs };
  }
  for (const entry of rawTodos) {
    if (entry === null || typeof entry !== "object") {
      repairs.push("丢弃了一条非对象条目");
      continue;
    }
    const content = typeof entry.content === "string" ? entry.content.trim().replace(/\s+/g, " ") : "";
    if (content.length === 0) {
      repairs.push("丢弃了一条空内容条目");
      continue;
    }
    const clipped = content.slice(0, TASK_MAX_CONTENT);
    if (clipped.length !== content.length) repairs.push(`截断超长条目（>${TASK_MAX_CONTENT} 字）`);
    if (seen.has(clipped)) {
      repairs.push(`丢弃重复条目：${clipped.slice(0, 24)}…`);
      continue;
    }
    seen.add(clipped);
    todos.push({ content: clipped, status: normalizeStatus(entry.status) });
    if (todos.length >= maxItems) {
      const rest = rawTodos.length - todos.length;
      if (rest > 0) repairs.push(`条目上限 ${maxItems}，其余 ${rest} 条未写入`);
      break;
    }
  }
  if (todos.length === 0) errors.push("清单里没有可用条目");
  const active = todos.filter((todo) => todo.status === "in_progress");
  if (!allowParallel && active.length > 1) {
    for (const todo of active.slice(1)) todo.status = "pending";
    repairs.push(`宿主策略只允许一个 in_progress，其余 ${active.length - 1} 条降级为 pending`);
  }
  return { ok: errors.length === 0, todos, errors, repairs };
};
