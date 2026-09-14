package com.deepseekharness.app.ui;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.GravityCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.drawerlayout.widget.DrawerLayout;
import androidx.fragment.app.Fragment;

import com.deepseekharness.app.R;
import com.deepseekharness.app.core.ConfigStore;
import com.deepseekharness.app.core.HarnessController;
import com.google.android.material.bottomnavigation.BottomNavigationView;

/**
 * 主界面外壳：启动门禁 + 悬浮胶囊底部导航（启动 / 插件 / 终端）+ 顶栏
 * （汉堡侧边栏 + 固定 App 标题 + 主题纯图标按钮）。
 * 侧边栏 = 设置页全部功能入口（模块 / 更新 / 诊断 / 重新解压 / 镜像源），不再跳设置页。
 */
public class MainActivity extends AppCompatActivity {

    public static volatile MainActivity current;
    private com.deepseekharness.app.core.DshUpdater startupUpdates;
    private com.google.android.material.snackbar.Snackbar updateNotice;
    private boolean requestingLocalNetwork;
    private DrawerLayout drawer;
    private final androidx.activity.result.ActivityResultLauncher<String> localNetworkPermission =
            registerForActivityResult(new androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
                    granted -> {
                        requestingLocalNetwork = false;
                        if (granted) com.deepseekharness.app.bridge.LocalNetworkAccess.applyConfiguredFeatures(this);
                        else android.widget.Toast.makeText(this,
                                "未允许局域网访问；本机对话仍可使用，LAN / 无线 ADB 需在系统权限设置中开启",
                                android.widget.Toast.LENGTH_LONG).show();
                    });

