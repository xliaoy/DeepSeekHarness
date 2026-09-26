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
import androidx.drawerlayout.widget.DrawerLayout;
import androidx.fragment.app.Fragment;

import com.deepseekharness.app.R;
import com.deepseekharness.app.core.ConfigStore;
import com.deepseekharness.app.core.HarnessController;
import com.google.android.material.bottomnavigation.BottomNavigationView;

/**
 * 主界面外壳：启动门禁 + 侧边栏（设置全部入口）+ 底部导航（启动 / 插件 / 设置 / 终端）+ 顶栏标题 + 关于入口。
 */
public class MainActivity extends AppCompatActivity {

    public static volatile MainActivity current;
    private com.deepseekharness.app.core.UpdateEngine startupUpdates;
    private com.google.android.material.snackbar.Snackbar updateNotice;
    private boolean requestingLocalNetwork;
    private boolean restoreProbeStarted;
    /** 侧边栏（DrawerLayout）：窄屏靠左，宽屏（>=600dp）靠右并加宽面板。 */
    private DrawerLayout drawer;
    private boolean wideScreen;
    private int drawerGravity = GravityCompat.START;
    /**
     * 通知点击带来的「进入后自动打开 Web」意图，只在一次导航创建 LaunchFragment 期间有效。
     *
     * <p>必须在 {@code setSelectedItemId} 触发监听器之前置位、在创建时立刻消费掉，
     * 否则会残留下来，让用户之后手动点启动页时被意外带进 Web。
     */
    private boolean pendingOpenWeb;
    private String openedRecovery="";
    private final androidx.activity.result.ActivityResultLauncher<String> localNetworkPermission =
            registerForActivityResult(new androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
                    granted -> {
                        requestingLocalNetwork = false;
                        if (granted) com.deepseekharness.app.bridge.LocalNetworkAccess.applyConfiguredFeatures(this);
                        else android.widget.Toast.makeText(this,
                                com.deepseekharness.app.util.UiText.text("未允许局域网访问；本机对话仍可使用，LAN / 无线 ADB 需在系统权限设置中开启"),
                                android.widget.Toast.LENGTH_LONG).show();
                    });
    private final androidx.activity.result.ActivityResultLauncher<String[]> legacyBackupPicker =
            registerForActivityResult(new androidx.activity.result.contract.ActivityResultContracts.OpenDocument(), uri -> {
                if (uri != null) openBackupForRestore(uri);
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

        if(savedInstanceState!=null)openedRecovery=savedInstanceState.getString("opened_startup_recovery","");
        ConfigStore config = new ConfigStore(this);
        HarnessController controller = HarnessController.get(this);
        boolean skipExtract = com.deepseekharness.app.BuildConfig.DEBUG && getIntent().getBooleanExtra("skip_extract", false);

        // 启动门禁：未欢迎 → Welcome；环境未解压 → Extract
        if (!config.isWelcomed()) {
            startActivity(new Intent(this, WelcomeActivity.class));
            finish();
            return;
        }
        boolean limitedAllowed = getIntent().getBooleanExtra("limited_entry", false)
                || config.allowsLimitedEntry(controller.proot().environmentIdentity());
        if (!limitedAllowed && (com.deepseekharness.app.BackupManager.hasPendingMaintenance(controller)
                || !skipExtract && (!controller.isEnvironmentReady()||com.deepseekharness.app.core.EnvironmentAccess.shouldAttemptRuntimeUpdate(controller)))) {
            startActivity(new Intent(this, ExtractActivity.class));
            finish();
            return;
        }

        // 沉浸式状态栏：内容延伸到状态栏后面，顶栏渐变从屏幕顶部开始（与状态栏融合）。
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // 兜底：个别 ROM/环境不强制沉浸式时，状态栏颜色直接取顶栏渐变顶部色（card），
        // 保证状态栏与顶栏始终同色；强制沉浸式下该值会被系统忽略（透明）不影响内容延伸。
        getWindow().setStatusBarColor(getColor(R.color.card));

        com.deepseekharness.app.ui.LanguageController.apply(this);
        setContentView(R.layout.activity_main);
        // 状态栏图标颜色随明暗（浅色背景深图标 / 深色背景浅图标）
        androidx.core.view.WindowInsetsControllerCompat wic =
                androidx.core.view.WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        wic.setAppearanceLightStatusBars(!ThemeController.isDark(this));
        applyEdgeInsets();
        findViewById(R.id.btn_tasks).setContentDescription(com.deepseekharness.app.util.UiText.choose("后台任务","Background tasks"));
        findViewById(R.id.btn_tasks).setOnClickListener(v->BackgroundTasksActivity.open(this));
        TextView recovery = findViewById(R.id.environment_recovery_banner);
        recovery.setOnClickListener(v -> {
            if(com.deepseekharness.app.core.BackupTask.get(this).maintenanceBusy()||BackgroundTasksActivity.busy(this))BackgroundTasksActivity.open(this);
            else startActivity(new Intent(this, ExtractActivity.class).putExtra("review_only", true));
        });
        String pendingLink = getSharedPreferences("deepseekharness-install-link", MODE_PRIVATE).getString("pending", "");
        if (!pendingLink.isEmpty() && !com.deepseekharness.app.core.EnvironmentAccess.needsRecovery(controller)) {
            getSharedPreferences("deepseekharness-install-link", MODE_PRIVATE).edit().remove("pending").apply();
            try {
                com.deepseekharness.app.util.PluginInstallLink.parse(pendingLink);
                startActivity(new Intent(this, PluginInstallActivity.class).setData(android.net.Uri.parse(pendingLink)));
            } catch (IllegalArgumentException ignored) { }
        }

        TextView title = findViewById(R.id.app_title);
        TextView theme = findViewById(R.id.btn_theme);
        boolean dark = ThemeController.isDark(this);
        theme.setText("");
        theme.setCompoundDrawablesWithIntrinsicBounds(dark?R.drawable.ic_ui2_sun:R.drawable.ic_ui2_moon,0,0,0);
        theme.setContentDescription(dark ? com.deepseekharness.app.util.UiText.text("当前黑夜模式，点击切换白天") : com.deepseekharness.app.util.UiText.text("当前白天模式，点击切换黑夜"));
        theme.setOnClickListener(v -> ThemeController.toggle(this));
        findViewById(R.id.sub_back).setOnClickListener(v -> getOnBackPressedDispatcher().onBackPressed());
        getSupportFragmentManager().addOnBackStackChangedListener(this::updateToolbar);
        getSupportFragmentManager().registerFragmentLifecycleCallbacks(new androidx.fragment.app.FragmentManager.FragmentLifecycleCallbacks() {
            @Override public void onFragmentResumed(androidx.fragment.app.FragmentManager manager, Fragment fragment) { updateToolbar(); }
        }, false);
        findViewById(R.id.btn_about).setOnClickListener(v -> AboutDialog.show(this));

        buildDrawer();
        // 抽屉打开时返回键先关抽屉，再走默认（退出 / 子页返回）。
        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (drawer != null && drawer.isDrawerOpen(drawerGravity)) {
                    drawer.closeDrawer(drawerGravity);
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });

        BottomNavigationView nav = findViewById(R.id.bottom_nav);
        nav.setOnItemSelectedListener(item -> {
            // 当前根页面再次点选时保留输入和滚动；从子页返回或外部打开插件仍执行导航。
            if (nav.getSelectedItemId()==item.getItemId()
                    && getSupportFragmentManager().getBackStackEntryCount()==0
                    && getSupportFragmentManager().findFragmentById(R.id.fragment_container)!=null
                    && !(getSupportFragmentManager().findFragmentById(R.id.fragment_container) instanceof EnvironmentRecoveryFragment)
                    && !getIntent().getBooleanExtra("open_plugins",false)) return true;
            if (!getSupportFragmentManager().isStateSaved())
                getSupportFragmentManager().popBackStackImmediate(null, androidx.fragment.app.FragmentManager.POP_BACK_STACK_INCLUSIVE);
            Fragment f;
            int id = item.getItemId();
            if (id == R.id.nav_launch) {
                f = new LaunchFragment();
                if (pendingOpenWeb) {
                    pendingOpenWeb = false;
                    Bundle args = new Bundle();
                    args.putBoolean(LaunchFragment.ARG_OPEN_WEB, true);
                    f.setArguments(args);
                }
                title.setText("DeepSeekHarness");
            } else if (id == R.id.nav_plugins) {
                f = com.deepseekharness.app.core.EnvironmentAccess.needsRecovery(controller)
                        ? new EnvironmentRecoveryFragment() : new PluginFragment();
                if (getIntent().getBooleanExtra("open_plugins", false)) {
                    Bundle args = new Bundle(); args.putBoolean("show_installed", true); f.setArguments(args);
                    getIntent().removeExtra("open_plugins");
                }
                title.setText("DeepSeekHarness");
            } else {
                // 终端：默认挂真 PTY 页（vim/htop/tmux 能跑），可在 PTY 页切回简易版
                f = com.deepseekharness.app.core.EnvironmentAccess.needsRecovery(controller) ? new EnvironmentRecoveryFragment() : PtyTerminalFragment.preferred(this)
                        ? new PtyTerminalFragment() : new TerminalFragment();
                title.setText("DeepSeekHarness");
            }
            UiMotion.page(this, getSupportFragmentManager().beginTransaction())
                    .replace(R.id.fragment_container, f)
                    .commit();
            return true;
        });

        // 通知点击进入：必须在 setSelectedItemId 之前登记 —— setSelectedItemId 会【同步】
        // 触发监听器创建 LaunchFragment，那时再置标记已经晚了（参数带不进去）。
        consumeOpenWeb(getIntent());
        if (savedInstanceState == null) {
            nav.setSelectedItemId(getIntent().getBooleanExtra("open_plugins", false) ? R.id.nav_plugins : R.id.nav_launch);
        }
        consumeTaskTarget(getIntent());
        // 只订阅后台检查；提示不切换导航，也不自动打开更新页或 Web。
        startupUpdates = com.deepseekharness.app.core.UpdateEngine.get(this);
        startupUpdates.state().observe(this, state -> showStartupUpdate());
        startupUpdates.checkOnStartup(config.isCheckUpdate());
    }

