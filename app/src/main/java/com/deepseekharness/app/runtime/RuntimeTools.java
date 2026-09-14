package com.deepseekharness.app.runtime;

import android.content.Context;
import com.deepseekharness.app.util.Compat;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Map;

/** 统一准备插件与终端的证书和命令入口，无需先手动运行安装第 2 步。 */
final class RuntimeTools {
    static final String CERT_PATH = "/usr/local/share/deepseekharness/ca-certificates.crt";
    private static final Object LOCK = new Object();
    private static String preparedRoot;
    private static String preparedApk;
    private static String preparedStamp;
    private static final java.util.Set<File> preparedFiles = new java.util.LinkedHashSet<>();

    static void prepare(Context context, File rootfs) throws IOException {
        prepare(context, rootfs, true);
    }

    static void stage(Context context, File rootfs) throws IOException { prepare(context, rootfs, false); }

    private static void prepare(Context context, File rootfs, boolean requireNpm) throws IOException {
        synchronized (LOCK) {
            File apk = new File(context.getPackageCodePath());
            String identity = apk.getPath() + ":" + apk.length() + ":" + apk.lastModified();
            String root = rootfs.getCanonicalPath();
            if (root.equals(preparedRoot) && identity.equals(preparedApk)
                    && preparedStamp != null && preparedStamp.equals(stamp(rootfs))) return;
            preparedStamp = null;
            preparedFiles.clear();
            install(context, rootfs, "ca-certificates.crt", CERT_PATH.substring(1), false);
            install(context, rootfs, "plugin-manager.py", "root/.dsh/plugin-manager.py", false);
            install(context, rootfs, "plugin-lifecycle.py", "root/.dsh/plugin-lifecycle.py", false);
            install(context, rootfs, "plugin-semver.cjs", "root/.dsh/plugin-semver.cjs", false);
            install(context, rootfs, "register-builtin-plugins.py", "root/.dsh/register-builtin-plugins.py", false);
            install(context, rootfs, "startup-observer.cjs", "root/.dsh/startup-observer.cjs", false);
            install(context, rootfs, "startup-recovery.py", "root/.dsh/startup-recovery.py", false);
            install(context, rootfs, "device-shell-policy.py", "root/.dsh/device-shell-policy.py", false);
            install(context, rootfs, "adb-shell.py", "root/.dsh/adb-shell.py", false);
            for (String file : new String[]{"package.json", "cordis.patch.yml", "index.js", "activity.js", "runtime-plugins.js", "client.js"})
                install(context, rootfs, "app-integration/" + file, "root/deepseekharness-app-integration/" + file, false);
            for (String name : com.deepseekharness.app.util.BuiltinPlugins.DEFAULT_BUILTINS) {
                String destination = com.deepseekharness.app.util.BuiltinPlugins.entityDir(name).substring(1) + "/";
                if (name.equals("dsh-memento")) {
                    // dsh-memento 入口为 index.mjs（无 lib/index.js，通用行会因 assets 缺文件抛错），
                    // 按包结构安装运行必需文件：主入口 + types + lib/ 全部模块 + client bundle + MCP server。
                    for (String file : new String[]{
                            "package.json", "cordis.patch.yml", "index.mjs", "types.d.ts", "LICENSE",
                            "lib/adapters.mjs", "lib/budget.mjs", "lib/constants.mjs", "lib/embedding.mjs",
                            "lib/errors.mjs", "lib/extract.mjs", "lib/gate.mjs", "lib/match.mjs", "lib/mcp.mjs",
                            "lib/protocol.mjs", "lib/registry.mjs", "lib/retrieval.mjs", "lib/snapshot.mjs",
                            "lib/store.mjs", "lib/strings.mjs", "lib/workspace.mjs",
                            "client/client.js", "client/client.d.ts", "bin/mcp-server.mjs"})
                        install(context, rootfs, "builtin-plugins/" + name + "/" + file, destination + file, false);
                    continue;
                }
                for (String file : new String[]{"package.json", "cordis.patch.yml", "lib/index.js"})
                    install(context, rootfs, "builtin-plugins/" + name + "/" + file, destination + file, false);
                if (name.equals("dsh-web-mobile")) for (String file : new String[]{"lib/client.js", "lib/compress.js", "lib/delete-session.js", "LICENSE"})
                    install(context, rootfs, "builtin-plugins/" + name + "/" + file, destination + file, false);
                if (name.equals("dsh-client-ui-aqua")) for (String file : new String[]{"lib/client.js", "lib/invariant.js", "LICENSE"})
                    install(context, rootfs, "builtin-plugins/" + name + "/" + file, destination + file, false);
                if (name.equals("dsh-balance-panel")) for (String file : new String[]{"lib/client.js", "lib/host.js", "LICENSE"})
                    install(context, rootfs, "builtin-plugins/" + name + "/" + file, destination + file, false);
            }
            // 预装第三方插件（不进内置清单，保持「可在线更新 / 可删除」）：dsh-infinite-gen-4 按包结构安装
            installPresetPlugin(context, rootfs);
            install(context, rootfs, "deepseekharness-plugin.sh", "root/dsh-bin/deepseekharness-plugin", true);
            install(context, rootfs, "install-ubuntu-tools.sh", "root/dsh-bin/install-ubuntu-tools", true);
            for (String command : new String[]{"npm", "npx"}) {
                File cli = new File(rootfs, "usr/local/lib/node_modules/npm/bin/" + command + "-cli.js");
                if (requireNpm && !cli.isFile()) throw new IOException("内置 npm 文件缺失：" + command + "-cli.js");
                if (requireNpm) preparedFiles.add(cli);
                File wrapper = new File(rootfs, "root/dsh-bin/" + command);
                writeIfChanged(wrapper, ("#!/bin/sh\nexec /usr/local/bin/node /usr/local/lib/node_modules/npm/bin/"
                        + command + "-cli.js \"$@\"\n").getBytes(java.nio.charset.StandardCharsets.UTF_8), true);
            }
            install(context, rootfs, "deepseekharness-runtime-env.sh", "etc/profile.d/deepseekharness-runtime-env.sh", false);
            patchComposerInput(context, rootfs);
            patchTooltips(context, rootfs);
            patchClientCombos(context, rootfs);
            preparedRoot = root;
            preparedApk = identity;
            preparedStamp = stamp(rootfs);
        }
    }

