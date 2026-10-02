package com.deepseekharness.app.runtime;

/** App-owned configuration snapshot and cold-install diagnostics boundary. */
public final class RuntimeHostPorts {
    private static final RuntimeHostPorts SHARED = new RuntimeHostPorts();
    private final ThreadLocal<Settings> invocation = new ThreadLocal<>();
    private volatile Provider provider;
    private volatile String diagnosticFailure = "";
    public static RuntimeHostPorts shared() { return SHARED; }

    public static final class Settings {
        public final String dnsMode;
        public final boolean proroot, staticLoader, disableProotSeccomp;
        public Settings(String dnsMode, boolean proroot, boolean staticLoader, boolean disableProotSeccomp) {
            if (dnsMode == null || !dnsMode.matches("auto|ipv4|native")) throw new IllegalArgumentException("RUNTIME_DNS_MODE");
            this.dnsMode = dnsMode; this.proroot = proroot;
            this.staticLoader = staticLoader; this.disableProotSeccomp = disableProotSeccomp;
        }
    }
    public interface Provider {
        Settings snapshot();
        void stage(String value);
        void record(String kind, String detail);
        void failure(Throwable error);
    }
    public interface Scope extends AutoCloseable { @Override void close(); }
    public synchronized void install(Provider value) {
        if (value == null) throw new IllegalArgumentException("RUNTIME_PROVIDER_MISSING");
        if (provider != null && provider != value) throw new IllegalStateException("RUNTIME_PROVIDER_ALREADY_INSTALLED");
        provider = value;
    }
    private Provider required() {
        Provider value = provider;
        if (value == null) throw new IllegalStateException("RUNTIME_PROVIDER_UNAVAILABLE");
        return value;
    }
    public Settings settings() {
        Settings current = invocation.get();
        if (current != null) return current;
        Settings value = required().snapshot();
        if (value == null) throw new IllegalStateException("RUNTIME_SETTINGS_UNAVAILABLE");
        return value;
    }
    public Scope open() {
        if (invocation.get() != null) return () -> { };
        Settings value = settings();
        invocation.set(value);
        return invocation::remove;
    }
    public String diagnosticFailure() { return diagnosticFailure; }
    private void emit(java.util.function.Consumer<Provider> action) {
        Provider value = required();
        try { action.accept(value); }
        catch (RuntimeException error) { diagnosticFailure = error.getClass().getSimpleName(); }
    }
    public void stage(String stage) { emit(value -> value.stage(stage)); }
    public void record(String kind, String detail) { emit(value -> value.record(kind, detail)); }
    public void failure(Throwable error) { emit(value -> value.failure(error)); }
}
