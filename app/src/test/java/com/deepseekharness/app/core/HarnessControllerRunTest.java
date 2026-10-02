package com.deepseekharness.app.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import com.deepseekharness.app.util.WebLifecycle;
import org.junit.Test;

public class HarnessControllerRunTest {
    @Test public void staleOutputCannotPublishPortOrAuthIntoNewGeneration() {
        WebLifecycle gate = new WebLifecycle();
        long first = gate.beginStart(false, false);
        HarnessController.WebRun old = new HarnessController.WebRun(first);
        assertTrue(HarnessController.publishAuthenticatedRun(gate, old, "http://127.0.0.1:3080/?token=first"));
        assertEquals(3080, old.port);
        gate.beginStop(); gate.finishStop(gate.generation());
        long second = gate.beginStart(false, true);
        HarnessController.WebRun current = new HarnessController.WebRun(second);
        assertFalse(HarnessController.publishAuthenticatedRun(gate, old, "http://127.0.0.1:3999/?token=stale"));
        assertTrue(HarnessController.publishAuthenticatedRun(gate, current, "http://127.0.0.1:4179/?token=current"));
        assertEquals(3080, old.port);
        assertEquals("http://127.0.0.1:3080/?token=first", old.authUrl);
        assertEquals(4179, current.port);
        assertEquals("http://127.0.0.1:4179/?token=current", current.authUrl);
    }
}
