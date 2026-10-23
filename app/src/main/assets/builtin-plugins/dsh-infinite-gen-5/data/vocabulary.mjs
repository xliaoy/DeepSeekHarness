// 无限五代 · 命中词汇表机制（唯一真源：规则与护栏）
//
// 这份文件只管「什么词条算合法」与「怎么合并」，数据在 vocabulary-data.mjs
// （由 scripts/vocab-build.mjs 从 data/vocab/*.json 生成）。
//
// 为什么需要一层护栏：
//   markers 的匹配语义是「小写折叠后 indexOf」，也就是子串命中。短词的代价不是
//   多命中一次，而是**整族误判** —— 历史教训：`log` 命中 logic/login，`safe` 命中
//   unsafe，`ios` 命中 biosphere，`can` 命中 candidate/equipment。所以这里立三条硬规则，
//   由 scripts/verify_vocab.mjs 强制：
//     1) 拉丁词条 ≥4 字符（少数公认缩写进 SHORT_MARKER_OK 白名单）；
//     2) 中文词条 ≥2 字，且不得是需要上下文才能落域的泛词（STOP_MARKERS）；
//     3) 跨族共用的同一 marker 必须显式登记在 CROSS_FAMILY_ALLOW 里并写明理由。
//   第 3 条针对的是「同一个词把用户路由到两个不同族」的情况：同族内共用无害
//   （hits 计数会把双方都算上，rankDomains 再按命中数排序），跨族共用才会真正抢路由。

/** 允许短于 4 字符的拉丁 marker。白名单里每个词都必须是「在中文技术语境里
 *  基本不会出现在别的英文单词内部」的形态；`elf`/`ida`/`c2`/`os`/`ip` 这类
 *  看似专业但会命中 self/candidate/hex 串/equipment 的，一律不收。 */
export const SHORT_MARKER_OK = Object.freeze([
  "apk", "ipa", "jwt", "xss", "sql", "cve", "dll", "dns", "tls", "ssh",
  "smb", "rdp", "lfi", "rfi", "nfc", "pdb", "wpa", "ntlm", "kerberos",
  "spi", "i2c", ".php",
]);
// 已知风险（允许但要在报告里显式列出的碰撞）：ipa ⊂ principal、spi ⊂ despite。
// verify_vocab 会把 allowlist 词条与 TRAP_WORDS 的碰撞逐条打印出来，让人自己判断
// 能不能接受，而不是假装它们不存在。

/** 长度 ≥4、却仍是某个常用英文单词子串的拉丁 marker：逐条签字接受。
 *  判据是「碰撞要付出的代价」：capa/lora/ruff/uart 都不是用户日常英文里会随手
 *  打出来的词，误命中的概率远低于它们带来的识别力；而 ble ⊂ table/enabled/double
 *  这种就必须删（已从 rf 包里删掉）。值是接受它的理由。 */
export const TRAP_ALLOW = Object.freeze({
  capa: "恶意样本能力识别工具，英文里不会用 capa 这个拼写",
  lora: "模型微调技术名，撞 floral/人名 Lora 的概率低到可忽略",
  ruff: "Python linter，撞 ruffle/ruffian 属罕见词",
});

/** 常用英文词：任何 marker 若是它们的子串，就要在报告里点名。
 *  v0.26.0 起这里是唯一源 —— 面板要现算撞车，`scripts/lib/vocab-fixtures.mjs`
 *  改成从这里转出，避免运行时与门禁各抄一份慢慢漂移。 */