    private void showStartupUpdate() {
        if (startupUpdates == null || updateNotice != null || isFinishing() || !hasWindowFocus()
                || !getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)
                || !new ConfigStore(this).isCheckUpdate()) return;
        com.deepseekharness.app.util.UpdatePolicy.Release release = startupUpdates.startupNotice();
        if (release == null) return;
        updateNotice = com.google.android.material.snackbar.Snackbar.make(findViewById(android.R.id.content),
                com.deepseekharness.app.util.UiText.text("发现新版本 ") + release.version + " · " + com.deepseekharness.app.core.UpdateEngine.channelName(startupUpdates.channel()),
                com.google.android.material.snackbar.Snackbar.LENGTH_LONG)
                .setAnchorView(R.id.bottom_nav)
                .setAction(com.deepseekharness.app.util.UiText.text("查看更新"), view -> startActivity(new Intent(this, UpdateActivity.class)));
        updateNotice.addCallback(new com.google.android.material.snackbar.Snackbar.Callback() {
            @Override public void onShown(com.google.android.material.snackbar.Snackbar bar) {
                if (hasWindowFocus() && getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED))
                    startupUpdates.markStartupNoticeShown(release);
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
        recoveryHandler.removeCallbacks(refreshRecovery);
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
        consumeOpenWeb(intent);
        consumeTaskTarget(intent);
    }

    private void consumeTaskTarget(Intent intent) {
        BottomNavigationView nav=findViewById(R.id.bottom_nav);if(nav==null)return;
        if(intent.getBooleanExtra("open_terminal",false)){intent.removeExtra("open_terminal");nav.setSelectedItemId(R.id.nav_terminal);}
        if(intent.getBooleanExtra("open_install",false)){
            // 设置类入口已全部移入侧边栏，底栏不再有 nav_settings 这一项。
            // 这里本来只是借 nav_settings 当"底栏基准项"，紧接着就 replace 成 InstallFragment，
            // 所以改挂 nav_launch：语义不变（都是设置类子页），且不会出现"没有选中项"的底栏状态。
            intent.removeExtra("open_install");nav.setSelectedItemId(R.id.nav_launch);
            UiMotion.page(this,getSupportFragmentManager().beginTransaction()).replace(R.id.fragment_container,new InstallFragment()).addToBackStack("settings").commit();
        }
    }

    /**
     * 消费通知/外部的 {@code open_web} 意图：切到启动页，并把「进来后自动进 Web」的意图
     * 交给 {@link LaunchFragment}（只有它知道鉴权是否就绪）。
     *
     * <p>时序很关键：{@code setSelectedItemId} 会<b>同步</b>触发
     * {@code OnItemSelectedListener} 去创建 fragment，所以标记必须在那之前设好；
     * 否则 fragment 已经建完，参数永远带不进去（表现为"点了通知没反应"）。
     *
     * <p>Web 未就绪时（例如服务刚被系统回收）只切页不报错：停在启动页让用户看到真实状态，
     * 比弹一个必然失败的错误更合适。
     */
    private void consumeOpenWeb(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("open_web", false)) return;
        intent.removeExtra("open_web");
        BottomNavigationView nav = findViewById(R.id.bottom_nav);
        if (nav == null) return;
        pendingOpenWeb = true;
        if (nav.getSelectedItemId() != R.id.nav_launch) {
            nav.setSelectedItemId(R.id.nav_launch);
            return;
        }
        // 已经停在启动页（通知点击时 App 可能就在启动页）：不会触发监听器，
        // 直接把意图交给当前这个 LaunchFragment；没有就等下次创建。
        getSupportFragmentManager().executePendingTransactions();
        Fragment shown = getSupportFragmentManager().findFragmentById(R.id.fragment_container);
        if (shown instanceof LaunchFragment) {
            pendingOpenWeb = false;
            ((LaunchFragment) shown).requestAutoEnterWeb();
        }
    }

