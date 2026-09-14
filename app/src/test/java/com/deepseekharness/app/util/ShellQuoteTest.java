package com.deepseekharness.app.util;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** ShellQuote 的安全边界断言：恶意/畸形值必须被字面量化，不能逃逸出单引号。 */
public class ShellQuoteTest {

    @Test
    public void plainValueIsSingleQuoted() {
        assertEquals("'hello'", ShellQuote.arg("hello"));
    }

    @Test
    public void nullBecomesEmptyQuotedArg() {
        assertEquals("''", ShellQuote.arg(null));
    }

    @Test
    public void singleQuoteIsEscapedPosixStyle() {
        // POSIX：单引号内嵌单引号 → ' + '\'' + '
        assertEquals("'a'\\''b'", ShellQuote.arg("a'b"));
    }

    @Test
    public void shellMetacharactersAreLiteral() {
        // 这些字符如果在单引号外会被 shell 解释，这里必须原样封住
        assertEquals("'a;b$(rm -rf /)`c`d${x}e'", ShellQuote.arg("a;b$(rm -rf /)`c`d${x}e"));
    }

    @Test
    public void roundTripOnPluginLikeValue() {
        String pluginName = "@deepseek-ai/dsh-foo@1.0.0 ' OR 1=1 --";
        String quoted = ShellQuote.arg(pluginName);
        // 必须仍以单引号开头结尾，且不含裸露的引号中断
        assertEquals('\'', quoted.charAt(0));
        assertEquals('\'', quoted.charAt(quoted.length() - 1));
    }
}
