package com.deepseekharness.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.graphics.Point;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import android.webkit.MimeTypeMap;

import com.deepseekharness.app.util.SensitiveData;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.Objects;

/**
 * DocumentsProvider：把 DeepSeek Harness 的 App 私有目录（{@code files/}，rootfs 在
 * {@code files/linux/ubuntu}）暴露给系统/MT 管理器。
 *
 * <p><b>为什么需要它</b>：DeepSeek Harness 的整个 Linux 环境（rootfs、dsh 配置、ADB 密钥）都在
 * App 私有目录里，普通文件管理器（含 MT 管理器）看不到。实现了这个标准
 * DocumentsProvider 后，MT 管理器 → 侧拉栏/设置 → 添加本地存储 → 通过 DocumentsProvider
 * → 选「DeepSeek Harness」，就能像浏览普通目录一样看到 {@code data → files → linux → ubuntu → root → .dsh}，
 * 无需 ROOT、无需 Shizuku。
 *
 * <p><b>安全</b>：只暴露 {@code getFilesDir()} 子树；docId 一律按文件系统真实路径解析，
 * 任何 {@code ..} 穿越、绝对路径注入都解析到 files 之外就拒绝。只读（不提供 create/
 * rename/delete），防误删容器。
 */
public class DeepSeekHarnessDocumentsProvider extends DocumentsProvider {

    /** MT 管理器/系统在 DocumentsProvider 列表里看到的名称。 */
    private static final String ROOT_ID = "deepseekharness-root";
    /** root 的 document_id：不能是空串，部分 DocumentsUI 对空 docId 无法继续浏览。 */
    private static final String ROOT_DOC_ID = "root";
    private static final String[] DEFAULT_ROOT_PROJECTION = new String[]{
            DocumentsContract.Root.COLUMN_ROOT_ID,
            DocumentsContract.Root.COLUMN_MIME_TYPES,
            DocumentsContract.Root.COLUMN_FLAGS,
            DocumentsContract.Root.COLUMN_TITLE,
            DocumentsContract.Root.COLUMN_SUMMARY,
            DocumentsContract.Root.COLUMN_DOCUMENT_ID,
            DocumentsContract.Root.COLUMN_ICON,
    };
    private static final String[] DEFAULT_DOCUMENT_PROJECTION = new String[]{
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_FLAGS,
            DocumentsContract.Document.COLUMN_SIZE,
    };

    private File baseDir;

    @Override
    public boolean onCreate() {
        Context ctx = getContext();
        baseDir = ctx == null ? null : ctx.getFilesDir();
        android.util.Log.i("DeepSeekHarnessDocs", "onCreate baseDir=" + (baseDir == null ? "null" : baseDir.getAbsolutePath()));
        return baseDir != null;
    }

    private File fileForDocId(String docId) throws FileNotFoundException {
        if (baseDir == null) throw new FileNotFoundException("provider 未初始化");
        // "root" 或空串都映射到 files 根；否则是相对 files 的路径
        String rel = (docId == null || docId.isEmpty() || ROOT_DOC_ID.equals(docId)) ? "" : docId;
        File f = rel.isEmpty() ? baseDir : new File(baseDir, rel);
        // 防穿越：最终路径必须仍在 baseDir 内
        String basePath = baseDir.getAbsolutePath();
        String target = f.getAbsolutePath();
        if (!target.equals(basePath) && !target.startsWith(basePath + File.separator)) {
            throw new FileNotFoundException("路径越界: " + docId);
        }
        if (!f.exists()) {
            android.util.Log.w("DeepSeekHarnessDocs", "fileForDocId 不存在: docId=" + docId + " -> " + target);
            throw new FileNotFoundException("不存在: " + rel);
        }
        return f;
    }

    private String docIdForFile(File f) {
        String base = baseDir.getAbsolutePath();
        String abs = f.getAbsolutePath();
        if (abs.equals(base)) return "";
        return abs.substring(base.length() + 1);
    }

    @Override
    public Cursor queryRoots(String[] projection) throws FileNotFoundException {
        android.util.Log.i("DeepSeekHarnessDocs", "queryRoots");
        MatrixCursor result = new MatrixCursor(resolveRootProjection(projection));
        File f = baseDir;
        String rootTitle = "DeepSeek Harness";
        // 根 docId：优先展示 files 根（含 linux/ubuntu/root/.dsh）。用非空 "root"（空串浏览不了）
        String docId = ROOT_DOC_ID;
        // 只读浏览
        int flags = DocumentsContract.Root.FLAG_SUPPORTS_IS_CHILD
                | DocumentsContract.Root.FLAG_SUPPORTS_SEARCH;
        MatrixCursor.RowBuilder row = result.newRow();
        row.add(DocumentsContract.Root.COLUMN_ROOT_ID, ROOT_ID);
        row.add(DocumentsContract.Root.COLUMN_DOCUMENT_ID, docId);
        row.add(DocumentsContract.Root.COLUMN_TITLE, rootTitle);
        row.add(DocumentsContract.Root.COLUMN_SUMMARY,
                "DeepSeek Harness 容器数据（rootfs / dsh 配置 / ADB 密钥），只读");
        row.add(DocumentsContract.Root.COLUMN_FLAGS, flags);
        row.add(DocumentsContract.Root.COLUMN_MIME_TYPES,
                new String[]{"*/*"});
        if (rootHasIcon()) {
            // 用 App 自己的 launcher 图标，MT 管理器 / 系统选择器里显示的是 DeepSeek Harness 而不是通用齿轮
            row.add(DocumentsContract.Root.COLUMN_ICON, R.mipmap.ic_launcher);
        }
        return result;
    }

