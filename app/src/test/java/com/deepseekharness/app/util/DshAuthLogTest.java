package com.deepseekharness.app.util;

import org.junit.Test;
import static org.junit.Assert.*;

/**
 * DshAuthLog 的两个不变量：
 *  1) **行完整性** —— 无论读取在何处切分，输出都按完整行组装，token 不会跨两次读取被截断成半截；
 *  2) **超长行边界** —— 单行超过 65_536 字符时整行略过，防止日志内存膨胀。
 *
 * <p>关于 token 遮蔽：fork 的设计是 {@link DshAuthUrl#redact} **故意不遮蔽**（README 承诺
 * 「本机地址自动带鉴权 Token 一键复制」，UI 层必须拿到完整地址）。因此本类不再断言
 * 「输出中不含 token」——那是上游断言，与本 fork 设计冲突。落盘脱敏由
 * {@code HarnessController.appendHostLog} 里的 {@code SensitiveData.redact} 在外层兜底，
 * 其行为在 {@link DshAuthUrlTest#redactKeepsForkDesignAndDiskLogsStillRedacted} 中验证。
 */
public class DshAuthLogTest {

    /**
     * 按完整行组装：无论读取在何处切分，抛出的**已完成行**都必须与原文逐字一致，
     * 且 token 不会因切分点被截断成半截。
     *
     * <p>注意 {@link DshAuthLog#finish()} 是「冲刷」语义 —— 它总是再补一个换行，
     * 因此断言对象是 {@code append(...)} 的拼接结果（已完成行），不含 finish()。
     * 上游旧断言用 {@code contains/startsWith}，恰好掩盖了 finish() 会多加一个换行这一点。
     */
    @Test public void lineIsAssembledAtomicallyAcrossEveryReadBoundary() {
        String line = "中文 dsh web: http://127.0.0.1:3080/?token=" + "privateTOKEN".repeat(4) + "\n";
        for (int split = 0; split < line.length(); split++) {
            DshAuthLog log = new DshAuthLog();
            String out = log.append(line.substring(0, split)) + log.append(line.substring(split));
            assertEquals("split=" + split + " 已完成行必须与原文逐字一致", line, out);
            assertTrue("split=" + split + " token 被截断",
                    out.contains("privateTOKENprivateTOKENprivateTOKENprivateTOKEN"));
        }
    }

    /** 落盘脱敏路径未退化：对外输出的完整行若交给 SensitiveData，token 会被打码。 */
    @Test public void diskRedactionPathStillHidesToken() {
        String line = "dsh web: http://127.0.0.1:3080/?token=privateTOKENprivateTOKENprivateTOKENprivateTOKEN";
        String out = new DshAuthLog().append(line + "\n");
        assertTrue("UI 层可见（fork 设计）", out.contains("privateTOKEN"));
        assertFalse("落盘路径必须遮蔽", SensitiveData.redact(out).contains("privateTOKEN"));
    }

    /** 超长行整行略过；不完整行在 finish() 时补换行输出。 */
    @Test public void finalPartialLineIsBoundedAndLongLinesAreSkipped() {
        DshAuthLog log = new DshAuthLog();
        assertEquals("", log.append("token=secret"));
        // fork 设计不遮蔽：finish() 应把未完成行补换行原样输出
        assertEquals("token=secret\n", log.finish());
        assertEquals("", log.append("x".repeat(100_000)));
        assertEquals("[已略过超长输出]\n正常\n", log.append("\n正常\n"));
    }
}
