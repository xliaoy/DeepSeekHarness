package com.deepseekharness.app.ui;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.deepseekharness.app.LanProxyService;
import com.deepseekharness.app.R;
import com.deepseekharness.app.core.HarnessController;
import com.deepseekharness.app.util.Constants;

/**
 * 启动页：启动 / 进入 / 停止 dsh Web，显示运行状态、鉴权链接与局域网访问地址。
 */
public class LaunchFragment extends Fragment {

    private HarnessController controller;
    private TextView lanAddrText;
    private TextView localAddrText;
    private TextView launchLog;
    /** 启动按钮当前是否处于「进入」态（鉴权链接已就绪）。 */
    private boolean webReady;
    /** 主线程单飞；成功打开后保持占用，直到页面重新可见。 */
    private boolean enteringWeb;
    private long enterRequest;
    /** 本次启动开始时刻（显示耗时用）。 */
    private long startAtMs;
    private long logRevision = -1;
    /** 原始日志（未染色），供行号/高亮重渲染。 */
    private String rawLog = "";
    /** 日志区是否停留在底部；用户上滑查看历史时暂停自动跟随，回到底部后恢复。 */
    private boolean logAtBottom = true;
    private final android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable refreshState = new Runnable() {
        @Override public void run() {
            refreshRunState();
            refreshLanAddr();
            ui.postDelayed(this, 1000);
        }
    };

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        View v = inflater.inflate(R.layout.fragment_launch, container, false);

        controller = HarnessController.get(requireContext());
        final Activity activity = requireActivity();
        TextView status = v.findViewById(R.id.launch_status);
        Button start = v.findViewById(R.id.launch_start);
        Button restart = v.findViewById(R.id.launch_open);
        Button stop = v.findViewById(R.id.launch_stop);
        lanAddrText = v.findViewById(R.id.lan_addr);
        launchLog = v.findViewById(R.id.launch_log);
        logRevision = -1;
        bindLogScroll();
        v.findViewById(R.id.launch_download_logs).setOnClickListener(x -> startActivity(DiagnosticActivity.downloadLogs(requireContext())));

        restart.setText("重启");
        v.findViewById(R.id.launch_recovery).setOnClickListener(x -> showRecovery());
        v.findViewById(R.id.launch_safe).setOnClickListener(x -> AppDialogs.show(requireContext(),
                android.R.drawable.ic_lock_lock, "安全启动 Web？",
                "停止当前启动，只加载官方基础界面。原插件开关、会话、模型和配置保留；普通重启后回到原配置。安全界面不加载移动插件等扩展。",
                "安全启动", "取消", () -> doStart(activity, status, start, true)));

        // 启动按钮：未就绪时是「启动」；鉴权链接就绪后自动变为「进入」，点击进 WebUI。
        start.setOnClickListener(x -> {
            if (webReady || !webEntryUrl().isEmpty()) {
                enterWeb();
                return;
            }
            doStart(activity, status, start);
        });

        restart.setOnClickListener(x -> {
            // startWeb 本身串行执行「清旧进程 → 启动」，无需拆成两次请求。
            doStart(activity, status, start);
        });

        stop.setOnClickListener(x -> {
            invalidateWebEntry();
            controller.stopWeb(msg -> {
                long generation = controller.getWebGeneration();
                activity.runOnUiThread(() -> {
                    if (getView() != v || generation != controller.getWebGeneration()) return;
                    status.setText(msg);
                    refreshRunState();
                    refreshLanAddr();
                });
            });
            webReady = false;
            start.setText("启动");
            status.setText("停止中…");
            refreshLanAddr();
            refreshRunState();
        });

        // 本机访问地址（卡片内，局域网地址下方）
        localAddrText = v.findViewById(R.id.local_addr);