    private void updateToolbar() {
        TextView title = findViewById(R.id.app_title);
        if (title == null) return;
        Fragment shown = getSupportFragmentManager().findFragmentById(R.id.fragment_container);
        boolean nested = getSupportFragmentManager().getBackStackEntryCount() > 0;
        findViewById(R.id.sub_back).setVisibility(nested ? android.view.View.VISIBLE : android.view.View.GONE);
        findViewById(R.id.app_logo).setVisibility(nested ? android.view.View.GONE : android.view.View.VISIBLE);
        // 子页显示返回箭头、隐藏汉堡（抽屉入口只在主界面出现），与底栏主/子页状态一致。
        findViewById(R.id.btn_menu).setVisibility(nested ? android.view.View.GONE : android.view.View.VISIBLE);
        if (shown instanceof AboutFragment) title.setText(com.deepseekharness.app.util.UiText.choose("关于 DeepSeekHarness","About DeepSeekHarness"));
        else if (shown instanceof OverlayFragment) title.setText(com.deepseekharness.app.util.UiText.choose("悬浮条","Floating status"));
        else if (shown instanceof ConfigFragment) title.setText(R.string.ui2_runtime_config);
        else if (shown instanceof DeviceGrantsFragment) title.setText(com.deepseekharness.app.util.UiText.text("设备能力授权"));
        else if (shown instanceof WorkspaceFragment) title.setText(com.deepseekharness.app.util.UiText.text("数据与备份"));
        else if (shown instanceof InstallFragment) title.setText(R.string.ui2_environment_page);
        else if (shown instanceof SettingsFragment) title.setText("DeepSeekHarness");
        else if (shown instanceof PluginFragment) title.setText("DeepSeekHarness");
        else if (shown instanceof TerminalFragment || shown instanceof PtyTerminalFragment) title.setText("DeepSeekHarness");
        else title.setText("DeepSeekHarness");
    }

