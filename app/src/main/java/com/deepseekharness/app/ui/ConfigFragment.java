package com.deepseekharness.app.ui;
import com.deepseekharness.app.util.UiText;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.deepseekharness.app.OverlayController;
import com.deepseekharness.app.R;
import com.deepseekharness.app.core.ConfigStore;
import com.deepseekharness.app.core.HarnessController;
import com.deepseekharness.app.util.Constants;

/**
 * 配置子页：接口（API Key / 端口）+ 显示与运行（行为开关）+ DNS。
 * 页面结构对齐官方 DSHA v0.1.5-rc2；Root/ADB/Shizuku/Stellar 等设备通道由「权限配置」页统一管理。
 * 所有开关都落到 ConfigStore / SharedPreferences，并真正影响启动与预览。
 */
public class ConfigFragment extends Fragment {

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        View v = inflater.inflate(R.layout.fragment_config, container, false);
        ConfigStore c = new ConfigStore(requireContext());
        Context ctx = requireContext();
        android.widget.RadioGroup dns = v.findViewById(R.id.config_dns_mode);
        String dnsMode = ctx.getSharedPreferences(Constants.PREFS, Context.MODE_PRIVATE)
                .getString("dns_mode", "auto");
        dns.check("ipv4".equals(dnsMode) ? R.id.dns_ipv4
                : "native".equals(dnsMode) ? R.id.dns_native : R.id.dns_auto);

        v.findViewById(R.id.config_workspace_entry).setOnClickListener(x -> open(new WorkspaceFragment()));

        EditText apiKey = v.findViewById(R.id.config_api_key);
        EditText port = v.findViewById(R.id.config_port);
        android.widget.CompoundButton checkUpdate = v.findViewById(R.id.config_check_update);
        android.widget.CompoundButton desktop = v.findViewById(R.id.config_desktop_mode);
        android.widget.CompoundButton confirm = v.findViewById(R.id.config_confirm_shell);
        android.widget.CompoundButton proroot = v.findViewById(R.id.config_proroot);
        android.widget.CompoundButton lan = v.findViewById(R.id.config_lan_mode);
        android.widget.CompoundButton overlay = v.findViewById(R.id.config_overlay_stream);
        Button save = v.findViewById(R.id.config_save);

        // 高级项折叠
        View advBody = v.findViewById(R.id.config_adv_body);
        v.findViewById(R.id.config_adv_header).setOnClickListener(x ->
                advBody.setVisibility(advBody.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE));

        // 回填当前值
        apiKey.setText(c.getApiKey());
        port.setText(c.getPort());
        checkUpdate.setChecked(c.isCheckUpdate());
        desktop.setChecked(c.isDesktopMode());
        android.widget.CompoundButton gecko = v.findViewById(R.id.config_gecko_core);
        gecko.setVisibility(com.deepseekharness.app.BuildConfig.LOW_ANDROID ? View.VISIBLE : View.GONE);
        v.findViewById(R.id.config_gecko_hint).setVisibility(com.deepseekharness.app.BuildConfig.LOW_ANDROID ? View.VISIBLE : View.GONE);
        gecko.setChecked(c.isGeckoCore());
        confirm.setChecked(c.isConfirmShell());
        proroot.setChecked(c.isProroot());
        lan.setChecked(c.isLanMode());
        overlay.setChecked(ctx.getSharedPreferences(Constants.PREFS, Context.MODE_PRIVATE)
                .getBoolean("overlay_stream", false));
        // 悬浮条外观与行为（照 1.1.9.1：底色预设 + 不透明度/行数/字号/停留 + 行为开关）
        v.findViewById(R.id.config_overlay_style).setOnClickListener(x -> showOverlayStyleDialog());

        v.findViewById(R.id.config_repo_link).setOnClickListener(x -> openRepo(ctx));

