package com.deepseekharness.app.ui;
import com.deepseekharness.app.util.UiText;

import android.content.Context;
import androidx.appcompat.app.AlertDialog;
import com.deepseekharness.app.R;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.annotation.DrawableRes;
import androidx.annotation.Nullable;

/** 通用美化弹窗（Shizuku 风格）：图标 + 加粗标题 + 灰色说明 + 可选进度条 + 居中等宽按钮。
 *  所有界面统一入口，保证弹窗观感一致。 */
public final class AppDialogs {
    public interface Callback { void run(); }

    /** 列表项点击回调（下标从 0 开始）。 */
    public interface ItemCallback { void run(int index); }

    private AppDialogs() { }

    /** 展示带图标与按钮的美化弹窗；negative 为 null 时只显示单个按钮并居中。 */
    public static AlertDialog show(Context context, @DrawableRes int iconRes, String title,
                                   @Nullable String message, String positive, @Nullable String negative,
                                   @Nullable Callback onPositive) {
        return show(context, iconRes, title, message, positive, null, negative, onPositive, null);
    }

    /** 完整版（含负按钮回调）：支持 positive / neutral / negative 三个按钮（可传 null 隐藏）。 */
    public static AlertDialog show(Context context, @DrawableRes int iconRes, String title,
                                   @Nullable String message, @Nullable String positive,
                                   @Nullable String neutral, @Nullable String negative,
                                   @Nullable Callback onPositive, @Nullable Callback onNeutral,
                                   @Nullable Callback onNegative) {
        return show9(context, iconRes, title, message, positive, neutral, negative, onPositive, onNeutral, onNegative);
    }

    /** 兼容旧签名（负按钮只关闭，无回调）。 */
    public static AlertDialog show(Context context, @DrawableRes int iconRes, String title,
                                   @Nullable String message, @Nullable String positive,
                                   @Nullable String neutral, @Nullable String negative,
                                   @Nullable Callback onPositive, @Nullable Callback onNeutral) {
        return show9(context, iconRes, title, message, positive, neutral, negative, onPositive, onNeutral, null);
    }

    private static AlertDialog show9(Context context, @DrawableRes int iconRes, String title,
                                   @Nullable String message, @Nullable String positive,
                                   @Nullable String neutral, @Nullable String negative,
                                   @Nullable Callback onPositive, @Nullable Callback onNeutral,
                                   @Nullable Callback onNegative) {
        View view = View.inflate(context, R.layout.dialog_app, null);
        ImageView icon = view.findViewById(R.id.app_dialog_icon);
        if (iconRes == 0) { icon.setVisibility(View.GONE); }
        else { icon.setImageResource(iconRes); }
        ((TextView) view.findViewById(R.id.app_dialog_title)).setText(title);
        TextView msg = view.findViewById(R.id.app_dialog_message);
        if (message == null || message.isEmpty()) { msg.setVisibility(View.GONE); }
        else { msg.setText(message); }
        view.findViewById(R.id.app_dialog_progress).setVisibility(View.GONE);

        Button pos = view.findViewById(R.id.app_dialog_positive);
        Button neg = view.findViewById(R.id.app_dialog_negative);
        Button neu = view.findViewById(R.id.app_dialog_neutral);
        pos.setText(positive == null ? "" : positive);
        if (positive == null) pos.setVisibility(View.GONE);
        else pos.setVisibility(View.VISIBLE);
        if (neutral == null) { neu.setVisibility(View.GONE); }
        else { neu.setVisibility(View.VISIBLE); neu.setText(neutral); }
        if (negative == null) { neg.setVisibility(View.GONE); }
        else { neg.setVisibility(View.VISIBLE); neg.setText(negative); }
        // 单按钮场景：主按钮拉满整行并居中
        if (negative == null && neutral == null) {
            ViewGroup.LayoutParams lp = pos.getLayoutParams();
            lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
            pos.setLayoutParams(lp);
        }

        AlertDialog dialog = new AlertDialog.Builder(context).setView(view).create();
        if (dialog.getWindow() != null)
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
        dialog.setCancelable(negative != null);
        pos.setOnClickListener(v -> { dialog.dismiss(); if (onPositive != null) onPositive.run(); });
        neu.setOnClickListener(v -> { dialog.dismiss(); if (onNeutral != null) onNeutral.run(); });
        neg.setOnClickListener(v -> { dialog.dismiss(); if (onNegative != null) onNegative.run(); });
        dialog.show();
        return dialog;
    }

