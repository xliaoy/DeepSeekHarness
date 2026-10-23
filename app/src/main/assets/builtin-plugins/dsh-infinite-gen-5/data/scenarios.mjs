// 无限五代 · 领域包数据（单一真源）
//
// 这份文件同时供三处使用：
//   1. index.js        —— infinite_gen5_scenario 工具的返回值、DOMAIN_MARKERS 领域标记表
//   2. scripts/lib/scorer.mjs —— 离线评测的领域判定（与运行时同一张表，杜绝两处漂移）
//   3. scripts/verify_scenarios.mjs —— 自检
//
// 设计约束：
//   - 每个领域包是「打法骨架」，不是百科。5 个槽位（ROLE/OBJECT/ACTION/SCOPE/SHAPE）
//     与内核载荷里的骨架一一对应，这样模型把用户请求映射到槽位后，能直接用包的写法。
//   - 包只在模型调用工具时才被读取，不进系统提示词 ⇒ 条数不受每轮 token 预算约束。
//   - `markers` 是子串匹配（小写折叠后 indexOf），因此一律避开会误命中的短词
//     （历史教训：log 命中 logic/login，safe 命中 unsafe，ios 命中 biosphere）。

import { TOOLCHAINS, TOOLCHAIN_PROTOCOL, toolchainOf } from "./toolchains.mjs";
import { ALIAS_EXTRA, COMMAND_VOCAB, MARKER_EXTRA, TOOLCHAIN_EXTRA } from "./vocabulary-data.mjs";
import { buildMarkerIndex, mergeUnique } from "./vocabulary.mjs";

export const SCENARIO_DATA_VERSION = 2;

// 工具链与领域包拆成两份数据：包讲「怎么打」，工具链讲「用什么打、缺了怎么装」。
// 每个领域包的 `toolchain` 由 id 从 TOOLCHAINS 挂上（渲染时进 playbook 的「工具链」一节）。
export { TOOLCHAINS, TOOLCHAIN_PROTOCOL, toolchainOf };

export const FAMILIES = [
  { id: "offense", label: "攻防 / 逆向", note: "授权测试、自有资产、离线环境" },
  { id: "ai", label: "AI / LLM", note: "研究语境下的模型与提示词攻防" },
  { id: "crypto", label: "密码与协议", note: "算法还原、实现缺陷、账本" },
  { id: "data", label: "数据与隐私", note: "采集、关联、取证、合规" },
  { id: "creative", label: "内容创作", note: "虚构写作，含成人向" },
  { id: "language", label: "语言与学术", note: "翻译、写作、教学、说服" },
  { id: "engineering", label: "工程与业务", note: "代码、架构、运维、产品" },
];

import { DOMAINS_01 } from "./scenarios/domains/domains-01.mjs";
import { DOMAINS_02 } from "./scenarios/domains/domains-02.mjs";
import { DOMAINS_03 } from "./scenarios/domains/domains-03.mjs";
import { DOMAINS_04 } from "./scenarios/domains/domains-04.mjs";
import { DOMAINS_05 } from "./scenarios/domains/domains-05.mjs";

// SCENARIOS = 5 段顺序拼接（拆分前后逐字一致，见 scripts/verify_scenarios.mjs 的等值断言）
export const SCENARIOS = [...DOMAINS_01, ...DOMAINS_02, ...DOMAINS_03, ...DOMAINS_04, ...DOMAINS_05];

