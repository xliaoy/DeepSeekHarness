/**
 * dsh-balance-panel — Host 半身。
 *
 * 职责：
 *  1. 枚举当前 DSH 配置的所有模型 Provider（可配置 Provider 目录 + 默认模型回退）；
 *  2. 通过凭证服务解析每个 Provider 的 API Key（密钥全程留在进程内，不出 Host）；
 *  3. 按余额策略查询各账号余额/配额（内置 DeepSeek / StepFun / Kimi / OpenRouter /
 *     MiniMax / xAI 策略 + profile.balance 自定义 + 登录跳转）；
 *  4. 在回环 webServer 上注册 GET /dsh-balance-panel，返回归一化的 JSON 给浏览器半身。
 *
 * 依赖：webServer（硬依赖），settings / llm / credentials / agentDefaultModel（可选）。
 *
 * @module dsh-balance-panel/host
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'

/** Cordis 插件名。 */
export const name = 'balance-panel'

/** 硬依赖：路由需要 webServer 服务。 */
export const inject = ['webServer']

// ---------------------------------------------------------------------------
// 余额策略表（借鉴社区 dsh-model-balance 的策略实现，均为官方 Bearer 计费接口）
// ---------------------------------------------------------------------------

/** deepseek-official 内置默认值（适配器默认配置的镜像，配置缺失时兜底）。 */
const DEEPSEEK_DEFAULTS = {
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  baseURL: 'https://api.deepseek.com',
}

function parseDeepSeek(body) {
  const infos = body && Array.isArray(body.balance_infos) ? body.balance_infos : []
  if (infos.length === 0) return { status: 'error', message: '无法识别的余额响应' }
  const entry = infos.find((i) => i && i.currency === 'CNY') || infos[0]
  const total = Number(entry && entry.total_balance)
  if (!Number.isFinite(total)) return { status: 'error', message: '余额不是数字' }
  return {
    status: 'ok',
    kind: 'currency',
    available: body.is_available !== false,
    infos: [{
      currency: typeof entry.currency === 'string' ? entry.currency : 'CNY',
      totalBalance: String(total),
      grantedBalance: String(Number(entry.granted_balance) || 0),
      toppedUpBalance: String(Number(entry.topped_up_balance) || 0),
    }],
  }
}

function parseStepFun(body) {
  const balance = Number(body && body.balance)
  if (!Number.isFinite(balance)) return { status: 'error', message: '无法识别的 StepFun 账户响应' }
  return {
    status: 'ok',
    kind: 'currency',
    infos: [{
      currency: 'CNY',
      totalBalance: String(balance),
      grantedBalance: String(Number(body.total_voucher_balance) || 0),
      toppedUpBalance: String(Number(body.total_cash_balance) || 0),
    }],
  }
}

function parseKimiCoding(body) {
  const usage = body && body.usage
  const limit = Number(usage && usage.limit)
  const used = Number(usage && usage.used)
  const remaining = Number(usage && usage.remaining)
  if (!Number.isFinite(limit) || !Number.isFinite(used) || !Number.isFinite(remaining)) {
    return { status: 'error', message: '无法识别的 Kimi 配额响应' }
  }
  const dims = [{
    window: 'weekly',
    limit,
    used,
    remaining,
    resetTime: typeof usage.resetTime === 'string' ? usage.resetTime : null,
  }]
  const limits = Array.isArray(body.limits) ? body.limits : []
  if (limits.length > 0 && limits[0] && limits[0].detail) {
    const d = limits[0].detail
    const hLimit = Number(d.limit)
    const hUsed = Number(d.used)
    const hRemaining = Number(d.remaining)
    if (Number.isFinite(hLimit) && Number.isFinite(hUsed) && Number.isFinite(hRemaining)) {
      dims.push({
        window: 'hourly',
        limit: hLimit,
        used: hUsed,
        remaining: hRemaining,
        resetTime: typeof d.resetTime === 'string' ? d.resetTime : null,
      })
    }
  }
  return {
    status: 'ok',
    kind: 'quota',
    unit: 'requests',
    limit,
    used,
    remaining,
    resetTime: typeof usage.resetTime === 'string' ? usage.resetTime : null,
    dims,
  }
}

