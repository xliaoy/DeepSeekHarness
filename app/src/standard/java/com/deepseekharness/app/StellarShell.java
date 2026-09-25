package com.deepseekharness.app;

import android.content.Context;
import android.os.ParcelFileDescriptor;

import com.stellar.server.IRemoteProcess;
import com.stellar.server.IStellarService;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import roro.stellar.Stellar;

/**
 * Stellar（Shizuku 深度定制分支）shell 通道：免 ADB 免配对，
 * 激活后设备命令经 Stellar 服务以 shell/root 身份执行（替代 Shizuku / ADB）。
 *
 * Stellar 服务经 StellarProvider 自动连接；授权后 {@link #isReady()} 为 true，
 * {@link #exec(String)} 通过服务端 newProcess 运行 sh -c 并收集输出。
 */
public final class StellarShell {

    private static volatile Context appCtx;

    private StellarShell() {
    }

    /** 初始化：缓存 Application context（provider 已自动建立连接，无需手动绑定）。 */
    public static void init(Context ctx) {
        if (appCtx == null && ctx != null) {
            appCtx = ctx.getApplicationContext();
        }
    }

    /** Stellar 服务是否可用（binder 存活）。 */
    public static boolean isAvailable() {
        try {
            return Stellar.INSTANCE.pingBinder();
        } catch (Throwable e) {
            return false;
        }
    }

    /** 是否已获得 Stellar 权限（stellar）。 */
    public static boolean hasPermission() {
        try {
            return Stellar.INSTANCE.checkSelfPermission("stellar");
        } catch (Throwable e) {
            return false;
        }
    }

    /** 服务连接是否就绪（可执行设备命令）。 */
    public static boolean isReady() {
        try {
            return Stellar.INSTANCE.getService() != null;
        } catch (Throwable e) {
            return false;
        }
    }

    /** 供状态显示的诊断字符串。 */
    public static String status() {
        try {
            return "binder=" + isAvailable()
                    + ",permission=" + hasPermission()
                    + ",bound=" + isReady();
        } catch (Throwable e) {
            return "err:" + e.getClass().getSimpleName();
        }
    }

    /** 请求 Stellar 权限；授权成功回调自动就绪（服务经 provider 连接）。 */
    public static void requestPermission(Runnable granted) {
        try {
            Stellar.INSTANCE.addRequestPermissionResultListener((requestCode, allowed, onetime) -> {
                if (granted != null && allowed) granted.run();
            });
            Stellar.INSTANCE.requestPermission("stellar", 9527);
        } catch (Throwable ignored) {
        }
    }

    /** 执行设备命令：经 Stellar 服务 newProcess 运行 sh -c，收集 stdout/stderr 与退出码。 */
    public static String exec(String cmd) {
        try {
            IStellarService svc = Stellar.INSTANCE.getService();
            if (svc == null) return "[STELLAR_NOT_READY]";
            IRemoteProcess proc = svc.newProcess(
                    new String[]{"/system/bin/sh", "-c", cmd}, null, null);
            StringBuilder out = new StringBuilder();
            drain(proc.getInputStream(), out);
            drain(proc.getErrorStream(), out);
            int code = proc.waitFor();
            String result = out.toString().trim();
            return result.isEmpty() ? "[EXIT=" + code + "]" : result + "\n[EXIT=" + code + "]";
        } catch (Throwable t) {
            return "[STELLAR_ERROR] " + t.getClass().getSimpleName() + ": " + t.getMessage();
        }
    }

    private static void drain(ParcelFileDescriptor pfd, StringBuilder out) {
        if (pfd == null) return;
        try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(pfd)) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.append(new String(buf, 0, n, StandardCharsets.UTF_8));
            }
        } catch (Throwable ignored) {
        }
    }
}
