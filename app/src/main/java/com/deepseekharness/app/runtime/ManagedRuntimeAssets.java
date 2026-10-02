package com.deepseekharness.app.runtime;

import android.content.Context;
import com.deepseekharness.app.backup.AndroidBackupFileSystem;
import com.deepseekharness.app.backup.BackupControl;
import com.deepseekharness.app.backup.BackupJson;
import com.deepseekharness.app.backup.BackupTree;
import com.deepseekharness.app.backup.RuntimeDescriptor;
import com.deepseekharness.app.util.Compat;
import com.deepseekharness.app.util.ManagedRuntimeLayout;
import com.deepseekharness.app.util.UiText;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** APK-managed tree staging and health proof, separate from guest process execution. */
final class ManagedRuntimeAssets {
    interface AssetText { String read(String name); }
    interface LegacyArchive { ZipEntry find(ZipFile apk); }
    private final Context context;
    private final File rootfs;
    private final Supplier<String> environmentIdentity;
    private final AssetText assetText;
    private final LegacyArchive legacyArchive;

    ManagedRuntimeAssets(Context context, File rootfs, Supplier<String> environmentIdentity,
                         AssetText assetText, LegacyArchive legacyArchive) {
        this.context = context; this.rootfs = rootfs;
        this.environmentIdentity = environmentIdentity;
        this.assetText = assetText; this.legacyArchive = legacyArchive;
    }

    RuntimeDescriptor expectedDescriptor() throws IOException {
        return new RuntimeDescriptor(BackupJson.read(assetText.read("runtime-descriptor.json")
                .getBytes(StandardCharsets.UTF_8), 2 * 1024 * 1024));
    }

    RuntimeDescriptor installedDescriptor() throws IOException {
        AndroidBackupFileSystem fs = new AndroidBackupFileSystem();
        File files = context.getFilesDir().getCanonicalFile();
        File linux = fs.child(files, "linux");
        if (fs.stat(linux).type.equals("MISSING")) return null;
        File file = fs.child(linux, ".runtime-descriptor.json");
        if (fs.stat(file).type.equals("MISSING")) return null;
        return new RuntimeDescriptor(BackupJson.read(fs.small(file, 2 * 1024 * 1024), 2 * 1024 * 1024));
    }

    Map<String, Object> health() throws IOException {
        RuntimeDescriptor descriptor = installedDescriptor();
        if (descriptor == null) return null;
        AndroidBackupFileSystem fs = new AndroidBackupFileSystem();
        File home = new File(context.getFilesDir().getCanonicalFile(), "runtime-health");
        File file = new File(home, descriptor.id() + ".json");
        if (fs.stat(home).type.equals("MISSING") || fs.stat(file).type.equals("MISSING")) return null;
        return BackupJson.read(fs.small(file, 512 * 1024), 512 * 1024);
    }

    void confirmHealth(Map<String, Object> proof) throws IOException {
        RuntimeDescriptor descriptor = installedDescriptor();
        if (descriptor == null || !RuntimeDescriptor.healthy(proof, descriptor.id()))
            throw new IOException("RUNTIME_HEALTH_INCOMPLETE");
        AndroidBackupFileSystem fs = new AndroidBackupFileSystem();
        File files = context.getFilesDir().getCanonicalFile();
        File home = new File(files, "runtime-health");
        if (fs.stat(home).type.equals("MISSING")) fs.directory(home);
        Map<String, String> hashes = new LinkedHashMap<>();
        for (String path : installedManagedPaths())
            hashes.put(path, BackupTree.digest(fs, fs.child(files, path), new BackupControl(null)));
        proof.put("managedHashes", hashes);
        fs.atomic(home, descriptor.id() + ".json", BackupJson.write(proof, 512 * 1024));
    }

    /** Only health confirmation walks the full managed tree; normal readiness reads its receipt. */
    private List<String> installedManagedPaths() throws IOException {
        List<String> paths = new ArrayList<>();
        for (String path : ManagedRuntimeLayout.paths()) paths.add("linux/ubuntu/" + path);
        for (String name : new String[]{".offline-identity", ".offline-extracted", ".offline-version", ".runtime-descriptor.json"})
            paths.add("linux/" + name);
        File global = new File(rootfs, "usr/local/lib/node_modules");
        File[] packages = global.listFiles();
        if (packages == null) throw new IOException("MANAGED_RUNTIME_UNREADABLE");
        for (File file : packages) {
            if (file.getName().startsWith("@") && !Compat.isSymbolicLink(file)) {
                File[] children = file.listFiles();
                if (children == null) throw new IOException("MANAGED_RUNTIME_UNREADABLE");
                for (File child : children) addManagedAlias(paths, rootfs, child);
            } else addManagedAlias(paths, rootfs, file);
        }
        for (String name : new String[]{"dsh", "tsc", "tsserver"})
            addManagedAlias(paths, rootfs, new File(rootfs, "usr/local/bin/" + name));
        return paths;
    }

