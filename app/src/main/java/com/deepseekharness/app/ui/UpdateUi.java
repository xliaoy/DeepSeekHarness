package com.deepseekharness.app.ui;

import android.view.View;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import com.deepseekharness.app.R;
import com.deepseekharness.app.core.DshUpdater;

/** 更新页的状态与操作排版；检查与更新由 DshUpdater 负责。 */
final class UpdateUi {
    private UpdateUi() { }
    static void render(View root, DshUpdater.State state) {
        if (state == null) return;
        boolean busy = state.busy;
        boolean updatable = state.updatable();
        // 更新完成时详细说明已由完成弹窗展示，页面只保留简短状态，避免同一内容重复显示
        ((TextView) root.findViewById(R.id.update_status)).setText(
                state.needsRestart ? "更新完成，等待重启应用" : state.message);
        ((TextView) root.findViewById(R.id.update_current)).setText(
                state.currentVersion == null ? "未检测到（环境未安装）" : state.currentVersion);
        ProgressBar progress = root.findViewById(R.id.update_progress);
        TextView progressText = root.findViewById(R.id.update_progress_text);
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        // 更新页使用无限进度条，当前阶段由 update_status 文字说明（获取数据/停止/下载/解压/校验等）
        progress.setIndeterminate(true);
        if (progressText != null) progressText.setVisibility(View.GONE);
        Button check = root.findViewById(R.id.update_check);
        check.setEnabled(!busy);
        check.setText(state.latestVersion == null ? "检查更新" : "重新检查");
        Button update = root.findViewById(R.id.update_update);
        update.setVisibility(updatable ? View.VISIBLE : View.GONE);
        update.setEnabled(!busy);
        update.setText("更新到 " + state.latestVersion);
        TextView notes = root.findViewById(R.id.update_notes);
        String body = state.notes == null ? "" : state.notes;
        notes.setText(state.latestVersion == null ? "" : state.latestVersion + "\n\n" + body);
        root.findViewById(R.id.update_notes_panel).setVisibility(
                state.latestVersion != null ? View.VISIBLE : View.GONE);
    }
}
