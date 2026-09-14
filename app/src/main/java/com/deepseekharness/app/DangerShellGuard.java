package com.deepseekharness.app;

/**
 * 危险 shell 命令检测：删除/格式化/卸载/重启等破坏性操作
 * 命中后需要用户确认才允许执行。
 */
/*
 * 定位与局限（重要，别让后来人误解这道守卫的作用）：
 *
 * 它防的是「误操作」和「明显的恶意命令」，**不是**定向攻击。shell 的表达能力决定了
 * 任何黑名单都能绕过：变量拼接、编码执行、间接调用……追是追不完的。真正的防线是
 * 另外三层 —— 3090 桥的 token 鉴权（未授权者进不来）、关键操作的用户确认（要人真的
 * 点一下）、以及 proot 容器边界（碰不到宿主系统）。
 *
 * 所以这里的取舍是「宁可漏判，不可滥判」：把 > 和 mv 整体判危会让确认弹窗变成噪音，
 * 用户几次之后就学会无脑点允许 —— 那时连真正危险的命令也拦不住了。只在指向关键
 * 路径时才判危，就是这个原因。
 */
public final class DangerShellGuard {

    private DangerShellGuard() {
    }

    /** 直接子串匹配即可判危的模式：本身已经足够具体，不会误伤正常命令。 */
    private static final String[] PATTERNS = {
            // 删除
            "rm -rf", "rm -r", "rm -f", "rm -",
            "rmdir", "unlink", "truncate", "-delete",
            // 格式化/分区/底层写入
            "dd if=", "mkfs", "fdisk",
            // 应用管理（破坏性）
            "pm uninstall", "pm clear", "pm reset",
            "sm format", "settings reset",
            // 混淆/绕过模式
            "base64", "| sh", "| bash", "sh -c", "toybox",
            // 权限破坏：文件还在但用不了了，比删掉更难自查
            "chmod 000", "chattr +i",
    };

    /** 必须按**整词**匹配的危险命令名。
     *
     *  之前这些词和上面混在一起做子串匹配，于是：
     *    eval     →  evaluate / medieval / re-evaluate 全中
     *    format   →  format( / formatBytes / dateFormat 全中
     *    flash    →  flashcard / flashMessage
     *    erase    →  eraser
     *    halt     →  halting
     *  agent 写代码时这些词满地跑，每次都弹确认，用户几次之后就学会无脑点允许 ——
     *  那时连真正危险的命令也拦不住了。 */
    private static final String[] WORD_PATTERNS = {
            "wipe", "erase", "format", "fastboot", "flash", "recovery",
            "reboot", "shutdown", "poweroff", "halt", "eval",
    };

    /** 覆盖或移动这些路径等同于毁掉环境/用户数据，即便命令本身不在黑名单里。
     *  单独列出来是为了不把 > 和 mv 整体判危 —— agent 平时就在写文件、挪文件。 */
    private static final String[] CRITICAL_PATHS = {
            "/root/.dsh", "/usr/local/lib/node_modules", "/usr/local/bin",
            "/etc/", "/usr/lib", "/system/", "/data/data",
    };

    /** 我们自己注入的包装前缀。判危前必须剥掉 ——
     *  否则 `source /root/dsh-guard.sh 2>/dev/null; ` 这段里的 `>` 会让
     *  「覆盖关键路径」那条判据对**任何**提到关键路径的命令生效，
     *  于是每条命令都要确认。用户实测「任何 shell 都被拦」就是这么来的：
     *  我们把自己加的代码当成了用户意图。 */
    private static String stripOwnWrapper(String c) {
        // ensureBashGuardPatch 注入的形式：source /root/dsh-guard.sh 2>/dev/null; <真命令>
        int i = c.indexOf("dsh-guard.sh");
        if (i >= 0) {
            int semi = c.indexOf(';', i);
            if (semi >= 0) return c.substring(semi + 1).trim();
        }
        return c;
    }

    /** 判断命令是否属于危险操作 */
    public static boolean isDangerous(String cmd) {
        if (cmd == null) return false;
        String c = stripOwnWrapper(cmd.toLowerCase());
        // adb shell 通道：检查 shell 后的命令串是否含危险操作/混淆绕过（普通操作不拦）
        int ai = c.indexOf("adb");
        if (ai >= 0) {
            // 按关键字实际长度切（"shell"=5 / "exec-out"=8 / "exec-in"=7），
            // 旧实现固定 si+6 会把 exec-out/exec-in 切成 'ut ...'/'n ...' 导致漏检/误检
            int si = c.indexOf("shell", ai);
            int kwLen = 5;
            int ei = c.indexOf("exec-out", ai);
            if (ei >= 0 && (si < 0 || ei < si)) { si = ei; kwLen = 8; }
            int ii = c.indexOf("exec-in", ai);
            if (ii >= 0 && (si < 0 || ii < si)) { si = ii; kwLen = 7; }
            if (si >= 0 && si - ai < 40) {
                if (matchesDanger(c.substring(si + kwLen))) return true;
            }
        }
        return matchesDanger(c);
    }

    private static boolean matchesDanger(String c) {
        for (String p : PATTERNS) {
            if (c.contains(p)) return true;
        }
        // 整词匹配：\b 边界，避免 evaluate / formatBytes / flashcard 之类误伤
        for (String w : WORD_PATTERNS) {
            if (c.matches(".*\\b" + w + "\\b.*")) return true;
        }
        // 单独 rm 文件（rm 后跟空格或命令结尾），如 rm /sdcard/xxx
        if (c.matches(".*\\brm(\\s|$).*")) return true;
        // 覆盖写或移动关键路径：`> /root/.dsh/x` 能悄悄清空文件，
        // `mv /root/.dsh /tmp` 能让整套环境凭空消失，两者都不含任何黑名单词。
        // 注意 `>>` 是追加、不会清空，不该判危（agent 写日志全靠它）。
        // 只有 >>（追加）不算覆盖：把 >> 抹掉后若还剩 >，才是真的覆盖写
        boolean overwrite = c.replace(">>", "").contains(">");
        if (overwrite || c.matches(".*\\bmv(\\s|$).*")) {
            for (String path : CRITICAL_PATHS) {
                if (c.contains(path)) return true;
            }
        }
        // 分隔符混淆：rm${IFS}-rf、r''m 这类写法能躲过上面所有字面匹配。
        if (c.contains("${ifs}") || c.contains("$ifs")) return true;
        // 引号拆词混淆只认**紧邻**的空引号对（r''m、r""m），
        // 不能匹配 `echo 'a' 'b'` 这种正常的两个带引号参数 ——
        // 旧正则 [a-z]'\s*'[a-z] 把后者也算成混淆，导致大量误拦。
        if (c.matches(".*[a-z](''|\"\")[a-z].*")) return true;
        return false;
    }
}
