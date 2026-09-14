package com.deepseekharness.app.bridge;

/**
 * 3090 App 能力桥的接缝（agent 调 Android 的入口）。
 *
 * <p>骨架阶段只声明契约，不实现：原版 {@code HttpShellService} 的完整端点
 * （/exec、/confirm、/app/device、/app/launch、/app/clip、/app/ask …）按此接口回填，
 * token 门控与单飞守卫的约定见 AGENTS.md。
 */
public interface AppBridge {

    /** 执行一条受控命令，返回纯文本结果。 */
    String exec(String cmd);
}
