package com.deepseekharness.app.ui;

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
    private EditText linkInput, search, commandInput;
    private TextView linkHint;
    private CheckBox hideBuiltin;
    private boolean market = true, enabledFirst;
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
                repository.selectionMessage("环境任务已结束；当前显示缓存列表，可点「刷新」同步插件状态");
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
                    repository.selectionMessage("未选择文件或文件管理器未返回文件。可点「其他文件选择器」重试，选择 ZIP / TAR.GZ 插件包。");
                    return;
                }
                if (!"content".equals(uri.getScheme()) && !"file".equals(uri.getScheme())) {
                    repository.selectionMessage("文件管理器返回的地址无法读取，请改用系统文件选择器。");
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
                else repository.selectionMessage("未获得文件读取权限，请改用系统文件选择器导入。");
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
        if (getArguments() != null && getArguments().getBoolean("show_installed", false)) market = false;
        if (saved != null) {
            market = saved.getBoolean("market", true);
            enabledFirst = saved.getBoolean("enabledFirst");
            ArrayList<String> names = saved.getStringArrayList("pendingExports");
            if (names != null) pendingExports = names;
            String imported = saved.getString("pendingImport");
            if (imported != null) pendingImport = android.net.Uri.parse(imported);
        }
        linkInput = view.findViewById(R.id.appbar_github_input);
        linkHint = view.findViewById(R.id.pluginLinkHint);
        commandInput = view.findViewById(R.id.commandInput);
        final View btnCommandInstall = view.findViewById(R.id.btnPluginCommandInstall);
        btnCommandInstall.setOnClickListener(v -> installCommand());
        // DeepSeekHarness：命令输入为空时禁用安装按钮（与在线安装一致）
        final Runnable syncCommandState = () -> btnCommandInstall.setEnabled(
                !commandInput.getText().toString().trim().isEmpty() && !repository.isBusy());
        commandInput.addTextChangedListener(new android.text.TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) { syncCommandState.run(); }
            @Override public void afterTextChanged(android.text.Editable s) { }
        });
        syncCommandState.run();
        view.findViewById(R.id.btnPluginCommandPaste).setOnClickListener(v -> pasteCommand());
        commandInput.setOnEditorActionListener((v, action, event) -> {
            if (action == android.view.inputmethod.EditorInfo.IME_ACTION_GO
                    || action == android.view.inputmethod.EditorInfo.IME_ACTION_DONE
                    || (event != null && event.getKeyCode() == android.view.KeyEvent.KEYCODE_ENTER
                    && event.getAction() == android.view.KeyEvent.ACTION_UP)) {
                installCommand();
                return true;
            }
            return false;
        });
        search = view.findViewById(R.id.pluginSearch);
        hideBuiltin = view.findViewById(R.id.chkHideBuiltin);
        RecyclerView list = view.findViewById(R.id.pluginList);
        list.setLayoutManager(new LinearLayoutManager(requireContext()));
        list.setNestedScrollingEnabled(false);
        list.setItemAnimator(null);
        list.setAdapter(adapter);
        view.findViewById(R.id.btnMarket).setOnClickListener(v -> selectTab(true));
        view.findViewById(R.id.btnInstalled).setOnClickListener(v -> selectTab(false));
        view.findViewById(R.id.btnRefresh).setOnClickListener(v -> repository.refresh());
        view.findViewById(R.id.btnPluginUpdates).setOnClickListener(v -> repository.checkUpdates(null));
        view.findViewById(R.id.btnPluginRestore).setOnClickListener(v -> AppDialogs.show(requireContext(),
                android.R.drawable.ic_menu_revert, "恢复第三方插件？",
                "恢复安全启动前已启用的插件；之后手动禁用的插件保持禁用。恢复后重启 Web 生效。",
                "恢复", "取消", () -> repository.safeMode(false, null)));
        view.findViewById(R.id.btnPluginInstall).setOnClickListener(v -> installLink());
        view.findViewById(R.id.btnPluginPaste).setOnClickListener(v -> pasteLink());
        view.findViewById(R.id.btnImport).setOnClickListener(v -> chooseImport(false));
        view.findViewById(R.id.btnImportFallback).setOnClickListener(v -> chooseImport(true));
        view.findViewById(R.id.btnExport).setOnClickListener(v -> chooseExport());
        view.findViewById(R.id.btnSort).setOnClickListener(v -> { enabledFirst = !enabledFirst; render(); });
        hideBuiltin.setOnCheckedChangeListener((v, checked) -> render());
        search.addTextChangedListener(watcher(this::render));
        linkInput.addTextChangedListener(watcher(this::recognizeLink));
        linkInput.setOnEditorActionListener((v, action, event) -> {
            if (action == EditorInfo.IME_ACTION_GO || action == EditorInfo.IME_ACTION_DONE
                    || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER
                    && event.getAction() == KeyEvent.ACTION_UP)) {
                installLink();
                return true;
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
        recognizeLink();
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
        state.putBoolean("market", market);
        state.putBoolean("enabledFirst", enabledFirst);
        state.putStringArrayList("pendingExports", pendingExports);
        if (pendingImport != null) state.putString("pendingImport", pendingImport.toString());
    }

    @Override public void onDestroyView() {
        refreshHandler.removeCallbacks(refreshInvalidated);
        if (previewDialog != null) { previewDialog.dismiss(); previewDialog = null; }
        ((RecyclerView) root.findViewById(R.id.pluginList)).setAdapter(null);
        root = null;
        linkInput = null;
        search = null;
        linkHint = null;
        hideBuiltin = null;
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
                "确认安装插件", preview.description, "确认安装", "取消",
                () -> repository.confirmPreview());
        previewDialog.setOnCancelListener(d -> { repository.discardPreview(); previewDialog = null; });
        previewDialog.setOnDismissListener(d -> previewDialog = null);
    }

    private void recognizeLink() {
        if (root == null) return;
        String input = linkInput.getText().toString();
        boolean valid = false;
        try {
            PluginSource source = PluginSource.parse(input);
            linkHint.setText("已识别：" + source.description());
            valid = true;
        } catch (IllegalArgumentException error) {
            linkHint.setText(input.trim().isEmpty() ? "支持仓库、分支/子目录、Release 下载和压缩包直链"
                    : error.getMessage());
        }
        root.findViewById(R.id.btnPluginInstall).setEnabled(valid && !repository.isBusy());
    }

    private void selectTab(boolean showMarket) {
        market = showMarket;
        linkInput.clearFocus();
        search.clearFocus();
        android.view.inputmethod.InputMethodManager keyboard = (android.view.inputmethod.InputMethodManager)
                requireContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        if (keyboard != null) keyboard.hideSoftInputFromWindow(root.getWindowToken(), 0);
        render();
        androidx.core.widget.NestedScrollView scroll = root.findViewById(R.id.pluginScroll);
        scroll.post(() -> scroll.scrollTo(0, 0));
    }

    private void installLink() {
        if (repository.isBusy()) return;
        try {
            PluginSource source = PluginSource.parse(linkInput.getText().toString());
            android.view.inputmethod.InputMethodManager keyboard = (android.view.inputmethod.InputMethodManager)
                    requireContext().getSystemService(android.content.Context.INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(linkInput.getWindowToken(),0);
            linkInput.clearFocus();
            repository.install(source);
        }
        catch (IllegalArgumentException error) { toast(error.getMessage()); }
    }

    /** DeepSeekHarness：从 dsh plugin --profile web add <包名> 命令中提取包名并安装。 */
    private void installCommand() {
        if (repository.isBusy()) return;
        try {
            String raw = commandInput.getText().toString().trim();
            String spec = extractPackageFromCommand(raw);
            PluginSource source = PluginSource.parse(spec);
            android.view.inputmethod.InputMethodManager keyboard = (android.view.inputmethod.InputMethodManager)
                    requireContext().getSystemService(android.content.Context.INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(commandInput.getWindowToken(), 0);
            commandInput.clearFocus();
            repository.install(source);
        }
        catch (IllegalArgumentException error) { toast(error.getMessage()); }
    }

    private void pasteCommand() {
        android.content.ClipboardManager clipboard = (android.content.ClipboardManager)
                requireContext().getSystemService(android.content.Context.CLIPBOARD_SERVICE);
        android.content.ClipData clip = clipboard == null ? null : clipboard.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) { toast("剪贴板没有命令"); return; }
        CharSequence text = clip.getItemAt(0).coerceToText(requireContext());
        if (text != null) commandInput.setText(text);
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
        if (repository.isBusy()) { toast("请等待当前插件操作完成后再导入"); return; }
        View focus = requireActivity().getCurrentFocus();
        if (focus != null) {
            android.view.inputmethod.InputMethodManager keyboard = (android.view.inputmethod.InputMethodManager)
                    requireContext().getSystemService(Context.INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(focus.getWindowToken(), 0);
            focus.clearFocus();
        }
        repository.selectionMessage("请选择插件压缩包；文件选择器无法返回时，可使用「其他文件选择器」。");
        try { importPicker.launch(PluginFilePicker.intent(requireContext(), alternative)); }
        catch (android.content.ActivityNotFoundException error) {
            if (!alternative) { chooseImport(true); return; }
            repository.selectionMessage("未找到可用的文件选择器，请启用系统「文件」应用后重试。");
            toast("没有可用的文件选择器");
        } catch (RuntimeException error) {
            repository.selectionMessage("无法打开文件选择器，请使用备用入口：" + error.getClass().getSimpleName());
        }
    }

    private void pasteLink() {
        ClipboardManager clipboard = (ClipboardManager) requireContext().getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = clipboard == null ? null : clipboard.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) { toast("剪贴板没有链接"); return; }
        CharSequence text = clip.getItemAt(0).coerceToText(requireContext());
        if (text != null) linkInput.setText(text);
    }

    /** DeepSeekHarness：耗时插件操作（下载/安装/更新）期间弹出带进度条的弹窗。 */
    private void syncProgressDialog(PluginRepository.State state) {
        if (state == null || root == null || isDetached()) return;
        if (state.busy) {
            if (progressDialog == null) {
                progressDialog = AppDialogs.showProgress(requireContext(),
                        android.R.drawable.ic_popup_sync, "正在处理插件", state.message,
                        state.cancellable ? "取消" : null,
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
        String title = "插件操作结果";
        int icon = android.R.drawable.ic_menu_info_details;
        if ("静默".equals(op)) {
           lastResultShown = state.message; // 静默同步不弹结果窗
            return;
        }
        if ("安装".equals(op) && repository.installationSucceeded()) { title = "安装成功"; icon = android.R.drawable.ic_menu_save; }
        else if ("检测".equals(op)) { title = "检测完成"; icon = android.R.drawable.ic_popup_sync; }
        else if ("删除".equals(op)) { title = "插件已删除"; icon = android.R.drawable.ic_menu_delete; }
        else if ("回退".equals(op)) { title = "插件已回退"; icon = android.R.drawable.ic_menu_revert; }
        else if ("更新".equals(op)) { title = "插件已更新"; icon = android.R.drawable.ic_popup_sync; }
        else if ("状态".equals(op)) { title = "插件状态已更新"; icon = android.R.drawable.ic_menu_info_details; }
        else if (state.message.startsWith("已删除")) { title = "插件已删除"; icon = android.R.drawable.ic_menu_delete; }
        else if (state.message.startsWith("已禁用") || state.message.startsWith("已启用")) title = "插件状态已更新";
        else if (state.message.startsWith("已更新")) { title = "插件已更新"; icon = android.R.drawable.ic_popup_sync; }
        AppDialogs.show(requireContext(), icon, title, state.message, "关闭", null, null);
    }

    private void render() {
        if (root == null || current == null) return;
        root.findViewById(R.id.pluginMarketCard).setVisibility(market ? View.VISIBLE : View.GONE);
        root.findViewById(R.id.marketHelp).setVisibility(market ? View.VISIBLE : View.GONE);
        root.findViewById(R.id.pluginWebsiteSection).setVisibility(market ? View.VISIBLE : View.GONE);
        root.findViewById(R.id.pluginCommandCard).setVisibility(market ? View.VISIBLE : View.GONE);
        root.findViewById(R.id.pluginLinkSection).setVisibility(market ? View.VISIBLE : View.GONE);
        root.findViewById(R.id.btnPluginRestore).setVisibility(repository.isSafeMode() ? View.VISIBLE : View.GONE);
        root.findViewById(R.id.installedControls).setVisibility(market ? View.GONE : View.VISIBLE);
        root.findViewById(R.id.pluginList).setVisibility(market ? View.GONE : View.VISIBLE);
        root.findViewById(R.id.btnMarket).setBackgroundResource(market ? R.drawable.bg_tab_on : R.drawable.bg_tab);
        root.findViewById(R.id.btnInstalled).setBackgroundResource(market ? R.drawable.bg_tab : R.drawable.bg_tab_on);
        ((TextView) root.findViewById(R.id.btnMarket)).setTextColor(requireContext().getColor(
                market ? R.color.primary : R.color.text_secondary));
        ((TextView) root.findViewById(R.id.btnInstalled)).setTextColor(requireContext().getColor(
                market ? R.color.text_secondary : R.color.primary));
        for (int id : new int[]{R.id.btnImport, R.id.btnImportFallback, R.id.btnExport, R.id.btnRefresh, R.id.btnPluginUpdates, R.id.btnPluginRestore})
            root.findViewById(id).setEnabled(!current.busy);
        ((TextView) root.findViewById(R.id.btnSort)).setText(enabledFirst ? "已启用优先" : "名称排序");
        visibleItems.clear();
        String query = search.getText().toString().trim().toLowerCase(Locale.ROOT);
        for (PluginRepository.Item item : current.items) {
            if (hideBuiltin.isChecked() && (item.builtin || item.official)) continue;
            if (!(item.name + " " + item.description).toLowerCase(Locale.ROOT).contains(query)) continue;
            visibleItems.add(item);
        }
        Comparator<PluginRepository.Item> comparator = Comparator.comparing(it -> it.name.toLowerCase(Locale.ROOT));
        if (enabledFirst) comparator = Comparator.<PluginRepository.Item, Boolean>comparing(it -> !it.enabled)
                .thenComparing(comparator);
        visibleItems.sort(comparator);
        ((TextView) root.findViewById(R.id.pluginCount)).setText("共 " + visibleItems.size() + " 个插件");
        TextView empty = root.findViewById(R.id.pluginEmpty);
        empty.setVisibility(!market && visibleItems.isEmpty() ? View.VISIBLE : View.GONE);
        empty.setText(current.busy ? "正在读取插件…" : "没有符合条件的插件");
        adapter.notifyDataSetChanged();
        recognizeLink();
        showInstallPreview();
    }

    private void chooseExport() {
        if (current == null || repository.isBusy()) return;
        List<String> names = new ArrayList<>();
        for (PluginRepository.Item item : current.items) if (item.exportable) names.add(item.name);
        if (names.isEmpty()) { toast("没有可导出的插件"); return; }
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
        AppDialogs.showCustom(requireContext(), android.R.drawable.ic_menu_upload, "选择要导出的插件",
                list, "选择保存位置", "取消", () -> {
                    ArrayList<String> selected = new ArrayList<>();
                    for (int i = 0; i < boxes.length; i++) if (boxes[i].isChecked()) selected.add(names.get(i));
                    if (selected.isEmpty()) { toast("请至少选择一个插件"); return; }
                    beginExport(selected);
                });
    }

    private void beginExport(ArrayList<String> names) {
        if (names.isEmpty() || repository.isBusy()) return;
        pendingExports = names;
        String name = names.size() == 1 ? names.get(0).replaceAll("[^A-Za-z0-9._-]", "_") : "DeepSeekHarness-plugins";
        String stamp = new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new java.util.Date());
        try { exportPicker.launch(name + "-" + stamp + ".tar.gz"); }
        catch (Exception error) { pendingExports.clear(); toast("无法打开保存位置选择器"); }
    }

    private void toggle(PluginRepository.Item item, boolean enabled) {
        if (repository.isBusy()) { adapter.notifyDataSetChanged(); return; }
        if (item.official && !enabled) {
            AlertDialog dialog = AppDialogs.show(requireContext(), android.R.drawable.ic_dialog_alert, "禁用官方核心？",
                    item.name + " 是 Web 运行所需的核心，禁用后页面可能无法启动。",
                    "禁用", "取消", () -> repository.setEnabled(item, false));
            dialog.setOnDismissListener(d -> adapter.notifyDataSetChanged());
        } else repository.setEnabled(item, enabled);
    }

    private void itemActions(PluginRepository.Item item) {
        List<String> actions = new ArrayList<>();
        actions.add("复制插件名称");
        if (!item.source.isEmpty()) actions.add("复制来源链接");
        if (item.exportable) actions.add("导出插件包");
        if (item.deletable) actions.add("检查插件更新");
        if (item.updateAvailable) actions.add("更新至 " + item.latestVersion);
        if (!item.rollbackVersion.isEmpty()) actions.add("回退至 " + item.rollbackVersion);
        if (item.deletable) actions.add("删除插件");
        AppDialogs.showList(requireContext(), android.R.drawable.ic_menu_more, item.name,
                actions.toArray(new String[0]), which -> {
                    String action = actions.get(which);
                    if (action.equals("检查插件更新")) {
                        repository.checkUpdates(item);
                    } else if (action.startsWith("更新至 ")) {
                        repository.prepareUpdate(item);
                    } else if (action.startsWith("回退至 ")) {
                        AppDialogs.show(requireContext(), android.R.drawable.ic_menu_revert, "回退插件？",
                                item.name + "：" + item.version + " → " + item.rollbackVersion
                                        + "\n只恢复插件文件，当前启用状态和对话数据保留；重启 Web 生效。",
                                "回退", "取消", () -> repository.rollback(item));
                    } else if (action.equals("导出插件包")) {
                        ArrayList<String> names = new ArrayList<>();
                        names.add(item.name);
                        beginExport(names);
                    } else if (action.equals("删除插件")) {
                        if (repository.isBusy()) { toast("请等待当前插件操作完成"); return; }
                        AppDialogs.show(requireContext(), android.R.drawable.ic_menu_delete, "删除插件？",
                                "将删除 " + item.name + " 的安装文件和启用记录。"
                                        + "\n对话、其他插件及外部源码目录会保留。需要留存时可先导出。",
                                "删除", "取消", () -> repository.delete(item));
                    } else {
                        ClipboardManager clipboard = (ClipboardManager) requireContext()
                                .getSystemService(Context.CLIPBOARD_SERVICE);
                        if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("插件",
                                action.equals("复制插件名称") ? item.name : item.source));
                        toast("已复制");
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
            holder.state.setText((item.dynamic ? (item.enabled ? "临时插件 · 已运行" : "临时插件 · 未运行")
                    : item.available ? (item.enabled ? "已启用" : item.detected ? "已检测，可开启以加入 Web" : "已禁用") : "实体缺失，请重新导入")
                    + (item.version.isEmpty() ? "" : " · " + item.version)
                    + (item.location.isEmpty() ? "" : "\n位置：" + item.location)
                    + (item.updateAvailable ? "\n可更新：" + item.latestVersion
                            : (item.latestVersion.isEmpty() ? "" : "\n上次检查版本：" + item.latestVersion)
                            + (item.updateMessage.isEmpty() ? "" : "\n" + item.updateMessage))
                    + (item.rollbackVersion.isEmpty() ? "" : "\n可回退：" + item.rollbackVersion));
            holder.state.setTextColor(requireContext().getColor(
                    !item.available ? R.color.warn : item.enabled ? R.color.primary : R.color.text_muted));
            holder.description.setText(item.description.isEmpty()
                    ? (item.official ? "官方核心" : item.builtin ? "DeepSeek Harness 内置插件" : "第三方插件") : item.description);
            holder.itemView.findViewById(R.id.pluginActions).setOnClickListener(v -> itemActions(item));
            holder.itemView.findViewById(R.id.pluginActions).setContentDescription("更多操作：" + item.name);
            holder.toggle.setVisibility(item.dynamic ? View.GONE : View.VISIBLE);
            holder.toggle.setOnCheckedChangeListener(null);
            holder.toggle.setChecked(item.enabled);
            holder.toggle.setContentDescription((item.enabled ? "禁用 " : "启用 ") + item.name);
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