        return v;
    }

    /** 启动 dsh：记录启动时刻，鉴权链接就绪后把「启动」变「进入」并输出 URL 到日志。 */
    private void doStart(Activity activity, TextView status, Button start) {
        doStart(activity, status, start, false);
    }

    private void doStart(Activity activity, TextView status, Button start, boolean safeMode) {
        if (!safeMode && (controller.isStarting() || controller.isStopping())) return;
        final View root = getView();
        if (root == null || activity.isFinishing() || activity.isDestroyed()) return;
        invalidateWebEntry();
        startAtMs = System.currentTimeMillis();
        String time = new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
                .format(new java.util.Date());
        status.setText("启动中…（" + time + "）");
        start.setText("启动");
        webReady = false;
        java.util.function.Consumer<String> startStatus = msg -> {
            long generation = controller.getWebGeneration();
            activity.runOnUiThread(() -> {
                if (getView() != root || generation != controller.getWebGeneration()) return;
                status.setText(msg);
                refreshRunState();
                refreshLanAddr();
            });
        };
        boolean accepted;
        if (safeMode) { controller.recoverWeb(true, null, startStatus); accepted = true; }
        else accepted = controller.startWeb(startStatus);
        refreshRunState();
        if (!accepted) return;
        // 前台保活服务：dsh 后台常驻 + 看门狗自动重启（退到桌面/锁屏不被杀）
        try {
            Intent svc = new Intent(requireContext(), com.deepseekharness.app.HarnessService.class);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                requireContext().startForegroundService(svc);
            } else {
                requireContext().startService(svc);
            }
        } catch (Throwable t) {
            android.util.Log.w("DeepSeekHarness", "拉起保活服务失败: " + t.getMessage());
        }
    }

    /** 打开 WebPreviewActivity 进入 dsh WebUI。 */
    private void enterWeb() {
        final View root = getView();
        final Activity activity = getActivity();
        if (enteringWeb || root == null || activity == null || !isResumed()
                || activity.isFinishing() || activity.isDestroyed()) return;
        String url = webEntryUrl();
        if (url.isEmpty()) {
            if (getView() != null) {
                ((TextView) getView().findViewById(R.id.launch_status))
                        .setText("先点「启动」，等鉴权链接就绪后再进入");
            }
            return;
        }
        final long generation = webEntryGeneration();
        final long request = ++enterRequest;
        enteringWeb = true;
        ((TextView) root.findViewById(R.id.launch_status)).setText("正在验证 Web 访问权限…");
        refreshRunState();
        try {
            new Thread(() -> {
                String cookie = null;
                String failure = null;
                try {
                    cookie = exchangeWebEntryCookie();
                    if (cookie == null || cookie.isEmpty()) failure = controller.getWebAuthFailure();
                } catch (Exception error) {
                    failure = "Web 鉴权失败，请点「进入」重试（" + error.getClass().getSimpleName() + "）";
                }
                final String authCookie = cookie;
                final String authFailure = failure;
                ui.post(() -> {
                    if (request != enterRequest || getView() != root || !isResumed()
                            || activity.isFinishing() || activity.isDestroyed()) return;
                    if (generation != webEntryGeneration() || !url.equals(webEntryUrl())) {
                        finishWebEntry(root, "Web 状态已变化，请等待就绪后重新进入");
                        return;
                    }
                    if (authFailure != null) { finishWebEntry(root, authFailure); return; }
                    try {
                        openWebEntry(activity, url, authCookie);
                        ((TextView) root.findViewById(R.id.launch_status)).setText("鉴权成功，正在打开 Web…");
                        refreshLanAddr();
                    } catch (RuntimeException error) {
                        finishWebEntry(root, "无法打开 Web 页面，请重试（" + error.getClass().getSimpleName() + "）");
                    }
                });
            }, "dsh-cookie").start();
        } catch (RuntimeException error) {
            finishWebEntry(root, "无法开始 Web 鉴权，请重试");
        }
    }

    // 同包调试自测可替换鉴权和 Activity 出口，验证连点/异常/销毁，不实际启动 Web。
    String webEntryUrl() { return controller.getWebAuthUrl(); }
    long webEntryGeneration() { return controller.getWebGeneration(); }
    String exchangeWebEntryCookie() { return controller.exchangeDshAuthCookie(); }
    void openWebEntry(Activity activity, String url, String cookie) {
        startActivity(WebPreviewActivity.intent(activity, url, cookie));
    }

    private void finishWebEntry(View root, String message) {
        enteringWeb = false;
        ((TextView) root.findViewById(R.id.launch_status)).setText(message);
        refreshRunState();
    }

    private void invalidateWebEntry() {
        enterRequest++;
        enteringWeb = false;
    }

    /** 绑定日志滚动监听：随滚动更新"是否停留底部"，用于控制自动跟随。 */
    private void bindLogScroll() {
        if (getView() == null) return;
        androidx.core.widget.NestedScrollView sv = getView().findViewById(R.id.launch_log_scroll);
        if (sv == null) return;
        sv.setOnScrollChangeListener((androidx.core.widget.NestedScrollView.OnScrollChangeListener) (view, sx, sy, ox, oy) -> {
            View child = ((androidx.core.widget.NestedScrollView) view).getChildAt(0);
            logAtBottom = child == null || sy >= child.getHeight() - view.getHeight() - 48;
        });
        sv.setOnTouchListener((view, event) -> {
            // 与外层 NestedScrollView 嵌套：滚动时禁止父容器拦截触摸，保证日志可上下滑动
            if (event.getActionMasked() == android.view.MotionEvent.ACTION_DOWN
                    || event.getActionMasked() == android.view.MotionEvent.ACTION_MOVE) {
                sv.requestDisallowInterceptTouchEvent(true);
            }
            return false;
        });
        logAtBottom = true;
        refreshLogFollow();   // 首次进入也按内容设置高度（至少 84dp）
    }

    /**
     * 日志区固定 220dp 高度：无论有无日志都占据完整区域，区内滚动；停留在底部时自动跟随最新一行。
     */
    private void refreshLogFollow() {
        if (getView() == null || launchLog == null) return;
        androidx.core.widget.NestedScrollView sv = getView().findViewById(R.id.launch_log_scroll);
        if (sv == null) return;
        launchLog.post(() -> {
            if (getView() == null || launchLog == null) return;
            float density = getResources().getDisplayMetrics().density;
            int fixedPx = (int) (220 * density);
            android.view.ViewGroup.LayoutParams lp = sv.getLayoutParams();
            if (lp != null && lp.height != fixedPx) { lp.height = fixedPx; sv.setLayoutParams(lp); }
            if (logAtBottom) {
                View child = sv.getChildAt(0);
                if (child != null) sv.scrollTo(0, child.getHeight());
            }
        });
    }

    /** 渲染日志：左侧灰阶行号；访问链接 / dsh web 行加粗 + 浅背景高亮。 */
    private CharSequence renderLog(String raw) {
        if (raw == null || raw.isEmpty()) return raw;
        android.text.SpannableStringBuilder sb = new android.text.SpannableStringBuilder();
        String[] lines = raw.split("\n", -1);
        int width = Math.max(2, String.valueOf(lines.length).length());
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            if (i > 0) sb.append('\n');
            int start = sb.length();
            String num = String.format(java.util.Locale.ROOT, "%" + width + "d", i + 1);
            sb.append(num).append("  ").append(line);
            int numEnd = start + num.length();
            sb.setSpan(new android.text.style.ForegroundColorSpan(0xFFC4C8CE),
                    start, numEnd, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            if (line.contains("http://") || line.contains("dsh web")) {
                sb.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD),
                        numEnd, sb.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                sb.setSpan(new android.text.style.BackgroundColorSpan(0x1A15171B),
                        numEnd, sb.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
        }
        return sb;
    }

    /** 往日志区追加一行（首行替换占位文本）；统一走行号/高亮渲染。 */
    private void appendLog(String line) {
        if (launchLog == null || !isAdded()) return;
        rawLog = rawLog.isEmpty() ? line : rawLog + "\n" + line;
        launchLog.setText(renderLog(rawLog));
        refreshLogFollow();
    }

    @Override
    public void onResume() {
        super.onResume();
        invalidateWebEntry();
        ui.removeCallbacks(refreshState);
        ui.post(refreshState);
    }

    @Override
    public void onPause() {
        if (enteringWeb && getView() != null) {
            ((TextView) getView().findViewById(R.id.launch_status)).setText("返回后可重新进入 Web");
        }
        invalidateWebEntry();
        ui.removeCallbacks(refreshState);
        super.onPause();
    }

    @Override
    public void onDestroyView() {
        invalidateWebEntry();
        ui.removeCallbacks(refreshState);
        lanAddrText = null;
        localAddrText = null;
        launchLog = null;
        super.onDestroyView();
    }

    /** 读取共享状态，不在主线程执行 proot/kill -0；重建页面也能跟随后台启停。 */
    private void refreshRunState() {
        try {
            View root = getView();
            if (root == null) return;
            TextView runState = root.findViewById(R.id.launch_run_state);
            Button start = root.findViewById(R.id.launch_start);
            if (runState == null) return;
            boolean starting = controller.isStarting();
            boolean stopping = controller.isStopping();
            boolean ready = !starting && !stopping && !webEntryUrl().isEmpty();
            com.deepseekharness.app.util.StartupTrace.Snapshot trace = controller.startupDiagnostics().snapshot();
            if (launchLog != null && trace.revision != logRevision && !trace.log.isEmpty()) {
                rawLog = trace.log;
                launchLog.setText(renderLog(trace.log)); logRevision = trace.revision;
                refreshLogFollow();
            }
            runState.setText(enteringWeb ? "正在鉴权并打开 Web…" : controller.isRestartBlocked() ? "自动重启已暂停" : stopping ? "DSH 停止中…" : starting ? "DSH 启动中…"
                    : ready ? (trace.safe ? "基础界面已就绪 · 安全模式" : "DSH 已就绪，可进入")
                    + (controller.isWebCompatibilityFallback() ? " · 已兼容切换 proot" : "")
                    : controller.isUserStopped() ? "DSH 已停止" : "DSH 未就绪");
            if (starting) ((TextView) root.findViewById(R.id.launch_status)).setText(trace.stage
                    + " · 本阶段 " + trace.stageElapsedMs / 1000 + " 秒 · 总计 " + trace.elapsedMs / 1000
                    + " 秒\n" + (trace.issues.isEmpty() ? "下方实时显示启动输出；等待不会自动终止。" : "检测到插件或配置异常，可查看恢复选项。"));
            root.findViewById(R.id.launch_busy).setVisibility(starting || stopping ? View.VISIBLE : View.GONE);
            Button recovery = root.findViewById(R.id.launch_recovery);
            int failures = controller.config().getWebFailures();
            recovery.setVisibility(failures > 0 || !trace.issues.isEmpty() ? View.VISIBLE : View.GONE);
            recovery.setText(!trace.issues.isEmpty() ? "检测到 " + trace.issues.size() + " 项异常 · 查看插件与恢复选项"
                    : "失败 " + failures + "/3 · " + controller.config().getWebFailureStage() + " · 查看恢复选项");
            if (start != null) {
                webReady = ready;
                start.setText(enteringWeb ? "进入中…" : ready ? "进入" : "启动");
                start.setEnabled(!enteringWeb && !starting && !stopping);
            }
            Button restart = root.findViewById(R.id.launch_open);
            if (restart != null) restart.setEnabled(!starting && !stopping);
            Button stop = root.findViewById(R.id.launch_stop);
            if (stop != null) stop.setEnabled(!stopping);
        } catch (Throwable ignored) {
        }
    }

    private void showRecovery() {
        com.deepseekharness.app.core.ConfigStore config = controller.config();
        com.deepseekharness.app.util.StartupTrace.Snapshot trace = controller.startupDiagnostics().snapshot();
        StringBuilder details = new StringBuilder("当前阶段：" + trace.stage + "\n");
        java.util.ArrayList<String> plugins = new java.util.ArrayList<>();
        for (java.util.Map.Entry<String,String> issue : trace.issues.entrySet()) {
            details.append("\n").append(issue.getKey().isEmpty() ? "配置/加载异常（尚未确定插件）" : issue.getKey())
                    .append("\n").append(issue.getValue()).append("\n");
            if (!issue.getKey().isEmpty() && !com.deepseekharness.app.util.BuiltinPlugins.internal(issue.getKey())) plugins.add(issue.getKey());
        }
        if (trace.issues.isEmpty()) details.append(config.getWebFailureReason());
        details.append("\n可安全启动进入基础界面；插件文件和原配置保留。下载日志可保留完整错误上下文。");
        AppDialogs.show(requireContext(),
                controller.isRestartBlocked() ? android.R.drawable.ic_dialog_alert : android.R.drawable.ic_menu_revert,
                controller.isRestartBlocked() ? "连续失败，已暂停自动重启" : "启动恢复",
                details.toString(),
                "安全启动",
                plugins.isEmpty() ? "管理插件" : "选择停用插件",
                "关闭",
                () -> {
                    View root = getView();
                    if (root != null) doStart(requireActivity(), root.findViewById(R.id.launch_status), root.findViewById(R.id.launch_start), true);
                },
                () -> {
                    if (!plugins.isEmpty()) {
                        AppDialogs.showList(requireContext(), android.R.drawable.ic_menu_close_clear_cancel,
                                "停用所选插件并重启", plugins.toArray(new String[0]), item -> {
                                    controller.recoverWeb(false, plugins.get(item), message -> ui.post(() -> {
                                        if (getView() != null) ((TextView)getView().findViewById(R.id.launch_status)).setText(message);
                                        PluginFragment.invalidateInstalledState(); refreshRunState();
                                    }));
                                });
                        return;
                    }
                    PluginFragment fragment = new PluginFragment();
                    Bundle args = new Bundle(); args.putBoolean("show_installed", true); fragment.setArguments(args);
                    getParentFragmentManager().beginTransaction().replace(R.id.fragment_container, fragment)
                            .addToBackStack("recovery").commit();
                });
    }

    /** LAN 开关开 + 代理已绑定 → 直接把完整局域网地址亮出来（点一下可复制）。 */
    private void refreshLanAddr() {
        if (!isAdded()) return;

        // 本机访问地址：始终显示；鉴权 URL 就绪前显示获取中状态
        if (localAddrText != null) {
            String url = webEntryUrl();
            if (url == null || url.isEmpty()) {
                localAddrText.setText("正在获取本地访问地址中…");
                localAddrText.setOnClickListener(null);
            } else {
                final String local = url;
                localAddrText.setText("本机访问地址：\n" + local);
                localAddrText.setOnClickListener(v -> copyAddr("本机地址", local));
            }
            localAddrText.setVisibility(View.VISIBLE);
        }

        if (lanAddrText == null) return;
        boolean lan = requireContext().getSharedPreferences(Constants.PREFS, Context.MODE_PRIVATE)
                .getBoolean(Constants.KEY_LAN_MODE, false);
        if (!lan) {
            lanAddrText.setVisibility(View.GONE);
            return;
        }
        boolean bound = LanProxyService.isBound();
        if (bound) {
            String ip = HarnessController.getLanAddress();
            if (ip != null && !ip.isEmpty()) {
                final String addr = "http://" + ip + ":" + LanProxyService.LAN_PORT + "/?token="
                        + LanProxyService.getLanToken(requireContext());
                lanAddrText.setText("局域网地址（同 WiFi 的其它设备访问）：\n" + addr);
                lanAddrText.setOnClickListener(v -> copyAddr("局域网地址", addr));
            } else {
                lanAddrText.setText("局域网已开启，但还没拿到 WiFi 地址（连上 WiFi 再看）");
                lanAddrText.setOnClickListener(null);
            }
        } else {
            lanAddrText.setText("局域网代理正在等待本轮认证");
            lanAddrText.setOnClickListener(null);
        }
        lanAddrText.setVisibility(View.VISIBLE);
    }

    private void copyAddr(String label, String addr) {
        try {
            android.content.ClipboardManager cm = (android.content.ClipboardManager)
                    requireContext().getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(android.content.ClipData.newPlainText(label, addr));
                Toast.makeText(requireContext(), "已复制：" + addr, Toast.LENGTH_LONG).show();
            }
        } catch (Throwable t) {
            Toast.makeText(requireContext(), "复制失败：" + t.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }
}
