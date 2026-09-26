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

function coordinate(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
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
 * 把一个容器内绝对路径经 App 桥导出并唤起「打开方式」选择器。
 * @returns {Promise<string>} App 桥的 OK 说明文字（成功）。
 */
async function openViaBridge(path, desiredName) {
  const token = bridgeToken();
  if (!token) throw new Error('bridge token 不可读（App 桥未就绪）');
  const name = desiredName && /^[\w.\- ]+$/.test(desiredName) ? desiredName : path.split('/').pop() || 'deliverable.bin';
  const url = `${BRIDGE_BASE}/app/openfile?token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  const text = await response.text();
  const out = text.trim();
  // 成功响应形如 "OK: 已唤起打开方式选择器：<name>"；其余都是失败码。
  if (!out.startsWith('OK')) throw new Error(out.slice(0, 200) || '唤起失败');
  return out;
}

/**
 * 从会话事件坐标解析交付文件的容器内绝对路径。
 * 镜像 ui-deliverables host 的 readTarget + workspaceFiles.stat 路径解析。
 */
async function resolveDeliverablePath(ctx, request, id, seq, index) {
  const read = await ctx.sessionQuery.readEvent({ sessionId: id, seq, before: 0, after: 0 }, request.signal);
  if (!read || typeof read !== 'object' || read.type !== 'deliverables/presented' || !read.data) return null;
  const files = read.data.files;
  const file = Array.isArray(files) ? files[index] : undefined;
  if (!file || typeof file.path !== 'string' || !file.path) return null;
  // 交付文件在 session 工作区内；优先用 workspaceFiles.stat 解析出绝对路径。
  let absolute = file.path;
  try {
    const stat = await ctx.workspaceFiles.stat({
      sessionId: id,
      workspaceRoot: ctx.sandboxPolicy?.workspaceRoot,
    }, file.path, request.signal);
    if (stat && typeof stat.absolutePath === 'string' && stat.absolutePath) absolute = stat.absolutePath;
  } catch {
    // stat 不可用（workspaceFiles 未提供）时退回原始 path，App 桥仍能映射。
  }
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
    if (resolved === null) {
      return Response.json({ error: { code: 'not-found', message: '交付文件不存在或坐标已失效' } }, { status: 404 });
    }
    await openViaBridge(resolved.path, resolved.displayTitle);
    return Response.json({ ok: true, note: '已唤起打开方式选择器' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.includes('token') ? 'bridge-unavailable' : 'open-failed';
    return Response.json({ error: { code, message } }, { status: 503 });
  }
}

export function apply(ctx) {
  ctx.connection.fetch.register({
    path: OPEN_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => handleOpen(ctx, new Request(request)),
  });
}
