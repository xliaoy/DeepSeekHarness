package com.deepseekharness.app.ui;
import com.deepseekharness.app.util.UiText;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CheckBox;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.deepseekharness.app.DeviceBridgeService;
import com.deepseekharness.app.R;
import com.deepseekharness.app.RootShell;
import com.deepseekharness.app.ShizukuShell;
import com.deepseekharness.app.bridge.AdbBridge;
import com.deepseekharness.app.core.ConfigStore;
import com.deepseekharness.app.core.HarnessController;
import com.deepseekharness.app.util.Constants;

/**
 * 设备能力授权：Root / Shizuku / ADB 与系统权限集中管理。
 * 逻辑参考官方 DSHA（各自核验、不切换通道重放），弹窗/样式用本 App 自有的实现。
 */
public final class DeviceGrantsFragment extends Fragment {

    private boolean updating;
    private int adbStatusRequest;
    private com.google.android.material.materialswitch.MaterialSwitch sms;
    private TextView smsStatus;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable refreshConnections = new Runnable() {
        @Override public void run() {
            if (!isResumed() || getView() == null) return;
            refreshChannelLabels();
            main.postDelayed(this, 1000);
        }
    };

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle saved) {
        View view = inflater.inflate(R.layout.fragment_device_grants, container, false);
        final Context ctx = requireContext();

        // ===== Root Shell =====
        CheckBox root = view.findViewById(R.id.config_root_shell);
        root.setChecked(RootShell.enabled(ctx));
        root.setOnCheckedChangeListener((button, enabled) -> {
            new ConfigStore(ctx).setRootShellAllowed(enabled);
            syncSettings();
            refreshChannelLabels();
        });
        view.findViewById(R.id.device_root_verify).setOnClickListener(button -> {
            if (!RootShell.enabled(ctx)) { toast(UiText.text("请先启用「允许 Root Shell」")); return; }
            if (!RootShell.present()) { toast(UiText.text("未找到 su；请确认手机已 root，且 root 管理器允许本应用使用")); return; }
            verify(button, view.findViewById(R.id.device_root_status),
                    () -> RootShell.exec(ctx.getApplicationContext(), "id", -1));
        });

        // ===== Shizuku =====
        view.findViewById(R.id.device_shizuku_open).setOnClickListener(button -> openShizuku());
        view.findViewById(R.id.workspace_shizuku_auth).setOnClickListener(button -> {
            if (!ShizukuShell.isAvailable()) {
                button.setEnabled(false);
                com.deepseekharness.app.ShizukuManagerCompat.reconnect(requireActivity(), () -> {
                    if (!isAdded()) return;
                    button.setEnabled(true);
                    if (ShizukuShell.isAvailable()) {
                        ShizukuShell.requestPermission((code, result) -> { if (isAdded()) refreshChannelLabels(); });
                    } else toast(ShizukuShell.userStatus(ctx));
                    refreshChannelLabels();
                });
                return;
            }
            if (ShizukuShell.hasPermission()) {
                verify(button, view.findViewById(R.id.workspace_shizuku_status), () -> ShizukuShell.exec("id"));
            } else ShizukuShell.requestPermission((code, result) -> { if (isAdded()) refreshChannelLabels(); });
        });

        // ===== 定位 / 传感器 =====
        CheckBox sensors = view.findViewById(R.id.config_cap_sensors);
        sensors.setChecked(pref(ctx, "cap_sensors", false));
        sensors.setOnCheckedChangeListener((button, enabled) -> savePreference("cap_sensors", enabled));
        CheckBox location = view.findViewById(R.id.config_cap_location);
        location.setChecked(pref(ctx, "cap_location", false));
        location.setOnCheckedChangeListener((button, enabled) -> {
            savePreference("cap_location", enabled);
            if (enabled && ctx.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{android.Manifest.permission.ACCESS_FINE_LOCATION,
                        android.Manifest.permission.ACCESS_COARSE_LOCATION}, 104);
        });

        // ===== ADB =====
        CheckBox adb = view.findViewById(R.id.config_adb_enable);
        adb.setChecked(DeviceBridgeService.isAdbEnabled(ctx));
        adb.setOnCheckedChangeListener((button, enabled) -> {
            savePreference("adb_enabled", enabled);
            if (enabled) {
                DeviceBridgeService.apply(ctx);
                if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).requestLocalNetwork();
            } else ctx.stopService(new Intent(ctx, DeviceBridgeService.class));
            syncSettings();
            refreshAdbStatus(view.findViewById(R.id.config_adb_status));
        });
        view.findViewById(R.id.config_adb_pair).setOnClickListener(button -> {
            if (android.os.Build.VERSION.SDK_INT < 30) {
                AppDialogs.show(ctx, android.R.drawable.ic_dialog_alert, UiText.text("当前系统没有配对码接口"),
                        UiText.text("无线调试配对码需要 Android 11+。Android 6—10 可使用 Shizuku、已授权的 root，或由电脑开启 ADB TCP 通道。"),
                        UiText.text("知道了"), null, null);
            } else startActivity(new Intent(ctx, AdbPairActivity.class));
        });

        // ===== 短信读取（Root/ADB 授权后） =====
        sms = view.findViewById(R.id.device_sms);
        smsStatus = view.findViewById(R.id.device_sms_status);
        sms.setOnCheckedChangeListener((button, enabled) -> {
            if (updating) return;
            updateSmsUi();
            if (!enabled) { saveSms(false); return; }
            AppDialogs.show(ctx, android.R.drawable.ic_dialog_info, UiText.text("持续允许读取短信？"),
                    UiText.text("当前 DSHA 环境内的助手和插件将能通过已授权的 root 或 ADB 查询短信，包括正文、号码和可能存在的验证码。\n\n后续短信查询不再逐条询问。可随时回到本页关闭，恢复逐次确认。"),
                    UiText.text("允许短信读取"), UiText.text("取消"), () -> saveSms(true));
        });
        updateSmsUi();

        // ===== Stellar（Shizuku 兼容分支） =====
        final TextView stellarStatus = view.findViewById(R.id.device_stellar_status);
        view.findViewById(R.id.device_stellar_auth).setOnClickListener(button -> {
            com.deepseekharness.app.StellarShell.init(ctx);
            if (!com.deepseekharness.app.StellarShell.isAvailable()) {
                AppDialogs.show(ctx, android.R.drawable.ic_dialog_info, UiText.text("未检测到 Stellar 服务"),
                        UiText.text("请先安装 Stellar 管理器（https://github.com/roro2239/Stellar/releases），启动服务后回到这里授权。"),
                        UiText.text("知道了"), null, null);
                refreshStellarStatus(stellarStatus);
                return;
            }
            if (!com.deepseekharness.app.StellarShell.hasPermission()) {
                com.deepseekharness.app.StellarShell.requestPermission(() -> {
                    toast(UiText.text("Stellar 已授权"));
                    if (getView() != null) refreshStellarStatus(getView().findViewById(R.id.device_stellar_status));
                });
            } else {
                // 已授权：后台验证通道，只显示结果状态，不展示代码输出
                final View page = getView();
                button.setEnabled(false);
                stellarStatus.setText(UiText.text("正在验证 Stellar 通道…"));
                new Thread(() -> {
                    String r = com.deepseekharness.app.StellarShell.exec("id");
                    main.post(() -> {
                        if (!isAdded() || getView() != page) return;
                        button.setEnabled(true);
                        boolean ok = r != null && !r.startsWith("[STELLAR");
                        toast(ok ? UiText.text("Stellar 通道已验证") : UiText.text("验证失败，请重新授权"));
                        refreshStellarStatus(stellarStatus);
                    });
                }, "stellar-probe").start();
            }
            refreshStellarStatus(stellarStatus);
        });
        refreshStellarStatus(stellarStatus);

        // ===== 文件 / 屏幕 / 电池 =====
        view.findViewById(R.id.config_all_files).setOnClickListener(button -> openAllFilesAccess(ctx));
        view.findViewById(R.id.config_battery_opt).setOnClickListener(button -> openBatteryOpt(ctx));
        view.findViewById(R.id.config_a11y).setOnClickListener(button -> openA11ySettings(ctx));

        refreshAllFilesStatus(view.findViewById(R.id.config_all_files_status));
        refreshA11yStatus(view.findViewById(R.id.config_a11y_status));
        refreshAdbStatus(view.findViewById(R.id.config_adb_status));
        return view;
    }

    private void savePreference(String key, boolean enabled) {
        boolean ok = requireContext().getSharedPreferences(Constants.PREFS, 0)
                .edit().putBoolean(key, enabled).commit();
        if (!ok) toast(UiText.text("设置保存失败，请重试"));
    }

    private void saveSms(boolean enabled) {
        boolean saved = new com.deepseekharness.app.core.DeviceGrants(requireContext()).setSmsReadAllowed(enabled);
        updateSmsUi();
        toast(!saved ? UiText.text("授权保存失败，请重试")
                : enabled ? UiText.text("短信查询已预授权") : UiText.text("已撤销，后续查询需逐次确认"));
    }

    private void updateSmsUi() {
        if (sms == null || !isAdded()) return;
        boolean allowed = new com.deepseekharness.app.core.DeviceGrants(requireContext()).smsReadAllowed();
        updating = true; sms.setChecked(allowed); updating = false;
        smsStatus.setText(allowed ? UiText.text("已预授权 · 关闭可撤销") : UiText.text("未预授权 · 每次查询需确认"));
        smsStatus.setTextColor(requireContext().getColor(allowed ? R.color.primary : R.color.text_muted));
    }

    private void refreshStellarStatus(TextView status) {
        if (status == null) return;
        try {
            if (!com.deepseekharness.app.StellarShell.isAvailable()) {
                status.setText(UiText.text("Stellar 未运行。安装 Stellar 管理器并启动服务后，点「授权 Stellar」激活（激活后设备命令走 Stellar，免 ADB）。"));
            } else if (!com.deepseekharness.app.StellarShell.hasPermission()) {
                status.setText(UiText.text("Stellar 服务已运行，尚未授权 → 点「授权 Stellar」弹出授权即可。"));
            } else if (!com.deepseekharness.app.StellarShell.isReady()) {
                status.setText(UiText.text("Stellar 已授权，正在连接服务…（稍后自动就绪）"));
            } else {
                status.setText(UiText.text("Stellar 已激活 ✓ 设备命令走 Stellar（shell 权限），无需 ADB 配对。"));
            }
        } catch (Throwable t) {
            status.setText(UiText.text("Stellar 状态读取失败：") + t.getClass().getSimpleName());
        }
    }

    private void syncSettings() {
        final Context app = requireContext().getApplicationContext();
        final View page = getView();
        new Thread(() -> {
            String result = AdbBridge.applySettings(app, HarnessController.get(app).proot());
            main.post(() -> {
                if (!isAdded() || getView() != page) return;
                TextView status = page.findViewById(R.id.config_guard_status);
                if (status != null) {
                    status.setVisibility(View.VISIBLE);
                    status.setText(UiText.text("设备命令保护始终生效；") + result.replaceFirst("^SETTINGS_[A-Z]+: ", ""));
                }
            });
        }, "device-settings").start();
    }

    private void verify(View button, TextView status, java.util.function.Supplier<String> probe) {
        final View page = getView();
        button.setEnabled(false);
        status.setText(UiText.text("正在验证设备通道…"));
        status.setTag(Boolean.TRUE);
        new Thread(() -> {
            String output;
            try { output = probe.get(); }
            catch (Throwable error) { output = com.deepseekharness.app.util.SensitiveData.redact(String.valueOf(error)); }
            final String result = output;
            main.post(() -> {
                if (!isAdded() || getView() != page) return;
                button.setEnabled(true);
                status.setTag(null);
                AppDialogs.show(requireContext(), android.R.drawable.ic_menu_info_details,
                        UiText.text("设备通道验证"), result, UiText.text("知道了"), null, null);
                refreshChannelLabels();
            });
        }, "device-channel-probe").start();
    }

    private void openShizuku() {
        Intent launch = com.deepseekharness.app.ShizukuManagerCompat.launchIntent(requireContext());
        if (launch == null) { toast(UiText.text("尚未安装 Shizuku，请安装后启动服务")); return; }
        try { startActivity(launch); }
        catch (RuntimeException e) { toast(UiText.text("无法打开 Shizuku：") + e.getClass().getSimpleName()); }
    }

    private void refreshChannelLabels() {
        View page = getView();
        if (page == null) return;
        TextView shizuku = page.findViewById(R.id.workspace_shizuku_status);
        TextView root = page.findViewById(R.id.device_root_status);
        if (shizuku != null && shizuku.getTag() == null)
            shizuku.setText(ShizukuShell.userStatus(requireContext()));
        TextView auth = page.findViewById(R.id.workspace_shizuku_auth);
        if (auth != null) auth.setText(ShizukuShell.hasPermission() ? UiText.text("验证 Shizuku 连接") : UiText.text("授权 Shizuku"));
        if (root != null && root.getTag() == null)
            root.setText(RootShell.status(requireContext()));
    }

    @Override public void onResume() {
        super.onResume();
        ShizukuShell.ensureBound(requireContext());
        main.removeCallbacks(refreshConnections);
        main.post(refreshConnections);
        View page = getView();
        if (page != null) {
            updateSmsUi();
            refreshStellarStatus(page.findViewById(R.id.device_stellar_status));
            refreshAllFilesStatus(page.findViewById(R.id.config_all_files_status));
            refreshA11yStatus(page.findViewById(R.id.config_a11y_status));
            refreshAdbStatus(page.findViewById(R.id.config_adb_status));
        }
    }

    @Override public void onPause() { main.removeCallbacks(refreshConnections); super.onPause(); }

    @Override public void onDestroyView() {
        adbStatusRequest++;
        sms = null;
        smsStatus = null;
        super.onDestroyView();
    }

    private boolean pref(Context ctx, String key, boolean fallback) {
        return ctx.getSharedPreferences(Constants.PREFS, 0).getBoolean(key, fallback);
    }

    private void toast(String value) {
        if (getContext() != null) Toast.makeText(getContext(), value, Toast.LENGTH_LONG).show();
    }

    private void refreshAdbStatus(final TextView status) {
        final Context app = requireContext().getApplicationContext();
        final View page = getView();
        final android.app.Activity activity = getActivity();
        if (activity == null) return;
        final int request = ++adbStatusRequest;
        new Thread(() -> {
            final String text = computeAdbStatus(app);
            activity.runOnUiThread(() -> {
                if (request != adbStatusRequest || getView() != page || !isAdded()) return;
                status.setText(text);
                if (text.startsWith(UiText.text("环境任务进行中")) && isResumed()) status.postDelayed(() -> {
                    if (request == adbStatusRequest && getView() == page && isResumed()) refreshAdbStatus(status);
                }, 1500);
            });
        }, "adb-status").start();
    }

    private String computeAdbStatus(Context app) {
        try {
            if (!pref(app, "adb_enabled", false)) return UiText.text("ADB 已关闭。开启并保存后才会保持连接。");
            String bridge = DeviceBridgeService.adbState;
            String detail = DeviceBridgeService.adbDetail == null ? "" : DeviceBridgeService.adbDetail;
            HarnessController hc = HarnessController.get(app);
            String st = hc.proot().isEnvironmentReady() ? AdbBridge.status(hc.proot()) : "env:not_ready";
            if (st.startsWith("ENVIRONMENT_BUSY") || "environment_busy".equals(bridge))
                return UiText.text("环境任务进行中，ADB 暂停检查，完成后自动重试。")
                        + (detail.isEmpty() ? "" : "\n" + detail);
            boolean pairNeeded = st.contains("key=NO");
            String port = "?";
            int p = st.indexOf("port=");
            if (p >= 0) {
                int e = st.indexOf(' ', p);
                port = e > p ? st.substring(p + 5, e) : st.substring(p + 5);
            }
            if (pairNeeded) return UiText.text("等待无线配对：需要在系统设置使用配对码（设备若重启，配对可能失效需要重连）")
                    + (detail.isEmpty() ? "" : "\n" + detail);
            if ("connected".equals(bridge) || "connecting".equals(bridge)) {
                return UiText.text("已连接 ADB（127.0.0.1:") + port + UiText.text("）。自动重连服务保持连接，重启后会自动恢复。")
                        + (detail.isEmpty() ? "" : "\n" + detail);
            }
            return UiText.text("ADB 已开启，尚未连接。点「ADB 无线配对」完成配对。")
                    + (detail.isEmpty() ? "" : "\n" + detail);
        } catch (Throwable error) {
            return UiText.text("ADB 状态读取失败：") + error.getClass().getSimpleName();
        }
    }

    private void openBatteryOpt(Context ctx) {
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + ctx.getPackageName())));
        } catch (Exception e) { toast(UiText.text("无法打开电池优化设置")); }
    }

    private void openAllFilesAccess(Context ctx) {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + ctx.getPackageName())));
            } catch (Throwable e) {
                try { startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)); }
                catch (Throwable e2) { toast(UiText.text("打开设置失败：") + e2.getMessage()); }
            }
            return;
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            if (ctx.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.WRITE_EXTERNAL_STORAGE}, 501);
            } else toast(UiText.text("存储权限已授予，容器可访问手机存储"));
            return;
        }
        toast(UiText.text("当前系统无需存储权限"));
    }

    private void refreshAllFilesStatus(TextView status) {
        if (status == null) return;
        boolean granted;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            granted = Environment.isExternalStorageManager();
        } else if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            granted = requireContext().checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    == android.content.pm.PackageManager.PERMISSION_GRANTED;
        } else granted = true;
        status.setText(granted
                ? UiText.text("已开启：容器可读写手机存储任意文件")
                : UiText.text("未开启：仅能访问 App 私有目录；去系统设置开启后可访问全部文件"));
        try {
            status.setTextColor(granted
                    ? getResources().getColor(R.color.primary, null)
                    : getResources().getColor(R.color.err, null));
        } catch (Throwable ignored) { }
    }

    private void openA11ySettings(Context ctx) {
        try {
            Intent i = new Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            i.putExtra(Intent.EXTRA_COMPONENT_NAME,
                    new ComponentName(ctx, com.deepseekharness.app.DeepSeekHarnessAccessibilityService.class));
            startActivity(i);
        } catch (Throwable e) {
            try { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
            catch (Throwable e2) { toast(UiText.text("打不开无障碍设置：") + e2.getMessage()); }
        }
    }

    private void refreshA11yStatus(TextView status) {
        if (status == null) return;
        String st = com.deepseekharness.app.DeepSeekHarnessAccessibilityService.enabledState(requireContext());
        boolean ok = "YES".equals(st);
        if (ok) status.setText(UiText.text("✅ 已开启：AI 可读屏 / 点按 / 输入 / 截屏"));
        else if ("NO".equals(st)) status.setText(UiText.text("❌ 未开启：点上方到系统设置开启「DeepSeek Harness 配对助手」"));
        else status.setText(UiText.text("⚠️ 状态未知：点上方到系统设置确认已开启"));
        try {
            status.setTextColor(getResources().getColor(ok ? R.color.primary : R.color.err, null));
        } catch (Throwable ignored) { }
    }
}