export const TRAP_WORDS = Object.freeze([
  "logic", "login", "unsafe", "biosphere", "candidate", "equipment", "database",
  "windows", "build", "guide", "table", "enabled", "double", "capable", "self",
  "address", "macos", "cost", "capital", "adapt", "desktop", "floral", "principal",
  "despite", "quarter", "ruffle", "combat", "catalog", "load", "port", "core",
  "market", "password", "profile", "process", "product", "project", "request",
  "resource", "service", "session", "source", "support", "system", "target",
  "transfer", "transport", "trigger", "update", "upgrade", "virtual", "volume",
]);
// 曾经想收但**实测有害**的短词，留在这里当反面教材：
//   dos → 命中 windows；ui / ux → 命中 build、guide、flux；ble → 命中 table、enabled、
//   double、capable；elf → 命中 self；ida → 命中 candidate；can → 命中 candidate。
// 短词的诱惑在于「专业」，代价却是把整个族判错，所以宁可让用户多打几个字。

/** 拉丁词条的最小长度（按词条里的拉丁字母/数字总数计）。 */
export const MARKER_MIN_LATIN = 4;
/** 中文词条的最小字数。 */
export const MARKER_MIN_CJK = 2;

// ───────────────────────── 预算（自检与本文件共同的真源） ─────────────────────────
// v0.24.0 再上调：域包 62 → 78、标记表 1501 → 1736，索引 11701 → 14560 B（占旧预算 91%）。
// 预算与词条/域包同一个 diff 动（16000 → 20000），理由同上：留出下一次加域的余量。
// 索引预算**有意上调**：4628 B → 12000 B（v0.13.6 每域加一行「命中词」）→ 16000 B（v0.14.0）。
// 索引的价值是把「为什么落到这个域」摊开给模型看（附带暴露跨域共用词），
// 用户点名要的就是这层深度；代价是每次无参调用多约 2.5K token。
// 与之配套的护栏不是「别涨」，而是「涨要有记录」：改动这里必须同时改注释。
//
// v0.14.0 为什么非涨不可：域数 56 → 62（evasion / privesc / phishing / rat_c2 / dos / drm），
// 每个域在索引里占 2 行（标签行 + 命中词行），实测 10603 B → 约 12.6 KB。
// 这次涨预算和加域包写在同一个 diff 里，正是上面那条规矩的用法。
// v0.27.0 三度上调（20000 → 24000）：域包 90 → 107、标记表 2034 → 2311，索引 16674 → 20017 B
// —— 已越过旧预算 17 B（verify:vocab / verify:scenarios 双双报「索引 ≤ 20000 B — 20017 B」）。
// 按上面那条「涨要有记录」的规矩，理由与代价写在这里：
//   · 索引每域两行（标签 + 命中词），107 域实测 20017 B ≈ 5410 tokens，只进「无参调用」这一条路径；
//   · 带域名的调用走 renderScenario，不进索引，所以成本不随对话轮数放大；
//   · 新预算留 3983 B 余量（约 21 个域），与下一次扩域同批再议。
export const INDEX_BUDGET_BYTES = 24000;
// playbook 上限同样上调（4200 → 6000）：工具链与命令词汇两节变长，
// 实测最长包（re）从 3152 B 涨到 4540 B，仍在一次工具返回的舒适区。
export const PLAYBOOK_MIN_BYTES = 600;
export const PLAYBOOK_MAX_BYTES = 6000;

/** 禁止作为 marker 的泛词：它们离开上下文就没有领域指向，且极易跨族命中。
 *  不在这里的其它中文词也不是随便就能进 —— 长度与「是否只有一个族会用」
 *  由 verify_vocab 用真实语料复核。 */
export const STOP_MARKERS = Object.freeze([
  "系统", "代码", "数据", "工具", "方法", "分析", "问题", "流程", "服务",
  "模型", "网络", "安全", "测试", "配置", "文档", "设计", "优化", "实现",
  "文件", "命令", "脚本", "环境", "平台", "项目", "功能", "内容", "知识",
]);

/** 跨族共用且**有意为之**的 marker：值是理由，写不清理由的说明该词条不该存在。
 *  由 scripts/verify_vocab.mjs 强制：MARKER_INDEX 里任何 crossFamily=true 的词条
 *  都必须在这张表里，否则自检红 —— 「这个词会不会把用户送到另一个族」必须有人签字。 */
