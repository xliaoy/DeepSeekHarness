package com.deepseekharness.app.ui;

import android.app.Activity;
import android.graphics.Color;
import android.view.View;

import androidx.core.graphics.ColorUtils;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.deepseekharness.app.R;

/** 两种网页内核共用安全显示区；系统栏、挖孔和输入法都不能覆盖正文。 */
public final class WebFullscreenUi {
    /** 避免全局页面边距处理覆盖网页的全屏设置。 */
    public interface Host { }

    private WebFullscreenUi() { }

    public static void install(Activity activity) {
        // 旧 Android 的 FLAG_FULLSCREEN 会阻止 adjustResize，不能依赖输入法出现时再取消全屏。
        activity.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        WindowCompat.setDecorFitsSystemWindows(activity.getWindow(), false);
        View content = activity.findViewById(android.R.id.content);
        content.setBackgroundColor(activity.getColor(R.color.surface));
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            if (PictureInPictureActivity.showing(activity)) {
                view.setPadding(0, 0, 0, 0);
                return WindowInsetsCompat.CONSUMED;
            }
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout());
            // 顶部保留稳定安全区，避免 ROM 在键盘/焦点切换时短暂报告状态栏不可见而把正文顶上去。
            Insets stableTop = insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.statusBars()
                    | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.captionBar());
            Insets safe = Insets.max(bars, stableTop);
            int keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            view.setPadding(safe.left, safe.top, safe.right, Math.max(safe.bottom, keyboard));
            return WindowInsetsCompat.CONSUMED;
        });
        applySystemBars(activity);
        ViewCompat.requestApplyInsets(content);
    }

    public static void applySystemBars(Activity activity) {
        if (PictureInPictureActivity.showing(activity)) return;
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                activity.getWindow(), activity.getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(androidx.core.graphics.ColorUtils.calculateLuminance(
                activity.getColor(R.color.surface)) > 0.5);
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        // 显示状态栏，正文由 insets 避让；底部仍可通过手势唤出系统导航。
        controller.show(WindowInsetsCompat.Type.statusBars());
        controller.hide(WindowInsetsCompat.Type.navigationBars());
    }

    /** 状态栏跟随网页主题色：状态栏保持透明，同步 content 背景（状态栏区域透出该色）+ 图标明暗自适应。 */
    public static void applyThemeColor(Activity activity, int color) {
        if (activity == null || activity.isFinishing()) return;
        activity.getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        // Android 15+ 强制 edge-to-edge 会忽略 setStatusBarColor；状态栏区域实际透出的是
        // content 的背景色，因此同步更新 content 背景让状态栏跟随网页颜色。
        View content = activity.findViewById(android.R.id.content);
        if (content != null) content.setBackgroundColor(color);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                activity.getWindow(), activity.getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(ColorUtils.calculateLuminance(color) > 0.5);
    }

    /** 解析网页上报的颜色：支持 #rrggbb / #rgb / rgb() / rgba() 与命名色；解析失败返回 0。 */
    public static int parseThemeColor(String value) {
        if (value == null) return 0;
        String v = value.trim();
        if (v.isEmpty()) return 0;
        try {
            if (v.charAt(0) == '#') {
                if (v.length() == 4) {
                    int r = hexDigit(v.charAt(1)), g = hexDigit(v.charAt(2)), b = hexDigit(v.charAt(3));
                    return Color.rgb(r, g, b);
                }
                if (v.length() == 7) return Color.parseColor(v);
                if (v.length() == 9) return Color.parseColor(v);
                return 0;
            }
            if (v.startsWith("rgb(") || v.startsWith("rgba(")) return Color.parseColor(v);
            return 0;
        } catch (Exception ignored) { return 0; }
    }
    private static int hexDigit(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
        if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
        return 0;
    }
}
