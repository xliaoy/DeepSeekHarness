package com.deepseekharness.app.ui;
import com.deepseekharness.app.util.UiText;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.lifecycle.ViewModelProvider;

import com.deepseekharness.app.R;
import com.deepseekharness.app.core.BackupTask;
import com.deepseekharness.app.core.HarnessController;
import com.deepseekharness.app.core.StartupRecoveryModel;
import com.deepseekharness.app.core.StartupRepairs;
import com.deepseekharness.app.util.BackupTaskState;
import com.deepseekharness.app.util.BuiltinPlugins;
import com.deepseekharness.app.util.StartupHistoryStore;
import com.deepseekharness.app.util.StartupText;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * 启动恢复工作台（本地样式版）：不依赖 Web。
 * 独立安全启动 / 重试启动 / 新建配置 / 恢复修复前快照 / 健康启动快照 / 卸载故障插件。
 */
public final class StartupRecoveryActivity extends AppCompatActivity {
    private HarnessController controller;
    private StartupRecoveryModel model;
    private LinearLayout attempts, snapshots, plugins;
    private TextView progress;
    private final List<View> actions = new ArrayList<>();
    private final android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
    private String previousTask = "";
    private boolean wasBusy;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        controller = HarnessController.get(this);
        if (!controller.config().isWelcomed()) {
            startActivity(new Intent(this, WelcomeActivity.class));
            finish();
            return;
        }
        setContentView(R.layout.activity_startup_recovery);
        String reason = controller.config().getWebFailureReason();
        if (reason.isEmpty()) reason = controller.startupDiagnostics().snapshot().stage;
        ((TextView) findViewById(R.id.recovery_reason)).setText(UiText.text("进入原因：") + reason);
        progress = findViewById(R.id.recovery_progress);
        attempts = findViewById(R.id.recovery_attempts);
        snapshots = findViewById(R.id.recovery_snapshots);
        plugins = findViewById(R.id.recovery_plugins);
        findViewById(R.id.recovery_back).setOnClickListener(v -> finish());
        action(findViewById(R.id.recovery_retry), UiText.text("重试启动"), () -> retry(false), true);
        action(findViewById(R.id.recovery_safe), UiText.text("安全启动基础界面"), () -> retry(true), true);
        action(findViewById(R.id.recovery_new_config), UiText.text("新建配置文件"), this::newConfiguration, true);
        action(findViewById(R.id.recovery_repair_interrupted), UiText.text("恢复中断的配置修复"), () -> confirm(
                UiText.text("恢复修复前配置"),
                UiText.text("将使用修复前的快照回退中断的配置写入，然后才能重新启动。"),
                () -> repair(request("recover"))), true);
        action(findViewById(R.id.recovery_tools_env), UiText.text("环境安装与修复"),
                () -> startActivity(new Intent(this, ExtractActivity.class)), false);
        action(findViewById(R.id.recovery_tools_logs), UiText.text("查看并下载日志"),
                () -> startActivity(DiagnosticActivity.downloadLogs(this)), false);
        action(findViewById(R.id.recovery_tools_refresh), UiText.text("刷新恢复记录"), () -> model.load(), false);