        save.setOnClickListener(x -> {
            final int chosenPort;
            try { chosenPort = com.deepseekharness.app.util.ConfigInput.port(port.getText().toString()); }
            catch (IllegalArgumentException e) {
                advBody.setVisibility(View.VISIBLE); port.setError(e.getMessage()); port.requestFocus(); return;
            }
            port.setError(null); apiKey.setError(null);
            com.deepseekharness.app.util.EnvironmentTaskGate.Lease saving =
                    com.deepseekharness.app.util.EnvironmentTaskGate.tryAcquire(UiText.text("保存配置"));
            if (saving == null) {
                toast(UiText.text("正在") + com.deepseekharness.app.util.EnvironmentTaskGate.activeKind() + UiText.text("，完成后再保存配置"));
                return;
            }
            try {
                saving.run(() -> {
                    String key = apiKey.getText().toString().trim();
                    if (!c.saveApiKey(key)) { apiKey.setError(UiText.text("密钥加密保存失败，原配置已保留，请重试")); return null; }
                    c.setPort(String.valueOf(chosenPort));
                    c.setCheckUpdate(checkUpdate.isChecked());
                    c.setDesktopMode(desktop.isChecked());
                    if (com.deepseekharness.app.BuildConfig.LOW_ANDROID) c.setGeckoCore(gecko.isChecked());
                    c.setConfirmShell(confirm.isChecked());
                    c.setProroot(proroot.isChecked());
                    ctx.getSharedPreferences(Constants.PREFS, Context.MODE_PRIVATE).edit()
                            .putString("dns_mode",
                                    dns.getCheckedRadioButtonId() == R.id.dns_ipv4 ? "ipv4"
                                            : dns.getCheckedRadioButtonId() == R.id.dns_native ? "native" : "auto")
                            .apply();
                    c.setLanMode(lan.isChecked());
                    ctx.getSharedPreferences(Constants.PREFS, Context.MODE_PRIVATE).edit()
                            .putBoolean("overlay_stream", overlay.isChecked()).apply();
                    applyLanMode(c, lan.isChecked());
                    if (lan.isChecked() && getActivity() instanceof MainActivity)
                        ((MainActivity) getActivity()).requestLocalNetwork();
                    Toast.makeText(ctx, UiText.text("已保存；网页显示选项重新进入对话生效，端口与运行时需重启 Web"), Toast.LENGTH_LONG).show();
                    if (overlay.isChecked() && !OverlayController.permitted(ctx)) openOverlayPermission();
                    return null;
                });
            } catch (Exception e) {
                toast(UiText.text("配置保存未完成：") + com.deepseekharness.app.util.SensitiveData.redact(String.valueOf(e)));
            } finally { saving.close(); }
        });

