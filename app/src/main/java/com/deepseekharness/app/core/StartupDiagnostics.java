package com.deepseekharness.app.core;

import android.content.Context;
import android.os.SystemClock;
import com.deepseekharness.app.util.StartupTrace;
import com.deepseekharness.app.util.SensitiveData;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import org.json.JSONObject;

/** 将实际运行输出和网页错误合并为有界时间线；不根据日志自动修改插件。 */
public final class StartupDiagnostics {
    private final StartupTrace trace = new StartupTrace();
    private final Map<String, String> owners = new LinkedHashMap<>();
    private final Context context;
    private String recentError = "";
    private int errorLines;
    private boolean explicitStartupFailure;
    private final com.deepseekharness.app.util.StartupHistoryStore history;
    private final ScheduledExecutorService historyIo = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "dsh-startup-history");
        t.setDaemon(true);
        return t;
    });
    private String recordId = "", result = "starting", failure = "";
    private long started, lastSaved;
    private volatile String historyError = "";
    /** 健康启动回调：宿主注入 StartupRepairs.healthy 记录健康快照。 */
    public java.util.function.LongConsumer onHealthy = generation -> { };

    public StartupDiagnostics(Context context) {
        this.context = context.getApplicationContext();
        history = new com.deepseekharness.app.util.StartupHistoryStore(context.getFilesDir());
    }

    public synchronized void begin(long generation, boolean safe) {
        persistHistory(true);
        owners.clear();
        recentError = "";
        errorLines = 0;
        explicitStartupFailure = false;
        trace.begin(generation, SystemClock.elapsedRealtime(), safe);
        recordId = java.util.UUID.randomUUID().toString();
        started = System.currentTimeMillis();
        result = "starting";
        failure = "";
        persistHistory(true);
    }

    public StartupTrace.Snapshot snapshot() {
        return trace.snapshot(SystemClock.elapsedRealtime());
    }

    /** 应用自己产生的（可信）启动行：不再做行级错误推断。 */
    public void message(long generation, String text) {
        trace.add(generation, SystemClock.elapsedRealtime(), text);
    }

    public void stage(long generation, String stage) {
        trace.stage(generation, SystemClock.elapsedRealtime(), stage);
        DiagnosticLog.record(context, "STARTUP_STAGE", stage);
        persistHistory(false);
    }

    public synchronized void output(long generation, String chunk) {
        if (!trace.isCurrent(generation) || chunk == null) return;
        for (String line : chunk.split("\n")) {
            if (line.startsWith("[DeepSeekHarness_STARTUP] ")) {
                try {
                    JSONObject event = new JSONObject(line.substring(26));
                    String type = event.optString("type"), name = event.optString("plugin"), message = event.optString("message");
                    if (name.length() > 214) name = "";
                    String path = event.optString("path");
                    if (!name.isEmpty() && path.startsWith("/") && owners.size() < 3000) owners.put(path + "/", name);
                    if (!name.isEmpty() && owners.size() < 3000) owners.put("\"" + name + "\"", name);
                    org.json.JSONArray ids = event.optJSONArray("ids");
                    if (ids != null) for (int i = 0; i < ids.length() && i < 100 && owners.size() < 3000; i++) {
                        String id = ids.optString(i);
                        String key = "\"" + id + "\"";
                        if (!id.isEmpty()) owners.put(key, owners.containsKey(key) && !name.equals(owners.get(key)) ? "" : name);
                    }
                    if ("stage".equals(type)) stage(generation, message);
                    else if ("issue".equals(type)) { issue(generation, name, message); explicitStartupFailure = true; }
                    else if (!message.isEmpty()) trace.add(generation, SystemClock.elapsedRealtime(), message);
                    continue;
                } catch (Exception ignored) { }
            }
            trace.add(generation, SystemClock.elapsedRealtime(), line);
            if (line.matches("(?i).*(error|failed|cannot|did not activate|missing).*")) {
                recentError = line; errorLines = 12;
                String name = owner(line);
                if (!name.isEmpty()) issue(generation, name, line);
            } else if (errorLines-- > 0) {
                String name = owner(line);
                if (!name.isEmpty()) issue(generation, name, recentError + "\n" + line);
            }
        }
        persistHistory(false);
    }

    private String owner(String text) {
        return com.deepseekharness.app.util.PluginFailureOwner.find(owners, text);
    }

    /** 插件清单里的明确启动失败（网页尚未就绪时提示进入原生恢复）。 */
    public synchronized boolean hasExplicitStartupFailure(long generation) {
        return trace.isCurrent(generation) && explicitStartupFailure && !snapshot().browserReady;
    }

    public synchronized void browser(long generation, String detail) {
        if (!trace.isCurrent(generation)) return;
        issue(generation, owner(detail), detail);
    }

    public synchronized boolean pageEvent(long generation, JSONObject event) {
        if (!trace.isCurrent(generation)) return false;
        String type = event.optString("type"), detail = event.optString("message");
        String id = event.optString("id");
        if ("ready".equals(type)) { browserReady(generation); return false; }
        if ("issue".equals(type)) {
            String name = owner("\"" + id + "\" " + detail);
            issue(generation, name, (id.isEmpty() ? "" : id + "：") + detail);
            if (name.isEmpty()) for (String line : detail.split("\n")) {
                String candidate = owner(line);
                if (!candidate.isEmpty()) issue(generation, candidate, line);
            }
            return event.optBoolean("fatal") && !snapshot().browserReady;
        }
        trace.add(generation, SystemClock.elapsedRealtime(), detail);
        return false;
    }

    public void issue(long generation, String name, String detail) {
        trace.issue(generation, SystemClock.elapsedRealtime(), name, detail);
        DiagnosticLog.record(context, "STARTUP_ERROR", name + ": " + SensitiveData.redact(detail));
    }

    public synchronized void browserReady(long generation) {
        if (!trace.isCurrent(generation)) return;
        boolean capture = !trace.snapshot(SystemClock.elapsedRealtime()).browserReady;
        trace.browserReady(generation, SystemClock.elapsedRealtime());
        result = "ready";
        persistHistory(true);
        // 正常启动且无异常时，异步记录一枚健康启动快照（供恢复页回退）。
        if (capture && !snapshot().safe && snapshot().issues.isEmpty())
            historyIo.execute(() -> onHealthy.accept(generation));
    }

    /** 结束态归档：failed / stopped；成功重试不覆盖失败证据。 */
    public synchronized void completed(long generation, String status, String reason) {
        if (!trace.isCurrent(generation)) return;
        if ("failed".equals(result) && "stopped".equals(status)) return;
        result = status;
        failure = reason == null ? "" : reason;
        persistHistory(true);
    }

    public synchronized String recordId() {
        return recordId;
    }

    public java.util.List<com.deepseekharness.app.util.StartupHistoryStore.Entry> history() {
        return history.list();
    }

    /** 恢复到恢复页展示的失败摘要。 */
    public String failureReason() {
        for (String detail : snapshot().issues.values()) {
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("(?:端口|port)[^0-9]{0,12}([0-9]{2,5})", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(detail);
            if (m.find()) return "Web 端口被占用：" + m.group(1);
        }
        return "启动配置或插件加载失败";
    }

    public String historyError() {
        return historyError;
    }

    private synchronized void persistHistory(boolean force) {
        if (recordId.isEmpty()) return;
        long now = SystemClock.elapsedRealtime();
        if (!force && now - lastSaved < 1000) return;
        lastSaved = now;
        String id = recordId, status = result, reason = failure;
        long date = started;
        StartupTrace.Snapshot snap = trace.snapshot(now);
        historyIo.execute(() -> {
            try {
                history.save(id, date, status, reason, snap);
                historyError = "";
            } catch (Exception error) {
                historyError = SensitiveData.redact(String.valueOf(error.getMessage()));
                DiagnosticLog.record(context, "STARTUP_HISTORY", historyError);
            }
        });
    }

    /** 成功重试不得覆盖上次失败证据，供旧设备无输出退出时排查。 */
    public void preserveFailure(java.io.File runtimeLog, String reason) {
        try {
            String text = "最近启动失败\n" + new java.util.Date() + "\n" + reason
                    + "\n\n" + snapshot().log + "\n\n=== 进程输出 ===\n";
            if (runtimeLog.isFile() && !com.deepseekharness.app.util.Compat.isSymbolicLink(runtimeLog))
                text += com.deepseekharness.app.util.TextLogTail.read(runtimeLog, 256 * 1024);
            com.deepseekharness.app.util.Compat.write(new java.io.File(context.getFilesDir(), "last-startup-failure.log"),
                    SensitiveData.redact(text).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (Exception ignored) { }
    }

    public static String lastFailure(Context context) {
        try {
            java.io.File file = new java.io.File(context.getFilesDir(), "last-startup-failure.log");
            return file.isFile() ? SensitiveData.redact(com.deepseekharness.app.util.TextLogTail.read(file, 384 * 1024)) : "暂无保留的失败记录\n";
        } catch (Exception error) { return "失败记录暂不可读\n"; }
    }
}
