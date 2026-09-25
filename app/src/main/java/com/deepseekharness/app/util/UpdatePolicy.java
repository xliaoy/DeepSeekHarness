package com.deepseekharness.app.util;

import java.net.URI;
import java.util.List;

/** 更新选择只看版本码、通道和安装变体，不从 rc/low 文件名猜版本先后。 */
public final class UpdatePolicy {
    public static final String STABLE = "stable", PREVIEW = "preview";
    private UpdatePolicy() { }

    public static final class Release {
        public final int versionCode, minSdk;
        public final String version, channel, flavor, abi, url, sha256, notes, pageUrl;
        public final long bytes;
        public Release(int code, String version, String channel, String flavor, int minSdk,
                       String abi, String url, String sha256, long bytes, String notes, String pageUrl) {
            this.versionCode = code; this.version = version; this.channel = channel;
            this.flavor = flavor; this.minSdk = minSdk; this.abi = abi; this.url = url;
            this.sha256 = sha256; this.bytes = bytes; this.notes = notes; this.pageUrl = pageUrl;
        }
        public boolean valid() {
            return versionCode > 0 && minSdk >= 23 && minSdk <= 100
                    && version != null && !version.isEmpty()
                    && (STABLE.equals(channel) || PREVIEW.equals(channel))
                    && ("standard".equals(flavor) || "low".equals(flavor))
                    && "arm64-v8a".equals(abi) && https(url) && https(pageUrl)
                    && sha256 != null && sha256.matches("[a-fA-F0-9]{64}")
                    && bytes > 0 && bytes <= 1024L * 1024 * 1024;
        }
    }

    public static String defaultChannel(String version) {
        return version != null && version.contains("-") ? PREVIEW : STABLE;
    }

    /** 旧稳定包可由两种通道选中，不能用发布通道或当前偏好猜测查询来源。 */
    public static String restoreCheckedChannel(boolean recorded, String checkedChannel, String releaseChannel) {
        if (recorded) return STABLE.equals(checkedChannel) || PREVIEW.equals(checkedChannel) ? checkedChannel : null;
        // 旧选择契约明确禁止稳定通道接收预览包，只有这一种旧来源可以确定。
        return PREVIEW.equals(releaseChannel) ? PREVIEW : null;
    }

    public static Release select(List<Release> releases, int currentCode, String flavor, int sdk, String channel) {
        if (!STABLE.equals(channel) && !PREVIEW.equals(channel)) throw new IllegalArgumentException(com.deepseekharness.app.util.UiText.text("未知更新通道"));
        Release best = null;
        for (Release r : releases) {
            if (!r.valid() || !flavor.equals(r.flavor) || r.minSdk > sdk || r.versionCode <= currentCode) continue;
            if (STABLE.equals(channel) && !STABLE.equals(r.channel)) continue;
            if (best == null || r.versionCode > best.versionCode
                    || (r.versionCode == best.versionCode && STABLE.equals(r.channel))) best = r;
        }
        return best;
    }

    /**
     * GitHub Releases 链路的选版函数，与 {@link #select} 【平行且互不干扰】。
     *
     * <p>为什么不复用 {@code select}：那条链路用的是自建清单的小整数
     * {@code versionCode}（历史 116 → 117 → 145），而本链路只能从 tag 推出
     * 【日期数值】（{@code v2026.09.22} → {@code 20260922}）。两者量级不重叠，
     * 混用一个字段会让「同一字段在不同链路含义不同」—— 这正是我们刚在
     * {@code share/} 路径大小写上学到的教训。宁可两个函数，不要一个字段两种语义。
     *
     * @param currentComparable 本机基准，须由 {@link #comparableCode} 从
     *        {@code versionName} 换算，【不要】传 {@code BuildConfig.VERSION_CODE}：
     *        semver tag（如 {@code v0.1.7-rc.1} → 107）会小于 145 而被误判为「不更新」。
     */
    public static Release selectFromReleases(List<Release> releases, int currentComparable,
                                             String flavor, int sdk, String channel) {
        if (!STABLE.equals(channel) && !PREVIEW.equals(channel)) throw new IllegalArgumentException(com.deepseekharness.app.util.UiText.text("未知更新通道"));
        Release best = null;
        for (Release r : releases) {
            // 0 = tag 不可解析。必须显式跳过，【不能】当成"很旧的版本"——
            // 否则一个无法解析的 tag 会静默压过合法候选，导致漏更新。
            if (r.versionCode == 0) continue;
            if (!r.valid() || !flavor.equals(r.flavor) || r.minSdk > sdk || r.versionCode <= currentComparable) continue;
            if (STABLE.equals(channel) && !STABLE.equals(r.channel)) continue;
            if (best == null || r.versionCode > best.versionCode
                    || (r.versionCode == best.versionCode && STABLE.equals(r.channel))) best = r;
        }
        return best;
    }

