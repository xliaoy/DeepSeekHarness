package com.deepseekharness.app.util;

/** 隔离试运行只把本轮自有检查插件的 loader 故障当成检查插件故障。 */
public final class RuntimeTrialOutputPolicy {
    private RuntimeTrialOutputPolicy() { }

    public static boolean ownedPluginFailure(String line) {
        if (line == null || !line.contains("deepseekharness-runtime-check")) return false;
        return line.contains("failed to apply loader entry")
                || line.contains("failed to import loader entry")
                // dsh 把插件 import 失败记为 "did not activate"，常见根因是
                // ESM 解析 @deepseek-ai/dsh-session 失败（proot 下 symlink 链）。
                // 直接暴露具体原因，避免被页面 fatal 误判成 TRIAL_RENDERER_FAILED。
                || line.contains("Cannot find package")
                || line.contains("ERR_MODULE_NOT_FOUND")
                || line.contains("did not activate");
    }
}