function parseOpenRouter(body) {
  const data = body && body.data
  if (!data) return { status: 'error', message: '无法识别的 OpenRouter 响应' }
  // OpenRouter 返回的是美分
  const limitCents = Number(data.limit)
  const usageCents = Number(data.usage)
  if (!Number.isFinite(limitCents)) return { status: 'error', message: 'OpenRouter limit 不是数字' }
  const balance = limitCents > 0 ? (limitCents - usageCents) / 100 : 0
  return {
    status: 'ok',
    kind: 'currency',
    infos: [{ currency: 'USD', totalBalance: String(Math.max(0, balance)) }],
  }
}

function parseMiniMax(body) {
  const remaining = Number(body && (body.data ?? body.remaining))
  const total = Number(body && (body.total ?? body.limit))
  if (!Number.isFinite(remaining)) return { status: 'error', message: '无法识别的 MiniMax 响应' }
  return {
    status: 'ok',
    kind: 'quota',
    unit: 'requests',
    limit: Number.isFinite(total) ? total : 0,
    used: Number.isFinite(total) && Number.isFinite(remaining) ? Math.max(0, total - remaining) : 0,
    remaining,
    dims: [],
  }
}

function parseXai(body) {
  const balance = Number(body && (body.balance ?? body.total_granted))
  if (!Number.isFinite(balance)) return { status: 'error', message: '无法识别的 xAI 响应' }
  return {
    status: 'ok',
    kind: 'currency',
    infos: [{ currency: 'USD', totalBalance: String(balance) }],
  }
}

/** 策略表：key 为规范 provider id，aliases 为别名。 */
const STRATEGIES = {
  deepseek: {
    suffix: '/user/balance',
    defaultBaseURL: 'https://api.deepseek.com',
    defaultKeyEnv: 'DEEPSEEK_API_KEY',
    parse: parseDeepSeek,
    aliases: ['deepseek-official'],
  },
  stepfun: {
    suffix: '/accounts',
    defaultBaseURL: 'https://api.stepfun.com/v1',
    defaultKeyEnv: 'STEPFUN_API_KEY',
    parse: parseStepFun,
  },
  'kimi-coding': {
    suffix: '/v1/usages',
    defaultBaseURL: 'https://api.kimi.com/coding',
    defaultKeyEnv: 'KIMI_API_KEY',
    parse: parseKimiCoding,
    aliases: ['kimi'],
  },
  openrouter: {
    suffix: '/api/v1/auth/key',
    defaultBaseURL: 'https://openrouter.ai',
    defaultKeyEnv: 'OPENROUTER_API_KEY',
    parse: parseOpenRouter,
  },
  minimax: {
    suffix: '/v1/token_plan/remains',
    defaultBaseURL: 'https://api.minimax.chat',
    defaultKeyEnv: 'MINIMAX_API_KEY',
    parse: parseMiniMax,
  },
  xai: {
    suffix: '/v1/dashboard/billing/credit_grants',
    defaultBaseURL: 'https://api.x.ai',
    defaultKeyEnv: 'XAI_API_KEY',
    parse: parseXai,
    aliases: ['grok'],
  },
}

/** provider id 别名 → 规范 key（大小写不敏感）。 */
const KNOWN_IDS = new Map()
for (const [canonical, s] of Object.entries(STRATEGIES)) {
  KNOWN_IDS.set(canonical.toLowerCase(), canonical)
  for (const alias of s.aliases || []) KNOWN_IDS.set(alias.toLowerCase(), canonical)
}

