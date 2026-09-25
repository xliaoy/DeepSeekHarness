package com.deepseekharness.app.ui;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import androidx.lifecycle.ViewModelProvider;
import com.deepseekharness.app.BuildConfig;
import com.deepseekharness.app.R;
import com.deepseekharness.app.core.UpdateRepository;
import com.deepseekharness.app.util.UpdatePolicy;

/** 更新由用户选择通道和确认安装；下载任务不依赖页面生命周期。 */
public final class UpdateActivity extends AppCompatActivity {
    private UpdateRepository repository;
    private boolean resumeInstall;
    private boolean installDispatchReady;
    /** 「软件更新」自选版本列表（首项为自动选择，故比 releases 多一项）。 */
    private java.util.List<UpdatePolicy.Release> versionOptions;
    private DeepSeekHarnessSelectView versionChoice;
    /** 「运行时更新」可安装版本列表。 */
    private java.util.ArrayList<String> runtimeOptions = new java.util.ArrayList<>();
    private DeepSeekHarnessSelectView runtimeVersionChoice;
    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved); setContentView(R.layout.activity_update);
        // 软件更新 / 运行时更新 tab 切换。
        android.widget.TextView tabApp = findViewById(R.id.update_tab_app);
        android.widget.TextView tabRuntime = findViewById(R.id.update_tab_runtime);
        android.view.View contentApp = findViewById(R.id.update_tab_app_content);
        android.view.View contentRuntime = findViewById(R.id.update_tab_runtime_content);
        java.util.function.Consumer<Boolean> showApp = appFirst -> {
            tabApp.setBackgroundResource(appFirst ? R.drawable.bg_tab_on : R.drawable.bg_tab);
            tabRuntime.setBackgroundResource(appFirst ? R.drawable.bg_tab : R.drawable.bg_tab_on);
            tabApp.setTextColor(getColor(appFirst ? R.color.primary : R.color.text_secondary));
            tabRuntime.setTextColor(getColor(appFirst ? R.color.text_secondary : R.color.primary));
            contentApp.setVisibility(appFirst ? android.view.View.VISIBLE : android.view.View.GONE);
            contentRuntime.setVisibility(appFirst ? android.view.View.GONE : android.view.View.VISIBLE);
        };
        tabApp.setOnClickListener(v -> showApp.accept(true));
        tabRuntime.setOnClickListener(v -> showApp.accept(false));
        showApp.accept(true);
        repository = new ViewModelProvider(this).get(UpdateRepository.class);
        resumeInstall = saved != null && saved.getBoolean("resumeInstall");
        repository.restoreInterruptedInstall(saved != null && saved.getBoolean("installPending"));
        ((TextView)findViewById(R.id.update_current)).setText(BuildConfig.VERSION_NAME);
        ((TextView)findViewById(R.id.update_code)).setText(String.valueOf(BuildConfig.VERSION_CODE));
        ((TextView)findViewById(R.id.update_edition)).setText(BuildConfig.LOW_ANDROID?com.deepseekharness.app.util.UiText.choose("兼容版","Compatibility"):com.deepseekharness.app.util.UiText.choose("标准版","Standard"));
        RadioGroup channels = findViewById(R.id.update_channels);
        channels.check(UpdatePolicy.PREVIEW.equals(repository.channel()) ? R.id.update_preview : R.id.update_stable);
        channels.setOnCheckedChangeListener((g, id) -> repository.setChannel(id == R.id.update_preview ? UpdatePolicy.PREVIEW : UpdatePolicy.STABLE));
        DeepSeekHarnessSelectView channel=findViewById(R.id.update_channel_choice);channel.setPrompt(getString(R.string.ui2_update_channel));
        channel.setAdapter(new android.widget.ArrayAdapter<>(this,R.layout.item_data_choice,new String[]{getString(R.string.ui_m0173),getString(R.string.ui_m0215)}));channel.setSelection(UpdatePolicy.PREVIEW.equals(repository.channel())?1:0);
        channel.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){public void onNothingSelected(android.widget.AdapterView<?> parent){}public void onItemSelected(android.widget.AdapterView<?> parent,android.view.View view,int position,long id){channels.check(position==1?R.id.update_preview:R.id.update_stable);}});
        // 软件更新：自选版本（含旧版本，仅可下载——Android 不允许降级安装）。
        versionChoice = findViewById(R.id.update_version_choice);
        versionChoice.setPrompt(getString(R.string.ui2_update_section_app));
        versionChoice.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){
            public void onNothingSelected(android.widget.AdapterView<?> parent){}
            public void onItemSelected(android.widget.AdapterView<?> parent,android.view.View view,int position,long id){
                if (versionOptions == null || position < 0 || position >= versionOptions.size()) return;
                // 首项是「自动选择最新」；其余是具体版本。
                repository.selectVersion(position == 0 ? null : versionOptions.get(position).version);
            }
        });
        findViewById(R.id.update_back).setOnClickListener(v -> finish());
        ((TextView)findViewById(R.id.update_dsh)).setText(com.deepseekharness.app.util.Constants.DSH_VERSION);
        findViewById(R.id.update_runtime).setOnClickListener(v->showRuntimePlan());
        findViewById(R.id.update_runtime_rollback).setOnClickListener(v->RuntimeRecoveryUi.show(this));

        findViewById(R.id.update_changelog).setOnClickListener(v->CardSheet.show(this,getString(R.string.ui134_changelog),com.deepseekharness.app.util.UiText.choose("DeepSeekHarness 0.1.7-alpha2\n\n• 修复画中画流式文字闪烁，统一数据与备份入口布局。\n• 优化 Language 弹窗首帧布局，补齐插件面板标题避让。\n• 标准版新增 Android 11+ 实验性虚拟屏；兼容版暂不支持。\n• 保留 DSH 0.1.7-alpha.2、个人数据、插件和配置迁移路径。", "DeepSeekHarness 0.1.7-alpha2\n\n• Fixed streaming text flicker in PiP and aligned data/backup entries.\n• Reduced first-frame work in the Language dialog and added plugin-panel clearance.\n• Added an experimental Android 11+ virtual screen to Standard; Low does not support it yet.\n• Kept DSH 0.1.7-alpha.2, personal data, plugins and configuration migration intact.")));
        findViewById(R.id.update_release_detail).setOnClickListener(v->{UpdateRepository.State state=repository.state().getValue();if(state!=null&&state.release!=null)CardSheet.show(this,getString(R.string.ui134_candidate),((TextView)findViewById(R.id.update_notes)).getText().toString());});
        findViewById(R.id.update_check).setOnClickListener(v -> repository.check());
        findViewById(R.id.update_download).setOnClickListener(v -> {
            if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 104);
            else repository.download();
        });
        findViewById(R.id.update_cancel).setOnClickListener(v -> repository.cancel());
        findViewById(R.id.update_install).setOnClickListener(v -> install());
        findViewById(R.id.update_browser).setOnClickListener(v -> {
            UpdateRepository.State state = repository.state().getValue();
            AboutDialog.openBrowser(this, state != null && state.release != null ? state.release.pageUrl
                    : "https://github.com/xliaoy/DeepSeekHarness/releases");
        });
        repository.state().observe(this, this::renderState);
        repository.installation().observe(this, state -> {
            renderState(repository.state().getValue());
            dispatchInstall();
        });
        if (saved == null && !repository.hasTask()) repository.check();
        bindRuntimeSection();
    }

    /**
     * 运行时更新：与「软件更新」完全独立的一条链路。
     *
     * <p>软件更新换的是本 App 的 APK（交给系统安装器安装）；运行时更新换的是 proot 容器里的
     * DeepSeek Harness 运行时（容器内替换文件）。两者版本列表、下载源、生效方式都不同，
     * 因此界面上必须分成两个入口，避免用户以为「更新了 App 就等于更新了运行时」。
     */
    private void bindRuntimeSection() {
        runtimeVersionChoice = findViewById(R.id.update_runtime_version_choice);
        runtimeVersionChoice.setPrompt(getString(R.string.ui2_update_section_runtime));
        runtimeVersionChoice.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){
            public void onNothingSelected(android.widget.AdapterView<?> parent){}
            public void onItemSelected(android.widget.AdapterView<?> parent,android.view.View view,int position,long id){
                if (runtimeOptions == null || position < 0 || position >= runtimeOptions.size()) return;
                // 首项是「跟随上游最新」；其余是具体运行时版本（允许回退）。
                updater().selectVersion(position == 0 ? null : runtimeOptions.get(position));
            }
        });
        findViewById(R.id.update_runtime_check).setOnClickListener(v -> updater().check());
        findViewById(R.id.update_runtime_apply).setOnClickListener(v -> updater().update());
        updater().state().observe(this, this::renderRuntimeState);
        // 已有检查结果就直接用，避免每次进页面都联网。
        com.deepseekharness.app.core.DshUpdater.State current = updater().state().getValue();
        if (current == null || current.currentVersion == null) updater().check();
        else renderRuntimeState(current);
    }

    private com.deepseekharness.app.core.DshUpdater updater() {
        return com.deepseekharness.app.core.DshUpdater.get(this);
    }

    /** 运行时区块渲染：状态文案 + 版本列表 + 回退提示。 */
    private void renderRuntimeState(com.deepseekharness.app.core.DshUpdater.State state) {
        if (state == null) return;
        TextView status = findViewById(R.id.update_runtime_status);
        if (status != null) status.setText(com.deepseekharness.app.util.UiStateText.render(state.message));
        java.util.ArrayList<String> versions = updater().availableVersions();
        String selected = updater().requestedVersion();
        if (!versions.equals(runtimeOptions)) {
            runtimeOptions = versions;
            java.util.ArrayList<String> labels = new java.util.ArrayList<>();
            labels.add(com.deepseekharness.app.util.UiText.text("自动选择最新"));
            labels.addAll(versions);
            runtimeVersionChoice.setAdapter(new android.widget.ArrayAdapter<>(this, R.layout.item_data_choice, labels));
            runtimeVersionChoice.setSelection(selected == null ? 0 : Math.max(0, versions.indexOf(selected) + 1));
        }
        TextView hint = findViewById(R.id.update_runtime_version_hint);
        if (hint != null) {
            boolean rollback = selected != null && updater().isRollback(selected);
            if (selected == null) hint.setVisibility(android.view.View.GONE);
            else {
                hint.setVisibility(android.view.View.VISIBLE);
                hint.setText(rollback
                        ? com.deepseekharness.app.util.UiText.text("将回退到旧版本 ") + selected + com.deepseekharness.app.util.UiText.text("：运行时在容器内替换，允许回退，完成后需重启运行时。")
                        : com.deepseekharness.app.util.UiText.text("已选择运行时版本 ") + selected);
            }
        }
        android.view.View apply = findViewById(R.id.update_runtime_apply);
        if (apply != null) apply.setVisibility(state.busy ? android.view.View.GONE : android.view.View.VISIBLE);
        android.view.View check = findViewById(R.id.update_runtime_check);
        if (check != null) check.setEnabled(!state.busy);
    }
    private void showRuntimePlan(){
        CardPage page=new CardPage(this,getString(R.string.ui2_managed_update),com.deepseekharness.app.util.UiText.choose("查看当前环境与包内运行组件。","Review the current environment and bundled components."));
        android.widget.LinearLayout metadata=page.card();page.kv(metadata,"Ubuntu",bundledBase());
        page.kv(metadata,"DSH",com.deepseekharness.app.util.Constants.DSH_VERSION);page.kv(metadata,com.deepseekharness.app.util.UiText.choose("个人数据","Personal data"),com.deepseekharness.app.util.UiText.choose("保持原位","Kept in place"));
        metadata.addView(page.text(com.deepseekharness.app.util.UiText.choose("检查后展示实际差异；确认更新时停止 Web 与终端，准备候选并完成隔离试运行。","Review actual differences first. Updating stops Web and terminals, prepares a candidate and verifies it in an isolated trial."),12,R.color.text_secondary));
        var dialog=CardSheet.create(this,page);page.button(page.footer,com.deepseekharness.app.util.UiText.choose("检查更新计划","Review update plan"),true,()->{dialog.dismiss();startActivity(new Intent(this,ExtractActivity.class).putExtra("review_only",true));});page.button(page.footer,com.deepseekharness.app.util.UiText.choose("取消","Cancel"),false,dialog::dismiss);CardSheet.show(dialog,this);
    }
    private String bundledBase(){try(java.io.InputStream input=getAssets().open("offline-rootfs.version")){byte[] bytes=new byte[64];int count=input.read(bytes);return count>0?new String(bytes,0,count,java.nio.charset.StandardCharsets.UTF_8).trim():"—";}catch(java.io.IOException unavailable){return "—";}}
    /**
     * 「软件更新」自选版本。
     *
     * <p>列表来自 GitHub Releases 的完整版本数组；旧版本照样列出，但会明确提示
     * 「Android 不允许降级安装，仅可下载」，不做静默失败。
     */
    private void renderVersionChoice(UpdateRepository.State state) {
        java.util.List<UpdatePolicy.Release> releases = repository.availableReleases();
        String selected = repository.requestedVersion();
        boolean changed = versionOptions == null || versionOptions.size() != releases.size();
        if (!changed) {
            for (int i = 0; i < releases.size(); i++) {
                if (!versionOptions.get(i).version.equals(releases.get(i).version)) { changed = true; break; }
            }
        }
        if (changed) {
            versionOptions = releases;
            java.util.ArrayList<String> labels = new java.util.ArrayList<>();
            labels.add(com.deepseekharness.app.util.UiText.text("自动选择最新"));
            for (UpdatePolicy.Release r : releases) labels.add(r.version);
            versionChoice.setAdapter(new android.widget.ArrayAdapter<>(this, R.layout.item_data_choice, labels));
            int position = 0;
            if (selected != null) {
                for (int i = 0; i < releases.size(); i++) {
                    if (selected.equals(releases.get(i).version)) { position = i + 1; break; }
                }
            }
            versionChoice.setSelection(position);
        }
        versionChoice.setEnabled(!state.busy && !repository.installationPending());
        TextView hint = findViewById(R.id.update_version_hint);
        if (hint == null) return;
        UpdatePolicy.Release release = state.release;
        if (selected == null || release == null) { hint.setVisibility(android.view.View.GONE); return; }
        hint.setVisibility(android.view.View.VISIBLE);
        if (repository.downgrade()) {
            hint.setText(com.deepseekharness.app.util.UiText.text("已选旧版本 ") + release.version
                    + com.deepseekharness.app.util.UiText.text("：Android 不允许降级安装，只能下载留存，点「安装」会被系统拒绝。"));
        } else {
            hint.setText(com.deepseekharness.app.util.UiText.text("已选版本 ") + release.version);
        }
    }

    private void renderState(UpdateRepository.State state) {
        if (state == null) return;
        findViewById(R.id.update_channel_choice).setEnabled(!state.busy&&!repository.installationPending());
        renderVersionChoice(state);
        UpdateRepository.InstallState install = repository.installation().getValue();
        UpdateUi.render(findViewById(android.R.id.content), state, install.pending(), install.verifying);
        if (install.pending()) {
            ((TextView) findViewById(R.id.update_status)).setText(install.verifying
                    ? com.deepseekharness.app.util.UiText.text("正在重新校验安装包…") : com.deepseekharness.app.util.UiText.text("校验完成，返回此页面后继续安装"));
        } else if (install.error != null) {
            ((TextView) findViewById(R.id.update_status)).setText(com.deepseekharness.app.util.UiStateText.render(state.message) + "\n" + com.deepseekharness.app.util.UiStateText.render(install.error));
        }
    }

    private void install() {
        if (repository.installationPending()) return;
        try {
            if (android.os.Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                resumeInstall = true;
                startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()))); return;
            }
            repository.requestInstall();
        } catch (Exception error) { resumeInstall = false; showInstallError(error); }
    }
    private void dispatchInstall() {
        if (!installDispatchReady || isFinishing() || isDestroyed() || getSupportFragmentManager().isStateSaved()) return;
        java.io.File apk = repository.takeInstallReady();
        if (apk == null) return;
        try {
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".updates", apk);
            startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
        } catch (Exception error) { showInstallError(error); }
    }
    private void showInstallError(Exception error) {
        repository.installFailed(com.deepseekharness.app.util.UiText.text("无法安装：") + error.getMessage() + com.deepseekharness.app.util.UiText.text("；可重试"));
        Toast.makeText(this, repository.installation().getValue().error, Toast.LENGTH_LONG).show();
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == 104) repository.download();
    }
    @Override protected void onSaveInstanceState(Bundle saved) {
        saved.putBoolean("resumeInstall", resumeInstall);
        saved.putBoolean("installPending", repository.installationPending());
        super.onSaveInstanceState(saved);
    }
    @Override protected void onResume() {
        super.onResume();
        if (resumeInstall) {
            resumeInstall = false;
            if (android.os.Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls()) install();
            else Toast.makeText(this, com.deepseekharness.app.util.UiText.text("未允许安装更新，可稍后重试"), Toast.LENGTH_SHORT).show();
        }
    }
    @Override protected void onPostResume() {
        super.onPostResume();
        installDispatchReady = true;
        dispatchInstall();
    }
    @Override protected void onPause() {
        installDispatchReady = false;
        super.onPause();
    }
}
