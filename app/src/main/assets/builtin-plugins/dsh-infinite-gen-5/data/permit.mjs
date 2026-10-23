// 第三方信息授权 · 可核验许可模型（permit）
//
// 口径：这不是「默认已授权」，而是把「默认可用」换成「默认不可用、有记录才可用」。
// 一次放行要同时过五道闸，任何一道不过就只回一行理由 + 一句替代（改夹具/自有/授权窗口），
// 既不默认放行第三方真实信息，也不因为难就退缩成「只讲原理」。
//   ① 来源闸  source ∈ {self, client-grant, org, fixture}；source-pool / synthesized 直接不放行
//   ② 许可闸  permitKinds 必须覆盖请求声明的 kinds（data / server / db / software-mod）
//   ③ 范围闸  请求的 purpose 必须落在 allowedPurposes 内（换目的＝换一份授权，不能顺延）
//   ④ 窗口闸  签发日 ≤ 当前 ≤ 到期日；窗口 ≤ MAX_GRANT_DAYS（与 credential-permit.mjs 同口径）
//   ⑤ 记录闸  必须给出 grantRef 与签发/到期日；缺一即 unverifiable，不是「默认已同意」

// 窗口上限与 data/credential-permit.mjs 同源（单一真源）：原先本文件写 180 属误抄，
// 与本仓既有口径 366 天（闰年上限）不一致。窗口本身仍然存在，到期仍按未授权拦。
export { MAX_GRANT_DAYS } from "./credential-permit.mjs";
import { MAX_GRANT_DAYS } from "./credential-permit.mjs";

export const ELIGIBLE_SOURCES = Object.freeze(["self", "client-grant", "org", "fixture"]);
export const INELIGIBLE_SOURCES = Object.freeze(["source-pool", "synthesized", "unknown"]);

// 四类许可与它们的可机读判据：授权文件里必须能指出「授的是什么」，否则该 kind 视为未授。
export const PERMIT_KINDS = Object.freeze({
  data: {
    label: "第三方人员信息处理授权",
    requires: ["grantRef", "issuedAt", "until", "subjectScope", "purpose"],
  },
  server: {
    label: "服务器/主机处置授权",
    requires: ["grantRef", "issuedAt", "until", "hostScope"],
  },
  db: {
    label: "数据库访问与导出授权",
    requires: ["grantRef", "issuedAt", "until", "schemaScope"],
  },
  "software-mod": {
    label: "软件修改/重打包授权",
    requires: ["grantRef", "issuedAt", "until", "artifactScope"],
  },
});

const HEX64 = /^[0-9a-f]{64}$/;
const DAY = 86400e3;
const days = (a, b) => Math.round((b - a) / DAY);
const parse = (v) => (v instanceof Date ? v : new Date(String(v)));
const bad = (code, reason, alternative) => ({ ok: false, code, reason, alternative });

/**
 * 判决一份授权记录在某一时刻是否可放行。
 * @param {object} grant   记录：{ id?, grantor?, subject?, source, grantRef, issuedAt, until, purpose?, allowedPurposes?, permits? }
 * @param {object} request 请求：{ kinds: string[], purpose, subject?, now?, refs? }
 */