    public void requestLocalNetwork() {
        if (com.deepseekharness.app.bridge.LocalNetworkAccess.granted(this)) {
            com.deepseekharness.app.bridge.LocalNetworkAccess.applyConfiguredFeatures(this);
        } else if (!requestingLocalNetwork) {
            requestingLocalNetwork = true;
            getSharedPreferences(com.deepseekharness.app.util.Constants.PREFS, MODE_PRIVATE)
                    .edit().putBoolean("local_network_permission_asked", true).apply();
            localNetworkPermission.launch(com.deepseekharness.app.bridge.LocalNetworkAccess.PERMISSION);
        }
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        ConfigStore config = new ConfigStore(this);
        HarnessController controller = HarnessController.get(this);
        boolean skipExtract = com.deepseekharness.app.BuildConfig.DEBUG && getIntent().getBooleanExtra("skip_extract", false);

        // 启动门禁：未欢迎 → Welcome；环境未解压 → Extract
        if (!config.isWelcomed()) {
            startActivity(new Intent(this, WelcomeActivity.class));
            finish();
            return;
        }
        if (com.deepseekharness.app.BackupManager.hasPendingMaintenance(controller)
                || !skipExtract && !controller.isEnvironmentReady()) {
            startActivity(new Intent(this, ExtractActivity.class));
            finish();
            return;
        }

        // 沉浸式状态栏：内容延伸到状态栏后面，顶栏渐变从屏幕顶部开始（与状态栏融合）。
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // 兜底：个别 ROM/环境不强制沉浸式时，状态栏颜色直接取顶栏渐变顶部色（card），
        // 保证状态栏与顶栏始终同色；强制沉浸式下该值会被系统忽略（透明）不影响内容延伸。
        getWindow().setStatusBarColor(getColor(R.color.card));

        setContentView(R.layout.activity_main);
        // 状态栏图标颜色随明暗（浅色背景深图标 / 深色背景浅图标）
        androidx.core.view.WindowInsetsControllerCompat wic =
                androidx.core.view.WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        wic.setAppearanceLightStatusBars(!ThemeController.isDark(this));
        applyEdgeInsets();

        String pendingLink = getSharedPreferences("deepseekharness-install-link", MODE_PRIVATE).getString("pending", "");
        if (!pendingLink.isEmpty()) {
            getSharedPreferences("deepseekharness-install-link", MODE_PRIVATE).edit().remove("pending").apply();
            try {
                com.deepseekharness.app.util.PluginInstallLink.parse(pendingLink);
                startActivity(new Intent(this, PluginInstallActivity.class).setData(android.net.Uri.parse(pendingLink)));
            } catch (IllegalArgumentException ignored) { }
        }

        // 主题切换：纯图标按钮（太阳 / 月亮），不显示文字。
        ImageView theme = findViewById(R.id.btn_theme);
        boolean dark = ThemeController.isDark(this);
        theme.setImageResource(dark ? R.drawable.ic_moon : R.drawable.ic_sun);
        theme.setContentDescription(dark ? "当前黑夜模式，点击切换白天" : "当前白天模式，点击切换黑夜");
        theme.setOnClickListener(v -> ThemeController.toggle(this));
        findViewById(R.id.sub_back).setOnClickListener(v -> getOnBackPressedDispatcher().onBackPressed());
        buildDrawer();
        // 抽屉打开时返回键先关抽屉，再走默认（退出/子页返回）。
        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (drawer != null && drawer.isDrawerOpen(GravityCompat.START)) {
                    drawer.closeDrawer(GravityCompat.START);
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
        getSupportFragmentManager().addOnBackStackChangedListener(this::updateToolbar);
        getSupportFragmentManager().registerFragmentLifecycleCallbacks(new androidx.fragment.app.FragmentManager.FragmentLifecycleCallbacks() {
            @Override public void onFragmentResumed(androidx.fragment.app.FragmentManager manager, Fragment fragment) { updateToolbar(); }
        }, false);

        BottomNavigationView nav = findViewById(R.id.bottom_nav);
        nav.setOnItemSelectedListener(item -> {
            if (!getSupportFragmentManager().isStateSaved())
                getSupportFragmentManager().popBackStackImmediate(null, androidx.fragment.app.FragmentManager.POP_BACK_STACK_INCLUSIVE);
            Fragment f;
            int id = item.getItemId();
            if (id == R.id.nav_launch) {
                f = new LaunchFragment();
            } else if (id == R.id.nav_plugins) {
                f = new PluginFragment();
                if (getIntent().getBooleanExtra("open_plugins", false)) {
                    Bundle args = new Bundle(); args.putBoolean("show_installed", true); f.setArguments(args);
                    getIntent().removeExtra("open_plugins");
                }
            } else {
                // 终端：默认挂真 PTY 页（vim/htop/tmux 能跑），可在 PTY 页切回简易版
                f = PtyTerminalFragment.preferred(this)
                        ? new PtyTerminalFragment() : new TerminalFragment();
            }
            getSupportFragmentManager().beginTransaction()
                    .replace(R.id.fragment_container, f)
                    .commit();
            return true;
        });

        if (savedInstanceState == null) {
            nav.setSelectedItemId(getIntent().getBooleanExtra("open_plugins", false) ? R.id.nav_plugins : R.id.nav_launch);
        }
        // 只订阅后台检查；提示不切换导航，也不自动打开更新页或 Web。
        startupUpdates = com.deepseekharness.app.core.DshUpdater.get(this);
        startupUpdates.state().observe(this, state -> showStartupUpdate());
        startupUpdates.checkOnStartup(config.isCheckUpdate());
    }

    /** 沉浸式 insets：状态栏区域强制显示顶栏色(card) + 顶栏 padding 按实际位置自适应。
     *  DrawerLayout/系统可能把主内容推到状态栏下方（上方露出主体灰），这里在窗口最顶层加
     *  一条「状态栏高度×全宽」的覆盖层，颜色取顶栏渐变顶部色，保证状态栏与顶栏完全同色。 */
    private void applyEdgeInsets() {
        // 状态栏同色覆盖层：加在 DecorView 顶层（z 最高），不受任何布局推挤影响。
        View cover = new View(this);
        cover.setBackgroundColor(getColor(R.color.card));
        ((ViewGroup) getWindow().getDecorView()).addView(cover, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 1));
        cover.post(() -> {
            androidx.core.view.WindowInsetsCompat insets =
                    androidx.core.view.ViewCompat.getRootWindowInsets(getWindow().getDecorView());
            int sb = insets != null
                    ? insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.statusBars()).top
                    : statusBarHeightRes();
            ViewGroup.LayoutParams lp = cover.getLayoutParams();
            lp.height = sb;
            cover.setLayoutParams(lp);
            cover.setBackgroundColor(getColor(R.color.card));
        });

