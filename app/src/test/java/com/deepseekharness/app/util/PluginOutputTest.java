package com.deepseekharness.app.util;

import org.junit.Test;
import static org.junit.Assert.*;

public class PluginOutputTest {
    @Test public void resultSurvivesRuntimeExitTrailer() {
        String error = "{\"status\":\"error\",\"message\":\"certificate verify failed\"}";
        assertEquals(error, PluginOutput.resultJson("PLUGIN_RESULT: " + error + "\r\n[proroot] child exited with code 1\n"));
    }
    @Test public void lastResultWinsWithoutMatchingEmbeddedText() {
        assertEquals("new", PluginOutput.resultJson("PLUGIN_RESULT: old\nlog PLUGIN_RESULT: spoof\nPLUGIN_RESULT: new\n"));
        assertEquals("", PluginOutput.resultJson("log PLUGIN_RESULT: spoof"));
    }
    @Test public void missingOrMalformedResultIsNotSuccess() {
        assertEquals("", PluginOutput.resultJson(null));
        assertEquals("", PluginOutput.resultJson("ERROR: failed"));
        assertEquals("broken", PluginOutput.resultJson("PLUGIN_RESULT: broken\n[proroot] exit 1"));
    }
}
