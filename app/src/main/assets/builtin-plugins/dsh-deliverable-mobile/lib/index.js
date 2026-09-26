/**
 * dsh-deliverable-mobile — host half.
 *
 * 交付文件在桌面端走 `sessionController.openWorkspacePath`（默认应用打开），
 * 手机上没有对应桌面机制 → 打不开。本插件新增一条移动端专用路由：
 * 解析交付文件坐标 → 容器内绝对路径 → 通过 DeepSeek Harness App 的
 * 3090 桥 `/app/export` 导出到公共 `Download/DeepSeekHarness/`（走 MediaStore，
 * 手机文件管理器 / MT 管理器可直接看到并打开）。
 *
 * 依赖：webServer（路由）、sessionQuery（读会话事件拿交付文件路径）、
 *       sandboxPolicy / workspaceFiles（路径校验）。
 */
import { readFileSync } from 'node:fs';

export const name = 'dsh-deliverable-mobile';

/** App 桥 base（HttpShellService 监听 127.0.0.1:3090；token 文件容器内可读）。 */
const BRIDGE_BASE = 'http://127.0.0.1:3090';
const TOKEN_FILE = '/root/.dsh/.bridge_token';
const EXPORT_ROUTE = '/api/deliverable.mobile-export';

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
 * 把一个容器内绝对路径经 App 桥导出到公共 Download/DeepSeekHarness。
 * @returns {Promise<string|null>} 导出的显示名（成功）或 null（失败）。
 */
async function exportViaBridge(path, desiredName) {
  const token = bridgeToken();
  if (!token) throw new Error('bridge token 不可读（App 桥未就绪）');
  const name = desiredName && /^[\w.\- ]+$/.test(desiredName) ? desiredName : path.split('/').pop() || 'deliverable.bin';
  const url = `${BRIDGE_BASE}/app/export?token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const text = await response.text();
  const out = text.trim();
  // 成功响应形如 "OK:Download/DeepSeekHarness/<name>"；其余都是失败码。
  if (!out.startsWith('OK')) throw new Error(out.slice(0, 120) || '导出失败');
  return name;
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
  // 交付文件在 session 工作区内；用 workspaceFiles.stat 解析出绝对路径，
  // 再交给 App 桥导出（App 桥对 /root/... guest 路径有映射与安全校验）。
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

export function apply(ctx) {
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: EXPORT_ROUTE,
      handler: async (req, res) => {
        const rejection = webCtx.connection.requestRejection(req);
        if (rejection !== undefined) {
          respond(res, rejection, { error: { code: 'access-denied', message: '需要当前浏览器鉴权' } });
          return;
        }
        const query = new URL(req.url).searchParams;
        const id = query.get('sessionId');
        const seq = coordinate(query.get('seq'));
        const index = coordinate(query.get('index'));
        if (!id || seq === undefined || index === undefined) {
          respond(res, 400, { error: { code: 'invalid-coordinates', message: '需要 sessionId/seq/index' } });
          return;
        }
        try {
          const resolved = await resolveDeliverablePath(webCtx, req, id, seq, index);
          if (resolved === null) {
            respond(res, 404, { error: { code: 'not-found', message: '交付文件不存在或坐标已失效' } });
            return;
          }
          const exportedName = await exportViaBridge(resolved.path, resolved.displayTitle);
          respond(res, 200, { ok: true, exported: exportedName, note: '已导出到 Download/DeepSeekHarness，可在文件管理器/MT 管理器打开' });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const code = message.includes('token') ? 'bridge-unavailable' : 'export-failed';
          respond(res, 503, { error: { code, message } });
        }
      },
    }), 'dsh-deliverable-mobile: mobile-export route');
  });
}

function respond(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
