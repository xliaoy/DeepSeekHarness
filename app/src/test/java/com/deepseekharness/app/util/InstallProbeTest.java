package com.deepseekharness.app.util;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import static org.junit.Assert.*;

public class InstallProbeTest {
    @Test public void eachSelectedStepOnlyProbesItsOwnCommands() {
        Set<Integer> seen = new HashSet<>();
        for (InstallProbe.Check check : InstallProbe.checks(0)) seen.add(check.step);
        assertEquals(Set.of(2, 3, 4, 5, 6), seen);
        for (int step = 2; step <= 6; step++) for (InstallProbe.Check check : InstallProbe.checks(step)) assertEquals(step, check.step);
        assertTrue(InstallProbe.checks(1).isEmpty());
    }
    @Test public void successfulLookingOutputIsNotSuccessfulExitCode() {
        InstallProbe.Results result = new InstallProbe.Results(InstallProbe.checks(3));
        assertFalse(result.accept("v24.0.0")); assertFalse(result.ok(3));
        result.accept("DeepSeekHarness_CHECK_RESULT:node:127"); assertFalse(result.ok(3));
        assertTrue(result.detail(3).contains("127"));
    }
    @Test public void missingDuplicateAndUnknownResultsFailClosed() {
        InstallProbe.Results result = new InstallProbe.Results(InstallProbe.checks(2));
        assertFalse(result.accept("DeepSeekHarness_CHECK_RESULT:evil:0"));
        result.accept("DeepSeekHarness_CHECK_RESULT:curl:0"); result.accept("DeepSeekHarness_CHECK_RESULT:git:0"); assertFalse(result.ok(2));
        result.accept("DeepSeekHarness_CHECK_RESULT:python:0"); assertTrue(result.ok(2));
        result.accept("DeepSeekHarness_CHECK_RESULT:python:0"); assertFalse(result.ok(2));
    }
    @Test public void invalidExitStatusCannotBecomeSuccess() {
        for (String code : new String[]{"bogus", "-1", "256", "0:0"}) {
            InstallProbe.Results result = new InstallProbe.Results(InstallProbe.checks(3));
            result.accept("DeepSeekHarness_CHECK_RESULT:node:" + code); assertFalse(result.ok(3));
        }
    }
    @Test public void readOnlyProbePreservesExitStatusWithoutHeadOrRepairCommands() {
        String script = InstallProbe.script(InstallProbe.checks(0));
        assertTrue(script.contains("code=$?")); assertTrue(script.contains("timeout 20s"));
        for (String bad : List.of("apt-get", "ensure", "head -1", "rm -", "pip install", "npm install", "flatten-l2s")) assertFalse(bad, script.contains(bad));
        assertTrue(script.contains("PYTHONDONTWRITEBYTECODE=1"));
    }

    @Test public void newExclusivePublishAliasIsRecognizedAndNeverRewrittenAsRename() {
        InstallProbe.Check session = InstallProbe.checks(6).stream().filter(c -> c.key.equals("session")).findFirst().orElseThrow();
        assertTrue(session.command.contains("&& ! grep -Fq " + ShellQuote.arg(InstallProbe.SESSION_PUBLISH_IMPORT)));
        assertTrue(InstallProbe.patchScript().contains("publishSessionExclusive as link"));
        assertTrue(InstallProbe.patchScript().contains("not in s"));
    }

    @Rule public final TemporaryFolder tmp = new TemporaryFolder();

    private static final String RC2_IMPORT = "import { link, lstat, mkdir, mkdtemp, open, readFile } from \"node:fs/promises\";";
    private static final String RC1_IMPORT = "import { link, mkdir, mkdtemp } from \"node:fs/promises\";";
    private static final String OLD_CALL = "  await link(tmp, finalPath);";

    private File write(String name, String content) throws Exception {
        File f = new File(tmp.getRoot(), name);
        Files.write(f.toPath(), content.getBytes(StandardCharsets.UTF_8));
        return f;
    }

    private String patchFiles(String sessionName, String settingsName, String dnsName) throws Exception {
        File session = new File(tmp.getRoot(), sessionName);
        File settings = new File(tmp.getRoot(), settingsName);
        File dns = new File(tmp.getRoot(), dnsName);
        String python = InstallProbe.patchPython(List.of(session.getAbsolutePath()), settings.getAbsolutePath(), dns.getAbsolutePath());
        Process p = new ProcessBuilder("python3", "-B", "-u", "-c", python).directory(tmp.getRoot()).redirectErrorStream(true).start();
        String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        assertEquals("python 退出码非 0：\n" + out, 0, p.waitFor());
        return out;
    }