export const CROSS_FAMILY_ALLOW = Object.freeze({
  jupyter: "ai 与 data 都会用 notebook",
  "提示注入": "ai 内部两域都用（llm 破限与 injection 注入）",
  // ── 实测登记（2026-09，扩展词表并入后由 MARKER_INDEX 扫出，逐条给理由） ──
  mitmproxy: "web 抓改包与 protocol_re 协议还原用同一个中间人",
  wireshark: "network_device 抓包排障与 protocol_re 协议还原共用（network_device 侧只读流量）",
  tshark: "同 wireshark，命令行形态",
  binwalk: "firmware 解包、re 定位段结构、stego 挖隐藏数据，三边都是同一动作",
  hashcat: "crack 破软件授权与 decrypt 口令恢复都是离线哈希",
  "字典攻击": "同 hashcat：口令恢复的两个域都靠字典",
  "暴力破解": "同字典攻击，属机制词而非领域词",
  ghidra: "crack / protocol_re / re 三边都要反汇编（破解与协议还原都要读反汇编）",
  jadx: "mobile 反编译与 protocol_re 还原客户端协议共用",
  ioc: "forensics 找失陷指标与 malware 提取 IOC 是同一批数据",
  "隐写": "stego 讲手法、deanon 讲从隐写内容里关联身份",
  "github actions": "supply_chain 关注 CI 投毒面、automation 关注 CI 怎么配，同一个对象",
  yara: "offense 与 data 都用特征码（样本家族 / 取证匹配）",
  "授权绕过": "crack 破授权体系统称、drm 管数字版权授权体系，同一个动作在两边都出现（v0.52.11 补 crack markers 时登记）",
});

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN = /[a-z0-9]/;

/** 词条形态分类，报告与自检共用。 */
export function classifyMarker(marker) {
  const s = String(marker ?? "");
  const hasCjk = CJK.test(s);
  const hasLatin = LATIN.test(s.toLocaleLowerCase());
  if (hasCjk && hasLatin) return "mixed";
  if (hasCjk) return "cjk";
  if (hasLatin) return "latin";
  return "other";
}