/** baseURL 家族 → 规范 key（自定义别名指向已知端点时自动命中）。 */
const URL_MATCHERS = [
  [/api\.deepseek\.com/i, 'deepseek'],
  [/api\.stepfun\.com/i, 'stepfun'],
  [/api\.kimi\.com/i, 'kimi-coding'],
  [/openrouter\.ai/i, 'openrouter'],
  [/api\.minimax\.chat/i, 'minimax'],
  [/api\.x\.ai/i, 'xai'],
  [/platform\.stepfun\.com/i, 'stepfun'],
]

/** 无 API 余额接口、需登录控制台查看的 Provider（id → 控制台 URL）。 */
const LOGIN_REQUIRED_BY_ID = {
  'qwen-token-plan-cn': 'https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan/personal',
  'qwen-token-plan': 'https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan/personal',
  'qwen-coding-plan': 'https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan/personal',
  xiaomi: 'https://platform.xiaomimimo.com/console/balance',
}

const LOGIN_REQUIRED_URLS = [
  [/bailian\.console\.aliyun\.com|dashscope|aliyuncs\.com/i, 'https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan/personal'],
  [/xiaomimimo\.com/i, 'https://platform.xiaomimimo.com/console/balance'],
]

function stripSlash(url) {
  return String(url).replace(/\/+$/, '')
}

/**
 * 解析 Provider 的余额查询策略：先按 id（含别名）精确匹配，再按 baseURL 家族匹配。
 * @returns {object|undefined} { url, keyEnv, parse }
 */
function matchStrategy(providerId, profile) {
  const canonical = KNOWN_IDS.get(String(providerId).toLowerCase())
  if (canonical !== undefined) {
    const s = STRATEGIES[canonical]
    const baseURL = profile && typeof profile.baseURL === 'string' ? profile.baseURL : s.defaultBaseURL
    const keyEnv = profile && typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : s.defaultKeyEnv
    return { url: `${stripSlash(baseURL)}${s.suffix}`, keyEnv, parse: s.parse }
  }
  const baseURL = profile && typeof profile.baseURL === 'string' ? profile.baseURL : undefined
  if (baseURL !== undefined) {
    for (const [pattern, key] of URL_MATCHERS) {
      if (pattern.test(baseURL)) {
        const s = STRATEGIES[key]
        if (s) {
          return {
            url: `${stripSlash(baseURL)}${s.suffix}`,
            keyEnv: profile && typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : s.defaultKeyEnv,
            parse: s.parse,
          }
        }
      }
    }
  }
  return undefined
}

