// 无限五代 · 命中词汇扩展数据 · barrel（生成物，不要手改）
//
// 改词条 → 改 data/vocab/*.json → 跑 `npm run vocab:build` 重新生成。
// 规则与护栏在 data/vocabulary.mjs；合并进领域包的动作在 data/scenarios.mjs 里完成。
//
// 源文件：A-offense-core.json · B-reverse-malware.json · C-network-cloud.json · D-eng-crypto-data-ai.json · E-curated-fixes.json · F-v0140-newdomains.json · G-v0140-backfill.json · H-v0240-newdomains.json · I-v0260-newdomains.json · J-v0260-thicken.json · K-v0270-newdomains.json

export const VOCAB_SOURCES = ["A-offense-core.json","B-reverse-malware.json","C-network-cloud.json","D-eng-crypto-data-ai.json","E-curated-fixes.json","F-v0140-newdomains.json","G-v0140-backfill.json","H-v0240-newdomains.json","I-v0260-newdomains.json","J-v0260-thicken.json","K-v0270-newdomains.json"];

import { COMMAND_VOCAB_P1 } from "./vocab/generated/command-vocab.part-01.mjs";
import { COMMAND_VOCAB_P2 } from "./vocab/generated/command-vocab.part-02.mjs";
import { MARKER_EXTRA_P1 } from "./vocab/generated/marker-extra.part-01.mjs";
import { MARKER_EXTRA_P2 } from "./vocab/generated/marker-extra.part-02.mjs";
import { ALIAS_EXTRA_P1 } from "./vocab/generated/alias-extra.part-01.mjs";
import { ALIAS_EXTRA_P2 } from "./vocab/generated/alias-extra.part-02.mjs";
export const ALIAS_EXTRA = Object.assign({}, ALIAS_EXTRA_P1, ALIAS_EXTRA_P2);
export const MARKER_EXTRA = Object.assign({}, MARKER_EXTRA_P1, MARKER_EXTRA_P2);
export const COMMAND_VOCAB = Object.assign({}, COMMAND_VOCAB_P1, COMMAND_VOCAB_P2);
export { TOOLCHAIN_EXTRA } from "./vocab/generated/toolchain-extra.mjs";