    private boolean rootHasIcon() {
        return true;
    }

    @Override
    public Cursor queryDocument(String documentId, String[] projection)
            throws FileNotFoundException {
        android.util.Log.i("DeepSeekHarnessDocs", "queryDocument docId=" + documentId);
        File f = fileForDocId(documentId);
        MatrixCursor result = new MatrixCursor(resolveDocumentProjection(projection));
        includeFile(result, f, documentId);
        return result;
    }

    @Override
    public Cursor queryChildDocuments(String parentDocumentId, String[] projection,
                                      String sortOrder) throws FileNotFoundException {
        android.util.Log.i("DeepSeekHarnessDocs", "queryChildDocuments parent=" + parentDocumentId);
        File parent = fileForDocId(parentDocumentId);
        MatrixCursor result = new MatrixCursor(resolveDocumentProjection(projection));
        File[] children = parent.listFiles();
        if (children == null) {
            android.util.Log.w("DeepSeekHarnessDocs", "listFiles null for " + parent.getAbsolutePath());
            return result;
        }
        for (File child : children) {
            includeFile(result, child, docIdForFile(child));
        }
        android.util.Log.i("DeepSeekHarnessDocs", "queryChildDocuments -> " + result.getCount() + " items");
        // 通知可以增量加载（不返回完整列表信号）
        Bundle extras = new Bundle();
        extras.putBoolean(DocumentsContract.EXTRA_LOADING, false);
        result.setExtras(extras);
        return result;
    }

    @Override
    public Cursor querySearchDocuments(String rootId, String query, String[] projection)
            throws FileNotFoundException {
        if (!ROOT_ID.equals(rootId)) return null;
        MatrixCursor result = new MatrixCursor(resolveDocumentProjection(projection));
        if (query == null || query.trim().isEmpty()) return result;
        searchUnder(baseDir, query.trim().toLowerCase(), result, 200);
        return result;
    }

    private void searchUnder(File dir, String query, MatrixCursor result, int limit) {
        if (dir == null || !dir.isDirectory()) return;
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File c : children) {
            if (result.getCount() >= limit) return;
            String name = c.getName();
            if (name != null && name.toLowerCase().contains(query)) {
                includeFile(result, c, docIdForFile(c));
            }
            if (result.getCount() < limit && c.isDirectory()) {
                searchUnder(c, query, result, limit);
            }
        }
    }

    @Override
    public boolean isChildDocument(String parentDocumentId, String documentId) {
        android.util.Log.i("DeepSeekHarnessDocs", "isChildDocument parent=" + parentDocumentId + " child=" + documentId);
        try {
            File parent = fileForDocId(parentDocumentId);
            File child = fileForDocId(documentId);
            return child.getAbsolutePath().startsWith(parent.getAbsolutePath() + File.separator);
        } catch (FileNotFoundException e) {
            return false;
        }
    }

    @Override
    public String getDocumentType(String documentId) throws FileNotFoundException {
        android.util.Log.i("DeepSeekHarnessDocs", "getDocumentType docId=" + documentId);
        File f = fileForDocId(documentId);
        return f.isDirectory() ? DocumentsContract.Document.MIME_TYPE_DIR
                : getMimeType(f.getName());
    }

    @Override
    public AssetFileDescriptor openDocumentThumbnail(String documentId, Point sizeHint,
                                                     CancellationSignal signal)
            throws FileNotFoundException {
        return super.openDocumentThumbnail(documentId, sizeHint, signal);
    }

    @Override
    public ParcelFileDescriptor openDocument(String documentId, String mode,
                                             CancellationSignal signal)
            throws FileNotFoundException {
        File f = fileForDocId(documentId);
        if (f.isDirectory()) throw new FileNotFoundException("目录不能直接打开: " + documentId);
        if (!mode.equals("r") && !mode.equals("rt")) {
            throw new FileNotFoundException("只读 provider，不支持写: " + mode);
        }
        try {
            return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
        } catch (java.io.IOException e) {
            throw new FileNotFoundException(SensitiveData.redact(String.valueOf(e)));
        }
    }

    private void includeFile(MatrixCursor result, File f, String docId) {
        MatrixCursor.RowBuilder row = result.newRow();
        row.add(DocumentsContract.Document.COLUMN_DOCUMENT_ID, docId);
        row.add(DocumentsContract.Document.COLUMN_DISPLAY_NAME, f.getName());
        row.add(DocumentsContract.Document.COLUMN_MIME_TYPE,
                f.isDirectory() ? DocumentsContract.Document.MIME_TYPE_DIR
                        : getMimeType(f.getName()));
        row.add(DocumentsContract.Document.COLUMN_LAST_MODIFIED, f.lastModified());
        row.add(DocumentsContract.Document.COLUMN_SIZE, f.isFile() ? f.length() : 0);
        // 只读：不给任何 create/write/delete flag
        row.add(DocumentsContract.Document.COLUMN_FLAGS, 0);
    }

    private static String getMimeType(String name) {
        String ext = MimeTypeMap.getFileExtensionFromUrl(name);
        if (ext != null && !ext.isEmpty()) {
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase());
            if (mime != null) return mime;
        }
        if (name != null && name.endsWith(".zstd")) return "application/zstd";
        if (name != null && name.endsWith(".tar.gz")) return "application/gzip";
        return "application/octet-stream";
    }

    private static String[] resolveRootProjection(String[] projection) {
        return projection != null && projection.length > 0 ? projection : DEFAULT_ROOT_PROJECTION;
    }

    private static String[] resolveDocumentProjection(String[] projection) {
        return projection != null && projection.length > 0 ? projection : DEFAULT_DOCUMENT_PROJECTION;
    }
}