    // ===================== 侧边栏（设置入口，分类对齐官方） =====================

    /**
     * 打开「设置」页（原底栏 nav_settings 的入口，已整体移入侧边栏）。
     *
     * <p>为什么要有这个方法：底栏去掉设置项后，{@code R.id.nav_settings} 不再存在，
     * 外部（通知、Intent、验收脚本）不能再靠 {@code setSelectedItemId} 进设置页。
     * 统一从这里进，避免每个调用点各自拼一套侧边栏操作。
     */
    public void openSettings() {
        closeDrawerIfOpen();
        openChild(new SettingsFragment());
    }

    private void closeDrawerIfOpen() {
        DrawerLayout layout = findViewById(R.id.drawer_layout);
        if (layout != null && layout.isDrawerOpen(drawerGravity)) layout.closeDrawer(drawerGravity);
    }

    private void buildDrawer() {
        drawer = findViewById(R.id.drawer_layout);
        // 宽屏（平板 / 大屏折叠 / 横屏）：侧边栏靠右、面板加宽，避免窄条。
        wideScreen = getResources().getConfiguration().screenWidthDp >= 600;
        drawerGravity = wideScreen ? GravityCompat.END : GravityCompat.START;
        findViewById(R.id.btn_menu).setOnClickListener(v -> drawer.openDrawer(drawerGravity));
        ((EdgeSwipeLayout) findViewById(R.id.main_content)).attachDrawer(drawer, drawerGravity);
        LinearLayout panel = findViewById(R.id.drawer_panel);
        if (wideScreen) {
            // androidx drawerlayout 1.1.1 没有 setDrawerGravity 公开方法，直接改 LayoutParams。
            // DrawerLayout 在布局/查找时实时读取子 View 的 gravity，重新 setLayoutParams
            // 触发重排后左侧固定面板即移到右侧，开合与滑动按 drawerGravity(END) 进行。
            DrawerLayout.LayoutParams dlp = (DrawerLayout.LayoutParams) panel.getLayoutParams();
            dlp.gravity = GravityCompat.getAbsoluteGravity(drawerGravity, panel.getLayoutDirection())
                    | (dlp.gravity & Gravity.VERTICAL_GRAVITY_MASK);
            panel.setLayoutParams(dlp);
            ViewGroup.LayoutParams plp = panel.getLayoutParams();
            plp.width = dp(360);
            panel.setLayoutParams(plp);
        }
        panel.addView(buildDrawerHeader());
        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(0, 0, 0, dp(16));
        // 模块：与官方设置分类一致（安装 / 配置 / 数据与备份 / 设备能力授权）
        body.addView(buildDrawerSection(com.deepseekharness.app.util.UiText.text("模块")));
        body.addView(buildDrawerRow(R.drawable.ic_build, com.deepseekharness.app.util.UiText.text("检测修复"),
                com.deepseekharness.app.util.UiText.text("安装与修复运行环境"), () -> openChild(new InstallFragment())));
        body.addView(buildDrawerRow(R.drawable.ic_settings, com.deepseekharness.app.util.UiText.text("功能设置"),
                com.deepseekharness.app.util.UiText.text("接口、行为与权限"), () -> openChild(new ConfigFragment())));
        body.addView(buildDrawerRow(R.drawable.ic_settings, com.deepseekharness.app.util.UiText.text("设置"),
                com.deepseekharness.app.util.UiText.text("外观、语言与通用选项"), this::openSettings));
        body.addView(buildDrawerRow(R.drawable.ic_backup, com.deepseekharness.app.util.UiText.text("备份还原"),
                com.deepseekharness.app.util.UiText.text("备份恢复 · 文件共享"), () -> openChild(new WorkspaceFragment())));
        body.addView(buildDrawerRow(R.drawable.ic_plugin_scan, com.deepseekharness.app.util.UiText.text("权限配置"),
                "Root · Shizuku · Stellar · ADB · " + com.deepseekharness.app.util.UiText.text("权限"), () -> openChild(new DeviceGrantsFragment())));
        body.addView(buildDrawerSection(com.deepseekharness.app.util.UiText.text("其他")));
        body.addView(buildDrawerRow(R.drawable.ic_update, com.deepseekharness.app.util.UiText.text("在线更新"),
                com.deepseekharness.app.util.UiText.text("从 GitHub Releases 获取最新版本"),
                () -> startActivity(new Intent(this, UpdateActivity.class))));
        body.addView(buildDrawerRow(R.drawable.ic_description, com.deepseekharness.app.util.UiText.text("系统诊断"),
                com.deepseekharness.app.util.UiText.text("下载错误日志 · 环境检查 · 故障修复"),
                () -> startActivity(new Intent(this, DiagnosticActivity.class))));
        body.addView(buildDrawerRow(R.drawable.ic_unarchive, com.deepseekharness.app.util.UiText.text("系统修复"),
                com.deepseekharness.app.util.UiText.text("运行环境损坏时用；配置与对话记录会保留"),
                this::confirmSystemRepair));
        body.addView(buildDrawerRow(R.drawable.ic_dns, com.deepseekharness.app.util.UiText.text("镜像与源"),
                "npm · APT · pip " + com.deepseekharness.app.util.UiText.text("镜像切换"),
                () -> startActivity(new Intent(this, SourceSettingsActivity.class))));
        boolean langEn = "en".equals(new ConfigStore(this).getUiLanguage());
        body.addView(buildDrawerRow(R.drawable.ic_settings, com.deepseekharness.app.util.UiText.text("界面语言"),
                com.deepseekharness.app.util.UiText.text("当前：") + (langEn ? "English" : com.deepseekharness.app.util.UiText.text("中文")),
                this::showLanguageDialog));
        body.addView(buildDrawerRow(R.drawable.ic_info, com.deepseekharness.app.util.UiText.text("关于软件"),
                com.deepseekharness.app.util.UiText.text("免费声明 · 交流群 · 开发者"), this::showAboutDialog));
        scroll.addView(body);
        panel.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        panel.addView(buildDrawerFooter());
    }

