package com.deepseekharness.app;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

/**
 * 应用入口：全局初始化。
 * 骨架阶段只建一个任务通知渠道；完整版另有配对/确认渠道（见原 Constants.CHANNEL_*）。
 */
public class DeepSeekHarnessApp extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        // 更新重启的闹钟只应触发「被杀进程」那一次；手动提前进入时在此取消，避免二次进入。
        com.deepseekharness.app.core.DshUpdater.cancelPendingRestart(this);
        // 必须早于界面 Locale.setDefault；保留系统原始语言供「跟随系统」使用。
        com.deepseekharness.app.util.SystemLanguage.initialize(this);
        com.deepseekharness.app.data.PortableSettings.initialize(this);
        com.deepseekharness.app.ui.LanguageController.apply(this);
        ShizukuShell.init(this);
        com.deepseekharness.app.ui.ThemeController.apply(this);
        com.deepseekharness.app.core.RuntimeTasks.initialize(this);
        final android.content.Context runtimeApp = getApplicationContext();
        com.deepseekharness.app.runtime.RuntimeHostPorts.shared().install(
                new com.deepseekharness.app.runtime.RuntimeHostPorts.Provider() {
                    @Override public com.deepseekharness.app.runtime.RuntimeHostPorts.Settings snapshot() {
                        return new com.deepseekharness.app.core.ConfigStore(runtimeApp).runtimeSettingsSnapshot();
                    }
                    @Override public void stage(String value) {
                        com.deepseekharness.app.core.ColdInstallDiagnostics.stage(runtimeApp, value);
                    }
                    @Override public void record(String kind, String detail) {
                        com.deepseekharness.app.core.ColdInstallDiagnostics.record(runtimeApp, kind, detail);
                    }
                    @Override public void failure(Throwable error) {
                        com.deepseekharness.app.core.ColdInstallDiagnostics.failure(runtimeApp, error);
                    }
                });
        com.deepseekharness.app.backup.AutomaticBackups.schedule(this);
        com.deepseekharness.app.backup.PostUpgradeCleanupService.schedule(this);
        com.deepseekharness.app.core.DiagnosticLog.installCrashHandler(this);
        registerActivityLifecycleCallbacks(new com.deepseekharness.app.ui.ModernAndroidUi());
        registerActivityLifecycleCallbacks(new ForegroundActivity());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(new NotificationChannel(
                    "dsh_task_channel", com.deepseekharness.app.util.UiText.text("任务通知"), NotificationManager.IMPORTANCE_LOW));
        }
    }
}
