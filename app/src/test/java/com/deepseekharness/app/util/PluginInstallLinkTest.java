package com.deepseekharness.app.util;
import org.junit.Test;
import static org.junit.Assert.*;

public class PluginInstallLinkTest {
    @Test public void onlyOwnSchemeAndInstallHostAreAccepted() {
        String query = "url=https%3A%2F%2Fgithub.com%2FMinglink%2Fdsh-infinite-gen-3%2Farchive%2Frefs%2Fheads%2Fmaster.zip";
        assertNotNull(PluginInstallLink.parse("deepseekharness://install?" + query));
        // 解析层宽容收：手输深链时 scheme 大小写不影响本方法。
        // 注意这只覆盖 Uri 解析。系统分发层 IntentFilter 的 scheme 比较区分大小写
        // （Uri.parse 不规范化 scheme，Uri.normalizeScheme() 需显式调用），
        // 大写深链可能匹配不到 AndroidManifest 的 android:scheme="deepseekharness"。
        // 因此小写是唯一对外契约形态；这里的大写用例只锁定“不因大小写抛异常”。
        assertNotNull(PluginInstallLink.parse("DeepSeekHarness://install?" + query));
        assertNotNull(PluginInstallLink.parse("DEEPSEEKHARNESS://install?" + query));
        for(String value:new String[]{null,"http://deepseekharness-test.invalid/install/?url=https://example.com/a.zip",
                "https://deepseekharness-test.invalid/install/?url=https://example.com/a.zip",
                "https://evil.example/app/plugins","deepseekharness://other?"+query,
                "deepseekharness://install/extra?"+query,"deepseekharness://install:8080?"+query,
                "deepseekharness://user@install?"+query,"deepseekharness://install?"+query+"#fragment"}){
            try { PluginInstallLink.parse(value); fail(String.valueOf(value)); } catch (IllegalArgumentException expected) { }
        }
    }
    @Test public void acceptsBothEntryPointsAndDecodesExactlyOnce() {
        String query = "url=https%3A%2F%2Fgithub.com%2FMinglink%2Fdsh-infinite-gen-3%2Farchive%2Frefs%2Fheads%2Fmaster.zip&name=dsh-infinite-gen-3&version=0.5.0";
        assertEquals("dsh-infinite-gen-3", PluginInstallLink.parse("deepseekharness://install/?" + query).name);
        assertTrue(PluginInstallLink.parse("DeepSeekHarness://install?" + query).url.endsWith("master.zip"));
        assertEquals("dsh-web-mobile", PluginInstallLink.parse("DeepSeekHarness://install?builtin=dsh-web-mobile").builtin);
        assertEquals("@scope/demo@1.2.3",PluginInstallLink.parse("DeepSeekHarness://install?url=%40scope%2Fdemo%401.2.3").url);
    }
    @Test public void rejectsForeignHostsDuplicateFieldsAndCommands() {
        String[] invalid={"https://evil.example/install/?url=https://example.com/a.zip",
                "DeepSeekHarness://install?url=file:///root/private.zip", "DeepSeekHarness://install?url=https://example.com/a.zip&url=https://example.com/b.zip",
                "DeepSeekHarness://install?url=https://example.com/a.zip&sha256=123", "DeepSeekHarness://install?command=rm%20-rf%20/",
                "https://deepseekharness-test.invalid/install/?builtin=../../data", "DeepSeekHarness://install?url=https://example.com/a.zip&name=a%0Ab"};
        for(String value:invalid) {
            try { PluginInstallLink.parse(value); fail(value); } catch (IllegalArgumentException expected) { }
        }
    }
}
