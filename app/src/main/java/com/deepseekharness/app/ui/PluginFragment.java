package com.deepseekharness.app.ui;
import com.deepseekharness.app.util.UiText;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.deepseekharness.app.R;
import com.deepseekharness.app.core.PluginRepository;
import com.deepseekharness.app.util.PluginSort;
import com.deepseekharness.app.util.PluginSource;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** 插件市场入口与已装插件管理；耗时任务由 Activity 范围的 Repository 承接。 */
public class PluginFragment extends Fragment {
    private PluginRepository repository;
    private PluginRepository.State current;
    private View root;
    private EditText search;
    private int sortMode;
    private boolean hideBuiltinOnly;
    private boolean lastBusy;
    private String lastResultShown;
    private androidx.appcompat.app.AlertDialog progressDialog;
    private final List<PluginRepository.Item> visibleItems = new ArrayList<>();
    private final Adapter adapter = new Adapter();
    private ArrayList<String> pendingExports = new ArrayList<>();
    private android.net.Uri pendingImport;
    private AlertDialog previewDialog;
    /** Repository 随 Activity 留存；失效记录不能只挂在被替换的 Fragment 上。仅主线程访问。 */
    private static long installedRevision;
    private static final java.util.WeakHashMap<PluginRepository, Long> refreshedRevisions = new java.util.WeakHashMap<>();
    private final android.os.Handler refreshHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable refreshInvalidated = this::refreshInstalledIfNeeded;
    private String environmentNotice;

    static void invalidateInstalledState() { installedRevision++; }

    /** 只在首次读取或安全启动失效后同步一次；等待中的轮询只读内存状态。 */
    private void refreshInstalledIfNeeded() {
        refreshHandler.removeCallbacks(refreshInvalidated);
        if (root == null || !isResumed()) return;
        if (pluginRefreshBlocked()) {
            refreshHandler.postDelayed(refreshInvalidated, 500);
            return;
        }
        Long refreshed = refreshedRevisions.get(repository);
        if (refreshed != null && refreshed == installedRevision) return;
        // 失败由操作结果明确显示，用户可手动重试；不在失败后无限全量刷新。
        refreshedRevisions.put(repository, installedRevision);
        // DeepSeekHarness：打开页面只静默同步清单，不弹“正在检测”弹窗；手动点「检测插件」才全量检测。
        repository.refreshSilent();
    }

    // 调试自测替换这两个边界，验证刷新时机，不触发真实插件注册或容器任务。
    boolean pluginRefreshBlocked() {
        String blocked = repository.environmentBlockMessage();
        if (!blocked.isEmpty()) {
            PluginRepository.State shown = repository.state().getValue();
            if (!repository.isBusy()) {
                environmentNotice = blocked;
                if (shown == null || !blocked.equals(shown.message)) repository.selectionMessage(blocked);
            }
            return true;
        }
        if (environmentNotice != null) {
            PluginRepository.State shown = repository.state().getValue();
            if (!repository.isBusy() && shown != null && environmentNotice.equals(shown.message))
                repository.selectionMessage(UiText.text("环境任务已结束；当前显示缓存列表，可点「刷新」同步插件状态"));
            environmentNotice = null;
        }
        com.deepseekharness.app.core.HarnessController controller =
                com.deepseekharness.app.core.HarnessController.get(requireContext());
        return repository.isBusy() || controller.isStarting() || controller.isStopping();
    }
    void syncInstalledState() { repository.refresh(); }

