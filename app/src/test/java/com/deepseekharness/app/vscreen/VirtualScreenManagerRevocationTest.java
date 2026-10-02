package com.deepseekharness.app.vscreen;

import com.deepseekharness.app.util.OneShotLaunchAuthority;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;
import org.junit.Test;
import static org.junit.Assert.*;

/** Real manager admission/cleanup with its worker held; no device channel or remote command runs. */
public final class VirtualScreenManagerRevocationTest {
    private static final String OLD = "0123456789abcdef0123456789abcdef0123456789abcdef";
    private static final String NEW = "fedcba9876543210fedcba9876543210fedcba9876543210";
    private static final String COMMAND = "fixed fake app_process launch";

    @Test public void revokeFencesTicketBeforeBlockedWorkerCanCleanUp() throws Exception {
        AtomicLong epoch = field("LIFECYCLE_EPOCH", AtomicLong.class);
        OneShotLaunchAuthority authority = field("ADB_LAUNCH", OneShotLaunchAuthority.class);
        ScheduledExecutorService worker = field("WORKER", ScheduledExecutorService.class);
        LongSupplier previousClock = VirtualScreenManager.clock;
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        try {
            VirtualScreenManager.clock = () -> 100;
            epoch.set(7);
            authority.cancel(7);
            assertTrue(authority.issue(OLD, COMMAND, 7, 100, 30_000));
            assertEquals(OLD, VirtualScreenManager.adbLaunchTicketFor(COMMAND));
            assertTrue(VirtualScreenManager.authorizeAdbLaunchPlan(OLD, COMMAND));
            worker.execute(() -> {
                entered.countDown();
                try { release.await(); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            });
            assertTrue(entered.await(2, TimeUnit.SECONDS));

            // Old code only queued stopLocked: this commit succeeded until the worker resumed.
            VirtualScreenManager.revoke();
            assertFalse(VirtualScreenManager.commitAdbLaunch(OLD));
            assertEquals("", VirtualScreenManager.adbLaunchTicketFor(COMMAND));

            // Simulate a later authorized generation before the old cleanup gets worker time.
            long next = epoch.incrementAndGet();
            setField("token", "new-generation-token");
            setField("activeEpoch", next);
            assertTrue(authority.issue(NEW, COMMAND, next, 100, 30_000));
            assertTrue(VirtualScreenManager.authorizeAdbLaunchPlan(NEW, COMMAND));
            CountDownLatch drained = new CountDownLatch(1);
            worker.execute(drained::countDown);
            release.countDown();
            assertTrue(drained.await(2, TimeUnit.SECONDS));
            assertEquals("new-generation-token", field("token", String.class));
            assertTrue(VirtualScreenManager.commitAdbLaunch(NEW));
        } finally {
            release.countDown();
            authority.cancel(7);
            authority.cancel(epoch.get());
            setField("token", "");
            setField("activeEpoch", -1L);
            epoch.set(0);
            VirtualScreenManager.clock = previousClock;
        }
    }

    private static <T> T field(String name, Class<T> type) throws Exception {
        Field field = VirtualScreenManager.class.getDeclaredField(name);
        field.setAccessible(true);
        return type.cast(field.get(null));
    }
    private static void setField(String name, Object value) throws Exception {
        Field field = VirtualScreenManager.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(null, value);
    }
}
