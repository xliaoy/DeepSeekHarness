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
     * <p>支持两种历史形态：{@code v<YYYY>.<MM>.<DD>}（如 {@code v2026.09.22} → 20260922）
     * 与 {@code v<major>.<minor>.<patch>}（如 {@code v0.1.7} → 107）。
     * 返回 0 表示无法解析——调用方应据此跳过该条目，而不是当成"很旧"。
     */
    public static int versionCodeFromTag(String tag) {
        if (tag == null) return 0;
        String value = tag.trim();
        // 紧凑日期：YYYYMMDD，可带 -rc/-beta 等后缀（用户实际发布形态，如 20260925、20261002-rc2）。
        java.util.regex.Matcher compact = java.util.regex.Pattern
                .compile("^(\\d{4})(\\d{2})(\\d{2})(?:[^\\d]|$)").matcher(value);
        if (compact.find()) {
            int year = Integer.parseInt(compact.group(1)), month = Integer.parseInt(compact.group(2)), day = Integer.parseInt(compact.group(3));
            if (month < 1 || month > 12 || day < 1 || day > 31) return 0;
            return year * 10000 + month * 100 + day;
        }
        // 点分日期：vYYYY.MM.DD
        java.util.regex.Matcher date = java.util.regex.Pattern
                .compile("^v?(\\d{4})\\.(\\d{2})\\.(\\d{2})").matcher(value);
        if (date.find()) {
            int year = Integer.parseInt(date.group(1)), month = Integer.parseInt(date.group(2)), day = Integer.parseInt(date.group(3));
            if (month < 1 || month > 12 || day < 1 || day > 31) return 0;
            return year * 10000 + month * 100 + day;
        }
        java.util.regex.Matcher semver = java.util.regex.Pattern
                .compile("^v?(\\d+)\\.(\\d+)(?:\\.(\\d+))?").matcher(value);
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
     * 把本机 {@code versionName} 换算到与 {@link #versionCodeFromTag} 同一体系
     * （日期/语义数值）。返回 0 表示该 versionName 不可解析。
     *
     * <p>低版本变体用 versionNameSuffix 拼成 "20261002-rc2low"（无连字符），必须剥掉；
     * 紧凑日期 + rc 后缀（20261002-rc2）由 versionCodeFromTag 的紧凑分支解析。
     */
    public static int comparableCode(String versionName) {
        if (versionName == null) return 0;
        String value = versionName.trim();
        if (value.endsWith("low")) value = value.substring(0, value.length() - 3);
        if (value.endsWith("-")) value = value.substring(0, value.length() - 1);
        java.util.regex.Matcher compact = java.util.regex.Pattern
                .compile("^(\\d{4})(\\d{2})(\\d{2})$").matcher(value);
        if (compact.find()) return Integer.parseInt(value);
        return versionCodeFromTag(value);
    }
}