    public static boolean https(String value) {
        try {
            URI uri = new URI(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                    && uri.getRawUserInfo() == null && uri.getFragment() == null;
        } catch (Exception e) { return false; }
    }

    /**
     * 从 GitHub Release 的 tag 名推出一个【可按大小比较】的整数。
     *
     * <p>⚠️ 注意它与 {@link Release#versionCode} 的体系【不同】：
     * 本应用的 {@code versionCode} 是一个小计数器（历史 116 → 117 → 145），
     * 而这里返回的是【日期数值】（如 {@code v2026.09.22} → {@code 20260922}）。
     * 两者量级相差极大，直接互比会让任何 tag 都被判成"更新"。
     * 因此调用方必须拿它与【同样是日期体系的本机 versionName】比较，
     * 或在下载后解析 APK 的真实 versionCode 做最终确认。
     *
     * <p>支持两种历史形态：{@code v<YYYY>.<MM>.<DD>} 与 {@code v<major>.<minor>.<patch>}。
     * 返回 0 表示无法解析——调用方应据此跳过该条目，而不是当成"很旧"。
     */
    public static int versionCodeFromTag(String tag) {
        if (tag == null) return 0;
        java.util.regex.Matcher date = java.util.regex.Pattern
                .compile("^v?(\\d{4})\\.(\\d{2})\\.(\\d{2})").matcher(tag.trim());
        if (date.find()) {
            int year = Integer.parseInt(date.group(1)), month = Integer.parseInt(date.group(2)), day = Integer.parseInt(date.group(3));
            if (month < 1 || month > 12 || day < 1 || day > 31) return 0;
            return year * 10000 + month * 100 + day;
        }
        java.util.regex.Matcher semver = java.util.regex.Pattern
                .compile("^v?(\\d+)\\.(\\d+)(?:\\.(\\d+))?").matcher(tag.trim());
        if (semver.find()) {
            int major = Integer.parseInt(semver.group(1));
            int minor = Integer.parseInt(semver.group(2));
            int patch = semver.group(3) == null ? 0 : Integer.parseInt(semver.group(3));
            // 语义化版本压到与日期同量级（前导 1 使其小于所有 20xx 日期 tag）。
            return major * 10000 + minor * 100 + patch;
        }
        return 0;
    }

    /**
     * 把本机 {@code versionName} 换算到与 {@link #versionCodeFromTag} 同一体系。
     * 返回 0 表示该 versionName 不可解析（历史上有过 {@code 1.0.9} 这类形态）。
     */
    public static int comparableCode(String versionName) {
        if (versionName == null) return 0;
        String value = versionName.trim();
        // 低版本变体用 versionNameSuffix 拼成 "20260925low"（无连字符），必须剥掉，
        // 否则该形态无法解析，低版本设备会永远收不到更新。
        if (value.endsWith("low")) value = value.substring(0, value.length() - 3);
        if (value.endsWith("-")) value = value.substring(0, value.length() - 1);
        java.util.regex.Matcher compact = java.util.regex.Pattern
                .compile("^(\\d{4})(\\d{2})(\\d{2})$").matcher(value);
        if (compact.find()) return Integer.parseInt(value);
        return versionCodeFromTag(value);
    }
}
