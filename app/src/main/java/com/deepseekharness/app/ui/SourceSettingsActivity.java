package com.deepseekharness.app.ui;

import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import com.deepseekharness.app.R;
import com.deepseekharness.app.core.ConfigStore;
import com.deepseekharness.app.core.HarnessController;
import com.deepseekharness.app.runtime.ProotBootstrap;
import java.io.File;

/** 源设置：npm / APT(系统镜像) / pip 一键切换，支持预设与自定义。 */
public final class SourceSettingsActivity extends AppCompatActivity {

    private static final String[][] NPM_PRESETS = {
            {"官方 npm", "https://registry.npmjs.org/"},
            {"阿里云 · npmmirror", "https://registry.npmmirror.com"},
            {"腾讯云", "https://mirrors.cloud.tencent.com/npm/"},
            {"华为云", "https://mirrors.huaweicloud.com/repository/npm/"},
    };
    private static final String[][] APT_PRESETS = {
            {"官方 ports.ubuntu.com", "http://ports.ubuntu.com/ubuntu-ports/"},
            {"清华 TUNA", "https://mirrors.tuna.tsinghua.edu.cn/ubuntu-ports/"},
            {"阿里云", "https://mirrors.aliyun.com/ubuntu-ports/"},
            {"中科大 USTC", "https://mirrors.ustc.edu.cn/ubuntu-ports/"},
            {"腾讯云", "https://mirrors.cloud.tencent.com/ubuntu-ports/"},
            {"华为云", "https://repo.huaweicloud.com/ubuntu-ports/"},
            {"网易 163", "https://mirrors.163.com/ubuntu-ports/"},
            {"搜狐", "https://mirrors.sohu.com/ubuntu-ports/"},
            {"兰州大学", "https://mirror.lzu.edu.cn/ubuntu-ports/"},
            {"重庆大学", "https://mirrors.cqu.edu.cn/ubuntu-ports/"},
    };
    private static final String[][] PIP_PRESETS = {
            {"官方 PyPI", "https://pypi.org/simple"},
            {"清华 TUNA", "https://pypi.tuna.tsinghua.edu.cn/simple"},
            {"阿里云", "https://mirrors.aliyun.com/pypi/simple/"},
            {"腾讯云", "https://mirrors.cloud.tencent.com/pypi/simple"},
    };

