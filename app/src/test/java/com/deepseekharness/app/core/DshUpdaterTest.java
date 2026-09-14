package com.deepseekharness.app.core;

import org.junit.Test;
import static org.junit.Assert.*;

/** 覆盖 DshUpdater 纯逻辑：版本号解析与 release notes 净化。 */
public class DshUpdaterTest {
    @Test public void stripsVersionFromTag() {
        assertEquals("0.1.5-rc.2", DshUpdater.stripTag("dsh-v0.1.5-rc.2"));
        assertEquals("0.1.5-alpha.1", DshUpdater.stripTag("v0.1.5-alpha.1"));
        assertEquals("1.2.0", DshUpdater.stripTag("1.2.0"));
        assertNull(DshUpdater.stripTag("latest"));
    }

    @Test public void cleansGithubReleaseNotes() {
        String body = "[中文](#cn-v0.1.5-rc.2) | [English](#en-v0.1.5-rc.2)\n\n"
                + "<h3 id=\"cn-v0.1.5-rc.2\">体验优化</h3>\n\n"
                + "- 优化反馈提交体验：点赞和点踩均通过弹窗确认后提交，提交失败时保留已填写内容并给出提示。@yixiangihsiang\n"
                + "- 优化交付文件卡片的排版和对话间距，更新代码文件图标，让文件更易辨认、界面更紧凑。@yixiangihsiang\n\n"
                + "---\n\n"
                + "<h3 id=\"en-v0.1.5-rc.2\">Improvements</h3>\n\n"
                + "- Improve feedback submission: both likes and dislikes are confirmed in a dialog before being recorded. by @yixiangihsiang\n"
                + "- Refine delivered-file card layouts and conversation spacing. by @yixiangihsiang\n\n"
                + "Full Changelog: https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.5-rc.1...dsh-v0.1.5-rc.2";
        String out = DshUpdater.cleanReleaseNotes(body);
        assertFalse("HTML 标题标签应被去除", out.contains("<h3"));
        assertFalse("锚点目录应被去除", out.contains("#cn-"));
        assertFalse("markdown 分隔线应被去除", out.contains("---"));
        assertTrue("应保留中文标题", out.contains("体验优化"));
        assertTrue("应保留英文标题", out.contains("Improvements"));
        assertTrue("应以中文标题开头", out.startsWith("体验优化"));
        assertTrue("应保留完整更新日志链接", out.endsWith("dsh-v0.1.5-rc.2"));
    }

    @Test public void cleansEmptyOrNullBody() {
        assertEquals("", DshUpdater.cleanReleaseNotes(null));
        assertEquals("", DshUpdater.cleanReleaseNotes(""));
        assertEquals("", DshUpdater.cleanReleaseNotes("---\n\n---"));
    }
}