/** 解析"需登录查看"的 Provider 控制台地址。 */
function matchLoginRequired(providerId, profile) {
  const byId = LOGIN_REQUIRED_BY_ID[String(providerId).toLowerCase()]
  if (byId !== undefined) return byId
  const baseURL = profile && typeof profile.baseURL === 'string' ? profile.baseURL : undefined
  if (baseURL !== undefined) {
    for (const [pattern, url] of LOGIN_REQUIRED_URLS) {
      if (pattern.test(baseURL)) return url
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Provider 枚举与余额查询
// ---------------------------------------------------------------------------

/** 沿 settingsPath 走一层对象（user/base/value 都可用）。 */
function walkPath(node, path) {
  for (const key of path || []) {
    node = node && typeof node === 'object' ? node[key] : undefined
  }
  return node
}

/** 从 profile 里提取模型 id 列表（字符串或 {id|name} 均可）。 */
function modelsOf(profile) {
  if (!profile || !Array.isArray(profile.models)) return []
  return profile.models
    .map((m) => (typeof m === 'string' ? m : m && (m.id || m.name)))
    .filter((x) => typeof x === 'string' && x)
}

/**
 * 枚举**已配置**的 Provider。
 * 只保留真正配置过的 Provider：settings 的 user 层（用户自己写的）或 base 层
 * （部署层声明）里有该 Provider 的 profile，或者是默认模型选中的 Provider。
 * 模型只取用户实际配置的（user 层优先，base 层次之）；schema 默认模型列表不会带出。
 */
function collectProviders(ctx) {
  const llm = ctx.get('llm')
  const settings = ctx.get('settings')
  const entries = (llm && llm.listConfigurableProviders ? llm.listConfigurableProviders() : []) || []
  let views = []
  try {
    views = (settings && settings.describe ? settings.describe({ redactSecrets: true }) : []) || []
  } catch {
    // settings 未挂载
  }

  let sel = null
  try {
    sel = (ctx.get('agentDefaultModel') && ctx.get('agentDefaultModel').currentSelection()) || null
  } catch {
    // 服务缺失
  }

  const out = new Map()
  for (const e of entries) {
    const desc = views.find((v) => v && String(v.ns) === e.settingsNs)
    const profileUser = desc ? walkPath(desc.user, e.settingsPath) : undefined
    const profileBase = desc ? walkPath(desc.base, e.settingsPath) : undefined
    const isDefaultProvider = !!(sel && sel.provider === e.provider)

    const configured = isDefaultProvider
      || (profileUser && typeof profileUser === 'object')
      || (profileBase && typeof profileBase === 'object')
    if (!configured) continue

    const userModels = modelsOf(profileUser)
    const baseModels = modelsOf(profileBase)
    let models = userModels.length > 0 ? userModels : baseModels
    if (models.length === 0 && isDefaultProvider && sel && sel.model) models = [sel.model]

    const profile = profileUser && typeof profileUser === 'object'
      ? profileUser
      : (profileBase && typeof profileBase === 'object' ? profileBase : undefined)

    const isDeepseek = e.provider === 'deepseek-official' || e.provider === 'deepseek'
    let apiKeyEnv = profile && typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined
    let baseURL = profile && typeof profile.baseURL === 'string' ? profile.baseURL : undefined
    let api = profile && typeof profile.api === 'string' ? profile.api : undefined
    if (isDeepseek) {
      apiKeyEnv = apiKeyEnv || DEEPSEEK_DEFAULTS.apiKeyEnv
      baseURL = baseURL || DEEPSEEK_DEFAULTS.baseURL
      api = api || 'deepseek'
    }

    out.set(e.provider, {
      id: e.provider,
      displayName: (profile && typeof profile.displayName === 'string' && profile.displayName) || e.displayName || e.provider,
      apiKeyEnv,
      baseURL,
      api,
      models,
      profile: profile || undefined,
    })
  }

  // 默认 Provider 若不在目录里，用内置默认兜底
  if (sel && sel.provider && !out.has(sel.provider)) {
    const isDeepseek = sel.provider === 'deepseek-official' || sel.provider === 'deepseek'
    out.set(sel.provider, {
      id: sel.provider,
      displayName: sel.provider,
      apiKeyEnv: isDeepseek ? DEEPSEEK_DEFAULTS.apiKeyEnv : undefined,
      baseURL: isDeepseek ? DEEPSEEK_DEFAULTS.baseURL : undefined,
      api: isDeepseek ? 'deepseek' : undefined,
      models: sel.model ? [sel.model] : [],
      profile: undefined,
    })
  }
  return { providers: Array.from(out.values()), default: sel }
}

/** 用宿主全局 fetch 发起带认证头的 GET 并解析 JSON。 */
async function httpGetJson(url, auth, key) {
  if (typeof fetch !== 'function') {
    return { ok: false, error: '宿主进程没有全局 fetch' }
  }
  const headers = {}
  if (auth === 'bearer' && key) headers.authorization = `Bearer ${key}`
  let res
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) }
  }
  if (!res.ok) return { ok: false, error: `余额接口 HTTP ${res.status}` }
  try {
    return { ok: true, body: await res.json() }
  } catch {
    return { ok: false, error: '余额接口返回了非 JSON 内容' }
  }
}

async function resolveKey(ctx, keyEnv) {
  if (!keyEnv) return null
  try {
    const credentials = ctx.get('credentials')
    const hit = credentials ? await credentials.resolve(credentialRef(keyEnv)) : null
    return hit && hit.value ? hit.value : null
  } catch {
    return null
  }
}