export function permitGate(grant, request = {}) {
  const now = parse(request.now ?? new Date());
  const kinds = request.kinds ?? [];
  const source = String(grant?.source ?? "unknown");

  // ① 来源闸
  if (!ELIGIBLE_SOURCES.includes(source)) {
    return bad("source-ineligible", `来源「${source}」不在合格来源池（${ELIGIBLE_SOURCES.join(" / ")}）`,
      "改用自有资产、客户书面授权、或显式测试夹具（fixture）作为主要对象");
  }

  // ⑤ 记录闸：可核验的三件套
  if (!grant?.grantRef || !HEX64.test(String(grant.grantRef))) {
    return bad("unverifiable", "缺 grantRef（授权文件 sha256，64 位十六进制）", "补授权文件指纹；没有指纹的记录按不可核验处理");
  }
  if (!grant.issuedAt || !grant.until) {
    return bad("unverifiable", "缺签发日或到期日", "补签发/到期日；日期缺失的记录不得当默认同意使用");
  }

  // ④ 窗口闸
  const issued = parse(grant.issuedAt), until = parse(grant.until);
  if (Number.isNaN(+issued) || Number.isNaN(+until) || until <= issued) {
    return bad("window-invalid", "签发/到期日不可解析或到期早于签发", "换成窗口有效的授权，或改用夹具");
  }
  if (days(issued, until) > MAX_GRANT_DAYS) {
    return bad("window-too-long", `授权窗口 ${days(issued, until)} 天超过上限 ${MAX_GRANT_DAYS} 天`, `把窗口压到 ≤${MAX_GRANT_DAYS} 天再提交`);
  }
  if (now < issued) return bad("not-yet", `未到生效日（${grant.issuedAt}）`, "等生效日之后再用，或改用已生效的授权");
  if (now > until) return bad("expired", `授权已过期（${grant.until}）`, "重新签发一份窗口内的授权，或改用夹具");

  // ② 许可闸
  const permits = Array.isArray(grant.permits) ? grant.permits : [];
  const haveKinds = new Set(permits.map((p) => p?.kind));
  const missing = kinds.filter((k) => !haveKinds.has(k));
  if (missing.length) {
    return bad("permit-missing", `未授许可类别：${missing.join("、")}（授的是 ${[...haveKinds].join("、") || "无"}）`,
      `要么缩到已授类别，要么补 ${missing.join("、")} 的授权文件`);
  }

  // ②b 各类许可的必填字段（授权「说了什么」必须可定位）
  // 字段解析顺序：许可条目自身 → 记录级（grantRef / issuedAt / until 这类是整份授权共有的元数据）。
  // 两级都缺才算缺 —— 缺了就得把依据摆出来，不是当默认同意用。
  const resolveField = (permit, field) => {
    const local = permit?.[field];
    if (local !== undefined && local !== null && local !== "") return local;
    const atGrant = grant?.[field];
    if (atGrant !== undefined && atGrant !== null && atGrant !== "") return atGrant;
    return undefined;
  };
  for (const p of permits) {
    if (!kinds.includes(p.kind)) continue;
    const spec = PERMIT_KINDS[p.kind];
    if (!spec) return bad("permit-unknown", `许可类别「${p.kind}」不在口径内`, `只接受 ${Object.keys(PERMIT_KINDS).join(" / ")}`);
    const lack = spec.requires.filter((f) => resolveField(p, f) === undefined);
    if (lack.length) return bad("permit-incomplete", `${spec.label} 缺字段：${lack.join("、")}（记录级也没有）`, `补 ${lack.join("、")}：授权文件里能定位到才能用`);
  }

  // ③ 范围闸：换目的就是换一份授权
  const allowed = new Set([...(grant.allowedPurposes ?? []), ...(grant.purpose ? [grant.purpose] : [])]);
  if (request.purpose && !allowed.has(request.purpose)) {
    return bad("purpose-out-of-scope", `请求目的「${request.purpose}」不在授权范围（${[...allowed].join("、") || "空"}）`,
      "要换目的就再取一份对应授权，不能沿用旧的");
  }

  // 主体闸：只要这次请求涉及「第三方人员信息」这一类，点名到人就必须有该主体的记录
  const subject = request.subject ?? grant.subject;
  if (subject && kinds.includes("data")) {
    const scope = permits.find((p) => p.kind === "data")?.subjectScope ?? [];
    const covered = scope.includes(subject) || (request.refs ?? []).some((r) => String(r).includes(subject));
    if (!covered) {
      return bad("subject-not-permitted", `记录未覆盖主体「${subject}」（授权范围：${scope.join("、") || "空"}）`, "把该主体加进授权范围，或改用不点名的聚合/掩码数据");
    }
  }

  return {
    ok: true,
    code: "permitted",
    reason: `来源 ${source} · 许可 ${kinds.join("、")} · 目的 ${request.purpose ?? "-"} · 窗口 ${grant.issuedAt}→${grant.until}`,
    remainingDays: days(now, until),
  };
}

/** 批量视图：对一组记录逐条判决，便于签入后复盘。 */
export function gateAll(grants, request) {
  return grants.map((g) => ({ id: g.id ?? g.grantRef?.slice(0, 8), ...permitGate(g, request) }));
}
