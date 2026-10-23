/** Host-side scenario query service. Pure response shaping; callers inject hit accounting. */
import {
  FAMILIES,
  SCENARIOS,
  TOOLCHAIN_PROTOCOL,
  lookupScenario,
  scenarioIndexText,
  toolchainOf,
} from "./scenarios.mjs";

export const queryScenario = (args = {}, { onMiss = () => {}, onHit = () => {} } = {}) => {
  const input = args && typeof args === "object" ? args : {};
  const query = typeof input.scenario === "string" ? input.scenario.trim() : "";
  const family = typeof input.family === "string" ? input.family.trim() : "";
  if (!query) {
    return {
      ok: true,
      domains: SCENARIOS.length,
      families: FAMILIES.map((item) => ({
        id: item.id,
        label: item.label,
        count: SCENARIOS.filter((scenario) => scenario.family === item.id).length,
      })),
      index: scenarioIndexText(family),
      toolProtocol: TOOLCHAIN_PROTOCOL,
      hint: "带 scenario 参数取某个领域的完整打法：五槽映射 + 输出骨架 + 领域注意点 + 工具链（装/验命令）。id、别名或用户原话都可以。",
    };
  }
  const found = lookupScenario(query);
  if (!found.ok) {
    onMiss({ query });
    return {
      ok: false,
      query,
      reason: "no-match",
      message: "没有匹配到领域包。挑一个 id 重试，或直接按五槽骨架自行展开。",
      index: scenarioIndexText(),
      toolProtocol: TOOLCHAIN_PROTOCOL,
    };
  }
  onHit(found.scenario);
  return {
    ok: true,
    query,
    scenario: found.scenario,
    label: found.label,
    family: found.family,
    playbook: found.playbook,
    toolchain: found.toolchain ?? toolchainOf(found.scenario),
    toolProtocol: TOOLCHAIN_PROTOCOL,
    alternatives: found.alternatives,
    hint: "把 ROLE/OBJECT/ACTION/SCOPE/SHAPE 与输出骨架落实到本次交付物里，只保留与任务相关的行；需要工具而本地没有时，按工具链一节装完先验证再跑，把版本与降级点写进正文。",
  };
};
