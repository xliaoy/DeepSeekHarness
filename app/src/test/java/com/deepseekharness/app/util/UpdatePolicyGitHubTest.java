package com.deepseekharness.app.util;

import org.junit.Test;

import java.util.Arrays;

import static org.junit.Assert.*;

/**
 * GitHub Releases 链路的版本换算与选版。
 *
 * <p>与 {@link UpdatePolicyTest} 分开：那条链路用自建清单的小整数 {@code versionCode}，
 * 本链路只能从 tag 推日期数值。两者基准不同，必须分别锁定，否则未来有人
 * "顺手统一"就会把其中一条悄悄改坏。
 */
public class UpdatePolicyGitHubTest {

    private static UpdatePolicy.Release release(int code, String version, String channel, String flavor) {
        return new UpdatePolicy.Release(code, version, channel, flavor, 23, "arm64-v8a",
                "https://example.invalid/app.apk", "a".repeat(64), 1024, "", "https://example.invalid/r");
    }

    // ── 换算：tag → 可比整数 ──────────────────────────────────────────────
    @Test public void parsesDateTags() {
        assertEquals(20260922, UpdatePolicy.versionCodeFromTag("v2026.09.22"));
        assertEquals(20260918, UpdatePolicy.versionCodeFromTag("v2026.09.18"));
        assertEquals(20260916, UpdatePolicy.versionCodeFromTag("v2026.09.16"));
        // 不带 v 前缀也应接受
        assertEquals(20260922, UpdatePolicy.versionCodeFromTag("2026.09.22"));
    }

    @Test public void parsesLegacySemverTagsAndKeepsThemBelowDateTags() {
        assertEquals(10009, UpdatePolicy.versionCodeFromTag("v1.0.9"));
        assertEquals(107, UpdatePolicy.versionCodeFromTag("v0.1.7-rc.1"));
        // 两套体系数值不重叠 ⇒ 即使混进同一列表，排序仍然稳定
        assertTrue(UpdatePolicy.versionCodeFromTag("v0.1.7-rc.1")
                < UpdatePolicy.versionCodeFromTag("v2026.09.16"));
    }

    /** 0 表示"不可解析"，调用方必须跳过；不能把它当成很旧的版本。 */
    @Test public void unparseableTagsReturnZero() {
        assertEquals(0, UpdatePolicy.versionCodeFromTag("garbage"));
        assertEquals(0, UpdatePolicy.versionCodeFromTag(""));
        assertEquals(0, UpdatePolicy.versionCodeFromTag(null));
        assertEquals(0, UpdatePolicy.versionCodeFromTag("v"));
    }

    /** 月份/日期越界必须作废，否则 2026.13.40 会伪装成一个更大的"新版本"。 */
    @Test public void rejectsOutOfRangeDateComponents() {
        assertEquals(0, UpdatePolicy.versionCodeFromTag("v2026.13.01"));
        assertEquals(0, UpdatePolicy.versionCodeFromTag("v2026.00.10"));
        assertEquals(0, UpdatePolicy.versionCodeFromTag("v2026.09.00"));
    }

    // ── 换算：本机 versionName → 同一体系 ─────────────────────────────────
    @Test public void comparableCodeHandlesBothLocalVersionNameForms() {
        assertEquals(20260925, UpdatePolicy.comparableCode("20260925"));
        // 低版本变体由 versionNameSuffix 拼成，【没有连字符】——剥不掉就会静默收不到更新
        assertEquals(20260925, UpdatePolicy.comparableCode("20260925low"));
        assertEquals(UpdatePolicy.comparableCode("20260925"), UpdatePolicy.comparableCode("20260925low"));
        // 历史形态
        assertEquals(10009, UpdatePolicy.comparableCode("1.0.9"));
        assertEquals(20260925, UpdatePolicy.comparableCode("2026.09.25"));
        assertEquals(0, UpdatePolicy.comparableCode("garbage"));
    }

    @Test public void localSemverMatchesItsTagCounterpart() {
        assertEquals(UpdatePolicy.versionCodeFromTag("v1.0.9"), UpdatePolicy.comparableCode("1.0.9"));
    }

