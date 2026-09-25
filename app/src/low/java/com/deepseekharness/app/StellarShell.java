package com.deepseekharness.app;

import android.content.Context;

/**
 * Stellar shell 通道（low 版空实现）。
 *
 * <p>low 是 minSdk 23 的兼容分支，携带 GeckoView 内核，**不引入 Stellar-API**
 * （见 {@code app/build.gradle}：只有 {@code standardImplementation} 依赖
 * {@code com.github.roro2239.Stellar-API}）。为了让 {@code main/} 里的共用代码
 * （{@code HttpShellService} 的四通道链、{@code ui.ConfigFragment} 的配对入口）
 * 能在两个 flavor 下同一份源码编译，这里提供与
 * {@code standard/java/com/deepseekharness/app/StellarShell.java} **完全一致的公开 API**，
 * 但全部恒为「不可用」。
 *
 * <p>语义正确性：low 版本来就不提供 Stellar 通道，因此
 * {@link #isAvailable()} / {@link #hasPermission()} / {@link #isReady()} 恒为 {@code false}，
 * {@link #exec(String)} 恒返回 {@code [STELLAR_UNAVAILABLE]}，调用方会自然回退到
 * Shizuku / ADB / Root 通道。
 */
public final class StellarShell {

    private StellarShell() {
    }

    /** 空实现：low 版无 Stellar 服务，无需缓存 context。 */
    public static void init(Context ctx) {
    }

    /** low 版不支持 Stellar，恒不可用。 */
    public static boolean isAvailable() {
        return false;
    }

    /** low 版不支持 Stellar，恒无权限。 */
    public static boolean hasPermission() {
        return false;
    }

    /** low 版不支持 Stellar，恒未就绪；调用方据此回退到 Shizuku / ADB / Root。 */
    public static boolean isReady() {
        return false;
    }

    /** 状态字符串，与 standard 版保持同样的可读形状，便于诊断页统一展示。 */
    public static String status() {
        return "binder=false,permission=false,bound=false";
    }

    /** 空实现：low 版无需申请 Stellar 权限，也不回调。 */
    public static void requestPermission(Runnable granted) {
    }

    /** low 版无法执行：返回明确的不可用标记，不会让调用方误判为「命令失败」。 */
    public static String exec(String cmd) {
        return "[STELLAR_UNAVAILABLE]";
    }
}
