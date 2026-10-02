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

/** 更新由用户选择通道和确认安装；下载任务不依赖页面生命周期。
 *  两个 tab：更新 App 本体（自选版本，只允许升级）与更新 DeepSeek Harness 运行时（自选版本，只允许升级，可查看更新日志）。 */
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
    /** 最近一次已弹过更新日志的版本，避免程序化重设选中时重复弹窗。 */
    private String lastShownAppNotes, lastShownRuntimeNotes;
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
        // 软件更新：自选版本（只允许升级；列表只含比当前新的版本）。
        versionChoice = findViewById(R.id.update_version_choice);
        versionChoice.setPrompt(getString(R.string.ui2_update_section_app));
        versionChoice.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){
            public void onNothingSelected(android.widget.AdapterView<?> parent){}
            public void onItemSelected(android.widget.AdapterView<?> parent,android.view.View view,int position,long id){
                if (versionOptions == null) return;
                // 首项是「自动选择最新」；其余是具体版本（列表含首项，故版本索引 = position - 1）。
                String version;
                if (position <= 0) version = null;
                else if (position > versionOptions.size()) return;
                else version = versionOptions.get(position - 1).version;
                repository.selectVersion(version);
                if (version != null && !version.equals(lastShownAppNotes)) {
                    lastShownAppNotes = version;
                    showAppVersionNotes(version);
                }
            }
        });
        findViewById(R.id.update_back).setOnClickListener(v -> finish());
        ((TextView)findViewById(R.id.update_dsh)).setText(com.deepseekharness.app.util.Constants.DSH_VERSION);
        findViewById(R.id.update_runtime).setOnClickListener(v->showRuntimePlan());
        findViewById(R.id.update_runtime_rollback).setOnClickListener(v->RuntimeRecoveryUi.show(this));

        findViewById(R.id.update_changelog).setOnClickListener(v->CardSheet.show(this,getString(R.string.ui134_changelog),com.deepseekharness.app.util.UiText.choose("DeepSeekHarness 0.1.7-rc2\n\n• 修复旧 Web PID 被复用时的启动阻塞，以及应急对话请求扩展失败。\n• 补齐录音与音频设备权限，支持 WebView、Gecko 和应急页面的按需麦克风授权。\n• 相同应急归档在安装包内只存一份，保留独立离线恢复能力并减少约 208 MB。\n• 新增独立应急 DSH：正式环境维护失败时仍可准备空白修复工作台。\n• AI 通过受控工具诊断、提出候选；原生页面逐次确认，核验停止屏障和原件后执行修复。\n• 应急运行时单独锁定，启动、鉴权、进程与正式环境分开记录。\n• 内置移动插件同步 3.0.3 源码修订 a094288，保留手机快捷键搜索，改善插件返回、弹层焦点与短屏操作。\n• DSH 继续为 0.1.7-rc.2，保留既有迁移和数据保护流程。", "DeepSeekHarness 0.1.7-rc2\n\n• Fixed startup blocking after a stale Web PID is reused and an emergency chat request-extension failure.\n• Added recording and audio-device permissions for on-demand microphone access in WebView, Gecko and emergency pages.\n• Store identical emergency archives once, saving about 208 MB while retaining independent offline recovery.\n• Added an independent emergency DSH workspace for failures in the regular environment.\n• Controlled AI tools diagnose and propose repairs. Each write requires native confirmation, verified process shutdown and original-data protection.\n• Emergency runtime assets, authentication and process identities are tracked separately.\n• Updated mobile plugin 3.0.3 to source revision a094288, retaining phone shortcut search and improving plugin navigation, focus and short-screen controls.\n• DSH remains 0.1.7-rc.2 with existing migration and data protection.")));
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

    /** 自选 App 版本后直接查看该版本的更新日志（列表里的 release 自带 notes）。 */
    private void showAppVersionNotes(String version) {
        if (versionOptions == null) return;
        for (UpdatePolicy.Release r : versionOptions) {
            if (version.equals(r.version)) {
                String notes = r.notes == null || r.notes.trim().isEmpty()
                        ? com.deepseekharness.app.util.UiText.text("该版本暂无更新日志") : r.notes;
                CardSheet.show(this, getString(R.string.ui134_candidate) + " · " + version, notes);
                return;
            }
        }
        CardSheet.show(this, version, com.deepseekharness.app.util.UiText.text("该版本暂无更新日志"));
    }

    /** 自选运行时版本后直接查看该版本的更新日志（按 GitHub tag 拉取）。 */
    private void showRuntimeVersionNotes(String version) {
        com.deepseekharness.app.core.DshUpdater updater = updater();
        CardSheet.show(this, getString(R.string.ui2_update_section_runtime) + " · " + version,
                com.deepseekharness.app.util.UiText.text("正在获取该版本的更新日志…"));
        updater.fetchNotesAsync(version, notes -> {
            if (isFinishing() || isDestroyed()) return;
            CardSheet.show(this, getString(R.string.ui2_update_section_runtime) + " · " + version,
                    notes == null || notes.trim().isEmpty()
                            ? com.deepseekharness.app.util.UiText.text("该版本暂无更新日志") : notes);
        });
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
                if (runtimeOptions == null) return;
                // 首项是「跟随上游最新」；其余是具体运行时版本（列表含首项，故版本索引 = position - 1；只允许升级）。
                String version;
                if (position <= 0) version = null;
                else if (position > runtimeOptions.size()) return;
                else version = runtimeOptions.get(position - 1);
                updater().selectVersion(version);
                if (version != null && !version.equals(lastShownRuntimeNotes)) {
                    lastShownRuntimeNotes = version;
                    showRuntimeVersionNotes(version);
                }
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

    /** 运行时区块渲染：状态文案 + 版本列表（仅可升级版本）+ 更新日志入口。 */
    private void renderRuntimeState(com.deepseekharness.app.core.DshUpdater.State state) {
        if (state == null) return;
        TextView status = findViewById(R.id.update_runtime_status);
        if (status != null) status.setText(com.deepseekharness.app.util.UiStateText.render(state.message));
        java.util.ArrayList<String> versions = updater().availableVersions();
        // 只允许升级：列表只保留高于当前已安装版本的候选。
        if (state.currentVersion != null) {
            java.util.ArrayList<String> upgradeOnly = new java.util.ArrayList<>();
            for (String v : versions) if (updater().canUpgradeTo(v)) upgradeOnly.add(v);
            versions = upgradeOnly;
        }
        String selected = updater().requestedVersion();
        if (selected != null && (versions.isEmpty() || !versions.contains(selected))) selected = null;
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
            if (selected == null) hint.setVisibility(android.view.View.GONE);
            else {
                final String picked = selected;
                hint.setVisibility(android.view.View.VISIBLE);
                hint.setText(com.deepseekharness.app.util.UiText.text("已选择运行时版本 ") + selected
                        + com.deepseekharness.app.util.UiText.text("（点击查看更新日志）"));
                hint.setOnClickListener(v -> showRuntimeVersionNotes(picked));
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
     * <p>列表来自更新清单的完整版本数组（只含比当前新的版本，不能降级）；旧版本不会出现在列表里。
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
        if (selected == null) { hint.setVisibility(android.view.View.GONE); return; }
        hint.setVisibility(android.view.View.VISIBLE);
        hint.setText(com.deepseekharness.app.util.UiText.text("已选版本 ") + selected
                + com.deepseekharness.app.util.UiText.text("（点击查看更新日志）"));
        hint.setOnClickListener(v -> showAppVersionNotes(selected));
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
