/**
 * Read-only projections for the statistics HTTP/SSE surface.
 *
 * This module keeps response shaping out of the Cordis entrypoint. It owns no
 * storage and performs no I/O: the Host remains the only writer, while routes
 * pass a snapshot into these pure functions.
 *
 * 本期收口：删掉无消费方的 statsResponse()。它从未被路由调用（GET /stats 走
 * statsReadResponse，SSE 摘要走 statsEventCounts），架构文档却把它列为对外接口 ——
 * 留一个没人调、又不许改的导出比删掉更容易误导下一位维护者。
 */
export const statsReadResponse = (snapshot, { source = "memory", settings = null } = {}) => {
  const doc = snapshot && typeof snapshot === "object" ? snapshot : {};
  return { ...doc, ok: true, source, settings, api: "stats/1" };
};

export const statsEventCounts = (snapshot) => {
  const doc = snapshot && typeof snapshot === "object" ? snapshot : {};
  const counts = doc.tasks?.counts ?? {};
  return {
    tools: doc.tools?.total ?? 0,
    events: doc.sessions?.events ?? 0,
    tasks: { completed: counts.completed ?? 0, total: counts.total ?? 0 },
    anchors: doc.runtime?.anchorEmissions ?? 0,
  };
};