        return v;
    }

    private void openOverlayPermission() {
        try {
            startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + requireContext().getPackageName())));
        } catch (Exception e) {
            toast(UiText.text("未取得悬浮窗权限，请到系统设置 → 应用 → DeepSeek Harness → 悬浮窗中允许"));
        }
    }

    /** LAN 开关真正生效：开启时若 dsh 已鉴权则启动 3081 代理，关闭时停掉监听。 */
    private void applyLanMode(ConfigStore c, boolean on) {
        try {
            if (!on) {
                com.deepseekharness.app.LanProxyService.stopLanListener();
                return;
            }
            HarnessController hc = new HarnessController(requireContext());
            long gen = hc.getWebGeneration();
            if (gen <= 0 || !com.deepseekharness.app.LanProxyService.hasDshAuth(gen)) {
                // dsh 还没起来/还没交换 cookie：等下次进入对话时 HarnessController 自动启动
                return;
            }
            com.deepseekharness.app.LanProxyService.start(
                    hc.proot().getRootfsDir().getAbsolutePath(),
                    requireContext(), c.getPortInt(), gen);
        } catch (Throwable t) {
            android.util.Log.w("DeepSeekHarness", "LAN 开关生效失败: " + t.getMessage());
        }
    }

    private void open(Fragment f) {
        UiMotion.page(requireContext(), getParentFragmentManager().beginTransaction())
                .addToBackStack(null)
                .replace(R.id.fragment_container, f)
                .commit();
    }

    private void openRepo(Context ctx) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW,
                    Uri.parse(AboutDialog.GITHUB_URL)));
        } catch (Exception e) {
            toast(UiText.text("无法打开浏览器"));
        }
    }

    // ================= 悬浮条外观与行为（照 1.1.9.1 移植） =================

    private void showOverlayStyleDialog() {
        final android.content.Context app = requireContext().getApplicationContext();
        final android.content.SharedPreferences sp = requireContext()
                .getSharedPreferences(Constants.PREFS, Context.MODE_PRIVATE);

        LinearLayout box = new LinearLayout(requireContext());
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dpx(16);
        box.setPadding(pad, pad, pad, 0);

        // 底色不做取色器：悬浮条只需要「在任何壁纸上都读得清」，几个深色预设够用
        box.addView(sectionLabel(UiText.text("底色")));
        final int[] pickedBg = {sp.getInt(OverlayController.K_BG, 0)};
        LinearLayout swatches = new LinearLayout(requireContext());
        swatches.setOrientation(LinearLayout.HORIZONTAL);
        final TextView[] cells = new TextView[OverlayController.BG_PRESETS.length];
        for (int i = 0; i < OverlayController.BG_PRESETS.length; i++) {
            final int idx = i;
            TextView cell = new TextView(requireContext());
            cell.setText(OverlayController.BG_NAMES[i]);
            cell.setTextColor(0xFFFFFFFF);
            cell.setTextSize(11f);
            cell.setGravity(Gravity.CENTER);
            cell.setPadding(dpx(6), dpx(10), dpx(6), dpx(10));
            LinearLayout.LayoutParams lp =
                    new LinearLayout.LayoutParams(0,
                            LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            lp.rightMargin = dpx(4);
            cell.setLayoutParams(lp);
            cells[i] = cell;
            cell.setOnClickListener(v -> {
                pickedBg[0] = idx;
                paintSwatches(cells, pickedBg[0]);
            });
            swatches.addView(cell);
        }
        paintSwatches(cells, pickedBg[0]);
        box.addView(swatches);

        final android.widget.SeekBar alpha = slider(box, UiText.text("底色不透明度"), 20, 100,
                sp.getInt(OverlayController.K_ALPHA, OverlayController.DEF_ALPHA), "%");
        final android.widget.SeekBar lines = slider(box, UiText.text("最多显示几行（写满后丢最旧一行）"), 1, 8,
                sp.getInt(OverlayController.K_LINES, OverlayController.DEF_LINES), UiText.text(" 行"));
        final android.widget.SeekBar wide = slider(box, UiText.text("字号（越小一行放得越多）"), 6, 20,
                sp.getInt(OverlayController.K_TEXT_SP, OverlayController.DEF_TEXT_SP), " sp");
        final android.widget.SeekBar hold = slider(box, UiText.text("无新内容后停留"), 2, 60,
                sp.getInt(OverlayController.K_HOLD, OverlayController.DEF_HOLD), UiText.text(" 秒"));

        final com.google.android.material.materialswitch.MaterialSwitch think = new com.google.android.material.materialswitch.MaterialSwitch(requireContext());
        think.setText(UiText.text("显示思考过程（reasoning，会明显更吵）"));
        think.setChecked(sp.getBoolean(OverlayController.K_REASONING, false));
        box.addView(think);

        final com.google.android.material.materialswitch.MaterialSwitch cmd = new com.google.android.material.materialswitch.MaterialSwitch(requireContext());
        cmd.setText(UiText.text("工具调用带上命令原文（否则只看到「正在执行命令」）"));
        cmd.setChecked(sp.getBoolean(OverlayController.K_COMMAND, true));
        box.addView(cmd);

        final com.google.android.material.materialswitch.MaterialSwitch confirmHere = new com.google.android.material.materialswitch.MaterialSwitch(requireContext());
        confirmHere.setText(UiText.text("危险命令在悬浮条上直接批准（不必切回 App 或拉通知栏）"));
        confirmHere.setChecked(sp.getBoolean(OverlayController.K_CONFIRM, true));
        box.addView(confirmHere);

        ScrollView scroll = new ScrollView(requireContext());
        scroll.addView(box);

        // 保存抽成 Runnable：「预览」要能不关对话框就先落盘，否则看到的还是旧样式
        final Runnable save = () -> sp.edit()
                .putInt(OverlayController.K_BG, pickedBg[0])
                .putInt(OverlayController.K_ALPHA, Math.max(20, alpha.getProgress()))
                .putInt(OverlayController.K_LINES, Math.max(1, lines.getProgress()))
                .putInt(OverlayController.K_TEXT_SP, Math.max(6, wide.getProgress()))
                .putInt(OverlayController.K_HOLD, Math.max(2, hold.getProgress()))
                .putBoolean(OverlayController.K_REASONING, think.isChecked())
                .putBoolean(OverlayController.K_COMMAND, cmd.isChecked())
                .putBoolean(OverlayController.K_CONFIRM, confirmHere.isChecked())
                .apply();

        AppDialogs.showCustom(requireContext(), android.R.drawable.ic_menu_edit, UiText.text("悬浮条外观与行为"),
                scroll, UiText.text("保存"), UiText.text("预览"), UiText.text("取消"),
                () -> {
                    save.run();
                    OverlayController.applyStyleNow(app);
                    Toast.makeText(requireContext(), UiText.text("已保存（下一条输出即生效）"),
                            Toast.LENGTH_SHORT).show();
                },
                () -> {
                    // 中间按钮当预览：调样式最烦的就是「保存 → 等 agent 说话 → 不合适 → 再调」
                    save.run();
                    if (!OverlayController.permitted(requireContext())) {
                        Toast.makeText(requireContext(), UiText.text("还没给悬浮窗权限，先勾上面那个开关授权"),
                                Toast.LENGTH_LONG).show();
                        return;
                    }
                    OverlayController.applyStyleNow(app);
                    OverlayController.push(app, "preview", "text",
                            UiText.text("这是预览：AI 的回复会像这样流出来，调工具时会变成")
                                    + UiText.text("「⚙ 正在执行命令: ls -la」这种。"));
                });
    }

    private void paintSwatches(TextView[] cells, int picked) {
        for (int i = 0; i < cells.length; i++) {
            android.graphics.drawable.GradientDrawable bg =
                    new android.graphics.drawable.GradientDrawable();
            bg.setCornerRadius(dpx(10));
            bg.setColor(0xFF000000 | OverlayController.BG_PRESETS[i]);
            // 选中描边：几个深色块之间光靠颜色分不清哪个选上了
            if (i == picked) bg.setStroke(dpx(2), 0xFF7DA7F4);
            cells[i].setBackground(bg);
        }
    }

    private TextView sectionLabel(String text) {
        TextView t = new TextView(requireContext());
        t.setText(text);
        t.setTextSize(12f);
        t.setPadding(0, dpx(8), 0, dpx(4));
        return t;
    }

    /** 一条「标题 + 当前值」的滑杆。SeekBar 只有 0..max，下限靠回弹保证。 */
    private android.widget.SeekBar slider(LinearLayout parent, String title,
                                          int min, int max, int value, String unit) {
        final TextView label = sectionLabel(title + UiText.text("：") + value + unit);
        parent.addView(label);
        final android.widget.SeekBar bar = new android.widget.SeekBar(requireContext());
        bar.setMax(max);
        bar.setProgress(Math.max(min, Math.min(max, value)));
        bar.setOnSeekBarChangeListener(new android.widget.SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(android.widget.SeekBar sb, int progress, boolean fromUser) {
                if (progress < min) {
                    sb.setProgress(min);
                    return;
                }
                label.setText(title + UiText.text("：") + progress + unit);
            }

            @Override
            public void onStartTrackingTouch(android.widget.SeekBar sb) {
            }

            @Override
            public void onStopTrackingTouch(android.widget.SeekBar sb) {
            }
        });
        parent.addView(bar);
        return bar;
    }

    private int dpx(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void toast(String s) {
        Context context = getContext();
        if (context != null) Toast.makeText(context, s, Toast.LENGTH_SHORT).show();
    }
}