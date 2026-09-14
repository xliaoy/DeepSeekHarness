package com.deepseekharness.app.util;
import org.junit.Test;
import static org.junit.Assert.*;

public class PluginInstallLinkTest {
    @Test public void acceptsBothEntryPointsAndDecodesExactlyOnce() {
        String query = "url=https%3A%2F%2Fgithub.com%2FMinglink%2Fdsh-infinite-gen-3%2Farchive%2Frefs%2Fheads%2Fmaster.zip&name=dsh-infinite-gen-3&version=0.5.0";
        assertEquals("dsh-infinite-gen-3", PluginInstallLink.parse("deepseekharness://install?" + query).name);
        assertTrue(PluginInstallLink.parse("deepseekharness://install?" + query).url.endsWith("master.zip"));
        assertEquals("dsh-web-mobile", PluginInstallLink.parse("deepseekharness://install?builtin=dsh-web-mobile").builtin);
        assertEquals("@scope/demo@1.2.3",PluginInstallLink.parse("deepseekharness://install?url=%40scope%2Fdemo%401.2.3").url);
    }
    @Test public void rejectsForeignHostsDuplicateFieldsAndCommands() {
        String[] invalid={"https://evil.example/install/?url=https://example.com/a.zip",
                "deepseekharness://install?url=file:///root/private.zip", "deepseekharness://install?url=https://example.com/a.zip&url=https://example.com/b.zip",
                "deepseekharness://install?url=https://example.com/a.zip&sha256=123", "deepseekharness://install?command=rm%20-rf%20/",
                "https://example.com/install/?builtin=../../data", "deepseekharness://install?url=https://example.com/a.zip&name=a%0Ab"};
        for(String value:invalid) {
            try { PluginInstallLink.parse(value); fail(value); } catch (IllegalArgumentException expected) { }
        }
    }
}