// 口语别名补丁：用户很少按术语提问（「内存修改」「写歌词」「改bug」），
// 这里补齐最容易被用到的说法，让 findScenarios 不必依赖领域标记表兜底。
const EXTRA_ALIASES = {
  web: ["接口漏洞", "网站漏洞", "登录爆破", "接口安全"],
  mobile: ["app逆向", "安卓逆向", "手机app", "app安全"],
  miniprogram: ["小程序逆向", "小程序抓包"],
  game: ["内存修改", "修改器", "游戏修改", "改内存", "读内存", "存档修改"],
  kernel: ["内核驱动", "驱动开发", "驱动调试"],
  firmware: ["路由器固件", "固件解包", "iot安全", "物联网安全"],
  rf: ["门禁破解", "射频卡", "门禁卡复制", "nfc卡"],
  automotive: ["can分析", "车机破解", "汽车总线", "总线分析"],
  cloud: ["云安全", "容器逃逸", "k8s安全", "云上提权"],
  network: ["内网渗透", "域控", "域环境", "横向移动", "打内网"],
  network_device: ["路由器漏洞", "交换机配置", "网络设备审计"],
  supply_chain: ["依赖安全", "构建投毒", "供应链投毒"],
  osint: ["情报收集", "资产发现", "社工信息", "公开情报"],
  crack: ["软件破解", "注册机开发", "去授权", "过授权"],
  llm: ["提示词泄露", "系统提示词提取", "破限", "写破甲"],
  injection: ["提示注入", "间接注入", "注入提示词"],
  adversarial_suffix: ["对抗攻击", "越狱后缀", "对抗提示"],
  output_shaping: ["绕审核", "内容绕过", "过审"],
  model_internals: ["模型压缩", "本地部署模型", "模型转换"],
  agent: ["智能体安全", "mcp安全", "工具链安全"],
  protocol_re: ["协议分析", "抓包还原", "协议还原"],
  crypto_impl: ["加密审计", "密码学实现", "加密算法缺陷"],
  chain: ["合约审计", "链上追踪", "智能合约审计"],
  sidechannel: ["硬件攻击", "芯片分析", "功耗攻击"],
  scraping: ["数据抓取", "网页采集", "爬数据"],
  deanon: ["身份关联", "数据关联", "匿名数据分析"],
  forensics: ["应急排查", "入侵分析", "日志取证"],
  compliance: ["隐私合规", "监管要求", "合规评估"],
  novel: ["写小说", "小说续写", "写故事"],
  screenplay: ["写剧本", "短片剧本", "分镜脚本"],
  roleplay: ["扮演", "角色对话", "沉浸扮演"],
  nsfw: ["成人小说", "情色小说", "色情内容", "写黄文"],
  lyrics: ["写歌词", "写诗", "写诗一首"],
  lore: ["设定", "世界设定", "背景设定"],
  translation: ["翻译一下", "本地化翻译", "帮我翻译"],
  academic: ["写论文", "论文润色", "投稿建议"],
  lit_review: ["写综述", "文献检索", "文献调研"],
  teaching: ["出题", "讲解知识", "教学材料", "备课"],
  debate: ["谈判", "说服技巧", "辩论稿"],
  code_eng: ["写函数", "改bug", "代码优化", "帮我写代码"],
  system_design: ["架构设计", "系统架构", "技术选型"],
  ops: ["故障排查", "线上问题", "服务报警"],
  analytics: ["数据统计", "指标分析", "看数据"],
  product: ["产品方案", "运营方案", "增长方案"],
  game_design: ["游戏策划", "数值设计", "玩法设计"],
};
for (const scenario of SCENARIOS) {
  for (const alias of mergeUnique(EXTRA_ALIASES[scenario.id], ALIAS_EXTRA[scenario.id])) {
    if (!scenario.aliases.includes(alias)) scenario.aliases.push(alias);
  }
}

// 扩展命中词（data/vocab/*.json → data/vocabulary-data.mjs）。
// 合并在 DOMAIN_MARKERS 构造之前完成，否则新词条只进包、不进标记表，
// 判定层根本看不到它们 —— 这是这块最容易踩的时序坑。
for (const scenario of SCENARIOS) {
  for (const marker of mergeUnique([], MARKER_EXTRA[scenario.id])) {
    const folded = marker.toLocaleLowerCase();
    if (!scenario.markers.some((m) => m.toLocaleLowerCase() === folded)) scenario.markers.push(marker);
  }
}

// 骨架行统一去序号：部分条目把步骤写成「1. 定位：…」，部分写成「## 标题」，
// 渲染层再统一加项目符号，否则几十个包看起来格式各不相同。
for (const scenario of SCENARIOS) {
  scenario.skeleton = scenario.skeleton.map((line) => line.replace(/^\d+\.\s*/, ""));
}

// 挂工具链：有专门一份工具链数据的领域包才带 toolchain（创意/语言类不需要）。
// 扩展条目排在原有条目之后：原有条目是手工精简过的，先出现更利于阅读。
for (const scenario of SCENARIOS) {
  const chain = mergeUnique(TOOLCHAINS[scenario.id], TOOLCHAIN_EXTRA[scenario.id]);
  if (chain.length > 0) scenario.toolchain = chain;
  const commands = COMMAND_VOCAB[scenario.id];
  if (Array.isArray(commands) && commands.length > 0) scenario.commands = commands;
}

