package com.deepseekharness.app;

import android.app.Application;

/**
 * 应用入口：全局初始化。
 *
 * <p>DeepSeekHarness 二开版：本类由 fork 的 {@code DeepSeekHarnessApp} 与上游 0.1.7 的
 * {@code DeepSeekHarnessApp} 合并而来 —— 保留 fork 的命名与更新重启钩子，同时纳入上游新增的
 * 系统语言 / 便携设置 / 语言控制器 / Shizuku / 自动备份 / 升级清理等初始化。
 */
public class DeepSeekHarnessApp extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        // 更新重启的闹钟只应触发「被杀进程」那一次；手动提前进入时在此取消，避免二次进入
        com.deepseekharness.app.core.DshUpdater.cancelPendingRestart(this);
        // 必须早于界面 Locale.setDefault；保留系统原始语言供「跟随系统」使用。
        com.deepseekharness.app.util.SystemLanguage.initialize();
        com.deepseekharness.app.data.PortableSettings.initialize(this);
        com.deepseekharness.app.ui.LanguageController.apply(this);
        ShizukuShell.init(this);
        com.deepseekharness.app.ui.ThemeController.apply(this);
        com.deepseekharness.app.core.RuntimeTasks.initialize(this);
        com.deepseekharness.app.backup.AutomaticBackups.schedule(this);
        com.deepseekharness.app.backup.PostUpgradeCleanupService.schedule(this);
        com.deepseekharness.app.core.DiagnosticLog.installCrashHandler(this);
        registerActivityLifecycleCallbacks(new com.deepseekharness.app.ui.ModernAndroidUi());
        registerActivityLifecycleCallbacks(new ForegroundActivity());
    }
}
