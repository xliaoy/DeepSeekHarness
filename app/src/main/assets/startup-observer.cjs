/* 启动观察器：只读插件元数据，观察真实模块加载，不重复执行插件。 */
'use strict';
// 观察器只用于当前 Web，工具子进程沿用启动前的 NODE_OPTIONS。
if ('DeepSeekHarness_PRELOAD_PREVIOUS' in process.env) {
  if (process.env.DeepSeekHarness_PRELOAD_PREVIOUS) process.env.NODE_OPTIONS = process.env.DeepSeekHarness_PRELOAD_PREVIOUS;
  else delete process.env.NODE_OPTIONS;
  delete process.env.DeepSeekHarness_PRELOAD_PREVIOUS;
}
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const Module = require('node:module');
const prefix = '[DeepSeekHarness_STARTUP] ';
// 启动期的诊断文案在 Node 侧产生，容器里没有 Java 的 UiText，故自带一份 zh→en 对照。
// 主程序通过 DeepSeekHarness_UI_LANGUAGE 传入当前语言偏好（见 HarnessController.java）。
const uiPhrases = {"检查启动配置和插件清单": "Checking startup configuration and plugin list", "加载 DSH 和已启用插件": "Loading DSH and enabled plugins", "配置文件超过 1 MiB": "Configuration file exceeds 1 MiB", "dsh.profile.bundles 必须是插件名称数组": "dsh.profile.bundles must be an array of plugin names", "插件清单含无效名称": "The plugin list contains an invalid name", "缺少 dsh.bundle.patch 声明或补丁文件": "Missing dsh.bundle.patch declaration or patch file", "未知版本": "Unknown version", "读取启动恢复记录": "Read startup recovery records", "启动配置快照": "Startup configuration snapshot", "配置检查：": "Configuration check: ", "正在加载插件：": "Loading plugin: ", "插件加载完成：": "Plugin loaded: ", "插件等待服务：": "Plugin waiting for services: ", "启动配置检查失败：": "Startup configuration check failed: ", "加载器观察不可用，保留原始异常输出：": "Loader monitoring unavailable; original errors retained: ", "找不到插件目录，请到插件管理检查安装：": "Plugin directory not found; check its installation: "};
function uiText(message) {
  if (process.env.DeepSeekHarness_UI_LANGUAGE !== "en") return message;
  if (Object.hasOwn(uiPhrases, message)) return uiPhrases[message];
  for (const [zh, en] of Object.entries(uiPhrases)) if (zh.endsWith("：") && message.startsWith(zh)) return en + uiText(message.slice(zh.length));
  return message;
}
function emit(type, plugin, message, extra = {}) {
  process.stdout.write(prefix + JSON.stringify({ type, plugin, message: uiText(message), ...extra }) + '\n');
}
const validName = name => typeof name === 'string' && name.length <= 214 && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name);
const home = process.env.DSH_HOME || '/root/.dsh';
const profile = process.env.DeepSeekHarness_STARTUP_PROFILE || 'web';
const directory = path.join(home, 'profiles', profile);
const installation = process.env.DeepSeekHarness_OBSERVER_INSTALL || '/usr/local/lib/node_modules/@deepseek-ai/dsh';
const plugins = [];
const moduleOwners = new Map();
function readJson(file) {
  if (fs.statSync(file).size > 1024 * 1024) throw new Error('配置文件超过 1 MiB');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
async function exists(file) {
  try { await fsp.access(file); return true; } catch (_) { return false; }
}
async function locateP(name, roots) {
  const candidates = await Promise.all(roots.map(async (root) => {
    const candidate = path.join(root, name);
    if (await exists(path.join(candidate, 'package.json'))) return candidate;
    return null;
  }));
  const found = candidates.find(c => c != null);
  if (!found) throw new Error('找不到插件目录，请到插件管理检查安装：' + name);
  return found;
}
function locate(name, roots) {
  for (const root of roots) {
    const candidate = path.join(root, name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
  }
  throw new Error('找不到插件目录，请到插件管理检查安装：' + name);
}
function owner(text) {
  text = text.replaceAll('\\', '/');
  const matches = plugins.filter(p => text.includes(p.url + '/') || text.includes(p.directory.replaceAll('\\', '/') + '/')
    || text.includes('"' + p.name + '"') || text.includes("'" + p.name + "'"));
  return matches.sort((a,b) => b.directory.length - a.directory.length)[0]?.name || '';
}
(async () => {
  try {
    emit('stage', '', '检查启动配置和插件清单');
    const doc = readJson(path.join(directory, 'package.json'));
    const bundles = doc.dsh?.profile?.bundles;
    if (!Array.isArray(bundles)) throw new Error('dsh.profile.bundles 必须是插件名称数组');
    const check = async (name) => {
      if (!validName(name)) return { name, invalid: true };
      try {
        const root = await locateP(name, [path.join(installation, 'node_modules'), path.join(directory, 'node_modules'),
          path.join(home, 'profiles/node_modules'), path.join(home, 'node_modules')]);
        const pkg = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
        const patch = pkg.dsh?.bundle?.patch;
        // 0.1.7 支持有序补丁数组；每一个入口仍须存在于该包内部。
        const patches = typeof patch === 'string' ? [patch] : Array.isArray(patch) ? patch : [];
        let issue = '';
        if (!patches.length) issue = '缺少 dsh.bundle.patch 声明或补丁文件';
        else {
          for (const item of patches) {
            if (typeof item !== 'string' || !item || path.isAbsolute(item)) { issue = '缺少 dsh.bundle.patch 声明或补丁文件'; break; }
            const target = path.resolve(root, item);
            // 三层防护：非绝对路径 → 文本上不越界 → 必须是普通文件。
            // 注意：不可用 realpath 去比对【未解析的 root】。真机上 profile 里的插件是
            // 指向实体目录 /root/deepseekharness-* 的软链，realpath(target) 会解析到实体路径，
            // 于是合法的软链布局会被误判成越界（曾导致全部内置插件报「缺少补丁文件」）。
            // 因此先把 root 自身也解析掉，再做包含性比较。
            if (!target.startsWith(root + path.sep)) { issue = '缺少 dsh.bundle.patch 声明或补丁文件'; break; }
            const realRoot = await fsp.realpath(root).catch(() => root);
            const real = await fsp.realpath(target).catch(() => '');
            if (!real || !(real === realRoot || real.startsWith(realRoot + path.sep))) { issue = '缺少 dsh.bundle.patch 声明或补丁文件'; break; }
            try {
              if (!(await fsp.stat(target)).isFile()) { issue = '缺少 dsh.bundle.patch 声明或补丁文件'; break; }
            } catch (_) { issue = '缺少 dsh.bundle.patch 声明或补丁文件'; break; }
          }
        }
        const ids = [];
        // 每个补丁文件各自成组：catalog 事件按文件各发一条（与上游一致）。
        // 不可把所有文件的 id 合并后再截断 —— 那会丢掉后面文件的全部归属（实测丢 311/411）。
        const catalogs = [];
        for (const item of patches) {
          if (typeof item !== 'string' || !item) continue;
          const patchFile = path.resolve(root, item);
          try {
            const st = await fsp.stat(patchFile);
            if (st.size <= 1024 * 1024) {
              const source = await fsp.readFile(patchFile, 'utf8');
              const found = [...source.matchAll(/^\s*(?:-\s*)?(?:id|name|module):\s*["']?([@A-Za-z0-9_./:-]+)["']?\s*$/gm)].map(m => m[1]);
              ids.push(...found);
              if (found.length) catalogs.push(found);
            }
          } catch (_) { }
        }
        return { name, root, pkg, patches, ids, catalogs, issue };
      } catch (error) {
        return { name, error };
      }
    };
    const results = await Promise.all(bundles.slice(0, 500).map(check));
    for (const r of results) {
      if (r.invalid) { emit('issue', '', '插件清单含无效名称'); continue; }
      if (r.error) { emit('issue', r.name, r.error.message); continue; }
      const info = { name: r.name, directory: r.root, url: pathToFileURL(r.root).href };
      plugins.push(info);
      if (r.issue) emit('issue', r.name, r.issue);
      emit('plugin', r.name, '配置检查：' + r.name + ' @ ' + (r.pkg.version || uiText('未知版本')), { path: r.root });
      if (r.patches.length) {
        for (const id of r.ids) moduleOwners.set(id, moduleOwners.has(id) && moduleOwners.get(id) !== r.name ? '' : r.name);
        for (const group of r.catalogs) emit('catalog', r.name, '', { ids: group.slice(0, 100), path: r.root });
      }
    }
    emit('stage', '', '加载 DSH 和已启用插件');
  } catch (error) {
    emit('issue', '', '启动配置检查失败：' + error.message);
  }
})();

function entryOwner(entry) { return moduleOwners.get(entry?.options?.name) || moduleOwners.get(entry?.options?.id)
  || plugins.find(p => p.name === entry?.options?.name)?.name || ''; }
function errorDetail(error) {
  let detail = String(error?.stack || error);
  if (error?.cause && error.cause !== error) detail += '\n原因：' + String(error.cause.stack || error.cause);
  return detail;
}
// 使用已锁定 Cordis 的实际加载边界；同一模块缓存只加载一次，不拦截每一次 Node 依赖解析。
try {
  const { Entry } = require(path.join(installation, 'node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js'));
  const original = Entry.prototype.init;
  Entry.prototype.init = function () {
    const name = entryOwner(this), id = this.options?.name || this.options?.id || '';
    const show = name && !['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'].includes(name)
      || ['web-startup', 'webserver', 'modules'].includes(this.options?.id);
    if (show) emit('loading', name, '正在加载插件：' + (name || id));
    const failed = error => { emit('issue', name || owner(errorDetail(error)), id + '\n' + errorDetail(error)); throw error; };
    try {
      return original.apply(this, arguments).then(value => {
        if (show) {
          const fiber = this.fiber;
          const waiting = fiber?.state === 0 ? Object.keys(fiber.inject || {}).filter(key => !fiber._store?.[key]) : [];
          emit('loaded', name, waiting.length ? '插件等待服务：' + (name || id) + ' → ' + waiting.join(', ')
            : '插件加载完成：' + (name || id));
        }
        return value;
      }, failed);
    } catch (error) { return failed(error); }
  };
} catch (error) {
  emit('note', '', '加载器观察不可用，保留原始异常输出：' + error.message);
}
process.on('uncaughtExceptionMonitor', error => {
  const detail = String(error.stack || error);
  emit('issue', owner(detail), detail);
});
