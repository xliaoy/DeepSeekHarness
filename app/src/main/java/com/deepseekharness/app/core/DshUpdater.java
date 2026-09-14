package com.deepseekharness.app.core;

import android.content.Context;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import com.deepseekharness.app.runtime.ProotBootstrap;
import com.deepseekharness.app.util.Compat;
import com.deepseekharness.app.util.ManagedRuntimeLayout;
import com.deepseekharness.app.util.SensitiveData;
import com.deepseekharness.app.util.ShellQuote;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 更新 DeepSeek Harness（容器内的 @deepseek-ai/dsh）。
 * 从上游 GitHub Releases 读取最新 tag，再在 rootfs 内 npm 全局安装对应版本。
 * 不持有 Activity，旋转/进程重建不会重复检查或打断更新。
 */
public final class DshUpdater {
    private static DshUpdater instance;
    private final Context context;
    private final ProotBootstrap proot;
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private volatile boolean cancelled;
    private volatile boolean startupChecked;
    private volatile boolean startupNotice;
    private volatile String currentVersion;
    private volatile String latestVersion;
    private volatile String latestBody;
    private volatile String latestUrl;
    private final MutableLiveData<State> state = new MutableLiveData<>(new State("尚未检查更新", false, null, null, null, null));
    private final Handler main = new Handler(Looper.getMainLooper());

    public static final String RELEASES_API = "https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=1";
    public static final String RELEASES_PAGE = "https://github.com/deepseek-ai/deepseek-harness/releases";

    public static final class State {
        public final String message;
        public final boolean busy;
        public final String currentVersion;
        public final String latestVersion;
        public final String notes;
        public final String pageUrl;
        public final boolean needsRestart;
        /** 阶段进度 0-100；-1 表示不确定（界面显示转圈）。 */
        public final int progressPercent;
        public State(String message, boolean busy, String currentVersion, String latestVersion, String notes, String pageUrl) {
            this(message, busy, currentVersion, latestVersion, notes, pageUrl, false, -1);
        }
        public State(String message, boolean busy, String currentVersion, String latestVersion, String notes, String pageUrl, boolean needsRestart) {
            this(message, busy, currentVersion, latestVersion, notes, pageUrl, needsRestart, -1);
        }
        public State(String message, boolean busy, String currentVersion, String latestVersion, String notes, String pageUrl, boolean needsRestart, int progressPercent) {
            this.message = message; this.busy = busy; this.currentVersion = currentVersion;
            this.latestVersion = latestVersion; this.notes = notes; this.pageUrl = pageUrl;
            this.needsRestart = needsRestart; this.progressPercent = progressPercent;
        }
        public boolean updatable() {
            return latestVersion != null && currentVersion != null
                    && compareVersion(latestVersion, currentVersion) > 0;
        }
    }

    public static synchronized DshUpdater get(Context context) {
        if (instance == null) instance = new DshUpdater(context.getApplicationContext());
        return instance;
    }

    private DshUpdater(Context app) {
        context = app;
        proot = new ProotBootstrap(app);
    }

    public LiveData<State> state() { return state; }
    public boolean hasTask() { return busy.get(); }
    public void cancel() {
        cancelled = true;
        if (!busy.get()) state.setValue(new State("已取消", false, currentVersion, latestVersion, latestBody, latestUrl));
    }

    public void checkOnStartup(boolean enabled) {
        if (!enabled || startupChecked) return;
        startupChecked = true;
        if (busy.get()) return;
        check(true);
    }

    public String startupNotice() {
        if (!startupNotice || busy.get()) return null;
        State s = state.getValue();
        return s != null && s.updatable() ? s.latestVersion : null;
    }

    public void markStartupNoticeShown() { startupNotice = false; }

    public void check() { check(false); }

