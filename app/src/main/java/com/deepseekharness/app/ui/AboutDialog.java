package com.deepseekharness.app.ui;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;

/** 关于对话框：GitHub 仓库 / QQ 交流群入口（欢迎页 + 设置页 + 顶栏共用）。 */
public final class AboutDialog {

    public static final String GITHUB_URL = "https://github.com/xliaoy/DeepSeekHarness";
    public static final String QQ_GROUP = "1125393952";

    private AboutDialog() {
    }

    public static AlertDialog show(Context ctx) {
        String version = "unknown";
        try {
            version = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
        } catch (Exception ignored) {
        }
        return AppDialogs.show(ctx, android.R.drawable.ic_dialog_info,
                "DeepSeek Harness v" + version,
                com.deepseekharness.app.util.UiText.text("DeepSeek Harness 安卓启动器\n")
                        + ctx.getString(com.deepseekharness.app.R.string.edition_description) + "\n\n"
                        + com.deepseekharness.app.util.UiText.text("🌟 GitHub：") + GITHUB_URL + "\n"
                        + com.deepseekharness.app.util.UiText.text("🐧 QQ 交流群：") + QQ_GROUP,
                "GitHub", com.deepseekharness.app.util.UiText.text("QQ 群"), com.deepseekharness.app.util.UiText.text("关闭"),
                () -> openBrowser(ctx, GITHUB_URL), () -> openQQGroup(ctx));
    }

    public static void openBrowser(Context ctx, String url) {
        try {
            ctx.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception e) {
            Toast.makeText(ctx, com.deepseekharness.app.util.UiText.text("打不开，请手动访问：") + url, Toast.LENGTH_SHORT).show();
        }
    }

    public static void openQQGroup(Context ctx) {
        try {
            ctx.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(
                    "mqqapi://card/show_pslcard?src_type=internal&version=1"
                            + "&uin=" + QQ_GROUP + "&card_type=group"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception e) {
            Toast.makeText(ctx, com.deepseekharness.app.util.UiText.text("打不开 QQ，请手动搜索群号：") + QQ_GROUP, Toast.LENGTH_SHORT).show();
        }
    }
}
