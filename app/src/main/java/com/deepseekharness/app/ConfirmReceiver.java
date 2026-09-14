package com.deepseekharness.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 后台安全确认通知的按钮接收器：用户点「允许/拒绝」后
 * 通知 HttpShellService 释放挂起的确认。
 */
public class ConfirmReceiver extends BroadcastReceiver {

    public static final String ACTION_ALLOW = "com.deepseekharness.app.CONFIRM_ALLOW";
    public static final String ACTION_DENY = "com.deepseekharness.app.CONFIRM_DENY";
    /** 确认序号：由 HttpShellService 校验，过期点击（锁屏残留通知、通知历史、
     *  手表转发）会被丢弃，不会误授权给当前请求。（吸收上游 PR#24） */
    public static final String EXTRA_EPOCH = "confirm_epoch";

    @Override
    public void onReceive(Context context, Intent intent) {
        HttpShellService svc = HttpShellService.instance();
        if (svc != null) {
            svc.resolveConfirm(ACTION_ALLOW.equals(intent.getAction()),
                    intent.getLongExtra(EXTRA_EPOCH, -1L));
        }
    }
}