        View appBar = findViewById(R.id.app_bar);
        View navWrap = findViewById(R.id.bottom_nav_wrap);
        appBar.post(() -> {
            androidx.core.view.WindowInsetsCompat insets =
                    androidx.core.view.ViewCompat.getRootWindowInsets(getWindow().getDecorView());
            int sb = insets != null
                    ? insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.statusBars()).top
                    : statusBarHeightRes();
            int[] loc = new int[2];
            appBar.getLocationInWindow(loc);
            int need = Math.max(0, sb - loc[1]);
            appBar.setPadding(appBar.getPaddingLeft(), need,
                    appBar.getPaddingRight(), appBar.getPaddingBottom());
            if (navWrap != null) {
                int nb = insets != null
                        ? insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.navigationBars()).bottom
                        : 0;
                int winH = getWindow().getDecorView().getHeight();
                navWrap.getLocationInWindow(loc);
                int overhang = (loc[1] + navWrap.getHeight()) - (winH - nb);
                int keep = getResources().getDimensionPixelSize(R.dimen.nav_pad_y);
                if (overhang > 0) keep = Math.max(keep, overhang);
                navWrap.setPadding(navWrap.getPaddingLeft(), navWrap.getPaddingTop(),
                        navWrap.getPaddingRight(), keep);
            }
        });
    }

    private int statusBarHeightRes() {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : 0;
    }

    private void showStartupUpdate() {
        if (startupUpdates == null || updateNotice != null || isFinishing() || !hasWindowFocus()
                || !getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)
                || !new ConfigStore(this).isCheckUpdate()) return;
        String latest = startupUpdates.startupNotice();
        if (latest == null) return;
        updateNotice = com.google.android.material.snackbar.Snackbar.make(findViewById(android.R.id.content),
                "发现新版本 " + latest + " · DeepSeek Harness",
                com.google.android.material.snackbar.Snackbar.LENGTH_LONG)
                .setAnchorView(R.id.bottom_nav)
                .setAction("查看更新", view -> startActivity(new Intent(this, UpdateActivity.class)));
        updateNotice.addCallback(new com.google.android.material.snackbar.Snackbar.Callback() {
            @Override public void onShown(com.google.android.material.snackbar.Snackbar bar) {
                if (hasWindowFocus() && getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED))
                    startupUpdates.markStartupNoticeShown();
            }
            @Override public void onDismissed(com.google.android.material.snackbar.Snackbar bar, int event) {
                if (updateNotice == bar) updateNotice = null;
            }
        });
        updateNotice.show();
    }

    @Override protected void onPostResume() {
        super.onPostResume();
        showStartupUpdate();
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) showStartupUpdate();
    }

    @Override protected void onPause() {
        if (updateNotice != null) { updateNotice.dismiss(); updateNotice = null; }
        super.onPause();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        BottomNavigationView nav = findViewById(R.id.bottom_nav);
        if (nav != null && intent.getBooleanExtra("open_plugins", false)) nav.setSelectedItemId(R.id.nav_plugins);
        if (nav != null && intent.getBooleanExtra("open_launch", false)) {
            intent.removeExtra("open_launch"); nav.setSelectedItemId(R.id.nav_launch);
        }
    }

    private void updateToolbar() {
        TextView title = findViewById(R.id.app_title);
        if (title == null) return;
        Fragment shown = getSupportFragmentManager().findFragmentById(R.id.fragment_container);
        boolean nested = getSupportFragmentManager().getBackStackEntryCount() > 0;
        // 子页：显示返回箭头、隐藏汉堡；主界面反之。
        findViewById(R.id.sub_back).setVisibility(nested ? android.view.View.VISIBLE : android.view.View.GONE);
        findViewById(R.id.btn_menu).setVisibility(nested ? android.view.View.GONE : android.view.View.VISIBLE);
        if (!nested) { title.setText(R.string.app_name); return; }
        if (shown instanceof ConfigFragment) title.setText("配置");
        else if (shown instanceof WorkspaceFragment) title.setText("数据与备份");
        else if (shown instanceof InstallFragment) title.setText("安装与修复");
        else if (shown instanceof SettingsFragment) title.setText("设置");
        else title.setText(R.string.app_name);
    }

    // ===================== 侧边栏（设置全部功能入口） =====================

    private void buildDrawer() {
        drawer = findViewById(R.id.drawer_layout);
        findViewById(R.id.btn_menu).setOnClickListener(v -> drawer.openDrawer(GravityCompat.START));
        ((EdgeSwipeLayout) findViewById(R.id.main_content)).attachDrawer(drawer);
        LinearLayout panel = findViewById(R.id.drawer_panel);
        panel.addView(buildDrawerHeader());
        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(0, 0, 0, dp(16));
        body.addView(buildDrawerSection("模块"));
        body.addView(buildDrawerRow(R.drawable.ic_build, "安装", "安装与修复运行环境", () -> openChild(new InstallFragment())));
        body.addView(buildDrawerRow(R.drawable.ic_settings, "配置", "接口、行为与权限", () -> openChild(new ConfigFragment())));
        body.addView(buildDrawerRow(R.drawable.ic_backup, "数据与备份", "备份恢复 · 文件共享", () -> openChild(new WorkspaceFragment())));
        body.addView(buildDrawerSection("其他"));
        body.addView(buildDrawerRow(R.drawable.ic_update, "更新 DeepSeek Harness", "从 GitHub Releases 获取最新版本",
                () -> startActivity(new Intent(this, UpdateActivity.class))));
        body.addView(buildDrawerRow(R.drawable.ic_description, "诊断与日志", "下载错误日志 · 环境检查 · 故障修复",
                () -> startActivity(new Intent(this, DiagnosticActivity.class))));
        body.addView(buildDrawerRow(R.drawable.ic_unarchive, "重新解压", "dsh / npm 损坏时用；配置与对话记录会保留",
                () -> SettingsFragment.confirmReextract(this)));
        body.addView(buildDrawerRow(R.drawable.ic_dns, "镜像与源", "npm · Ubuntu 软件包(APT) · pip 镜像切换",
                () -> startActivity(new Intent(this, SourceSettingsActivity.class))));
        body.addView(buildDrawerSection("关于"));
        body.addView(buildDrawerRow(R.drawable.ic_info, "关于软件", "免费声明 · 交流群 · 开发者", this::showAboutDialog));
        scroll.addView(body);
        panel.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        panel.addView(buildDrawerFooter());
    }

    /** 从侧边栏压栈打开子页（返回箭头可回主界面）。 */
    private void openChild(Fragment f) {
        if (getSupportFragmentManager().isStateSaved()) return;
        getSupportFragmentManager().beginTransaction()
                .replace(R.id.fragment_container, f)
                .addToBackStack("settings")
                .commit();
    }

    private View buildDrawerHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setBackgroundResource(R.drawable.bg_bar);
        header.setPadding(dp(20), dp(24), dp(20), dp(20));
        // 软件 Logo：直接用应用图标（自适应图标自带圆角与配色）。
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        header.addView(logo, new LinearLayout.LayoutParams(dp(40), dp(40)));
        // 侧边栏 header 背景与主顶栏一致（按实际位置自适应状态栏 padding）。
        header.post(() -> {
            androidx.core.view.WindowInsetsCompat insets =
                    androidx.core.view.ViewCompat.getRootWindowInsets(getWindow().getDecorView());
            int sb = insets != null
                    ? insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.statusBars()).top
                    : statusBarHeightRes();
            int[] loc = new int[2];
            header.getLocationInWindow(loc);
            int need = Math.max(0, sb - loc[1]);
            header.setPadding(header.getPaddingLeft(), dp(24) + need,
                    header.getPaddingRight(), header.getPaddingBottom());
        });
        TextView name = new TextView(this);
        name.setText(R.string.app_name);
        name.setTextSize(20);
        name.setTextColor(getColor(R.color.text));
        name.setTypeface(name.getTypeface(), android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams np = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        np.topMargin = dp(12);
        header.addView(name, np);
        TextView ver = new TextView(this);
        ver.setTextSize(13);
        ver.setTextColor(getColor(R.color.text_muted));
        ver.setText("v" + appVersion());
        LinearLayout.LayoutParams vp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        vp.topMargin = dp(2);
        header.addView(ver, vp);
        return header;
    }

    private TextView buildDrawerSection(String text) {
        TextView label = new TextView(this);
        label.setText(text);
        label.setTextSize(13);
        label.setTextColor(getColor(R.color.text_secondary));
        label.setTypeface(label.getTypeface(), android.graphics.Typeface.BOLD);
        label.setPadding(dp(20), dp(16), dp(20), dp(4));
        return label;
    }

    private LinearLayout buildDrawerRow(int iconRes, String title, String sub, Runnable action) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(16), dp(12), dp(16), dp(12));
        row.setMinimumHeight(dp(64));
        row.setFocusable(true);
        android.util.TypedValue tv = new android.util.TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackground, tv, true);
        row.setBackgroundResource(tv.resourceId);
        row.setContentDescription("侧边栏-" + title);

        ImageView icon = new ImageView(this);
        icon.setImageResource(iconRes);
        icon.setImageTintList(android.content.res.ColorStateList.valueOf(getColor(R.color.text_secondary)));
        icon.setBackgroundResource(R.drawable.bg_chip);
        icon.setPadding(dp(7), dp(7), dp(7), dp(7));
        icon.setImportantForAccessibility(android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        row.addView(icon, new LinearLayout.LayoutParams(dp(32), dp(32)));

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams bodyParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bodyParams.leftMargin = dp(12);
        bodyParams.rightMargin = dp(8);
        body.setLayoutParams(bodyParams);

        TextView t = new TextView(this);
        t.setText(title);
        t.setTextSize(15);
        t.setTextColor(getColor(R.color.text));
        t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        body.addView(t);

        TextView s = new TextView(this);
        s.setText(sub);
        s.setTextSize(13);
        s.setTextColor(getColor(R.color.text_muted));
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        slp.topMargin = dp(2);
        s.setLayoutParams(slp);
        body.addView(s);

        TextView chev = new TextView(this);
        chev.setText("›");
        chev.setTextSize(18);
        chev.setTextColor(getColor(R.color.text_muted));
        row.addView(body);
        row.addView(chev);
        row.setOnClickListener(v -> {
            action.run();
            drawer.closeDrawer(GravityCompat.START);
        });
        return row;
    }

    private View buildDrawerFooter() {
        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.VERTICAL);
        footer.setPadding(dp(16), dp(8), dp(16), dp(12));
        com.google.android.material.materialswitch.MaterialSwitch eco =
                new com.google.android.material.materialswitch.MaterialSwitch(this);
        eco.setText("省电模式");
        eco.setTextSize(15);
        eco.setMinHeight(dp(48));
        eco.setPadding(dp(16), dp(8), dp(16), dp(4));
        ConfigStore config = HarnessController.get(this).config();
        eco.setChecked(config.isEcoMode());
        footer.addView(eco);
        TextView hint = new TextView(this);
        hint.setTextSize(13);
        hint.setTextColor(getColor(R.color.text_muted));
        hint.setPadding(dp(16), 0, dp(16), dp(8));
        java.util.function.Consumer<Boolean> describe = enabled -> hint.setText(enabled
                ? "熄屏空闲 1 分钟后减少保活；有任务时继续运行。"
                : "持续保持运行，适合长时间任务。");
        describe.accept(config.isEcoMode());
        eco.setOnCheckedChangeListener((button, checked) -> {
            config.setEcoMode(checked);
            com.deepseekharness.app.HarnessService.refreshPowerMode();
            describe.accept(checked);
        });
        footer.addView(hint);
        TextView ver = new TextView(this);
        ver.setTextSize(12);
        ver.setTextColor(getColor(R.color.text_muted));
        ver.setGravity(Gravity.CENTER);
        ver.setTypeface(android.graphics.Typeface.MONOSPACE);
        ver.setText("DeepSeek Harness v" + appVersion() + " · MIT License");
        footer.addView(ver);
        return footer;
    }

    /** 开源仓库地址：本项目 GitHub 仓库。 */
    private static final String OPEN_SOURCE_URL = "https://github.com/xliaoy/DeepSeekHarness";
    private static final String QQ_GROUP_JOIN = "https://qun.qq.com/universal-share/share?ac=1&authKey=IyxMq0rBXUREnVUtSJMWRHygUKhtHcer%2BoqN2Y8zXyNFxkwergsqsQU1sxD98M40&busi_data=eyJncm91cENvZGUiOiIxMTI1MzkzOTUyIiwidG9rZW4iOiIydnRIZE9CVGF1OHVkRHVLM00xMXhzMnVGYWdGb2hMNjNjRDlaQUJWUjkxVkRMcE5kUTY5aENMWVFsdGtxSkJTIiwidWluIjoiMzQ0NTc5MDk1OCJ9&data=pH25LUAofBHc-HFdejNWLW2FDxq8JdM9XEkwpQFQKwN-sRJMb1-K6o1gWRTpjLtBWD7oh3FhlCfpswttZfMGwQ&svctype=4&tempid=h5_group_info";
    private static final String QQ_DEV_JOIN = "https://qm.qq.com/q/yVTeGUfLjy";

    /** 关于软件：免费声明 + 应用信息 + 开源地址 + 打赏 / 交流群 / 开发者。 */
    private void showAboutDialog() {
        String msg = "DeepSeek Harness 手机端（DSHA 二开版）\n\n"
                + "本软件完全免费开源，不收取任何费用，也没有会员、内购或任何付费功能。\n"
                + "如果你是通过付费购买获得本软件，说明你被骗了，请立即退款，并到官方交流群反馈。\n\n"
                + "应用名称：DeepSeek Harness\n"
                + "包名：" + getPackageName() + "\n"
                + "版本：v" + appVersion() + "\n"
                + "开源地址：" + OPEN_SOURCE_URL + "\n\n"
                + "交流QQ群：1125393952\n"
                + "开发者QQ：3445790958";
        AppDialogs.show(this, R.drawable.ic_info, "关于 DeepSeek Harness", msg,
                "打赏支持", "加入交流群", "关闭",
                this::showDonateDialog, () -> openUrl(QQ_GROUP_JOIN), null);
    }

    /** 打赏支持：微信 / 支付宝收款码（图片取自 drawable-nodpi/donate_*，替换资源后重打包即生效）。 */
    private void showDonateDialog() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        int size = dp(130);

        LinearLayout wechatCol = new LinearLayout(this);
        wechatCol.setOrientation(LinearLayout.VERTICAL);
        wechatCol.setGravity(Gravity.CENTER_HORIZONTAL);
        ImageView wechat = new ImageView(this);
        wechat.setImageResource(R.drawable.donate_wechat);
        wechat.setScaleType(ImageView.ScaleType.FIT_CENTER);
        wechatCol.addView(wechat, new LinearLayout.LayoutParams(size, size));
        TextView wl = new TextView(this);
        wl.setText("微信");
        wl.setTextSize(13);
        wl.setTextColor(getColor(R.color.text_muted));
        wl.setGravity(Gravity.CENTER);
        wechatCol.addView(wl, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams wcp = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        wcp.leftMargin = dp(8);
        wcp.rightMargin = dp(4);
        wechatCol.setLayoutParams(wcp);

        LinearLayout alipayCol = new LinearLayout(this);
        alipayCol.setOrientation(LinearLayout.VERTICAL);
        alipayCol.setGravity(Gravity.CENTER_HORIZONTAL);
        ImageView alipay = new ImageView(this);
        alipay.setImageResource(R.drawable.donate_alipay);
        alipay.setScaleType(ImageView.ScaleType.FIT_CENTER);
        alipayCol.addView(alipay, new LinearLayout.LayoutParams(size, size));
        TextView al = new TextView(this);
        al.setText("支付宝");
        al.setTextSize(13);
        al.setTextColor(getColor(R.color.text_muted));
        al.setGravity(Gravity.CENTER);
        alipayCol.addView(al, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams acp = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        acp.leftMargin = dp(4);
        acp.rightMargin = dp(8);
        alipayCol.setLayoutParams(acp);

        row.addView(wechatCol);
        row.addView(alipayCol);
        AppDialogs.showCustom(this, R.drawable.ic_info, "打赏支持（自愿）", row,
                "开发者QQ", "关闭", () -> openUrl(QQ_DEV_JOIN));
    }

    private void openUrl(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)));
        } catch (Throwable t) {
            android.widget.Toast.makeText(this, "无法打开链接", android.widget.Toast.LENGTH_SHORT).show();
        }
    }

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception ignored) {
            return "unknown";
        }
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onResume() {
        super.onResume();
        current = this;
        updateToolbar();
        if (!isFinishing() && findViewById(R.id.bottom_nav) != null
                && (new ConfigStore(this).isLanMode()
                || com.deepseekharness.app.DeviceBridgeService.isAdbEnabled(this))
                && !com.deepseekharness.app.bridge.LocalNetworkAccess.granted(this)
                && !getSharedPreferences(com.deepseekharness.app.util.Constants.PREFS, MODE_PRIVATE)
                .getBoolean("local_network_permission_asked", false)) requestLocalNetwork();
        // Android 12+ 可能拒绝后台唤起前台服务，回到可见界面后补一次恢复。
        if (!isFinishing() && findViewById(R.id.bottom_nav) != null
                && com.deepseekharness.app.DeviceBridgeService.isAdbEnabled(this)
                && !com.deepseekharness.app.DeviceBridgeService.isRunning()) {
            com.deepseekharness.app.DeviceBridgeService.apply(this);
        }
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        // 主题切换/旋转只重建界面，不能把正在运行的终端一起关闭。
        if (!isChangingConfigurations()) {
            try {
                PtyTerminalFragment.shutdown();
            } catch (Throwable ignored) {
            }
            try {
                TerminalFragment.shutdownShell();
            } catch (Throwable ignored) {
            }
        }
        super.onDestroy();
    }

    public static void start(Context ctx) {
        ctx.startActivity(new Intent(ctx, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
    }
}