    List<String> stage(File stage, Consumer<String> progress) throws IOException {
        File root = new File(stage, "linux/ubuntu");
        if (!root.mkdirs()) throw new IOException(UiText.text("无法建立独立运行时暂存目录"));
        final String prefix = ManagedRuntimeLayout.DSH;
        progress.accept(UiText.text("正在解压新版 dsh（保留现有 Ubuntu 与个人目录）…"));
        try (ZipFile apk = new ZipFile(context.getPackageCodePath())) {
            boolean split = apk.getEntry("assets/offline-rootfs.layout") != null;
            ZipEntry bundle = split ? apk.getEntry("assets/dsh-runtime.bin") : legacyArchive.find(apk);
            if (bundle == null) throw new IOException(UiText.text("APK 没有内置运行时"));
            try (InputStream input = apk.getInputStream(bundle)) {
                TarGzipExtractor.extractSelected(input, root, 0, name -> name.equals(prefix)
                        || name.startsWith(prefix + "/") || ManagedRuntimeLayout.alias(name)
                        || name.equals("usr/local/share/deepseekharness/dsh-runtime.version"));
            }
        }
        progress.accept(UiText.text("正在准备新版内置插件和界面适配…"));
        RuntimeTools.stage(context, root);
        RuntimeTools.prepareBuiltinDependencies(root);
        List<String> paths = new ArrayList<>();
        for (String name : ManagedRuntimeLayout.paths()) paths.add("linux/ubuntu/" + name);
        File global = new File(root, "usr/local/lib/node_modules");
        File[] packages = global.listFiles();
        if (packages == null) throw new IOException(UiText.text("新版 dsh 依赖目录缺失"));
        for (File file : packages) {
            if (file.getName().startsWith("@") && !Compat.isSymbolicLink(file)) {
                File[] scoped = file.listFiles();
                if (scoped == null) throw new IOException(UiText.text("新版 dsh 作用域目录无法读取"));
                for (File child : scoped) addManagedAlias(paths, root, child);
            } else addManagedAlias(paths, root, file);
        }
        for (String name : new String[]{"dsh", "tsc", "tsserver"}) addManagedAlias(paths, root, new File(root, "usr/local/bin/" + name));
        String identity = environmentIdentity.get();
        writeMarker(new File(stage, "linux/.offline-identity"), identity);
        writeMarker(new File(stage, "linux/.offline-extracted"), identity);
        writeMarker(new File(stage, "linux/.offline-version"), assetText.read("offline-rootfs.version").trim());
        paths.add("linux/.offline-identity"); paths.add("linux/.offline-extracted"); paths.add("linux/.offline-version");
        writeMarker(new File(stage, "linux/.runtime-descriptor.json"), assetText.read("runtime-descriptor.json"));
        paths.add("linux/.runtime-descriptor.json");
        return paths;
    }

    private void addManagedAlias(List<String> paths, File stageRoot, File staged) throws IOException {
        if (!Compat.isSymbolicLink(staged)) return;
        String relative = staged.getAbsolutePath().substring(stageRoot.getAbsolutePath().length() + 1).replace(File.separatorChar, '/');
        if (!ManagedRuntimeLayout.alias(relative)) throw new IOException(UiText.text("运行时别名不在受管范围"));
        File current = new File(rootfs, relative);
        boolean owned = Compat.isSymbolicLink(current) && current.getCanonicalPath().startsWith(
                new File(rootfs, ManagedRuntimeLayout.DSH).getCanonicalPath() + File.separator);
        if (!current.exists() && !Compat.isSymbolicLink(current) || owned) paths.add("linux/ubuntu/" + relative);
    }

    static void writeMarker(File target, String value) throws IOException {
        File temporary = new File(target.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temporary)) {
            out.write(value.getBytes(StandardCharsets.UTF_8)); out.getFD().sync();
        }
        if (!temporary.renameTo(target)) throw new IOException(UiText.text("无法提交安装标记：") + target.getName());
    }
}
