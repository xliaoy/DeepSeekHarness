package com.deepseekharness.app.ui;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
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
import com.deepseekharness.app.util.PluginSource;

import java.util.ArrayList;
import com.deepseekharness.app.util.PluginSort;
import java.util.List;
import java.util.Locale;

/** 插件安装与已装插件管理；耗时任务由 Activity 范围的 Repository 承接。
 *
 * ★ UI 形态已改为「无商城版」：插件列表 + 在线安装 + 命令行安装。
 *   已删除：市场/已装分段控件、在线商城卡片、社区入口。
 *   保留：导入/导出、安全模式恢复、更新检查、排序、只看自己装的、展开详情。
 */
public class PluginFragment extends Fragment {
    private PluginRepository repository;
    private PluginRepository.State current;
    private View root;
    private EditText search;
    /** 只看自己装的（过滤内置/官方插件）。原先是布局里的 chkHideBuiltin 复选框，
     *  现按参考实现改为排序对话框内的开关，因此这里是普通字段而非 View。 */
    private boolean hideBuiltinOnly;
    /** Busy/进度改由对话框承载（原先靠布局里的 pluginBusy/statusText 内联显示）。 */
    private AlertDialog progressDialog;
    private final java.util.Set<String> expandedPlugins=new java.util.HashSet<>();
    private PluginSort.Mode sortOrder=PluginSort.Mode.NAME_ASC;
    private final List<PluginRepository.Item> visibleItems = new ArrayList<>();
    private List<PluginRepository.Item> renderedItems;
    private String renderedQuery;
    private PluginSort.Mode renderedSort;
    private boolean renderedHideBuiltin, renderedBusy;
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
        syncInstalledState();
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
                repository.selectionMessage(com.deepseekharness.app.util.UiText.text("环境任务已结束；当前显示缓存列表，可点「刷新」同步插件状态"));
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
                    repository.selectionMessage(com.deepseekharness.app.util.UiText.text("未选择文件。可再次点击导入插件包。"));
                    return;
                }
                if (!"content".equals(uri.getScheme()) && !"file".equals(uri.getScheme())) {
                    repository.selectionMessage(com.deepseekharness.app.util.UiText.text("文件管理器返回的地址无法读取，请改用系统文件选择器。"));
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
                else repository.selectionMessage(com.deepseekharness.app.util.UiText.text("未获得文件读取权限，请改用系统文件选择器导入。"));
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
        renderedItems=null;
        sortOrder=new com.deepseekharness.app.core.ConfigStore(requireContext()).getPluginSort();
        repository = new ViewModelProvider(requireActivity()).get(PluginRepository.class);
        if (saved != null) {
            if(saved.containsKey("sortOrder"))sortOrder=PluginSort.Mode.parse(saved.getString("sortOrder"));
            else if(saved.getBoolean("enabledFirst"))sortOrder=PluginSort.Mode.ENABLED_FIRST;
            hideBuiltinOnly = saved.getBoolean("hideBuiltinOnly", false);
            ArrayList<String> names = saved.getStringArrayList("pendingExports");
            if (names != null) pendingExports = names;
            String imported = saved.getString("pendingImport");
            if (imported != null) pendingImport = android.net.Uri.parse(imported);
        }
        search = view.findViewById(R.id.pluginSearch);
        RecyclerView list = view.findViewById(R.id.pluginList);
        list.setLayoutManager(new LinearLayoutManager(requireContext()));
        // 插件卡片随整页移动，只有外层页面处理纵向滚动。
        list.setNestedScrollingEnabled(false);
        list.setItemAnimator(null);
        list.setAdapter(adapter);
        view.findViewById(R.id.btnRefresh).setOnClickListener(v -> repository.refresh());
        view.findViewById(R.id.btnPluginUpdates).setOnClickListener(v -> repository.checkUpdates(null));
        view.findViewById(R.id.btnPluginRestore).setOnClickListener(v -> new com.deepseekharness.app.ui.DeepSeekHarnessDialogBuilder(requireContext())
                .setTitle(com.deepseekharness.app.util.UiText.text("恢复第三方插件？")).setMessage(com.deepseekharness.app.util.UiText.text("恢复安全启动前已启用的插件；之后手动禁用的插件保持禁用。恢复后重启 Web 生效。"))
                .setNegativeButton(com.deepseekharness.app.util.UiText.text("取消"), null).setPositiveButton(com.deepseekharness.app.util.UiText.text("恢复"), (d, which) -> repository.safeMode(false, null)).show());
        // 安装入口拆成两个：在线安装（链接/npm 包）与命令行安装（粘贴 dsh 命令）。
        view.findViewById(R.id.btnOnlineInstall).setOnClickListener(v -> showInstallDialog(false));
        view.findViewById(R.id.btnCommandInstallBtn).setOnClickListener(v -> showInstallDialog(true));
        view.findViewById(R.id.btnPluginHelp).setOnClickListener(v -> new com.deepseekharness.app.ui.DeepSeekHarnessDialogBuilder(requireContext())
                .setTitle(com.deepseekharness.app.util.UiText.text("使用提示"))
                .setMessage(com.deepseekharness.app.util.UiText.text("在线安装支持 GitHub 仓库、npm 包名、Release 下载链接和压缩包直链；命令行安装可直接粘贴 dsh 插件安装命令。安装或修改插件后，重启 Web 生效。导出包可在其他 DeepSeekHarness 中导入。"))
                .setPositiveButton(com.deepseekharness.app.util.UiText.text("知道了"), null).show());
        view.findViewById(R.id.btnImport).setOnClickListener(v -> chooseImport(false));
        view.findViewById(R.id.btnExport).setOnClickListener(v -> chooseExport());
        view.findViewById(R.id.btnSort).setOnClickListener(v -> showSortOptions());
        search.addTextChangedListener(watcher(this::render));
        // fork 定制：后台任务入口原先挂在 statusText（内联状态行，已随无商城版布局移除）。
        // 现改挂在插件计数上——该处常驻可见、不占用布局新 id，且语义相关（“共 N 个插件 / 后台任务”）。
        View count = view.findViewById(R.id.pluginCount);
        count.setOnClickListener(v -> BackgroundTasksActivity.open(requireContext()));
        count.setContentDescription(com.deepseekharness.app.util.UiText.text("插件数量，点按查看后台任务"));
        repository.state().observe(getViewLifecycleOwner(), state -> { current = state; render(); syncProgressDialog(state); });
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
        state.putBoolean("hideBuiltinOnly", hideBuiltinOnly);
        state.putString("sortOrder", sortOrder.name());
        state.putStringArrayList("pendingExports", pendingExports);
        if (pendingImport != null) state.putString("pendingImport", pendingImport.toString());
    }

    @Override public void onDestroyView() {
        refreshHandler.removeCallbacks(refreshInvalidated);
        if (previewDialog != null) { previewDialog.dismiss(); previewDialog = null; }
        if (progressDialog != null) { progressDialog.dismiss(); progressDialog = null; }
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
        previewDialog = new com.deepseekharness.app.ui.DeepSeekHarnessDialogBuilder(requireContext()).setTitle(com.deepseekharness.app.util.UiText.text(preview.action.equals("install")?"确认安装插件":"审阅插件启用或回退"))
                .setMessage(preview.description())
                .setNegativeButton(com.deepseekharness.app.util.UiText.text("取消"), (d, w) -> repository.discardPreview())
                .setPositiveButton(com.deepseekharness.app.util.UiText.text(preview.action.equals("install")?"确认安装":preview.action.equals("rollback")?"确认回退":"确认启用"), (d, w) -> repository.confirmPreview())
                .setOnCancelListener(d -> repository.discardPreview()).create();
        previewDialog.setOnDismissListener(d -> previewDialog = null);
        previewDialog.show();
        if(preview.blocked())previewDialog.getButton(android.content.DialogInterface.BUTTON_POSITIVE).setEnabled(false);
    }

    /** 安装入口：commandMode=false 为在线安装（链接/npm 包），true 为命令行安装（粘贴 dsh 命令）。 */
    private void showInstallDialog(boolean commandMode) {
        if (repository.isBusy()) { toast(com.deepseekharness.app.util.UiText.text("请等待当前插件操作完成后再安装")); return; }
        final EditText input = new EditText(requireContext());
        input.setSingleLine(true);
        input.setTextSize(14);
        input.setHint(commandMode ? com.deepseekharness.app.util.UiText.text("dsh plugin --profile web add 插件包名")
                : com.deepseekharness.app.util.UiText.text("插件链接或 npm 包名"));
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
        android.widget.LinearLayout body = new android.widget.LinearLayout(requireContext());
        body.setOrientation(android.widget.LinearLayout.VERTICAL);

        // 说明行
        final TextView desc = new TextView(requireContext());
        desc.setTextSize(12);
        desc.setTextColor(requireContext().getColor(R.color.text_muted));
        desc.setPadding(dp(4), 0, dp(4), dp(8));
        desc.setText(commandMode
                ? com.deepseekharness.app.util.UiText.text("粘贴 dsh 插件安装命令，将自动提取包名安装。\n例如：dsh plugin --profile web add 插件包名")
                : com.deepseekharness.app.util.UiText.text("支持 GitHub 仓库、npm 包名、Release 下载链接和压缩包直链。"));
        body.addView(desc);

        // 输入行：标签 + 输入框 + 粘贴
        android.widget.LinearLayout tagRow = new android.widget.LinearLayout(requireContext());
        tagRow.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        tagRow.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView tag = new TextView(requireContext());
        tag.setText(commandMode ? com.deepseekharness.app.util.UiText.text("命令") : com.deepseekharness.app.util.UiText.text("地址"));
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
        paste.setText(com.deepseekharness.app.util.UiText.text("粘贴"));
        paste.setTextColor(requireContext().getColor(R.color.primary));
        paste.setPadding(dp(10), dp(8), dp(6), dp(8));
        paste.setOnClickListener(v -> {
            ClipboardManager cm = (ClipboardManager) requireContext().getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = cm == null ? null : cm.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) { toast(com.deepseekharness.app.util.UiText.text("剪贴板没有内容")); return; }
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
        input.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {
                String raw = s.toString().trim();
                if (raw.isEmpty()) { hint.setText(""); return; }
                try {
                    String spec = commandMode ? extractPackageFromCommand(raw) : raw;
                    PluginSource source = PluginSource.parse(spec);
                    hint.setText(com.deepseekharness.app.util.UiText.text("已识别：") + source.description());
                    hint.setTextColor(requireContext().getColor(R.color.primary));
                } catch (IllegalArgumentException e) {
                    hint.setText(e.getMessage());
                    hint.setTextColor(requireContext().getColor(R.color.err));
                }
            }
            @Override public void afterTextChanged(Editable s) { }
        });
        input.setOnEditorActionListener((v, action, event) -> {
            if (action == EditorInfo.IME_ACTION_GO) {
                String raw = input.getText().toString().trim();
                if (!raw.isEmpty()) doInstall(commandMode, raw);
                return true;
            }
            return false;
        });

        AppDialogs.showCustom(requireContext(),
                commandMode ? android.R.drawable.ic_menu_edit : android.R.drawable.ic_menu_add,
                commandMode ? com.deepseekharness.app.util.UiText.text("命令行安装") : com.deepseekharness.app.util.UiText.text("在线安装"), body,
                com.deepseekharness.app.util.UiText.text("安装"), com.deepseekharness.app.util.UiText.text("取消"),
                () -> doInstall(commandMode, input.getText().toString().trim()));
    }

    private void doInstall(boolean commandMode, String raw) {
        if (raw.isEmpty()) { toast(com.deepseekharness.app.util.UiText.text("请输入内容")); return; }
        try {
            String spec = commandMode ? extractPackageFromCommand(raw) : raw;
            repository.install(PluginSource.parse(spec));
        } catch (IllegalArgumentException error) { toast(error.getMessage()); }
    }

    private int dp(int v) {
        return Math.round(v * requireContext().getResources().getDisplayMetrics().density);
    }

    /** 从 dsh/npx 插件安装命令中提取包名。
     *  形式：dsh|npx plugin [任意选项] add|install|安装 <包名>；失败时退化为整串里的第一个 npm 包名。 */
    private static String extractPackageFromCommand(String raw) {
        if (raw == null) return "";
        String value = raw.trim();
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile(
                "(?i)\\b(?:dsh|npx)\\s+plugin(?:\\s+-{1,2}[a-z]+(?:\\s+\\S+)?)*"
                + "\\s+(?:add|install|安装)\\s+(\\S+)").matcher(value);
        if (matcher.find()) return matcher.group(1).replaceAll("['\"，。；！）】]+$", "");
        java.util.regex.Matcher pkg = java.util.regex.Pattern.compile(
                "(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*(?:@[A-Za-z0-9.^~*+_-]+)?").matcher(value);
        if (pkg.find()) return pkg.group(0);
        return value;
    }

    /** Busy 与进度改由对话框承载；原布局的 pluginBusy/statusText 内联显示已随无商城版移除。 */
    private void syncProgressDialog(PluginRepository.State state) {
        if (state == null || root == null || isDetached()) return;
        if (state.busy) {
            if (progressDialog == null) {
                progressDialog = AppDialogs.showProgress(requireContext(),
                        android.R.drawable.ic_popup_sync, com.deepseekharness.app.util.UiText.text("正在处理插件"),
                        state.message, state.cancellable ? com.deepseekharness.app.util.UiText.text("取消") : null,
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

    private void render() {
        if (root == null || current == null) return;
        root.findViewById(R.id.btnPluginRestore).setVisibility(repository.isSafeMode() ? View.VISIBLE : View.GONE);
        for (int id : new int[]{R.id.btnImport, R.id.btnExport, R.id.btnRefresh, R.id.btnPluginUpdates,
                R.id.btnPluginRestore, R.id.btnOnlineInstall, R.id.btnCommandInstallBtn})
            root.findViewById(id).setEnabled(!current.busy);
        TextView sort = root.findViewById(R.id.btnSort);
        sort.setText(sortLabel());
        sort.setContentDescription(getString(R.string.plugin_sort_title) + " · " + sort.getText());
        String query = search.getText().toString().trim().toLowerCase(Locale.ROOT);
        boolean changed = renderedItems != current.items || !query.equals(renderedQuery)
                || renderedSort != sortOrder || renderedHideBuiltin != hideBuiltinOnly;
        boolean rebind = changed || renderedBusy != current.busy;
        // 阶段进度更新频繁；列表内容未变时只更新状态，保留滚动位置和展开控件。
        if (changed) {
            visibleItems.clear();
            for (PluginRepository.Item item : current.items) {
                if (hideBuiltinOnly && (item.builtin || item.official)) continue;
                if (!(item.name + " " + item.description).toLowerCase(Locale.ROOT).contains(query)) continue;
                visibleItems.add(item);
            }
            visibleItems.sort(PluginSort.comparator(sortOrder, it -> it.name, it -> it.enabled, it -> it.updateAvailable));
            renderedItems = current.items;
            renderedQuery = query;
            renderedSort = sortOrder;
            renderedHideBuiltin = hideBuiltinOnly;
        }
        renderedBusy = current.busy;
        ((TextView) root.findViewById(R.id.pluginCount)).setText(com.deepseekharness.app.util.UiText.text("共 ") + visibleItems.size() + com.deepseekharness.app.util.UiText.text(" 个插件"));
        TextView empty = root.findViewById(R.id.pluginEmpty);
        empty.setVisibility(visibleItems.isEmpty() ? View.VISIBLE : View.GONE);
        root.findViewById(R.id.pluginList).setVisibility(visibleItems.isEmpty() ? View.GONE : View.VISIBLE);
        empty.setText(current.busy ? com.deepseekharness.app.util.UiText.text("正在读取插件…") : com.deepseekharness.app.util.UiText.text("没有符合条件的插件"));
        if (rebind) adapter.notifyDataSetChanged();
        showInstallPreview();
    }

    /** 排序方式：0=名称A-Z 1=名称Z-A 2=已启用优先 3=可更新优先。 */
    private String sortLabel() {
        switch (sortOrder) {
            case NAME_DESC: return com.deepseekharness.app.util.UiText.text("名称 Z-A");
            case ENABLED_FIRST: return com.deepseekharness.app.util.UiText.text("已启用优先");
            case UPDATE_FIRST: return com.deepseekharness.app.util.UiText.text("可更新优先");
            default: return com.deepseekharness.app.util.UiText.text("名称 A-Z");
        }
    }

    private static final PluginSort.Mode[] SORT_ORDER = {
            PluginSort.Mode.NAME_ASC, PluginSort.Mode.NAME_DESC,
            PluginSort.Mode.ENABLED_FIRST, PluginSort.Mode.UPDATE_FIRST};

    private void showSortOptions() {
        android.widget.LinearLayout body = new android.widget.LinearLayout(requireContext());
        body.setOrientation(android.widget.LinearLayout.VERTICAL);
        String[] labels = {com.deepseekharness.app.util.UiText.text("名称 A-Z"),
                com.deepseekharness.app.util.UiText.text("名称 Z-A"),
                com.deepseekharness.app.util.UiText.text("已启用优先"),
                com.deepseekharness.app.util.UiText.text("可更新优先")};
        for (int i = 0; i < labels.length; i++) {
            final PluginSort.Mode mode = SORT_ORDER[i];
            TextView row = new TextView(requireContext());
            row.setText(labels[i]);
            row.setTextSize(15);
            row.setGravity(android.view.Gravity.CENTER_VERTICAL);
            row.setPadding(dp(16), dp(12), dp(16), dp(12));
            row.setBackgroundResource(R.drawable.bg_drawer_item);
            row.setMinHeight(dp(48));
            if (sortOrder == mode) {
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
                sortOrder = mode;
                new com.deepseekharness.app.core.ConfigStore(requireContext()).setPluginSort(sortOrder);
                render();
            });
            body.addView(row);
        }
        // 只看自己装的（过滤内置/官方插件）：原布局里的 chkHideBuiltin 复选框改为此处开关。
        com.google.android.material.materialswitch.MaterialSwitch onlyMine =
                new com.google.android.material.materialswitch.MaterialSwitch(requireContext());
        onlyMine.setText(com.deepseekharness.app.util.UiText.text("只看自己装的"));
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
        AppDialogs.showCustom(requireContext(), android.R.drawable.ic_menu_sort_by_size,
                com.deepseekharness.app.util.UiText.text("插件排序"), body,
                com.deepseekharness.app.util.UiText.text("关闭"), null, null);
    }

    private void chooseImport(boolean alternative) {
        if (repository.isBusy()) { toast(com.deepseekharness.app.util.UiText.text("请等待当前插件操作完成后再导入")); return; }
        View focus = requireActivity().getCurrentFocus();
        if (focus != null) {
            android.view.inputmethod.InputMethodManager keyboard = (android.view.inputmethod.InputMethodManager)
                    requireContext().getSystemService(Context.INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(focus.getWindowToken(), 0);
            focus.clearFocus();
        }
        repository.selectionMessage(com.deepseekharness.app.util.UiText.text("请选择插件压缩包；文件选择器无法返回时，可使用「其他文件选择器」。"));
        try { importPicker.launch(PluginFilePicker.intent(requireContext(), alternative)); }
        catch (android.content.ActivityNotFoundException error) {
            if (!alternative) { chooseImport(true); return; }
            repository.selectionMessage(com.deepseekharness.app.util.UiText.text("未找到可用的文件选择器，请启用系统「文件」应用后重试。"));
            toast(com.deepseekharness.app.util.UiText.text("没有可用的文件选择器"));
        } catch (RuntimeException error) {
            repository.selectionMessage(com.deepseekharness.app.util.UiText.text("无法打开文件选择器，请使用备用入口：") + error.getClass().getSimpleName());
        }
    }

    private void chooseExport() {
        if (current == null || repository.isBusy()) return;
        List<String> names = new ArrayList<>();
        for (PluginRepository.Item item : current.items) if (item.exportable) names.add(item.name);
        if (names.isEmpty()) { toast(com.deepseekharness.app.util.UiText.text("没有可导出的插件")); return; }
        boolean[] checked = new boolean[names.size()];
        AlertDialog dialog = new com.deepseekharness.app.ui.DeepSeekHarnessDialogBuilder(requireContext())
                .setTitle(com.deepseekharness.app.util.UiText.text("选择要导出的插件"))
                .setMultiChoiceItems(names.toArray(new String[0]), checked, (d, which, value) -> {
                    checked[which] = value;
                    boolean any = false;
                    for (boolean selected : checked) any |= selected;
                    ((AlertDialog) d).getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(any);
                })
                .setNegativeButton(com.deepseekharness.app.util.UiText.text("取消"), null)
                .setPositiveButton(com.deepseekharness.app.util.UiText.text("选择保存位置"), (d, which) -> {
                    ArrayList<String> selected = new ArrayList<>();
                    for (int i = 0; i < checked.length; i++) if (checked[i]) selected.add(names.get(i));
                    beginExport(selected);
                }).create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false));
        dialog.show();
    }

    private void beginExport(ArrayList<String> names) {
        if (names.isEmpty() || repository.isBusy()) return;
        pendingExports = names;
        String name = names.size() == 1 ? names.get(0).replaceAll("[^A-Za-z0-9._-]", "_") : "DEEPSEEK_HARNESS-plugins";
        String stamp = new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new java.util.Date());
        try { exportPicker.launch(name + "-" + stamp + ".tar.gz"); }
        catch (Exception error) { pendingExports.clear(); toast(com.deepseekharness.app.util.UiText.text("无法打开保存位置选择器")); }
    }

    private void toggle(PluginRepository.Item item, boolean enabled) {
        if (repository.isBusy()) { adapter.notifyDataSetChanged(); return; }
        if (item.official && !enabled) {
            new com.deepseekharness.app.ui.DeepSeekHarnessDialogBuilder(requireContext()).setTitle(com.deepseekharness.app.util.UiText.text("禁用官方核心？"))
                    .setMessage(item.name + com.deepseekharness.app.util.UiText.text(" 是 Web 运行所需的核心，禁用后页面可能无法启动。"))
                    .setPositiveButton(com.deepseekharness.app.util.UiText.text("禁用"), (d, which) -> repository.setEnabled(item, false))
                    .setNegativeButton(com.deepseekharness.app.util.UiText.text("取消"), null)
                    .setOnDismissListener(d -> adapter.notifyDataSetChanged()).show();
        } else repository.setEnabled(item, enabled);
    }

    private void itemActions(PluginRepository.Item item) {
        // 动作串必须【就地】经 UiText.text 包装成当前渲染语言，不能只在渲染点包一次：
        // 下面的分支要用 action.equals(...) 做比较，裸中文会把比较基准钉死在中文上。
        // （HEAD 版本即为就地包装，Step 4 重写时误删，此处按 HEAD 恢复。）
        List<String> actions = new ArrayList<>();
        actions.add(com.deepseekharness.app.util.UiText.text("查看详情"));
        actions.add(com.deepseekharness.app.util.UiText.text("复制插件名称"));
        if (!item.source.isEmpty()) actions.add(com.deepseekharness.app.util.UiText.text("复制来源链接"));
        if (item.exportable) actions.add(com.deepseekharness.app.util.UiText.text("导出插件包"));
        if (item.deletable) actions.add(com.deepseekharness.app.util.UiText.text("检查插件更新"));
        if (item.updateAvailable) actions.add(com.deepseekharness.app.util.UiText.text("更新至 ") + item.latestVersion);
        if (!item.rollbackVersion.isEmpty()) actions.add(com.deepseekharness.app.util.UiText.text("回退至 ") + item.rollbackVersion);
        if (item.deletable) actions.add(com.deepseekharness.app.util.UiText.text("删除插件"));
        new com.deepseekharness.app.ui.DeepSeekHarnessDialogBuilder(requireContext()).setTitle(item.name)
                .setItems(actions.toArray(new String[0]), (d, which) -> {
                    String action = actions.get(which);
                    if (action.equals(com.deepseekharness.app.util.UiText.text("查看详情"))) {
                        new com.deepseekharness.app.ui.DeepSeekHarnessDialogBuilder(requireContext()).setTitle(item.name)
                                .setMessage(item.description + com.deepseekharness.app.util.UiText.text("\n\n版本：") + item.version
                                        + (item.location.isEmpty() ? "" : com.deepseekharness.app.util.UiText.text("\n位置：") + item.location)
                                        + (item.source.isEmpty() ? "" : com.deepseekharness.app.util.UiText.text("\n来源：") + item.source)
                                        + (item.latestVersion.isEmpty() ? "" : com.deepseekharness.app.util.UiText.text("\n上次检查版本：") + item.latestVersion)
                                        + (item.updateMessage.isEmpty() ? "" : "\n" + com.deepseekharness.app.util.UiStateText.render(item.updateMessage))
                                        + (item.rollbackVersion.isEmpty() ? "" : com.deepseekharness.app.util.UiText.text("\n可回退：") + item.rollbackVersion))
                                .setPositiveButton(com.deepseekharness.app.util.UiText.text("关闭"), null).show();
                    } else if (action.equals(com.deepseekharness.app.util.UiText.text("检查插件更新"))) {
                        repository.checkUpdates(item);
                    } else if (action.startsWith(com.deepseekharness.app.util.UiText.text("更新至 "))) {
                        repository.prepareUpdate(item);
                    } else if (action.startsWith(com.deepseekharness.app.util.UiText.text("回退至 "))) {
                        new com.deepseekharness.app.ui.DeepSeekHarnessDialogBuilder(requireContext()).setTitle(com.deepseekharness.app.util.UiText.text("回退插件？"))
                                .setMessage(item.name + com.deepseekharness.app.util.UiText.text("：") + item.version + " → " + item.rollbackVersion
                                        + com.deepseekharness.app.util.UiText.text("\n只恢复插件文件，当前启用状态和对话数据保留；重启 Web 生效。"))
                                .setNegativeButton(com.deepseekharness.app.util.UiText.text("取消"), null).setPositiveButton(com.deepseekharness.app.util.UiText.text("回退"), (confirm, button) -> repository.rollback(item)).show();
                    } else if (action.equals(com.deepseekharness.app.util.UiText.text("导出插件包"))) {
                        ArrayList<String> names = new ArrayList<>();
                        names.add(item.name);
                        beginExport(names);
                    } else if (action.equals(com.deepseekharness.app.util.UiText.text("删除插件"))) {
                        if (repository.isBusy()) { toast(com.deepseekharness.app.util.UiText.text("请等待当前插件操作完成")); return; }
                        new com.deepseekharness.app.ui.DeepSeekHarnessDialogBuilder(requireContext()).setTitle(com.deepseekharness.app.util.UiText.text("删除插件？"))
                                .setMessage(com.deepseekharness.app.util.UiText.text("将删除 ") + item.name + com.deepseekharness.app.util.UiText.text(" 的安装文件和启用记录。")
                                        + com.deepseekharness.app.util.UiText.text("\n对话、其他插件及外部源码目录会保留。需要留存时可先导出。"))
                                .setNegativeButton(com.deepseekharness.app.util.UiText.text("取消"), null)
                                .setPositiveButton(com.deepseekharness.app.util.UiText.text("删除"), (confirm, button) -> repository.delete(item)).show();
                    } else {
                        ClipboardManager clipboard = (ClipboardManager) requireContext()
                                .getSystemService(Context.CLIPBOARD_SERVICE);
                        if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText(com.deepseekharness.app.util.UiText.text("插件"),
                                action.equals(com.deepseekharness.app.util.UiText.text("复制插件名称")) ? item.name : item.source));
                        toast(com.deepseekharness.app.util.UiText.text("已复制"));
                    }
                }).show();
    }

    private void toast(String message) {
        if (isAdded()) Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show();
    }

    private class Adapter extends RecyclerView.Adapter<Adapter.Holder> {
        class Holder extends RecyclerView.ViewHolder {
            final TextView name, state, description;
            final android.widget.CompoundButton toggle;
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
            holder.state.setText((item.dynamic ? (item.enabled ? com.deepseekharness.app.util.UiText.text("临时插件 · 已运行") : com.deepseekharness.app.util.UiText.text("临时插件 · 未运行"))
                    : item.available ? (item.enabled ? com.deepseekharness.app.util.UiText.text("已启用") : item.detected ? com.deepseekharness.app.util.UiText.text("已检测，可开启以加入 Web") : com.deepseekharness.app.util.UiText.text("已禁用")) : com.deepseekharness.app.util.UiText.text("实体缺失，请重新导入"))
                    + (item.version.isEmpty() ? "" : " · " + item.version)
                    + (item.updateAvailable ? com.deepseekharness.app.util.UiText.text("\n可更新：") + item.latestVersion : ""));
            if(!item.dynamic&&!item.loadState.isEmpty()){
                String state=switch(item.loadState){
                    case "review-required" -> "待审阅启用";
                    case "queued" -> "已批准，等待加载";
                    case "attempted" -> "正在确认加载";
                    case "loaded" -> item.enabled?"已确认加载":"已禁用";
                    case "failed", "unconfirmed" -> "加载未确认，保持停用";
                    case "changed" -> "内容已变化，需要重新审阅";
                    default -> item.enabled?"已启用":"已禁用";
                };
                holder.state.setText(com.deepseekharness.app.util.UiText.text(state)+(item.version.isEmpty()?"":" · "+item.version)
                        +(item.updateAvailable?com.deepseekharness.app.util.UiText.text("\n可更新：")+item.latestVersion:""));
            }
            holder.state.setTextColor(requireContext().getColor(
                    !item.available ? R.color.warn : item.enabled ? R.color.primary : R.color.text_muted));
            holder.description.setText(item.description.isEmpty()
                    ? (item.official ? com.deepseekharness.app.util.UiText.text("官方核心") : item.builtin ? com.deepseekharness.app.util.UiText.text("DeepSeekHarness 内置插件") : com.deepseekharness.app.util.UiText.text("第三方插件")) : item.builtin || item.official || item.dynamic ? com.deepseekharness.app.util.UiStateText.render(item.description) : item.description);
            holder.itemView.findViewById(R.id.pluginActions).setOnClickListener(v -> itemActions(item));
            holder.itemView.findViewById(R.id.pluginActions).setContentDescription(com.deepseekharness.app.util.UiText.text("更多操作：") + item.name);
            android.widget.Button expand=holder.itemView.findViewById(R.id.pluginExpand),delete=holder.itemView.findViewById(R.id.pluginDelete);
            TextView details=holder.itemView.findViewById(R.id.pluginDetails);
            String location=item.location.isEmpty()?com.deepseekharness.app.util.UiText.choose("未提供路径", "Path not provided"):item.location;
            String source=item.source.isEmpty()?(item.builtin?com.deepseekharness.app.util.UiText.choose("随包内置", "Bundled"):item.official?com.deepseekharness.app.util.UiText.choose("DSH 官方组件", "Official DSH component"):com.deepseekharness.app.util.UiText.choose("来源未记录", "Source not recorded")):item.source;
            details.setText(item.description+"\n\n"+com.deepseekharness.app.util.UiText.choose("版本：", "Version: ")+item.version+"\n"+com.deepseekharness.app.util.UiText.choose("位置：", "Location: ")+location+"\n"+com.deepseekharness.app.util.UiText.choose("来源：", "Source: ")+source);
            details.setVisibility(expandedPlugins.contains(item.name)?View.VISIBLE:View.GONE);
            expand.setText(expandedPlugins.contains(item.name)?com.deepseekharness.app.util.UiText.choose("收起详情", "Collapse details"):com.deepseekharness.app.util.UiText.choose("展开插件详情", "Plugin details"));
            expand.setOnClickListener(v->{if(!expandedPlugins.add(item.name))expandedPlugins.remove(item.name);int at=holder.getAdapterPosition();if(at!=RecyclerView.NO_POSITION)notifyItemChanged(at);});
            delete.setVisibility(item.deletable?View.VISIBLE:View.GONE);delete.setEnabled(!repository.isBusy());
            delete.setText(com.deepseekharness.app.util.UiText.choose("删除插件", "Delete plugin"));
            delete.setOnClickListener(v->{if(repository.isBusy())return;new DeepSeekHarnessDialogBuilder(requireContext()).setTitle(com.deepseekharness.app.util.UiText.choose("删除插件？", "Delete plugin?"))
                    .setMessage(item.name+com.deepseekharness.app.util.UiText.choose(" 的安装文件与启用记录将删除；对话、其他插件和外部源码目录保留。", " installation and enabled state will be removed. Conversations, other plugins and external source folders remain."))
                    .setNegativeButton(com.deepseekharness.app.util.UiText.choose("取消", "Cancel"),null)
                    .setPositiveButton(com.deepseekharness.app.util.UiText.choose("删除", "Delete"),(dialog,which)->repository.delete(item)).show();});
            holder.toggle.setVisibility(item.dynamic ? View.GONE : View.VISIBLE);
            holder.toggle.setOnCheckedChangeListener(null);
            holder.toggle.setChecked(item.enabled);
            holder.toggle.setContentDescription((item.enabled ? com.deepseekharness.app.util.UiText.text("禁用 ") : com.deepseekharness.app.util.UiText.text("启用 ")) + item.name);
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
