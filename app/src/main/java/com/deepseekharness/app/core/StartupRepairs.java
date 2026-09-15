package com.deepseekharness.app.core;

import android.content.Context;
import com.deepseekharness.app.util.BuiltinPlugins;
import com.deepseekharness.app.util.EnvironmentTaskGate;
import com.deepseekharness.app.util.SensitiveData;
import com.deepseekharness.app.util.ShellQuote;
import com.deepseekharness.app.util.UiText;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;

/** 原生恢复入口通过离线 Python 管理声明文件，不启动故障 Host 或执行插件代码。 */
public final class StartupRepairs {
    private StartupRepairs() { }

    public static boolean pending(Context context) {
        return new File(context.getFilesDir(), "startup-config-repair.pending").exists()
                || new File(context.getFilesDir(), "linux/ubuntu/root/.dsh/dsha-startup-checkpoints/pending.json").exists();
    }

    private static JSONObject result(String text, String prefix) throws IOException {
        for (String line : text.split("\n")) if (line.startsWith(prefix)) try {
            JSONObject result = new JSONObject(line.substring(prefix.length()));
            if (!"ok".equals(result.optString("status"))) throw new IOException(result.optString("message"));
            return result;
        } catch (JSONException error) {
            throw new IOException("RECOVERY_FORMAT", error);
        }
        throw new IOException(SensitiveData.redact(text));
    }

    public static JSONObject checkpoint(HarnessController controller, JSONObject request) throws IOException {
        return result(controller.proot().execAndReadWithProot(
                "python3 /root/.dsh/startup-checkpoints.py " + ShellQuote.arg(request.toString()), 30_000),
                "STARTUP_RECOVERY_RESULT=");
    }

    public static JSONObject list(HarnessController controller) throws Exception {
        return checkpoint(controller, new JSONObject().put("command", "list"));
    }

    public static JSONObject plugins(HarnessController controller) throws IOException {
        return result(controller.proot().runPluginManager("list"), "PLUGIN_RESULT: ");
    }

    public static String change(Context context, HarnessController controller, JSONObject request) throws Exception {
        File marker = new File(context.getFilesDir(), "startup-config-repair.pending");
        if (!marker.exists() && !marker.createNewFile()) throw new IOException("RECOVERY_PENDING");
        checkpoint(controller, request);
        if (list(controller).optBoolean("pending")) throw new IOException("RECOVERY_PENDING");
        if (!marker.delete() && marker.exists()) throw new IOException("RECOVERY_PENDING");
        return UiText.text("配置修复已完成，原配置快照已保留。可重试启动；已卸载的插件需要重新安装。");
    }

    public static String deletePlugin(HarnessController controller, String name) throws Exception {
        if (!name.matches("(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*")
                || BuiltinPlugins.internal(name)) throw new IOException("RECOVERY_PLUGIN");
        JSONArray items = plugins(controller).getJSONArray("items");
        boolean found = false;
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.getJSONObject(i);
            if (name.equals(item.optString("name")) && item.optBoolean("deletable")) found = true;
        }
        if (!found) throw new IOException("RECOVERY_PLUGIN");
        checkpoint(controller, new JSONObject().put("command", "before"));
        result(controller.proot().runPluginManager("delete " + ShellQuote.arg(name)), "PLUGIN_RESULT: ");
        return UiText.text("插件已卸载，可重试启动：") + name;
    }

    public static void healthy(Context context, HarnessController controller, long generation) {
        if (pending(context) || controller.getWebGeneration() != generation
                || !controller.startupDiagnostics().snapshot().browserReady) return;
        EnvironmentTaskGate.Lease lease = EnvironmentTaskGate.tryAcquire("启动配置快照");
        if (lease == null) return;
        try (lease) {
            lease.run(() -> {
                if (controller.getWebGeneration() == generation && !controller.isStopping())
                    checkpoint(controller, new JSONObject().put("command", "healthy")
                            .put("startupId", controller.startupDiagnostics().recordId()));
                return null;
            });
        } catch (Exception error) {
            DiagnosticLog.record(context, "STARTUP_CHECKPOINT", SensitiveData.redact(String.valueOf(error)));
        }
    }
}