    private final ActivityResultLauncher<android.content.Intent> importPicker = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), result -> {
                if (repository == null) repository = new ViewModelProvider(requireActivity()).get(PluginRepository.class);
                android.content.Intent data = result.getData();
                android.net.Uri uri = data == null ? null : data.getData();
                if (uri == null && data != null && data.getClipData() != null && data.getClipData().getItemCount() > 0)
                    uri = data.getClipData().getItemAt(0).getUri();
                if (result.getResultCode() != android.app.Activity.RESULT_OK || uri == null) {
                    repository.selectionMessage(UiText.text("未选择文件或文件管理器未返回文件。可点「其他文件选择器」重试，选择 ZIP / TAR.GZ 插件包。"));
                    return;
                }
                if (!"content".equals(uri.getScheme()) && !"file".equals(uri.getScheme())) {
                    repository.selectionMessage(UiText.text("文件管理器返回的地址无法读取，请改用系统文件选择器。"));
                    return;
                }
                if ("file".equals(uri.getScheme()) && android.os.Build.VERSION.SDK_INT < 30
                        && requireContext().checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    pendingImport = uri;
                    PluginFragment.this.readPermission.launch(android.Manifest.permission.READ_EXTERNAL_STORAGE);
                    return;
                }
                repository.importArchive(uri);
            });
    private final ActivityResultLauncher<String> readPermission = registerForActivityResult(
            new ActivityResultContracts.RequestPermission(), allowed -> {
                android.net.Uri selected = pendingImport;
                pendingImport = null;
                if (allowed && selected != null) repository.importArchive(selected);
                else repository.selectionMessage(UiText.text("未获得文件读取权限，请改用系统文件选择器导入。"));
            });
    private final ActivityResultLauncher<String> exportPicker = registerForActivityResult(
            new ActivityResultContracts.CreateDocument("application/gzip"), uri -> {
                if (uri != null && !pendingExports.isEmpty())
                    repository.exportArchives(new ArrayList<>(pendingExports), uri);
                pendingExports.clear();
            });

    @Nullable @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle state) {
        return inflater.inflate(R.layout.fragment_plugins, container, false);
    }

    @Override public void onViewCreated(@NonNull View view, @Nullable Bundle saved) {
        root = view;
        repository = new ViewModelProvider(requireActivity()).get(PluginRepository.class);
        if (saved != null) {
            sortMode = saved.getInt("sortMode");
            ArrayList<String> names = saved.getStringArrayList("pendingExports");
            if (names != null) pendingExports = names;
            String imported = saved.getString("pendingImport");
            if (imported != null) pendingImport = android.net.Uri.parse(imported);
        }
        search = view.findViewById(R.id.pluginSearch);
        RecyclerView list = view.findViewById(R.id.pluginList);
        list.setLayoutManager(new LinearLayoutManager(requireContext()));
        list.setNestedScrollingEnabled(false);
        list.setItemAnimator(null);
        list.setAdapter(adapter);
        view.findViewById(R.id.btnRefresh).setOnClickListener(v -> repository.refresh());
        view.findViewById(R.id.btnPluginUpdates).setOnClickListener(v -> repository.checkUpdates(null));
        view.findViewById(R.id.btnPluginRestore).setOnClickListener(v -> AppDialogs.show(requireContext(),
                android.R.drawable.ic_menu_revert, UiText.text("恢复第三方插件？"),
                UiText.text("恢复安全启动前已启用的插件；之后手动禁用的插件保持禁用。恢复后重启 Web 生效。"),
                UiText.text("恢复"), UiText.text("取消"), () -> repository.safeMode(false, null)));
        view.findViewById(R.id.btnOnlineInstall).setOnClickListener(v -> showInstallDialog(false));
        view.findViewById(R.id.btnCommandInstallBtn).setOnClickListener(v -> showInstallDialog(true));
        view.findViewById(R.id.btnPluginHelp).setOnClickListener(v -> AppDialogs.show(requireContext(),
                android.R.drawable.ic_menu_help, UiText.text("使用提示"),
                UiText.text("支持通过链接、npm 包名安装插件，也支持 GitHub、npm 和 ZIP / TAR / TAR.GZ / TGZ 的已构建插件包；也可以粘贴 dsh 插件安装命令。安装或修改插件后，重启 Web 生效。导出包可在其他 DeepSeek Harness 中导入。"),
                UiText.text("知道了"), null, null));
        view.findViewById(R.id.btnImport).setOnClickListener(v -> chooseImport(false));
        view.findViewById(R.id.btnExport).setOnClickListener(v -> chooseExport());
        view.findViewById(R.id.btnSort).setOnClickListener(v -> showSortDialog());
        search.addTextChangedListener(watcher(this::render));
        search.setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_menu_search, 0, 0, 0);
        search.setOnTouchListener((v, ev) -> {
            if (ev.getAction() == android.view.MotionEvent.ACTION_UP) {
                int x = Math.round(ev.getX());
                if (x < search.getCompoundPaddingLeft()) { search.requestFocus(); return true; }
            }
            return false;
        });
        repository.state().observe(getViewLifecycleOwner(), state -> {
            current = state;
            render();
            maybeShowResultDialog(state);
            syncProgressDialog(state);
        });
        repository.preview().observe(getViewLifecycleOwner(), ignored -> showInstallPreview());
    }

    @Override public void onResume() {
        super.onResume();
        refreshInstalledIfNeeded();
    }

    @Override public void onPause() {
        refreshHandler.removeCallbacks(refreshInvalidated);
        super.onPause();
    }

    @Override public void onSaveInstanceState(@NonNull Bundle state) {
        super.onSaveInstanceState(state);
        state.putInt("sortMode", sortMode);
        state.putStringArrayList("pendingExports", pendingExports);
        if (pendingImport != null) state.putString("pendingImport", pendingImport.toString());
    }

    @Override public void onDestroyView() {
        refreshHandler.removeCallbacks(refreshInvalidated);
        if (previewDialog != null) { previewDialog.dismiss(); previewDialog = null; }
        ((RecyclerView) root.findViewById(R.id.pluginList)).setAdapter(null);
        root = null;
        search = null;
        super.onDestroyView();
    }

    private static TextWatcher watcher(Runnable callback) {
        return new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { callback.run(); }
            @Override public void afterTextChanged(Editable e) { }
        };
    }

    private void showInstallPreview() {
        if (root == null || repository.isBusy() || previewDialog != null) return;
        PluginRepository.Preview preview = repository.preview().getValue();
        if (preview == null) return;
        previewDialog = AppDialogs.show(requireContext(), android.R.drawable.ic_menu_add,
                UiText.text("确认安装插件"), preview.description, UiText.text("确认安装"), UiText.text("取消"),
                () -> repository.confirmPreview());
        previewDialog.setOnCancelListener(d -> { repository.discardPreview(); previewDialog = null; });
        previewDialog.setOnDismissListener(d -> previewDialog = null);
    }

    /** 安装弹窗：在线安装（链接/npm 包名）或命令行安装（dsh plugin 命令）。 */
    private void showInstallDialog(boolean commandMode) {
        if (repository.isBusy()) { toast(UiText.text("请等待当前插件操作完成后再安装")); return; }
        final android.widget.EditText input = new android.widget.EditText(requireContext());
        input.setSingleLine(true);
        input.setTextSize(14);
        input.setHint(commandMode ? UiText.text("dsh plugin --profile web add 插件包名") : UiText.text("插件链接或 npm 包名"));
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
        android.widget.LinearLayout body = new android.widget.LinearLayout(requireContext());
        body.setOrientation(android.widget.LinearLayout.VERTICAL);

        // 说明行
        final TextView desc = new TextView(requireContext());
        desc.setTextSize(12);
        desc.setTextColor(requireContext().getColor(R.color.text_muted));
        desc.setPadding(dp(4), 0, dp(4), dp(8));
        desc.setText(commandMode
                ? UiText.text("粘贴 dsh 插件安装命令，将自动提取包名安装。\n例如：dsh plugin --profile web add 插件包名")
                : UiText.text("支持 GitHub 仓库、npm 包名、Release 下载链接和压缩包直链。"));
        body.addView(desc);

        // 输入行（带粘贴）
        final TextView[] realtime = new TextView[1];
        android.widget.ProgressBar spinner = new android.widget.ProgressBar(requireContext(), null,
                android.R.attr.progressBarStyleSmall);
        // 输入端：标签+输入+粘贴
        android.widget.LinearLayout tagRow = new android.widget.LinearLayout(requireContext());
        tagRow.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        tagRow.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView tag = new TextView(requireContext());
        tag.setText(commandMode ? UiText.text("命令") : UiText.text("地址"));
        tag.setTextSize(13);
        tag.setTextColor(requireContext().getColor(R.color.text_muted));
        tag.setPadding(0, 0, dp(8), 0);
        tagRow.addView(tag);
        input.setLayoutParams(new android.widget.LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        input.setBackgroundResource(R.drawable.bg_input);
        input.setPadding(dp(10), dp(8), dp(10), dp(8));
        tagRow.addView(input);
        TextView paste = new TextView(requireContext());
        paste.setText(UiText.text("粘贴"));
        paste.setTextColor(requireContext().getColor(R.color.primary));
        paste.setPadding(dp(10), dp(8), dp(6), dp(8));
        paste.setOnClickListener(v -> {
            android.content.ClipboardManager cm = (android.content.ClipboardManager)
                    requireContext().getSystemService(Context.CLIPBOARD_SERVICE);
            android.content.ClipData clip = cm == null ? null : cm.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) { toast(UiText.text("剪贴板没有内容")); return; }
            input.setText(clip.getItemAt(0).coerceToText(requireContext()));
        });
        tagRow.addView(paste);
        body.addView(tagRow);

        // 实时识别提示
        final TextView hint = new TextView(requireContext());
        hint.setTextSize(12);
        hint.setTextColor(requireContext().getColor(R.color.text_secondary));
        hint.setPadding(dp(4), dp(6), dp(4), 0);
        body.addView(hint);
        android.text.TextWatcher watcher = new android.text.TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {
                String raw = s.toString().trim();
                if (raw.isEmpty()) { hint.setText(""); return; }
                try {
                    String spec = commandMode ? extractPackageFromCommand(raw) : raw;
                    PluginSource source = PluginSource.parse(spec);
                    hint.setText(UiText.text("已识别：") + source.description());
                    hint.setTextColor(requireContext().getColor(R.color.primary));
                } catch (IllegalArgumentException e) {
                    hint.setText(e.getMessage());
                    hint.setTextColor(requireContext().getColor(R.color.err));
                }
            }
            @Override public void afterTextChanged(android.text.Editable s) { }
        };
        input.addTextChangedListener(watcher);
        input.setOnEditorActionListener((v, action, event) -> {
            if (action == android.view.inputmethod.EditorInfo.IME_ACTION_GO) {
                String raw = input.getText().toString().trim();
                if (!raw.isEmpty()) doInstall(commandMode, raw);
                return true;
            }
            return false;
        });

        AppDialogs.showCustom(requireContext(),
                commandMode ? android.R.drawable.ic_menu_edit : android.R.drawable.ic_menu_add,
                commandMode ? UiText.text("命令行安装") : UiText.text("在线安装"), body,
                UiText.text("安装"), UiText.text("取消"), () -> doInstall(commandMode, input.getText().toString().trim()));
    }

    private void doInstall(boolean commandMode, String raw) {
        if (raw.isEmpty()) { toast(UiText.text("请输入内容")); return; }
        try {
            String spec = commandMode ? extractPackageFromCommand(raw) : raw;
            repository.install(PluginSource.parse(spec));
        } catch (IllegalArgumentException error) { toast(error.getMessage()); }
    }

    private int dp(int v) {
        return Math.round(v * requireContext().getResources().getDisplayMetrics().density);
    }

    /** 排序方式：0=名称A-Z 1=名称Z-A 2=已启用优先 3=可更新优先。 */
    private String sortLabel() {
        switch (sortMode) {
            case 1: return UiText.text("名称 Z-A");
            case 2: return UiText.text("已启用优先");
            case 3: return UiText.text("可更新优先");
            default: return UiText.text("名称 A-Z");
        }
    }

    private void showSortDialog() {
        android.widget.LinearLayout body = new android.widget.LinearLayout(requireContext());
        body.setOrientation(android.widget.LinearLayout.VERTICAL);
        String[] labels = {UiText.text("名称 A-Z"), UiText.text("名称 Z-A"), UiText.text("已启用优先"), UiText.text("可更新优先")};
        for (int i = 0; i < labels.length; i++) {
            final int idx = i;
            TextView row = new TextView(requireContext());
            row.setText(labels[i]);
            row.setTextSize(15);
            row.setGravity(android.view.Gravity.CENTER_VERTICAL);
            row.setPadding(dp(16), dp(12), dp(16), dp(12));
            row.setBackgroundResource(R.drawable.bg_drawer_item);
            row.setMinHeight(dp(48));
            if (sortMode == i) {
                row.setTextColor(requireContext().getColor(R.color.primary));
                row.setCompoundDrawablesWithIntrinsicBounds(0, 0, R.drawable.ic_plugin_scan, 0);
                row.setCompoundDrawablePadding(dp(8));
            } else {
                row.setTextColor(requireContext().getColor(R.color.text));
            }
            android.widget.LinearLayout.LayoutParams rlp = new android.widget.LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            rlp.topMargin = i == 0 ? 0 : dp(4);
            row.setLayoutParams(rlp);
            row.setOnClickListener(v -> {
                sortMode = idx;
                render();
            });
            body.addView(row);
        }
        // 只看自己装的（过滤内置/官方插件）
        android.widget.CheckBox onlyMine = new android.widget.CheckBox(requireContext());
        onlyMine.setText(UiText.text("只看自己装的"));
        onlyMine.setTextColor(requireContext().getColor(R.color.text_secondary));
        onlyMine.setButtonTintList(android.content.res.ColorStateList.valueOf(
                requireContext().getColor(R.color.primary)));
        onlyMine.setChecked(hideBuiltinOnly);
        android.widget.LinearLayout.LayoutParams clp = new android.widget.LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        clp.topMargin = dp(12);
        onlyMine.setLayoutParams(clp);
        onlyMine.setOnCheckedChangeListener((b, checked) -> {
            hideBuiltinOnly = checked;
            render();
        });
        body.addView(onlyMine);
        AppDialogs.showCustom(requireContext(), android.R.drawable.ic_menu_sort_by_size, UiText.text("插件排序"),
                body, UiText.text("关闭"), null, null);
    }

    /** 从 dsh plugin [--profile xxx] add <spec> 提取安装目标；无法识别时原样返回（按包名/链接解析）。 */
    private static String extractPackageFromCommand(String raw) {
        if (raw == null) return "";
        String value = raw.trim();
        // 形式：dsh/npx plugin [任意选项如 --profile web 或 -p web] add/install/安装 <包名>
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile(
                "(?i)\\b(?:dsh|npx)\\s+plugin(?:\\s+-{1,2}[a-z]+(?:\\s+\\S+)?)*"
                + "\\s+(?:add|install|安装)\\s+(\\S+)").matcher(value);
        if (matcher.find()) return matcher.group(1).replaceAll("['\"]，。；！）】]+$", "");
        // 兜底：从整串里截取第一个 npm 包名（@scope/pkg 或 pkg）当安装目标
        java.util.regex.Matcher pkg = java.util.regex.Pattern.compile(
                "(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*(?:@[A-Za-z0-9.^~*+_-]+)?").matcher(value);
        if (pkg.find()) return pkg.group(0);
        return value;
    }

    private void chooseImport(boolean alternative) {
        if (repository.isBusy()) { toast(UiText.text("请等待当前插件操作完成后再导入")); return; }
        View focus = requireActivity().getCurrentFocus();
        if (focus != null) {
            android.view.inputmethod.InputMethodManager keyboard = (android.view.inputmethod.InputMethodManager)
                    requireContext().getSystemService(Context.INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(focus.getWindowToken(), 0);
            focus.clearFocus();
        }
        repository.selectionMessage(UiText.text("请选择插件压缩包；文件选择器无法返回时，可使用「其他文件选择器」。"));
        try { importPicker.launch(PluginFilePicker.intent(requireContext(), alternative)); }
        catch (android.content.ActivityNotFoundException error) {
            if (!alternative) { chooseImport(true); return; }
            repository.selectionMessage(UiText.text("未找到可用的文件选择器，请启用系统「文件」应用后重试。"));
            toast(UiText.text("没有可用的文件选择器"));
        } catch (RuntimeException error) {
            repository.selectionMessage(UiText.text("无法打开文件选择器，请使用备用入口：") + error.getClass().getSimpleName());
        }
    }


    /** DeepSeekHarness：耗时插件操作（下载/安装/更新）期间弹出带进度条的弹窗。 */
    private void syncProgressDialog(PluginRepository.State state) {
        if (state == null || root == null || isDetached()) return;
        if (state.busy) {
            if (progressDialog == null) {
                progressDialog = AppDialogs.showProgress(requireContext(),
                        android.R.drawable.ic_popup_sync, UiText.text("正在处理插件"), state.message,
                        state.cancellable ? UiText.text("取消") : null,
                        () -> repository.cancelTask());
            } else {
                TextView msg = progressDialog.findViewById(R.id.app_dialog_message);
                if (msg != null) msg.setText(state.message);
            }
            AppDialogs.setProgressPercent(progressDialog, state.percent);
        } else if (progressDialog != null) {
            progressDialog.dismiss();
            progressDialog = null;
        }
    }

    /** DeepSeekHarness：插件操作刚结束时自动弹窗显示结果（安装/删除/更新等）。 */
    private void maybeShowResultDialog(PluginRepository.State state) {
        if (state == null || root == null || isDetached()) return;
        boolean ended = lastBusy && !state.busy;
        lastBusy = state.busy;
        if (!ended || state.message == null || state.message.isEmpty()) return;
        if (state.message.equals(lastResultShown)) return;
        lastResultShown = state.message;
        String op = repository.lastOperation();
        String title = UiText.text("插件操作结果");
        int icon = android.R.drawable.ic_menu_info_details;
        if ("静默".equals(op)) {
           lastResultShown = state.message; // 静默同步不弹结果窗
            return;
        }
        if ("安装".equals(op) && repository.installationSucceeded()) { title = UiText.text("安装成功"); icon = android.R.drawable.ic_menu_save; }
        else if ("检测".equals(op)) { title = UiText.text("检测完成"); icon = android.R.drawable.ic_popup_sync; }
        else if ("删除".equals(op)) { title = UiText.text("插件已删除"); icon = android.R.drawable.ic_menu_delete; }
        else if ("回退".equals(op)) { title = UiText.text("插件已回退"); icon = android.R.drawable.ic_menu_revert; }
        else if ("更新".equals(op)) { title = UiText.text("插件已更新"); icon = android.R.drawable.ic_popup_sync; }
        else if ("状态".equals(op)) { title = UiText.text("插件状态已更新"); icon = android.R.drawable.ic_menu_info_details; }
        else if (state.message.startsWith("已删除")) { title = UiText.text("插件已删除"); icon = android.R.drawable.ic_menu_delete; }
        else if (state.message.startsWith("已禁用") || state.message.startsWith("已启用")) title = UiText.text("插件状态已更新");
        else if (state.message.startsWith("已更新")) { title = UiText.text("插件已更新"); icon = android.R.drawable.ic_popup_sync; }
        AppDialogs.show(requireContext(), icon, title, state.message, UiText.text("关闭"), null, null);
    }

    private void render() {
        if (root == null || current == null) return;
        root.findViewById(R.id.btnPluginRestore).setVisibility(repository.isSafeMode() ? View.VISIBLE : View.GONE);
        for (int id : new int[]{R.id.btnImport, R.id.btnExport, R.id.btnRefresh, R.id.btnPluginUpdates, R.id.btnPluginRestore})
            root.findViewById(id).setEnabled(!current.busy);
        ((TextView) root.findViewById(R.id.btnSort)).setText(sortLabel());
        visibleItems.clear();
        String query = search.getText().toString().trim().toLowerCase(Locale.ROOT);
        for (PluginRepository.Item item : current.items) {
            if (hideBuiltinOnly && (item.builtin || item.official)) continue;
            if (!(item.name + " " + item.description).toLowerCase(Locale.ROOT).contains(query)) continue;
            visibleItems.add(item);
        }
        PluginSort.Mode mode;
        switch (sortMode) {
            case 1: mode = PluginSort.Mode.NAME_DESC; break;
            case 2: mode = PluginSort.Mode.ENABLED_FIRST; break;
            case 3: mode = PluginSort.Mode.UPDATE_FIRST; break;
            default: mode = PluginSort.Mode.NAME_ASC;
        }
        Comparator<PluginRepository.Item> comparator = PluginSort.comparator(
                mode, it -> it.name, it -> it.enabled, it -> it.updateAvailable);
        visibleItems.sort(comparator);
        ((TextView) root.findViewById(R.id.pluginCount)).setText(UiText.text("共 ") + visibleItems.size() + UiText.text(" 个插件"));
        TextView empty = root.findViewById(R.id.pluginEmpty);
        empty.setVisibility(visibleItems.isEmpty() ? View.VISIBLE : View.GONE);
        empty.setText(current.busy ? UiText.text("正在读取插件…") : UiText.text("没有符合条件的插件"));
        adapter.notifyDataSetChanged();
        showInstallPreview();
    }

    private void chooseExport() {
        if (current == null || repository.isBusy()) return;
        List<String> names = new ArrayList<>();
        for (PluginRepository.Item item : current.items) if (item.exportable) names.add(item.name);
        if (names.isEmpty()) { toast(UiText.text("没有可导出的插件")); return; }
        android.widget.LinearLayout list = new android.widget.LinearLayout(requireContext());
        list.setOrientation(android.widget.LinearLayout.VERTICAL);
        final CheckBox[] boxes = new CheckBox[names.size()];
        for (int i = 0; i < names.size(); i++) {
            CheckBox box = new CheckBox(requireContext());
            box.setText(names.get(i));
            box.setTextColor(requireContext().getColor(R.color.text));
            box.setPadding(0, 8, 0, 8);
            list.addView(box);
            boxes[i] = box;
        }
        AppDialogs.showCustom(requireContext(), android.R.drawable.ic_menu_upload, UiText.text("选择要导出的插件"),
                list, UiText.text("选择保存位置"), UiText.text("取消"), () -> {
                    ArrayList<String> selected = new ArrayList<>();
                    for (int i = 0; i < boxes.length; i++) if (boxes[i].isChecked()) selected.add(names.get(i));
                    if (selected.isEmpty()) { toast(UiText.text("请至少选择一个插件")); return; }
                    beginExport(selected);
                });
    }

    private void beginExport(ArrayList<String> names) {
        if (names.isEmpty() || repository.isBusy()) return;
        pendingExports = names;
        String name = names.size() == 1 ? names.get(0).replaceAll("[^A-Za-z0-9._-]", "_") : "DeepSeekHarness-plugins";
        String stamp = new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new java.util.Date());
        try { exportPicker.launch(name + "-" + stamp + ".tar.gz"); }
        catch (Exception error) { pendingExports.clear(); toast(UiText.text("无法打开保存位置选择器")); }
    }

    private void toggle(PluginRepository.Item item, boolean enabled) {
        if (repository.isBusy()) { adapter.notifyDataSetChanged(); return; }
        if (item.official && !enabled) {
            AlertDialog dialog = AppDialogs.show(requireContext(), android.R.drawable.ic_dialog_alert, UiText.text("禁用官方核心？"),
                    item.name + UiText.text(" 是 Web 运行所需的核心，禁用后页面可能无法启动。"),
                    UiText.text("禁用"), UiText.text("取消"), () -> repository.setEnabled(item, false));
            dialog.setOnDismissListener(d -> adapter.notifyDataSetChanged());
        } else repository.setEnabled(item, enabled);
    }

    private void itemActions(PluginRepository.Item item) {
        List<String> actions = new ArrayList<>();
        actions.add(UiText.text("复制插件名称"));
        if (!item.source.isEmpty()) actions.add(UiText.text("复制来源链接"));
        if (item.exportable) actions.add(UiText.text("导出插件包"));
        if (item.deletable) actions.add(UiText.text("检查插件更新"));
        if (item.updateAvailable) actions.add(UiText.text("更新至 ") + item.latestVersion);
        if (!item.rollbackVersion.isEmpty()) actions.add(UiText.text("回退至 ") + item.rollbackVersion);
        if (item.deletable) actions.add(UiText.text("删除插件"));
        AppDialogs.showList(requireContext(), android.R.drawable.ic_menu_more, item.name,
                actions.toArray(new String[0]), which -> {
                    String action = actions.get(which);
                    if (action.equals(UiText.text("检查插件更新"))) {
                        repository.checkUpdates(item);
                    } else if (action.startsWith(UiText.text("更新至 "))) {
                        repository.prepareUpdate(item);
                    } else if (action.startsWith(UiText.text("回退至 "))) {
                        AppDialogs.show(requireContext(), android.R.drawable.ic_menu_revert, UiText.text("回退插件？"),
                                item.name + UiText.text("：") + item.version + " → " + item.rollbackVersion
                                        + UiText.text("\n只恢复插件文件，当前启用状态和对话数据保留；重启 Web 生效。"),
                                UiText.text("回退"), UiText.text("取消"), () -> repository.rollback(item));
                    } else if (action.equals(UiText.text("导出插件包"))) {
                        ArrayList<String> names = new ArrayList<>();
                        names.add(item.name);
                        beginExport(names);
                    } else if (action.equals(UiText.text("删除插件"))) {
                        if (repository.isBusy()) { toast(UiText.text("请等待当前插件操作完成")); return; }
                        AppDialogs.show(requireContext(), android.R.drawable.ic_menu_delete, UiText.text("删除插件？"),
                                UiText.text("将删除 ") + item.name + UiText.text(" 的安装文件和启用记录。")
                                        + UiText.text("\n对话、其他插件及外部源码目录会保留。需要留存时可先导出。"),
                                UiText.text("删除"), UiText.text("取消"), () -> repository.delete(item));
                    } else {
                        ClipboardManager clipboard = (ClipboardManager) requireContext()
                                .getSystemService(Context.CLIPBOARD_SERVICE);
                        if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText(UiText.text("插件"),
                                action.equals(UiText.text("复制插件名称")) ? item.name : item.source));
                        toast(UiText.text("已复制"));
                    }
                });
    }

    private void toast(String message) {
        if (isAdded()) Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show();
    }

    private class Adapter extends RecyclerView.Adapter<Adapter.Holder> {
        class Holder extends RecyclerView.ViewHolder {
            final TextView name, state, description;
            final Switch toggle;
            Holder(View view) {
                super(view);
                name = view.findViewById(R.id.pluginName);
                state = view.findViewById(R.id.pluginStatus);
                description = view.findViewById(R.id.pluginDesc);
                toggle = view.findViewById(R.id.pluginSwitch);
            }
        }
        @NonNull @Override public Holder onCreateViewHolder(@NonNull ViewGroup parent, int type) {
            return new Holder(LayoutInflater.from(parent.getContext()).inflate(R.layout.item_plugin, parent, false));
        }
        @Override public void onBindViewHolder(@NonNull Holder holder, int position) {
            PluginRepository.Item item = visibleItems.get(position);
            holder.name.setText(item.name);
            holder.state.setText((item.dynamic ? (item.enabled ? UiText.text("临时插件 · 已运行") : UiText.text("临时插件 · 未运行"))
                    : item.available ? (item.enabled ? UiText.text("已启用") : item.detected ? UiText.text("已检测，可开启以加入 Web") : UiText.text("已禁用")) : UiText.text("实体缺失，请重新导入"))
                    + (item.version.isEmpty() ? "" : " · " + item.version)
                    + (item.location.isEmpty() ? "" : UiText.text("\n位置：") + item.location)
                    + (item.updateAvailable ? UiText.text("\n可更新：") + item.latestVersion
                            : (item.latestVersion.isEmpty() ? "" : UiText.text("\n上次检查版本：") + item.latestVersion)
                            + (item.updateMessage.isEmpty() ? "" : "\n" + item.updateMessage))
                    + (item.rollbackVersion.isEmpty() ? "" : UiText.text("\n可回退：") + item.rollbackVersion));
            holder.state.setTextColor(requireContext().getColor(
                    !item.available ? R.color.warn : item.enabled ? R.color.primary : R.color.text_muted));
            holder.description.setText(item.description.isEmpty()
                    ? (item.official ? UiText.text("官方核心") : item.builtin ? UiText.text("DeepSeek Harness 内置插件") : UiText.text("第三方插件")) : item.description);
            holder.itemView.findViewById(R.id.pluginActions).setOnClickListener(v -> itemActions(item));
            holder.itemView.findViewById(R.id.pluginActions).setContentDescription(UiText.text("更多操作：") + item.name);
            holder.toggle.setVisibility(item.dynamic ? View.GONE : View.VISIBLE);
            holder.toggle.setOnCheckedChangeListener(null);
            holder.toggle.setChecked(item.enabled);
            holder.toggle.setContentDescription((item.enabled ? UiText.text("禁用 ") : UiText.text("启用 ")) + item.name);
            holder.toggle.jumpDrawablesToCurrentState();
            holder.toggle.setEnabled(!repository.isBusy() && (item.available || item.enabled));
            holder.toggle.setOnCheckedChangeListener((v, checked) -> {
                if (checked != item.enabled) toggle(item, checked);
            });
            holder.itemView.setOnLongClickListener(v -> { itemActions(item); return true; });
        }
        @Override public int getItemCount() { return visibleItems.size(); }
    }
}