    private ConfigStore config;
    private ProotBootstrap proot;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());

    @Override
    protected void onCreate(@Nullable Bundle saved) {
        super.onCreate(saved);
        setContentView(R.layout.activity_source_settings);
        config = new ConfigStore(this);
        proot = HarnessController.get(this).proot();

        findViewById(R.id.source_back).setOnClickListener(v -> finish());

        setupSpinner(R.id.npm_spinner, NPM_PRESETS, R.id.npm_custom, config.getNpmSource());
        setupSpinner(R.id.apt_spinner, APT_PRESETS, R.id.apt_custom, config.getAptSource());
        setupSpinner(R.id.pip_spinner, PIP_PRESETS, R.id.pip_custom, config.getPipSource());

        refreshCurrent(R.id.npm_current, config.getNpmSource(), "npm");
        refreshCurrent(R.id.apt_current, config.getAptSource(), "APT");
        refreshCurrent(R.id.pip_current, config.getPipSource(), "pip");

        ((Button) findViewById(R.id.npm_apply)).setOnClickListener(v -> applyNpm(text(R.id.npm_custom)));
        ((Button) findViewById(R.id.apt_apply)).setOnClickListener(v -> applyApt(text(R.id.apt_custom)));
        ((Button) findViewById(R.id.pip_apply)).setOnClickListener(v -> applyPip(text(R.id.pip_custom)));
    }

    /** 下拉单选：预设源列表 + 末尾一项「自定义」。选中预设自动填入自定义输入框，用户点「应用」。
     *  进入页面时按已应用的源（savedUrl）定位选中项：匹配预设则选中预设，否则选中「自定义」。 */
    private void setupSpinner(int spinnerId, String[][] presets, int customInputId, String savedUrl) {
        android.widget.Spinner spinner = findViewById(spinnerId);
        String[] names = new String[presets.length + 1];
        for (int i = 0; i < presets.length; i++) names[i] = presets[i][0];
        names[presets.length] = "自定义";
        android.widget.ArrayAdapter<String> adapter = new android.widget.ArrayAdapter<>(this,
                R.layout.item_source_spinner, android.R.id.text1, names);
        adapter.setDropDownViewResource(R.layout.item_source_spinner_dropdown);
        spinner.setAdapter(adapter);
        spinner.setPopupBackgroundResource(R.drawable.bg_spinner_popup);
        // 定位当前已应用的源：URL 匹配某个预设则选中它（显示预设名），否则落到「自定义」。
        int selected = names.length - 1;
        if (savedUrl != null && !savedUrl.trim().isEmpty()) {
            for (int i = 0; i < presets.length; i++) {
                if (sameSource(savedUrl, presets[i][1])) { selected = i; break; }
            }
        }
        spinner.setSelection(selected);
        final EditText input = findViewById(customInputId);
        spinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, android.view.View view, int position, long id) {
                if (position < presets.length) input.setText(presets[position][1]);
            }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) { }
        });
    }

    /** 宽松比较源地址：去尾部斜杠后相等，或互为前缀（预设/自定义可能带或不带结尾斜杠）。 */
    private static boolean sameSource(String a, String b) {
        if (a == null || b == null) return false;
        String x = trimSlash(a), y = trimSlash(b);
        return x.equals(y) || x.startsWith(y) || y.startsWith(x);
    }

    private static String trimSlash(String url) {
        String t = url.trim();
        while (t.endsWith("/")) t = t.substring(0, t.length() - 1);
        return t;
    }

    /** 刷新「当前源」显示（进入页面与应用成功后共用，保证换源后立即可见）。 */
    private void refreshCurrent(int id, String saved, String label) {
        ((TextView) findViewById(id)).setText(currentOf(id, saved, label));
    }

    private void applyNpm(String url) {
        if (bad(url)) return;
        showApplyDialog("npm 源", "正在应用 npm 源…", () -> {
            proot.execAndRead("export npm_config_prefix=/usr/local; npm config set registry " + shell(url)
                    + " && npm config get registry", 30_000);
        }, "npm 源已切换", () -> { config.setNpmSource(url); refreshCurrent(R.id.npm_current, url, "npm"); });
    }

    private void applyApt(String url) {
        if (bad(url)) return;
        showApplyDialog("Ubuntu 软件包源", "正在写入源并刷新索引…", () -> {
            // 用 deb822 格式写入独立源文件（Ubuntu 软件包镜像源，本机为 arm64 走 ubuntu-ports）
            String content = "Types: deb\nURIs: " + url + "\nSuites: noble noble-updates noble-security\n"
                    + "Components: main universe multiverse restricted\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n";
            String result = proot.execAndRead("mkdir -p /etc/apt/sources.list.d && cat > /etc/apt/sources.list.d/deepseekharness-mirror.sources << 'SRCEOF'\n"
                    + content + "SRCEOF\ncat /etc/apt/sources.list.d/deepseekharness-mirror.sources && apt-get update -o Acquire::Retries=1", 120_000);
            boolean ok = result != null && !result.contains("Failed to fetch") && !result.contains("Err:");
            if (!ok) throw new RuntimeException("源已写入，但 apt-get update 有问题，可稍后在终端重试");
        }, "Ubuntu 软件包源已切换并刷新索引", () -> { config.setAptSource(url); refreshCurrent(R.id.apt_current, url, "APT"); });
    }

    private void applyPip(String url) {
        if (bad(url)) return;
        showApplyDialog("pip 源", "正在应用 pip 源…", () -> {
            String content = "[global]\nindex-url = " + url + "\n";
            proot.execAndRead("mkdir -p /root/.config/pip && cat > /root/.config/pip/pip.conf << 'PIPEOF'\n"
                    + content + "PIPEOF\ncat /root/.config/pip/pip.conf", 15_000);
        }, "pip 源已切换", () -> { config.setPipSource(url); refreshCurrent(R.id.pip_current, url, "pip"); });
    }

    /**
     * 应用源状态弹窗（统一 AppDialogs 风格，与全 app 弹窗一致）：
     * 进行中显示转圈 + 文案，可点「取消」或返回键手动关闭；
     * 成功后立即应用配置，显示「完成」并自动关闭（也可手动点按钮）；
     * 失败显示原因，可点「关闭」或稍候自动关闭。
     */
    private void showApplyDialog(String kind, String busyText, Runnable work, String successText, Runnable onSuccess) {
        final java.util.concurrent.atomic.AtomicBoolean applied = new java.util.concurrent.atomic.AtomicBoolean(false);
        final androidx.appcompat.app.AlertDialog dialog = AppDialogs.showProgress(this, 0, "应用" + kind, busyText, "取消", null);
        dialog.setCancelable(true);   // 进行中也可用返回键 / 点击外部手动关闭
        new Thread(() -> {
            try {
                work.run();
                main.post(() -> {
                    if (applied.compareAndSet(false, true)) onSuccess.run();   // 成功即应用配置
                    if (!dialog.isShowing()) return;
                    finishApplyDialog(dialog, successText, "完成");
                    main.postDelayed(() -> { if (dialog.isShowing()) dialog.dismiss(); }, 1600);   // 成功自动关闭
                });
            } catch (Throwable e) {
                main.post(() -> {
                    if (!dialog.isShowing()) return;
                    finishApplyDialog(dialog, "应用" + kind + "失败：" + String.valueOf(e), "关闭");
                    main.postDelayed(() -> { if (dialog.isShowing()) dialog.dismiss(); }, 4000);   // 失败稍候自动关闭
                });
            }
        }, "source-apply").start();
    }

    /** 结果状态：隐藏进度条、更新文案、只保留主按钮（完成/关闭）。 */
    private void finishApplyDialog(androidx.appcompat.app.AlertDialog dialog, String message, String buttonText) {
        android.widget.ProgressBar bar = dialog.findViewById(R.id.app_dialog_progress);
        if (bar != null) bar.setVisibility(View.GONE);
        android.widget.TextView msg = dialog.findViewById(R.id.app_dialog_message);
        if (msg != null) msg.setText(message);
        Button pos = dialog.findViewById(R.id.app_dialog_positive);
        Button neu = dialog.findViewById(R.id.app_dialog_neutral);
        Button neg = dialog.findViewById(R.id.app_dialog_negative);
        if (neu != null) neu.setVisibility(View.GONE);
        if (neg != null) neg.setVisibility(View.GONE);
        if (pos != null) {
            pos.setVisibility(View.VISIBLE);
            pos.setText(buttonText);
            pos.setOnClickListener(v -> dialog.dismiss());
        }
    }

    private boolean bad(String url) {
        if (url == null || url.trim().isEmpty() || !url.trim().startsWith("http")) {
            Toast.makeText(this, "请输入有效的源地址（http/https 开头）", Toast.LENGTH_SHORT).show();
            return true;
        }
        return false;
    }

    private String text(int id) {
        return ((EditText) findViewById(id)).getText().toString().trim();
    }

    private String currentOf(int id, String saved, String label) {
        String name = saved == null || saved.isEmpty() ? "未设置（默认）" : saved;
        return "当前：" + label + " → " + name;
    }

    private static String shell(String s) {
        return "'" + s.replace("'", "'\\''") + "'";
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