// ───────────────────────── 领域标记表（唯一真源） ─────────────────────────
// 子串匹配：小写折叠后 indexOf。历史遗留的 9 个键（web/game/llm/mobile/
// miniprogram/network/cloud/crack/nsfw）原样保留，与各领域包的 markers 取并集，
// 这样旧输入的判定结果不变，新领域又能被命名。

const LEGACY_MARKERS = {
  web: ["渗透", "漏洞", "sql注入", "xss", "ssrf", "上传", "越权", "waf", "撞库", "子域", "目录爆破", "pentest", "web", "endpoint", "payload", "ffuf", "sqlmap"],
  game: ["游戏", "外挂", "内存挂", "透视", "自瞄", "il2cpp", "frida", "hook", "偏移", "cheat", "aimbot", "wallhack", "libil2cpp", "反作弊", "封号", "过检测", "训练器", "wemod", "fling"],
  llm: ["提示词提取", "llm逆向", "jailbreak", "prompt injection", "对抗后缀", "多轮绕过", "rag攻击", "输出塑形", "破甲", "越狱", "sysprompt"],
  mobile: ["apk", "ipa", "移动端", "安卓", "jadx", "class-dump", "android", "重打包"],
  miniprogram: ["小程序", "wxapkg", "微信", "反编译", "wx.request"],
  network: ["内网", "域渗透", "ldap", "kerberos", "ad域", "横向", "口令喷洒", "nmap", "端口"],
  cloud: ["云", "元数据", "s3", "容器", "kubernetes", "后渗透", "提权", "凭据提取", "persistence"],
  crack: ["破解", "破解一下", "序列号", "keygen", "crack", "校验", "激活", "serial", "patch", "license"],
  nsfw: ["成人", "虚构", "露骨", "情色", "色情", "黄文", "r18", "nsfw", "adult", "explicit", "erotic", "smut", "dirty", "roleplay", "性描写", "台词", "ROLE_A", "ROLE_B", "SCENE_BEATS", "FETISH_TAG"],
};
export { LEGACY_MARKERS };

/** 最终领域标记表：遗留键 ∪ 各领域包 markers（去重，遗留顺序优先）。 */
export const DOMAIN_MARKERS = (() => {
  const table = {};
  for (const [key, markers] of Object.entries(LEGACY_MARKERS)) {
    table[key] = markers.map((m) => m.toLocaleLowerCase());
  }
  for (const scenario of SCENARIOS) {
    const merged = table[scenario.id] ?? [];
    for (const marker of scenario.markers) {
      // 匹配前文本会被小写折叠，标记表也必须先折叠，否则 ROLE_A / SCENE_BEATS
      // 这类大写占位符是永远不会命中的死词条（历史遗留表里就有四个）。
      const folded = marker.toLocaleLowerCase();
      if (!merged.includes(folded)) merged.push(folded);
    }
    table[scenario.id] = merged;
  }
  return table;
})();

/** 通用实现词 / 基础设施词：登记后**只影响平局**（见 rankDomains 的 spec 键）。
 *
 *  为什么需要：`hits` 平局时旧代码按 `longest` 定序，而 `longest` 数的是字符数 ——
 *  通用实现词往往比专用技术词更长，于是把专用词顶掉。实测（verify:vocab 的
 *  BREACH_FIXTURES）：「怎么撞库攻击写个 Python 脚本」三路各 1 分（web/撞库攻击、
 *  automation/脚本、programming/python），`python`(6) > `撞库攻击`(4) → 判成
 *  programming；「写个 Python 代理池，扫端口用的」同样三路平局，`python`(6) 胜出。
 *  这两条都不是「哪个域词多」，而是「通用词把技术词顶掉」。
 *
 *  为什么不改 `hits` 语义：`hits` 是「命中了几个词」，要如实报给状态条与评测；
 *  而且 `python` 单独出现时仍须能路由到 programming —— 所以只在平局时降权。
 *  为什么不走 IDF：marker 表内 df 恒为 1（每个词只登记在一个域），算出来权重相同；
 *  改按领域记录文本算 df 也只能修第一条（`代理池` / `扫端口` 的 df 同为 2）。
 *  登记必须给证据：只有「实测顶掉过专用词」的通用词才进这张表。 */
