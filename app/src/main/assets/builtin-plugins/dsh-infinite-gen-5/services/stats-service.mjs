/**
 * Host 统计 Service：对 stats-store 的最小显式适配层。
 *
 * 该模块不读取 ctx/process，不处理 HTTP，也不做业务统计；所有状态仍由
 * Host 编排层决定，Service 只提供统一的读写与生命周期边界。
 */
const serviceLedger = { registered: 0, disposed: 0, disposeCalls: 0, live: new Set() };

export const statsServiceSnapshot = () => ({
  registered: serviceLedger.registered,
  disposed: serviceLedger.disposed,
  disposeCalls: serviceLedger.disposeCalls,
  live: serviceLedger.live.size,
});

export const createStatsService = ({ store } = {}) => {
  if (!store || typeof store.snapshot !== "function" || typeof store.read !== "function") {
    throw new TypeError("createStatsService 需要提供可用的 stats store");
  }

  let disposeCalls = 0;
  let disposed = false;
  const record = { disposed: false };
  serviceLedger.registered += 1;
  serviceLedger.live.add(record);
  return Object.freeze({
    snapshot: () => store.snapshot(),
    read: () => store.read(),
    // 业务命名 API。
    publish: (section, value) => store.set(section, value),
    patch: (section, fields) => store.patch(section, fields),
    count: (path, amount = 1) => store.bump(path, amount),
    append: (path, entry, keep) => store.push(path, entry, keep),
    // 迁移兼容别名：让 index.js 的现有写点逐步迁移，不在同一提交里改写全部调用方。
    set: (section, value) => store.set(section, value),
    bump: (path, amount = 1) => store.bump(path, amount),
    push: (path, entry, keep) => store.push(path, entry, keep),
    subscribe: (listener) => store.onChange(listener),
    onChange: (listener) => store.onChange(listener),
    flush: (force = false) => store.flush(force),
    dispose: () => {
      if (disposed) return false;
      disposed = true;
      disposeCalls += 1;
      serviceLedger.disposeCalls += 1;
      record.disposed = true;
      serviceLedger.disposed += 1;
      serviceLedger.live.delete(record);
      return store.dispose();
    },
    get disposeCalls() { return disposeCalls; },
    get file() { return store.file; },
    get version() { return store.version; },
    get schema() { return store.schema; },
    get writes() { return store.writes; },
    get seq() { return store.seq; },
    get dirty() { return store.dirty; },
    get lastError() { return store.lastError; },
  });
};