        model = new ViewModelProvider(this).get(StartupRecoveryModel.class);
        BackupTaskState.Snapshot initial = BackupTask.get(this).snapshot();
        previousTask = initial.id + ":" + initial.status + ":" + initial.detail;
        model.contents.observe(this, value -> { if (value != null) render(value); });
        model.error.observe(this, value -> { if (value != null && !value.isEmpty()) { status(readable(value)); renderAttempts(); } });
        if (model.contents.getValue() == null) model.load();
    }

    /** 静态按钮绑定 + 受保护操作登记（任务进行中禁用）。 */
    private void action(View view, String text, Runnable click, boolean protectedAction) {
        if (view instanceof Button) ((Button) view).setText(text);
        view.setOnClickListener(v -> click.run());
        if (protectedAction) actions.add(view);
    }

    private void status(String text) {
        progress.setText(text);
        progress.setVisibility(text == null || text.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static JSONObject request(String command) {
        JSONObject value = new JSONObject();
        try { value.put("command", command); } catch (JSONException ignored) { }
        return value;
    }

    /** 恢复相关操作统一走 AppDialogs 弹窗确认。 */
    private void confirm(String title, String detail, Runnable work) {
        AppDialogs.show(this, android.R.drawable.ic_menu_revert, title,
                detail + UiText.text("\n\n操作会停止 Web 和终端，并保留修复前配置。"),
                UiText.text("继续"), null, UiText.text("取消"),
                () -> work.run(), null, null);
    }

    private void repair(JSONObject request) {
        if (!BackupTask.get(this).repairStartup(request))
            Toast.makeText(this, UiText.text("已有任务进行中，请完成后重试。"), Toast.LENGTH_LONG).show();
        refresh.run();
    }

    private void newConfiguration() {
        String[] names = {UiText.text("Web 启动配置"), UiText.text("共享设置（settings.yaml）"), UiText.text("共享补丁（cordis.patch.yml）")};
        String[] targets = {"web", "settings.yaml", "cordis.patch.yml"};
        AppDialogs.showList(this, android.R.drawable.ic_menu_edit, UiText.text("选择新建的配置文件"), names, index -> {
            JSONObject request = request("new");
            try { request.put("target", targets[index]); } catch (JSONException ignored) { }
            confirm(names[index],
                    UiText.text("将以默认内容替换所选配置。原文件保存到修复前快照，插件文件、会话和原生 API Key 保留。"),
                    () -> repair(request));
        });
    }

    private void retry(boolean safe) {
        if (StartupRepairs.pending(this)) { status(readable("RECOVERY_PENDING")); return; }
        controller.recoverWeb(safe, null, message -> { });
        startActivity(new Intent(this, MainActivity.class).putExtra("open_launch", true)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        finish();
    }

    private void renderAttempts() {
        if (attempts == null) return;
        attempts.removeAllViews();
        for (StartupHistoryStore.Entry entry : model.attempts) {
            String state = "ready".equals(entry.status) ? UiText.text("就绪")
                    : "failed".equals(entry.status) ? UiText.text("失败")
                    : "stopped".equals(entry.status) ? UiText.text("已停止") : UiText.text("启动中／已中断");
            row(attempts, date(entry.started) + " · " + state + " · " + entry.elapsed / 1000 + "s", () -> {
                ScrollView scroll = new ScrollView(this);
                TextView text = new TextView(this);
                text.setPadding(dp(16), dp(12), dp(16), dp(12));
                text.setTextIsSelectable(true);
                text.setTextColor(getColor(R.color.text));
                text.setTextSize(13);
                text.setText(entry.stage + "\n\n" + StartupText.render(entry.reason) + "\n\n" + entry.log);
                scroll.addView(text);
                AppDialogs.showCustom(this, android.R.drawable.ic_menu_agenda, date(entry.started),
                        scroll, UiText.text("关闭"), null, null);
            });
        }
        if (model.attempts.isEmpty()) {
            String empty = controller.startupDiagnostics().historyError().isEmpty()
                    ? UiText.text("还没有启动记录。下一次启动会自动记录。")
                    : UiText.text("启动记录暂不可用：") + controller.startupDiagnostics().historyError();
            label(attempts, empty);
        }
    }

    private void render(JSONObject value) {
        renderAttempts();
        snapshots.removeAllViews();
        plugins.removeAllViews();
        actions.removeIf(view -> view.getParent() == null);
        JSONArray records = value.optJSONArray("snapshots");
        if (records != null) for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.optJSONObject(i);
            if (record == null) continue;
            if (record.optBoolean("invalid")) {
                label(snapshots, UiText.text("快照损坏，已禁止恢复：") + record.optString("slot"));
                continue;
            }
            String text = (record.optString("slot").startsWith("healthy") ? UiText.text("健康启动") : UiText.text("修复之前"))
                    + " · " + date(record.optLong("created"));
            row(snapshots, text, () -> {
                JSONObject request = request("restore");
                try {
                    request.put("slot", record.getString("slot")).put("id", record.getString("id"));
                } catch (JSONException ignored) { }
                confirm(UiText.text("恢复所选配置快照"),
                        text + "\n" + record.optJSONArray("files")
                                + UiText.text("\n只恢复这些配置文件；已卸载的插件不会自动重新安装。"),
                        () -> repair(request));
            });
        }

        JSONArray items = value.optJSONArray("items");
        int count = 0;
        if (items != null) for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null || !item.optBoolean("deletable")) continue;
            String name = item.optString("name");
            if (BuiltinPlugins.internal(name)) continue;
            count++;
            row(plugins, name + UiText.text(" · 卸载"), () -> confirm(UiText.text("卸载插件"),
                    name + UiText.text("\n仅卸载所选插件，使用现有插件管理器核验结果。"), () -> {
                        if (!BackupTask.get(this).removeStartupPlugin(name)) status(readable("RECOVERY_BUSY"));
                    }));
        }
        findViewById(R.id.recovery_plugins_card).setVisibility(
                count > 0 || !value.optString("pluginError").isEmpty() ? View.VISIBLE : View.GONE);
        if (!value.optString("pluginError").isEmpty())
            label(plugins, UiText.text("插件清单暂不可读；可先恢复或新建配置。\n") + readable(value.optString("pluginError")));
    }

    /** 卡片内的说明文字。 */
    private TextView label(LinearLayout parent, String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(13);
        view.setTextColor(getColor(R.color.text_muted));
        view.setLineSpacing(dp(2), 1);
        view.setPadding(dp(4), dp(2), dp(4), dp(2));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        if (parent.getChildCount() > 0) params.topMargin = dp(4);
        parent.addView(view, params);
        return view;
    }

    /** 卡片内的可点行：完整说明 + 点击动作。 */
    private TextView row(LinearLayout parent, String text, Runnable click) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(15);
        view.setTextColor(getColor(R.color.text));
        view.setIncludeFontPadding(false);
        view.setGravity(android.view.Gravity.CENTER_VERTICAL);
        view.setMinHeight(dp(44));
        view.setPadding(dp(8), dp(10), dp(8), dp(10));
        view.setBackgroundResource(R.drawable.bg_action_plain);
        view.setContentDescription(text);
        view.setOnClickListener(v -> click.run());
        view.setClickable(true);
        view.setFocusable(true);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(parent.getChildCount() == 0 ? 4 : 2);
        parent.addView(view, params);
        actions.add(view);
        return view;
    }

    private String date(long time) {
        return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(new Date(time));
    }

    private String readable(String value) {
        if (value.contains("RECOVERY_PENDING")) return UiText.text("配置修复未完成，请使用「恢复中断的配置修复」。");
        if (value.contains("RECOVERY_BUSY")) return UiText.text("环境任务正在执行，完成后刷新即可。");
        if (value.contains("RECOVERY_LINK")) return UiText.text("配置文件使用软链接，已保留原文件。请手动检查链接目标。");
        if (value.contains("RECOVERY_CHECKSUM") || value.contains("RECOVERY_FORMAT"))
            return UiText.text("配置快照校验失败，未应用修复。");
        if (value.contains("RECOVERY_CHANGED")) return UiText.text("配置或快照已变化，请刷新后重新选择。");
        if (value.contains("RECOVERY_SIZE")) return UiText.text("配置文件超过快照大小限制或不是普通文件，原文件保留。");
        return StartupText.render(value);
    }

    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            if (isFinishing()) return;
            BackupTask task = BackupTask.get(StartupRecoveryActivity.this);
            BackupTaskState.Snapshot state = task.snapshot();
            boolean busy = task.busy();
            String key = state.id + ":" + state.status + ":" + state.detail;
            if (!key.equals(previousTask)) {
                previousTask = key;
                if (state.id > 0) status(readable(state.detail));
            }
            boolean maintenance = task.maintenanceBusy();
            if (wasBusy && !maintenance) model.load();
            wasBusy = maintenance;
            boolean enabled = !busy && controller.isEnvironmentReady();
            for (View action : actions) {
                action.setEnabled(enabled);
                action.setAlpha(enabled ? 1f : 0.5f);
            }
            ui.removeCallbacks(this);
            ui.postDelayed(this, 700);
        }
    };

    @Override
    protected void onResume() {
        super.onResume();
        ui.post(refresh);
    }

    @Override
    protected void onPause() {
        ui.removeCallbacks(refresh);
        super.onPause();
    }
}