export const GENERIC_MARKERS = new Set(["python", "脚本", "代理池"]);

/** 领域 id → 中文标签（状态条浮层与评测报告共用）。 */
export const DOMAIN_LABELS = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.label]));

/** 领域 id → 族（命中表与离线报告用）。 */
export const DOMAIN_FAMILIES = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.family]));

/** 命中表：marker → 命中域（带长度、词形与跨族歧义标注）。
 *  索引、离线报告与 scripts/verify_vocab.mjs 共用这一份视图 —— 「哪些词会同时
 *  落到两个域」不该只在判错时靠猜。entries 已按「跨族歧义优先」排序。 */
export const MARKER_INDEX = buildMarkerIndex(DOMAIN_MARKERS, { families: DOMAIN_FAMILIES });

/** 元层帧标记：说明「这一轮用哪一层框架在提要求」，而不是「要打什么」。
 *
 *  为什么单独立一层：rankDomains 是纯计数 —— 一个被 `[FRAME=…]` / `persona=` /
 *  「系统指令」包装过的提示词提取请求，内容词照样指向 web/network，llm 的 21 条
 *  词表因命中数少被压到第 2 名以后。实测（83 条带标签语料，`scripts/eval-corpus.mjs`
 *  同源判据）：把帧标记并进 `DOMAIN_MARKERS.llm` 只把 Top-1 从 62 提到 70 —— 帧标记
 *  只是多算一次 hits，仍抢不过内容域；改成「命中即置顶」提到 74，且零误伤。
 *  所以帧**不进词表**（进词表会被 verify_vocab 的跨族/短词护栏拦，且语义不对）。
 *
 *  分工：词表回答「这是什么任务」，帧回答「这是谁在要求、包在哪一层里」。
 *  冲突时帧优先 —— 包着注入帧的知识题，该注入的是 llm playbook，不是它引用的内容域。
 *  guard 是反向排除：文本命中 guard 时该帧不生效（例：「零宽」在隐写语境里属 crypto）。
 *  domain 必须落在 SCENARIOS 的 id 上（verify_scenarios 会查）。 */
