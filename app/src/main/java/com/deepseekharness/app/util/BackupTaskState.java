package com.deepseekharness.app.util;

/** 页面无所有权的任务状态；等待确认也占用任务，旧页面不能确认下一次任务。 */
public final class BackupTaskState {
    public enum Status { IDLE, RUNNING, PREVIEW, SUCCEEDED, FAILED, CANCELLED, INTERRUPTED }
    /** 内嵌进度标记：detail 以 {@link #RATIO_PREFIX}{ratio}{@link #RATIO_SEP} 开头时，ratio 单独拆出供进度条使用。 */
    public static final String RATIO_PREFIX = "\u0001R";
    public static final String RATIO_SEP = "\u0002";
    private long id;
    private String kind = "", detail = "";
    private Status status = Status.IDLE;
    private float ratio = -1f;

    public synchronized long start(String kind) {
        if (busy()) return -1;
        id = Math.max(System.currentTimeMillis(), id + 1);
        this.kind = kind; status = Status.RUNNING; detail = "正在准备…"; ratio = -1f;
        return id;
    }
    public synchronized boolean busy() { return status == Status.RUNNING || status == Status.PREVIEW; }
    public synchronized void update(long expected, Status next, String message) {
        update(expected, next, message, -1f);
    }
    public synchronized void update(long expected, Status next, String message, float ratio) {
        if (expected != id || !busy()) return;
        status = next; detail = SensitiveData.redact(message == null ? "" : message);
        this.ratio = ratio;
    }
    public synchronized boolean confirm(long expected) {
        if (id != expected || status != Status.PREVIEW) return false;
        status = Status.RUNNING; detail = "正在恢复…"; ratio = -1f; return true;
    }
    public synchronized Snapshot snapshot() { return new Snapshot(id, kind, status, detail, ratio); }
    public synchronized void restore(long id, String kind, Status status, String detail) {
        this.id = id; this.kind = kind; this.status = status;
        this.detail = SensitiveData.redact(detail); this.ratio = -1f;
        if (busy()) {
            this.status = Status.INTERRUPTED;
            this.detail = "上次任务因进程退出而中断，未自动重试。请先处理未完成的维护或重新选择备份。\n" + this.detail;
        }
    }
    public static final class Snapshot {
        public final long id;
        public final String kind, detail;
        public final Status status;
        /** 0..1 结构化进度；-1 表示阶段未知（UI 退化为不确定进度条）。 */
        public final float ratio;
        Snapshot(long id, String kind, Status status, String detail, float ratio) {
            this.id = id; this.kind = kind; this.status = status; this.detail = detail; this.ratio = ratio;
        }
        public boolean busy() { return status == Status.RUNNING || status == Status.PREVIEW; }
    }
}
