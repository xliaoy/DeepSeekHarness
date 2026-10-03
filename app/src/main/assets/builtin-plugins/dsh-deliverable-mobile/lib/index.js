/**
 * dsh-deliverable-mobile — host half.
 *
 * 交付文件在桌面端走 `sessionController.openWorkspacePath`（默认应用打开），
 * 手机上没有对应桌面机制 → 提示「此主机没有可用的桌面」。本插件新增一条
 * 移动端专用路由：解析交付文件坐标 → 容器内绝对路径 → 通过 DeepSeek Harness
 * App 的 3090 桥 `/app/openfile` 把文件导出到公共 Download/DeepSeekHarness，
 * 并唤起系统「打开方式」选择器（QQ/微信同款 ACTION_VIEW + createChooser）——
 * 用户可直接选 MT 管理器 / 文件管理器 / 其它应用打开编辑。
 *
 * 路由通过 connection.fetch.register 注册（与 ui-deliverables 官方一致，
 * 避免 /api 网关把 webServer.exact 路由吞掉）。
 */
import { readFileSync } from 'node:fs';

export const name = 'dsh-deliverable-mobile';

/** App 桥 base（HttpShellService 监听 127.0.0.1:3090；token 文件容器内可读）。 */
const BRIDGE_BASE = 'http://127.0.0.1:3090';
const TOKEN_FILE = '/root/.dsh/.bridge_token';
const OPEN_ROUTE = '/api/deliverable.mobile-open';

/** 只认十进制非负整数串，与官方 ui-deliverables 的 coordinate 同口径。
 *  不能用 Number.isFinite 兜：Number(null) 和 Number('') 都是 0（有限），
 *  缺参会被当成 seq=0/index=0 去读一个不相干的事件，而不是如实报 400。 */
const NUMERIC = /^\d+$/;