    /** 从侧边栏压栈打开子页（返回箭头可回主界面）。切页动画走 UiMotion。 */
    private void openChild(Fragment f) {
        if (getSupportFragmentManager().isStateSaved()) return;
        UiMotion.page(this, getSupportFragmentManager().beginTransaction())
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
        // 行背景：Material ripple + 自绘聚焦态。关掉系统默认焦点黑框（触屏平板接键盘
        // 导航时会出现难看的黑框），键盘焦点提示改由 bg_drawer_row 的 state_focused 提供。
        row.setDefaultFocusHighlightEnabled(false);
        row.setBackgroundResource(R.drawable.bg_drawer_row);
        row.setContentDescription(com.deepseekharness.app.util.UiText.text("侧边栏-") + title);

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
            drawer.closeDrawer(drawerGravity);
        });
        return row;
    }

    private View buildDrawerFooter() {
        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.VERTICAL);
        footer.setPadding(dp(16), dp(8), dp(16), dp(12));
        com.google.android.material.materialswitch.MaterialSwitch eco =
                new com.google.android.material.materialswitch.MaterialSwitch(this);
        eco.setText(com.deepseekharness.app.util.UiText.text("省电模式"));
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
                ? com.deepseekharness.app.util.UiText.text("熄屏空闲 1 分钟后减少保活；有任务时继续运行。")
                : com.deepseekharness.app.util.UiText.text("持续保持运行，适合长时间任务。"));
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
        ver.setText("DeepSeekHarness v" + appVersion() + " · MIT License");
        footer.addView(ver);
        return footer;
    }

    /**
     * 系统修复（侧边栏入口）：备份并重建内置环境，或恢复中断的维护。
     * 与安装页的「备份并重建」共用同一条 BackupTask 流程与互斥锁，行为一致。
     */
    private void confirmSystemRepair() {
        com.deepseekharness.app.core.BackupTask task = com.deepseekharness.app.core.BackupTask.get(this);
        if (task.maintenanceBusy()) {
            android.widget.Toast.makeText(this,
                    com.deepseekharness.app.util.UiText.text("已有环境任务进行中，请稍后重试"),
                    android.widget.Toast.LENGTH_LONG).show();
            return;
        }
        boolean recovery = task.pendingMaintenance();
        new DeepSeekHarnessDialogBuilder(this)
                .setTitle(recovery ? com.deepseekharness.app.util.UiText.text("恢复中断维护？")
                        : com.deepseekharness.app.util.UiText.text("备份并重建环境？"))
                .setMessage(recovery
                        ? com.deepseekharness.app.util.UiText.text("先停止 Web，再回切旧环境；安全备份和失败的新环境均保留。")
                        : com.deepseekharness.app.util.UiText.text("会停止 Web 并中断正在执行的任务，完整备份并校验配置、会话和本地插件，再重建环境并恢复数据。\n\n")
                        + com.deepseekharness.app.util.UiText.text("备份失败不切换环境，后续失败回切旧环境；安全备份和旧环境会保留并占用额外空间。额外安装的系统软件留在旧环境中。"))
                .setPositiveButton(recovery ? com.deepseekharness.app.util.UiText.text("恢复原环境")
                        : com.deepseekharness.app.util.UiText.text("备份并重建"), (dialog, which) -> {
                    try {
                        if (!(recovery ? task.recoverMaintenance() : task.rebuild())) {
                            android.widget.Toast.makeText(this,
                                    com.deepseekharness.app.util.UiText.text("已有环境任务或未完成维护，请稍后重试"),
                                    android.widget.Toast.LENGTH_LONG).show();
                            return;
                        }
                        startActivity(new Intent(this, ExtractActivity.class)
                                .putExtra("data_task_id", task.snapshot().id));
                    } catch (Throwable error) {
                        android.widget.Toast.makeText(this,
                                com.deepseekharness.app.util.UiText.text("无法打开维护页，可到数据与备份页查看任务：")
                                        + com.deepseekharness.app.util.SensitiveData.redact(String.valueOf(error)),
                                android.widget.Toast.LENGTH_LONG).show();
                    }
                })
                .setNegativeButton(com.deepseekharness.app.util.UiText.text("取消"), null)
                .show();
    }

    /** 界面语言切换（侧边栏入口）：选中后延迟重建，保证菜单/底栏全部刷新。 */
    private void showLanguageDialog() {
        String current = new ConfigStore(this).getUiLanguage();
        AppDialogs.showList(this, android.R.drawable.ic_menu_manage,
                com.deepseekharness.app.util.UiText.text("界面语言 / Language"),
                new String[]{com.deepseekharness.app.util.UiText.text("中文"), "English"},
                index -> {
                    String language = index == 0 ? "zh" : "en";
                    if (!language.equals(current)) {
                        LanguageController.select(this, language);
                        // 延迟重建：等 setApplicationLocales 应用后再重建，保证菜单/底栏全部刷新
                        getWindow().getDecorView().postDelayed(() -> { if (!isFinishing()) recreate(); }, 200);
                    }
                });
    }

    /** 关于软件：复用应用既有的关于对话框（版本 / 仓库 / 交流群，与顶栏入口一致）。 */
    /** 关于软件：免费声明 + 应用信息 + 开源地址 + 打赏 / 交流群 / 开发者（与 xliaoy/DeepSeekHarness 一致）。 */
    private static final String OPEN_SOURCE_URL = "https://github.com/xliaoy/DeepSeekHarness";
    private static final String QQ_GROUP_JOIN = "https://qun.qq.com/universal-share/share?ac=1&authKey=IyxMq0rBXUREnVUtSJMWRHygUKhtHcer%2BoqN2Y8zXyNFxkwergsqsQU1sxD98M40&busi_data=eyJncm91cENvZGUiOiIxMTI1MzkzOTUyIiwidG9rZW4iOiIydnRIZE9CVGF1OHVkRHVLM00xMXhzMnVGYWdGb2hMNjNjRDlaQUJWUjkxVkRMcE5kUTY5aENMWVFsdGtxSkJTIiwidWluIjoiMzQ0NTc5MDk1OCJ9&data=pH25LUAofBHc-HFdejNWLW2FDxq8JdM9XEkwpQFQKwN-sRJMb1-K6o1gWRTpjLtBWD7oh3FhlCfpswttZfMGwQ&svctype=4&tempid=h5_group_info";
    private static final String QQ_DEV_JOIN = "https://qm.qq.com/q/yVTeGUfLjy";

    private void showAboutDialog() {
        String msg = com.deepseekharness.app.util.UiText.text("DeepSeek Harness 手机端（DSHA 二开版）\n\n")
                + com.deepseekharness.app.util.UiText.text("本软件完全免费开源，不收取任何费用，也没有会员、内购或任何付费功能。\n")
                + com.deepseekharness.app.util.UiText.text("如果你是通过付费购买获得本软件，说明你被骗了，请立即申请退款，并到官方交流群反馈。\n\n")
                + com.deepseekharness.app.util.UiText.text("应用名称：DeepSeek Harness\n")
                + com.deepseekharness.app.util.UiText.text("包名：") + getPackageName() + "\n"
                + com.deepseekharness.app.util.UiText.text("版本：v") + appVersion() + "\n"
                + com.deepseekharness.app.util.UiText.text("开源地址：") + OPEN_SOURCE_URL + "\n\n"
                + com.deepseekharness.app.util.UiText.text("交流QQ群：1125393952\n")
                + com.deepseekharness.app.util.UiText.text("开发者QQ：3445790958");
        AppDialogs.show(this, R.drawable.ic_info, com.deepseekharness.app.util.UiText.text("关于 DeepSeek Harness"), msg,
                com.deepseekharness.app.util.UiText.text("打赏支持"), com.deepseekharness.app.util.UiText.text("加入交流群"), com.deepseekharness.app.util.UiText.text("关闭"),
                this::showDonateDialog, () -> openUrl(QQ_GROUP_JOIN), null);
    }

    /** 打赏支持：微信 / 支付宝收款码（图片取自 drawable-nodpi/donate_*，替换资源后重打包即生效）。 */
    private void showDonateDialog() {
        android.widget.LinearLayout row = new android.widget.LinearLayout(this);
        row.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        row.setGravity(android.view.Gravity.CENTER);
        int size = dp(130);

        android.widget.LinearLayout wechatCol = new android.widget.LinearLayout(this);
        wechatCol.setOrientation(android.widget.LinearLayout.VERTICAL);
        wechatCol.setGravity(android.view.Gravity.CENTER_HORIZONTAL);
        android.widget.ImageView wechat = new android.widget.ImageView(this);
        wechat.setImageResource(R.drawable.donate_wechat);
        wechat.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        wechatCol.addView(wechat, new android.widget.LinearLayout.LayoutParams(size, size));
        android.widget.TextView wl = new android.widget.TextView(this);
        wl.setText(com.deepseekharness.app.util.UiText.text("微信"));
        wl.setTextSize(13);
        wl.setTextColor(getColor(R.color.text_muted));
        wl.setGravity(android.view.Gravity.CENTER);
        wechatCol.addView(wl, new android.widget.LinearLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        android.widget.LinearLayout.LayoutParams wcp = new android.widget.LinearLayout.LayoutParams(0,
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        wcp.leftMargin = dp(8);
        wcp.rightMargin = dp(4);
        wechatCol.setLayoutParams(wcp);

        android.widget.LinearLayout alipayCol = new android.widget.LinearLayout(this);
        alipayCol.setOrientation(android.widget.LinearLayout.VERTICAL);
        alipayCol.setGravity(android.view.Gravity.CENTER_HORIZONTAL);
        android.widget.ImageView alipay = new android.widget.ImageView(this);
        alipay.setImageResource(R.drawable.donate_alipay);
        alipay.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        alipayCol.addView(alipay, new android.widget.LinearLayout.LayoutParams(size, size));
        android.widget.TextView al = new android.widget.TextView(this);
        al.setText(com.deepseekharness.app.util.UiText.text("支付宝"));
        al.setTextSize(13);
        al.setTextColor(getColor(R.color.text_muted));
        al.setGravity(android.view.Gravity.CENTER);
        alipayCol.addView(al, new android.widget.LinearLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT));
        android.widget.LinearLayout.LayoutParams acp = new android.widget.LinearLayout.LayoutParams(0,
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        acp.leftMargin = dp(4);
        acp.rightMargin = dp(8);
        alipayCol.setLayoutParams(acp);

        row.addView(wechatCol);
        row.addView(alipayCol);
        AppDialogs.showCustom(this, R.drawable.ic_info, com.deepseekharness.app.util.UiText.text("打赏支持（自愿）"), row,
                com.deepseekharness.app.util.UiText.text("开发者QQ"), com.deepseekharness.app.util.UiText.text("关闭"), () -> openUrl(QQ_DEV_JOIN));
    }

    private void openUrl(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)));
        } catch (Throwable t) {
            android.widget.Toast.makeText(this, com.deepseekharness.app.util.UiText.text("无法打开链接"), android.widget.Toast.LENGTH_SHORT).show();
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

    /** 沉浸式 insets：状态栏区域强制显示顶栏色（card）+ 顶栏 padding 按实际位置自适应。
     *  DrawerLayout/系统可能把主内容推到状态栏下方（上方露出主体灰），这里在窗口最顶层加
     *  一条「状态栏高度×全宽」的覆盖层，颜色取顶栏色，保证状态栏与顶栏完全同色。 */
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

    @Override
    protected void onResume() {
        super.onResume();
        if(!new ConfigStore(this).getUiLanguage().equals(com.deepseekharness.app.util.UiText.language()))LanguageController.apply(this);
        current = this;
        recoveryHandler.removeCallbacks(refreshRecovery);
        recoveryHandler.post(refreshRecovery);
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
        maybePromptExternalRestore();
    }

    /**
     * 卸载重装后的空环境仍给旧 Download/DeepSeekHarness 备份一个明确入口。
     * 扫描本身在后台执行；无法枚举旧 MediaStore 归属时也不把「0 个」
     * 当成「没有备份」，而是提供 SAF 手动选择（issue #22）。
     */
    private void maybePromptExternalRestore() {
        if (restoreProbeStarted || isFinishing() || isDestroyed()) return;
        HarnessController controller = HarnessController.get(this);
        if (!controller.isEnvironmentReady()
                || com.deepseekharness.app.core.BackupTask.get(this).busy()
                || com.deepseekharness.app.backup.ExternalBackupScanner.hasUserData(controller)) return;
        restoreProbeStarted = true;
        new Thread(() -> {
            com.deepseekharness.app.backup.ExternalBackupScanner.Scan scan =
                    com.deepseekharness.app.backup.ExternalBackupScanner.scan(this);
            boolean invisible = scan.total() == 0
                    && !com.deepseekharness.app.backup.ExternalBackupScanner.canSeeAllFiles();
            if (scan.total() == 0 && !invisible) return;
            String declineKey = scan.best != null ? scan.best.name
                    : scan.total() == 0 ? "__invisible__" : "__unreadable__" + scan.unreadable;
            android.content.SharedPreferences prefs = getSharedPreferences(com.deepseekharness.app.util.Constants.PREFS, MODE_PRIVATE);
            if (declineKey.equals(prefs.getString("restore_prompt_declined", ""))) return;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                try {
                    com.deepseekharness.app.ui.DeepSeekHarnessDialogBuilder dialog = new com.deepseekharness.app.ui.DeepSeekHarnessDialogBuilder(this);
                    if (scan.best != null) {
                        String message = com.deepseekharness.app.util.UiText.choose(
                                "发现旧版备份：\n" + scan.best.describe() + "\n\n可先预检，确认后才会覆盖当前空环境。",
                                "A previous backup was found:\n" + scan.best.describe() + "\n\nIt will be inspected before anything is changed.");
                        if (scan.unreadable > 0) message += com.deepseekharness.app.util.UiText.choose(
                                "\n另有 " + scan.unreadable + " 个备份无法自动读取，可手动选择。",
                                "\n" + scan.unreadable + " other backups cannot be read automatically; you can choose one manually.");
                        dialog.setTitle(com.deepseekharness.app.util.UiText.choose("检测到旧版备份", "Previous backup found"))
                                .setMessage(message)
                                .setPositiveButton(com.deepseekharness.app.util.UiText.choose("选择恢复", "Inspect and restore"), (d,w) -> openBackupForRestore(scan.best))
                                .setNegativeButton(com.deepseekharness.app.util.UiText.choose("忽略", "Ignore"), (d,w) -> prefs.edit().putString("restore_prompt_declined", declineKey).apply());
                        if (scan.unreadable > 0) dialog.setNeutralButton(com.deepseekharness.app.util.UiText.choose("手动选择", "Choose manually"), (d,w) -> pickBackupForRestore());
                    } else if (invisible) {
                        dialog.setTitle(com.deepseekharness.app.util.UiText.choose("是否需要恢复以前的备份？", "Restore an older backup?"))
                                .setMessage(com.deepseekharness.app.util.UiText.choose(
                                        "当前环境没有用户数据。系统暂时无法枚举卸载前的 Download/DeepSeekHarness 文件；可用文件选择器直接选择备份，不需要开启所有文件访问。",
                                        "This environment has no user data. Android cannot enumerate backups from the previous installation, but the file picker can open one without all-files access."))
                                .setPositiveButton(com.deepseekharness.app.util.UiText.choose("手动选择", "Choose backup"), (d,w) -> pickBackupForRestore())
                                .setNegativeButton(com.deepseekharness.app.util.UiText.choose("不用了", "Not now"), (d,w) -> prefs.edit().putString("restore_prompt_declined", declineKey).apply());
                    } else {
                        dialog.setTitle(com.deepseekharness.app.util.UiText.choose("备份无法自动读取", "Backup cannot be read automatically"))
                                .setMessage(com.deepseekharness.app.util.UiText.choose("请用文件选择器指定备份包。", "Choose the backup package with the file picker."))
                                .setPositiveButton(com.deepseekharness.app.util.UiText.choose("手动选择", "Choose backup"), (d,w) -> pickBackupForRestore())
                                .setNegativeButton(com.deepseekharness.app.util.UiText.choose("忽略", "Ignore"), (d,w) -> prefs.edit().putString("restore_prompt_declined", declineKey).apply());
                    }
                    dialog.show();
                } catch (Throwable ignored) { }
            });
        }, "deepseekharness-restore-probe").start();
    }

    public void pickBackupForRestore() {
        legacyBackupPicker.launch(new String[]{"application/octet-stream", "application/gzip", "application/x-gzip", "*/*"});
    }

    private void openBackupForRestore(com.deepseekharness.app.backup.ExternalBackupScanner.Candidate candidate) {
        if (candidate == null) return;
        android.net.Uri uri = candidate.uri;
        if (uri == null && candidate.file != null) {
            try {
                uri = androidx.core.content.FileProvider.getUriForFile(this, getPackageName() + ".updates", candidate.file);
            } catch (IllegalArgumentException ignored) { }
        }
        if (uri != null) openBackupForRestore(uri);
        else pickBackupForRestore();
    }

    private void openBackupForRestore(android.net.Uri uri) {
        startActivity(new Intent(this, NativeDataActivity.class).putExtra("restore_uri", uri.toString())
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
    }

    private final android.os.Handler recoveryHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable refreshRecovery = new Runnable() {
        @Override public void run() {
            TextView banner = findViewById(R.id.environment_recovery_banner);
            if (banner == null || isFinishing()) return;
            boolean limited = EnvironmentUiStatus.get(MainActivity.this).recovery;
            boolean busy = com.deepseekharness.app.core.BackupTask.get(MainActivity.this).maintenanceBusy();
            banner.setVisibility(limited || busy ? android.view.View.VISIBLE : android.view.View.GONE);
            banner.setText(busy ? com.deepseekharness.app.util.UiText.text("环境维护进行中 · 点击查看进度") : com.deepseekharness.app.util.UiText.text("受限模式：环境需要恢复 · 点击处理"));
            com.deepseekharness.app.util.BackupTaskState.Snapshot task=com.deepseekharness.app.core.BackupTask.get(MainActivity.this).snapshot();
            if(busy && task.busy())banner.setText((task.status==com.deepseekharness.app.util.BackupTaskState.Status.PREVIEW
                    ?com.deepseekharness.app.util.UiText.choose("等待确认恢复备份","Backup restore awaiting confirmation")
                    :com.deepseekharness.app.util.StartupText.render(task.kind))
                    +com.deepseekharness.app.util.UiText.choose(" · 点击查看进度"," · View progress"));
            HarnessController controller=HarnessController.get(MainActivity.this);
            boolean startupRecovery=controller.config().isStartupRecoveryRequested() || EnvironmentUiStatus.get(MainActivity.this).repairs;
            String key=controller.startupDiagnostics().recordId()+":"+controller.config().getWebFailureReason()+":"+EnvironmentUiStatus.get(MainActivity.this).repairs;
            if(startupRecovery && !limited && !busy && !controller.isStarting() && !controller.isStopping()
                    && !key.equals(openedRecovery) && getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) {
                openedRecovery=key;startActivity(new Intent(MainActivity.this,StartupRecoveryActivity.class));
            }
            recoveryHandler.postDelayed(this, 1000);
        }
    };

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putString("opened_startup_recovery",openedRecovery);super.onSaveInstanceState(state);
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
