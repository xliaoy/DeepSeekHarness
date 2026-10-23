// data/identity-routes.mjs — 身份许可的路由表（v0.55.0）
//
// 口径：身份不是「凭据门」，而是**默认点亮哪些域包**。
//   · 命中身份词时：该身份的 packs 顺序参与候选排序（排到前面），**不屏蔽**其它域包；
//   · 未命中身份词时：完全按原有别名 / markers / id 路由，行为与 v0.54.0 一致；
//   · 一个请求可同时命中多个身份（如「众测 + 甲方 AppSec」）：按 IDENTITY_ROUTES 顺序取第一个命中项
//     作为「主身份」，其余记入 alsoMatched，交付时按主身份的域包顺序展开。
//   · packs 里的 id **必须**是 data/scenarios.mjs 里真实存在的域包 id —— verify:identity-routes 交叉校验。

export const IDENTITY_ROUTES = [
  {
    id: "pentest",
    label: "渗透测试工程师",
    aliases: ["渗透测试工程师", "渗透工程师", "渗透测试", "授权测试工程师", "pentest", "pentester", "攻击测试员"],
    packs: ["web", "recon", "exploit_dev", "privesc", "network", "database", "network_device", "cloud", "container", "wireless"],
  },
  {
    id: "redteam",
    label: "红队队员",
    aliases: ["红队", "红队队员", "red team", "redteam", "adversary emulation", "对抗演练"],
    packs: ["phishing", "rat_c2", "evasion", "hook_inject", "obfuscation", "unpack", "exploit_dev", "privesc", "windows_ad", "recon"],
  },
  {
    id: "appsec",
    label: "甲方应用安全 / 安全研发（AppSec）",
    aliases: ["appsec", "应用安全", "代码审计", "安全研发", "sdl", "代码扫描", "甲方安全研发"],
    packs: ["code_eng", "supply_chain", "obfuscation", "unpack", "qa_test", "web", "mobile", "db_design"],
  },
  {
    id: "ir",
    label: "应急响应 / SOC 分析师",
    aliases: ["应急响应", "soc", "事件处置", "入侵排查", "蓝队分析师", "incident response"],
    packs: ["forensics", "malware", "rat_c2", "windows_ad", "network", "database", "ops"],
  },
  {
    id: "blue-detect",
    label: "蓝队检测工程师",
    aliases: ["蓝队", "检测工程师", "检测规则", "sigma", "规则运营", "防守方"],
    packs: ["evasion", "dos", "network", "forensics", "ops", "data_pipeline"],
  },
  {
    id: "cloud",
    label: "云安全 / 云平台工程师",
    aliases: ["云安全", "云平台", "k8s 安全", "容器安全", "云原生", "cloud security"],
    packs: ["cloud", "container", "virtualization", "network", "devops_cicd", "ops"],
  },
  {
    id: "mobile-re",
    label: "移动端逆向评估员",
    aliases: ["移动端逆向", "安卓逆向", "ios 逆向", "apk 分析", "加固分析", "移动评估"],
    packs: ["mobile", "unpack", "obfuscation", "hook_inject", "evasion", "mobile_dev"],
  },
  {
    id: "ics-auto",
    label: "工控 / 车联网 / IoT 评估员",
    aliases: ["工控", "ics", "车联网", "汽车安全", "iot 安全", "固件分析", "射频评估"],
    packs: ["ics", "automotive", "firmware", "rf", "wireless", "network_device", "embedded_dev"],
  },
  {
    id: "crypto-audit",
    label: "密码与协议审计员 / 密评工程师",
    aliases: ["商用密码应用安全性评估", "密码审计", "密评", "协议审计", "密码学评估", "商密", "crypto audit", "密码工程师"],
    packs: ["protocol_re", "crypto_impl", "pki", "keymgmt", "sidechannel", "post_quantum", "wallet", "chain", "stego"],
  },
  {
    id: "bugbounty",
    label: "众测（bug bounty）参与者",
    aliases: ["众测", "漏洞赏金", "bug bounty", "hackerone", "src 平台", "漏洞平台"],
    packs: ["web", "recon", "miniprogram", "mobile", "osint", "network_device", "database"],
  },
  {
    id: "osint",
    label: "OSINT 调查员",
    aliases: ["osint", "公开源情报", "情报调查", "开源情报", "背景调查"],
    packs: ["osint", "deanon", "geospatial", "graph_data", "scraping"],
  },
  {
    id: "ai-redteam",
    label: "模型安全 / AI 红队",
    aliases: ["ai 红队", "模型红队", "大模型安全", "提示注入评估", "ai red team", "模型评估"],
    packs: ["ai_redteam", "injection", "jailbreak", "llm", "adversarial_suffix", "output_shaping", "rag_poison", "agent", "model_internals"],
  },
  {
    id: "forensics-legal",
    label: "电子数据取证 / 司法鉴定",
    aliases: ["司法鉴定", "电子取证", "取证鉴定", "证据固定", "取证分析"],
    packs: ["forensics", "malware", "deanon", "decrypt", "drm", "macos", "windows_ad", "mobile"],
  },
  {
    id: "compliance-audit",
    label: "等保测评 / 合规审计",
    aliases: ["等保", "等级保护", "测评师", "合规审计", "内审", "is审计"],
    packs: ["compliance", "network", "privacy_tech", "db_design", "ops", "data_pipeline"],
  },
  {
    id: "vuln-dev",
    label: "漏洞研究 / CVE 提报者",
    aliases: ["漏洞研究", "cve", "漏洞挖掘", "fuzzing 研究员", "公开漏洞研究", "0day 研究"],
    packs: ["re", "exploit_dev", "fuzzing", "unpack", "kernel", "stego", "protocol_re"],
  },
  {
    id: "nsfw-artist",
    label: "成人向画师 / 成人插画师",
    aliases: ["黄色画师", "黄图画师", "成人画师", "成人插画", "成人插画师", "r18画师", "エロ画师", "本子画师", "同人画师", "成人向画稿"],
    packs: ["nsfw", "comic", "lore", "interactive_fiction"],
  },
  {
    id: "erotica-writer",
    label: "成人小说 / 情色文学作者",
    aliases: ["成人小说作者", "黄文写手", "情色文学", "情色作者", "erotica", "成人文学", "エロ小说", "h文"],
    packs: ["nsfw", "novel", "roleplay", "interactive_fiction", "screenplay"],
  },
  {
    id: "adult-comic",
    label: "成人漫画 / 同人志作者",
    aliases: ["成人漫画", "成人漫画家", "r18漫画", "同人志", "本子作者", "成人条漫", "エロ漫画"],
    packs: ["nsfw", "comic", "screenplay", "lore", "interactive_fiction"],
  },
  {
    id: "ctf",
    label: "CTF 战队 / 安全实验室研究员",
    aliases: ["ctf", "战队", "安全实验室", "研究生课题", "竞赛"],
    packs: ["exploit_dev", "privesc", "stego", "protocol_re", "re", "crypto_impl", "kernel"],
  },
];