    // ── 选版 ─────────────────────────────────────────────────────────────
    /**
     * 真实场景是【日期 tag 比日期 versionName】：{@code v2026.09.22} → 20260922，
     * 本机 {@code 20260925} → 20260925 ⇒ 20260922 ≤ 20260925 ⇒ 不报更新，正确。
     *
     * <p>⚠️ semver tag 与日期基准【不可混比】：{@code v0.1.7-rc.1} → 107，
     * 而任何日期基准都远大于 107，因此它会被判为"过旧"而跳过。失败方向是【漏更新】
     * 而非误更新，属安全侧；但正因如此，本测试【不】声称 semver tag 能被选出。
     * 实际 FEED 只读 xliaoy/DeepSeekHarness，其 tag 全为日期体系，故不构成问题。
     */
    @Test public void comparesDateTagsAgainstDateVersionName() {
        int now = UpdatePolicy.comparableCode("20260925");
        UpdatePolicy.Release older = release(20260922, "2026.09.22", UpdatePolicy.STABLE, "standard");
        UpdatePolicy.Release newer = release(20261001, "2026.10.01", UpdatePolicy.STABLE, "standard");
        assertNull("已发布且早于本机的版本不应报更新",
                UpdatePolicy.selectFromReleases(Arrays.asList(older), now, "standard", 34, UpdatePolicy.STABLE));
        assertEquals(newer,
                UpdatePolicy.selectFromReleases(Arrays.asList(older, newer), now, "standard", 34, UpdatePolicy.STABLE));
    }

    /**
     * 若拿小整数 VERSION_CODE(145) 当基准，日期 tag(20260922) 会【恒大于】它，
     * 于是每次检查都"发现新版本"，包括当前版本自己 —— 正是"诱导反复下载同一 APK"。
     * 这条用【反向断言】锁住：一旦有人把基准改回 VERSION_CODE，本测试立刻变红。
     */
    @Test public void versionCodeBasisWouldAlwaysLookNewerAndMustStayRejected() {
        UpdatePolicy.Release same = release(20260925, "2026.09.25", UpdatePolicy.STABLE, "standard");
        assertNull("正确的基准（versionName 换算）：同版本不报更新",
                UpdatePolicy.selectFromReleases(Arrays.asList(same),
                        UpdatePolicy.comparableCode("20260925"), "standard", 34, UpdatePolicy.STABLE));
        assertEquals("错误的基准（VERSION_CODE）会误报 —— 这就是必须用 versionName 的原因", same,
                UpdatePolicy.selectFromReleases(Arrays.asList(same), 145, "standard", 34, UpdatePolicy.STABLE));
    }

    /** 当前已是最新时不得报更新，否则会诱导用户反复下载同一个 APK。 */
    @Test public void doesNotOfferTheVersionAlreadyInstalled() {
        UpdatePolicy.Release same = release(20260925, "2026.09.25", UpdatePolicy.STABLE, "standard");
        UpdatePolicy.Release older = release(20260922, "2026.09.22", UpdatePolicy.STABLE, "standard");
        int now = UpdatePolicy.comparableCode("20260925");
        assertNull(UpdatePolicy.selectFromReleases(Arrays.asList(same), now, "standard", 34, UpdatePolicy.STABLE));
        assertNull(UpdatePolicy.selectFromReleases(Arrays.asList(older), now, "standard", 34, UpdatePolicy.STABLE));
    }

    /** 不可解析的 tag 不得压过合法候选，也不得被选中。 */
    @Test public void skipsUnparseableTagsInsteadOfTreatingThemAsOld() {
        UpdatePolicy.Release broken = release(0, "garbage", UpdatePolicy.STABLE, "standard");
        int now = UpdatePolicy.comparableCode("20260925");
        assertNull(UpdatePolicy.selectFromReleases(Arrays.asList(broken), now, "standard", 34, UpdatePolicy.STABLE));
        // 同列表里还有合法候选时，必须选出合法的那个
        UpdatePolicy.Release good = release(20261001, "2026.10.01", UpdatePolicy.STABLE, "standard");
        assertEquals(good, UpdatePolicy.selectFromReleases(Arrays.asList(broken, good), now, "standard", 34, UpdatePolicy.STABLE));
    }

    @Test public void picksHighestAndRespectsFlavorSdkAndChannel() {
        int now = UpdatePolicy.comparableCode("20260925");
        UpdatePolicy.Release low = release(20261001, "2026.10.01", UpdatePolicy.STABLE, "low");
        UpdatePolicy.Release std = release(20261001, "2026.10.01", UpdatePolicy.STABLE, "standard");
        UpdatePolicy.Release newer = release(20261101, "2026.11.01", UpdatePolicy.STABLE, "standard");
        UpdatePolicy.Release preview = release(20261201, "2026.12.01", UpdatePolicy.PREVIEW, "standard");
        assertEquals(newer, UpdatePolicy.selectFromReleases(Arrays.asList(low, std, newer), now, "standard", 34, UpdatePolicy.STABLE));
        // 稳定通道不得收到预览包
        assertEquals(newer, UpdatePolicy.selectFromReleases(Arrays.asList(newer, preview), now, "standard", 34, UpdatePolicy.STABLE));
        assertEquals(preview, UpdatePolicy.selectFromReleases(Arrays.asList(newer, preview), now, "standard", 34, UpdatePolicy.PREVIEW));
        // flavor 不匹配则不选
        assertEquals(low, UpdatePolicy.selectFromReleases(Arrays.asList(low, std), now, "low", 34, UpdatePolicy.STABLE));
    }
}