function coordinate(value) {
  return value !== null && NUMERIC.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

/** 读 token（读失败则返回空，路由会 503 提示）。 */
function bridgeToken() {
  try {
    return readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * App 桥统一返回 JSON：{"result":"..."}；兼容个别纯文本响应。
 * 提取 result 字段用于成功判定与报错展示。
 */
function bridgeResult(text) {
  const t = String(text || '').trim();
  if (t.startsWith('{')) {
    try {
      const obj = JSON.parse(t);
      if (typeof obj.result === 'string') return obj.result;
    } catch { /* 非 JSON 走原样 */ }
  }
  return t;
}

/**
 * 把一个容器内绝对路径经 App 桥以「分享」方式交给手机上的其它应用
 * （用户明确要求走分享面板：复制到 /sdcard/Download/DeepSeekHarness 后调
 *  /app/share，App 弹 ACTION_SEND 分享面板，可选 MT/WPS/文件管理器接收打开）。
 *
 * 若 /sdcard 复制失败（存储不可写），退回容器 /tmp 复制 + /app/openfile 打开方式。
 * @returns {Promise<string>} App 桥的 OK 说明文字（成功）。
 */
async function openViaBridge(path, desiredName) {
  const token = bridgeToken();
  if (!token) throw new Error('bridge token 不可读（App 桥未就绪）');
  // 原始文件名（含中文等字符原样保留，URL 编码传给 App；App 侧再做文件名合法性校验）
  const originalName = desiredName && String(desiredName).trim()
      ? String(desiredName).trim() : (path.split('/').pop() || 'deliverable.bin');
  // 临时副本用安全文件名（仅 ASCII），分享/打开的展示名由 App 用 name 参数决定。
  const safeName = originalName.replace(/[^\w.\- ]/g, '_') || 'deliverable.bin';

  // 首选：分享。复制到 /sdcard（/app/share 只允许 /sdcard 下文件）→ 弹分享面板。
  const shared = await copyToShared(path, safeName);
  if (shared !== null) {
    const shareUrl = `${BRIDGE_BASE}/app/share?token=${encodeURIComponent(token)}&path=${encodeURIComponent(shared)}&name=${encodeURIComponent(originalName)}`;
    try {
      const share = await fetch(shareUrl, { signal: AbortSignal.timeout(90000) });
      const shareResult = bridgeResult(await share.text());
      if (shareResult.startsWith('OK')) return shareResult;
      throw new Error(shareResult.slice(0, 200) || '唤起失败');
    } finally {
      try { await import('node:fs/promises').then((fs) => fs.unlink(shared)); } catch { /* 清理失败无碍 */ }
    }
  }

  // 兜底：容器 /tmp 复制 + /app/openfile 打开方式选择器。
  const copied = await copyToTmp(path, safeName);
  if (copied !== null) {
    const openUrl = `${BRIDGE_BASE}/app/openfile?token=${encodeURIComponent(token)}&path=${encodeURIComponent(copied)}&name=${encodeURIComponent(originalName)}`;
    try {
      const retry = await fetch(openUrl, { signal: AbortSignal.timeout(90000) });
      const retryResult = bridgeResult(await retry.text());
      if (retryResult.startsWith('OK')) return retryResult;
      throw new Error(retryResult.slice(0, 200) || '唤起失败');
    } finally {
      try { await import('node:fs/promises').then((fs) => fs.unlink(copied)); } catch { /* 清理失败无碍 */ }
    }
  }
  throw new Error('无法复制交付文件（/sdcard 与 /tmp 均失败），请检查存储空间');
}

/** 复制到容器 /tmp 的随机名，返回新路径；失败返回 null。 */
async function copyToTmp(src, name) {
  try {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const safeName = String(name || 'deliverable.bin').replace(/[^\w.\- ]/g, '_');
    const target = `${os.tmpdir()}/dsh-deliverable-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${safeName}`;
    await fs.copyFile(src, target);
    return target;
  } catch {
    return null;
  }
}

/** 复制到 /sdcard/Download/DeepSeekHarness（App 公共导出目录，/app/share 允许的域），返回新路径；失败返回 null。 */
async function copyToShared(src, name) {
  try {
    const fs = await import('node:fs/promises');
    const dir = '/sdcard/Download/DeepSeekHarness';
    await fs.mkdir(dir, { recursive: true });
    const safeName = String(name || 'deliverable.bin').replace(/[^\w.\- ]/g, '_');
    const target = `${dir}/dsh-deliverable-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${safeName}`;
    await fs.copyFile(src, target);
    return target;
  } catch {
    return null;
  }
}

/**
 * 从会话事件坐标解析交付文件的容器内绝对路径。
 * 镜像 ui-deliverables host 的 readTarget + workspaceFiles.stat 路径解析。
 *
 * ⚠ readEvent 返回的是读窗口 `{ session, target, events, startSeq, endSeq }`，
 * 事件本体在 `.target` 下 —— 不是事件自身。
 *
 * 失败时返回 `{ reason }`（不抛异常），handleOpen 会把 reason 写进界面报错，
 * 便于直接在手机上定位：target 类型不符 / files 长度 / stat 拿不到绝对路径等。
 */
async function resolveDeliverablePath(ctx, request, id, seq, index) {
  const read = await ctx.sessionQuery.readEvent({ sessionId: id, seq, before: 0, after: 0 }, request.signal);
  if (!read || typeof read !== 'object') return { reason: `readEvent 无返回（会话 ${id} seq ${seq}）` };
  const target = read.target;
  if (!target) return { reason: `seq ${seq} 处无事件（事件可能已被压缩或坐标失效）` };
  if (target.type !== 'deliverables/presented' || !target.data) {
    return { reason: `seq ${seq} 的事件类型为 ${target.type}，不是交付文件呈现事件` };
  }
  const files = target.data.files;
  const file = Array.isArray(files) ? files[index] : undefined;
  if (!file || typeof file.path !== 'string' || !file.path) {
    return { reason: `呈现事件 files 数组长度 ${Array.isArray(files) ? files.length : '非数组'}，索引 ${index} 无有效文件` };
  }
  // 工作区根与官方同序：先会话自己的 cwd，再退到沙箱策略的 workspaceRoot。
  const workspaceRoot = read.session?.cwd ?? ctx.sandboxPolicy?.workspaceRoot;
  const stat = await ctx.workspaceFiles.stat({ sessionId: id, workspaceRoot }, file.path, request.signal);
  const absolute = stat && typeof stat.absolutePath === 'string' ? stat.absolutePath : '';
  if (!absolute) return { reason: `文件 ${file.path} 无法解析出绝对路径（文件可能已被移动/删除）` };
  return { path: absolute, displayTitle: file.displayTitle };
}

const inject = ['connection', 'sessionQuery', 'workspaceFiles', 'sandboxPolicy'];

async function handleOpen(ctx, request) {
  const query = new URL(request.url).searchParams;
  const id = query.get('sessionId');
  const seq = coordinate(query.get('seq'));
  const index = coordinate(query.get('index'));
  if (!id || seq === undefined || index === undefined) {
    return Response.json({ error: { code: 'invalid-coordinates', message: '需要 sessionId/seq/index' } }, { status: 400 });
  }
  try {
    const resolved = await resolveDeliverablePath(ctx, request, id, seq, index);
    if (resolved === null || resolved.reason) {
      const reason = resolved && resolved.reason ? resolved.reason : '交付文件不存在或坐标已失效';
      return Response.json({ error: { code: 'not-found', message: '交付文件不存在或坐标已失效：' + reason } }, { status: 404 });
    }
    await openViaBridge(resolved.path, resolved.displayTitle);
    return Response.json({ ok: true, note: '已唤起打开方式选择器' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 坐标读不出来（会话已归档 / seq 不存在）与桥不可用是两回事，分开报：
    // 前端会把 message 原样显示，含糊的文案等于没有信息。
    if (/SESSION_QUERY|has no event at seq/i.test(message)) {
      return Response.json({ error: { code: 'stale-coordinates', message: '坐标已失效：' + message } }, { status: 404 });
    }
    const code = message.includes('token') ? 'bridge-unavailable' : 'open-failed';
    return Response.json({ error: { code, message } }, { status: 503 });
  }
}

export function apply(ctx) {
  ctx.connection.fetch.register({
    path: OPEN_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => handleOpen(ctx, request),
  });
}

export { inject };