const countCjk = (s) => (s.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length;
const countLatin = (s) => (s.toLocaleLowerCase().match(/[a-z0-9]/g) ?? []).length;

/** 单条 marker 的合法性：返回 {ok, reason}，reason 供自检直接打印。 */
export function checkMarker(marker) {
  if (typeof marker !== "string") return { ok: false, reason: "不是字符串" };
  const m = marker.trim();
  if (!m) return { ok: false, reason: "空词条" };
  if (m !== marker) return { ok: false, reason: "首尾有空白" };
  if (m !== m.toLocaleLowerCase()) return { ok: false, reason: "未小写折叠" };
  if (/\s{2,}/.test(m)) return { ok: false, reason: "连续空白" };

  const kind = classifyMarker(m);
  if (kind === "other") return { ok: false, reason: "既无中文也无拉丁字符" };

  if (STOP_MARKERS.includes(m)) return { ok: false, reason: "STOP_MARKERS 泛词" };

  const cjk = countCjk(m);
  const latin = countLatin(m);
  // 中英混写（`apk加固`、`ios逆向`、`gg修改器`）按**中文规则**放行：它已经带了
  // ≥2 个汉字，子串碰撞需要整串出现，短拉丁前缀不再构成风险。硬卡拉丁长度会把
  // 这类最好的词条（用户真实写法）全判掉 —— 规则的目的是防误命中，不是防短词。
  if (cjk >= MARKER_MIN_CJK) return { ok: true, reason: "" };
  // 单汉字 + 足够长的拉丁串（`enigma 壳`）同样放行：锚点在拉丁部分，
  // 碰撞需要整串出现。真正要拦的是「一个汉字配一个短词」这种两边都不锚定的写法。
  if (cjk === 1 && latin >= MARKER_MIN_LATIN) return { ok: true, reason: "" };
  if (cjk === 1) return { ok: false, reason: "只有一个汉字，看不出领域（补齐或改用纯拉丁）" };
  if (latin < MARKER_MIN_LATIN && !SHORT_MARKER_OK.includes(m)) {
    return { ok: false, reason: `拉丁词条 ${latin} 字符 < ${MARKER_MIN_LATIN} 且不在白名单` };
  }
  return { ok: true, reason: "" };
}

/** 别名（给人看的说法）的合法性：短、无换行、不重复由调用方保证。 */
export function checkAlias(alias) {
  if (typeof alias !== "string") return { ok: false, reason: "不是字符串" };
  const a = alias.trim();
  if (!a) return { ok: false, reason: "空别名" };
  if (a !== alias) return { ok: false, reason: "首尾有空白" };
  if (a.length > 16) return { ok: false, reason: "别名过长（>16 字）" };
  if (/[\n\r|]/.test(a)) return { ok: false, reason: "含换行或竖线" };
  return { ok: true, reason: "" };
}

/** 工具链条目形态：`<工具> — <用途> | 装: <命令> | 验: <命令>`。
 *  行内 `|` 前的空格不强制（多批人写的，靠这个格式挑毛病不如靠它发现缺段），
 *  三段必须都在，缺一段就是真问题。 */
export const TOOLCHAIN_LINE_RE = /^.+? — .+ \| 装: .+\| 验: .+$/;

export function checkToolchainLine(line) {
  if (typeof line !== "string") return { ok: false, reason: "不是字符串" };
  if (/[\n\r]/.test(line)) return { ok: false, reason: "含换行" };
  if (!TOOLCHAIN_LINE_RE.test(line)) return { ok: false, reason: "不符合 `<工具> — <用途> | 装: … | 验: …` 形态" };
  if (line.length > 400) return { ok: false, reason: "过长（>400 字符）" };
  return { ok: true, reason: "" };
}

/** 按小写折叠去重合并（保留先出现的写法与顺序）。 */
export function mergeUnique(base, extra) {
  const out = Array.isArray(base) ? base.slice() : [];
  const seen = new Set(out.map((x) => String(x).toLocaleLowerCase()));
  for (const item of extra ?? []) {
    const key = String(item).toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** 命中表：marker → 命中域。索引、报告、自检共用同一份视图。
 *  entries 按「歧义优先、再按长度降序」排，便于人直接看最容易出事的词。 */
export function buildMarkerIndex(markersByDomain, { families = {} } = {}) {
  const byMarker = new Map();
  for (const [domain, markers] of Object.entries(markersByDomain)) {
    for (const marker of markers ?? []) {
      const key = String(marker).toLocaleLowerCase();
      if (!byMarker.has(key)) byMarker.set(key, { marker: key, domains: [], kind: classifyMarker(key) });
      const row = byMarker.get(key);
      if (!row.domains.includes(domain)) row.domains.push(domain);
    }
  }
  const entries = [...byMarker.values()]
    .map((row) => {
      const fams = [...new Set(row.domains.map((d) => families[d] ?? "?"))];
      return {
        ...row,
        length: [...row.marker].length,
        families: fams,
        ambiguous: row.domains.length > 1,
        crossFamily: fams.length > 1,
      };
    })
    .sort((a, b) => Number(b.crossFamily) - Number(a.crossFamily) || Number(b.ambiguous) - Number(a.ambiguous) || b.length - a.length || a.marker.localeCompare(b.marker));

  const stats = {
    markers: entries.length,
    domains: Object.keys(markersByDomain).length,
    shared: entries.filter((e) => e.ambiguous).length,
    crossFamily: entries.filter((e) => e.crossFamily).length,
    byKind: entries.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {}),
    perDomain: Object.fromEntries(Object.entries(markersByDomain).map(([d, m]) => [d, (m ?? []).length])),
  };
  return { entries, byMarker, stats, families };
}
