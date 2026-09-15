package com.deepseekharness.app.core;

import android.app.Application;
import androidx.lifecycle.AndroidViewModel;
import androidx.lifecycle.MutableLiveData;
import com.deepseekharness.app.util.EnvironmentTaskGate;
import com.deepseekharness.app.util.SensitiveData;
import com.deepseekharness.app.util.StartupHistoryStore;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Collections;
import java.util.List;

/** 页面重建保留读取任务；修复执行权仍归应用级 BackupTask。 */
public final class StartupRecoveryModel extends AndroidViewModel {
    public final MutableLiveData<JSONObject> contents = new MutableLiveData<>();
    public final MutableLiveData<String> error = new MutableLiveData<>("");
    public final MutableLiveData<Boolean> loading = new MutableLiveData<>(false);
    public List<StartupHistoryStore.Entry> attempts = Collections.emptyList();
    private volatile boolean working;

    public StartupRecoveryModel(Application app) {
        super(app);
    }

    public void load() {
        if (working) return;
        working = true;
        loading.setValue(true);
        new Thread(() -> {
            try {
                HarnessController controller = HarnessController.get(getApplication());
                attempts = controller.startupDiagnostics().history();
                JSONObject out = new JSONObject().put("snapshots", new JSONArray()).put("items", new JSONArray());
                if (controller.isEnvironmentReady()
                        && !com.deepseekharness.app.BackupManager.hasPendingMaintenance(controller)) {
                    EnvironmentTaskGate.Lease lease = EnvironmentTaskGate.tryAcquire("读取启动恢复记录");
                    if (lease == null) throw new java.io.IOException("RECOVERY_BUSY");
                    try (lease) {
                        lease.run(() -> {
                            controller.proot().ensureRuntimeFiles();
                            JSONObject snapshots = StartupRepairs.list(controller);
                            out.put("snapshots", snapshots.getJSONArray("snapshots"));
                            out.put("pending", snapshots.optBoolean("pending"));
                            // 配置损坏时仍显示诊断与配置快照；插件清单单独报告读取失败。
                            try {
                                out.put("items", StartupRepairs.plugins(controller).getJSONArray("items"));
                            } catch (Exception failure) {
                                out.put("pluginError", SensitiveData.redact(String.valueOf(failure.getMessage())));
                            }
                            return null;
                        });
                    }
                }
                error.postValue("");
                contents.postValue(out);
            } catch (Exception failure) {
                error.postValue(SensitiveData.redact(String.valueOf(failure.getMessage())));
            } finally {
                working = false;
                loading.postValue(false);
            }
        }, "startup-recovery-read").start();
    }
}