    static void invalidate() { synchronized (LOCK) { preparedStamp = null; } }

    /** 只 stat 固定数量的受管文件；不读取大 JS，不遍历会话、附件和项目依赖。 */
    private static String stamp(File rootfs) throws IOException {
        try {
            StringBuilder value = new StringBuilder();
            android.system.StructStat root = android.system.Os.lstat(rootfs.getAbsolutePath());
            value.append(root.st_dev).append(':').append(root.st_ino);
            for (File file : preparedFiles) {
                if (!file.isFile() || Compat.isSymbolicLink(file)) return null;
                android.system.StructStat stat = android.system.Os.lstat(file.getAbsolutePath());
                value.append('|').append(stat.st_ino).append(':').append(stat.st_size).append(':')
                        .append(file.lastModified());
            }
            return value.toString();
        } catch (android.system.ErrnoException error) { return null; }
    }

    /** 界面修订覆盖安装后直接更新既有 dsh；不重建环境、不触碰会话和插件配置。 */
    private static void patchComposerInput(Context context, File rootfs) throws IOException {
        File packageFile = new File(rootfs, "usr/local/lib/node_modules/@deepseek-ai/dsh/package.json");
        File client = new File(rootfs, "usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js");
        if (!packageFile.isFile() || !client.isFile()) return;
        preparedFiles.add(packageFile);
        preparedFiles.add(client);
        try {
            org.json.JSONObject metadata = new org.json.JSONObject(Compat.readAll(packageFile));
            if (!com.deepseekharness.app.util.Constants.DSH_VERSION.equals(metadata.optString("version"))) return;
            if (Compat.isSymbolicLink(client) || !client.getCanonicalPath().startsWith(rootfs.getCanonicalPath() + File.separator))
                throw new IOException("输入适配的模块路径不安全，原文件保留");
            String source = Compat.readAll(client), updated = source;
            org.json.JSONObject specification;
            try (InputStream input = context.getAssets().open("composer-enter-patch.json"); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] bytes = new byte[4096]; int n; while ((n = input.read(bytes)) != -1) out.write(bytes, 0, n);
                specification = new org.json.JSONObject(out.toString("UTF-8"));
            }
            org.json.JSONArray patches = specification.getJSONArray("patches");
            for (int i = 0; i < patches.length(); i++) {
                org.json.JSONObject patch = patches.getJSONObject(i);
                updated = com.deepseekharness.app.util.ExactTextPatch.apply(updated, patch.getString("before"), patch.getString("after"));
            }
            if (!updated.equals(source)) writeIfChanged(client, updated.getBytes(java.nio.charset.StandardCharsets.UTF_8), false);
        } catch (org.json.JSONException | IllegalArgumentException error) {
            throw new IOException("对话输入适配未应用，原文件保留：" + error.getMessage(), error);
        }
    }

    static void applyEnvironment(Map<String, String> environment) {
        // 原生扩展已在私有运行时中；复制缓存使用 link+unlink，在 link2symlink 下首次变成悬链。
        environment.putIfAbsent("NARB_DISABLE_NATIVE_CACHE", "1");
        // 原生扩展已在私有运行时中；复制缓存使用 link+unlink，在 link2symlink 下首次变成悬链。
        environment.putIfAbsent("NARB_DISABLE_NATIVE_CACHE", "1");
        for (String key : new String[]{"SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "GIT_SSL_CAINFO"})
            environment.putIfAbsent(key, CERT_PATH);
        environment.putIfAbsent("NODE_EXTRA_CA_CERTS", CERT_PATH);
        environment.putIfAbsent("npm_config_cafile", CERT_PATH);
        environment.putIfAbsent("npm_config_prefix", "/usr/local");
    }

    /** 修正触摸设备上的提示状态；更新入口查询标记，让已有浏览缓存取得本次修订。 */
    private static void patchTooltips(Context context, File rootfs) throws IOException {
        File packageFile = new File(rootfs, "usr/local/lib/node_modules/@deepseek-ai/dsh/package.json");
        if (!packageFile.isFile()) return;
        try {
            org.json.JSONObject metadata = new org.json.JSONObject(Compat.readAll(packageFile));
            org.json.JSONObject patch = new org.json.JSONObject(assetText(context, "web-integration/tooltip-patch.json"));
            if (!patch.getString("dshVersion").equals(metadata.optString("version"))) return;
            File frontend = new File(rootfs, "usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist");
            File bundle = new File(frontend, patch.getString("bundle")), index = new File(frontend, "index.html");
            preparedFiles.add(bundle);
            preparedFiles.add(index);
            String boundary = rootfs.getCanonicalPath() + File.separator;
            for (File file : new File[]{bundle, index}) {
                if (!file.isFile() || Compat.isSymbolicLink(file) || !file.getCanonicalPath().startsWith(boundary))
                    throw new IOException("对话提示适配的文件缺失或路径不安全");
            }
            String replacement = assetText(context, "web-integration/tooltip-interactions.js")
                    + "\nconst deepseekharnessTooltipRuntime = createDeepSeekHarnessTooltipRuntime({ document, window });\n"
                    + assetText(context, "web-integration/tooltip-component.js");
            String source = Compat.readAll(bundle), html = Compat.readAll(index);
            String updated = com.deepseekharness.app.util.ExactTextPatch.apply(source, patch.getString("before"), replacement);
            String entry = com.deepseekharness.app.util.ExactTextPatch.apply(html, patch.getString("indexBefore"), patch.getString("indexAfter"));
            if (!updated.equals(source)) writeIfChanged(bundle, updated.getBytes(java.nio.charset.StandardCharsets.UTF_8), false);
            if (!entry.equals(html)) writeIfChanged(index, entry.getBytes(java.nio.charset.StandardCharsets.UTF_8), false);
        } catch (org.json.JSONException | IllegalArgumentException error) {
            throw new IOException("对话提示适配未应用，原文件保留：" + error.getMessage(), error);
        }
    }

    private static String assetText(Context context, String name) throws IOException {
        try (InputStream input = context.getAssets().open(name); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) out.write(buffer, 0, count);
            return out.toString("UTF-8").replace("\r\n", "\n");
        }
    }

    private static void patchClientCombos(Context context, File rootfs) throws IOException {
        File pkg = new File(rootfs, "usr/local/lib/node_modules/@deepseek-ai/dsh/package.json");
        File module = new File(rootfs, "usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js");
        if (!pkg.isFile() || !module.isFile()) return;
        try {
            org.json.JSONObject spec = new org.json.JSONObject(assetText(context, "client-combo-patch.json"));
            if (!spec.getString("dshVersion").equals(new org.json.JSONObject(Compat.readAll(pkg)).optString("version"))) return;
            if (Compat.isSymbolicLink(module) || !module.getCanonicalPath().startsWith(rootfs.getCanonicalPath() + File.separator))
                throw new IOException("网页脚本模块路径不安全，原文件保留");
            String source = Compat.readAll(module), patched = source;
            org.json.JSONArray patches = spec.getJSONArray("patches");
            for (int i = 0; i < patches.length(); i++) {
                org.json.JSONObject patch = patches.getJSONObject(i);
                patched = com.deepseekharness.app.util.ExactTextPatch.apply(patched, patch.getString("before"), patch.getString("after"));
            }
            for (String file : new String[]{"package.json", "index.js"})
                install(context, rootfs, "client-combo-cache/" + file,
                        "usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/deepseekharness-client-combo-cache/" + file, false);
            preparedFiles.add(module);
            if (!source.equals(patched)) writeIfChanged(module, patched.getBytes(java.nio.charset.StandardCharsets.UTF_8), false);
        } catch (org.json.JSONException | IllegalArgumentException error) {
            throw new IOException("网页脚本拼接优化未应用，原文件保留：" + error.getMessage(), error);
        }
    }

    /** 预装第三方插件 dsh-infinite-gen-4：按包结构把 assets/builtin-plugins 内容装到 /root/deepseekharness-*。
     *  不进 DEFAULT_BUILTINS —— 保持第三方身份，插件页可在线更新 / 删除。 */
    private static void installPresetPlugin(Context context, File rootfs) throws IOException {
        final String name = "dsh-infinite-gen-4";
        String destination = "/root/deepseekharness-" + name.substring(4) + "/";
        for (String file : new String[]{
                "package.json", "cordis.patch.yml", "index.js", "client.js",
                "HARNESS_PLUGIN.md", "README.md", "LICENSE",
                "prompts/infinite-gen-3.md", "prompts/infinite-gen-4.md", "prompts/infinite-gen-4.1-flash.md",
                "scripts/verify_prompt.mjs", "scripts/verify_prompt_gen4.mjs", "scripts/verify_prompt_gen41.mjs",
                "scripts/lib/scorer.mjs",
                "tests/prompt-bank.jsonl", "tests/prompt-bank-gen4.jsonl", "tests/prompt-bank-gen41.jsonl",
                "tests/v4pro-benchmark.jsonl",
                "assets/banner.png", "assets/community.jpg", "assets/sponsor.jpg"})
            install(context, rootfs, "builtin-plugins/" + name + "/" + file, destination + file, false);
    }

    private static void install(Context context, File rootfs, String asset, String path, boolean executable) throws IOException {
        try (InputStream input = context.getAssets().open(asset); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            byte[] content = bytes.toByteArray();
            if (asset.endsWith(".sh") || asset.endsWith(".py"))
                content = new String(content, java.nio.charset.StandardCharsets.UTF_8).replace("\r\n", "\n")
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            writeIfChanged(new File(rootfs, path), content, executable);
        }
    }

    private static void writeIfChanged(File file, byte[] content, boolean executable) throws IOException {
        preparedFiles.add(file);
        File parent = file.getParentFile();
        if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("无法创建运行工具目录");
        if (file.isFile() && !Compat.isSymbolicLink(file) && Arrays.equals(Compat.readAllBytes(file), content)) {
            if (executable) file.setExecutable(true, false);
            return;
        }
        // 替换文件本身，不追随软链，不让并发执行读到半份脚本。
        File staged = new File(parent, file.getName() + ".deepseekharness-tmp");
        try {
            Compat.write(staged, content);
            if (executable) staged.setExecutable(true, false);
            android.system.Os.rename(staged.getAbsolutePath(), file.getAbsolutePath());
        } catch (android.system.ErrnoException error) { throw new IOException("更新运行工具失败：" + file.getName(), error); }
        finally { staged.delete(); }
    }
}