    /** 自定义内容弹窗（含中性按钮）：图标 + 标题 + 自定义 View + 保存/预览/取消等按钮。 */
    public static AlertDialog showCustom(Context context, @DrawableRes int iconRes, String title,
                                         View content, @Nullable String positive, @Nullable String neutral,
                                         @Nullable String negative, @Nullable Callback onPositive,
                                         @Nullable Callback onNeutral) {
        return showCustom3(context, iconRes, title, content, positive, neutral, negative, onPositive, onNeutral, null);
    }

    /** 自定义内容弹窗：图标 + 标题 + 任意自定义 View（表单等）+ 底部按钮。 */
    public static AlertDialog showCustom(Context context, @DrawableRes int iconRes, String title,
                                         View content, @Nullable String positive, @Nullable String negative,
                                         @Nullable Callback onPositive) {
        return showCustom3(context, iconRes, title, content, positive, null, negative, onPositive, null, null);
    }

    private static AlertDialog showCustom3(Context context, @DrawableRes int iconRes, String title,
                                         View content, @Nullable String positive, @Nullable String neutral,
                                         @Nullable String negative, @Nullable Callback onPositive,
                                         @Nullable Callback onNeutral, @Nullable Callback onNegative) {
        View view = View.inflate(context, R.layout.dialog_app, null);
        ImageView icon = view.findViewById(R.id.app_dialog_icon);
        if (iconRes == 0) { icon.setVisibility(View.GONE); }
        else { icon.setImageResource(iconRes); }
        ((TextView) view.findViewById(R.id.app_dialog_title)).setText(title);
        view.findViewById(R.id.app_dialog_message).setVisibility(View.GONE);
        view.findViewById(R.id.app_dialog_progress).setVisibility(View.GONE);
        // 用列表容器承载自定义内容
        LinearLayout host = view.findViewById(R.id.app_dialog_list);
        host.setVisibility(View.VISIBLE);
        host.addView(content, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button pos = view.findViewById(R.id.app_dialog_positive);
        Button neu = view.findViewById(R.id.app_dialog_neutral);
        Button neg = view.findViewById(R.id.app_dialog_negative);
        AlertDialog dialog = new AlertDialog.Builder(context).setView(view).create();
        if (dialog.getWindow() != null)
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
        dialog.setCancelable(negative != null);
        if (positive == null) { pos.setVisibility(View.GONE); }
        else {
            pos.setVisibility(View.VISIBLE);
            pos.setText(positive);
            pos.setOnClickListener(v -> { dialog.dismiss(); if (onPositive != null) onPositive.run(); });
        }
        if (neutral == null) { neu.setVisibility(View.GONE); }
        else {
            neu.setVisibility(View.VISIBLE);
            neu.setText(neutral);
            neu.setOnClickListener(v -> { dialog.dismiss(); if (onNeutral != null) onNeutral.run(); });
        }
        if (negative == null) { neg.setVisibility(View.GONE); }
        else {
            neg.setVisibility(View.VISIBLE);
            neg.setText(negative);
            neg.setOnClickListener(v -> { dialog.dismiss(); if (onNegative != null) onNegative.run(); });
        }
        dialog.show();
        return dialog;
    }

    /** 美化列表弹窗：图标 + 标题 + 列表项（点击回调）+ 底部取消。用于插件操作菜单等。 */
    public static AlertDialog showList(Context context, @DrawableRes int iconRes, String title,
                                       String[] items, @Nullable ItemCallback onItem) {
        View view = View.inflate(context, R.layout.dialog_app, null);
        ImageView icon = view.findViewById(R.id.app_dialog_icon);
        if (iconRes == 0) { icon.setVisibility(View.GONE); }
        else { icon.setImageResource(iconRes); }
        ((TextView) view.findViewById(R.id.app_dialog_title)).setText(title);
        view.findViewById(R.id.app_dialog_message).setVisibility(View.GONE);
        view.findViewById(R.id.app_dialog_progress).setVisibility(View.GONE);

        LinearLayout list = view.findViewById(R.id.app_dialog_list);
        list.setVisibility(View.VISIBLE);

        Button pos = view.findViewById(R.id.app_dialog_positive);
        Button neu = view.findViewById(R.id.app_dialog_neutral);
        Button neg = view.findViewById(R.id.app_dialog_negative);
        pos.setVisibility(View.GONE);
        neu.setVisibility(View.GONE);

        AlertDialog dialog = new AlertDialog.Builder(context).setView(view).create();
        if (dialog.getWindow() != null)
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
        dialog.setCancelable(true);

        float density = context.getResources().getDisplayMetrics().density;
        int pad = (int) (13 * density + 0.5f);
        for (int i = 0; i < items.length; i++) {
            final int index = i;
            TextView row = new TextView(context);
            row.setText(items[i]);
            row.setTextSize(15);
            row.setTextColor(context.getResources().getColor(R.color.text));
            row.setPadding(pad, pad, pad, pad);
            row.setBackgroundResource(R.drawable.bg_action_plain);
            row.setOnClickListener(v -> { dialog.dismiss(); if (onItem != null) onItem.run(index); });
            list.addView(row);
        }

        neg.setVisibility(View.VISIBLE);
        neg.setText(UiText.text("取消"));
        ViewGroup.LayoutParams lp = neg.getLayoutParams();
        lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
        neg.setLayoutParams(lp);
        neg.setOnClickListener(v -> dialog.dismiss());

        dialog.show();
        return dialog;
    }

    /** 更新进度弹窗的百分比：0-100 显示具体进度；<0 回到不确定（转圈）。 */
    public static void setProgressPercent(AlertDialog dialog, int percent) {
        if (dialog == null) return;
        ProgressBar bar = dialog.findViewById(R.id.app_dialog_progress);
        TextView text = dialog.findViewById(R.id.app_dialog_progress_text);
        if (bar == null) return;
        if (percent < 0) {
            bar.setIndeterminate(true);
            if (text != null) text.setVisibility(View.GONE);
            return;
        }
        int value = Math.max(0, Math.min(100, percent));
        bar.setIndeterminate(false);
        bar.setMax(100);
        bar.setProgress(value);
        if (text != null) { text.setVisibility(View.VISIBLE); text.setText(value + "%"); }
    }

    /** 展示带进度条的弹窗；cancelText 非空时显示居中的「取消」按钮（等宽单按钮）。 */
    public static AlertDialog showProgress(Context context, @DrawableRes int iconRes, String title,
                                           String message, @Nullable String cancelText,
                                           @Nullable Callback onCancel) {
        View view = View.inflate(context, R.layout.dialog_app, null);
        ImageView icon = view.findViewById(R.id.app_dialog_icon);
        if (iconRes == 0) { icon.setVisibility(View.GONE); }
        else { icon.setImageResource(iconRes); }
        ((TextView) view.findViewById(R.id.app_dialog_title)).setText(title);
        TextView msg = view.findViewById(R.id.app_dialog_message);
        if (message == null || message.isEmpty()) { msg.setVisibility(View.GONE); }
        else { msg.setText(message); }
        ProgressBar bar = view.findViewById(R.id.app_dialog_progress);
        bar.setVisibility(View.VISIBLE);

        Button pos = view.findViewById(R.id.app_dialog_positive);
        Button neg = view.findViewById(R.id.app_dialog_negative);
        Button neu = view.findViewById(R.id.app_dialog_neutral);
        pos.setVisibility(View.GONE);
        neu.setVisibility(View.GONE);
        AlertDialog dialog = new AlertDialog.Builder(context).setView(view).create();
        if (dialog.getWindow() != null)
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
        dialog.setCancelable(false);
        if (cancelText == null) {
            neg.setVisibility(View.GONE);
        } else {
            neg.setVisibility(View.VISIBLE);
            neg.setText(cancelText);
            // 单按钮（取消）拉满整行并居中
            ViewGroup.LayoutParams lp = neg.getLayoutParams();
            lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
            neg.setLayoutParams(lp);
            final AlertDialog dlg = dialog;
            neg.setOnClickListener(v -> { dlg.dismiss(); if (onCancel != null) onCancel.run(); });
        }
        dialog.show();
        return dialog;
    }
}
