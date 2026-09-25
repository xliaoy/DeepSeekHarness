package com.deepseekharness.app.core;

import android.app.Activity;
import android.app.Application;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.lifecycle.ViewModelProvider;
import com.deepseekharness.app.R;
import com.deepseekharness.app.ui.MainActivity;
import java.io.File;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Collections;
import java.util.function.BooleanSupplier;

/** 真实 HTTPS 下载中的插件阶段、旋转和取消；只解析独立归档，不确认安装。 */
public final class PluginUiInstrumentation extends Instrumentation {
    private volatile MainActivity page;
    private PluginRepository repository;
    private final Application.ActivityLifecycleCallbacks lifecycle = new Application.ActivityLifecycleCallbacks() {
        public void onActivityCreated(Activity a, Bundle b) { }
        public void onActivityStarted(Activity a) { }
        public void onActivityResumed(Activity a) { if (a instanceof MainActivity) page = (MainActivity) a; }
        public void onActivityPaused(Activity a) { }
        public void onActivityStopped(Activity a) { }
        public void onActivitySaveInstanceState(Activity a, Bundle b) { }
        public void onActivityDestroyed(Activity a) { }
    };
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    private void require(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    private void until(BooleanSupplier ready, String reason) throws Exception {
        long deadline = System.currentTimeMillis()+90000;
        while (!ready.getAsBoolean() && System.currentTimeMillis()<deadline) Thread.sleep(100);
        require(ready.getAsBoolean(), reason);
    }
    private void phase(String message) { Bundle b = new Bundle(); b.putString("phase", message); sendStatus(1, b); }
    private void shell(String command) throws Exception {
        try (android.os.ParcelFileDescriptor p = getUiAutomation().executeShellCommand(command);
             InputStream input = new android.os.ParcelFileDescriptor.AutoCloseInputStream(p)) { while (input.read() != -1) { } }
    }
    /** 在线/命令行安装对话框里的输入框：它是当前 AlertDialog 中唯一的 EditText。 */
    private EditText findInstallDialogInput() {
        for (android.app.Dialog dialog : visibleDialogs()) {
            android.view.View root = dialog.getWindow() == null ? null : dialog.getWindow().getDecorView();
            if (root == null) continue;
            EditText found = findFirst(root, EditText.class);
            if (found != null) return found;
        }
        return null;
    }

    /** 点击对话框的「安装」按钮（BUTTON_POSITIVE），走真实用户确认路径。 */
    private void clickInstallDialogPositive() {
        for (android.app.Dialog dialog : visibleDialogs()) {
            if (dialog instanceof androidx.appcompat.app.AlertDialog) {
                android.widget.Button positive = ((androidx.appcompat.app.AlertDialog) dialog).getButton(android.content.DialogInterface.BUTTON_POSITIVE);
                if (positive != null && positive.isShown()) { positive.performClick(); return; }
            }
        }
    }

    private <T extends android.view.View> T findFirst(android.view.View root, Class<T> type) {
        if (type.isInstance(root) && root.getVisibility() == android.view.View.VISIBLE) return type.cast(root);
        if (root instanceof android.view.ViewGroup) {
            android.view.ViewGroup group = (android.view.ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                T found = findFirst(group.getChildAt(i), type);
                if (found != null) return found;
            }
        }
        return null;
    }

    /** 当前正在显示的对话框：无商城版把忙/进度从内联控件改到了 AppDialogs 进度对话框。 */
    private java.util.List<android.app.Dialog> visibleDialogs() {
        java.util.List<android.app.Dialog> result = new ArrayList<>();
        runOnMainSync(() -> {
            result.clear();
            androidx.appcompat.app.AlertDialog progress = progressDialogOf(page);
            if (progress != null && progress.isShowing()) result.add(progress);
        });
        return result;
    }

    private androidx.appcompat.app.AlertDialog findVisibleProgressDialog() {
        java.util.List<android.app.Dialog> dialogs = visibleDialogs();
        return dialogs.isEmpty() ? null : (androidx.appcompat.app.AlertDialog) dialogs.get(0);
    }

    /** 读取 PluginFragment 持有的进度对话框字段。 */
    private androidx.appcompat.app.AlertDialog progressDialogOf(androidx.fragment.app.FragmentActivity activity) {
        for (androidx.fragment.app.Fragment fragment : activity.getSupportFragmentManager().getFragments()) {
            if (!(fragment instanceof PluginFragment)) continue;
            try {
                java.lang.reflect.Field field = PluginFragment.class.getDeclaredField("progressDialog");
                field.setAccessible(true);
                return (androidx.appcompat.app.AlertDialog) field.get(fragment);
            } catch (ReflectiveOperationException ignored) { return null; }
        }
        return null;
    }

    private android.widget.Button progressDialogCancelButton() {
        androidx.appcompat.app.AlertDialog dialog = findVisibleProgressDialog();
        return dialog == null ? null : dialog.getButton(android.content.DialogInterface.BUTTON_NEGATIVE);
    }

    private ProgressBar progressDialogProgressBar() {
        androidx.appcompat.app.AlertDialog dialog = findVisibleProgressDialog();
        android.view.View root = dialog == null || dialog.getWindow() == null ? null : dialog.getWindow().getDecorView();
        return root == null ? new ProgressBar(getTargetContext()) : findFirst(root, ProgressBar.class);
    }

    private String installed() {
        ArrayList<String> result = new ArrayList<>();
        for (PluginRepository.Item item : repository.state().getValue().items) result.add(item.name+":"+item.version+":"+item.enabled);
        Collections.sort(result); return result.toString();
    }
    private String downloads(File home) {
        String[] names = home.list((dir, name) -> name.startsWith("plugin-download-") || name.startsWith("plugin-inspect-"));
        if (names == null) return "";
        java.util.Arrays.sort(names); return java.util.Arrays.toString(names);
    }
    @Override public void onStart() {
        Bundle output = new Bundle();
        Application app = (Application) getTargetContext().getApplicationContext();
        app.registerActivityLifecycleCallbacks(lifecycle);
        try {
            shell("am start -W -n com.deepseek.harness/com.deepseekharness.app.ui.MainActivity");
            startActivitySync(new Intent(app, MainActivity.class).setAction("deepseekharness.test.plugin."+System.nanoTime()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            until(() -> page != null, "主界面未就绪");
            runOnMainSync(() -> ((com.google.android.material.bottomnavigation.BottomNavigationView) page.findViewById(R.id.bottom_nav)).setSelectedItemId(R.id.nav_plugins));
            until(() -> page.findViewById(R.id.pluginList) != null, "插件页没有加载");
            runOnMainSync(() -> repository = new ViewModelProvider(page).get(PluginRepository.class));
            until(() -> !repository.isBusy(), "插件状态没有同步");
            String before = installed();
            File rootfs = HarnessController.get(app).proot().getRootfsDir(), home = new File(rootfs, "root/.dsh");
            String oldDownloads = downloads(home);
            // 无商城版：内联链接输入区（appbar_github_input + btnPluginInstall）已移除，
            // 安装改由「在线安装」按钮弹出的对话框承载。此处按真实用户路径驱动对话框：
            // 点按钮 → 在对话框 EditText 里填地址 → 点「安装」。
            runOnMainSync(() -> page.findViewById(R.id.btnOnlineInstall).performClick());
            waitForIdleSync();
            EditText installInput = findInstallDialogInput();
            require(installInput != null, "在线安装对话框没有打开");
            runOnMainSync(() -> installInput.setText("https://deepseekharness-test.invalid/opt-plugin-cancel-6cb498ed.zip"));
            waitForIdleSync();
            runOnMainSync(() -> clickInstallDialogPositive());
            until(() -> repository.state().getValue().percent > 0 || !repository.isBusy(), "没有下载进度");
            require(repository.isBusy(), repository.state().getValue().message);
            require(repository.state().getValue().message.contains("MiB"), "未显示实际下载字节");
            require(progressDialogCancelButton() != null && progressDialogCancelButton().isEnabled(), "下载阶段不能取消");
            require(!((ProgressBar)progressDialogProgressBar()).isIndeterminate(), "有长度的下载没有百分比");
            Field taskField = PluginRepository.class.getDeclaredField("activeTask"); taskField.setAccessible(true);
            PluginTask task = (PluginTask) taskField.get(repository);
            phase("真实下载已显示阶段与百分比；重建插件页面");
            MainActivity old = page; runOnMainSync(old::recreate);
            until(() -> page != old && page.findViewById(R.id.pluginList) != null, "页面重建失败");
            PluginRepository[] recreated = new PluginRepository[1]; runOnMainSync(() -> recreated[0] = new ViewModelProvider(page).get(PluginRepository.class));
            require(recreated[0] == repository, "页面重建丢失任务");
            // Activity 重建后进度对话框会重新挂载，取消能力必须仍然可达。
            until(() -> progressDialogCancelButton() != null, "重建后进度对话框没有恢复");
            require(repository.isBusy() && progressDialogCancelButton().isEnabled(), "重建后取消状态丢失");
            runOnMainSync(() -> progressDialogCancelButton().performClick());
            until(() -> !repository.isBusy(), "取消未退出");
            require(repository.state().getValue().message.contains("取消"), repository.state().getValue().message);
            require(repository.preview().getValue() == null && !repository.installationSucceeded(), "取消后仍可安装");
            require(installed().equals(before), "取消改动了已安装插件");
            require(downloads(home).equals(oldDownloads), "取消留下了临时下载目录");
            for (String suffix : new String[]{".json", ".json.tmp", ".cancel"}) require(!new File(rootfs, "root/.deepseekharness-plugin-task-"+task.id+suffix).exists(), "任务信号没有清理");
            require(findVisibleProgressDialog() == null, "任务结束后仍显示进度对话框");
            require(repository.state().getValue().message.contains("取消"), "取消结果没有回到状态");
            output.putString("result", "PASS");
            output.putString("coverage", "真实 HTTPS 插件下载阶段/字节/百分比、Activity 重建保留同一任务、界面取消、临时目录/信号清理、既有插件保持原状态；未确认安装");
        } catch (Throwable error) { output.putString("result", "FAIL: "+error); }
        finally {
            if (repository != null) {
                runOnMainSync(repository::cancelTask);
                try { until(() -> !repository.isBusy(), "测试任务清理失败"); } catch (Exception ignored) { }
                runOnMainSync(repository::discardPreview);
            }
            if (page != null) { Activity current = page; runOnMainSync(current::finish); }
            app.unregisterActivityLifecycleCallbacks(lifecycle);
        }
        finish("PASS".equals(output.getString("result")) ? Activity.RESULT_OK : Activity.RESULT_CANCELED, output);
    }
}
