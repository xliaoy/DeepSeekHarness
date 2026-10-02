package com.deepseekharness.app.runtime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;

public class RuntimeHostPortsTest {
    @Test public void uninitializedProviderFailsClosed() {
        RuntimeHostPorts ports = new RuntimeHostPorts();
        assertThrows(IllegalStateException.class, ports::settings);
        assertThrows(IllegalStateException.class, ports::open);
        assertThrows(IllegalStateException.class, () -> ports.stage("extract"));
    }

    @Test public void oneInvocationKeepsModeDnsAndFlagsTogetherThenNextSeesSwitch() {
        RuntimeHostPorts ports = new RuntimeHostPorts();
        AtomicReference<RuntimeHostPorts.Settings> current = new AtomicReference<>(
                new RuntimeHostPorts.Settings("auto", false, true, false));
        RuntimeHostPorts.Provider provider = provider(current);
        ports.install(provider);
        try (RuntimeHostPorts.Scope outer = ports.open()) {
            assertEquals("auto", ports.settings().dnsMode);
            assertFalse(ports.settings().proroot);
            assertTrue(ports.settings().staticLoader);
            current.set(new RuntimeHostPorts.Settings("ipv4", true, false, true));
            try (RuntimeHostPorts.Scope inner = ports.open()) {
                assertEquals("auto", ports.settings().dnsMode);
                assertFalse(ports.settings().disableProotSeccomp);
            }
            assertFalse(ports.settings().proroot);
        }
        try (RuntimeHostPorts.Scope next = ports.open()) {
            assertEquals("ipv4", ports.settings().dnsMode);
            assertTrue(ports.settings().proroot);
            assertFalse(ports.settings().staticLoader);
            assertTrue(ports.settings().disableProotSeccomp);
        }
        assertThrows(IllegalStateException.class, () -> ports.install(provider(current)));
    }

    @Test public void cancellationOrExceptionReleasesSnapshotAndDiagnosticFailureDoesNotMaskIt() {
        RuntimeHostPorts ports = new RuntimeHostPorts();
        AtomicReference<RuntimeHostPorts.Settings> current = new AtomicReference<>(
                new RuntimeHostPorts.Settings("native", false, true, false));
        ports.install(new RuntimeHostPorts.Provider() {
            @Override public RuntimeHostPorts.Settings snapshot() { return current.get(); }
            @Override public void stage(String value) { throw new IllegalStateException("sink unavailable"); }
            @Override public void record(String kind, String detail) { throw new IllegalStateException("sink unavailable"); }
            @Override public void failure(Throwable error) { throw new IllegalStateException("sink unavailable"); }
        });
        assertThrows(InterruptedException.class, () -> {
            try (RuntimeHostPorts.Scope ignored = ports.open()) {
                assertEquals("native", ports.settings().dnsMode);
                ports.failure(new InterruptedException("cancelled"));
                throw new InterruptedException("cancelled");
            }
        });
        assertEquals("IllegalStateException", ports.diagnosticFailure());
        current.set(new RuntimeHostPorts.Settings("auto", false, true, false));
        assertEquals("auto", ports.settings().dnsMode);
    }

    private static RuntimeHostPorts.Provider provider(AtomicReference<RuntimeHostPorts.Settings> current) {
        return new RuntimeHostPorts.Provider() {
            @Override public RuntimeHostPorts.Settings snapshot() { return current.get(); }
            @Override public void stage(String value) { }
            @Override public void record(String kind, String detail) { }
            @Override public void failure(Throwable error) { }
        };
    }
}