    private void check(boolean startup) {
        if (!busy.compareAndSet(false, true)) return;
        cancelled = false;
        state.setValue(new State("正在检查 DeepSeek Harness 更新…", true, currentVersion, latestVersion, latestBody, latestUrl));
        IO.execute(() -> {
            String message;
            try {
                String current = readCurrentVersion();
                JSONObject release = fetchLatestRelease();
                String tag = release.getString("tag_name");
                String latest = stripTag(tag);
                String body = cleanReleaseNotes(release.optString("body", ""));
                String url = release.optString("html_url", RELEASES_PAGE);
                currentVersion = current;
                latestVersion = latest;
                latestBody = body;
                latestUrl = url;
                startupNotice = startup && latest != null && current != null && compareVersion(latest, current) > 0;
                message = current == null
                        ? "当前环境未安装 DeepSeek Harness，可先到「安装与修复」完成环境安装。"
                        : latest == null
                        ? "无法读取上游最新版本，请稍后重试。"
                        : compareVersion(latest, current) > 0
                        ? "发现新版本 " + latest + "（当前 " + current + "）"
                        : compareVersion(latest, current) == 0
                        ? "已是最新版本 " + current
                        : "本地版本 " + current + " 已高于上游最新 " + latest + "，无需更新";
            } catch (Exception error) {
                message = "检查失败：" + SensitiveData.redact(error.getMessage());
            }
            final String done = message;
            DiagnosticLog.record(context, "DSH_UPDATE", done);
            main.post(() -> {
                busy.set(false);
                state.setValue(new State(done, false, currentVersion, latestVersion, latestBody, latestUrl));
            });
        });
    }

    /** 在容器内 npm 全局安装最新版本，完成后重读版本并复验。 */
    public void update() {
        State s = state.getValue();
        if (s == null || s.latestVersion == null || busy.get()) return;
        if (!busy.compareAndSet(false, true)) return;
        cancelled = false;
        final String target = s.latestVersion;
        state.setValue(new State("正在获取更新数据…", true, currentVersion, latestVersion, latestBody, latestUrl, false, -1));
        IO.execute(() -> {
            // DeepSeekHarness：更新前先检测并停止 dsh Web 进程（避免文件占用 / 旧代码冲突）
            try {
                HarnessController.get(context).stopWeb(msg -> { });
            } catch (Throwable ignored) {
            }
            String message;
            boolean success = false;
            try {
                // 1) 从 npm registry 获取 tarball 地址（包大小以实际下载响应 Content-Length 为准）
                final String tarballUrl = fetchTarballMeta(target)[0];
                // 2) App 侧真实下载（字节进度 + 包大小 MB）
                final File tgz = downloadTarball(tarballUrl, target);
                // 3) 容器内离线安装本地 tarball（不再触发 npm 二次联网下载）
                main.post(() -> {
                    State cur = state.getValue();
                    if (cur != null && cur.busy)
                        state.setValue(new State("正在解压安装更新包…", true, currentVersion, latestVersion, latestBody, latestUrl, false, -1));
                });
                String out = proot.execAndRead(installLocalTarballCommand(target), 1_200_000);
                tgz.delete();
                main.post(() -> {
                    State cur = state.getValue();
                    if (cur != null && cur.busy)
                        state.setValue(new State("正在校验更新结果…", true, currentVersion, latestVersion, latestBody, latestUrl, false, -1));
                });
                applySessionRenameImportFix();
                String after = readCurrentVersion();
                currentVersion = after;
                if (target.equals(after)) {
                    success = true;
                    message = "已更新到 " + after + "，需要重启以完成更新";
                } else {
                    String tail = out == null ? "" : out;
                    if (tail.length() > 600) tail = tail.substring(tail.length() - 600);
                    message = "更新结束，当前版本 " + (after == null ? "未知" : after) + "；\n" + tail;
                }
            } catch (Exception error) {
                message = "更新失败：" + SensitiveData.redact(error.getMessage());
            }
            final String done = message;
            final boolean needsRestart = success;
            DiagnosticLog.record(context, "DSH_UPDATE", done);
            main.post(() -> {
                busy.set(false);
                // DeepSeekHarness：更新成功后不自动重启 —— 由 UI 弹窗让用户确认后调用 restartAfterUpdate。
                state.setValue(new State(done, false, currentVersion, latestVersion, latestBody, latestUrl, needsRestart, 100));
            });
        });
    }