    private String read(String name) throws Exception {
        return Files.readString(new File(tmp.getRoot(), name).toPath());
    }

    @Test public void rc2ImportInsertRenameKeepLinkSymbolAndRewriteCall() throws Exception {
        write("index.js", RC2_IMPORT + "\n\nconst defaultFileSystem = { link, mkdir };\nconst commit = async (tmp, finalPath) => {\n" + OLD_CALL + "\n};\n");
        patchFiles("index.js", "absent-settings.js", "absent-resolv");
        String s = read("index.js");
        String importLine = s.lines().filter(l -> l.startsWith("import { link,")).findFirst().orElseThrow();
        assertTrue(importLine, importLine.contains("link, rename,"));
        assertFalse(importLine, importLine.isEmpty());
        assertTrue(s, s.contains("const defaultFileSystem = { link, mkdir };"));
        assertFalse(s.contains("await link(tmp, finalPath);"));
        assertTrue(s.contains("await rename(tmp, finalPath);"));
        assertTrue(s.contains("from \"node:fs/promises\""));
    }

    @Test public void rc1ImportStyleAlsoGetsRename() throws Exception {
        write("old.js", RC1_IMPORT + "\nconst commit = async (tmp, finalPath) => {\n" + OLD_CALL + "\n};\n");
        patchFiles("old.js", "absent-settings.js", "absent-resolv");
        String s = read("old.js");
        String importLine = s.lines().filter(l -> l.startsWith("import { link,")).findFirst().orElseThrow();
        assertTrue(importLine, importLine.contains("link, rename,"));
        assertFalse(s.contains("await link(tmp, finalPath);"));
        assertTrue(s.contains("await rename(tmp, finalPath);"));
    }

    @Test public void patchIsIdempotent() throws Exception {
        write("twice.js", RC2_IMPORT + "\nconst commit = async (tmp, finalPath) => {\n" + OLD_CALL + "\n};\n");
        patchFiles("twice.js", "absent-settings.js", "absent-resolv");
        String first = read("twice.js");
        String out = patchFiles("twice.js", "absent-settings.js", "absent-resolv");
        assertEquals(first, read("twice.js"));
        assertFalse(out.contains("已修复会话写入"));
    }

    @Test public void alreadyPatchedWithRenameIsLeftAlone() throws Exception {
        String patched = "import { link, rename, lstat } from \"node:fs/promises\";\nconst commit = async (tmp, finalPath) => { await rename(tmp, finalPath); };\n";
        write("done.js", patched);
        String out = patchFiles("done.js", "absent-settings.js", "absent-resolv");
        assertEquals(patched, read("done.js"));
        assertFalse(out.contains("已修复会话写入"));
    }

    @Test public void publishSessionExclusiveFormatIsNeverRewritten() throws Exception {
        String content = InstallProbe.SESSION_PUBLISH_IMPORT + "\nconst commit = async (tmp, finalPath) => {\n" + OLD_CALL + "\n};\n";
        write("new.js", content);
        patchFiles("new.js", "absent-settings.js", "absent-resolv");
        assertEquals(content, read("new.js"));
    }

    @Test public void lanPersistencePatchRewritesMemoryFallback() throws Exception {
        write("client.js", "const persistence = ctx.remote.$host.isLoopback ? \"host\" : \"memory\";\n");
        patchFiles("absent-index.js", "client.js", "absent-resolv");
        assertEquals("const persistence = \"host\"; // DeepSeekHarness patch: LAN\n", read("client.js"));
    }

    @Test public void dnsMissingNameserverIsAppendedAndExistingLeftAlone() throws Exception {
        write("resolv", "# generated\n");
        patchFiles("absent-index.js", "absent-settings.js", "resolv");
        assertTrue(read("resolv").contains("nameserver 8.8.8.8"));
        write("resolv2", "nameserver 1.1.1.1\n");
        patchFiles("absent-index.js", "absent-settings.js", "resolv2");
        assertEquals("nameserver 1.1.1.1\n", read("resolv2"));
    }
}