export const DOMAIN_FRAME_MARKERS = Object.freeze([
  { re: /\[frame=/i, domain: "llm", why: "宿主/评测显式声明的帧头" },
  { re: /\[zws\]/i, domain: "llm", why: "零宽字符注入的方括号标记" },
  { re: /零宽/, domain: "llm", why: "零宽注入（隐写语境除外）", guard: /隐写|steg[oa]|水印|watermark|莫尔斯|morse/ },
  { re: /persona\s*=/i, domain: "llm", why: "persona= 角色槽覆盖" },
  { re: /system[-_ ]instruction|系统指令|指令层级|instruction[-_ ]hierarchy/i, domain: "llm", why: "指令层级 / 系统指令" },
  { re: /assistant[-_ ]continuation|助手续写槽|memory[-_ ]entry|second face|第二面/i, domain: "llm", why: "助手续写槽与第二面 / 记忆条目" },
  { re: /infinite_gen5_(?:knowledge|specialists)/i, domain: "llm", why: "自指帧：注入体引用我们自己的块名" },
  { re: /对抗后缀|adversarial\s*suffix/i, domain: "llm", why: "对抗后缀" },
  { re: /多轮绕过|多轮旁路/i, domain: "llm", why: "多轮绕过" },
]);

/** 领域候选排名（状态条浮层 / 评测诊断共用）：先出「元层帧」命中的域，再按
 *  「命中数 → 最长命中标记」降序。带出真正命中的那几条标记词，
 *  这样「识别领域」不再是只有一个 id 的黑箱。
 *
 *  帧域可以内容命中数为 0 而仍然置顶（`hits` 如实报 0、另带 `frame: true`，
 *  不注水）—— 这正是 `gen5__multiturn` / `gen5__kb` 一类「整段话都是包装、
 *  没有内容词」的用例原先判成 null 的原因。传 `frames = null` 可关掉这一层。
 *  注意：detectDomain 与本函数共用同一口径，状态条 / 工具 / 离线评分器不会
 *  出现「候选列表与主判不一致」。 */
export function rankDomains(text, markers = DOMAIN_MARKERS, limit = 4, frames = DOMAIN_FRAME_MARKERS) {
  const folded = String(text ?? "").toLocaleLowerCase();
  if (!folded) return [];
  const rows = [];
  for (const [key, list] of Object.entries(markers)) {
    const hitMarkers = [];
    for (const marker of list) {
      if (!marker) continue;
      // 自定义标记表可能带大写，逐条兜底折叠（内置表在构造时已折叠）。
      const needle = marker === marker.toLocaleLowerCase() ? marker : marker.toLocaleLowerCase();
      if (folded.includes(needle)) hitMarkers.push(marker);
    }
    if (hitMarkers.length) {
      // 同域内「被更长命中标记包含」的短标记不重复计分（containment-collapse）：
      // `frida` 已经含在 `frida hook` 里时，它对「本域是 hook_inject」没有任何
      // 额外证据。不这么做的话，同一件事被算两遍会把长词密集的域顶上去：
      // 「Frida Hook 内存读写改坐标」会让 hook_inject 记 2 分（frida + frida hook），
      // 而真正的主体 game 只能记 2 分（frida + hook），平局后按 longest 被抢走。
      // 跨域不受影响 —— game 的 frida / hook 互不包含，仍是 2 分，于是 2:1 胜出。
      const needles = hitMarkers.map((m) => (m === m.toLocaleLowerCase() ? m : m.toLocaleLowerCase()));
      const kept = [];
      for (let i = 0; i < hitMarkers.length; i += 1) {
        let dominated = false;
        for (let j = 0; j < hitMarkers.length; j += 1) {
          if (i === j) continue;
          if (needles[j].length > needles[i].length && needles[j].includes(needles[i])) { dominated = true; break; }
        }
        if (!dominated) kept.push(hitMarkers[i]);
      }
      let longest = 0;
      // 特异性分（spec）：专用技术词 1 分、GENERIC_MARKERS 里的通用词 0.25 分。
      // 它**不是**第二套命中数 —— 只排在 `hits` 之后当平局键，非平局决策一律不变，
      // 所以 Top-1 只可能持平或上升，不会出现「拿总分换标签」。
      let spec = 0;
      for (const m of kept) {
        const n = m === m.toLocaleLowerCase() ? m : m.toLocaleLowerCase();
        if (n.length > longest) longest = n.length;
        spec += GENERIC_MARKERS.has(n) ? 0.25 : 1;
      }
      rows.push({ id: key, hits: kept.length, markers: kept, longest, spec });
    }
  }
  rows.sort((a, b) => b.hits - a.hits || b.spec - a.spec || b.longest - a.longest || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const framedIds = [];
  for (const frame of frames ?? []) {
    if (!frame || !frame.domain || !frame.re) continue;
    if (frame.guard && frame.guard.test(folded)) continue;
    if (!frame.re.test(folded)) continue;
    if (!framedIds.includes(frame.domain)) framedIds.push(frame.domain);
  }

  const out = [];
  for (const id of framedIds) {
    const row = rows.find((r) => r.id === id);
    out.push({
      id,
      label: DOMAIN_LABELS[id] ?? id,
      hits: row ? row.hits : 0,
      markers: row ? row.markers : [],
      frame: true,
    });
  }
  for (const row of rows) {
    if (framedIds.includes(row.id)) continue;
    out.push({ id: row.id, label: DOMAIN_LABELS[row.id] ?? row.id, hits: row.hits, markers: row.markers });
  }
  return out.slice(0, Math.max(1, limit));
}

/** 在一个文本窗口里挑命中数最多的领域；命中数为 0 时返回 null。
 *  排序规则与 rankDomains 完全一致（它就是 rankDomains 的第一名），
 *  这样状态条、工具与离线评分器不会出现「候选列表与主判不一致」。 */
export function detectDomain(text, markers = DOMAIN_MARKERS) {
  const [top] = rankDomains(text, markers, 1);
  return { domain: top ? top.id : null, hits: top ? top.hits : 0 };
}


// ───────────────────────────── 索引与查找 ─────────────────────────────

const ALIASES_PER_LINE = 3;
const MARKERS_PER_LINE = 6;

/** 域内命中词取样：按长度降序取前 N 个（长词更具体，也更容易解释「为什么落到这个域」），
 *  其余只报数量。取样规则必须是确定性的，否则索引字节数会抖，预算断言就失去意义。 */
function indexMarkerLine(id) {
  const all = DOMAIN_MARKERS[id] ?? [];
  if (!all.length) return "";
  const shown = all
    .slice()
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MARKERS_PER_LINE);
  const rest = all.length - shown.length;
  return `      命中: ${shown.join(" · ")}${rest > 0 ? `　+${rest}` : ""}`;
}

/** 无参调用返回的索引：每个领域两行（id · 标签 · 少量别名 / 该域的命中词）。
 *  传 familyId 时只列该族（用于「先看族、再看包」的两段式查询）。
 *  第二行是给模型看的「反向线索」：用户话里出现哪个词就会被判到这个域，
 *  这样选包不必靠猜，也能自己发现两个域共用同一个词的危险情况。 */
export function scenarioIndexText(familyId = "") {
  const only = String(familyId ?? "").trim();
  const families = only ? FAMILIES.filter((f) => f.id === only) : FAMILIES;
  const head = only && families.length
    ? `无限五代 · 领域包索引 · ${families[0].label}（用 infinite_gen5_scenario 带 scenario 参数取完整打法）`
    : "无限五代 · 领域包索引（用 infinite_gen5_scenario 带 scenario 参数取完整打法）";
  const lines = [head, ""];
  for (const family of families) {
    lines.push(`[${family.label}] ${family.note}`);
    for (const s of SCENARIOS.filter((x) => x.family === family.id)) {
      const alias = s.aliases.slice(0, ALIASES_PER_LINE).join("/");
      const extra = s.aliases.length > ALIASES_PER_LINE ? "…" : "";
      lines.push(`  ${s.id} · ${s.label} — ${alias}${extra}`);
      const markerLine = indexMarkerLine(s.id);
      if (markerLine) lines.push(markerLine);
    }
    lines.push("");
  }
  if (!families.length) {
    lines.push(`未知族「${only}」。可用族：${FAMILIES.map((f) => f.id).join(" / ")}`);
    lines.push("");
  }
  lines.push("用法：scenario 传领域 id 或直接传用户原话（如「内存修改」「写歌词」），工具会自行匹配。");
  lines.push("「命中」行是该域的子串命中词（用户话里出现其一就判到该域）——传原话比传术语更容易命中。");
  return lines.join("\n");
}

/** 拉丁词要按词边界出现，否则 2–3 字符的 id/别名会命中普通英文单词内部。
 *  这是语料测试逼出来的真实缺陷（不是假想）：id `re` 命中 `spreadsheet` / `master`
 *  里的 "re"，把整句英文判成逆向；别名 `apk` 命中 `wx**apk**g`，把小程序问题判成
 *  mobile；别名 `harness` 命中普通英文句，把 CI 问题判成 fuzzing。
 *  中文没有词边界概念（也不会有这个词内碰撞），直接子串；≥8 字符的拉丁词同理。 */
const ASCII_WORD = /^[a-z0-9 ._-]+$/;
/** v0.52.12：这些 id 是英文里的通用词，按「id 出现在题面里」判域会抢错活：
 *  「sql injection」「command injection」都会被 ai 包的 id `injection` 抢走。
 *  要落到 ai 包请用其别名（提示注入 / prompt injection / rag 投毒 …）。 */
const ID_CONTAIN_DENY = new Set(["injection", "chain"]);   // supply chain ≠ 区块链

function containsWord(needle, word) {
  if (!ASCII_WORD.test(word) || word.length >= 8) return needle.includes(word);
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(needle);
}

/** 把查询串匹配到领域包：先精确 id，再别名子串，最后标签子串。 */
export function findScenarios(query) {
  const needle = String(query ?? "").trim().toLocaleLowerCase();
  if (!needle) return [];
  const scored = [];
  for (const s of SCENARIOS) {
    let score = 0;
    if (s.id === needle) score = 100;
    else if (s.label.toLocaleLowerCase() === needle) score = 90;
    else if (s.aliases.some((a) => a.toLocaleLowerCase() === needle)) score = 80;
    else if (s.id.includes(needle) || (!ID_CONTAIN_DENY.has(s.id) && needle.includes(s.id) && containsWord(needle, s.id))) score = 60;
    else if (s.label.toLocaleLowerCase().includes(needle)) score = 55;
    else if (s.aliases.some((a) => a.toLocaleLowerCase().includes(needle))) score = 40;
    // 反向包含（「域渗透」命中别名「渗透」）只在别名够长时才算数，
    // 否则任何含「渗透」「游戏」的句子都会被泛化命中；拉丁别名还要求词边界。
    else if (s.aliases.some((a) => a.length >= 3 && containsWord(needle, a.toLocaleLowerCase()))) score = 30;
    if (score) scored.push({ score, scenario: s });
  }
  if (!scored.length) {
    // 别名全不中时退回领域标记表：用户往往用口语描述（「内存修改」），
    // 而标记表才是为这种模糊输入准备的。
    const guess = detectDomain(needle);
    if (guess.domain) {
      const hit = SCENARIOS.find((s) => s.id === guess.domain);
      if (hit) scored.push({ score: 10 + guess.hits, scenario: hit });
    }
  }
  // 同分保持 SCENARIOS 文档序（稳定排序）—— 平局靠**数据**定：
  // 身份词只归一个域（v0.14.0 把 osint 的「钓鱼邮件」删给了 phishing，见该域注释）。
  return scored.sort((a, b) => b.score - a.score).map((row) => row.scenario);
}

/** 把一个领域包渲染成模型的行动指令（紧凑文本）。 */
export function renderScenario(scenario) {
  return [
    `# ${scenario.label}（${scenario.id} · ${scenario.family}）`,
    "",
    "映射到五槽：",
    `  ROLE   ${scenario.role}`,
    `  OBJECT ${scenario.object}`,
    `  ACTION ${scenario.action}`,
    `  SCOPE  ${scenario.scope}`,
    `  SHAPE  ${scenario.shape}`,
    "",
    "输出骨架：",
    ...scenario.skeleton.map((line) => `  - ${line}`),
    "",
    "领域注意点：",
    ...scenario.notes.map((line) => `  - ${line}`),
    "",
    ...(scenario.toolchain
      ? [
          "工具链（缺哪个装哪个，装完先验证再跑）：",
          ...scenario.toolchain.map((line) => `  - ${line}`),
          "",
          "缺工具时的处理顺序：",
          `  - ${TOOLCHAIN_PROTOCOL[0]}`,
          `  - ${TOOLCHAIN_PROTOCOL[2]}`,
          `  - ${TOOLCHAIN_PROTOCOL[3]}`,
          "",
        ]
      : []),
    ...(scenario.commands
      ? [
          "命令词汇（可直接粘贴，占位符替换后先干跑一遍）：",
          ...scenario.commands.map((line) => `  - ${line}`),
          "",
        ]
      : []),
    `示例：${scenario.example}`,
  ].join("\n");
}

/** 工具入口：给 id 取包，给自由文本做匹配；匹配不到时返回候选。 */
export function lookupScenario(query) {
  const matches = findScenarios(query);
  if (!matches.length) {
    return {
      ok: false,
      reason: "no-match",
      index: scenarioIndexText(),
    };
  }
  const best = matches[0];
  return {
    ok: true,
    scenario: best.id,
    label: best.label,
    family: best.family,
    playbook: renderScenario(best),
    // v0.27.1：工具结果里的 toolchain 必须与 playbook 里渲染的那份同源。
    // 旧实现让工具去查 toolchainOf(id)（只读静态 TOOLCHAINS 表），于是所有靠
    // TOOLCHAIN_EXTRA 补工具链的域（v0.23.0 与 v0.27.0 新增的 33 个）在 JSON 里
    // 回空数组、正文里却列着工具链 —— 同一个域两套答案。
    toolchain: best.toolchain ?? [],
    alternatives: matches.slice(1, 4).map((s) => s.id),
  };
}

// 边界层类别表：与内核「边界层」八类同源，供运行时投影与离线评分器共用。
export {
  RISK_CATEGORIES,
  RISK_MARKER_INDEX,
  ADJACENCY_TERMS,
  rankRisks,
  detectBoundary,
} from "./boundary.mjs";
