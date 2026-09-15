package com.deepseekharness.app.ui;
import com.deepseekharness.app.util.UiText;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.RecyclerView;
import androidx.viewpager2.widget.ViewPager2;

import com.deepseekharness.app.R;
import com.deepseekharness.app.core.ConfigStore;
import com.deepseekharness.app.core.HarnessController;

import java.util.Arrays;
import java.util.List;

/**
 * 欢迎引导（3 页）：第 3 页点「开始」进入解压/主界面。
 */
public class WelcomeActivity extends AppCompatActivity {

    private final int[] pages = { R.layout.welcome_page1, R.layout.welcome_page2, R.layout.welcome_page3 };
    /** iOS 风格页码点：选中为 20×8dp 主色胶囊，未选为 8dp 灰点。 */
    private final View[] dots = new View[3];

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_welcome);

        ViewPager2 pager = findViewById(R.id.welcome_pager);
        Button btn = findViewById(R.id.welcome_btn);
        LinearLayout dotsBox = findViewById(R.id.welcome_dots);

        pager.setAdapter(new PageAdapter());
        pager.setUserInputEnabled(true);

        for (int i = 0; i < 3; i++) {
            View dot = new View(this);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(8), dp(8));
            lp.setMargins(dp(3), 0, dp(3), 0);
            dot.setLayoutParams(lp);
            dot.setBackgroundResource(R.drawable.dot_inactive);
            dotsBox.addView(dot);
            dots[i] = dot;
        }
        applyDotState(0);

        pager.registerOnPageChangeCallback(new ViewPager2.OnPageChangeCallback() {
            @Override
            public void onPageSelected(int position) {
                applyDotState(position);
                btn.setText(position == 2 ? UiText.text("开始") : UiText.text("下一步"));
            }
        });

        btn.setOnClickListener(v -> {
            int cur = pager.getCurrentItem();
            if (cur < 2) {
                pager.setCurrentItem(cur + 1);
            } else if (needAllFilesAccess()) {
                requestAllFilesAccessConfirm();
            } else {
                proceed();
            }
        });
    }

    /** 点「开始」前先申请「所有文件访问」权限（Android 11+ 特殊权限，只能跳系统设置）。 */
    private boolean needAllFilesAccess() {
        return Build.VERSION.SDK_INT >= 30 && !Environment.isExternalStorageManager();
    }

    private void requestAllFilesAccessConfirm() {
        androidx.appcompat.app.AlertDialog dialog = AppDialogs.show(this, android.R.drawable.ic_menu_manage, UiText.text("需要存储权限"),
                UiText.text("DeepSeek Harness 需要在容器中读写手机存储（如把工作区建到 /sdcard 任意位置）。")
                        + UiText.text("请点击下方按钮在系统设置中开启「所有文件访问」权限，开启后返回本页再次点击「开始」。"),
                UiText.text("去开启"), UiText.text("跳过"), () -> requestAllFilesAccess());
        dialog.setCancelable(false);
    }

    private void requestAllFilesAccess() {
        Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.parse("package:" + getPackageName()));
        try {
            startActivity(intent);
        } catch (Exception ignored) {
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
            } catch (Exception ignored2) {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + getPackageName()))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
        }
    }

    private void proceed() {
        new ConfigStore(this).setWelcomed(true);
        HarnessController c = new HarnessController(this);
        startActivity(new Intent(this,
                c.isEnvironmentReady() ? MainActivity.class : ExtractActivity.class));
        finish();
    }

    private class PageAdapter extends RecyclerView.Adapter<PageAdapter.Holder> {
        private final List<Integer> layouts = Arrays.asList(
                R.layout.welcome_page1, R.layout.welcome_page2, R.layout.welcome_page3);

        @NonNull
        @Override
        public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext()).inflate(layouts.get(viewType), parent, false);
            return new Holder(v);
        }

        @Override
        public void onBindViewHolder(@NonNull Holder holder, int position) {
        }

        @Override
        public int getItemViewType(int position) {
            return position;
        }

        @Override
        public int getItemCount() {
            return layouts.size();
        }

        class Holder extends RecyclerView.ViewHolder {
            Holder(@NonNull View itemView) {
                super(itemView);
            }
        }
    }

    /** 刷新页码点：选中项拉长为胶囊并高亮。 */
    private void applyDotState(int position) {
        for (int i = 0; i < dots.length; i++) {
            View dot = dots[i];
            if (dot == null) continue;
            LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) dot.getLayoutParams();
            int width = dp(i == position ? 20 : 8);
            if (lp.width != width) { lp.width = width; dot.setLayoutParams(lp); }
            dot.setBackgroundResource(i == position ? R.drawable.dot_active : R.drawable.dot_inactive);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