// 身份匹配：只做「词面命中」，不做语义推断；命中多个时按表顺序取主身份。
export function matchIdentity(text) {
  const s = String(text ?? "").toLowerCase();
  if (!s) return null;
  const matched = [];
  for (const route of IDENTITY_ROUTES) {
    let best = "";
    for (const alias of route.aliases) {
      const key = alias.toLowerCase();
      if (s.includes(key) && key.length > best.length) best = key;
    }
    if (best) matched.push({ route, best });
  }
  if (!matched.length) return null;
  // 主身份：命中别名最长者（更具体者胜），同长按表顺序 —— 例如「商用密码应用安全性评估」
  // 会盖过 AppSec 的「应用安全」，因为它更长、更具体。
  const sorted = matched.slice().sort((a, b) => (b.best.length - a.best.length) || 0);
  const primary = sorted[0].route;
  return { primary, alsoMatched: matched.map((m) => m.route.id).filter((id) => id !== primary.id) };
}

// 候选排序：主身份的域包排到前面（稳定排序，未命中的保持原序）。
export function prioritiseByIdentity(hits, identity) {
  const list = Array.isArray(hits) ? hits.slice() : [];
  if (!identity || !identity.primary) return list;
  const order = identity.primary.packs;
  const rank = (hit) => {
    const idx = order.indexOf(hit && hit.id);
    return idx === -1 ? order.length + 1 : idx;
  };
  return list
    .map((hit, i) => ({ hit, i, r: rank(hit) }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))
    .map((x) => x.hit);
}
