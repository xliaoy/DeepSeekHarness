package com.deepseekharness.app.ui;

import android.content.Context;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.widget.FrameLayout;

import androidx.core.view.GravityCompat;
import androidx.drawerlayout.widget.DrawerLayout;

/**
 * 主内容容器：在主内容区域任意位置做「向右的水平滑动」即展开侧边栏。
 * DrawerLayout 原生只响应屏幕最左边缘（约 20dp），且系统手势导航下这段边缘
 * 会被返回手势抢占，导致从边缘滑不开；这里改为全区域判定——只要手势明显以
 * 横向为主、方向向右，就打开抽屉，同时不干扰纵向滚动与普通点击。
 * 注：屏幕最左边缘（约 2-3 厘米）的手势导航滑动由系统保留给返回，无法拦截；
 * 从屏幕内任意其它位置向右滑均可。
 */
public final class EdgeSwipeLayout extends FrameLayout {

    private DrawerLayout drawer;
    /** 抽屉所在侧：手机靠左(START)，宽屏靠右(END)；决定横向滑动的判定方向。 */
    private int drawerGravity = GravityCompat.START;
    private final int touchSlop;
    private float downX, downY;
    private boolean maybeSwipe;

    public EdgeSwipeLayout(Context context, AttributeSet attrs) {
        super(context, attrs);
        touchSlop = ViewConfiguration.get(context).getScaledTouchSlop();
    }

    /** 由 MainActivity 在 buildDrawer 时挂接抽屉。宽屏靠右时传 GravityCompat.END。 */
    public void attachDrawer(DrawerLayout d, int gravity) {
        drawer = d;
        drawerGravity = gravity;
    }

    @Override
    public boolean onInterceptTouchEvent(MotionEvent e) {
        if (drawer == null || drawer.isDrawerOpen(drawerGravity)) {
            return super.onInterceptTouchEvent(e);
        }
        boolean rightSide = drawerGravity == GravityCompat.END;
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = e.getX();
                downY = e.getY();
                maybeSwipe = true;
                break;
            case MotionEvent.ACTION_MOVE:
                if (maybeSwipe) {
                    float dx = e.getX() - downX;
                    float dy = e.getY() - downY;
                    // 明显水平滑动 → 展开侧边栏（左抽屉向右滑，右抽屉向左滑）
                    if ((rightSide ? -dx : dx) > touchSlop && Math.abs(dx) > Math.abs(dy)) {
                        maybeSwipe = false;
                        drawer.openDrawer(drawerGravity);
                        return true;
                    }
                    // 纵向滚动 / 反方向 / 原地不动：放弃本次拦截
                    if (Math.abs(dy) > touchSlop * 2 || (rightSide ? dx : -dx) < -touchSlop) {
                        maybeSwipe = false;
                    }
                }
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                maybeSwipe = false;
                break;
        }
        return super.onInterceptTouchEvent(e);
    }
}
