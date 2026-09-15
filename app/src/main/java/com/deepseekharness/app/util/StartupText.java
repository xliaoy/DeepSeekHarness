package com.deepseekharness.app.util;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 启动事件行的中文规整：只处理应用自己产生的机器行（进程退出、端口、内置插件注册）。
 * 插件异常正文与用户内容不做全文替换。
 */
public final class StartupText {
    private StartupText() { }

    /** 规整为当前界面语言（本二开版固定中文）。 */
    public static String render(String text) {
        if (text == null) return "";
        Matcher exited = Pattern.compile(
                "^(proot|proroot)(?: 进程退出，退出码 | process exited with code )(-?[0-9]+)"
                        + " ?(?:（(鉴权前|鉴权后)）|\\((before authentication|after authentication)\\))$").matcher(text);
        if (exited.matches()) {
            return exited.group(1) + " 进程退出，退出码 " + exited.group(2)
                    + ("鉴权前".equals(exited.group(3)) || "before authentication".equals(exited.group(4))
                    ? "（鉴权前）" : "（鉴权后）");
        }
        Matcher created = Pattern.compile(
                "^dsh web (?:进程已创建|process created) → 127\\.0\\.0\\.1:([0-9]+)"
                        + "(?:（等待鉴权链接…）|\\(waiting for authentication link…\\))$").matcher(text);
        if (created.matches()) {
            return "dsh web 进程已创建 → 127.0.0.1:" + created.group(1) + "（等待鉴权链接…）";
        }
        Matcher registered = Pattern.compile(
                "^BUILTIN_REGISTER_OK: ([0-9]+)(?: 个内置插件注册就绪| built-in plugins registered)$").matcher(text);
        if (registered.matches()) {
            return "BUILTIN_REGISTER_OK: " + registered.group(1) + " 个内置插件注册就绪";
        }
        if (text.startsWith("BUILTIN_REGISTER_FAIL: ")) {
            return "BUILTIN_REGISTER_FAIL: " + render(text.substring(23));
        }
        return text;
    }
}