    /** 更新成功后的主动重启：先停掉旧 Web（让新版代码生效），再调度 MainActivity
     *  冷启动并结束当前进程。AlarmManager 在进程被杀后仍由系统拉起该页面。 */
    private static volatile boolean restartScheduled = false;

    /** DeepSeekHarness：更新完成后由用户确认调用的「退出重启」（参考游戏更新后的重启方式）：
     *  停掉旧 Web（让新版代码生效），然后由界面退出 App —— 用户重新打开即完成重启，
     *  不再用 AlarmManager 拉起，避免二次重启。防重入：进程内只执行一次。 */
    /** DeepSeekHarness：更新完成后「延迟后自动重启」（王者荣耀式）——
     *  先停 Web，倒计时结束后自动退出进程并拉起 MainActivity，无需用户手动。
     *  防重入：进程内只调度一次；set 前先 cancel 旧闹钟，杜绝二次重启。 */
    public void stopWebAndRestart(long delayMs) {
        if (restartScheduled) return;
        restartScheduled = true;
        try {
            HarnessController.get(context).stopWeb(msg -> { });
        } catch (Throwable ignored) {
        }
        main.postDelayed(() -> {
            try {
                Intent intent = new Intent(context, com.deepseekharness.app.ui.MainActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                PendingIntent pi = PendingIntent.getActivity(context, 0x53AF, intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                android.app.AlarmManager am = (android.app.AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
                if (am != null) {
                    am.cancel(pi);
                    am.set(android.app.AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 1200, pi);
                }
            } catch (Throwable ignored) { }
            android.os.Process.killProcess(android.os.Process.myPid());
        }, delayMs);
    }

    /** 取消尚未触发的重启闹钟：更新完成后的自动重启只应发生「被杀进程」那一次；
     *  若用户手动提前重新进入 App，进程已存在且旧代码已释放，残留闹钟会再次拉起导致二次进入，
     *  因此 App 启动（Application.onCreate）时统一取消。 */
    public static void cancelPendingRestart(Context context) {
        try {
            Intent intent = new Intent(context, com.deepseekharness.app.ui.MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            PendingIntent pi = PendingIntent.getActivity(context, 0x53AF, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            android.app.AlarmManager am = (android.app.AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(pi);
        } catch (Throwable ignored) { }
    }

    /** 从 npmmirror registry 获取指定版本 dsh 包的 tarball 地址与真实包大小（unpackedSize 字节）。 */
    private String[] fetchTarballMeta(String version) throws Exception {
        String api = "https://registry.npmmirror.com/@deepseek-ai%2Fdsh/" + version;
        HttpURLConnection conn = (HttpURLConnection) new URL(api).openConnection();
        try {
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", "DeepSeek-Harness-App");
            int code = conn.getResponseCode();
            if (code != 200) throw new java.io.IOException("npm registry 返回 HTTP " + code);
            try (InputStream in = conn.getInputStream(); java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int n;
                while ((n = in.read(buffer)) != -1) bytes.write(buffer, 0, n);
                org.json.JSONObject json = new org.json.JSONObject(bytes.toString("UTF-8"));
                org.json.JSONObject dist = json.getJSONObject("dist");
                return new String[]{ dist.getString("tarball"), String.valueOf(dist.optLong("unpackedSize", 0)) };
            }
        } finally {
            conn.disconnect();
        }
    }

    /** App 侧下载 tarball 到 rootfs 临时目录，按 512KB 节流上报真实字节进度；
     *  包大小与百分比以响应头 Content-Length 为基准（比 registry 的 unpackedSize 更真实）。 */
    private File downloadTarball(String url, String version) throws Exception {
        File dir = new File(proot.getRootfsDir(), "root/.dsh-update");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new java.io.IOException("无法创建更新缓存目录");
        File out = new File(dir, "dsh-" + version + ".tgz");
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        try {
            if (conn instanceof javax.net.ssl.HttpsURLConnection)
                ((javax.net.ssl.HttpsURLConnection) conn).setSSLSocketFactory(TrustedNetwork.sockets(context));
            conn.setInstanceFollowRedirects(true);   // tarball 会 302 到 CDN
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", "DeepSeek-Harness-App");
            if (conn.getResponseCode() != 200) throw new java.io.IOException("下载更新包失败：HTTP " + conn.getResponseCode());
            final long totalBytes = Math.max(0, conn.getContentLengthLong());
            final long[] last = {0};
            try (InputStream in = conn.getInputStream(); java.io.BufferedOutputStream bos = new java.io.BufferedOutputStream(new java.io.FileOutputStream(out))) {
                byte[] buffer = new byte[64 * 1024]; int n; long done = 0;
                while ((n = in.read(buffer)) != -1) {
                    bos.write(buffer, 0, n);
                    done += n;
                    if (done - last[0] >= 512 * 1024) {
                        last[0] = done;
                        final long finished = done;
                        main.post(() -> {
                            State cur = state.getValue();
                            if (cur == null || !cur.busy) return;
                            String mb = String.format(java.util.Locale.ROOT, "%.1f / %.1f MB",
                                    finished / 1048576.0, totalBytes / 1048576.0);
                            // 下载进度信息通过文字体现（大小 + 累计），进度条为无限转圈
                            state.setValue(new State("正在下载更新包 " + mb, true,
                                    currentVersion, latestVersion, latestBody, latestUrl, false, -1));
                        });
                    }
                }
                bos.flush();
            }
            return out;
        } finally {
            conn.disconnect();
        }
    }

    /** 容器内离线安装本地 tarball（npm 不再访问网络下载，进度由下载阶段已体现）。 */
    private String installLocalTarballCommand(String version) {
        // 本地 tgz 的 dependencies 仍会联网解析下载（dsh 有数十个直接依赖）；
        // 必须指定 npmmirror 镜像，否则走默认官方源在国内极慢；prefer-offline 复用缓存进一步加速。
        return "set -e; export npm_config_prefix=/usr/local; "
                + "echo '==> 安装 dsh-" + version + " 及其依赖…'; "
                + "npm install -g /root/.dsh-update/dsh-" + ShellQuote.arg(version) + ".tgz "
                + "--registry=https://registry.npmmirror.com --prefer-offline --no-audit --no-fund "
                + "--loglevel=error --jobs=4 --fetch-retries=3 --fetch-retry-mintimeout=20000 2>&1";
    }

    private String updateCommand(String version) {
        return "set -e; export npm_config_prefix=/usr/local; "
                + "echo '==> 安装 @deepseek-ai/dsh@" + version + "'; "
                + "npm install -g @deepseek-ai/dsh@" + ShellQuote.arg(version)
                + " --registry=https://registry.npmmirror.com --no-audit --no-fund 2>&1";
    }

    /** 更新后补齐上游模块缺失的补丁（幂等）：会话写入 link→rename、局域网设置、
     *  DNS；上游 npm 热更新会把文件重置回上游原样，安装/更新后必须重跑，
     *  否则私有目录禁 link(2) 时会话写入失败会让看门狗连续失败并暂停自动重启。 */
    private void applySessionRenameImportFix() {
        try {
            String out = proot.execAndRead(com.deepseekharness.app.util.InstallProbe.patchScript(), 60_000);
            if (out != null && !out.isEmpty())
                DiagnosticLog.record(context, "DSH_UPDATE_FIX", SensitiveData.redact(out.trim()));
        } catch (Exception ignored) {
        }
    }

    private String readCurrentVersion() {
        if (!proot.isEnvironmentReady()) return null;
        try {
            File pkg = new File(proot.getRootfsDir(), ManagedRuntimeLayout.DSH + "/package.json");
            if (!pkg.isFile()) return null;
            String v = new JSONObject(Compat.readAll(pkg)).optString("version", "");
            return v.matches("[0-9][0-9A-Za-z.\\-+]*") ? v : null;
        } catch (Exception error) {
            return null;
        }
    }

    private JSONObject fetchLatestRelease() throws Exception {
        HttpURLConnection conn = null;
        String target = RELEASES_API;
        for (int i = 0; i < 6; i++) {
            conn = (HttpURLConnection) new URL(target).openConnection();
            if (conn instanceof javax.net.ssl.HttpsURLConnection)
                ((javax.net.ssl.HttpsURLConnection) conn).setSSLSocketFactory(TrustedNetwork.sockets(context));
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("User-Agent", "DeepSeek-Harness-App");
            conn.setRequestProperty("Accept", "application/vnd.github+json");
            conn.setRequestProperty("Accept-Encoding", "identity");
            int code = conn.getResponseCode();
            if (code >= 300 && code <= 399) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null) throw new java.io.IOException("重定向缺少地址");
                target = new URL(new URL(target), location).toString();
                continue;
            }
            if (code == 403) {
                conn.disconnect();
                throw new java.io.IOException("GitHub 请求受限（HTTP 403），多为代理或频率限制，请关闭代理后重试");
            }
            if (code == 404) {
                conn.disconnect();
                throw new java.io.IOException("上游仓库暂无可用发布（HTTP 404），请稍后重试");
            }
            if (code != 200) {
                conn.disconnect();
                throw new java.io.IOException("GitHub 返回 HTTP " + code + "，请稍后重试");
            }
            byte[] raw;
            try (InputStream input = conn.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int n;
                while ((n = input.read(buffer)) != -1) {
                    if (bytes.size() + n > 1024 * 1024) throw new java.io.IOException("响应过大");
                    bytes.write(buffer, 0, n);
                }
                raw = bytes.toByteArray();
            } finally {
                conn.disconnect();
            }
            JSONArray releases = new JSONArray(new String(raw, java.nio.charset.StandardCharsets.UTF_8));
            if (releases.length() == 0) throw new java.io.IOException("上游仓库暂无可用发布版本");
            return releases.getJSONObject(0);
        }
        throw new java.io.IOException("重定向次数过多");
    }

    /** 从 tag（如 dsh-v0.1.5-alpha.1）提取版本号（0.1.5-alpha.1）。 */
    static String stripTag(String tag) {
        if (tag == null) return null;
        String t = tag.startsWith("dsh-v") ? tag.substring(5) : tag.startsWith("v") ? tag.substring(1) : tag;
        return t.matches("[0-9][0-9A-Za-z.\\-+]*") ? t : null;
    }

    /** 把 GitHub 自动生成的 release notes 净化为纯文本，去掉锚点目录行、
     *  HTML 标题标签、markdown 分隔线与链接语法，只保留可读的说明文字。 */
    static String cleanReleaseNotes(String body) {
        if (body == null) return "";
        StringBuilder out = new StringBuilder();
        boolean blank = false;
        for (String raw : body.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.matches("(\\[[^\\]]*\\]\\(#[^\\)]*\\)\\s*(\\|\\s*)?)+")) continue;
            line = line.replaceAll("<[^>]+>", "");
            line = line.replaceAll("\\[([^\\]]*)\\]\\([^\\)]*\\)", "$1");
            line = line.trim();
            if (line.isEmpty()) {
                if (!blank && out.length() > 0) { out.append('\n'); blank = true; }
                continue;
            }
            if (line.matches("[-_*]{3,}")) continue;
            out.append(line).append('\n');
            blank = false;
        }
        return out.toString().trim();
    }

    /** 比较 semver（含 prerelease）：返回正数表示 a 更新。 */
    static int compareVersion(String a, String b) {
        if (a == null || b == null) return 0;
        String[] pa = a.split("-", 2);
        String[] pb = b.split("-", 2);
        int[] ma = parseMain(pa[0]);
        int[] mb = parseMain(pb[0]);
        for (int i = 0; i < 3; i++) {
            int va = i < ma.length ? ma[i] : 0;
            int vb = i < mb.length ? mb[i] : 0;
            if (va != vb) return va - vb;
        }
        boolean preA = pa.length > 1;
        boolean preB = pb.length > 1;
        if (!preA && preB) return 1;
        if (preA && !preB) return -1;
        if (!preA) return 0;
        return pa[1].compareTo(pb[1]);
    }

    private static int[] parseMain(String main) {
        String[] parts = main.split("\\.");
        int[] result = new int[parts.length];
        for (int i = 0; i < parts.length; i++) {
            String digits = parts[i].replaceAll("[^0-9]", "");
            result[i] = digits.isEmpty() ? 0 : Integer.parseInt(digits);
        }
        return result;
    }
}
