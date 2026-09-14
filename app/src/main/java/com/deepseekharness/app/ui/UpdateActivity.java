package com.deepseekharness.app.ui;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AlertDialog;
import com.deepseekharness.app.R;
import com.deepseekharness.app.core.DshUpdater;

/** 更新 DeepSeek Harness：检查上游最新版本并在容器内 npm 更新，不依赖页面生命周期。 */
public final class UpdateActivity extends AppCompatActivity {
    private DshUpdater updater;
    private boolean restartPromptShown = false;
    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        setContentView(R.layout.activity_update);
        updater = DshUpdater.get(this);
        findViewById(R.id.update_back).setOnClickListener(v -> finish());
        findViewById(R.id.update_check).setOnClickListener(v -> updater.check());
        findViewById(R.id.update_update).setOnClickListener(v -> updater.update());
        findViewById(R.id.update_browser).setOnClickListener(v -> {
            DshUpdater.State s = updater.state().getValue();
            AboutDialog.openBrowser(this, s != null && s.pageUrl != null ? s.pageUrl : DshUpdater.RELEASES_PAGE);
        });
        updater.state().observe(this, state -> {
            UpdateUi.render(findViewById(android.R.id.content), state);
            // DeepSeekHarness：更新完成后弹窗提示，用户点「确认重启」才重启。
            if (state != null && state.needsRestart && !restartPromptShown) {
                restartPromptShown = true;
                final int[] seconds = {3};
                final String base = "DeepSeek Harness 已更新到 " + state.currentVersion
                        + "，需要重启应用以完成更新。\n\n";
                final AlertDialog dialog = AppDialogs.show(UpdateActivity.this,
                        android.R.drawable.ic_menu_upload, "更新完成",
                        base + seconds[0] + " 秒后自动重启…",
                        "立即重启", "稍后",
                        () -> updater.stopWebAndRestart(0));   // 点「立即重启」→ 立刻重启
                final Handler handler = new Handler(Looper.getMainLooper());
                final TextView msgView = dialog.findViewById(R.id.app_dialog_message);
                final Runnable tick = new Runnable() {
                    @Override public void run() {
                        seconds[0]--;
                        if (seconds[0] <= 0) {
                            // 3 秒未点击 → 自动重启
                            if (msgView != null) msgView.setText(base + "正在重启…");
                            updater.stopWebAndRestart(0);
                        } else {
                            if (msgView != null) msgView.setText(base + seconds[0] + " 秒后自动重启…");
                            handler.postDelayed(this, 1000);
                        }
                    }
                };
                handler.postDelayed(tick, 1000);
                dialog.setOnDismissListener(d -> handler.removeCallbacks(tick));
            }
        });
        if (saved == null && !updater.hasTask()) updater.check();
    }
}
