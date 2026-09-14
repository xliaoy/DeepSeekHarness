package com.deepseekharness.app.util;

/** 运行时可能在插件 JSON 后追加退出信息；只识别独立的结果行。 */
public final class PluginOutput {
    private PluginOutput() { }
    public static String resultJson(String output) {
        if (output == null) return "";
        String[] lines = output.replaceAll("\u001B\\[[0-9;]*[A-Za-z]", "").split("\\r?\\n");
        for (int i = lines.length - 1; i >= 0; i--) {
            String line = lines[i].trim();
            if (line.startsWith("PLUGIN_RESULT: ")) return line.substring("PLUGIN_RESULT: ".length()).trim();
        }
        return "";
    }
}