async function queryEndpoint(ctx, spec, entry) {
  if (spec.keyEnv && !spec.key) {
    return { status: 'no-credential', message: `凭证 ${spec.keyEnv} 未配置` }
  }
  const res = await httpGetJson(spec.url, spec.auth, spec.key)
  if (!res.ok) return { status: 'error', message: res.error }
  const parsed = spec.parse(res.body)
  if (parsed.status === 'ok') entry.credentialConfigured = true
  return parsed
}

/** 查询单个 Provider 的余额/配额/登录地址，产出给前端的归一化条目。 */
async function queryProviderBalance(ctx, p) {
  const entry = {
    id: p.id,
    displayName: p.displayName,
    apiKeyEnv: p.apiKeyEnv || null,
    baseURL: p.baseURL || null,
    api: p.api || null,
    models: p.models || [],
    credentialConfigured: false,
    balance: null,
  }
  // 先报告密钥配置状态（describe 不读取值）
  if (p.apiKeyEnv) {
    try {
      const credentials = ctx.get('credentials')
      const info = credentials ? await credentials.describe(credentialRef(p.apiKeyEnv)) : null
      entry.credentialConfigured = !!(info && info.configured)
    } catch {
      // 保持 false
    }
  }

  // 1) 自定义 balance 配置优先
  const custom = p.profile && typeof p.profile.balance === 'object' && p.profile.balance !== null
    ? p.profile.balance
    : null
  if (custom && typeof custom.endpoint === 'string' && custom.endpoint) {
    entry.balance = await queryEndpoint(ctx, {
      url: /^https?:\/\//.test(custom.endpoint)
        ? custom.endpoint
        : `${(p.baseURL || '').replace(/\/+$/, '')}${custom.endpoint}`,
      auth: custom.auth === 'none' ? 'none' : 'bearer',
      keyEnv: p.apiKeyEnv,
      parse: parseDeepSeek,
      key: p.apiKeyEnv ? await resolveKey(ctx, p.apiKeyEnv) : null,
    }, entry)
    return entry
  }

  // 2) 内置策略表（id 别名 + baseURL 家族）
  const strat = matchStrategy(p.id, p.profile)
  if (strat) {
    entry.balance = await queryEndpoint(ctx, {
      url: strat.url,
      auth: 'bearer',
      keyEnv: strat.keyEnv,
      parse: strat.parse,
      key: await resolveKey(ctx, strat.keyEnv),
    }, entry)
    return entry
  }

  // 3) 登录跳转（无 API 接口但有控制台）
  const consoleUrl = matchLoginRequired(p.id, p.profile)
  if (consoleUrl) {
    entry.balance = { status: 'login-required', consoleUrl }
    return entry
  }

  // 4) 不支持
  entry.balance = { status: 'unsupported', message: '该 Provider 没有已知的余额查询接口' }
  return entry
}

/** 汇总全部 Provider 的余额视图。 */
async function queryAll(ctx) {
  const collected = collectProviders(ctx)
  const providers = []
  for (const p of collected.providers) {
    try {
      providers.push(await queryProviderBalance(ctx, p))
    } catch (e) {
      providers.push({
        id: p.id,
        displayName: p.displayName,
        apiKeyEnv: p.apiKeyEnv || null,
        baseURL: p.baseURL || null,
        api: p.api || null,
        models: p.models || [],
        credentialConfigured: false,
        balance: { status: 'error', message: e && e.message ? e.message : String(e) },
      })
    }
  }
  return { generatedAt: Date.now(), default: collected.default, providers }
}

/** 序列化 JSON 响应。 */
function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

/** 插件主体：挂载 /dsh-balance-panel 路由。 */
export function apply(ctx) {
  const handler = async (req, res) => {
    try {
      sendJson(res, 200, await queryAll(ctx))
    } catch (e) {
      sendJson(res, 500, {
        error: e instanceof Error ? e.message : String(e),
        providers: [],
      })
    }
  }
  ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-balance-panel',
    handler,
  })
}
