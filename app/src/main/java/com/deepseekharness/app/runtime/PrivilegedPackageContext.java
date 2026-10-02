package com.deepseekharness.app.runtime;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** One-time PackageManager context for Root/Shizuku app_process launchers. */
public final class PrivilegedPackageContext {
    private static final Object LOCK = new Object();
    private static final long INIT_TIMEOUT_MS = 10_000;
    private static volatile Context systemContext;
    private static volatile IOException initializationFailure;
    private static boolean initializationAttempted;

    private PrivilegedPackageContext() { }

    public static Context systemContext() throws IOException {
        Context cached = systemContext;
        if (cached != null) return cached;
        Looper main = Looper.getMainLooper();
        if (main == null) {
            // Bare app_process entry points have no Android main Looper. Prepare it before
            // ActivityThread.systemMain(), which constructs handlers during attach().
            if (Looper.myLooper() != null) throw new IOException("PRIVILEGED_MAIN_LOOPER_UNAVAILABLE");
            try { Looper.prepareMainLooper(); }
            catch (RuntimeException error) { throw new IOException("PRIVILEGED_MAIN_LOOPER_UNAVAILABLE", error); }
            main = Looper.getMainLooper();
        }
        if (Looper.myLooper() == main) return initializeOnMain();

        CountDownLatch ready = new CountDownLatch(1);
        AtomicReference<Context> result = new AtomicReference<>();
        AtomicReference<IOException> failure = new AtomicReference<>();
        if (!new Handler(main).post(() -> {
            try { result.set(initializeOnMain()); }
            catch (IOException error) { failure.set(error); }
            finally { ready.countDown(); }
        })) throw new IOException("PRIVILEGED_PACKAGE_CONTEXT_POST_FAILED");
        try {
            if (!ready.await(INIT_TIMEOUT_MS, TimeUnit.MILLISECONDS)) throw new IOException("PRIVILEGED_PACKAGE_CONTEXT_TIMEOUT");
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IOException("PRIVILEGED_PACKAGE_CONTEXT_INTERRUPTED", error);
        }
        if (failure.get() != null) throw failure.get();
        Context initialized = result.get();
        if (initialized == null) throw new IOException("PRIVILEGED_PACKAGE_CONTEXT_MISSING");
        return initialized;
    }

    private static Context initializeOnMain() throws IOException {
        Context cached = systemContext;
        if (cached != null) return cached;
        synchronized (LOCK) {
            cached = systemContext;
            if (cached != null) return cached;
            if (initializationFailure != null) throw initializationFailure;
            if (initializationAttempted) throw new IOException("PRIVILEGED_PACKAGE_CONTEXT_ALREADY_ATTEMPTED");
            if (Looper.getMainLooper() == null || Looper.myLooper() != Looper.getMainLooper())
                throw new IOException("PRIVILEGED_MAIN_LOOPER_MISMATCH");
            initializationAttempted = true;
            try {
                Class<?> activityThread = Class.forName("android.app.ActivityThread");
                Object thread = activityThread.getMethod("systemMain").invoke(null);
                Context context = (Context) thread.getClass().getMethod("getSystemContext").invoke(thread);
                if (context == null || context.getPackageManager() == null)
                    throw new IOException("PRIVILEGED_PACKAGE_MANAGER_MISSING");
                systemContext = context;
                return context;
            } catch (IOException error) {
                initializationFailure = error;
                throw error;
            } catch (Throwable error) {
                initializationFailure = new IOException("PRIVILEGED_PACKAGE_CONTEXT_UNAVAILABLE", error);
                throw initializationFailure;
            }
        }
    }
}
